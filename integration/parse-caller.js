// 解析调用模块：负责所有与解析模型交互的逻辑
// - 构建解析提示词（纯 XML 块格式）
// - 调用内置 callGenerate 服务
// - 处理流式/非流式输出
// - 错误处理

import { getConfigForCurrentCharacter } from "./card-storage.js";
import { extension_settings } from "../../../../extensions.js";
import { getCallGenerateService } from "../services/call-generate.js";
import { parseVariablePath } from "../core/variables.js";

const EXT_ID = "CharacterEngine";

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
    line += `\n  使用示例：ce.set('${pathExample}', ...)`;
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
  
  // P0.2: 场景状态
  let sceneStateBlock = "";
  if (useSceneAndCast && currentState && currentState.scene) {
    const locationHint = currentState.scene.locationHint || "未设置";
    const sceneTags = Array.isArray(currentState.scene.sceneTags) && currentState.scene.sceneTags.length > 0
      ? currentState.scene.sceneTags.map(t => `"${t}"`).join(', ')
      : "无";
    sceneStateBlock = `当前场景状态：
  - 地点：${locationHint}
  - 场景标签：[${sceneTags}]`;
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
    entityLines.push("地点实体：");
    for (const e of locationEntities) {
      entityLines.push(`  - ${e.name}`);
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
    line += `\n  使用示例：ce.set('${pathExample}', ...)`;
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
   - 对于数值类参数，使用符号化操作：up_small, up_medium, up_large, down_small, down_medium, down_large
   - 对于文本/标签类参数，直接设置具体值
   - **【重要】对于短期情绪/短期意图参数**：
     * 必须使用**描述性的一句话或简短说明**，而非简单词汇
     * ✅ 正确示例：ce.set('艾莉娅.短期情绪', '因为玩家刚才的话感到愤怒和委屈，觉得对方完全不理解自己的感受')
     * ❌ 错误示例：ce.set('艾莉娅.短期情绪', '愤怒')
     * 短期情绪应包含：情绪原因、具体感受、心理状态的细腻描述
     * 短期意图应包含：行动倾向、目的、预期效果的完整说明`);
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
    // 请参考上面的参数列表，使用正确的路径格式
    // 操作符号：up_small, up_medium, up_large, down_small, down_medium, down_large
    // 或直接设置值（对于文本/标签类参数）
  </VarChange>
</CE_UpdateState>`);
  }

  // 场景更新示例
  if (useSceneAndCast) {
    xmlExamples.push(`<CE_UpdateScene>
  <Analysis>
    - 简要分析场景或进出场的变化
  </Analysis>

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
- 如果不指定 preferredLayer，系统会默认尝试加入 focus 层`);
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

    // 构造 callGenerate 选项
    const options = {
      components: {
        list: [
          // 纯净的解析提示，不继承任何组件
          {
            role: 'system',
            content: parseInput.quietPrompt,
            position: 'BEFORE_PROMPT'
          }
        ]
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
      api: {
        inherit: true,
        overrides: {
          temperature: 0.6,  // 解析任务用低温度
          maxTokens: 8192   // 允许较长输出
        }
      },
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