// 解析模型输出规整层：将 XML 块格式的 CE_UpdateState / CE_UpdateScene / WorldContextIntent
// 转为内部 CeChangeSet 结构，并附加人类可读路径解析结果。
//
// 核心设计：
// - 使用 XML 块解析（鲁棒性强，支持混合输出）
// - 逐行解析 ce.set() 调用，单行错误不影响整体
// - 始终保留原始文本用于显示和调试

import {
  normalizeCeUpdateState,
  normalizeCeUpdateScene,
  composeChangeSet
} from "../core/change-set.js";
import { withParsedPath } from "../core/variables.js";

/**
 * @typedef {import("../core/change-set.js").CeChangeSet} CeChangeSet
 */

/**
 * @typedef {Object} ParseResult
 * @property {string} rawText - 原始文本（用于显示）
 * @property {CeChangeSet|null} changeSet - 解析出的 ChangeSet
 * @property {Object} stateDelta - 状态变化
 * @property {Object} sceneDelta - 场景变化
 * @property {Array} entityDelta - 实体变化
 * @property {Object} worldIntent - 世界观检索意图
 * @property {string} parseMethod - 解析方法（xml/none）
 * @property {Array<string>} warnings - 解析警告
 * @property {Object} debugInfo - 调试信息
 */

/**
 * 提取 XML 块内容
 * @param {string} text - 原始文本
 * @param {string} tagName - XML 标签名
 * @returns {string|null}
 */
function extractXmlBlock(text, tagName) {
  const regex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * 解析 ce.set() 调用
 * @param {string} line - 包含 ce.set() 的行
 * @returns {Object|null}
 */
function parseCeSetCall(line) {
  // 匹配: ce.set('路径', '操作或值', '可选注释')
  const match = line.match(/ce\.set\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*(?:,\s*['"]([^'"]*)['"]\s*)?\)/);
  if (!match) return null;

  const [, path, opOrValue, comment] = match;
  
  // 判断是符号化操作还是直接值
  const symbolicOps = ['up_small', 'up_medium', 'up_large', 'down_small', 'down_medium', 'down_large'];
  const isSymbolic = symbolicOps.includes(opOrValue) || opOrValue.startsWith('set_');
  
  return {
    path: path.trim(),
    op: isSymbolic ? 'symbolic' : 'set',
    value: isSymbolic ? undefined : opOrValue,
    symbol: isSymbolic ? opOrValue : undefined,
    meta: comment ? { reason: comment.trim() } : undefined
  };
}

/**
 * 从 <VarChange> 块中解析变量操作
 * 注意：scope 字段不再由此函数推断，而是在后续处理中从参数定义中获取
 * @param {string} varChangeBlock - VarChange 块内容
 * @returns {Array<Object>}
 */
function parseVarChangeBlock(varChangeBlock) {
  const variables = [];
  const lines = varChangeBlock.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) {
      continue; // 跳过空行和注释
    }
    
    const varOp = parseCeSetCall(trimmed);
    if (varOp) {
      // 不再推断 scope，保持原始解析结果
      variables.push(varOp);
    }
  }
  
  return variables;
}

/**
 * 从 <CastIntent> 块中解析角色进出场意图
 * @param {string} castBlock - CastIntent 块内容
 * @returns {Object}
 */
function parseCastIntentBlock(castBlock) {
  const castIntent = { enter: [], leave: [] };
  
  const enterMatch = castBlock.match(/<enter>([\s\S]*?)<\/enter>/i);
  const leaveMatch = castBlock.match(/<leave>([\s\S]*?)<\/leave>/i);
  
  const parseNames = (text) => {
    if (!text) return [];
    const names = [];
    const lines = text.split('\n');
    let currentEntry = null;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // 检测新的角色条目（以 "- 角色：" 开头）
      if (trimmed.startsWith('-')) {
        // 如果有之前的条目，先保存
        if (currentEntry) {
          names.push(currentEntry);
        }
        
        // 解析角色名
        const nameMatch = trimmed.match(/角色[：:]\s*([^（(]+)/);
        if (nameMatch) {
          currentEntry = { name: nameMatch[1].trim() };
        } else {
          currentEntry = null;
        }
      }
      // 检测 preferredLayer 字段（缩进行）
      else if (currentEntry && trimmed.startsWith('preferredLayer')) {
        const layerMatch = trimmed.match(/preferredLayer\s*[：:]\s*(focus|presentSupporting|offstageRelated)/);
        if (layerMatch) {
          currentEntry.preferredLayer = layerMatch[1];
        }
      }
    }
    
    // 保存最后一个条目
    if (currentEntry) {
      names.push(currentEntry);
    }
    
    return names;
  };
  
  if (enterMatch) {
    castIntent.enter = parseNames(enterMatch[1]);
  }
  if (leaveMatch) {
    castIntent.leave = parseNames(leaveMatch[1]);
  }
  
  return castIntent;
}

/**
 * 从 <SceneMeta> 块中解析场景元数据
 * @param {string} sceneMetaBlock - SceneMeta 块内容
 * @returns {Object}
 */
function parseSceneMetaBlock(sceneMetaBlock) {
  const sceneMeta = {};
  const lines = sceneMetaBlock.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('-')) {
      const locationMatch = trimmed.match(/location_hint\s*[：:]\s*["']([^"']+)["']/);
      if (locationMatch) {
        sceneMeta.locationHint = locationMatch[1];
      }
      
      const tagsMatch = trimmed.match(/scene_tags\s*[：:]\s*\[([^\]]*)\]/);
      if (tagsMatch) {
        const inner = tagsMatch[1].trim();
        const tags = inner.length === 0
          ? []
          : inner
              .split(',')
              .map(t => t.trim().replace(/["']/g, ''))
              .filter(s => s.length > 0);
        // 覆盖语义：scene_tags 解析为 set，而非增量 add
        sceneMeta.sceneTags = { set: tags };
      }
    }
  }
  
  return sceneMeta;
}

/**
 * 从 XML 块解析完整的 ChangeSet
 * @param {string} text - 原始文本
 * @returns {ParseResult}
 */
function parseFromXmlBlocks(text) {
  const result = {
    rawText: text,
    changeSet: null,
    stateDelta: undefined,
    sceneDelta: undefined,
    entityDelta: undefined,
    worldIntent: undefined,
    parseMethod: 'xml',
    warnings: [],
    debugInfo: {}
  };
  
  // 提取 CE_UpdateState 块
  const updateStateBlock = extractXmlBlock(text, 'CE_UpdateState');
  if (updateStateBlock) {
    const varChangeBlock = extractXmlBlock(updateStateBlock, 'VarChange');
    if (varChangeBlock) {
      const variables = parseVarChangeBlock(varChangeBlock);
      if (variables.length > 0) {
        result.stateDelta = { variables };
        result.debugInfo.parsedVariables = variables.length;
      } else {
        result.warnings.push('CE_UpdateState 块存在但未解析到有效的变量操作');
      }
    } else {
      result.warnings.push('CE_UpdateState 块存在但缺少 VarChange 子块');
    }
  }
  
  // 提取 CE_UpdateScene 块
  const updateSceneBlock = extractXmlBlock(text, 'CE_UpdateScene');
  if (updateSceneBlock) {
    const sceneDelta = {};
    
    const castIntentBlock = extractXmlBlock(updateSceneBlock, 'CastIntent');
    if (castIntentBlock) {
      sceneDelta.castIntent = parseCastIntentBlock(castIntentBlock);
    }
    
    const sceneMetaBlock = extractXmlBlock(updateSceneBlock, 'SceneMeta');
    if (sceneMetaBlock) {
      const meta = parseSceneMetaBlock(sceneMetaBlock);
      Object.assign(sceneDelta, meta);
    }
    
    if (Object.keys(sceneDelta).length > 0) {
      result.sceneDelta = sceneDelta;
    } else {
      result.warnings.push('CE_UpdateScene 块存在但未解析到有效内容');
    }
  }
  
  // 提取 WorldContextIntent 块
  const worldIntentBlock = extractXmlBlock(text, 'WorldContextIntent');
  if (worldIntentBlock) {
    result.worldIntent = parseWorldContextIntentBlock(worldIntentBlock);
  }
  
  // 如果没有解析到任何有效块，添加警告
  if (!result.stateDelta && !result.sceneDelta && !result.worldIntent) {
    result.warnings.push('未检测到任何有效的 XML 块（CE_UpdateState/CE_UpdateScene/WorldContextIntent）');
  }
  
  // 附加 parsedPath 到变量操作
  if (result.stateDelta?.variables) {
    result.stateDelta = {
      ...result.stateDelta,
      variables: result.stateDelta.variables.map(op => withParsedPath(op))
    };
  }
  
  // 组合 ChangeSet
  result.changeSet = composeChangeSet(
    result.stateDelta,
    result.sceneDelta,
    result.entityDelta,
    result.worldIntent
  );
  
  return result;
}

/**
 * 解析 WorldContextIntent 块
 * @param {string} intentBlock - WorldContextIntent 块内容
 * @returns {Object}
 */
function parseWorldContextIntentBlock(intentBlock) {
  const intent = {
    raw: intentBlock,
    analysis: '',
    queries: []
  };
  
  // 提取 Analysis 块
  const analysisBlock = extractXmlBlock(intentBlock, 'Analysis');
  if (analysisBlock) {
    intent.analysis = analysisBlock.trim();
  }
  
  // 提取 Queries 块
  const queriesBlock = extractXmlBlock(intentBlock, 'Queries');
  if (!queriesBlock) {
    return intent;
  }
  
  // 解析每个查询条目（以 "- query:" 开头）
  const queryBlocks = queriesBlock.split(/(?=\s*-\s*query\s*[：:])/i);
  
  for (const block of queryBlocks) {
    const trimmed = block.trim();
    if (!trimmed || !trimmed.startsWith('-')) {
      continue;
    }
    
    const query = parseQueryEntry(trimmed);
    if (query) {
      intent.queries.push(query);
    }
  }
  
  return intent;
}

/**
 * 解析单个查询条目
 * @param {string} queryText - 查询文本块
 * @returns {Object|null}
 */
function parseQueryEntry(queryText) {
  if (!queryText || typeof queryText !== 'string') {
    return null;
  }

  const lines = queryText.split('\n').map(l => l.trim()).filter(l => l);
  const query = {};

  for (const line of lines) {
    // 解析 query: "..."
    const queryMatch = line.match(/query\s*[：:]\s*["']([^"']+)["']/);
    if (queryMatch) {
      query.query = queryMatch[1];
      continue;
    }

    // 解析 collections: [...]
    const collectionsMatch = line.match(/collections\s*[：:]\s*\[([^\]]*)\]/);
    if (collectionsMatch) {
      const inner = collectionsMatch[1].trim();
      if (inner) {
        query.collections = inner
          .split(',')
          .map(c => c.trim().replace(/["']/g, ''))
          .filter(c => c);
      }
      continue;
    }

    // 解析 importance: "..."
    const importanceMatch = line.match(/importance\s*[：:]\s*["']([^"']+)["']/);
    if (importanceMatch) {
      query.importance = importanceMatch[1];
      continue;
    }
  }

  // 验证必需字段
  if (!query.query) {
    return null;
  }

  return {
    query: query.query,
    collections: query.collections || [],
    importance: query.importance || 'nice_to_have'
  };
}

/**
 * 主解析入口：从 XML 块格式解析模型输出
 * 
 * 解析策略：
 * 1. 提取 XML 块（CE_UpdateState / CE_UpdateScene / WorldContextIntent）
 * 2. 逐行解析 ce.set() 调用，单行错误不影响整体
 * 3. 始终保留原始文本用于显示
 *
 * @param {string} text - 解析模型的原始输出文本
 * @returns {ParseResult}
 */
export function parseModelOutput(text) {
  if (typeof text !== "string" || !text.trim()) {
    return {
      rawText: text || '',
      changeSet: null,
      stateDelta: undefined,
      sceneDelta: undefined,
      entityDelta: undefined,
      worldIntent: undefined,
      parseMethod: 'none',
      warnings: ['输入文本为空'],
      debugInfo: {}
    };
  }

  // 使用 XML 块解析
  return parseFromXmlBlocks(text);
}