// 解析调用模块：负责所有与解析模型交互的逻辑
// - 构建解析提示词（纯 XML 块格式）
// - 调用内置 callGenerate 服务
// - 处理流式/非流式输出
// - 错误处理

import { getConfigForCurrentCharacter } from "./card-storage.js";
import { extension_settings } from "../../../../extensions.js";
import { getCallGenerateService } from "../services/call-generate.js";
import { parseVariablePath } from "../core/variables.js";

const EXT_ID = "CharaEngineForST";

/**
 * 构建解析模型所需的 quietPrompt。
 * 使用「上一轮 AI 回复 + 本轮用户输入」以及角色卡参数定义，要求模型输出 XML 块格式的解析结果。
 *
 * 根据实际启用的功能动态构建提示词：
 * - 只有启用的功能才会在提示词中出现
 * - 未启用的功能完全不提及，避免LLM产生不必要的输出
 * - 动态显示参数的路径格式和绑定实体
 * - 当 cast 为空时，添加初始化提示
 *
 * @param {Array} chat
 * @param {import("../core/engine-state.js").EngineState} [currentState] - 当前引擎状态（用于检测 cast 是否为空）
 * @returns {{ quietPrompt: string }|null}
 */
export function buildParsePromptInput(chat, currentState = null) {
  if (!Array.isArray(chat) || chat.length < 1) {
    return null;
  }

  const lastIndex = chat.length - 1;
  const currentUserMsg = chat[lastIndex];
  if (!currentUserMsg || !currentUserMsg.is_user) {
    // 仅在"最后一条是用户输入"时进行提前解析
    return null;
  }

  // 找上一条 AI 回复（从后往前找第一条 is_user === false 的消息）
  let lastAiMsg = null;
  for (let i = lastIndex - 1; i >= 0; i--) {
    const msg = chat[i];
    if (msg && !msg.is_user) {
      lastAiMsg = msg;
      break;
    }
  }

  const lastAiText = lastAiMsg?.mes || "";
  const currentUserText = currentUserMsg.mes || "";

  const charConfig = getConfigForCurrentCharacter();
  const params = charConfig.parameters || [];
  const entities = charConfig.entities || [];
  const options = charConfig.options || {};

  // 检查功能开关
  const settings = extension_settings[EXT_ID] || {};
  const useSceneAndCast = settings.useSceneAndCast !== false;
  const useWorldRag = settings.useWorldRag === true;
  const enableShortTermEmotion = !options.disableShortTermEmotion;
  const enableShortTermIntent = !options.disableShortTermIntent;

  // 过滤参数：排除被禁用的短期情绪/意图参数
  const activeParams = params.filter((p) => {
    const name = (p.name || "").toLowerCase();
    const id = (p.id || "").toLowerCase();
    
    // 检查短期情绪（标准 ID）
    const isShortTermEmotion = id === "short_term_emotion" || name.includes("短期情绪");
    
    // 检查短期意图（标准 ID）
    const isShortTermIntent = id === "short_term_intent" || name.includes("短期意图");
    
    // 如果是短期情绪/意图参数且被禁用，过滤掉
    if (isShortTermEmotion && !enableShortTermEmotion) {
      return false;
    }
    if (isShortTermIntent && !enableShortTermIntent) {
      return false;
    }
    
    // 其他参数或启用的短期情绪/意图，保留
    return true;
  });

  // 构建参数详细信息，包括类型、scope、路径格式和绑定的实体
  const paramLines = activeParams.map((p) => {
    const typeLabel = p.type || "unknown";
    const scope = p.scope || "character";
    const desc = p.description || "";
    
    // 查找绑定了此参数的实体
    const boundEntities = [];
    for (const entity of entities) {
      if (Array.isArray(entity.parameterNames) && entity.parameterNames.includes(p.name)) {
        boundEntities.push(entity.name);
      }
    }
    
    // 根据 scope 确定路径格式
    let pathFormat = "";
    let pathExample = "";
    let scopeDesc = "";
    
    switch (scope) {
      case "relationship":
        // 三段路径：主体.参数.目标
        pathFormat = "三段路径（需要目标实体）";
        scopeDesc = "关系型参数";
        if (boundEntities.length > 0) {
          pathExample = `${boundEntities[0]}.${p.name}.{目标实体名}`;
        } else {
          pathExample = `{主体名}.${p.name}.{目标名}`;
        }
        break;
      case "character":
        // 两段路径：主体.参数
        pathFormat = "两段路径";
        scopeDesc = "角色自身参数";
        if (boundEntities.length > 0) {
          pathExample = `${boundEntities[0]}.${p.name}`;
        } else {
          pathExample = `{主体名}.${p.name}`;
        }
        break;
      case "scene":
        // 单段路径：仅参数名
        pathFormat = "单段路径";
        scopeDesc = "场景级参数";
        pathExample = p.name;
        break;
      case "global":
        // 单段路径：仅参数名
        pathFormat = "单段路径";
        scopeDesc = "全局参数";
        pathExample = p.name;
        break;
      default:
        pathFormat = "未知格式";
        scopeDesc = "未知作用域";
        pathExample = p.name;
    }
    
    let line = `- **${p.name}** (${typeLabel}, ${scopeDesc})`;
    if (desc) line += `\n  说明：${desc}`;
    line += `\n  路径格式：${pathFormat}`;
    
    // 为文本类型参数添加详细的格式说明
    if (p.type === "text") {
      const textHint = p.textHint || "";
      if (textHint) {
        line += `\n  格式要求：${textHint}`;
        line += `\n  使用示例：ce.set('${pathExample}', '${textHint}')`;
      } else {
        line += `\n  使用示例：ce.set('${pathExample}', '具体的文本内容')`;
      }
      line += `\n  ⚠️ 注意：文本参数需要提供完整的文本内容，请严格按照格式要求填写`;
    } else {
      line += `\n  使用示例：ce.set('${pathExample}', ...)`;
    }
    
    if (boundEntities.length > 0) {
      line += `\n  绑定实体：${boundEntities.join(', ')}`;
    }
    
    return line;
  });

  const paramBlock = paramLines.length
    ? `当前可用的参数（请严格按照路径格式使用）：

${paramLines.join("\n\n")}`
    : "当前角色卡未定义任何参数。";

  // ========== P0 & P1: 构建当前状态摘要 ==========
  
  // 检测 cast 是否为空（需要在使用前定义）
  const castIsEmpty = currentState &&
    (!currentState.cast ||
     ((!currentState.cast.focus || currentState.cast.focus.length === 0) &&
      (!currentState.cast.presentSupporting || currentState.cast.presentSupporting.length === 0) &&
      (!currentState.cast.offstageRelated || currentState.cast.offstageRelated.length === 0)));
  
  // P0.1: 当前参数值
  const currentValuesLines = [];
  if (currentState && currentState.variables && activeParams.length > 0) {
    for (const param of activeParams) {
      const scope = param.scope || "character";
      const bucket = currentState.variables[scope];
      if (!bucket || typeof bucket !== "object") continue;
      
      // 查找绑定了此参数的实体
      const boundEntities = entities.filter(e =>
        Array.isArray(e.parameterNames) && e.parameterNames.includes(param.name)
      );
      
      // 根据 scope 构建路径并获取值
      if (scope === "character" || scope === "relationship") {
        for (const entity of boundEntities) {
          const subjectBucket = bucket[entity.name];
          if (!subjectBucket || typeof subjectBucket !== "object") continue;
          
          const value = subjectBucket[param.name] ?? subjectBucket[param.id];
          if (value !== undefined) {
            if (scope === "relationship" && typeof value === "object") {
              // relationship scope: 显示所有目标
              for (const [targetName, targetValue] of Object.entries(value)) {
                currentValuesLines.push(`  - ${entity.name}.${param.name}.${targetName}: ${JSON.stringify(targetValue)}`);
              }
            } else {
              currentValuesLines.push(`  - ${entity.name}.${param.name}: ${JSON.stringify(value)}`);
            }
          }
        }
      } else if (scope === "scene" || scope === "global") {
        const value = bucket[param.name] ?? bucket[param.id];
        if (value !== undefined) {
          currentValuesLines.push(`  - ${param.name}: ${JSON.stringify(value)}`);
        }
      }
    }
  }
  
  const currentValuesBlock = currentValuesLines.length > 0
    ? `当前参数状态：\n${currentValuesLines.join('\n')}`
    : "";
  
  // P0.2: 场景状态（包括地点Cast）
  let sceneStateBlock = "";
  if (useSceneAndCast && currentState) {
    const sceneLines = [];
    
    // 场景元数据
    if (currentState.scene) {
      const locationHint = currentState.scene.locationHint || "未设置";
      const sceneTags = Array.isArray(currentState.scene.sceneTags) && currentState.scene.sceneTags.length > 0
        ? currentState.scene.sceneTags.map(t => `"${t}"`).join(', ')
        : "无";
      sceneLines.push(`  - 地点提示：${locationHint}`);
      sceneLines.push(`  - 场景标签：[${sceneTags}]`);
    }
    
    // 地点Cast状态
    if (currentState.locationCast) {
      const currentLoc = currentState.locationCast.current || "未设置";
      const candidateLocs = Array.isArray(currentState.locationCast.candidate) && currentState.locationCast.candidate.length > 0
        ? currentState.locationCast.candidate.join(', ')
        : "无";
      sceneLines.push(`  - 当前地点：${currentLoc}`);
      sceneLines.push(`  - 候选地点：${candidateLocs}`);
    }
    
    if (sceneLines.length > 0) {
      sceneStateBlock = `当前场景状态：\n${sceneLines.join('\n')}`;
    }
  }
  
  // P0.3: Cast 状态
  let castStateBlock = "";
  if (useSceneAndCast && currentState && currentState.cast && !castIsEmpty) {
    const focus = Array.isArray(currentState.cast.focus) && currentState.cast.focus.length > 0
      ? currentState.cast.focus.join(', ')
      : "无";
    const supporting = Array.isArray(currentState.cast.presentSupporting) && currentState.cast.presentSupporting.length > 0
      ? currentState.cast.presentSupporting.join(', ')
      : "无";
    const offstage = Array.isArray(currentState.cast.offstageRelated) && currentState.cast.offstageRelated.length > 0
      ? currentState.cast.offstageRelated.join(', ')
      : "无";
    castStateBlock = `当前在场角色（Cast）：
  - 主视角（focus）：${focus}
  - 在场配角（presentSupporting）：${supporting}
  - 场外相关（offstageRelated）：${offstage}`;
  }
  
  // P1.1: 可用实体列表
  const entityLines = [];
  const characterEntities = entities.filter(e => e.type === "character");
  const locationEntities = entities.filter(e => e.type === "location");
  
  if (characterEntities.length > 0) {
    entityLines.push("角色实体：");
    for (const e of characterEntities) {
      entityLines.push(`  - ${e.name}`);
    }
  }
  
  if (locationEntities.length > 0) {
    entityLines.push("地点实体（优先使用完整路径名）：");
    for (const e of locationEntities) {
      const parentLocation = e.parentLocation || "";
      if (parentLocation) {
        // 显示完整路径格式
        entityLines.push(`  - ${parentLocation}.${e.name} (或简写: ${e.name})`);
      } else {
        entityLines.push(`  - ${e.name}`);
      }
    }
  }
  
  const entitiesBlock = entityLines.length > 0
    ? `可用实体列表：\n${entityLines.join('\n')}`
    : "";
  
  // P1.2: 参数阶段信息（增强参数块）
  const paramLinesWithPhases = activeParams.map((p) => {
    const typeLabel = p.type || "unknown";
    const scope = p.scope || "character";
    const desc = p.description || "";
    
    // 查找绑定了此参数的实体
    const boundEntities = [];
    for (const entity of entities) {
      if (Array.isArray(entity.parameterNames) && entity.parameterNames.includes(p.name)) {
        boundEntities.push(entity.name);
      }
    }
    
    // 根据 scope 确定路径格式
    let pathFormat = "";
    let pathExample = "";
    let scopeDesc = "";
    
    switch (scope) {
      case "relationship":
        pathFormat = "三段路径（需要目标实体）";
        scopeDesc = "关系型参数";
        if (boundEntities.length > 0) {
          pathExample = `${boundEntities[0]}.${p.name}.{目标实体名}`;
        } else {
          pathExample = `{主体名}.${p.name}.{目标名}`;
        }
        break;
      case "character":
        pathFormat = "两段路径";
        scopeDesc = "角色自身参数";
        if (boundEntities.length > 0) {
          pathExample = `${boundEntities[0]}.${p.name}`;
        } else {
          pathExample = `{主体名}.${p.name}`;
        }
        break;
      case "scene":
        pathFormat = "单段路径";
        scopeDesc = "场景级参数";
        pathExample = p.name;
        break;
      case "global":
        pathFormat = "单段路径";
        scopeDesc = "全局参数";
        pathExample = p.name;
        break;
      default:
        pathFormat = "未知格式";
        scopeDesc = "未知作用域";
        pathExample = p.name;
    }
    
    let line = `- **${p.name}** (${typeLabel}, ${scopeDesc})`;
    if (desc) line += `\n  说明：${desc}`;
    line += `\n  路径格式：${pathFormat}`;
    
    // 为文本类型参数添加详细的格式说明
    if (p.type === "text") {
      const textHint = p.textHint || "";
      if (textHint) {
        line += `\n  格式要求：${textHint}`;
        line += `\n  使用示例：ce.set('${pathExample}', '${textHint}')`;
      } else {
        line += `\n  使用示例：ce.set('${pathExample}', '具体的文本内容')`;
      }
      line += `\n  ⚠️ 注意：文本参数需要提供完整的文本内容，而非增量修改`;
    } else if (p.type === "array") {
      // 为数组类型参数添加详细的操作说明
      const arrayConfig = p.arrayConfig || {};
      const itemType = arrayConfig.itemType || "string";
      const maxLength = arrayConfig.maxLength;
      
      line += `\n  数组元素类型：${itemType}`;
      if (maxLength) {
        line += `\n  最大长度：${maxLength}`;
      }
      
      line += `\n  支持的操作（详见下方"参数类型操作规则"）：`;
      line += `\n    * add_item: 添加元素`;
      
      // 根据元素类型提供更精确的示例
      if (itemType === "string") {
        line += `\n      示例：ce.set('${pathExample}', 'add_item', '"新文本项"')`;
      } else if (itemType === "number") {
        line += `\n      示例：ce.set('${pathExample}', 'add_item', '42')`;
      } else if (itemType === "boolean") {
        line += `\n      示例：ce.set('${pathExample}', 'add_item', 'true')`;
      } else if (itemType === "object") {
        line += `\n      示例：ce.set('${pathExample}', 'add_item', '{"name":"物品","quantity":1}')`;
      }
      
      line += `\n    * remove_at:索引: 删除指定位置元素`;
      line += `\n      示例：ce.set('${pathExample}', 'remove_at:0')`;
      line += `\n    * remove_where: 按条件删除`;
      
      if (itemType === "object") {
        line += `\n      示例：ce.set('${pathExample}', 'remove_where', '{"field":"name","op":"equals","value":"物品"}')`;
      } else {
        line += `\n      示例：ce.set('${pathExample}', 'remove_where', '{"op":"equals","value":"目标值"}')`;
      }
      
      line += `\n    * update_at:索引: 更新指定位置元素`;
      line += `\n    * clear: 清空数组`;
      line += `\n    * set: 替换整个数组`;
      line += `\n  ⚠️ 注意：数组操作的值必须使用JSON格式，详见下方操作规则`;
    } else {
      line += `\n  使用示例：ce.set('${pathExample}', ...)`;
    }
    
    if (boundEntities.length > 0) {
      line += `\n  绑定实体：${boundEntities.join(', ')}`;
    }
    
    // P1.2: 添加阶段信息
    if (p.type === "number" && Array.isArray(p.phases) && p.phases.length > 0) {
      line += `\n  阶段划分：`;
      for (const phase of p.phases) {
        if (!phase || !phase.name) continue;
        const range = Array.isArray(phase.range) && phase.range.length === 2
          ? `${phase.range[0]}-${phase.range[1]}`
          : "未定义范围";
        line += `\n    * ${phase.name}（${range}）`;
      }
    } else if (p.type === "enum" && Array.isArray(p.enumValues) && p.enumValues.length > 0) {
      line += `\n  可选值：${p.enumValues.join(', ')}`;
    }
    
    return line;
  });
  
  const enhancedParamBlock = paramLinesWithPhases.length
    ? `当前可用的参数（请严格按照路径格式使用）：

${paramLinesWithPhases.join("\n\n")}`
    : "当前角色卡未定义任何参数。";
  
  // 组合所有状态块
  const stateBlocks = [
    currentValuesBlock,
    sceneStateBlock,
    castStateBlock,
    entitiesBlock
  ].filter(b => b.length > 0);
  
  const currentStateSection = stateBlocks.length > 0
    ? `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n【当前状态摘要】\n\n${stateBlocks.join('\n\n')}\n`
    : "";

  // 动态构建任务说明
  const tasks = [];
  tasks.push("1. **分析对话内容**：仔细阅读上一轮NPC回复和本轮玩家输入，理解当前剧情发展和角色互动。");
  
  if (activeParams.length > 0) {
    tasks.push(`2. **评估参数变化**：
   - 根据上述参数列表，判断哪些参数在本轮对话中受到影响
   - 在 <CE_UpdateState> 块中使用 ce.set() 格式表达变化
   - **严格遵守每个参数的路径格式**（单段/两段/三段）
   
   **参数类型操作规则：**
   
   a) **数值类参数**：使用符号化操作
      - 符号操作：up_small, up_medium, up_large, down_small, down_medium, down_large
      - 示例：ce.set('小樱.好感度', 'up_medium', '因为玩家的温柔话语')
   
   b) **枚举类参数**：使用 next/prev 或直接设置枚举值
      - 示例：ce.set('小樱.关系阶段', 'next') 或 ce.set('小樱.关系阶段', '暧昧期')
   
   c) **布尔类参数**：直接设置 true 或 false
      - 示例：ce.set('小樱.是否知道真相', 'true')
   
   d) **文本类参数**：直接设置完整的文本内容
      - **核心原则：文本参数用于存储单一的、完整的文本描述**
      - **与数组的区别：文本参数存储的是一段连续的文字，而非多个独立项目**
      - **每次设置都会完全替换原有内容，不支持增量修改**
      - 典型用途示例：
        * 场景氛围描述：ce.set('当前氛围', '紧张而压抑的气氛弥漫在房间里，每个人都小心翼翼地避免眼神接触')
        * 任务描述：ce.set('艾莉娅.当前任务', '前往图书馆调查古老文献中关于封印魔法的记载')
        * 备注说明：ce.set('艾莉娅.特殊状态备注', '因为昨晚的魔法实验失败，目前魔力恢复缓慢')
        * 剧情标记：ce.set('主线进度', '已完成第一章"觉醒"，正在进行第二章"试炼"的前置任务')
      - ⚠️ 重要提示：
        * 每次修改都需要提供完整的新文本内容，而非追加或部分修改
        * 文本参数适合存储需要完整表达的描述性内容
   
   e) **数组类参数**：使用专门的数组操作符进行增量操作
      - **核心原则：数组用于存储多个独立的项目，支持对单个项目进行增删改操作**
      - **与文本的区别：数组存储的是多个独立元素的集合，每个元素可以单独操作**
      - **数组元素类型说明：**
        * string类型数组：存储简单的字符串列表
          示例：["苹果", "香蕉", "橙子"]
        * number类型数组：存储数值列表
          示例：[10, 20, 30]
        * boolean类型数组：存储布尔值列表
          示例：[true, false, true]
        * object类型数组：存储复杂对象列表（如物品、任务等）
          示例：[{"name":"治疗药水","quantity":3}, {"name":"魔法卷轴","quantity":1}]
      
      - **支持的操作详解：**
        
        1) **add_item**：添加单个元素到数组末尾
           - 用途：向数组中新增一个项目
           - 格式：ce.set('路径', 'add_item', JSON值)
           - string数组示例：
             ce.set('艾莉娅.收集的线索', 'add_item', '"神秘的钥匙"')
           - number数组示例：
             ce.set('玩家.幸运数字', 'add_item', '7')
           - boolean数组示例：
             ce.set('任务.完成状态', 'add_item', 'true')
           - object数组示例：
             ce.set('艾莉娅.背包', 'add_item', '{"name":"治疗药水","quantity":3,"rarity":"common"}')
        
        2) **remove_at:索引**：删除指定位置的元素
           - 用途：移除数组中特定位置的项目（索引从0开始）
           - 格式：ce.set('路径', 'remove_at:索引')
           - 示例：
             ce.set('艾莉娅.背包', 'remove_at:0')  // 删除第一个物品
             ce.set('艾莉娅.背包', 'remove_at:2')  // 删除第三个物品
        
        3) **remove_where**：按条件删除元素
           - 用途：删除所有满足特定条件的项目
           - 格式：ce.set('路径', 'remove_where', JSON条件对象)
           - 条件对象格式：{"field":"字段名","op":"操作符","value":"匹配值"}
           - 支持的操作符：
             * equals / ==：字段值等于指定值
             * not_equals / !=：字段值不等于指定值
             * contains：字段值包含指定值（用于字符串或数组）
             * not_contains：字段值不包含指定值
             * gt / >：字段值大于指定值（用于数字）
             * gte / >=：字段值大于等于指定值
             * lt / <：字段值小于指定值
             * lte / <=：字段值小于等于指定值
           - object数组示例：
             ce.set('艾莉娅.背包', 'remove_where', '{"field":"name","op":"equals","value":"治疗药水"}')
             ce.set('艾莉娅.背包', 'remove_where', '{"field":"quantity","op":"<=","value":"0"}')
           - string数组示例（删除特定字符串）：
             ce.set('艾莉娅.收集的线索', 'remove_where', '{"op":"equals","value":"过时的线索"}')
           - boolean数组示例（删除所有false值）：
             ce.set('任务.完成状态', 'remove_where', '{"op":"equals","value":"false"}')
        
        4) **update_at:索引**：更新指定位置的元素
           - 用途：修改数组中特定位置的项目内容
           - 格式：ce.set('路径', 'update_at:索引', JSON新值)
           - object数组示例：
             ce.set('艾莉娅.背包', 'update_at:0', '{"name":"高级治疗药水","quantity":5,"rarity":"rare"}')
           - string数组示例：
             ce.set('艾莉娅.收集的线索', 'update_at:1', '"更新后的线索描述"')
           - number数组示例：
             ce.set('玩家.幸运数字', 'update_at:0', '99')
        
        5) **clear**：清空整个数组
           - 用途：删除数组中的所有元素
           - 格式：ce.set('路径', 'clear')
           - 示例：
             ce.set('艾莉娅.背包', 'clear')  // 清空背包
        
        6) **set**：直接设置整个数组
           - 用途：一次性替换整个数组内容
           - 格式：ce.set('路径', 'set', JSON数组)
           - 注意：这会完全替换原有数组，请谨慎使用
           - object数组示例：
             ce.set('艾莉娅.背包', 'set', '[{"name":"物品1","quantity":1},{"name":"物品2","quantity":2}]')
           - string数组示例：
             ce.set('艾莉娅.收集的线索', 'set', '["线索1","线索2","线索3"]')
           - number数组示例：
             ce.set('玩家.幸运数字', 'set', '[7, 13, 21]')
           - boolean数组示例：
             ce.set('任务.完成状态', 'set', '[true, false, true]')
      
      - **⚠️ 重要注意事项：**
        * 所有数组操作的值参数必须使用有效的JSON格式
        * 对于string类型的值，JSON格式需要用双引号包裹：'"文本内容"'
        * 对于object类型的值，JSON格式需要用花括号：'{"key":"value"}'
        * 对于数组类型的值，JSON格式需要用方括号：'["item1","item2"]'
        * 对于number和boolean类型，直接写值即可：'123' 或 'true'
      
      - **💡 最佳实践建议：**
        * 优先使用增量操作（add_item/remove_at/update_at等）而非set整个数组
        * 使用remove_where时，确保条件对象的field字段与数组元素的实际字段名匹配
        * 对于object数组，建议在itemSchema中明确定义对象结构
        * 注意数组索引从0开始，remove_at:0表示删除第一个元素
   
   f) **【特别重要】短期情绪/短期意图参数**（文本类型）：
      - 这些是特殊的文本类参数，用于描述角色的临时心理状态
      - 必须使用**描述性的一句话或简短说明**，而非简单词汇
      - ✅ 正确示例：
        * ce.set('艾莉娅.短期情绪', '因为玩家刚才的话感到愤怒和委屈，觉得对方完全不理解自己的感受')
        * ce.set('艾莉娅.短期意图', '想用别扭的方式表达关心，但又不想显得太在意，准备用反话来掩饰真实想法')
      - ❌ 错误示例：
        * ce.set('艾莉娅.短期情绪', '愤怒')  // 太简单，缺乏细节
        * ce.set('艾莉娅.短期意图', '道歉')  // 太笼统，缺乏具体说明
      - 短期情绪应包含：情绪原因、具体感受、心理状态的细腻描述
      - 短期意图应包含：行动倾向、目的、预期效果的完整说明`);
  }

  // 场景与cast管理（仅在启用时出现）
  if (useSceneAndCast) {
    if (castIsEmpty) {
      // Cast 为空时的特殊提示
      tasks.push(`${tasks.length + 1}. **【重要】初始化场景与角色**：
   - **当前 cast 为空，这是对话的开始阶段**
   - 请根据上一轮 NPC 回复（greeting）的内容，在 <CE_UpdateScene> 块中设置：
     * location_hint：当前场景的地点（如"大学图书馆"、"学生会室"等）
     * scene_tags：场景标签（如["日常", "初次见面"]）
   - 在 <CastIntent> 中添加当前在场的角色：
     * 至少包括 NPC 自己和玩家（{{user}}）
     * 如果 greeting 中提到其他在场角色，也应加入
     * **使用 preferredLayer 指定角色层级**（见下方说明）
   - 这是**必须完成的初始化任务**，请务必输出 <CE_UpdateScene> 块`);
    } else {
      tasks.push(`${tasks.length + 1}. **场景与角色进出场**：
   - 如果对话中涉及场景变化，在 <CE_UpdateScene> 块中更新 location_hint 和 scene_tags
   - 如果有新角色出现或离开，在 <CastIntent> 中说明
   - **使用 preferredLayer 指定新进场角色的层级**（见下方说明）`);
    }
  }

  // 世界观RAG（仅在启用时出现）
  if (useWorldRag) {
    tasks.push(`${tasks.length + 1}. **世界观检索需求**：
   - 如果对话涉及需要查询的世界观设定或历史事件，在 <WorldContextIntent> 块中说明`);
  }

  // 构建 XML 格式的输出示例
  const xmlExamples = [];
  
  // 状态更新示例
  if (activeParams.length > 0) {
    xmlExamples.push(`<CE_UpdateState>
  <Analysis>
    - 简要分析本轮对话对参数的影响
    - 可以多行说明你的推理过程
  </Analysis>

  <NeedChange>
    - 参数：需要变化的参数路径
  </NeedChange>

  <VarChange>
    ce.set('{路径}', '{操作或值}', '{可选说明}')
    // 请参考上面的参数列表，使用正确的路径格式和操作方式
    // 数值类：up_small, up_medium, up_large, down_small, down_medium, down_large
    // 枚举类：next, prev, 或直接设置枚举值
    // 布尔类：true, false
    // 文本类：完整的文本内容（一段连续的描述性文字，非列表）
    // 数组类：add_item（JSON值）, remove_at:索引, remove_where（JSON条件）,
    //         update_at:索引（JSON值）, clear, set（JSON数组）
    // 注意区分：文本类用于单一描述，数组类用于多个独立项目的集合
  </VarChange>
</CE_UpdateState>`);
  }

  // 场景更新示例
  if (useSceneAndCast) {
    xmlExamples.push(`<CE_UpdateScene>
  <Analysis>
    - 简要分析场景或进出场的变化
  </Analysis>

  <LocationCastIntent>
    <setCurrent>
      - 地点：{地点名或完整路径，如"京都大学.图书馆"}
    </setCurrent>
    <addCandidate>
      - 地点：{候选地点名}
    </addCandidate>
    <removeCandidate>
      - 地点：{移除的候选地点名}
    </removeCandidate>
  </LocationCastIntent>

  <CastIntent>
    <enter>
      - 角色：{进场实体名}（可选说明）
        preferredLayer: focus | presentSupporting | offstageRelated
    </enter>
    <leave>
      - 角色：{离场实体名}（可选说明）
    </leave>
  </CastIntent>

  <SceneMeta>
    - location_hint: "{场景地点描述}"
    - scene_tags: ["{标签}", "{标签}"]
  </SceneMeta>
</CE_UpdateScene>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【Cast 分层说明】

## 角色Cast（三层结构）

角色在场景中分为三个层级，决定了提示注入的详细程度：

1. **focus（主视角/主发言角色）**
   - 完整 Baseline 人设
   - 所有变量解析后的提示片段（tone、inner_state、sex_behavior 等）
   - 当前短期情绪与短期意图
   - 适用于：本轮主要互动的 NPC、玩家
   - 数量限制：通常 3-5 个

2. **presentSupporting（在场配角）**
   - 1-3 句人设摘要（summaryForSupporting）
   - 关键标签列表（tagsForSupporting）
   - 适用于：当前场景在场但不是主要发言者的角色
   - 数量限制：通常 5-10 个

3. **offstageRelated（场外相关角色）**
   - 仅一句话说明（descForOffstage）
   - 格式："名字 —— 关系标签 + 一句话说明"
   - 适用于：不在场但与主角色有重要关系的角色
   - 数量限制：通常 10-15 个

**使用建议：**
- 主要对话角色 → focus
- 在场但不主要发言 → presentSupporting
- 不在场但可能被提及 → offstageRelated
- 如果不指定 preferredLayer，系统会默认尝试加入 focus 层

## 地点Cast（两层结构）

地点分为两个层级：

1. **current（当前地点）**
   - 完整 baseinfo 和 advanceinfo
   - 只能有一个当前地点
   - **优先使用完整路径名**，如"京都大学.图书馆"而非仅"图书馆"
   - 完整路径能更清晰地表达地点的层级关系

2. **candidate（候选地点）**
   - 仅名称 + 简短提示（candidateHint）
   - 可以有多个候选地点
   - 同样**优先使用完整路径名**

**地点命名规范：**
- ✅ 推荐：使用完整路径 "父地点.子地点"，如"京都大学.图书馆"、"东京.涩谷区.咖啡厅"
- ⚠️ 可接受：单独地点名，如"图书馆"（仅当该地点无父级或上下文明确时）
- 完整路径能避免地点混淆，提高模型理解准确度`);
  }

  // 世界观检索示例
  if (useWorldRag) {
    xmlExamples.push(`<WorldContextIntent>
  <Analysis>
    - 为什么需要检索相关设定或历史
  </Analysis>

  <Queries>
    - query: "{检索查询描述}"
      collections: ["{设定文件名}"]
      importance: "must_have 或 nice_to_have"
  </Queries>
</WorldContextIntent>`);
  }

  const quietPrompt = `
你是一个"角色引擎状态解析器"，负责根据上一轮 NPC 回复与本轮玩家输入，推断本轮对变量${useSceneAndCast ? '与场景' : ''}的符号化变更意图。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【上一轮 NPC 回复】
${lastAiText || "(无)"}

【本轮玩家输入】
${currentUserText || "(无)"}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${enhancedParamBlock}
${currentStateSection}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【你的任务】

${tasks.join('\n\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【输出格式】

请使用 XML 块格式输出你的分析结果：

${xmlExamples.join('\n\n')}

【重要说明】
- 你可以在 <Analysis> 块中自由表达你的分析思考，这部分会被保留用于调试
- 在 <VarChange> 块中使用 ce.set() 格式，**必须严格遵守上述参数列表中的路径格式**
- 只根据实际对话内容和上述参数定义进行分析，不要臆测不存在的参数
- 如果某个块不需要，可以完全省略
- XML 块可以和其他文本混合输出，系统会自动提取需要的部分
- 每个 ce.set() 调用必须独占一行
`.trim();

  return {
    quietPrompt
  };
}

/**
 * 使用内置 callGenerate 服务进行解析调用
 * - 完全独立的调用，不污染主 chat
 * - 不触发 MESSAGE_RECEIVED 事件
 * - 直接返回解析结果
 *
 * @param {{quietPrompt: string}} parseInput
 * @returns {Promise<string>}
 */
export async function callParseModel(parseInput) {
  try {
    const settings = extension_settings[EXT_ID] || {};
    const useStreaming = settings.parseStreaming !== false;
    
    // 获取解析模型API设置
    const parseApiSettings = settings.parseApiSettings || {
      useCustomApi: false,
      apiConnection: {
        provider: '',
        model: '',
        apiKey: '',
        baseURL: '',
        customEndpoint: ''
      },
      parameters: {
        temperature: { enabled: true, value: 0.6 },
        maxTokens: { enabled: true, value: 8192 },
        topP: { enabled: false, value: 1.0 },
        topK: { enabled: false, value: 0 },
        frequencyPenalty: { enabled: false, value: 0 },
        presencePenalty: { enabled: false, value: 0 },
        repetitionPenalty: { enabled: false, value: 1.0 }
      }
    };

    // eslint-disable-next-line no-console
    console.debug("[CharacterEngine] 解析API设置:", {
      useCustomApi: parseApiSettings.useCustomApi,
      provider: parseApiSettings.apiConnection?.provider,
      model: parseApiSettings.apiConnection?.model,
      hasApiKey: !!parseApiSettings.apiConnection?.apiKey,
      hasBaseURL: !!parseApiSettings.apiConnection?.baseURL
    });

    // 根据设置决定API配置
    let apiConfig;
    if (parseApiSettings.useCustomApi) {
      // 使用自定义API设置
      const conn = parseApiSettings.apiConnection || {};
      const params = parseApiSettings.parameters || {};
      
      // eslint-disable-next-line no-console
      console.debug("[CharacterEngine] 解析API设置 - 原始配置:", {
        provider: conn.provider,
        model: conn.model,
        hasApiKey: !!conn.apiKey,
        hasBaseURL: !!conn.baseURL,
        hasCustomEndpoint: !!conn.customEndpoint
      });
      
      // 检查是否为"继承+覆写"模式（provider为空或为'current'）
      const isInheritMode = !conn.provider || conn.provider === '' || conn.provider === 'current';
      
      if (isInheritMode) {
        // 继承模式：使用当前API设置，但可以覆写某些参数
        // 注意：在继承模式下，我们只覆写明确指定的参数
        const overrides = {};
        
        // 如果指定了模型，覆写模型
        if (conn.model && conn.model !== '') {
          overrides.model = conn.model;
        }
        
        // 注意：在继承模式下，通常不需要覆写API密钥和Base URL
        // 因为这些会从当前API设置中自动继承
        // 只有在用户明确填写了这些字段时才覆写
        if (conn.apiKey && conn.apiKey !== '') {
          overrides.apiKey = conn.apiKey;
        }
        
        if (conn.baseURL && conn.baseURL !== '') {
          overrides.baseURL = conn.baseURL;
        }
        
        // 添加采样参数覆写
        if (params.temperature?.enabled) {
          overrides.temperature = params.temperature.value;
        }
        if (params.maxTokens?.enabled) {
          overrides.maxTokens = params.maxTokens.value;
        }
        if (params.topP?.enabled) {
          overrides.topP = params.topP.value;
        }
        if (params.topK?.enabled) {
          overrides.topK = params.topK.value;
        }
        if (params.frequencyPenalty?.enabled) {
          overrides.frequencyPenalty = params.frequencyPenalty.value;
        }
        if (params.presencePenalty?.enabled) {
          overrides.presencePenalty = params.presencePenalty.value;
        }
        if (params.repetitionPenalty?.enabled) {
          overrides.repetitionPenalty = params.repetitionPenalty.value;
        }
        
        apiConfig = {
          inherit: true,
          overrides: overrides
        };
        
        // eslint-disable-next-line no-console
        console.debug("[CharacterEngine] 使用继承+覆写模式:", {
          inherit: true,
          overridesCount: Object.keys(overrides).length,
          overrides: overrides
        });
      } else {
        // 完全自定义模式：不继承当前API设置
        apiConfig = {
          inherit: false
        };
        
        // 添加提供商和模型
        if (conn.provider && conn.provider !== '') {
          apiConfig.provider = conn.provider;
        }
        if (conn.model && conn.model !== '') {
          apiConfig.model = conn.model;
        }
        
        // 添加API密钥
        if (conn.apiKey && conn.apiKey !== '') {
          apiConfig.apiKey = conn.apiKey;
        }
        
        // 添加Base URL或自定义端点
        if (conn.baseURL && conn.baseURL !== '') {
          apiConfig.baseURL = conn.baseURL;
        }
        if (conn.customEndpoint && conn.customEndpoint !== '') {
          apiConfig.customEndpoint = conn.customEndpoint;
        }
        
        // 构建参数覆写对象
        const overrides = {};
        if (params.temperature?.enabled) {
          overrides.temperature = params.temperature.value;
        }
        if (params.maxTokens?.enabled) {
          overrides.maxTokens = params.maxTokens.value;
        }
        if (params.topP?.enabled) {
          overrides.topP = params.topP.value;
        }
        if (params.topK?.enabled) {
          overrides.topK = params.topK.value;
        }
        if (params.frequencyPenalty?.enabled) {
          overrides.frequencyPenalty = params.frequencyPenalty.value;
        }
        if (params.presencePenalty?.enabled) {
          overrides.presencePenalty = params.presencePenalty.value;
        }
        if (params.repetitionPenalty?.enabled) {
          overrides.repetitionPenalty = params.repetitionPenalty.value;
        }
        
        // 只有在有覆写参数时才添加 overrides
        if (Object.keys(overrides).length > 0) {
          apiConfig.overrides = overrides;
        }
        
        // eslint-disable-next-line no-console
        console.debug("[CharacterEngine] 使用完全自定义模式:", apiConfig);
      }
    } else {
      // 继承当前API设置，但覆写部分参数
      apiConfig = {
        inherit: true,
        overrides: {
          temperature: 0.6,  // 解析任务用低温度
          maxTokens: 8192   // 允许较长输出
        }
      };
      
      // eslint-disable-next-line no-console
      console.debug("[CharacterEngine] 使用继承API配置（当前API设置）");
    }
    
    // eslint-disable-next-line no-console
    console.debug("[CharacterEngine] 最终API配置:", apiConfig);

    // 根据设置构建 components.list
    const componentsList = [];
    
    if (parseApiSettings.usePresetPrompts) {
      // 启用预设提示词基座
      componentsList.push('ALL_PREON');
      
      // 禁用不需要的组件（对话历史、角色描述、人设描述）
      componentsList.push({
        'chatHistory': { disable: true }
      });
      componentsList.push({
        'charDescription': { disable: true }
      });
      componentsList.push({
        'personaDescription': { disable: true }
      });
      
      // 根据设置决定是否禁用世界书
      if (!parseApiSettings.injectWorldInfo) {
        componentsList.push({
          'worldInfoBefore': { disable: true }
        });
        componentsList.push({
          'worldInfoAfter': { disable: true }
        });
      }
      
      // eslint-disable-next-line no-console
      console.debug("[CharacterEngine] 解析模型使用预设提示词", {
        usePresetPrompts: true,
        injectWorldInfo: parseApiSettings.injectWorldInfo
      });
    }
    
    // 添加解析提示词（始终在最前面）
    componentsList.push({
      role: 'system',
      content: parseInput.quietPrompt,
      position: 'BEFORE_PROMPT'
    });
    
    // 构造 callGenerate 选项
    const options = {
      components: {
        list: componentsList
      },
      userInput: '请分析上文内容',
      streaming: {
        enabled: useStreaming,
        onChunk: useStreaming ? (chunk, accumulated) => {
          // 流式输出时的实时回调（可选，用于调试）
          if (settings.debugPanelEnabled) {
            // eslint-disable-next-line no-console
            console.debug("[CharacterEngine] 解析流式输出", {
              chunkLength: chunk.length,
              totalLength: accumulated.length
            });
          }
        } : undefined
      },
      api: apiConfig,
      session: { id: 'ce1' },
      debug: { enabled: false }
    };

    const service = getCallGenerateService();
    const requestId = `parse-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await service.handleGenerateRequest(options, requestId, window);

    if (result && result.success) {
      // eslint-disable-next-line no-console
      console.debug("[CharacterEngine] 解析调用成功", {
        streaming: useStreaming,
        model: result.metadata?.model,
        duration: result.metadata?.duration
      });
      return result.result || "";
    }
    
    // eslint-disable-next-line no-console
    console.warn("[CharacterEngine] 解析调用失败", result);
    return "";
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[CharacterEngine] 解析调用失败", err);
    return "";
  }
}