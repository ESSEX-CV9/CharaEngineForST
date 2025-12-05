# Character Engine for SillyTavern

<div align="center">

**一个为 LLM 驱动的恋爱/叙事游戏设计的角色引擎插件**

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://github.com/ESSEX-CV9/CharacterEngineForST)      [![License](https://img.shields.io/badge/license-AGPL--3.0-green.svg)](LICENSE)      [![SillyTavern](https://img.shields.io/badge/SillyTavern-%E2%89%A51.12.0-orange.svg)](https://github.com/SillyTavern/SillyTavern)

[English](#english) | [简体中文](#简体中文)

</div>

---

## 简体中文

### 📖 项目简介

Character Engine 是一个专为 SillyTavern 设计的角色引擎插件，旨在解决 LLM 在恋爱/叙事游戏中的核心痛点：

#### 🎯 核心问题

当前 LLM 在处理复杂角色关系时面临的挑战：

- **状态混乱**：难以稳定区分恋爱进程的不同阶段（如从高冷到黏人的 5 阶段演化），经常出现状态跳跃或混用
- **关系简化**：难以表达「性与爱分离」等复杂关系，一旦发生亲密行为就自动补完成甜蜜真爱路线
- **情绪卡死**：剧情事件（如激烈吵架）结束后，人设应该回到原始基线，但 LLM 往往一直卡在激动状态
- **上下文限制**：受限于有限的上下文窗口（~200K token）和黄金注意力区（~50K token），难以应对大量角色和大世界观

#### 💡 解决方案

本引擎采用「**数值定义人物，LLM 表现人物**」的设计理念：

- **外置状态管理**：将角色状态（好感度、信任度、恋爱阶段等）全部外置为数值矩阵，由引擎控制
- **职责分离**：主对话 LLM 只负责「在给定状态下演戏」，不自己扛所有心理与关系逻辑
- **平滑演化**：通过矩阵和分段提示，平滑表达恋爱阶段、人设转变以及 NSFW 场景中的微妙情绪
- **作者友好**：提供简单易用的可视化编辑器，作者只需设定多阶段人设，无需关心底层数值管理

### ✨ 核心特性

#### 1. 通用参数系统

- **完全自定义**：作者可以定义任意类型的参数（好感度、信任度、金钱、任务进度等）
- **多种类型支持**：数值、布尔、枚举、标签列表
- **分段提示**：为不同参数阶段配置不同的提示片段，实现平滑的人设演化
- **作用域管理**：支持角色级、关系级、场景级、全局级参数

#### 2. 提示通道系统

- **灵活命名**：提示类型（通道）完全由作者自定义，如 `tone_to_player`、`inner_state`、`sex_behavior` 等
- **条件触发**：基于参数值的条件表达式，精确控制提示片段的生效时机
- **分层组合**：自动将多个提示片段按优先级组合，生成最终提示

#### 3. 状态管理与持久化

- **Git 风格 Diff**：每轮对话的状态变化以增量形式存储，支持回滚和分支
- **提前解析**：在生成回复前先解析状态变化，确保角色表现与最新状态一致
- **Checkpoint 机制**：智能缓存状态，提升重建性能

#### 4. 多角色场景管理

- **Cast 分层**：将角色分为主视角、在场配角、场外相关三个层级
- **动态加载**：根据场景自动选择需要加载的角色，优化上下文使用
- **进退场控制**：LLM 可以提出角色进退场意图，由引擎规则审批

#### 5. 实体系统

- **角色实体**：管理角色的基础信息、常见地点、绑定参数
- **地点实体**：管理地点的层级结构、常见角色、场景标签
- **运行时实体**：支持对话中动态创建临时实体（如临时地点）

#### 6. 可视化作者工具

- **参数/提示编辑器**：
  - 参数定义管理
  - 提示类型管理
  - 提示条目编辑（支持条件表达式）
  - 实体定义管理
  - 初始参数设置
  - 角色卡选项配置

- **状态观察器**：
  - 实时查看当前 EngineState
  - 按参数视角展示所有参数值
  - 预览当前状态下的提示组合效果

#### 7. 世界观 RAG（可选）

- **文档管理**：支持多个世界观设定文档集合
- **智能检索**：基于对话内容自动检索相关设定
- **按需注入**：只在需要时注入相关设定，节省上下文

### 🚀 快速开始

#### 前置要求

- [SillyTavern](https://github.com/SillyTavern/SillyTavern) >= 1.12.0

#### 安装步骤

1. **下载插件**

   使用 SillyTavern 自带的插件扩展安装或者

   将本仓库克隆或下载到 SillyTavern 的插件目录：

   ```bash
   cd SillyTavern/public/scripts/extensions/third-party/
   git clone https://github.com/ESSEX-CV9/CharacterEngineForST.git CharacterEngine
   ```

2. **启用插件**

   在 SillyTavern 的「设置」→「扩展」中找到「角色引擎」，勾选「启用角色引擎」

3. **配置插件**（可选）

   - **启用提前解析**：可以在生成回复前先解析状态变化
   - **启用世界观 RAG**：支持从设定文档中检索相关内容

### 📚 使用指南

#### 1. 创建角色卡配置

1. 在 SillyTavern 中选择一个角色
2. 打开「设置」→「扩展」→「角色引擎」
3. 点击「打开当前角色参数/提示编辑器」

#### 2. 定义参数

在「参数」标签页中：

1. 点击「添加参数」
2. 填写参数信息：
   - **名称**：参数的显示名称（如「好感度」）
   - **ID**：内部标识符（可选，留空自动生成）
   - **类型**：number / boolean / enum / text
   - **描述**：参数的含义说明
   - **范围/枚举值**：根据类型填写

示例：
```yaml
名称: 好感度
类型: number
范围: 0-100
描述: 表示角色对玩家的信任与亲近程度
```

#### 3. 定义提示类型

在「提示类型」标签页中：

1. 点击「添加提示类型」
2. 填写：
   - **名称**：提示类型名称（如 `tone_to_player`）
   - **描述**：该提示类型的说明（会在注入时显示在最前方）

#### 4. 创建提示条目

在「提示条目」标签页中：

1. 点击「添加提示条目」
2. 填写：
   - **所属实体**：选择角色或地点
   - **提示类型**：选择之前定义的提示类型
   - **条件**：设置触发条件（如 `好感度 >= 60`）
   - **文本**：提示内容

示例：
```yaml
所属实体: 上原惠
提示类型: tone_to_player
条件: 好感度 >= 60 AND 好感度 < 80
文本: |
  她已经明显喜欢安野，说话更自然亲近，
  偶尔会不经意地关心他。
```

#### 5. 设置初始参数

在「初始参数」标签页中：

1. 为每个实体的参数设置初始值
2. 这些值会在新对话开始时自动应用

#### 6. 开始对话

配置完成后，直接开始对话：

- 引擎会自动根据当前参数状态选择合适的提示片段
- 每轮对话后，状态会根据剧情自动更新
- 可以随时打开「状态观察器」查看当前状态

### 🔧 高级功能

#### Greeting 初始化

在角色的 greeting 消息中，可以使用 `<CE_Init>` 块设置初始参数：

```
<CE_Init>
ce.set("上原惠.好感度.安野", "45", "初始设定")
ce.set("上原惠.短期情绪", "略显紧张", "第一次见面")
</CE_Init>

你好，我是上原惠...
```

**注意**：`<CE_Init>` 块会在本地处理后自动移除，不会发送给 LLM。

#### 自然语言路径

所有参数引用都使用自然语言路径，格式为：

```
实体名.参数名.目标实体名（可选）
```

示例：
- `上原惠.好感度.安野`：上原惠对安野的好感度
- `上原惠.短期情绪`：上原惠的短期情绪
- `学园屋顶.紧张度`：学园屋顶的紧张度

#### 符号化操作

在设置参数值时，支持以下符号化操作：

- **数值参数**：
  - `up_small` / `up_medium` / `up_large`：小幅/中幅/大幅增加
  - `down_small` / `down_medium` / `down_large`：小幅/中幅/大幅减少
  - `set_<value>`：设置为指定值
  - 直接数字：设置为该数值

- **其他类型**：
  - 直接提供新值（如布尔值、枚举值、文本）

### 🏗️ 架构设计

本插件采用完全模块化的架构：

```
CharacterEngine/
├── core/                    # 核心数据逻辑（不依赖 ST）
│   ├── engine-state.js     # EngineState 定义与操作
│   ├── change-set.js       # Git 风格 ChangeSet
│   ├── variables.js        # 参数系统核心
│   ├── prompt-slots.js     # 提示通道组合器
│   ├── entities.js         # 实体系统
│   └── ...
├── integration/            # ST 集成层
│   ├── st-context.js       # ST 上下文封装
│   ├── card-storage.js     # 角色卡存储
│   ├── chat-state-storage.js  # 对话状态存储
│   ├── parse-caller.js     # 解析调用
│   ├── prompt-builder.js   # 提示构建
│   └── state-parser.js     # 状态解析
├── orchestration/          # 流程编排
│   └── interceptor.js      # 主拦截器
├── ui/                     # 可视化工具
│   ├── editor-panel.js     # 参数/提示编辑器
│   └── state-observer.js   # 状态观察器
├── rag/                    # RAG 子系统（可选）
│   ├── core/               # RAG 核心
│   ├── integration/        # RAG 集成
│   └── ui/                 # RAG UI
└── services/               # 全局服务
    └── call-generate.js    # 独立调用服务
```

**设计原则**：

- **单一职责**：每个模块只负责一个明确的领域
- **高聚合低耦合**：模块间通过明确的接口通信
- **易于维护**：修改某个功能只需关注对应模块
- **易于扩展**：新增功能有明确归属

### 🔌 API 接口

本插件提供全局 API 供其他插件或脚本调用：

```javascript
// 调用生成
const result = await window.CharacterEngine.callGenerate({
  components: { list: ['ALL_PREON'] },
  userInput: '你好',
  streaming: { 
    enabled: true,
    onChunk: (chunk, accumulated) => {
      console.log('收到文本块:', chunk);
    }
  },
  api: { inherit: true }
});

// 取消指定会话
window.CharacterEngine.callGenerate.cancel('ce1');

// 清理所有会话
window.CharacterEngine.callGenerate.cleanup();
```

### 🤝 依赖说明

#### 必需依赖

- **SillyTavern** >= 1.12.0
---

## English

### 📖 Introduction

Character Engine is a plugin for SillyTavern designed to solve core pain points of LLM in romance/narrative games:

#### 🎯 Core Problems

Challenges faced by current LLMs when handling complex character relationships:

- **State Confusion**: Difficulty in stably distinguishing different stages of romance progression (e.g., 5-stage evolution from aloof to clingy), often jumping or mixing states
- **Relationship Simplification**: Difficulty expressing complex relationships like "separation of sex and love", automatically completing sweet love routes once intimate behavior occurs
- **Emotion Stuck**: After plot events (like intense arguments), the character should return to baseline, but LLM often stays stuck in excited states
- **Context Limitations**: Limited by finite context window (~200K tokens) and golden attention zone (~50K tokens), difficult to handle many characters and large worldviews

#### 💡 Solution

This engine adopts the design philosophy of "**Numbers Define Characters, LLM Performs Characters**":

- **External State Management**: All character states (affection, trust, romance stage, etc.) are externalized as numerical matrices, controlled by the engine
- **Separation of Concerns**: Main dialogue LLM only responsible for "acting in given state", not carrying all psychological and relationship logic
- **Smooth Evolution**: Through matrices and segmented prompts, smoothly express romance stages, character transformations, and subtle emotions in NSFW scenarios
- **Author-Friendly**: Provides simple and easy-to-use visual editor, authors only need to set multi-stage personas without worrying about underlying numerical management

### ✨ Core Features

#### 1. Universal Parameter System

- **Fully Customizable**: Authors can define any type of parameters (affection, trust, money, quest progress, etc.)
- **Multiple Type Support**: Numbers, booleans, enums, tag lists
- **Segmented Prompts**: Configure different prompt fragments for different parameter stages, achieving smooth persona evolution
- **Scope Management**: Supports character-level, relationship-level, scene-level, and global-level parameters

#### 2. Prompt Channel System

- **Flexible Naming**: Prompt types (channels) are completely author-defined, such as `tone_to_player`, `inner_state`, `sex_behavior`, etc.
- **Conditional Triggering**: Conditional expressions based on parameter values, precisely controlling when prompt fragments take effect
- **Layered Composition**: Automatically combines multiple prompt fragments by priority to generate final prompts

#### 3. State Management & Persistence

- **Git-Style Diff**: State changes for each dialogue round are stored incrementally, supporting rollback and branching
- **Early Parsing**: Parse state changes before generating responses, ensuring character performance matches latest state
- **Checkpoint Mechanism**: Intelligently caches states, improving rebuild performance

#### 4. Multi-Character Scene Management

- **Cast Layering**: Divides characters into three tiers: main focus, present supporting, and offstage related
- **Dynamic Loading**: Automatically selects characters to load based on scene, optimizing context usage
- **Entry/Exit Control**: LLM can propose character entry/exit intentions, approved by engine rules

#### 5. Entity System

- **Character Entities**: Manages character basic info, common locations, bound parameters
- **Location Entities**: Manages location hierarchy, common characters, scene tags
- **Runtime Entities**: Supports dynamically creating temporary entities during dialogue (like temporary locations)

#### 6. Visual Author Tools

- **Parameter/Prompt Editor**:
  - Parameter definition management
  - Prompt type management
  - Prompt entry editing (supports conditional expressions)
  - Entity definition management
  - Initial parameter settings
  - Character card options configuration

- **State Observer**:
  - Real-time view of current EngineState
  - Display all parameter values by parameter perspective
  - Preview prompt composition effects under current state

#### 7. Worldview RAG (Optional)

- **Document Management**: Supports multiple worldview setting document collections
- **Smart Retrieval**: Automatically retrieves relevant settings based on dialogue content
- **On-Demand Injection**: Only injects relevant settings when needed, saving context

### 🚀 Quick Start

#### Prerequisites

- [SillyTavern](https://github.com/SillyTavern/SillyTavern) >= 1.12.0

#### Installation

1. **Download Plugin**

   Clone or download this repository to SillyTavern's plugin directory:

   ```bash
   cd SillyTavern/public/scripts/extensions/third-party/
   git clone https://github.com/ESSEX-CV9/CharacterEngineForST.git CharacterEngine
   ```

2. **Enable Plugin**

   In SillyTavern's "Settings" → "Extensions", find "Character Engine" and check "Enable Character Engine"

3. **Configure Plugin** (Optional)

   - **Enable Worldview RAG**: Supports retrieving relevant content from setting documents

### 📚 Usage Guide

Please refer to the Chinese section above for detailed usage instructions. The workflow is:

1. Create character card configuration
2. Define parameters
3. Define prompt types
4. Create prompt entries
5. Set initial parameters
6. Start dialogue

### 🏗️ Architecture

This plugin adopts a fully modular architecture with clear separation of concerns. See the Chinese section above for the directory structure.

**Design Principles**:

- **Single Responsibility**: Each module is responsible for one clear domain
- **High Cohesion, Low Coupling**: Modules communicate through clear interfaces
- **Easy to Maintain**: Modifying a feature only requires focusing on the corresponding module
- **Easy to Extend**: New features have clear ownership

### 🔌 API Interface

This plugin provides a global API for other plugins or scripts:

```javascript
// Call generate 
const result = await window.CharacterEngine.callGenerate({
  components: { list: ['ALL_PREON'] },
  userInput: 'Hello',
  streaming: { 
    enabled: true,
    onChunk: (chunk, accumulated) => {
      console.log('Received chunk:', chunk);
    }
  },
  api: { inherit: true }
});

// Cancel specific session
window.CharacterEngine.callGenerate.cancel('ce1');

// Cleanup all sessions
window.CharacterEngine.callGenerate.cleanup();
```

---

<div align="center">

**Made with ❤️ for the AIRP community**

</div>