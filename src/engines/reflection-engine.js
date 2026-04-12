import { validateExecutionResult } from "./control-engine.js";

export function buildReflectionPrompt({ task, executionResult, planBefore, planAfter, contextBefore }) {
  return [
    "SYSTEM:",
    "You are reviewing a coding step for persistent memory extraction.",
    "Return valid JSON only.",
    "",
    "TASK:",
    task,
    "",
    "PLAN BEFORE:",
    JSON.stringify(planBefore, null, 2),
    "",
    "PLAN AFTER:",
    JSON.stringify(planAfter, null, 2),
    "",
    "CONTEXT BEFORE:",
    JSON.stringify(contextBefore, null, 2),
    "",
    "EXECUTION RESULT:",
    JSON.stringify(executionResult, null, 2),
    "",
    "OUTPUT SCHEMA:",
    JSON.stringify(
      {
        summary: "brief reflection summary",
        memoryUpdate: {
          facts: ["validated fact"],
          mistakes: ["repeatable mistake to avoid"],
          solutions: ["solution that worked"],
          rules: ["cross-project rule"],
          invalidations: [
            {
              matchText: "obsolete text",
              reason: "why it is obsolete"
            }
          ]
        }
      },
      null,
      2
    )
  ].join("\n");
}

function buildFallbackReflection({ task, executionResult, planBefore, planAfter }) {
  const strategyChanged = planBefore.strategy !== planAfter.strategy;
  const facts = [`Latest result summary: ${executionResult.resultSummary}`];
  const rules = [];

  if (strategyChanged) {
    facts.push(`Strategy changed from ${planBefore.strategy} to ${planAfter.strategy}.`);
    rules.push("When strategy changes, invalidate the superseded strategy before the next run.");
  }

  return {
    summary: `Fallback reflection completed for task: ${task}`,
    memoryUpdate: {
      facts,
      rules
    }
  };
}

export async function reflectExecution({
  task,
  executionResult,
  planBefore,
  planAfter,
  contextBefore,
  runner,
  cwd = process.cwd(),
  disableLlm = false
}) {
  if (disableLlm || !runner) {
    return buildFallbackReflection({ task, executionResult, planBefore, planAfter });
  }

  try {
    const prompt = buildReflectionPrompt({ task, executionResult, planBefore, planAfter, contextBefore });
    const response = await runner.runJson(prompt, { cwd });

    return {
      summary: response.summary ?? `Reflection completed for task: ${task}`,
      memoryUpdate: validateExecutionResult({
        resultSummary: "reflection-wrapper",
        planUpdate: {},
        memoryUpdate: response.memoryUpdate ?? {}
      }).memoryUpdate
    };
  } catch {
    return buildFallbackReflection({ task, executionResult, planBefore, planAfter });
  }
}
