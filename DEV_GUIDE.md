# 角色引擎 SillyTavern 插件开发说明

本文面向开发者，说明角色引擎插件在 SillyTavern（下文简称 ST）中的：

- 工程结构与模块职责
- 与 ST 宿主集成时的一些额外注意点（原官方文档未覆盖的部分）
- 当前开发进度与已实现功能
- 后续扩展建议

## 1. 工程结构总览

插件根目录：[`CharacterEngine`](CharacterEngine)

### 1.1 顶层主要文件

- [`manifest.json`](CharacterEngine/manifest.json)
  声明扩展元信息、入口脚本、样式文件以及 `generate_interceptor` 名称。

- [`index.js`](CharacterEngine/index.js) (211行)
  插件入口，**只负责初始化和注册**：
  - 初始化 `extension_settings.CharacterEngine` 默认配置
  - 加载并绑定设置面板 UI ([`settings.html`](CharacterEngine/settings.html))
  - 注册应用事件（APP_READY、MESSAGE_RECEIVED）
  - 注册全局拦截器 `ceGenerateInterceptor`（实现委托给 [`orchestration/interceptor.js`](CharacterEngine/orchestration/interceptor.js)）
  - **不包含任何业务逻辑**，所有具体实现都在专门模块中

- [`settings.html`](CharacterEngine/settings.html)  
  - 插件的设置面板 UI，插入 ST 的扩展设置区域。使用 inline drawer 形式展示一个名为「角色引擎」的折叠块。
  - 包含：
    - 基本设置（启用角色引擎 / 调试面板开关）；
    - 对话逻辑（启用提前解析 / 多角色 cast 管理开关占位）；
    - 世界观 / 历史检索（启用 RAG 的开关占位）；
    - 作者工具入口按钮：
      - 「打开当前角色参数 / 提示编辑器」；
      - 「打开参数 / 状态观察器（模拟）」。

- [`style.css`](CharacterEngine/style.css)  
  插件的基础样式，包括：
  - 设置面板微调；
  - 调试面板 / cast 标签视觉样式预留；
  - 作者工具弹窗 UI（参数/提示编辑器、状态观察器）的完整样式。

### 1.2 领域核心模块（core）

**职责**：纯数据逻辑，不依赖 SillyTavern 宿主

- [`core/engine-state.js`](CharacterEngine/core/engine-state.js)
  - 定义 `EngineState` 抽象，统一表达：
    - `variables`：通用参数桶（作者在角色卡中自定义的各种数值/布尔/枚举/标签参数），按 scope 分桶：`character` / `relationship` / `scene` / `global`；包括短期情绪/短期意图在内的所有状态，统一通过变量系统管理；
    - `scene`：场景元数据（地点 / 场景标签）；
    - `cast`：当前 cast 分层（focus / presentSupporting / offstageRelated）。
  - 提供：
    - `createInitialEngineState()`：创建初始状态；
    - `cloneEngineState()`：安全深拷贝；
    - `applyChangeSet()`：将单轮 `CeChangeSet` 应用到 EngineState（通过变量桶执行基础参数操作 + 场景标签更新 + 实体运行时更新）。

- [`core/change-set.js`](CharacterEngine/core/change-set.js)  
  - 定义 git 风格的 `CeChangeSet` 结构（`stateDelta` + `sceneDelta` + `worldIntent`）；
  - 定义参数操作 `CeVariableOp`：
    - `scope`：character / relationship / scene / global；
    - `key`：内部变量键；
    - `path`：人类可读路径（如 `"艾莉娅.好感度.林原"`，供解析与调试使用）；
    - `op`：set / add / symbolic；
    - `value` / `symbol` / `meta`：用于数值与符号操作解释；
  - `CeCastIntent` 中使用 `name` 表示角色，自然语言名字，由实体系统映射到内部 ID；
  - 提供：
    - `normalizeCeUpdateState()` / `normalizeCeUpdateScene()`：将解析模型输出规整为内部结构；
    - `composeChangeSet()`：合并 stateDelta / sceneDelta / worldIntent。

- [`core/variables.js`](CharacterEngine/core/variables.js)  
  通用参数与提示规则核心工具：

  - 类型定义（供 JS 注释与其他模块引用）：
    - `CeParameterDefinition`：参数定义（name / id / type / description / range / enumValues 等）；
    - `CePromptTypeDefinition`：提示类型（提示通道）定义；
    - `CePromptEntry`：提示条目（ownerName / promptTypeName / text / 条件）。
  - 条件表达式：
    - `CePromptRuleCondition`：基于参数名的条件（op: == / != / > / >= / < / <= / in / not_in）；
    - `matchPromptConditions()`：在给定参数快照下判断某条提示是否生效。
  - 自然语言路径解析：
    - `parseVariablePath(path)`：解析 `"艾莉娅.好感度.林原"` → subjectName / parameterName / targetName；
    - `withParsedPath(op)`：在 `CeVariableOp` 上附加 `parsedPath`，便于引擎用 name-path 对齐角色与参数。

- [`core/prompt-slots.js`](CharacterEngine/core/prompt-slots.js)  
  提示通道组合器（不再内置固定槽位名）：

  - `buildPromptBundles(entries, getValueByName)`：
    - 输入：一组 `CePromptEntry` + 一个通过参数名获取当前值的回调；
    - 输出：按 ownerName 分组、再按 `promptTypeName` 分组的提示文本组合结果：
      - 每个 `ownerName` 对应一个 PromptBundle，内部 `byPromptType` 是「提示类型名 → 拼接后的文本」。
  - 通道名称与含义完全来自作者定义，例如 `tone_to_player`、`inner_state` 等。

### 1.3 宿主集成模块（integration）

**职责**：与 SillyTavern 集成，处理数据存储、解析调用、提示构建

- [`integration/st-context.js`](CharacterEngine/integration/st-context.js)  
  - 封装 `getContext()`，对外提供：
    - `getStContext()`；
    - `getChat()`；
    - `getChatMetadata()`；
    - `saveChatMetadata()`；
    - `getExtensionSettingsRoot()` / `getExtensionSettings()` 等。
  - 集中所有对 ST 上下文对象的访问，其他模块不直接 import ST 内部脚本。

- [`integration/chat-state-storage.js`](CharacterEngine/integration/chat-state-storage.js) (465行)
  - 基于 `chatMetadata` 维护引擎的初始状态与运行时元信息
  - 将每条 AI 消息的 `CeChangeSet` 挂在消息对象上，实现 git 风格的 per-message diff
  - 提供：
    - `getOrCreateEngineMeta()` / `updateEngineMeta()`
    - `setInitialStateForChat()` / `getInitialStateFromChat()`
    - `setCheckpoint()` / `getCheckpoint()`
    - `setPendingChangeSet()` / `consumePendingChangeSet()`
    - `attachChangeSetToLastAiMessage()`
    - `rebuildEngineStateUpTo(targetIndex)`：从 S0 + checkpoint + 各消息 diff 重建任意一轮状态
    - `parseInitialCeSetFromGreetingText(text)`：从文本中解析 `ce.set("路径","op或值","可选理由")` 形式的初始参数设定
    - `applyCeInitFromGreeting(chat)`：从 greeting 消息中剥离 `<CE_Init>` 块，避免发送给 LLM

- [`integration/card-storage.js`](CharacterEngine/integration/card-storage.js)
  - 专门负责「角色卡扩展字段读写」：
    - 使用 ST 的 `writeExtensionField(characterId, key, value)` 将配置写入：
      - `character.data.extensions.CharacterEngine`；
    - `getConfigForCurrentCharacter()`：
      - 从当前角色卡读取以下字段，统一视为本引擎的「配置真源」：
        - `parameters`：参数定义列表（好感度、信任度、短期情绪等）；
        - `promptTypes`：提示类型（提示通道）定义；
        - `prompts`：提示条目；
        - `entities`：实体定义（角色 / 地点 / 其他实体，含 `parameterNames` 绑定）；
        - `initialState`：该角色卡的「基线 EngineState」快照（`variables` / `scene` / `cast` / `entitiesRuntime`），通常由「初始参数」Tab 写入；
        - `options`：角色卡级选项（例如 `disableShortTermEmotion` / `disableShortTermIntent`，对卡内所有实体生效）；
      - 若扩展字段不存在则返回一份空配置骨架（字段均为空数组或空对象），由 UI 按需填充；
    - `saveConfigForCurrentCharacter(config)`：
      - 将编辑器中的配置（含 `initialState` 与 `options`）写回当前角色卡扩展字段。

- [`integration/state-parser.js`](CharacterEngine/integration/state-parser.js) (215行)
  - 将解析模型的原始 JSON 输出规整为内部 `CeChangeSet`
  - 提供：
    - `safeParseJson()`：安全 JSON.parse
    - `normalizeParsedCePayload(raw)`：支持多种字段命名变体，规整为统一结构
    - `normalizeFromJsonText(text)`：从文本一步得到 `{ changeSet, stateDelta, sceneDelta, worldIntent }`

- [`integration/parse-caller.js`](CharacterEngine/integration/parse-caller.js) (267行) **[新增]**
  - 负责所有解析调用相关逻辑
  - 提供：
    - `buildParsePromptInput(chat)`：构建解析提示词，动态根据功能开关生成 JSON schema
    - `callParseModel(parseInput)`：调用小白X进行解析，支持流式/非流式输出
  - 特点：
    - 完全独立的调用，不污染主 chat
    - 使用小白X的 `xb1` 会话槽
    - 自动处理错误和降级

- [`integration/prompt-builder.js`](CharacterEngine/integration/prompt-builder.js) (259行) **[新增]**
  - 负责所有提示注入相关逻辑
  - 提供：
    - `buildPromptInjectionBlock(engineState)`：构建 Character_n / Location_n 提示块
    - `resolveParameterRuntimeValue(param, engineState, currentCharacterName)`：参数值解析
  - 特点：
    - 基于 EngineState 和角色卡配置生成结构化提示
    - 自动选择需要注入的角色和地点实体
    - 支持提示类型 description 前置

### 1.4 流程编排模块（orchestration）**[新增]**

**职责**：协调各模块完成完整的拦截器流程

- [`orchestration/interceptor.js`](CharacterEngine/orchestration/interceptor.js) (169行)
  - 主拦截器流程编排
  - 导出：`ceGenerateInterceptor(chat, contextSize, abort, type)`
  - 流程：
    1. 处理 greeting 中的 CE_Init 块
    2. 提前解析（调用 parse-caller）
    3. 构建当前 EngineState
    4. 构建并注入提示块（调用 prompt-builder）
  - 特点：
    - **只做流程编排，不包含具体实现**
    - 所有业务逻辑委托给专门模块
    - 清晰的步骤划分和错误处理

### 1.5 作者工具 UI 模块（ui）

**职责**：提供可视化编辑和观察工具

- [`ui/editor-panel.js`](CharacterEngine/ui/editor-panel.js)  
  - 提供 `openCeEditorPanel()` 入口；
  - 实现「当前角色参数/提示编辑器」弹窗：
    - 参数 Tab：可视化管理 `CeParameterDefinition[]`；
    - 提示类型 Tab：管理提示通道（提示类型）的 name / id / description；
    - 提示条目 Tab：以 ownerName + promptTypeName + 条件 + 文案的形式管理 `CePromptEntry[]`；
    - 角色选项 Tab：控制是否对该角色启用短期情绪/意图。
  - 打开时从当前角色卡扩展字段读取配置，保存时写回角色卡。

- [`ui/state-observer.js`](CharacterEngine/ui/state-observer.js)  
  - 提供 `openCeStateObserverPanel()` 入口；
  - 实现「参数 / 状态观察器 & 模拟器」弹窗：
    - EngineState 概览 Tab：
      - 展示短期情绪/意图、场景信息、cast 层级与原始变量桶；
    - 按参数视角 Tab：
      - 结合角色卡参数定义，从 EngineState.variables 推断每个参数的当前值；
    - 提示组合预览 Tab：
      - 使用 `buildPromptBundles()` + 当前参数状态，展示本轮实际会注入的提示文本（仅预览，不调用 LLM）。

以上 UI 模块与 core/integration 层配合，实现「参数与提示完全绑定在角色卡上 + 独立弹窗编辑/观察」的原则。

## 2. 外部依赖

### 2.1 小白X插件（LittleWhiteBox）

**提前解析功能依赖小白X插件**，使用其 `window.LittleWhiteBox.callGenerate()` API 进行解析调用。

**优势**：
- 完全独立的调用，不污染主 chat
- 不触发 MESSAGE_RECEIVED 事件
- 精确控制提示词构造
- 直接返回结果，无需捕获

**会话槽位**：
- 小白X提供 10 个并发会话槽位：`xb1` 到 `xb10`
- 本插件使用 `xb1` 作为解析调用的专用槽位
- 这是小白X文档规定的合法会话 ID 范围

**identifier 说明**：
- 在调用 `callGenerate()` 时，你会在请求中看到类似 `identifier: 'injection-BEFORE_PROMPT-1764651595692-sv57gz2zkv'` 的字段
- 这个 identifier 是**小白X插件自动生成的**，用于内部追踪和管理组件
- 你的插件**不需要**也**不应该**手动设置这个字段
- ST 本身也不会生成这个 identifier，它完全由小白X管理

**兼容性**：
- 若未安装小白X，提前解析将被跳过
- 未来将实现单调用模式作为备选方案

## 3. 与 SillyTavern 集成的补充说明

这一节说明一些 ST 官方扩展文档中没有写细、但和本插件强相关的点。

### 3.1 插件安装路径与识别方式

- 插件目录应放在 ST 的：  
  `scripts/extensions/third-party/CharacterEngine/`
- 确保其中存在 [`manifest.json`](CharacterEngine/manifest.json) 和入口 [`index.js`](CharacterEngine/index.js)；
- 启动 ST 后，在「Manage Extensions / 管理扩展」中可以看到显示名「角色引擎（Character Engine）」并启用/禁用。

### 3.2 设置面板在 ST UI 中的位置

- 本插件的设置面板通过 [`settings.html`](CharacterEngine/settings.html) 注入 ST 的 `#extensions_settings` 区域；
- 在「设置」-「扩展」中，会看到一个名为「角色引擎」的折叠块（inline drawer），和官方/其他扩展并列；
- 折叠块展开后包含多个小节：
  - 基本设置
  - 对话逻辑
  - 世界观 / 历史检索
  - 作者工具
- 作者工具小节中提供两个按钮：
  - 打开当前角色参数 / 提示编辑器（编辑角色卡扩展字段）；
  - 打开参数 / 状态观察器（仅观察与模拟，不写回存档）。
- 每个选项旁使用简洁的中文文案，具体说明通过 `title` 悬浮提示展示，不占用额外布局空间。

### 3.3 generate_interceptor 的使用约定（当前版本为完整实现）

- 插件在 [`manifest.json`](CharacterEngine/manifest.json) 中通过 `"generate_interceptor": "ceGenerateInterceptor"` 声明拦截器；
- ST 在每次即将向后端 LLM 发送生成请求前，会调用全局函数：
  - `globalThis.ceGenerateInterceptor(chat, contextSize, abort, type)`

当前版本中，[`ceGenerateInterceptor()`](CharacterEngine/orchestration/interceptor.js) 实现了完整的「开局初始化 + 提前解析 + ChangeSet 存储 + 提示注入」流程，大致包含以下步骤：

0) greeting 开局初始化（CE_Init，仅在本地生效、不发送给 LLM）

- 在每次拦截前，先调用 [`applyCeInitFromGreeting(chat)`](CharacterEngine/integration/chat-state-storage.js:427)：
  - 在 `chat` 中找到第一条 AI 消息（通常是 greeting）；
  - 从该消息的 `mes` 文本中提取 `<CE_Init> ... </CE_Init>` 块，并将其中的 `ce.set("路径","op或值","可选理由")` 传给 [`parseInitialCeSetFromGreetingText()`](CharacterEngine/integration/chat-state-storage.js:305) 解析为 `CeChangeSet`
    - 第二个参数既接受纯数字字符串（如 `"45"`），也接受 `set_45` / `up_small` 等符号写法；
  - 然后从消息文本中「剥离」整个 `<CE_Init>...</CE_Init>` 块，仅保留正常的角色台词部分
  - 这些初始化脚本只在 ST 前端与插件内部可见，不会被送入 LLM 提示
  - 为避免重复处理，对已处理过的 greeting 打上 `msg.ce_init_processed = true` 标记

1) 提前解析调用（Early Parse - 使用小白X）

- 仅在"最后一条消息是用户消息"且 `type === 'normal'` 或 `undefined` 时触发提前解析
- 调用 [`buildParsePromptInput(chat)`](CharacterEngine/integration/parse-caller.js:23)：
  - 包含上一轮 AI 回复、当前用户输入
  - 附带当前角色卡中的参数定义摘要（名称 / 类型 / 描述）
  - 动态根据功能开关构建 JSON schema（只包含启用的功能）
- 调用 [`callParseModel(parseInput)`](CharacterEngine/integration/parse-caller.js:203)：
  - 使用 `window.LittleWhiteBox.callGenerate()` API
  - 配置纯净的解析提示（不继承任何组件）
  - 设置低温度（0.6）和较长 token 限制（8192）
  - 使用专用会话槽 `xb1`
  - 支持流式/非流式输出
- 调用 [`normalizeFromJsonText()`](CharacterEngine/integration/state-parser.js:212) 将解析结果规整为内部 `CeChangeSet`
- 若存在有效变更意图，通过 [`setPendingChangeSet()`](CharacterEngine/integration/chat-state-storage.js:192) 暂存

2) 预估本轮 EngineState，用于提示构造

- 使用 [`rebuildEngineStateUpTo(targetIndex)`](CharacterEngine/integration/chat-state-storage.js:253) 重建「当前用户输入所在楼层之前」的状态 S_{N-1}：
  - S0 来自当前 chat 的 `initialState`（该字段在 `getOrCreateEngineMeta()` 中由角色卡的 `initialState` 填充）
  - 再叠加历史上每条 AI 消息的 `message.ce_change_set`（包括 greeting 上由 CE_Init 解析出的开局 ChangeSet）
- 若提前解析得到 `changeSet`，调用 [`applyChangeSet()`](CharacterEngine/core/engine-state.js:151) 得到 S_N（仅用于本轮提示构造，不立即写回存档）

3) 提示注入（基于角色卡的参数/提示定义）

- 调用 [`buildPromptInjectionBlock(engineState)`](CharacterEngine/integration/prompt-builder.js:82)：
  - 从当前角色卡读取参数定义 / 提示类型定义 / 提示条目 / 实体定义
  - 通过 [`resolveParameterRuntimeValue()`](CharacterEngine/integration/prompt-builder.js:20) 推断每个参数的当前值
  - 调用 [`buildPromptBundles()`](CharacterEngine/core/prompt-slots.js:34) 计算在当前状态下哪些提示条目命中
  - 基于 [`buildNormalizedEntities()`](CharacterEngine/core/entities.js:84) 合并角色卡实体与运行时实体
  - 根据 cast 与场景选择本轮需要注入的角色/地点实体
  - 构造结构化的 `<Character_n>` / `<Location_n>` 提示块
- 将提示块作为系统消息插入到 `chat` 中当前用户消息之前，由 ST 的原生 prompt 构造逻辑继续处理

4) MESSAGE_RECEIVED 阶段的持久状态写入

- 在 [`registerEvents()`](CharacterEngine/index.js:144) 中监听 `event_types.MESSAGE_RECEIVED`：
  - 每当一条 AI 消息写入 chat（尚未渲染）时：
    - 使用 [`consumePendingChangeSet()`](CharacterEngine/integration/chat-state-storage.js:204) 取出提前解析得到的 ChangeSet
    - 使用 [`attachChangeSetToLastAiMessage()`](CharacterEngine/integration/chat-state-storage.js:233) 将其挂在最新 AI 消息的 `message.ce_change_set` 字段上
    - 立即调用 `rebuildEngineStateUpTo(lastIndex)` 重建到该楼层的 EngineState
    - 调用 [`setCheckpoint()`](CharacterEngine/integration/chat-state-storage.js:179) 更新 checkpoint（`lastComputedMessageIndex` + `lastComputedStateCheckpoint`）

- 这样：

  - 删除尾部几条 AI 消息，就自然撤销对应 diff，状态自动回退
  - 从中间楼层开新分支时，新分支初始状态 = 该楼之前所有 diff 应用后的结果
  - 同一楼层多次重试 AI 回复时，每个候选都可以带自己的 ChangeSet，最终选择哪条，就沿着哪条状态分支继续

重要：本插件不会绕开 ST 的 `generate()` 自己构建 HTTP 请求，而是只负责：

- 在生成前重写/扩展提示（注入角色引擎提示块）
- 在生成后按消息存储状态（git 风格 diff + checkpoint）

### 3.4 与 chatMetadata、消息对象的关系（回顾 + 扩展）

- ST 为每个 chat 提供 `chatMetadata` 对象用于扩展自定义状态
- 本插件在 `chatMetadata.CharacterEngine` 下维护：
  - `initialState`：当前 chat 的初始 EngineState
  - `runtimeMeta`：
    - `lastComputedMessageIndex` / `lastComputedStateCheckpoint`：状态重建时的 checkpoint
    - `pendingChangeSetForNextAI`：提前解析阶段得到、等待绑定到下一条 AI 消息的 diff
- 对于每条最终写入 chat 的 AI 消息，本插件会在消息对象上挂一个字段：
  - `message.ce_change_set = CeChangeSet`
- 这样：
  - 删除尾部几轮消息时，对应 diff 会一起消失，状态自然回退
  - 从中间一轮建分支时，新分支状态 = 该轮之前所有 diff 应用后的结果
  - 多次重试同一轮时，每个候选回复都可以携带自己的 diff，最终选中哪条，就跟哪条的状态分支走

## 3. 当前开发进度与已实现功能

截至本说明更新时，插件已实现一套完整可用的「角色卡驱动 + 提前解析 + 状态存储 + 提示注入 + 作者工具」链路，具体如下。

### 3.1 已实现的功能

1) 插件加载与设置 UI

- ST 能识别并加载本插件；
- 在「扩展设置」中出现「角色引擎」面板，可配置：
  - 启用角色引擎；
  - 显示调试面板（预留）；
  - 启用提前解析（Early Parse）**需要小白X插件**；
  - 启用多角色场景与 cast 管理（行为暂为预留）；
  - 启用世界观 RAG（行为暂为预留）；
- 作者工具按钮：
  - 打开当前角色参数 / 提示编辑器；
  - 打开参数 / 状态观察器（模拟）；
- 所有显示文案优先使用简体中文，解释性内容放在鼠标悬浮提示中。
- **依赖提示**：设置面板中明确标注提前解析需要安装小白X插件。

2) 引擎状态与 git 风格 diff 模型

- 使用 [`core/engine-state.js`](CharacterEngine/core/engine-state.js) 中定义的 EngineState 统一表达：
  - `variables`：通用参数桶（作者在角色卡中自定义的各种数值/布尔/枚举/标签参数），按 scope 分桶：`character` / `relationship` / `scene` / `global`；包括短期情绪/短期意图在内的所有角色与关系状态；
  - `scene`：场景元数据（地点 / 场景标签）；
  - `cast`：当前 cast 分层（focus / presentSupporting / offstageRelated）；
  - `entitiesRuntime`：运行时实体桶，存放解析模型在对话过程中提出的临时实体（尤其是临时地点）及对配置实体的覆盖。
- 使用 [`core/change-set.js`](CharacterEngine/core/change-set.js) 中定义的 CeChangeSet 表达「本轮的状态变更意图」，包括：
  - `stateDelta`：一组参数操作（set/add/symbolic），不限制具体语义（可以是好感、金钱、任务进度、短期情绪/意图等），所有状态统一通过变量系统表达；
  - `sceneDelta`：locationHint / sceneTags（增删）/ castIntent（使用自然语言 name）；
  - `entityDelta`：一组 `CeEntityOp`，用自然语言 name 表达对实体（character/location/other）的 add/update/remove 意图；
  - `worldIntent`：预留 WorldContextIntent 的结构化结果。
- `applyChangeSet()` 提供了一套最小可用的变更应用逻辑，可在重建状态时迭代调用：
  - 在 EngineState 上依次应用 `stateDelta` / `sceneDelta` / `entityDelta`；
  - 对 `entitiesRuntime` 做增量合并，但不回写角色卡配置。

3) 聊天级状态存储与重建

- 使用 [`integration/chat-state-storage.js`](CharacterEngine/integration/chat-state-storage.js) 将 EngineState 与 CeChangeSet 映射到：
  - `chatMetadata.CharacterEngine`（初始状态与运行时元信息，包括 checkpoint 与 pendingChangeSet）；
  - 每条 AI 消息的 `message.ce_change_set` 字段（git 风格 per-message diff）；
- 提供：
  - `setInitialStateForChat()` / `getInitialStateFromChat()`；
  - `setCheckpoint()` / `getCheckpoint()`；
  - `setPendingChangeSet()` / `consumePendingChangeSet()`；
  - `attachChangeSetToLastAiMessage()`；
  - `rebuildEngineStateUpTo(targetIndex)`：
    从 S0 + checkpoint + 各消息 diff 重建任意一轮状态，用于提前解析和提示注入前的状态准备。
- 重建出的 EngineState 同样包含 `entitiesRuntime`，保证临时实体与其它状态随对话回滚/分支自然演化。

4) 解析调用与 ChangeSet 归一化

- 使用 [`integration/state-parser.js`](CharacterEngine/integration/state-parser.js)：
  - `safeParseJson()` 安全解析 JSON；
  - `normalizeParsedCePayload()` 将解析模型输出的 JSON 结构规整为：
    - `stateDelta` / `sceneDelta` / `entityDelta` / `worldIntent`；
    - `changeSet: CeChangeSet`；
  - `normalizeFromJsonText()` 作为从文本到 ChangeSet 的一站式入口；
- 支持多种字段命名变体，以适配不同提示协议：
  - `ce_update_state` / `CE_UpdateState` / `state`；
  - `ce_update_scene` / `CE_UpdateScene` / `scene`；
  - `ce_update_entities` / `CE_UpdateEntities` / `update_entities`；
  - `world_context_intent` / `WorldContextIntent` / `worldIntent` 等；
- 对 `stateDelta.variables` 调用 `withParsedPath()` 附加解析结果，便于后续根据 `"艾莉娅.好感度.林原"` 做参数与实体对齐。

5) 提示通道组合与注入（Character_n / Location_n）

- 使用 [`core/prompt-slots.js`](CharacterEngine/core/prompt-slots.js)：
  - `buildPromptBundles(entries, getValueByName)`：
    - 输入：一组 `CePromptEntry` + 一个通过参数名获取当前值的回调；
    - 输出：按 ownerName 分组、再按 `promptTypeName`（即提示类型 name）分组的提示文本：
      - 每个 ownerName 对应一个 PromptBundle，内部 `byPromptType` 是「提示类型名 → 拼接后的文本」。
- 在 [`integration/prompt-builder.js`](CharacterEngine/integration/prompt-builder.js) 中：
  - `buildPromptInjectionBlock(engineState)`：
    - 通过角色卡定义 + 当前 EngineState：
      - 计算每个参数名的当前值（与状态观察器逻辑一致）
      - 按条件筛选提示条目，得到 bundles
      - 使用 [`buildNormalizedEntities()`](CharacterEngine/core/entities.js:84) 合并角色卡实体与运行时实体（entitiesRuntime）
      - 基于 EngineState.cast 与 scene.locationHint 选择「本轮需要注入的角色与地点实体」
    - 将上述信息组合为结构化注入块：
      - 对角色实体输出 `<Character_n>` 块：
        - `character`: 实体 name
        - `baseinfo`: 实体基础提示词（来自角色卡实体定义）
        - `advanceinfo`:
          - 以提示类型 name 作为 key，例如 `tone_to_player`、`inner_state` 等
          - value 采用 `|` 多行文本形式，内容为：
            - 若该提示类型在 PromptTypes 中定义了 description，则 description 会被插入在最前方
            - 之后用空行分隔拼接所有命中的提示条目文本
      - 对地点实体输出 `<Location_n>` 块，结构类似：
        - `Location`: 实体 name（通常为地点路径，如 `东京.爱知学院.3年E班`）
        - `baseinfo`: 地点基础提示词
        - `advanceinfo`: 以提示类型 name 为 key 的描述块（同样前置 description）
    - 将这些 Character_n / Location_n 块作为一条系统消息插入 `chat` 中，放在当前用户输入之前，交由 ST 原生 prompt 构造逻辑继续处理
  - 在任何地方都只使用提示类型的 name，而不使用 id 作为对外 key

6) 角色卡参数 / 提示 / 实体 / 初始参数编辑器（独立弹窗 UI）

- 实现 [`ui/editor-panel.js`](CharacterEngine/ui/editor-panel.js)：
  - 独立弹窗，通过「打开当前角色参数 / 提示编辑器」按钮打开；
  - Tab 结构（从左到右）：
    - 参数：
      - 管理 `CeParameterDefinition[]`（name / id / type / description / range / enumValues 等）。
    - 提示类型：
      - 管理提示通道（提示类型）的 name / id / description；
      - description 文本会在注入时插入到对应提示类型块的最前方。
    - 实体：
      - 管理 `CeEntityDefinition[]`（角色 / 地点 / 其他实体）：
        - 角色实体：常见地点（locations）；
        - 地点实体：子地点（childrenNames）+ 常见场景角色（characters）；
        - 其他实体：不参与结构关联，仅作为 ownerName 占位；
      - 新增字段 `parameterNames: string[]`：
        - 以「逗号分隔的参数名」形式配置该实体绑定的参数（与「参数」Tab 的 `CeParameterDefinition.name` 对齐）；
        - 「初始参数」Tab 会以实体为行头，只显示该实体绑定的参数，避免在大项目中出现巨型矩阵。
      - 实体编辑器与核心的 [`buildNormalizedEntities()`](CharacterEngine/core/entities.js:84) 共享一套归一化逻辑（合并同名、地点↔角色对称、ownerName 自动补实体）。
    - 提示条目：
      - 管理 `CePromptEntry[]`（ownerName + promptTypeName + 条件 + 文案），支持分页和拖拽排序；
      - ownerName 下拉选项来源：
        - 现有提示条目中使用过的 ownerName；
        - 实体表中当前存在的实体名（即便尚未被任何提示条目使用），通过 `getExistingEntityNamesFromEntitiesTable()` 实时同步。
    - 初始参数：
      - 只读参数定义与实体绑定信息，不允许在此页新增/删除参数或实体；
      - 按「实体 → 绑定参数」维度，展示一个紧凑矩阵：
        - 每个实体一块；
        - 仅展示该实体 `parameterNames` 中出现、且在参数表中已定义的参数；
      - 为每个参数提供按 type 区分的初始值输入控件：
        - number → `<input type="number">`；
        - boolean → `<select>(未设置/true/false)`；
        - enum → `<select>` 下拉自 `enumValues`；
        - text/其它 → `<input type="text">`；
      - 当前值来源：角色卡扩展字段中的 `initialState.variables`（跨 scope 从 global → character → relationship → scene 查找）；
      - 写回时由 `collectInitialStateFromUi()` 生成新的 `initialState`：
        - 仅覆盖 variables.global 中对应 key 的初始值；
        - scene / cast / entitiesRuntime 等非变量部分沿用上次从卡片加载的快照。
    - 角色卡选项：
      - 管理本角色卡级别的开关（例如关闭整张卡的短期情绪/短期意图解析）：
        - `options.disableShortTermEmotion`：禁用本角色卡的短期情绪；
        - `options.disableShortTermIntent`：禁用本角色卡的短期意图；
      - 这些选项语义是「卡级」而非单角色级：一旦关闭，本卡下所有实体/角色都视为不启用对应短期变量。
  - 打开时自动从 `character.data.extensions.CharacterEngine` 加载配置；
  - 点击保存或自动保存时，将编辑结果写回同一扩展字段（包括 `initialState` 与 `options`）；
  - 不提供 JSON 文本编辑器，全部为结构化 UI，避免出现手写 JSON 与 UI 状态不一致的问题。

7) 参数 / 状态观察器 & Character_n / Location_n 提示预览（独立弹窗 UI）

- 实现 [`ui/state-observer.js`](CharacterEngine/ui/state-observer.js)：
  - 独立弹窗，通过「打开参数 / 状态观察器（模拟）」按钮打开；
  - Tab 结构：
    - EngineState 概览：
      - 基于参数系统展示当前角色的短期情绪/短期意图（通过角色卡参数定义 + EngineState.variables 推断），以及场景信息、cast 层级与原始变量桶；
    - 按参数视角：
      - 利用角色卡参数定义 + EngineState.variables 推断当前每个参数的当前值；
    - 提示组合预览：
      - 在当前 EngineState + 角色卡配置下：
        - 使用 `buildPromptBundles()` + `buildNormalizedEntities()` 与拦截器相同的逻辑；
        - 生成本轮真实将注入给 LLM 的 `<Character_n>` / `<Location_n>` 块文本；
      - 将这些块以只读 `<pre>` 文本形式展示，便于作者验证：
        - 实体配置是否正确；
        - 哪些提示类型在当前状态下命中；
        - 提示类型 description 是否正确出现在对应块的最前方。
  - 仅用于观察与模拟，不会对 EngineState 或角色卡进行任何写回操作。

8) generate_interceptor 全流程集成（模块化架构）

- 在 [`orchestration/interceptor.js`](CharacterEngine/orchestration/interceptor.js) 中实现完整流程编排：
  - **步骤 0**：处理 greeting 中的 CE_Init 块（调用 [`applyCeInitFromGreeting()`](CharacterEngine/integration/chat-state-storage.js:427)）
  - **步骤 1**：提前解析调用（使用小白X）
    - 调用 [`buildParsePromptInput()`](CharacterEngine/integration/parse-caller.js:23) 构造解析提示
    - 调用 [`callParseModel()`](CharacterEngine/integration/parse-caller.js:203) 执行解析
    - 通过 [`normalizeFromJsonText()`](CharacterEngine/integration/state-parser.js:212) 归一化为 `CeChangeSet`
    - 通过 [`setPendingChangeSet()`](CharacterEngine/integration/chat-state-storage.js:192) 暂存
  - **步骤 2**：EngineState 重建
    - 使用 [`rebuildEngineStateUpTo()`](CharacterEngine/integration/chat-state-storage.js:253) 重建到当前用户消息之前的状态
    - 将 pendingChangeSet 通过 [`applyChangeSet()`](CharacterEngine/core/engine-state.js:151) 虚拟应用
  - **步骤 3**：提示注入
    - 调用 [`buildPromptInjectionBlock()`](CharacterEngine/integration/prompt-builder.js:82) 构造提示块
    - 将提示块插入到 chat 中
  - **MESSAGE_RECEIVED 阶段**（在 [`index.js`](CharacterEngine/index.js:154) 中）：
    - 将 ChangeSet 挂到 AI 消息上并更新 checkpoint

- **架构特点**：
  - 完全模块化：每个模块只负责一个明确的领域
  - 高聚合低耦合：模块间通过明确的接口通信
  - 易于维护：修改某个功能只需关注对应模块
  - 整个流程严格遵守设计文档中「角色卡定义 → 解析模型符号化意图 → EngineState → 提示组合 → LLM 表演」的责任分层

### 3.2 尚未实现 / 计划中的扩展

在当前完整基础上，后续仍可扩展的能力包括：

- **单调用模式实现**：
  - 作为未安装小白X时的备选方案；
  - 在主对话调用中同时输出剧情 + ChangeSet。
- 更细粒度的参数规则与审批模型：
  - 支持「软/硬上限」「不同场景下的变更上限」；
  - 支持多级审批（例如 NSFW 参数需要单独审查）。
- 多角色 cast 管理的完整实现：
  - 根据 `CeCastIntent` 正式更新 cast 层级与入退场规则；
  - 在提示注入阶段按 cast 层级控制各角色提示粒度。
- 世界观 RAG 与历史检索：
  - 解析并消费 `WorldContextIntent`；
  - 对接 ST 的 World Info / Data Bank 或外部 RAG 服务；
  - 将相关设定/历史片段注入到世界观提示区域。
- 更丰富的作者工具：
  - 在观察器和编辑器上拓展更多便捷操作（批量编辑、参数模板、预设通道模板等）；
  - 对提示条目提供更强的条件表达能力（多参数组合、逻辑表达式 GUI 等）。

## 4. 面向开发者的使用建议

- 若你要在此基础上继续开发：
  - **优先理解模块职责**：
    - `core/`：纯数据逻辑，不依赖 ST
    - `integration/`：ST 集成，数据存储、解析调用、提示构建
    - `orchestration/`：流程编排，协调各模块
    - `ui/`：可视化工具
  - **理解核心概念**：
    - 角色卡扩展字段结构（parameters / promptTypes / prompts / entities / options）
    - EngineState + ChangeSet + chatMetadata 的运行机制
    - 拦截器流程：「提前解析 → setPendingChangeSet → MESSAGE_RECEIVED 绑定 ChangeSet → checkpoint」
  - **添加新功能时**：
    - 确定功能属于哪个模块（core / integration / orchestration / ui）
    - 在对应模块中添加功能，不要跨模块耦合
    - 遵循「角色卡是唯一配置真源」「LLM 只看自然语言 name/path」「状态只通过 ChangeSet 写入 EngineState」的原则
    - 不要在 `extension_settings` 或其他地方复制配置数据，避免出现"影子配置"

- **调试和观测**：
  - 在浏览器控制台使用「过滤：CharacterEngine」查看日志
  - 使用设置面板中的按钮打开：
    - 参数 / 提示编辑器：检查当前角色卡的配置是否正确
    - 参数 / 状态观察器：检查当前楼层的 EngineState 与提示组合效果
  - 各模块的职责清晰，定位问题时可以快速找到对应模块

## 5. 模块化架构总结

本插件采用**完全模块化**的架构设计，遵循**高聚合、低耦合**原则：

### 5.1 模块职责矩阵

| 模块 | 职责 | 依赖 | 导出 |
|------|------|------|------|
| `core/` | 纯数据逻辑 | 无 | 数据结构和算法 |
| `integration/parse-caller.js` | 解析调用 | card-storage, ST API | buildParsePromptInput, callParseModel |
| `integration/prompt-builder.js` | 提示构建 | card-storage, core/prompt-slots, core/entities | buildPromptInjectionBlock, resolveParameterRuntimeValue |
| `integration/chat-state-storage.js` | 状态存储 | st-context, core/engine-state, core/change-set | 状态管理函数, applyCeInitFromGreeting |
| `orchestration/interceptor.js` | 流程编排 | parse-caller, prompt-builder, chat-state-storage | ceGenerateInterceptor |
| `index.js` | 入口初始化 | orchestration/interceptor, ui/, integration/chat-state-storage | ceGenerateInterceptor (全局) |

### 5.2 代码量对比

- **重构前** [`index.js`](CharacterEngine/index.js)：853行（包含所有业务逻辑）
- **重构后**：
  - [`index.js`](CharacterEngine/index.js)：211行（-75%，只负责初始化）
  - [`integration/parse-caller.js`](CharacterEngine/integration/parse-caller.js)：267行（新增）
  - [`integration/prompt-builder.js`](CharacterEngine/integration/prompt-builder.js)：259行（新增）
  - [`orchestration/interceptor.js`](CharacterEngine/orchestration/interceptor.js)：169行（新增）
  - [`integration/chat-state-storage.js`](CharacterEngine/integration/chat-state-storage.js)：465行（扩展）

### 5.3 架构优势

1. **单一职责**：每个模块只负责一个明确的领域
2. **易于测试**：各模块可以独立测试
3. **易于维护**：修改某个功能只需要关注对应模块
4. **易于扩展**：新增功能有明确归属
5. **降低耦合**：模块间通过明确的接口通信

本说明会随着插件迭代同步更新，保持与实际代码结构一致。