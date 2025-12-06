// @ts-nocheck
// CharacterEngine 数据读取服务
// 为外部插件或嵌入型子页面提供读取角色卡变量和实体信息的功能

import { getConfigForCurrentCharacter } from '../integration/card-storage.js';
import { 
  rebuildEngineStateUpTo, 
  getInitialStateFromChat,
  getCheckpoint 
} from '../integration/chat-state-storage.js';
import { buildNormalizedEntities } from '../core/entities.js';
import { getChat, getStContext } from '../integration/st-context.js';

/**
 * 数据读取服务类
 * 提供只读接口访问角色引擎的配置和状态数据
 */
class DataReaderService {
  constructor() {
    /** @type {{ lastState: any, lastStateIndex: number, lastUpdateTime: number }} */
    this._cache = {
      lastState: null,
      lastStateIndex: -1,
      lastUpdateTime: 0
    };
    
    // 缓存过期时间（毫秒）
    this._cacheExpireTime = 1000;
  }
  
  // ===== 参数和实体定义（静态配置） =====
  
  /**
   * 获取当前角色的参数定义列表
   * @returns {import("../core/variables.js").CeParameterDefinition[]}
   */
  getParameters() {
    try {
      const config = getConfigForCurrentCharacter();
      return Array.isArray(config.parameters) ? config.parameters : [];
    } catch (err) {
      console.error('[CharacterEngine.dataReader] getParameters 失败:', err);
      return [];
    }
  }
  
  /**
   * 获取当前角色的实体定义列表
   * @returns {import("../core/entities.js").CeEntityDefinition[]}
   */
  getEntities() {
    try {
      const config = getConfigForCurrentCharacter();
      const state = this.getCurrentState();
      const userEntityData = this._getUserEntityData();
      
      return buildNormalizedEntities(
        config.entities,
        state.entitiesRuntime,
        null,
        userEntityData,
        config.parameters
      );
    } catch (err) {
      console.error('[CharacterEngine.dataReader] getEntities 失败:', err);
      return [];
    }
  }
  
  // ===== 状态读取（动态数据） =====
  
  /**
   * 获取当前最新状态（默认：稳定状态）
   * @param {Object} [options] - 选项
   * @param {string} [options.type] - 状态类型：'stable'（默认）| 'predicted'
   * @returns {import("../core/engine-state.js").EngineState}
   */
  getCurrentState(options = {}) {
    try {
      const { type = 'stable' } = options;
      
      const chat = getChat() || [];
      const targetIndex = chat.length - 1;
      
      // 简单缓存机制
      if (this._cache.lastStateIndex === targetIndex && 
          Date.now() - this._cache.lastUpdateTime < this._cacheExpireTime) {
        return this._deepClone(this._cache.lastState);
      }
      
      const state = rebuildEngineStateUpTo(targetIndex);
      
      // 更新缓存
      this._cache.lastState = this._deepClone(state);
      this._cache.lastStateIndex = targetIndex;
      this._cache.lastUpdateTime = Date.now();
      
      // TODO: 如果 type === 'predicted'，应用 pendingChangeSet
      // 这需要从拦截器获取 pendingChangeSet，暂时不实现
      
      return this._deepClone(state);
    } catch (err) {
      console.error('[CharacterEngine.dataReader] getCurrentState 失败:', err);
      // 返回初始状态作为后备
      return getInitialStateFromChat();
    }
  }
  
  /**
   * 获取指定消息索引后的状态
   * @param {number} messageIndex - 消息索引（0-based）
   * @returns {import("../core/engine-state.js").EngineState}
   */
  getStateAtIndex(messageIndex) {
    try {
      if (typeof messageIndex !== 'number' || messageIndex < 0) {
        throw new Error('messageIndex 必须是非负整数');
      }
      
      const state = rebuildEngineStateUpTo(messageIndex);
      return this._deepClone(state);
    } catch (err) {
      console.error('[CharacterEngine.dataReader] getStateAtIndex 失败:', err);
      throw err;
    }
  }
  
  /**
   * 获取初始状态（角色卡基线，不包含任何对话变化）
   * @returns {import("../core/engine-state.js").EngineState}
   */
  getInitialState() {
    try {
      const state = getInitialStateFromChat();
      return this._deepClone(state);
    } catch (err) {
      console.error('[CharacterEngine.dataReader] getInitialState 失败:', err);
      throw err;
    }
  }
  
  /**
   * 获取特定参数的当前值（便捷方法）
   * @param {string} paramName - 参数名称
   * @param {string} [subjectName] - 主体名称（可选，用于 character/relationship scope）
   * @param {string} [targetName] - 目标名称（可选，用于 relationship scope）
   * @param {Object} [options] - 选项（同 getCurrentState）
   * @returns {any}
   */
  getParameterValue(paramName, subjectName = null, targetName = null, options = {}) {
    try {
      // 参数验证
      if (!paramName || typeof paramName !== 'string') {
        throw new Error('参数名称必须是非空字符串');
      }
      
      const state = this.getCurrentState(options);
      const parameters = this.getParameters();
      
      // 查找参数定义
      const paramDef = parameters.find(p => 
        p && (p.name === paramName || p.id === paramName)
      );
      
      if (!paramDef) {
        const availableParams = parameters.map(p => p.name).join(', ');
        throw new Error(
          `参数 "${paramName}" 不存在。可用参数: ${availableParams || '(无)'}`
        );
      }
      
      const scope = paramDef.scope;
      const bucket = state.variables[scope];
      
      if (!bucket) {
        return undefined;
      }
      
      // 根据 scope 构建路径
      if (scope === 'global' || scope === 'scene') {
        return bucket[paramName];
      }
      
      if (scope === 'character') {
        if (!subjectName) {
          throw new Error(`参数 "${paramName}" (scope: character) 需要指定 subjectName`);
        }
        return bucket[subjectName]?.[paramName];
      }
      
      if (scope === 'relationship') {
        if (!subjectName || !targetName) {
          throw new Error(
            `参数 "${paramName}" (scope: relationship) 需要指定 subjectName 和 targetName`
          );
        }
        return bucket[subjectName]?.[paramName]?.[targetName];
      }
      
      return undefined;
    } catch (err) {
      console.error('[CharacterEngine.dataReader] getParameterValue 失败:', err);
      throw err;
    }
  }
  
  /**
   * 获取场景信息（从当前状态提取）
   * @param {Object} [options] - 选项（同 getCurrentState）
   * @returns {Object} { locationHint, sceneTags, cast, locationCast }
   */
  getSceneInfo(options = {}) {
    try {
      const state = this.getCurrentState(options);
      return {
        locationHint: state.scene?.locationHint || null,
        sceneTags: Array.isArray(state.scene?.sceneTags) ? state.scene.sceneTags : [],
        cast: {
          focus: Array.isArray(state.cast?.focus) ? state.cast.focus : [],
          presentSupporting: Array.isArray(state.cast?.presentSupporting) 
            ? state.cast.presentSupporting 
            : [],
          offstageRelated: Array.isArray(state.cast?.offstageRelated) 
            ? state.cast.offstageRelated 
            : []
        },
        locationCast: {
          current: state.locationCast?.current || null,
          candidate: Array.isArray(state.locationCast?.candidate) 
            ? state.locationCast.candidate 
            : []
        }
      };
    } catch (err) {
      console.error('[CharacterEngine.dataReader] getSceneInfo 失败:', err);
      throw err;
    }
  }
  
  // ===== 元信息查询 =====
  
  /**
   * 获取当前对话的消息数量
   * @returns {number}
   */
  getMessageCount() {
    try {
      const chat = getChat() || [];
      return chat.length;
    } catch (err) {
      console.error('[CharacterEngine.dataReader] getMessageCount 失败:', err);
      return 0;
    }
  }
  
  /**
   * 获取最后一条 AI 消息的索引
   * @returns {number} 索引，如果没有则返回 -1
   */
  getLastAiMessageIndex() {
    try {
      const chat = getChat() || [];
      for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i] && !chat[i].is_user) {
          return i;
        }
      }
      return -1;
    } catch (err) {
      console.error('[CharacterEngine.dataReader] getLastAiMessageIndex 失败:', err);
      return -1;
    }
  }
  
  /**
   * 获取最后一条用户消息的索引
   * @returns {number} 索引，如果没有则返回 -1
   */
  getLastUserMessageIndex() {
    try {
      const chat = getChat() || [];
      for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i] && chat[i].is_user) {
          return i;
        }
      }
      return -1;
    } catch (err) {
      console.error('[CharacterEngine.dataReader] getLastUserMessageIndex 失败:', err);
      return -1;
    }
  }
  
  /**
   * 获取 checkpoint 信息
   * @returns {Object} { index: number, hasCheckpoint: boolean }
   */
  getCheckpointInfo() {
    try {
      const checkpoint = getCheckpoint();
      return {
        index: checkpoint.index,
        hasCheckpoint: checkpoint.state !== null
      };
    } catch (err) {
      console.error('[CharacterEngine.dataReader] getCheckpointInfo 失败:', err);
      return {
        index: -1,
        hasCheckpoint: false
      };
    }
  }
  
  // ===== 私有辅助方法 =====
  
  /**
   * 从 ST 上下文获取 {{user}} 实体数据
   * @returns {Object|null}
   * @private
   */
  _getUserEntityData() {
    try {
      const ctx = getStContext();
      return {
        name: '{{user}}',
        baseinfo: ctx.name1 || ''
      };
    } catch {
      return null;
    }
  }
  
  /**
   * 深度克隆对象（防止外部修改内部状态）
   * @param {any} obj
   * @returns {any}
   * @private
   */
  _deepClone(obj) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    
    if (obj instanceof Date) {
      return new Date(obj.getTime());
    }
    
    if (obj instanceof Array) {
      return obj.map(item => this._deepClone(item));
    }
    
    if (obj instanceof Set) {
      return new Set(Array.from(obj).map(item => this._deepClone(item)));
    }
    
    if (obj instanceof Map) {
      const cloned = new Map();
      for (const [key, value] of obj.entries()) {
        cloned.set(this._deepClone(key), this._deepClone(value));
      }
      return cloned;
    }
    
    const cloned = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        cloned[key] = this._deepClone(obj[key]);
      }
    }
    return cloned;
  }
}

// 单例模式
let globalServiceInstance = null;

/**
 * 获取数据读取服务实例
 * @returns {DataReaderService}
 */
export function getDataReaderService() {
  if (!globalServiceInstance) {
    globalServiceInstance = new DataReaderService();
  }
  return globalServiceInstance;
}