// Cast 管理模块：处理角色进场/退场与分层逻辑
// 实现设计文档第 9 节的 Cast 管理功能

/**
 * @typedef {Object|string} CastEnterItem
 * 可以是简单的字符串（角色名），或包含 preferredLayer 的对象
 * @property {string} name - 角色名称
 * @property {string} [preferredLayer] - 优先层级：focus/presentSupporting/offstageRelated
 */

/**
 * @typedef {Object} CastIntent
 * @property {(string|CastEnterItem)[]} [enter] - 建议进场的角色名称列表或对象列表
 * @property {string[]} [leave] - 建议退场的角色名称列表
 */

/**
 * @typedef {Object} CastLimits
 * @property {number} maxFocus - focus 层最大角色数
 * @property {number} maxPresentSupporting - presentSupporting 层最大角色数
 * @property {number} maxOffstageRelated - offstageRelated 层最大角色数
 */

/**
 * @typedef {Object} ApplyCastIntentOptions
 * @property {CastLimits} [limits] - Cast 各层的数量上限
 * @property {string[]} [alwaysKeep] - 始终保留的角色（如玩家）
 * @property {string[]} [fixedInScene] - 当前场景固定在场的角色
 * @property {import("./entities.js").CeEntityRuntime[]} [availableCharacters] - 可用角色列表（用于验证）
 */

/**
 * 默认的 Cast 数量限制
 * @type {CastLimits}
 */
const DEFAULT_LIMITS = {
  maxFocus: 3,
  maxPresentSupporting: 5,
  maxOffstageRelated: 10
};

/**
 * 应用 Cast 变更意图，返回新的 Cast 分层。
 * 
 * 规则：
 * 1. 始终保留 alwaysKeep 中的角色（如玩家）
 * 2. 保留 fixedInScene 中的角色（剧本标记的固定在场角色）
 * 3. 处理 enter 提案：
 *    - 优先加入 focus 层，若超限则降级到 presentSupporting
 *    - 若 presentSupporting 也超限，则只接受最相关的角色
 * 4. 处理 leave 提案：
 *    - 对 alwaysKeep 和 fixedInScene 中的角色忽略 leave 提案
 *    - 其他角色可以退场
 * 5. 确保各层不超过数量上限
 * 
 * @param {import("./engine-state.js").CeCastLayer} currentCast - 当前 Cast 状态
 * @param {CastIntent} castIntent - Cast 变更意图
 * @param {ApplyCastIntentOptions} [options] - 配置选项
 * @returns {import("./engine-state.js").CeCastLayer} 新的 Cast 状态
 */
export function applyCastIntent(currentCast, castIntent, options = {}) {
  const {
    limits = DEFAULT_LIMITS,
    alwaysKeep = [],
    fixedInScene = [],
    availableCharacters = []
  } = options;

  // 深拷贝当前 Cast
  const newCast = {
    focus: [...(currentCast.focus || [])],
    presentSupporting: [...(currentCast.presentSupporting || [])],
    offstageRelated: [...(currentCast.offstageRelated || [])]
  };

  // 创建保护名单（不能被移除的角色）
  const protectedNames = new Set([...alwaysKeep, ...fixedInScene]);

  // 处理 leave 提案（兼容字符串与对象 { name }）
  if (Array.isArray(castIntent.leave)) {
    for (const item of castIntent.leave) {
      let name = null;
      if (typeof item === "string") {
        name = item.trim();
      } else if (item && typeof item === "object") {
        name = String(item.name || "").trim();
      }
      const trimmedName = String(name || "").trim();
      if (!trimmedName || protectedNames.has(trimmedName)) {
        continue; // 跳过空名称和受保护的角色
      }

      // 从所有层中移除
      newCast.focus = newCast.focus.filter(n => n !== trimmedName);
      newCast.presentSupporting = newCast.presentSupporting.filter(n => n !== trimmedName);
      newCast.offstageRelated = newCast.offstageRelated.filter(n => n !== trimmedName);
    }
  }

  // 处理 enter 提案
  if (Array.isArray(castIntent.enter)) {
    for (const item of castIntent.enter) {
      // 支持字符串或对象格式
      let trimmedName;
      let preferredLayer = null;
      
      if (typeof item === "string") {
        trimmedName = item.trim();
      } else if (item && typeof item === "object") {
        trimmedName = String(item.name || "").trim();
        preferredLayer = item.preferredLayer || null;
      } else {
        continue;
      }
      
      if (!trimmedName) continue;

      // 检查角色是否已在任何层中
      const alreadyPresent =
        newCast.focus.includes(trimmedName) ||
        newCast.presentSupporting.includes(trimmedName) ||
        newCast.offstageRelated.includes(trimmedName);

      if (alreadyPresent) {
        continue; // 已在场，跳过
      }

      // 验证角色是否可用（如果提供了 availableCharacters）
      if (availableCharacters.length > 0) {
        const isAvailable = availableCharacters.some(
          char => char.name === trimmedName
        );
        if (!isAvailable) {
          // eslint-disable-next-line no-console
          console.warn(
            `[CharacterEngine] Cast 进场提案中的角色 "${trimmedName}" 不在可用角色列表中，跳过`
          );
          continue;
        }
      }

      // 根据 preferredLayer 决定加入哪一层
      let added = false;
      
      if (preferredLayer === "focus" && newCast.focus.length < limits.maxFocus) {
        newCast.focus.push(trimmedName);
        added = true;
      } else if (preferredLayer === "presentSupporting" && newCast.presentSupporting.length < limits.maxPresentSupporting) {
        newCast.presentSupporting.push(trimmedName);
        added = true;
      } else if (preferredLayer === "offstageRelated" && newCast.offstageRelated.length < limits.maxOffstageRelated) {
        newCast.offstageRelated.push(trimmedName);
        added = true;
      }
      
      // 如果没有指定层级或指定层级已满，使用默认逻辑（优先 focus）
      if (!added) {
        if (newCast.focus.length < limits.maxFocus) {
          newCast.focus.push(trimmedName);
        } else if (newCast.presentSupporting.length < limits.maxPresentSupporting) {
          newCast.presentSupporting.push(trimmedName);
        } else if (newCast.offstageRelated.length < limits.maxOffstageRelated) {
          newCast.offstageRelated.push(trimmedName);
        } else {
          // 所有层都满了，拒绝进场
          // eslint-disable-next-line no-console
          console.warn(
            `[CharacterEngine] Cast 所有层已满，无法加入角色 "${trimmedName}"`
          );
        }
      }
    }
  }

  // 确保各层不超过上限（防御性检查）
  if (newCast.focus.length > limits.maxFocus) {
    // 将超出的角色降级到 presentSupporting
    const overflow = newCast.focus.splice(limits.maxFocus);
    newCast.presentSupporting.unshift(...overflow);
  }

  if (newCast.presentSupporting.length > limits.maxPresentSupporting) {
    // 将超出的角色降级到 offstageRelated
    const overflow = newCast.presentSupporting.splice(limits.maxPresentSupporting);
    newCast.offstageRelated.unshift(...overflow);
  }

  if (newCast.offstageRelated.length > limits.maxOffstageRelated) {
    // 将超出的角色完全移除
    newCast.offstageRelated.splice(limits.maxOffstageRelated);
  }

  return newCast;
}

/**
 * 根据角色名称获取其在 Cast 中的层级。
 * 
 * @param {import("./engine-state.js").CeCastLayer} cast - Cast 状态
 * @param {string} characterName - 角色名称
 * @returns {"focus"|"presentSupporting"|"offstageRelated"|null} 角色所在层级，若不在 Cast 中则返回 null
 */
export function getCharacterLayer(cast, characterName) {
  if (!cast || typeof cast !== "object") return null;
  const name = String(characterName || "").trim();
  if (!name) return null;

  if (Array.isArray(cast.focus) && cast.focus.includes(name)) {
    return "focus";
  }
  if (Array.isArray(cast.presentSupporting) && cast.presentSupporting.includes(name)) {
    return "presentSupporting";
  }
  if (Array.isArray(cast.offstageRelated) && cast.offstageRelated.includes(name)) {
    return "offstageRelated";
  }

  return null;
}

/**
 * 将角色提升到指定层级。
 * 如果角色不在 Cast 中，则添加到指定层级。
 * 如果角色已在更高层级，则不做改变。
 * 
 * @param {import("./engine-state.js").CeCastLayer} cast - Cast 状态
 * @param {string} characterName - 角色名称
 * @param {"focus"|"presentSupporting"|"offstageRelated"} targetLayer - 目标层级
 * @param {CastLimits} [limits] - Cast 各层的数量上限
 * @returns {import("./engine-state.js").CeCastLayer} 新的 Cast 状态
 */
export function promoteCharacterTo(cast, characterName, targetLayer, limits = DEFAULT_LIMITS) {
  const newCast = {
    focus: [...(cast.focus || [])],
    presentSupporting: [...(cast.presentSupporting || [])],
    offstageRelated: [...(cast.offstageRelated || [])]
  };

  const name = String(characterName || "").trim();
  if (!name) return newCast;

  const currentLayer = getCharacterLayer(newCast, name);

  // 如果已在目标层级或更高层级，不做改变
  const layerPriority = { focus: 3, presentSupporting: 2, offstageRelated: 1 };
  if (currentLayer && layerPriority[currentLayer] >= layerPriority[targetLayer]) {
    return newCast;
  }

  // 从当前层级移除
  if (currentLayer) {
    newCast[currentLayer] = newCast[currentLayer].filter(n => n !== name);
  }

  // 添加到目标层级（如果未超限）
  const targetArray = newCast[targetLayer];
  const limit = limits[`max${targetLayer.charAt(0).toUpperCase() + targetLayer.slice(1)}`] || Infinity;

  if (targetArray.length < limit) {
    targetArray.push(name);
  } else {
    // 超限，尝试降级到下一层
    if (targetLayer === "focus" && newCast.presentSupporting.length < limits.maxPresentSupporting) {
      newCast.presentSupporting.push(name);
    } else if (
      (targetLayer === "focus" || targetLayer === "presentSupporting") &&
      newCast.offstageRelated.length < limits.maxOffstageRelated
    ) {
      newCast.offstageRelated.push(name);
    } else {
      // 所有层都满了，放弃提升
      // eslint-disable-next-line no-console
      console.warn(
        `[CharacterEngine] 无法将角色 "${name}" 提升到 ${targetLayer}，所有层已满`
      );
    }
  }

  return newCast;
}

/**
 * 获取 Cast 中所有角色的名称列表（按层级顺序）。
 * 
 * @param {import("./engine-state.js").CeCastLayer} cast - Cast 状态
 * @returns {string[]} 所有角色名称
 */
export function getAllCharactersInCast(cast) {
  if (!cast || typeof cast !== "object") return [];

  const all = [
    ...(Array.isArray(cast.focus) ? cast.focus : []),
    ...(Array.isArray(cast.presentSupporting) ? cast.presentSupporting : []),
    ...(Array.isArray(cast.offstageRelated) ? cast.offstageRelated : [])
  ];

  // 去重
  return Array.from(new Set(all));
}

/**
 * 创建一个空的 Cast 状态。
 * 
 * @returns {import("./engine-state.js").CeCastLayer}
 */
export function createEmptyCast() {
  return {
    focus: [],
    presentSupporting: [],
    offstageRelated: []
  };
}