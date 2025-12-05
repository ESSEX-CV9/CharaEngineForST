// 查询解析模块
// 负责解析 WorldContextIntent XML块

/**
 * 从文本中提取 XML 块
 * @param {string} text - 原始文本
 * @param {string} tagName - XML 标签名
 * @returns {string|null}
 */
function extractXmlBlock(text, tagName) {
  if (!text || !tagName) {
    return null;
  }
  
  const regex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : null;
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
 * 解析 WorldContextIntent XML块
 * @param {string} text - 包含 WorldContextIntent 的文本
 * @returns {Object|null}
 */
export function parseWorldContextIntent(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  // 提取 WorldContextIntent 块
  const intentBlock = extractXmlBlock(text, 'WorldContextIntent');
  if (!intentBlock) {
    return null;
  }

  const result = {
    raw: intentBlock,
    analysis: '',
    queries: []
  };

  // 提取 Analysis 块
  const analysisBlock = extractXmlBlock(intentBlock, 'Analysis');
  if (analysisBlock) {
    result.analysis = analysisBlock;
  }

  // 提取 Queries 块
  const queriesBlock = extractXmlBlock(intentBlock, 'Queries');
  if (!queriesBlock) {
    return result;
  }

  // 解析每个查询条目
  // 查询条目以 "- query:" 开头
  const queryBlocks = queriesBlock.split(/(?=\s*-\s*query\s*[：:])/i);
  
  for (const block of queryBlocks) {
    const trimmed = block.trim();
    if (!trimmed || !trimmed.startsWith('-')) {
      continue;
    }

    const query = parseQueryEntry(trimmed);
    if (query) {
      result.queries.push(query);
    }
  }

  return result;
}

/**
 * 验证 WorldContextIntent 对象
 * @param {Object} intent - WorldContextIntent 对象
 * @returns {Object} 验证结果 {valid: boolean, errors: string[]}
 */
export function validateWorldContextIntent(intent) {
  const errors = [];

  if (!intent || typeof intent !== 'object') {
    errors.push('WorldContextIntent 对象无效');
    return { valid: false, errors };
  }

  if (!Array.isArray(intent.queries)) {
    errors.push('queries 字段必须是数组');
  } else if (intent.queries.length === 0) {
    errors.push('至少需要一个查询');
  } else {
    // 验证每个查询
    for (let i = 0; i < intent.queries.length; i++) {
      const query = intent.queries[i];
      if (!query.query || typeof query.query !== 'string') {
        errors.push(`查询[${i}]缺少有效的 query 字段`);
      }
      if (query.importance && !['must_have', 'nice_to_have'].includes(query.importance)) {
        errors.push(`查询[${i}]的 importance 值无效: ${query.importance}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 从 WorldContextIntent 生成检索配置
 * @param {Object} intent - WorldContextIntent 对象
 * @param {Object} defaultConfig - 默认配置
 * @returns {Object}
 */
export function intentToRetrievalConfig(intent, defaultConfig = {}) {
  if (!intent || !Array.isArray(intent.queries)) {
    return defaultConfig;
  }

  return {
    queries: intent.queries,
    tokenBudget: defaultConfig.tokenBudget || 2000,
    topK: defaultConfig.topK || 5,
    similarityThreshold: defaultConfig.similarityThreshold || 0.7,
    deduplicate: defaultConfig.deduplicate !== false,
    deduplicateBy: defaultConfig.deduplicateBy || 'docId'
  };
}

/**
 * 格式化 WorldContextIntent 为可读文本
 * @param {Object} intent - WorldContextIntent 对象
 * @returns {string}
 */
export function formatWorldContextIntent(intent) {
  if (!intent || typeof intent !== 'object') {
    return '';
  }

  const lines = [];
  
  if (intent.analysis) {
    lines.push('【分析】');
    lines.push(intent.analysis);
    lines.push('');
  }

  if (Array.isArray(intent.queries) && intent.queries.length > 0) {
    lines.push('【查询列表】');
    for (let i = 0; i < intent.queries.length; i++) {
      const query = intent.queries[i];
      lines.push(`${i + 1}. ${query.query}`);
      if (query.collections && query.collections.length > 0) {
        lines.push(`   集合: ${query.collections.join(', ')}`);
      }
      if (query.importance) {
        lines.push(`   重要性: ${query.importance}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}