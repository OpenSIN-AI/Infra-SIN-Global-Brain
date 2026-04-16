/**
 * sleep-engine.js — Phase IV: Sleep Cycle Engine
 *
 * 异步内存 consolidation engine。模拟生物睡眠周期：
 * - 检测系统空闲期（idle periods）
 * - 在空闲期间执行后台 consolidation（知识压缩、去重、图优化）
 * - 不阻塞主线程，使用事件驱动架构
 * - 支持 wake/sleep 手动控制
 *
 * 关键概念：
 * - Idle Detection: 基于任务间隔、CPU负载、用户活动
 * - Consolidation: 合并相似条目、优化MAGMA图、清理过期缓存
 * - Non-blocking: 所有操作分片（chunked）执行，避免长时间阻塞
 *
 * @module sleep-engine
 */

import { calculateEscalationIndex, archiveLowEscalationEntries } from "./invalidation-engine.js";
import { compressMemoryEntry } from "./invalidation-engine.js";

/**
 * Sleep Cycle 状态
 */
export const SleepState = {
  AWAKE: "awake",       // 正常运转，不执行 consolidation
  LIGHT: "light",       // 轻度睡眠，执行轻量级 cleanup
  DEEP: "deep",         // 深度睡眠，执行heavy consolidation
  REM: "rem"            // REM阶段，执行记忆重组和图谱优化
};

/**
 * Consolidation 任务队列
 */
const consolidationQueue = new Map(); // key: priority, value: task[]
let currentState = SleepState.AWAKE;
let idleTimer = null;
let isConsolidating = false;

/**
 * 配置
 */
const CONFIG = {
  // 空闲检测阈值
  idleThresholdMs: 5000,      // 5秒无任务视为空闲
  cpuThreshold: 0.3,          // CPU使用率低于30%视为低负载

  // Consolidation强度控制
  maxChunkSize: 50,           // 每个chunk最多处理50个条目
  chunkDelayMs: 100,          // chunk之间100ms暂停，避免阻塞

  // 状态转换
  lightSleepDurationMs: 30000,    // 轻度睡眠30秒
  deepSleepDurationMs: 120000,    // 深度睡眠2分钟
  remDurationMs: 60000,            // REM阶段1分钟

  // 触发条件
  archiveThreshold: 0.12,          // EI<0.12触发归档
  compressThreshold: 0.25          // EI<0.25触发压缩
};

/**
 * 设置系统空闲状态（从外部调用）
 * 当检测到系统无任务时调用 this.sleepEngine. setIdle(true)
 * 当新任务到达时调用 this.sleepEngine. setIdle(false)
 *
 * @param {boolean} idle - 是否进入空闲状态
 */
export function setIdle(idle) {
  if (idle && currentState === SleepState.AWAKE) {
    // 开始空闲计时
    startIdleTimer();
  } else if (!idle) {
    // 中断空闲，唤醒
    cancelIdleTimer();
    setState(SleepState.AWAKE);
    stopConsolidation();
  }
}

/**
 * 启动空闲计时器
 */
function startIdleTimer() {
  idleTimer = setTimeout(() => {
    // 进入轻度睡眠
    setState(SleepState.LIGHT);
    scheduleConsolidation(SleepState.LIGHT, CONFIG.lightSleepDurationMs);
  }, CONFIG.idleThresholdMs);
}

/**
 * 取消空闲计时器
 */
function cancelIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

/**
 * 设置当前睡眠状态（带事件通知）
 *
 * @param {string} newState - 新的睡眠状态
 */
function setState(newState) {
  const oldState = currentState;
  currentState = newState;

  // 事件通知（可被外部监听）
  emitStateChange(oldState, newState);
}

/**
 * 状态变更事件发射器（简单实现，可连接EventEmitter）
 */
function emitStateChange(from, to) {
  // 这里可以连接到全局事件总线
  // eventBus.emit('sleep.stateChanged', { from, to, timestamp: Date.now() });
  console.log(`[SleepEngine] State: ${from} → ${to}`);
}

/**
 * 调度 consolidation 任务
 *
 * @param {string} state - 睡眠状态（决定consolidation强度）
 * @param {number} durationMs - 持续时长
 */
function scheduleConsolidation(state, durationMs) {
  if (isConsolidating) return;

  isConsolidating = true;
  const startTime = Date.now();
  const endTime = startTime + durationMs;

  // 分片执行 consolidation
  runConsolidationChunk(state).then(() => {
    // 如果时间未到，等待短暂休息后继续下一chunk
    if (Date.now() < endTime && currentState === state) {
      setTimeout(() => {
        if (currentState === state && !isConsolidating) {
          scheduleConsolidation(state, endTime - Date.now());
        }
      }, CONFIG.chunkDelayMs);
    } else {
      // consolidation完成或超时
      isConsolidating = false;
      advanceSleepState(state);
    }
  }).catch((err) => {
    console.error("[SleepEngine] Consolidation error:", err);
    isConsolidating = false;
    setState(SleepState.AWAKE); // 出错则唤醒
  });
}

/**
 * 执行单个 consolidation chunk
 *
 * @param {string} state - 当前睡眠状态（决定任务类型）
 */
async function runConsolidationChunk(state) {
  switch (state) {
    case SleepState.LIGHT:
      await runLightConsolidation();
      break;
    case SleepState.DEEP:
      await runDeepConsolidation();
      break;
    case SleepState.REM:
      await runRemConsolidation();
      break;
  }
}

/**
 * 轻度睡眠：执行轻量级 cleanup
 * - 删除过期日志
 * - 清理重复缓存
 * - 更新访问频率统计
 */
async function runLightConsolidation() {
  // TODO: 集成实际的存储层
  // 1. 删除30天前的临时缓存
  // 2. 压缩低访问频率的条目
  // 3. 更新accessCount统计
  console.log("[SleepEngine.LIGHT] Light cleanup running");
}

/**
 * 深度睡眠：执行 heavy consolidation
 * - 归档低EI条目
 * - 重新计算Escalation Index
 * - 执行Ebbinghaus decay
 * - 删除陈旧的知识条目
 */
async function runDeepConsolidation() {
  console.log("[SleepEngine.DEEP] Deep consolidation running");

  // 1. 归档低EI条目（需要access to knowledge store）
  // const entries = await knowledgeStore.getAllActive();
  // const decayed = decayKnowledgeEntries(entries, { now: new Date() });
  // const { active, archived } = archiveLowEscalationEntries(decayed);
  // await knowledgeStore.save(active);
  // await knowledgeStore.archive(archived);

  // 2. 重建索引（text search, vector embeddings）
  // await rebuildIndices();

  // 这里需要集成实际的存储 API
}

/**
 * REM阶段：执行记忆重组和图谱优化
 * - MAGMA图结构优化（合并相似节点）
 * - 边权重重新计算
 * - 预测性预加载（为高频意图预取知识）
 * - 生成记忆间的关联性分析
 */
async function runRemConsolidation() {
  console.log("[SleepEngine.REM] Memory reassembly and graph optimization");

  // 1. MAGMA图优化（需要MAGMA graph access）
  // await optimizeGraph();

  // 2. 预取高频意图的知识
  // const frequentIntents = await detectFrequentIntents();
  // for (const intent of frequentIntents) {
  //   await prefetchKnowledgeForIntent(intent);
  // }

  // 3. 关联性分析报告
  // await generateAssociationReport();
}

/**
 * 推进睡眠状态机
 * AWAKE → LIGHT → DEEP → REM → AWAKE
 *
 * @param {string} currentState - 当前状态
 */
function advanceSleepState(currentState) {
  switch (currentState) {
    case SleepState.LIGHT:
      setState(SleepState.DEEP);
      scheduleConsolidation(SleepState.DEEP, CONFIG.deepSleepDurationMs);
      break;
    case SleepState.DEEP:
      setState(SleepState.REM);
      scheduleConsolidation(SleepState.REM, CONFIG.remDurationMs);
      break;
    case SleepState.REM:
    default:
      setState(SleepState.AWAKE);
      break;
  }
}

/**
 * 停止 consolidation（当系统唤醒时调用）
 */
function stopConsolidation() {
  isConsolidating = false;
  // 清理待处理的chunk
  consolidationQueue.clear();
}

/**
 * 手动触发 consolidation（外部调用）
 * 用于强制立即执行指定强度的 consolidation
 *
 * @param {string} intensity - "light" | "deep" | "rem"
 * @returns {Promise<void>}
 */
export async function triggerConsolidation(intensity = "light") {
  const stateMap = {
    light: SleepState.LIGHT,
    deep: SleepState.DEEP,
    rem: SleepState.REM
  };
  const state = stateMap[intensity] || SleepState.LIGHT;

  setState(state);
  await runConsolidationChunk(state);
  setState(SleepState.AWAKE);
}

/**
 * 获取当前睡眠状态
 *
 * @returns {string} 当前状态
 */
export function getSleepState() {
  return currentState;
}

/**
 * 检查是否正在 consolidation
 *
 * @returns {boolean}
 */
export function isSleepActive() {
  return isConsolidating || currentState !== SleepState.AWAKE;
}

/**
 * 获取睡眠引擎统计信息
 *
 * @returns {Object} 统计信息
 */
export function getSleepStats() {
  return {
    currentState,
    isConsolidating,
    queueSize: Array.from(consolidationQueue.values()).reduce((sum, tasks) => sum + tasks.length, 0),
    config: { ...CONFIG }
  };
}

/**
 * 更新配置（热重载）
 *
 * @param {Object} newConfig - 新的配置项
 */
export function updateConfig(newConfig) {
  Object.assign(CONFIG, newConfig);
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  setIdle,
  triggerConsolidation,
  getSleepState,
  isSleepActive,
  getSleepStats,
  updateConfig,
  SleepState
};
