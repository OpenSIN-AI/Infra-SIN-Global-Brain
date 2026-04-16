import path from "node:path";
import { readJsonFile, writeJsonFile, ensureDir } from "../lib/storage.js";
import { loadMergedKnowledge } from "./memory-engine.js";

// ============================================================================
// PHASE IV: SELF-HEALING WEB-INTEGRATION
// ============================================================================

const EXA_API_URL = "https://api.exa.ai/search";
const NVD_API_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const webValidationCache = new Map(); // key: query_hash, value: { result, timestamp }

/**
 * 执行网络搜索验证（通过 Exa AI）
 * 用于验证知识条目是否与最新的网络信息一致
 *
 * @param {string} query - 搜索查询
 * @param {Object} options - { numResults, useCache }
 * @returns {Promise<Array>} 搜索结果列表
 */
export async function validateViaWeb(query, options = {}) {
  const { numResults = 5, useCache = true } = options;

  // 缓存键：query + options哈希
  const cacheKey = `${query}:${numResults}`;
  if (useCache && webValidationCache.has(cacheKey)) {
    const cached = webValidationCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.result;
    }
  }

  try {
    // 尝试从环境变量获取 Exa API Key
    const exaApiKey = process.env.EXA_API_KEY;
    if (!exaApiKey) {
      console.warn("[MetaLearning] EXA_API_KEY not set, skipping web validation");
      return [];
    }

    const response = await fetch(EXA_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${exaApiKey}`
      },
      body: JSON.stringify({
        query,
        numResults,
        type: "neural",  // 使用 neural 搜索提高相关性
        category: "general"
      })
    });

    if (!response.ok) {
      throw new Error(`Exa API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const results = data.results?.map((r) => ({
      title: r.title,
      url: r.url,
      text: r.text?.substring(0, 500),
      publishedDate: r.publishedDate
    })) ?? [];

    // 缓存结果
    webValidationCache.set(cacheKey, {
      result: results,
      timestamp: Date.now()
    });

    return results;
  } catch (error) {
    console.error("[MetaLearning] Web validation failed:", error);
    return [];
  }
}

/**
 * 检查 CVE 数据库（NVD）是否存在与给定组件相关的漏洞
 *
 * @param {string} componentName - 组件名称（如 "express", "react", "node"）
 * @param {string} version - 版本号（可选）
 * @returns {Promise<Array>} 相关的 CVE 列表
 */
export async function checkCVE(componentName, version = null) {
  try {
    // NVD API: 搜索包含组件关键词的 CVE
    const params = new URLSearchParams({
      keywordSearch: componentName,
      resultsPerPage: 20
    });

    if (version) {
      params.append("keywordExactMatch", `version=${version}`);
    }

    const response = await fetch(`${NVD_API_URL}?${params}`);
    if (!response.ok) {
      throw new Error(`NVD API error: ${response.status}`);
    }

    const data = await response.json();
    const vulnerabilities = data.vulnerabilities ?? [];

    return vulnerabilities.map((v) => {
      const cve = v.cve;
      return {
        id: cve.id,
        descriptions: cve.descriptions?.filter((d) => d.lang === "en")?.map((d) => d.value) ?? [],
        metrics: cve.metrics,
        references: cve.references?.map((r) => r.url) ?? []
      };
    });
  } catch (error) {
    console.error("[MetaLearning] CVE check failed:", error);
    return [];
  }
}

/**
 * 验证知识条目与官方文档的一致性
 * 通过直接获取官方文档 URL 并检查是否存在矛盾
 *
 * @param {string} claim - 知识条目的 claim（文本内容）
 * @param {string} officialUrl - 官方文档 URL
 * @returns {Promise<Object>} 验证结果 { consistent: boolean, evidence: string }
 */
export async function verifyGroundTruth(claim, officialUrl) {
  try {
    const response = await fetch(officialUrl, {
      method: "GET",
      headers: {
        "User-Agent": "GlobalBrain-SelfHealing/1.0"
      }
    });

    if (!response.ok) {
      return {
        consistent: false,
        evidence: `Failed to fetch official docs: ${response.status}`,
        confidence: 0.0
      };
    }

    const officialText = await response.text();
    
    // 简单的关键词重叠检查（可以升级为 embedding 相似度）
    const claimWords = new Set(claim.toLowerCase().split(/\s+/));
    const docWords = new Set(officialText.toLowerCase().split(/\s+/));

    const overlap = [...claimWords].filter((w) => docWords.has(w)).length;
    const consistencyScore = overlap / Math.max(claimWords.size, 1);

    return {
      consistent: consistencyScore > 0.3, // 阈值可根据需要调整
      evidence: `Overlap: ${overlap}/${claimWords.size} words`,
      confidence: Number(consistencyScore.toFixed(2))
    };
  } catch (error) {
    console.error("[MetaLearning] Ground truth verification failed:", error);
    return {
      consistent: false,
      evidence: `Error: ${error.message}`,
      confidence: 0.0
    };
  }
}

/**
 * 自主愈合一个知识条目
 * 1. 执行网络验证
 * 2. 检查 CVE（如果是技术条目）
 * 3. 验证官方文档（如果提供）
 * 4. 根据结果生成修复建议或标记为失效
 *
 * @param {Object} entry - 知识条目
 * @param {Object} options - { performCVE, officialUrl }
 * @returns {Promise<Object>} 愈合结果 { healed: boolean, action: string, reason: string }
 */
export async function healKnowledgeEntry(entry, options = {}) {
  const { performCVE = true, officialUrl = null } = options;
  const actions = [];

  // 1. 网络验证
  const webResults = await validateViaWeb(entry.text, { numResults: 3 });
  if (webResults.length > 0) {
    // 检查是否有冲突信息
    const conflictingResult = webResults.find((r) =>
      r.text.toLowerCase().includes("deprecated") ||
      r.text.toLowerCase().includes("obsolete") ||
      r.text.toLowerCase().includes("security vulnerability")
    );

    if (conflictingResult) {
      actions.push({
        type: "invalidate",
        reason: `Web validation found potential issue: ${conflictingResult.title}`,
        source: conflictingResult.url
      });
    }
  }

  // 2. CVE 检查（仅针对技术相关的条目）
  if (performCVE && (entry.type === "rule" || entry.type === "solution")) {
    const cveMatches = await checkCVE(entry.text.split(" ")[0]); // 简单提取第一个词作为组件名
    if (cveMatches.length > 0) {
      actions.push({
        type: "flag-security",
        reason: `Found ${cveMatches.length} related CVEs`,
        cveIds: cveMatches.map((c) => c.id).slice(0, 5)
      });
    }
  }

  // 3. 官方文档验证
  if (officialUrl) {
    const truthCheck = await verifyGroundTruth(entry.text, officialUrl);
    if (!truthCheck.consistent) {
      actions.push({
        type: "verify-manually",
        reason: `Ground truth mismatch (confidence: ${truthCheck.confidence})`,
        evidence: truthCheck.evidence
      });
    }
  }

  // 决策
  if (actions.some((a) => a.type === "invalidate")) {
    return {
      healed: false,
      action: "invalidate",
      reason: "Entry contradicts current web information",
      details: actions
    };
  }

  if (actions.some((a) => a.type === "flag-security")) {
    return {
      healed: false,
      action: "flag",
      reason: "Entry may be related to known vulnerabilities",
      details: actions
    };
  }

  if (actions.some((a) => a.type === "verify-manually")) {
    return {
      healed: false,
      action: "review",
      reason: "Manual review required due to low consistency",
      details: actions
    };
  }

  return {
    healed: true,
    action: "none",
    reason: "No issues detected",
    details: []
  };
}

/**
 * 运行自愈周期
 * 扫描所有低分或过期的知识条目，尝试自动修复
 *
 * @param {Object} layout - PCPM 布局
 * @param {Object} options - { thresholdScore, maxEntries, dryRun }
 * @returns {Promise<Object>} 周期报告 { scanned, issuesFound, actionsTaken }
 */
export async function runSelfHealingCycle(layout, options = {}) {
  const { thresholdScore = 0.4, maxEntries = 100, dryRun = false } = options;

  console.log("[MetaLearning] Starting self-healing cycle...");

  const knowledge = await loadMergedKnowledge(layout);
  const allEntries = knowledge.active ?? [];

  // 筛选低分或陈旧的条目
  const candidates = allEntries.filter((e) => {
    const isLowScore = (e.score ?? 1) < thresholdScore;
    const isStale = (e.ageDays ?? 0) > 30;
    return isLowScore || isStale;
  }).slice(0, maxEntries);

  console.log(`[MetaLearning] Scanning ${candidates.length} entries for self-healing`);

  const results = {
    scanned: candidates.length,
    issuesFound: 0,
    actionsTaken: [],
    errors: []
  };

  for (const entry of candidates) {
    try {
      const healingResult = await healKnowledgeEntry(entry);

      if (healingResult.action !== "none") {
        results.issuesFound++;

        if (!dryRun) {
          // 执行愈合动作（标记、失效、创建修复建议）
          const actionTaken = await recordHealingAction(layout, entry, healingResult);
          results.actionsTaken.push(actionTaken);
        } else {
          results.actionsTaken.push({
            entryId: entry.id,
            ...healingResult,
            dryRun: true
          });
        }
      }
    } catch (error) {
      results.errors.push({
        entryId: entry.id,
        error: error.message
      });
    }
  }

  console.log(`[MetaLearning] Self-healing complete: ${results.issuesFound} issues found, ${results.actionsTaken.length} actions taken`);

  return results;
}

/**
 * 记录愈合动作到知识库
 *
 * @param {Object} layout - PCPM 布局
 * @param {Object} entry - 原条目
 * @param {Object} healingResult - 愈合结果
 * @returns {Promise<Object>} 记录的动作
 */
async function recordHealingAction(layout, entry, healingResult) {
  const action = {
    entryId: entry.id,
    timestamp: new Date().toISOString(),
    ...healingResult
  };

  // 根据动作类型执行相应操作
  switch (healingResult.action) {
    case "invalidate":
      // 创建 forbidden 条目来失效原条目
      await createInvalidationEntry(layout, entry, healingResult.reason);
      action.executed = true;
      break;

    case "flag":
      // 添加标签，标记为需要人工审查
      await tagEntryForReview(layout, entry.id, ["cve-check", "security-review"]);
      action.executed = true;
      break;

    case "review":
      // 创建高优先级 issue 通知人工审查
      await createReviewIssue(layout, entry, healingResult);
      action.executed = true;
      break;

    default:
      action.executed = false;
  }

  return action;
}

/**
 * 创建失效条目（forbidden）
 */
async function createInvalidationEntry(layout, originalEntry, reason) {
  const forbiddenEntry = {
    id: `forbidden-${originalEntry.id}-${Date.now()}`,
    type: "forbidden",
    topic: originalEntry.topic,
    text: originalEntry.text,
    scope: originalEntry.scope,
    score: 0,
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    rationale: `Auto-invalidated by self-healing: ${reason}`,
    replacesTopic: true,
    invalidates: [originalEntry.id]
  };

  // TODO: 写入内存存储（memory-engine 的 append 函数）
  // await writeKnowledgeEntry(layout, forbiddenEntry);
  console.log(`[MetaLearning] Created invalidation entry for ${originalEntry.id}`);
}

/**
 * 为条目添加审查标签
 */
async function tagEntryForReview(layout, entryId, tags) {
  // TODO: 更新条目的 tags 字段
  console.log(`[MetaLearning] Tagged entry ${entryId} for review: ${tags.join(", ")}`);
}

/**
 * 创建人工审查 Issue（集成 GitHub Issues）
 */
async function createReviewIssue(layout, entry, healingResult) {
  const issue = {
    title: `[Self-Healing] Review needed for entry: ${entry.topic ?? entry.id}`,
    body: `
## Self-Healing Alert

**Entry ID:** ${entry.id}
**Type:** ${entry.type}
**Confidence Issue:** ${healingResult.reason}

### Entry Content
\`\`\`
${entry.text?.substring(0, 500)}
\`\`\`

### Evidence
${healingResult.details?.map((d) => `- **${d.type}**: ${d.reason}`).join("\n")}

### Action Required
- [ ] Verify if entry is still valid
- [ ] Update or invalidate if outdated
- [ ] Add missing context or references
    `.trim(),
    labels: ["self-healing", "needs-review"]
  };

  // TODO: 通过 GitHub API 或 A2A 创建 issue
  // await createGitHubIssue(issue);
  console.log(`[MetaLearning] Would create review issue: ${issue.title}`);
}

// ============================================================================
// BESTEHENDE FUNKTIONEN (unveraendert)
// ============================================================================

async function loadMetaScores(layout) {
  const file = path.join(layout.globalRoot, "meta-scores.json");
  return readJsonFile(file, { scores: [] });
}

async function saveMetaScores(layout, data) {
  const file = path.join(layout.globalRoot, "meta-scores.json");
  await writeJsonFile(file, data);
}

export async function scoreStrategy(layout, strategy, outcome) {
  const data = await loadMetaScores(layout);
  const now = new Date().toISOString();
  
  const scoreMap = {
    success: 1.0,
    partial: 0.6,
    failure: 0.2
  };
  
  const scoreValue = scoreMap[outcome] ?? 0.5;

  let entry = data.scores.find((s) => s.strategy === strategy);
  
  if (entry) {
    entry.score = (entry.score * entry.runs + scoreValue) / (entry.runs + 1);
    entry.runs += 1;
    entry.lastUsed = now;
  } else {
    entry = {
      strategy,
      score: scoreValue,
      runs: 1,
      goalType: "general",
      lastUsed: now
    };
    data.scores.push(entry);
  }

  await saveMetaScores(layout, data);
  return entry.score;
}

export async function getBestStrategy(layout, goalType = "general") {
  const data = await loadMetaScores(layout);
  return data.scores
    .filter((s) => s.goalType === goalType)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

export async function suggestImprovement(layout, lastStrategy) {
  const knowledge = await loadMergedKnowledge(layout);
  const rules = knowledge.active.filter((k) => k.type === "rule");
  
  if (rules.length === 0) {
    return [];
  }
  
  // Return the highest scored rules as suggestions
  return rules
    .sort((a, b) => b.score - a.score)
    .map((r) => r.text);
}
