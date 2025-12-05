// 文档分块模块
// 负责将长文档分割成适合向量化的小块

/**
 * 分块配置
 * @typedef {Object} ChunkConfig
 * @property {string} strategy - 分块策略 ('fixed' | 'semantic' | 'sentence' | 'custom')
 * @property {Object} fixed - 固定长度分块配置
 * @property {Object} semantic - 语义分块配置
 * @property {Object} sentence - 句子分块配置
 * @property {Object} custom - 自定义分块配置
 */

/**
 * 文档块
 * @typedef {Object} Chunk
 * @property {string} id - 块ID
 * @property {string} docId - 所属文档ID
 * @property {string} text - 块文本内容
 * @property {Object} metadata - 元数据
 * @property {string} metadata.docTitle - 文档标题
 * @property {number} metadata.chunkIndex - 块索引
 * @property {number} metadata.startChar - 起始字符位置
 * @property {number} metadata.endChar - 结束字符位置
 */

/**
 * 使用固定长度策略分块文档
 * @param {string} text - 文档文本
 * @param {Object} config - 固定长度配置
 * @returns {Array<{text: string, startChar: number, endChar: number, chunkIndex: number}>}
 */
function chunkByFixedSize(text, config) {
  const { chunkSize = 512, overlap = 50 } = config;
  const chunks = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunkText = text.substring(start, end);
    
    // 跳过空白块
    if (chunkText.trim().length > 0) {
      chunks.push({
        text: chunkText,
        startChar: start,
        endChar: end,
        chunkIndex: chunkIndex++
      });
    }

    // 计算下一个块的起始位置（考虑重叠）
    start = end - overlap;
    
    // 如果剩余文本太短，直接结束
    if (start >= text.length - overlap) {
      break;
    }
  }

  return chunks;
}

/**
 * 使用语义分块策略（按段落/标题）
 * @param {string} text - 文档文本
 * @param {Object} config - 语义分块配置
 * @returns {Array<{text: string, startChar: number, endChar: number, chunkIndex: number}>}
 */
function chunkBySemantic(text, config) {
  const { minChunkSize = 200, maxChunkSize = 800, splitBy = 'paragraph' } = config;
  const chunks = [];
  let chunkIndex = 0;

  let segments = [];
  if (splitBy === 'paragraph') {
    // 按段落分割（双换行符）
    segments = text.split(/\n\n+/);
  } else if (splitBy === 'heading') {
    // 按标题分割（Markdown标题或数字标题）
    segments = text.split(/(?=^#{1,6}\s|\n\d+[\.\、])/m);
  } else if (splitBy === 'sentence') {
    // 按句子分割
    segments = text.split(/[。！？.!?]+/).filter(s => s.trim());
  } else {
    // 默认按段落
    segments = text.split(/\n\n+/);
  }

  let currentChunk = '';
  let currentStart = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i].trim();
    if (!segment) continue;

    const potentialChunk = currentChunk ? currentChunk + '\n\n' + segment : segment;

    if (potentialChunk.length > maxChunkSize && currentChunk.length >= minChunkSize) {
      // 当前块已达到最小大小且添加新段落会超过最大大小，保存当前块
      const endChar = currentStart + currentChunk.length;
      chunks.push({
        text: currentChunk,
        startChar: currentStart,
        endChar: endChar,
        chunkIndex: chunkIndex++
      });
      currentChunk = segment;
      currentStart = endChar;
    } else {
      // 继续累积
      currentChunk = potentialChunk;
    }
  }

  // 保存最后一个块
  if (currentChunk.trim().length > 0) {
    chunks.push({
      text: currentChunk,
      startChar: currentStart,
      endChar: currentStart + currentChunk.length,
      chunkIndex: chunkIndex++
    });
  }

  return chunks;
}

/**
 * 使用句子分块策略
 * @param {string} text - 文档文本
 * @param {Object} config - 句子分块配置
 * @returns {Array<{text: string, startChar: number, endChar: number, chunkIndex: number}>}
 */
function chunkBySentence(text, config) {
  const { sentencesPerChunk = 3, overlap = 1 } = config;
  const chunks = [];
  
  // 分割句子（支持中英文标点）
  const sentences = text.split(/[。！？.!?]+/).filter(s => s.trim());
  
  let chunkIndex = 0;
  let currentPos = 0;

  for (let i = 0; i < sentences.length; i += sentencesPerChunk - overlap) {
    const end = Math.min(i + sentencesPerChunk, sentences.length);
    const chunkSentences = sentences.slice(i, end);
    const chunkText = chunkSentences.join('。') + '。';
    
    if (chunkText.trim().length > 0) {
      chunks.push({
        text: chunkText,
        startChar: currentPos,
        endChar: currentPos + chunkText.length,
        chunkIndex: chunkIndex++
      });
      currentPos += chunkText.length;
    }

    // 如果剩余句子不足，结束
    if (end >= sentences.length) {
      break;
    }
  }

  return chunks;
}

/**
 * 检查文本是否包含完整句子
 * @param {string} text - 文本内容
 * @returns {boolean}
 */
function hasCompleteSentence(text) {
  // 检查是否包含句子结束标点（中英文）
  return /[。！？.!?]/.test(text);
}

/**
 * 验证块大小并生成警告
 * @param {string} text - 块文本
 * @param {Object} config - 配置
 * @returns {Array<string>} 警告信息数组
 */
function validateChunkSize(text, config) {
  const warnings = [];
  const { minChunkSize = 50, maxChunkSize = 2000, warnOnSize = true } = config;
  
  if (!warnOnSize) {
    return warnings;
  }
  
  const length = text.length;
  
  if (length < minChunkSize) {
    warnings.push(`块过短(${length}字符，建议≥${minChunkSize})，可能影响检索效果`);
  }
  
  if (length > maxChunkSize) {
    warnings.push(`块过长(${length}字符，建议≤${maxChunkSize})，建议进一步分割`);
  }
  
  // 检查是否包含完整句子
  if (length > 20 && !hasCompleteSentence(text)) {
    warnings.push('块可能不包含完整句子，建议检查分块位置');
  }
  
  return warnings;
}

/**
 * 使用自定义分块策略（用户手动标记）- 增强版
 * @param {string} text - 文档文本
 * @param {Object} config - 自定义分块配置
 * @param {string} [config.delimiter='---CHUNK---'] - 分隔符
 * @param {boolean} [config.preserveDelimiter=false] - 是否保留分隔符
 * @param {boolean} [config.trimWhitespace=true] - 是否去除首尾空白
 * @param {boolean} [config.ignoreEmpty=true] - 是否忽略空块
 * @param {number} [config.minChunkSize=50] - 最小块大小（字符数）
 * @param {number} [config.maxChunkSize=2000] - 最大块大小（字符数）
 * @param {boolean} [config.warnOnSize=true] - 是否对大小异常发出警告
 * @returns {Array<{text: string, startChar: number, endChar: number, chunkIndex: number, metadata: Object}>}
 */
function chunkByCustom(text, config) {
  const {
    delimiter = '---CHUNK---',
    preserveDelimiter = false,
    trimWhitespace = true,
    ignoreEmpty = true,
    minChunkSize = 50,
    maxChunkSize = 2000,
    warnOnSize = true
  } = config;
  
  const chunks = [];
  const segments = text.split(delimiter);
  let currentPos = 0;
  let chunkIndex = 0;

  for (let i = 0; i < segments.length; i++) {
    let segment = segments[i];
    const originalLength = segment.length;
    
    // 去除首尾空白
    if (trimWhitespace) {
      segment = segment.trim();
    }
    
    // 忽略空块
    if (ignoreEmpty && !segment) {
      currentPos += originalLength + delimiter.length;
      continue;
    }

    // 构建最终的块文本
    const chunkText = preserveDelimiter && i > 0
      ? delimiter + '\n' + segment
      : segment;

    // 验证块大小并生成警告
    const warnings = validateChunkSize(chunkText, {
      minChunkSize,
      maxChunkSize,
      warnOnSize
    });

    chunks.push({
      text: chunkText,
      startChar: currentPos,
      endChar: currentPos + chunkText.length,
      chunkIndex: chunkIndex++,
      metadata: {
        originalLength,
        processedLength: chunkText.length,
        hasDelimiter: preserveDelimiter && i > 0,
        segmentIndex: i,
        warnings: warnings.length > 0 ? warnings : undefined
      }
    });

    currentPos += originalLength + delimiter.length;
  }

  return chunks;
}

/**
 * 分块单个文档
 * @param {Object} document - 文档对象
 * @param {string} document.id - 文档ID
 * @param {string} document.title - 文档标题
 * @param {string} document.content - 文档内容
 * @param {ChunkConfig} config - 分块配置
 * @returns {Chunk[]}
 */
export function chunkDocument(document, config) {
  if (!document || !document.content) {
    return [];
  }

  const { strategy = 'fixed' } = config || {};
  
  let rawChunks = [];
  
  switch (strategy) {
    case 'fixed':
      rawChunks = chunkByFixedSize(document.content, config.fixed || { chunkSize: 512, overlap: 50 });
      break;
    case 'semantic':
      rawChunks = chunkBySemantic(document.content, config.semantic || { minChunkSize: 200, maxChunkSize: 800, splitBy: 'paragraph' });
      break;
    case 'sentence':
      rawChunks = chunkBySentence(document.content, config.sentence || { sentencesPerChunk: 3, overlap: 1 });
      break;
    case 'custom':
      rawChunks = chunkByCustom(document.content, config.custom || { delimiter: '---CHUNK---', preserveDelimiter: false });
      break;
    default:
      console.warn(`[RAG Chunker] 不支持的分块策略: ${strategy}，回退到固定长度分块`);
      rawChunks = chunkByFixedSize(document.content, { chunkSize: 512, overlap: 50 });
  }

  // 转换为标准的 Chunk 格式，保留原始metadata中的warnings等信息
  return rawChunks.map((chunk, index) => ({
    id: `${document.id}_chunk_${index}`,
    docId: document.id,
    text: chunk.text,
    metadata: {
      docTitle: document.title || document.id,
      chunkIndex: chunk.chunkIndex,
      startChar: chunk.startChar,
      endChar: chunk.endChar,
      // 保留原始metadata中的额外信息（如warnings）
      ...(chunk.metadata || {})
    }
  }));
}

/**
 * 批量分块多个文档
 * @param {Array<Object>} documents - 文档列表
 * @param {ChunkConfig} config - 分块配置
 * @returns {Chunk[]}
 */
export function chunkDocuments(documents, config) {
  if (!Array.isArray(documents)) {
    return [];
  }

  const allChunks = [];
  
  for (const doc of documents) {
    try {
      const chunks = chunkDocument(doc, config);
      allChunks.push(...chunks);
    } catch (err) {
      console.error(`[RAG Chunker] 分块文档失败: ${doc?.id || 'unknown'}`, err);
    }
  }

  return allChunks;
}

/**
 * 估算分块后的总块数
 * @param {Array<Object>} documents - 文档列表
 * @param {ChunkConfig} config - 分块配置
 * @returns {number}
 */
export function estimateChunkCount(documents, config) {
  if (!Array.isArray(documents)) {
    return 0;
  }

  const { strategy = 'fixed', fixed = { chunkSize: 512, overlap: 50 } } = config || {};
  let totalChunks = 0;

  for (const doc of documents) {
    if (!doc || !doc.content) continue;
    const contentLength = doc.content.length;
    
    if (strategy === 'fixed') {
      const { chunkSize = 512, overlap = 50 } = fixed;
      const effectiveChunkSize = chunkSize - overlap;
      const chunks = Math.ceil(contentLength / effectiveChunkSize);
      totalChunks += chunks;
    } else {
      // 其他策略的粗略估算
      totalChunks += Math.ceil(contentLength / 500);
    }
  }

  return totalChunks;
}

/**
 * 分析文档并建议分块位置
 * @param {string} text - 文档内容
 * @returns {Array<{position: number, line: number, reason: string, confidence: number, type: string, preview: string}>}
 */
function suggestChunkPositions(text) {
  const suggestions = [];
  const lines = text.split('\n');
  let currentPos = 0;

  // 1. 检测Markdown标题
  const headingRegex = /^(#{1,6})\s+(.+)$/;
  lines.forEach((line, lineIndex) => {
    const match = line.match(headingRegex);
    if (match) {
      const level = match[1].length;
      const title = match[2].trim();
      suggestions.push({
        position: currentPos,
        line: lineIndex + 1,
        reason: `Markdown ${level}级标题: "${title}"`,
        confidence: 0.9,
        type: 'heading',
        preview: line.substring(0, 50)
      });
    }
    currentPos += line.length + 1; // +1 for newline
  });

  // 2. 检测段落分隔（连续空行）
  currentPos = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim() && lines[i + 1] && !lines[i + 1].trim()) {
      suggestions.push({
        position: currentPos,
        line: i + 1,
        reason: '段落分隔（连续空行）',
        confidence: 0.6,
        type: 'paragraph',
        preview: '(空行)'
      });
    }
    currentPos += lines[i].length + 1;
  }

  // 3. 检测分隔线
  const separatorRegex = /^[-=*_]{3,}$/;
  currentPos = 0;
  lines.forEach((line, lineIndex) => {
    if (separatorRegex.test(line.trim())) {
      suggestions.push({
        position: currentPos,
        line: lineIndex + 1,
        reason: `分隔线: "${line.trim()}"`,
        confidence: 0.8,
        type: 'separator',
        preview: line.trim()
      });
    }
    currentPos += line.length + 1;
  });

  // 4. 检测列表开始
  const listRegex = /^[\s]*[-*+]\s+/;
  currentPos = 0;
  let inList = false;
  lines.forEach((line, lineIndex) => {
    const isListItem = listRegex.test(line);
    if (isListItem && !inList) {
      suggestions.push({
        position: currentPos,
        line: lineIndex + 1,
        reason: '列表开始',
        confidence: 0.7,
        type: 'list',
        preview: line.substring(0, 50)
      });
    }
    inList = isListItem;
    currentPos += line.length + 1;
  });

  // 5. 检测数字标题（如 "1. ", "一、"）
  const numberedHeadingRegex = /^[\s]*(\d+[\.\、]|[一二三四五六七八九十]+[\、.])\s+(.+)$/;
  currentPos = 0;
  lines.forEach((line, lineIndex) => {
    const match = line.match(numberedHeadingRegex);
    if (match) {
      const title = match[2].trim();
      suggestions.push({
        position: currentPos,
        line: lineIndex + 1,
        reason: `数字标题: "${title}"`,
        confidence: 0.75,
        type: 'numbered_heading',
        preview: line.substring(0, 50)
      });
    }
    currentPos += line.length + 1;
  });

  // 按位置排序并去重（相同位置只保留置信度最高的）
  const uniqueSuggestions = new Map();
  suggestions.forEach(suggestion => {
    const existing = uniqueSuggestions.get(suggestion.position);
    if (!existing || suggestion.confidence > existing.confidence) {
      uniqueSuggestions.set(suggestion.position, suggestion);
    }
  });

  return Array.from(uniqueSuggestions.values())
    .sort((a, b) => a.position - b.position);
}

/**
 * 在指定位置插入分隔符
 * @param {string} text - 原始文本
 * @param {Array<number>} positions - 插入位置数组（字符位置）
 * @param {string} [delimiter='---CHUNK---'] - 分隔符
 * @returns {string} 插入分隔符后的文本
 */
function insertDelimitersAtPositions(text, positions, delimiter = '---CHUNK---') {
  if (!Array.isArray(positions) || positions.length === 0) {
    return text;
  }

  // 按位置倒序排序，从后往前插入，避免位置偏移
  const sortedPositions = [...new Set(positions)].sort((a, b) => b - a);
  
  let result = text;
  for (const pos of sortedPositions) {
    // 确保位置有效
    if (pos >= 0 && pos <= result.length) {
      // 在位置前后添加换行，使分隔符独占一行
      const before = result.substring(0, pos);
      const after = result.substring(pos);
      
      // 检查前后是否已有换行
      const needsNewlineBefore = before.length > 0 && !before.endsWith('\n');
      const needsNewlineAfter = after.length > 0 && !after.startsWith('\n');
      
      result = before 
        + (needsNewlineBefore ? '\n' : '') 
        + delimiter 
        + (needsNewlineAfter ? '\n' : '') 
        + after;
    }
  }
  
  return result;
}

/**
 * 预览分块效果（不实际分块，只返回统计信息）
 * @param {string} text - 文档文本
 * @param {ChunkConfig} config - 分块配置
 * @returns {Object} 预览信息
 */
function previewChunking(text, config) {
  const { strategy = 'fixed' } = config || {};
  
  let rawChunks = [];
  
  try {
    switch (strategy) {
      case 'fixed':
        rawChunks = chunkByFixedSize(text, config.fixed || { chunkSize: 512, overlap: 50 });
        break;
      case 'semantic':
        rawChunks = chunkBySemantic(text, config.semantic || { minChunkSize: 200, maxChunkSize: 800, splitBy: 'paragraph' });
        break;
      case 'sentence':
        rawChunks = chunkBySentence(text, config.sentence || { sentencesPerChunk: 3, overlap: 1 });
        break;
      case 'custom':
        rawChunks = chunkByCustom(text, config.custom || { delimiter: '---CHUNK---', preserveDelimiter: false });
        break;
      default:
        rawChunks = chunkByFixedSize(text, { chunkSize: 512, overlap: 50 });
    }
  } catch (err) {
    console.error('[RAG Chunker] 预览分块失败:', err);
    return {
      success: false,
      error: err.message,
      chunkCount: 0,
      totalChars: text.length
    };
  }

  // 统计信息
  const chunkLengths = rawChunks.map(c => c.text.length);
  const avgLength = chunkLengths.length > 0 
    ? Math.round(chunkLengths.reduce((a, b) => a + b, 0) / chunkLengths.length)
    : 0;
  const minLength = chunkLengths.length > 0 ? Math.min(...chunkLengths) : 0;
  const maxLength = chunkLengths.length > 0 ? Math.max(...chunkLengths) : 0;

  // 收集所有警告
  const allWarnings = rawChunks
    .filter(c => c.metadata && c.metadata.warnings)
    .flatMap(c => c.metadata.warnings);

  return {
    success: true,
    chunkCount: rawChunks.length,
    totalChars: text.length,
    avgChunkLength: avgLength,
    minChunkLength: minLength,
    maxChunkLength: maxLength,
    warnings: allWarnings,
    warningCount: allWarnings.length,
    // 返回前3个块的预览
    preview: rawChunks.slice(0, 3).map(c => ({
      text: c.text.substring(0, 100) + (c.text.length > 100 ? '...' : ''),
      length: c.text.length,
      warnings: c.metadata?.warnings
    }))
  };
}

// 导出辅助函数供UI和其他模块使用
export { suggestChunkPositions, insertDelimitersAtPositions, previewChunking };