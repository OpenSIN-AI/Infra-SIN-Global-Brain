/**
 * procedural-engine.js — Phase IV: Procedural Memory Engine
 *
 * 过程记忆引擎：从执行历史（episodes）中提取可重用的工作流（workflows）和脚本（scripts）。
 * 类似于 "how-to" 知识，可以跨项目重复使用。
 *
 * 关键特性：
 * - Workflow 提取：从成功执行的任务中提取步骤序列
 * - Script 模板化：将具体参数泛化为模板
 * - 版本控制：workflow 的版本迭代和退化检测
 * - 相似度匹配：根据当前任务推荐相关 workflow
 *
 * @module procedural-engine
 */

import { readJsonFile, writeJsonFile } from "../lib/storage.js";

const PROCEDURAL_DB = "procedural-memory.json";

const WorkflowStatus = {
  DRAFT: "draft",
  PUBLISHED: "published",
  DEPRECATED: "deprecated"
};

/**
 * 存储结构：
 * {
 *   workflows: [
 *     {
 *       id: "workflow-xxx",
 *       name: "Deploy to Vercel",
 *       description: "Standard deployment procedure for Next.js apps",
 *       status: "published",
 *       version: 3,
 *       tags: ["deployment", "vercel", "nextjs"],
 *       template: {
 *         steps: [
 *           { action: "run", command: "bun run build" },
 *           { action: "vercel-deploy", args: { prod: true } }
 *         ],
 *         parameters: {
 *           required: ["projectDir"],
 *           optional: ["teamId"]
 *         }
 *       },
 *       extractedFrom: ["session_abc123", "episode_xyz789"],
 *       successRate: 0.95,
 *       usageCount: 42,
 *       lastValidated: "2025-01-15T10:30:00Z",
 *       createdAt: "2025-01-10T08:00:00Z",
 *       updatedAt: "2025-01-15T10:30:00Z"
 *     }
 *   ],
 *   scripts: [
 *     {
 *       id: "script-xxx",
 *       language: "bash",
 *       code: "#!/bin/bash\nbun run build && vercel --prod",
 *       parameters: { ... },
 *       ...
 *     }
 *   ]
 * }
 */

/**
 * 初始化过程记忆数据库
 *
 * @param {string} layoutPath - PCPM 布局根目录
 * @returns {Promise<Object>} 空数据库结构
 */
export async function initProceduralDatabase(layoutPath) {
  const dbPath = `${layoutPath}/${PROCEDURAL_DB}`;
  const initial = {
    workflows: [],
    scripts: [],
    version: 1,
    createdAt: new Date().toISOString()
  };
  await writeJsonFile(dbPath, initial);
  return initial;
}

/**
 * 加载过程记忆数据库
 *
 * @param {string} layoutPath - PCPM 布局根目录
 * @returns {Promise<Object>} 数据库内容
 */
export async function loadProceduralDatabase(layoutPath) {
  const dbPath = `${layoutPath}/${PROCEDURAL_DB}`;
  try {
    return await readJsonFile(dbPath, { workflows: [], scripts: [], version: 1 });
  } catch (error) {
    if (error.code === "ENOENT") {
      return initProceduralDatabase(layoutPath);
    }
    throw error;
  }
}

/**
 * 保存过程记忆数据库
 *
 * @param {string} layoutPath - PCPM 布局根目录
 * @param {Object} data - 数据库内容
 * @returns {Promise<void>}
 */
export async function saveProceduralDatabase(layoutPath, data) {
  const dbPath = `${layoutPath}/${PROCEDURAL_DB}`;
  data.updatedAt = new Date().toISOString();
  await writeJsonFile(dbPath, data);
}

/**
 * 从执行历史中提取工作流
 * 分析一个成功的 episode（session transcript），提取可重用的步骤序列
 *
 * @param {Object} session - OpenCode session 数据（包含 transcript）
 * @param {Object} options - { name, description, tags }
 * @returns {Promise<Object>} 提取的 workflow
 */
export async function extractWorkflowFromSession(session, options = {}) {
  const transcript = session.transcript ?? [];
  if (transcript.length === 0) {
    throw new Error("Session has no transcript to extract from");
  }

  // 提取成功执行的动作序列
  const steps = [];
  for (let i = 0; i < transcript.length; i++) {
    const msg = transcript[i];
    if (msg.role === "assistant" && msg.toolCalls) {
      for (const toolCall of msg.toolCalls) {
        steps.push({
          action: toolCall.name,
          args: toolCall.arguments,
          result: msg.toolResults?.find((r) => r.name === toolCall.name)?.content
        });
      }
    }
  }

  // 识别参数化变量（连续的执行中的常量可作为参数）
  const parameterPatterns = detectParameterPatterns(steps);

  const workflow = {
    id: `workflow-${Date.now()}`,
    name: options.name || `Workflow from session ${session.sessionId}`,
    description: options.description || "Extracted from successful execution",
    status: WorkflowStatus.DRAFT,
    version: 1,
    tags: options.tags || ["extracted"],
    template: {
      steps: parameterizeSteps(steps, parameterPatterns),
      parameters: inferParameters(parameterPatterns)
    },
    extractedFrom: [session.sessionId],
    successRate: 1.0,
    usageCount: 0,
    lastValidated: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  return workflow;
}

/**
 * 检测参数模式：识别哪些值可能是可参数化的
 *
 * @param {Array} steps - 步骤列表
 * @returns {Object} 参数模式映射 { path: { values: Set, isParameter: boolean } }
 */
function detectParameterPatterns(steps) {
  const patterns = new Map();

  steps.forEach((step, idx) => {
    const traverse = (obj, path = "") => {
      if (obj && typeof obj === "object" && !Buffer.isBuffer(obj)) {
        Object.entries(obj).forEach(([key, value]) => {
          const fullPath = path ? `${path}.${key}` : key;
          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            const existing = patterns.get(fullPath) || { values: new Set(), isParameter: false };
            existing.values.add(String(value));
            patterns.set(fullPath, existing);
          } else if (Array.isArray(value)) {
            value.forEach((item, i) => traverse(item, `${fullPath}[${i}]`));
          } else if (typeof value === "object") {
            traverse(value, fullPath);
          }
        });
      }
    };
    traverse(step);
  });

  // 如果一个字段的值在不同步骤中变化，且变化规律一致（如文件名、路径），则标记为参数
  const parameters = {};
  for (const [path, data] of patterns) {
    if (data.values.size > 1) {
      // 如果值的变化看起来像"变量"（例如路径中的项目名、时间戳等），标记为参数
      if (looksLikeVariable(path, Array.from(data.values))) {
        data.isParameter = true;
        parameters[path] = {
          type: inferType(Array.from(data.values)),
          example: Array.from(data.values)[0],
          description: `Dynamic parameter for ${path}`
        };
      }
    }
  }

  return { patterns, parameters };
}

/**
 * 判断某个字段是否应该参数化
 */
function looksLikeVariable(path, values) {
  // 常见参数化路径关键词
  const variableKeywords = ["file", "path", "name", "url", "id", "time", "date", "count", "index", "token"];
  const hasVariableKeyword = variableKeywords.some((kw) => path.toLowerCase().includes(kw));
  
  // 如果值包含时间戳、随机ID等
  const hasDynamicValues = values.some((v) => /\d{10,}/.test(v) || /[a-f0-9]{32}/.test(v));

  return hasVariableKeyword || hasDynamicValues;
}

/**
 * 推断参数类型
 */
function inferType(values) {
  const allNumbers = values.every((v) => !isNaN(Number(v)));
  if (allNumbers) return "number";
  
  const allBooleans = values.every((v) => v === "true" || v === "false");
  if (allBooleans) return "boolean";
  
  return "string";
}

/**
 * 将步骤参数化：用占位符替换具体的值
 *
 * @param {Array} steps - 原始步骤
 * @param {Object} parameterPatterns - 参数模式
 * @returns {Array} 参数化后的步骤
 */
function parameterizeSteps(steps, parameterPatterns) {
  return steps.map((step) => {
    const newArgs = JSON.parse(JSON.stringify(step.args)); // 深拷贝

    const replacePlaceholders = (obj, path = "") => {
      if (obj && typeof obj === "object" && !Buffer.isBuffer(obj)) {
        Object.entries(obj).forEach(([key, value]) => {
          const fullPath = path ? `${path}.${key}` : key;
          if (parameterPatterns.parameters[fullPath]) {
            obj[key] = `{{${fullPath}}}`; // 使用 Handlebars 风格占位符
          } else if (typeof value === "object" && !Array.isArray(value) && value !== null) {
            replacePlaceholders(value, fullPath);
          }
        });
      }
    };

    replacePlaceholders(newArgs);
    return {
      action: step.action,
      args: newArgs,
      result: step.result
    };
  });
}

/**
 * 推断工作流的参数定义
 */
function inferParameters(parameterPatterns) {
  const params = {};
  for (const [path, meta] of Object.entries(parameterPatterns.parameters)) {
    params[path] = {
      type: meta.type,
      description: meta.description,
      example: meta.example,
      required: true
    };
  }
  return params;
}

/**
 * 匹配工作流：根据当前任务描述找到最相关的 workflow
 *
 * @param {string} task - 当前任务描述
 * @param {Array} workflows - 可用工作流列表
 * @param {Object} options - { threshold, limit }
 * @returns {Array} 匹配的工作流（按相关性排序）
 */
export function matchWorkflows(task, workflows, options = {}) {
  const { threshold = 0.3, limit = 5 } = options;
  const taskLower = task.toLowerCase();
  
  const scored = workflows
    .filter((w) => w.status === WorkflowStatus.PUBLISHED)
    .map((workflow) => {
      let score = 0;

      // 1. 标签匹配
      const tagMatches = workflow.tags.filter((tag) => taskLower.includes(tag.toLowerCase())).length;
      score += tagMatches * 0.3;

      // 2. 名称/描述关键词匹配
      const combinedText = `${workflow.name} ${workflow.description}`.toLowerCase();
      const keywords = taskLower.split(/\s+/).filter((w) => w.length > 3);
      const keywordMatches = keywords.filter((kw) => combinedText.includes(kw)).length;
      score += keywordMatches * 0.2;

      // 3. 成功率和使用次数加权
      score += (workflow.successRate || 0) * 0.3;
      score += Math.min((workflow.usageCount || 0) / 100, 0.2);

      return { workflow, score };
    })
    .filter((item) => item.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.workflow);

  return scored;
}

/**
 * 实例化工作流：用具体参数填充 workflow 模板
 *
 * @param {Object} workflow - 工作流定义
 * @param {Object} parameters - 实际参数值 { paramName: value }
 * @returns {Object} 实例化后的步骤序列
 */
export function instantiateWorkflow(workflow, parameters = {}) {
  const { template } = workflow;
  const instantiatedSteps = [];

  for (const step of template.steps) {
    const instantiatedArgs = substituteParameters(step.args, parameters);
    instantiatedSteps.push({
      action: step.action,
      args: instantiatedArgs
    });
  }

  return {
    workflowId: workflow.id,
    workflowName: workflow.name,
    parameters,
    steps: instantiatedSteps,
    version: workflow.version
  };
}

/**
 * 参数替换：将模板中的占位符替换为实际值
 *
 * @param {Object} args - 模板参数
 * @param {Object} parameters - 实际参数
 * @returns {Object} 替换后的参数
 */
function substituteParameters(args, parameters) {
  const stringify = (obj) => JSON.stringify(obj);
  const parse = (str) => JSON.parse(str);

  const jsonStr = stringify(args);
  let result = jsonStr;

  // 替换所有占位符 {{param.path}}
  for (const [paramPath, value] of Object.entries(parameters)) {
    const placeholder = `"{{${paramPath}}}"`; // 带引号的占位符
    const replacement = JSON.stringify(value);
    result = result.replaceAll(placeholder, replacement);

    // 同时尝试无引号版本（用于数字/布尔）
    const placeholderRaw = `{{${paramPath}}}`;
    if (!result.includes(placeholderRaw)) {
      result = result.replaceAll(placeholderRaw, replacement);
    }
  }

  return parse(result);
}

/**
 * 记录工作流使用：增加 usageCount，更新成功/失败统计
 *
 * @param {string} layoutPath - PCPM 布局根目录
 * @param {string} workflowId - 工作流 ID
 * @param {boolean} success - 执行是否成功
 * @returns {Promise<void>}
 */
export async function recordWorkflowUsage(layoutPath, workflowId, success) {
  const db = await loadProceduralDatabase(layoutPath);
  const workflow = db.workflows.find((w) => w.id === workflowId);

  if (workflow) {
    workflow.usageCount = (workflow.usageCount || 0) + 1;
    if (!workflow.successRate) workflow.successRate = success ? 1.0 : 0.0;
    else workflow.successRate = ((workflow.successRate * (workflow.usageCount - 1)) + (success ? 1 : 0)) / workflow.usageCount;
    workflow.updatedAt = new Date().toISOString();

    await saveProceduralDatabase(layoutPath, db);
  }
}

/**
 * 提升工作流版本：当工作流被修改时创建新版本
 *
 * @param {string} layoutPath - PCPM 布局根目录
 * @param {string} workflowId - 原工作流 ID
 * @param {Object} updatedTemplate - 更新后的模板
 * @param {string} reason - 更新原因
 * @returns {Promise<Object>} 新版本工作流
 */
export async function versionWorkflow(layoutPath, workflowId, updatedTemplate, reason) {
  const db = await loadProceduralDatabase(layoutPath);
  const oldWorkflow = db.workflows.find((w) => w.id === workflowId);

  if (!oldWorkflow) {
    throw new Error(`Workflow ${workflowId} not found`);
  }

  // 创建新版本（保留历史，状态设为 DRAFT）
  const newWorkflow = {
    ...oldWorkflow,
    id: `workflow-${Date.now()}`,
    version: oldWorkflow.version + 1,
    status: WorkflowStatus.DRAFT,
    template: updatedTemplate,
    previousVersion: oldWorkflow.id,
    versionHistory: [...(oldWorkflow.versionHistory || []), {
      version: oldWorkflow.version,
      deprecatedAt: new Date().toISOString(),
      reason
    }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  // 旧版本设为 deprecated
  oldWorkflow.status = WorkflowStatus.DEPRECATED;
  oldWorkflow.updatedAt = new Date().toISOString();

  db.workflows.push(newWorkflow);
  await saveProceduralDatabase(layoutPath, db);

  return newWorkflow;
}

/**
 * 发布工作流： Draft → Published
 *
 * @param {string} layoutPath - PCPM 布局根目录
 * @param {string} workflowId - 工作流 ID
 * @returns {Promise<Object>} 发布的工作流
 */
export async function publishWorkflow(layoutPath, workflowId) {
  const db = await loadProceduralDatabase(layoutPath);
  const workflow = db.workflows.find((w) => w.id === workflowId);

  if (!workflow) {
    throw new Error(`Workflow ${workflowId} not found`);
  }

  if (workflow.status !== WorkflowStatus.DRAFT) {
    throw new Error(`Workflow must be in DRAFT status to publish, current: ${workflow.status}`);
  }

  workflow.status = WorkflowStatus.PUBLISHED;
  workflow.publishedAt = new Date().toISOString();
  workflow.updatedAt = new Date().toISOString();

  await saveProceduralDatabase(layoutPath, db);
  return workflow;
}

/**
 * 查找可重用的脚本（例如 bash、Python 脚本）
 *
 * @param {string} language - 脚本语言（bash、python、node）
 * @param {string} purpose - 用途关键词
 * @returns {Promise<Array>} 匹配的脚本列表
 */
export async function findScripts(language = null, purpose = null) {
  const dbPath = `${process.env.PCPM_LAYOUT ?? "."}/${PROCEDURAL_DB}`;
  const db = await loadProceduralDatabase(dbPath);
  let scripts = db.scripts;

  if (language) {
    scripts = scripts.filter((s) => s.language === language);
  }

  if (purpose) {
    const purposeLower = purpose.toLowerCase();
    scripts = scripts.filter((s) =>
      (s.tags?.some((tag) => tag.includes(purposeLower))) ||
      s.description?.toLowerCase().includes(purposeLower)
    );
  }

  return scripts.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  initProceduralDatabase,
  loadProceduralDatabase,
  saveProceduralDatabase,
  extractWorkflowFromSession,
  matchWorkflows,
  instantiateWorkflow,
  recordWorkflowUsage,
  versionWorkflow,
  publishWorkflow,
  findScripts,
  WorkflowStatus
};
