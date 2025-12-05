// 实体定义模型：角色 / 地点 / 其他实体
// 本模块仅包含 JSDoc 类型定义与设计说明，不依赖 SillyTavern 宿主。

/**
 * 实体类型：
 * - "character"：角色实体，用于 cast 管理与角色提示块（<Character_n>）。
 * - "location"：地点实体，支持嵌套层级，用于场景与地点提示块（<Location_n>）。
 * - "other"：其他实体，仅用于补齐 ownerName 所需的占位实体，不参与结构关联。
 *
 * @typedef {"character"|"location"|"other"} CeEntityType
 */

/**
 * 实体定义（配置层）。
 *
 * 设计要点：
 * - name：
 *   - 实体对作者与 LLM 展示的主名称；
 *   - 提示条目中的 ownerName 与此字段对齐。
 * - id：
 *   - 可选的内部 ID，用于将来做稳定引用与运行时映射；
 *   - 当前阶段实体间的引用一律使用 name 进行自然语言对齐。
 * - type：
 *   - "character" / "location" / "other"。
 * - baseinfo：
 *   - 实体的基础提示词，对应主对话模型提示中的 baseinfo 字段；
 *   - 表达该实体相对稳定的资料、人设或地点特征。
 *
 * 结构与关联（严格受类型约束）：
 *
 * - 对于 type === "location"（地点实体）：
 *   - childrenNames：
 *     - 子地点名称列表，用于表达地点层级嵌套；
 *     - 例如："东京" 的 childrenNames 中可以包含 "爱知学院"。
 *   - characters：
 *     - 在该地点中「常见出现的角色名称列表」（场景角色），用于 cast 管理时为解析模型提供候选角色。
 *
 * - 对于 type === "character"（角色实体）：
 *   - locations：
 *     - 该角色常见出现的地点名称或路径列表，例如 "东京.爱知学院.3年E班"。
 *
 * - 对于 type === "other"（其他实体）：
 *   - 不参与层级嵌套与结构关联；
 *   - 不使用 childrenNames / locations / characters。
 *
 * 重要约束：
 * - 仅允许以下三类结构/关联：
 *   1) 地点 → 子地点（location.childrenNames）
 *   2) 地点 → 场景角色（location.characters）
 *   3) 角色 → 常见地点（character.locations）
 * - 除上述「地点下角色」这一特殊关系外，不存在其他实体间关联。
 * - 所有跨实体引用均通过 name 完成，自然语言对齐，不暴露内部 ID。
 *
 * @typedef {Object} CeEntityDefinition
 * @property {string} name
 * @property {string} [id]
 * @property {CeEntityType} type
 * @property {string} [baseinfo]
 * @property {string[]} [childrenNames]
 * @property {string[]} [locations]
 * @property {string[]} [characters]
 * @property {string[]} [parameterNames] // 该实体绑定的参数名列表（与 CeParameterDefinition.name 对齐），用于初始参数设置与状态观察
 *
 * Cast 分层加载字段（仅对 type === "character" 有效）：
 * @property {string} [summaryForSupporting] // presentSupporting 层使用的 1-3 句人设摘要
 * @property {string[]} [tagsForSupporting] // presentSupporting 层使用的关键标签列表
 * @property {string} [descForOffstage] // offstageRelated 层使用的一句话说明
 */

/**
 * 规范化实体列表：合并「角色卡配置实体 + 运行时实体」，并基于 ownerName 列表补全缺失实体。
 *
 * 设计目标：
 * - 配置层（CeEntityDefinition[]）是作者显式定义的实体；
 * - 运行时实体（EngineState.entitiesRuntime）由解析模型通过 CeEntityOp 持续补充与覆盖；
 * - ownerNames 来自提示条目 / prompt bundle，用于确保所有有提示归属的实体都在集合中有一条记录；
 * - 统一执行以下规则：
 *   - 合并同名实体（配置优先，其次运行时），列表字段去重；
 *   - 按类型清理不合法结构字段；
 *   - 确保 location.characters ↔ character.locations 对称；
 *   - 对所有 ownerName 自动补全缺失实体（类型默认为 "other"）；
 *   - 自动注入 {{user}} 特殊实体（如果提供了 userEntityData）。
 *
 * 注意：本函数仅负责数据归一，不触及 UI，也不依赖 SillyTavern 宿主。
 *
 * @param {CeEntityDefinition[]|undefined|null} configEntities
 * @param {Object.<string, import("./engine-state.js").CeEntityRuntime>|undefined|null} runtimeEntitiesMap
 * @param {string[]|undefined|null} ownerNames
 * @param {Object|undefined|null} userEntityData - {{user}} 实体数据 {name: string, baseinfo: string}
 * @param {import("./variables.js").CeParameterDefinition[]|undefined|null} parameterDefs - 参数定义列表，用于自动绑定短期参数
 * @returns {CeEntityDefinition[]}
 */
export function buildNormalizedEntities(configEntities, runtimeEntitiesMap, ownerNames, userEntityData, parameterDefs) {
 /** @type {Map<string, CeEntityDefinition>} */
 const byName = new Map();

 const normalizeType = (raw, fallback) => {
   if (raw === "character" || raw === "location" || raw === "other") return raw;
   if (fallback === "character" || fallback === "location" || fallback === "other") {
     return fallback;
   }
   return "other";
 };

 const mergeList = (a, b) => {
   const set = new Set();
   (a || []).forEach((x) => {
     if (typeof x === "string") {
       const trimmed = x.trim();
       if (trimmed) set.add(trimmed);
     }
   });
   (b || []).forEach((x) => {
     if (typeof x === "string") {
       const trimmed = x.trim();
       if (trimmed) set.add(trimmed);
     }
   });
   return Array.from(set);
 };

 const addOrMerge = (src) => {
   if (!src || typeof src !== "object") return;
   const name = typeof src.name === "string" ? src.name.trim() : "";
   if (!name) return;
   const existing = byName.get(name);
   const merged = {
     name,
     id: (src.id || existing?.id || "").trim(),
     type: normalizeType(src.type, existing?.type),
     baseinfo: src.baseinfo || existing?.baseinfo || "",
     childrenNames: mergeList(existing?.childrenNames, src.childrenNames),
     locations: mergeList(existing?.locations, src.locations),
     characters: mergeList(existing?.characters, src.characters),
     parameterNames: mergeList(existing?.parameterNames, src.parameterNames),
     // Cast 分层加载字段
     summaryForSupporting: src.summaryForSupporting || existing?.summaryForSupporting || "",
     tagsForSupporting: mergeList(existing?.tagsForSupporting, src.tagsForSupporting),
     descForOffstage: src.descForOffstage || existing?.descForOffstage || ""
   };
   byName.set(name, merged);
 };

 // 1) 合并角色卡配置实体
 if (Array.isArray(configEntities)) {
   configEntities.forEach(addOrMerge);
 }

 // 2) 合并运行时实体（entitiesRuntime）
 if (runtimeEntitiesMap && typeof runtimeEntitiesMap === "object") {
   Object.values(runtimeEntitiesMap).forEach((rt) => {
     if (!rt || typeof rt !== "object") return;
     addOrMerge(rt);
   });
 }

 // 3) 按类型清理不符合语义的结构字段
 for (const entity of byName.values()) {
   if (entity.type === "character") {
     entity.childrenNames = [];
     entity.characters = [];
     // 保留 Cast 分层字段
   } else if (entity.type === "location") {
     // childrenNames / characters / locations 合法：
     // - childrenNames：地点层级嵌套
     // - characters：场景角色
     // - locations：由角色引用填充形成的「反向索引」，在对称修正中使用
   } else if (entity.type === "other") {
     entity.childrenNames = [];
     entity.locations = [];
     entity.characters = [];
     // 清除 Cast 分层字段（仅角色使用）
     entity.summaryForSupporting = "";
     entity.tagsForSupporting = [];
     entity.descForOffstage = "";
   }
 }

 const ensureArrayField = (obj, key) => {
   if (!Array.isArray(obj[key])) {
     obj[key] = [];
   }
 };

 // 4) 先根据地点侧的 characters 补充角色侧的 locations
 for (const entity of byName.values()) {
   if (entity.type === "location" && Array.isArray(entity.characters)) {
     for (const charNameRaw of entity.characters) {
       const charName = String(charNameRaw || "").trim();
       if (!charName) continue;
       let charEntity = byName.get(charName);
       if (!charEntity) {
         charEntity = {
           name: charName,
           id: "",
           type: "character",
           baseinfo: "",
           childrenNames: [],
           locations: [],
           characters: []
         };
         byName.set(charName, charEntity);
       } else if (charEntity.type !== "character") {
         // 若之前是 other，则在实体层直接提升为 character，更符合语义
         charEntity.type = "character";
       }
       ensureArrayField(charEntity, "locations");
       if (!charEntity.locations.includes(entity.name)) {
         charEntity.locations.push(entity.name);
       }
     }
   }
 }

 // 5) 再根据角色侧的 locations 补充地点侧的 characters
 for (const entity of byName.values()) {
   if (entity.type === "character" && Array.isArray(entity.locations)) {
     for (const locNameRaw of entity.locations) {
       const locName = String(locNameRaw || "").trim();
       if (!locName) continue;
       let locEntity = byName.get(locName);
       if (!locEntity) {
         locEntity = {
           name: locName,
           id: "",
           type: "location",
           baseinfo: "",
           childrenNames: [],
           locations: [],
           characters: []
         };
         byName.set(locName, locEntity);
       } else if (locEntity.type !== "location") {
         // 若之前是 other，则在实体层直接提升为 location
         locEntity.type = "location";
       }
       ensureArrayField(locEntity, "characters");
       if (!locEntity.characters.includes(entity.name)) {
         locEntity.characters.push(entity.name);
       }
     }
   }
 }

 // 6) 根据 ownerName 自动补全缺失实体（默认类型为 other）
 if (Array.isArray(ownerNames)) {
   ownerNames.forEach((rawName) => {
     const name = typeof rawName === "string" ? rawName.trim() : "";
     if (!name) return;
     if (!byName.has(name)) {
       byName.set(name, {
         name,
         id: "",
         type: "other",
         baseinfo: "",
         childrenNames: [],
         locations: [],
         characters: []
       });
     }
   });
 }

 // 7) 自动注入 {{user}} 特殊实体（如果提供了 userEntityData）
 if (userEntityData && typeof userEntityData === "object") {
   const userName = typeof userEntityData.name === "string" ? userEntityData.name.trim() : "{{user}}";
   const userBaseinfo = typeof userEntityData.baseinfo === "string" ? userEntityData.baseinfo : "";
   
   // 检查是否已存在 {{user}} 实体
   let userEntity = byName.get("{{user}}");
   
   if (!userEntity) {
     // 创建新的 {{user}} 实体
     userEntity = {
       name: "{{user}}",
       id: "__user__",
       type: "character",
       baseinfo: userBaseinfo,  // 强制使用 ST Persona
       childrenNames: [],
       locations: [],  // {{user}} 没有常见地点
       characters: [],
       parameterNames: [],  // 可以绑定参数
       summaryForSupporting: "",  // {{user}} 没有分层设置
       tagsForSupporting: [],
       descForOffstage: ""
     };
     byName.set("{{user}}", userEntity);
   } else {
     // 强制更新 {{user}} 实体的关键属性，忽略旧数据
     userEntity.baseinfo = userBaseinfo;  // 强制覆盖，只使用 ST Persona
     userEntity.type = "character";  // 强制类型
     userEntity.id = "__user__";  // 强制 ID
     userEntity.locations = [];  // 清空常见地点
     userEntity.summaryForSupporting = "";  // 清空分层设置
     userEntity.tagsForSupporting = [];
     userEntity.descForOffstage = "";
     // 保留 parameterNames（允许绑定参数）
   }
 }

 // 8) 自动为所有角色实体绑定短期情绪和短期意图参数
 // 注意：{{user}} 实体不进行自动绑定
 // 只有当参数定义中存在对应参数时才自动绑定（由 card-storage.js 的 ensureDefaultParameters 控制）
 if (Array.isArray(parameterDefs) && parameterDefs.length > 0) {
   // 查找短期情绪和短期意图参数定义
   const emotionParam = parameterDefs.find(p =>
     p && (p.id === "short_term_emotion" || p.name === "短期情绪")
   );
   const intentParam = parameterDefs.find(p =>
     p && (p.id === "short_term_intent" || p.name === "短期意图")
   );

   for (const entity of byName.values()) {
     if (entity.type === "character" && entity.name !== "{{user}}") {
       // 确保 parameterNames 存在
       if (!Array.isArray(entity.parameterNames)) {
         entity.parameterNames = [];
       }
       
       // 如果参数定义存在，且实体尚未绑定，则自动绑定
       if (emotionParam) {
         const hasEmotion = entity.parameterNames.some(name =>
           name === emotionParam.name || name === emotionParam.id
         );
         if (!hasEmotion) {
           entity.parameterNames.push(emotionParam.name);
         }
       }
       
       if (intentParam) {
         const hasIntent = entity.parameterNames.some(name =>
           name === intentParam.name || name === intentParam.id
         );
         if (!hasIntent) {
           entity.parameterNames.push(intentParam.name);
         }
       }
     }
   }
 }

 return Array.from(byName.values());
}