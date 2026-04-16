/**
 * retrieval-planner.js — Phase IV: Intent-Aware Retrieval Planner
 *
 *独立的检索规划引擎。根据任务意图智能决定：
 * - 需要检索的知识类型（rule, decision, mistake, solution, fact, forbidden）
 * - 图谱遍历深度（graphHops）
 * - 历史上下文是否必要
 * - 任务优先级（security=critical, debugging=high, normal）
 *
 * 与context-engine.js的buildRetrievalPlan()不同，这个引擎是独立的，
 * 可以被其他引擎调用，也可以独立运行。
 *
 * @module retrieval-planner
 */

/**
 * 意图类别枚举
 */
export const Intent = {
  DEBUGGING: "debugging",
  CREATION: "creation",
  REFACTORING: "refactoring",
  DEPLOYMENT: "deployment",
  SECURITY: "security",
  GENERAL: "general"
};

/**
 * MAGMA Graph Dimensions
 * 4 orthogonal views of the knowledge graph
 */
export const GraphDimension = {
  SEMANTIC: "semantic",   // Meaning-based relationships (embedding similarity)
  TEMPORAL: "temporal",   // Time-based relationships (chronology, recency)
  CAUSAL: "causal",       // Cause-effect relationships (invalidation, conflict)
  ENTITY: "entity"        // Entity-centric relationships (same topic/project)
};

/**
 * 意图配置映射：每种意图对应的知识类型、图跳跃深度、优先级
 */
const INTENT_CONFIG = {
  [Intent.DEBUGGING]: {
    requiredKnowledgeTypes: ["mistake", "solution", "rule", "forbidden"],
    graphHops: 2,
    priority: "high"
  },
  [Intent.CREATION]: {
    requiredKnowledgeTypes: ["rule", "decision", "fact"],
    graphHops: 1,
    priority: "normal"
  },
  [Intent.REFACTORING]: {
    requiredKnowledgeTypes: ["rule", "mistake", "solution", "decision"],
    graphHops: 2,
    priority: "normal"
  },
  [Intent.DEPLOYMENT]: {
    requiredKnowledgeTypes: ["rule", "forbidden", "solution"],
    graphHops: 3,
    priority: "normal"
  },
  [Intent.SECURITY]: {
    requiredKnowledgeTypes: ["forbidden", "rule", "mistake"],
    graphHops: 3,
    priority: "critical"
  },
  [Intent.GENERAL]: {
    requiredKnowledgeTypes: ["rule", "decision", "mistake"],
    graphHops: 1,
    priority: "normal"
  }
};

/**
 * 意图关键词映射
 */
const INTENT_KEYWORDS = [
  { intent: Intent.DEBUGGING, patterns: [/fix/, /bug/, /error/, /crash/, /fail/, /patch/, /debug/, /repair/] },
  { intent: Intent.CREATION, patterns: [/create/, /build/, /implement/, /develop/, /add/, /new/, /feature/] },
  { intent: Intent.REFACTORING, patterns: [/refactor/, /optimize/, /improve/, /clean/, /restructure/] },
  { intent: Intent.DEPLOYMENT, patterns: [/deploy/, /release/, /publish/, /launch/] },
  { intent: Intent.SECURITY, patterns: [/security/, /vulnerab/, /cve/, /auth/, /token/, /secret/] }
];

/**
 * 检测任务意图
 *
 * @param {string} task - 任务描述
 * @returns {string} 意图类别（来自Intent枚举）
 */
export function detectIntent(task) {
  const taskLower = String(task ?? "").toLowerCase();

  for (const { intent, patterns } of INTENT_KEYWORDS) {
    for (const pattern of patterns) {
      if (pattern.test(taskLower)) {
        return intent;
      }
    }
  }

  return Intent.GENERAL;
}

/**
 * 构建检索计划
 *
 * @param {string} task - 要执行的任务
 * @param {Object} context - 当前上下文（可选，包含goal.constraints, session信息等）
 * @returns {Object} 检索计划
 */
export function buildRetrievalPlan(task, context = {}) {
  const intent = detectIntent(task);
  const config = INTENT_CONFIG[intent];

  return {
    intent,
    task,
    constraints: context.goal?.constraints ?? [],
    requiredKnowledgeTypes: config.requiredKnowledgeTypes,
    graphHops: config.graphHops,
    historicalContext: Boolean(context?.session?.lastUserMessage),
    priority: config.priority,
    generatedAt: new Date().toISOString()
  };
}

/**
 * 评估检索计划的复杂度
 * 用于决定是否需要更深的图遍历或更多的计算资源
 *
 * @param {Object} plan - 检索计划
 * @returns {number} 复杂度分数（0-1）
 */
export function assessComplexity(plan) {
  const weights = {
    knowledgeTypes: 0.30,
    graphHops: 0.40,
    priority: 0.30
  };

  const knowledgeTypeScore = Math.min(plan.requiredKnowledgeTypes.length / 6, 1);
  const graphHopScore = Math.min(plan.graphHops / 3, 1);
  const priorityScore = plan.priority === "critical" ? 1 : plan.priority === "high" ? 0.7 : 0.3;

  return Number((
    weights.knowledgeTypes * knowledgeTypeScore +
    weights.graphHops * graphHopScore +
    weights.priority * priorityScore
  ).toFixed(4));
}

/**
 * 合并多个检索计划（用于复杂任务）
 *
 * @param {Array<Object>} plans - 检索计划数组
 * @returns {Object} 合并后的综合计划
 */
export function mergeRetrievalPlans(plans) {
  if (plans.length === 0) {
    return buildRetrievalPlan("default");
  }

  if (plans.length === 1) {
    return plans[0];
  }

  // 合并知识类型（去重）
  const allKnowledgeTypes = new Set();
  plans.forEach((plan) => {
    plan.requiredKnowledgeTypes.forEach((type) => allKnowledgeTypes.add(type));
  });

  // 最大图跳跃深度
  const maxGraphHops = Math.max(...plans.map((p) => p.graphHops));

  // 最高优先级
  const priorityOrder = { critical: 3, high: 2, normal: 1 };
  const highestPriority = plans.reduce((highest, plan) =>
    priorityOrder[plan.priority] > priorityOrder[highest.priority] ? plan : highest
  ).priority;

  return {
    intent: "composite",
    task: plans.map((p) => p.task).join("; "),
    constraints: [...new Set(plans.flatMap((p) => p.constraints))],
    requiredKnowledgeTypes: Array.from(allKnowledgeTypes),
    graphHops: maxGraphHops,
    historicalContext: plans.some((p) => p.historicalContext),
    priority: highestPriority,
    generatedAt: new Date().toISOString(),
    composedFrom: plans.length
  };
}
