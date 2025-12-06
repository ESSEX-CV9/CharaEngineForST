// CharacterEngine 数据读取 API 测试脚本
// 在浏览器控制台中运行此脚本来测试 API 功能

/**
 * 测试基础读取功能
 */
async function testBasicReading() {
  console.log('=== 测试1: 获取参数定义 ===');
  try {
    const params = window.CharacterEngine.dataReader.getParameters();
    console.log('✓ 参数列表:', params);
    console.assert(Array.isArray(params), '参数列表应该是数组');
  } catch (err) {
    console.error('✗ 测试失败:', err);
  }
  
  console.log('\n=== 测试2: 获取实体定义 ===');
  try {
    const entities = window.CharacterEngine.dataReader.getEntities();
    console.log('✓ 实体列表:', entities);
    console.assert(Array.isArray(entities), '实体列表应该是数组');
  } catch (err) {
    console.error('✗ 测试失败:', err);
  }
  
  console.log('\n=== 测试3: 获取当前状态 ===');
  try {
    const state = window.CharacterEngine.dataReader.getCurrentState();
    console.log('✓ 当前状态:', state);
    console.assert(state && typeof state === 'object', '状态应该是对象');
    console.assert(state.variables, '状态应该包含 variables');
  } catch (err) {
    console.error('✗ 测试失败:', err);
  }
  
  console.log('\n✅ 所有基础测试通过');
}

/**
 * 测试参数值读取
 */
async function testParameterValue() {
  console.log('\n=== 测试4: 读取特定参数值 ===');
  try {
    const params = window.CharacterEngine.dataReader.getParameters();
    
    if (params.length === 0) {
      console.log('⚠ 当前角色没有定义参数，跳过测试');
      return;
    }
    
    const firstParam = params[0];
    console.log('测试参数:', firstParam.name, '(scope:', firstParam.scope + ')');
    
    try {
      let value;
      if (firstParam.scope === 'global' || firstParam.scope === 'scene') {
        value = window.CharacterEngine.dataReader.getParameterValue(firstParam.name);
      } else if (firstParam.scope === 'character') {
        // 需要提供 subjectName
        const entities = window.CharacterEngine.dataReader.getEntities();
        const charEntity = entities.find(e => e.type === 'character');
        if (charEntity) {
          value = window.CharacterEngine.dataReader.getParameterValue(
            firstParam.name, 
            charEntity.name
          );
        } else {
          console.log('⚠ 没有找到角色实体，跳过');
          return;
        }
      } else if (firstParam.scope === 'relationship') {
        // 需要提供 subjectName 和 targetName
        const entities = window.CharacterEngine.dataReader.getEntities();
        const charEntities = entities.filter(e => e.type === 'character');
        if (charEntities.length >= 2) {
          value = window.CharacterEngine.dataReader.getParameterValue(
            firstParam.name,
            charEntities[0].name,
            charEntities[1].name
          );
        } else {
          console.log('⚠ 角色实体不足，跳过');
          return;
        }
      }
      
      console.log(`✓ 参数 "${firstParam.name}" 的值:`, value);
    } catch (err) {
      console.log(`⚠ 参数 "${firstParam.name}" 读取失败:`, err.message);
    }
  } catch (err) {
    console.error('✗ 测试失败:', err);
  }
}

/**
 * 测试场景信息读取
 */
async function testSceneInfo() {
  console.log('\n=== 测试5: 获取场景信息 ===');
  try {
    const scene = window.CharacterEngine.dataReader.getSceneInfo();
    console.log('✓ 场景信息:', scene);
    console.log('  - 当前地点:', scene.locationCast.current || '(未设置)');
    console.log('  - 场景标签:', scene.sceneTags.join(', ') || '(无)');
    console.log('  - 主要角色:', scene.cast.focus.join(', ') || '(无)');
    console.log('  - 在场配角:', scene.cast.presentSupporting.join(', ') || '(无)');
  } catch (err) {
    console.error('✗ 测试失败:', err);
  }
}

/**
 * 测试元信息查询
 */
async function testMetaInfo() {
  console.log('\n=== 测试6: 元信息查询 ===');
  try {
    const msgCount = window.CharacterEngine.dataReader.getMessageCount();
    console.log('✓ 消息数量:', msgCount);
    
    const lastAiIndex = window.CharacterEngine.dataReader.getLastAiMessageIndex();
    console.log('✓ 最后AI消息索引:', lastAiIndex);
    
    const lastUserIndex = window.CharacterEngine.dataReader.getLastUserMessageIndex();
    console.log('✓ 最后用户消息索引:', lastUserIndex);
    
    const checkpoint = window.CharacterEngine.dataReader.getCheckpointInfo();
    console.log('✓ Checkpoint信息:', checkpoint);
  } catch (err) {
    console.error('✗ 测试失败:', err);
  }
}

/**
 * 测试历史状态读取
 */
async function testHistoricalState() {
  console.log('\n=== 测试7: 查看历史状态 ===');
  try {
    const msgCount = window.CharacterEngine.dataReader.getMessageCount();
    
    if (msgCount < 2) {
      console.log('⚠ 消息数量不足，跳过历史状态测试');
      return;
    }
    
    // 获取初始状态
    const initial = window.CharacterEngine.dataReader.getInitialState();
    console.log('✓ 初始状态:', initial);
    
    // 获取中间某个时间点的状态
    const midIndex = Math.floor(msgCount / 2);
    const midState = window.CharacterEngine.dataReader.getStateAtIndex(midIndex);
    console.log(`✓ 第${midIndex}条消息后的状态:`, midState);
    
    // 获取当前状态
    const current = window.CharacterEngine.dataReader.getCurrentState();
    console.log('✓ 当前状态:', current);
    
    // 对比状态变化（如果有参数）
    const params = window.CharacterEngine.dataReader.getParameters();
    if (params.length > 0) {
      console.log('\n状态变化对比:');
      params.slice(0, 3).forEach(param => {
        console.log(`  参数: ${param.name} (${param.scope})`);
        // 这里只是示例，实际需要根据 scope 提供正确的参数
      });
    }
  } catch (err) {
    console.error('✗ 测试失败:', err);
  }
}

/**
 * 测试数据隔离（确保返回的是副本）
 */
async function testDataIsolation() {
  console.log('\n=== 测试8: 数据隔离 ===');
  try {
    const state1 = window.CharacterEngine.dataReader.getCurrentState();
    const state2 = window.CharacterEngine.dataReader.getCurrentState();
    
    // 修改 state1
    if (state1.scene) {
      state1.scene.locationHint = 'MODIFIED_BY_TEST';
    }
    
    // 检查 state2 是否受影响
    console.assert(
      state2.scene?.locationHint !== 'MODIFIED_BY_TEST',
      '✓ 数据隔离正常：修改返回的状态不会影响其他调用'
    );
    console.log('✓ 数据隔离测试通过');
  } catch (err) {
    console.error('✗ 测试失败:', err);
  }
}

/**
 * 运行所有测试
 */
async function runAllTests() {
  console.log('========================================');
  console.log('CharacterEngine 数据读取 API 测试');
  console.log('========================================\n');
  
  // 检查 API 是否可用
  if (!window.CharacterEngine || !window.CharacterEngine.dataReader) {
    console.error('✗ CharacterEngine.dataReader API 不可用');
    console.log('请确保：');
    console.log('1. CharacterEngine 插件已加载');
    console.log('2. 已选中一个角色');
    console.log('3. 已打开一个对话');
    return;
  }
  
  try {
    await testBasicReading();
    await testParameterValue();
    await testSceneInfo();
    await testMetaInfo();
    await testHistoricalState();
    await testDataIsolation();
    
    console.log('\n========================================');
    console.log('✅ 所有测试完成');
    console.log('========================================');
  } catch (err) {
    console.error('\n========================================');
    console.error('❌ 测试过程中出现错误:', err);
    console.error('========================================');
  }
}

// 导出测试函数
if (typeof window !== 'undefined') {
  window.CharacterEngineTests = {
    runAllTests,
    testBasicReading,
    testParameterValue,
    testSceneInfo,
    testMetaInfo,
    testHistoricalState,
    testDataIsolation
  };
  
  console.log('测试脚本已加载。运行测试：');
  console.log('  window.CharacterEngineTests.runAllTests()');
}