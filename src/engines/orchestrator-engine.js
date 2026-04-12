import { createRepositoryLayout } from "../lib/layout.js";
import { writeJsonFile } from "../lib/storage.js";
import { buildActiveContext, buildExecutionPrompt } from "./context-engine.js";
import {
  assertStrategyIsNotForbidden,
  buildDryRunExecution,
  validateExecutionResult
} from "./control-engine.js";
import { ensureGoal } from "./goal-engine.js";
import { applyMemoryUpdate, loadMergedKnowledge } from "./memory-engine.js";
import { OpenCodeRunner } from "./opencode-runner.js";
import {
  applyPlanUpdate,
  buildInitialPlan,
  loadLatestPlan,
  savePlanVersion
} from "./plan-engine.js";
import { reflectExecution } from "./reflection-engine.js";
import {
  appendSessionMessage,
  buildSessionSummary,
  loadSessionMessages,
  loadSessionSummary,
  writeSessionSummary
} from "./session-engine.js";
import { syncProjectBrain } from "./sync-engine.js";

export async function runOrchestration({
  rootDir = process.cwd(),
  projectId,
  projectRoot = null,
  goalId,
  goalDescription,
  task,
  sessionId = `session-${Date.now()}`,
  constraints = [],
  executionResult = null,
  runner = null,
  dryRun = false,
  skipReflection = false
}) {
  const layout = await createRepositoryLayout({ rootDir, projectId });
  const goal = await ensureGoal(layout, {
    goalId,
    description: goalDescription,
    constraints
  });

  let planBefore = await loadLatestPlan(layout, goal.id);

  if (!planBefore) {
    planBefore = buildInitialPlan({
      projectId: layout.projectId,
      goalId: goal.id,
      goalDescription,
      constraints
    });
    await savePlanVersion(layout, planBefore);
  }

  await appendSessionMessage(layout, {
    sessionId,
    role: "user",
    text: task,
    metadata: {
      goalId: goal.id,
      eventType: "task"
    }
  });

  const knowledgeBefore = await loadMergedKnowledge(layout);
  const previousSessionSummary = await loadSessionSummary(layout, sessionId);
  const contextBefore = buildActiveContext({
    goal,
    plan: planBefore,
    knowledge: knowledgeBefore,
    sessionSummary: previousSessionSummary
  });

  const prompt = buildExecutionPrompt({
    goal,
    plan: planBefore,
    context: contextBefore,
    task
  });

  const activeRunner = runner ?? new OpenCodeRunner();
  const resolvedExecution = executionResult
    ? validateExecutionResult(executionResult)
    : dryRun
      ? buildDryRunExecution({ task, currentStrategy: planBefore.strategy })
      : validateExecutionResult(await activeRunner.runJson(prompt, { cwd: rootDir }));

  const planAfter = applyPlanUpdate(planBefore, resolvedExecution.planUpdate);
  assertStrategyIsNotForbidden(planAfter, contextBefore);
  await savePlanVersion(layout, planAfter);

  const initialMemoryChanges = await applyMemoryUpdate(layout, resolvedExecution.memoryUpdate, {
    projectId: layout.projectId,
    goalId: goal.id,
    sessionId,
    sourceType: "execution"
  });

  await appendSessionMessage(layout, {
    sessionId,
    role: "assistant",
    text: JSON.stringify(resolvedExecution),
    metadata: {
      goalId: goal.id,
      eventType: "execution-result"
    }
  });

  let reflection = null;
  let reflectionMemoryChanges = { addedEntries: [], invalidatedEntries: [] };

  if (!skipReflection) {
    reflection = await reflectExecution({
      task,
      executionResult: resolvedExecution,
      planBefore,
      planAfter,
      contextBefore,
      runner: dryRun ? null : activeRunner,
      cwd: rootDir,
      disableLlm: dryRun
    });

    reflectionMemoryChanges = await applyMemoryUpdate(layout, reflection.memoryUpdate ?? {}, {
      projectId: layout.projectId,
      goalId: goal.id,
      sessionId,
      sourceType: "reflection"
    });
  }

  const messages = await loadSessionMessages(layout, sessionId);
  const mergedMemoryChanges = {
    addedEntries: [...initialMemoryChanges.addedEntries, ...reflectionMemoryChanges.addedEntries],
    invalidatedEntries: [
      ...initialMemoryChanges.invalidatedEntries,
      ...reflectionMemoryChanges.invalidatedEntries
    ]
  };

  const sessionSummary = buildSessionSummary({
    layout,
    sessionId,
    goalId: goal.id,
    messages,
    plan: planAfter,
    memoryChanges: mergedMemoryChanges,
    reflectionSummary: reflection?.summary ?? null
  });

  await writeSessionSummary(layout, sessionId, sessionSummary);

  const knowledgeAfter = await loadMergedKnowledge(layout);
  const contextAfter = buildActiveContext({
    goal,
    plan: planAfter,
    knowledge: knowledgeAfter,
    sessionSummary
  });

  await writeJsonFile(layout.projectActiveContextFile, {
    generatedAt: new Date().toISOString(),
    context: contextAfter
  });

  const localProjectBrain = await syncProjectBrain({
    projectRoot,
    context: contextAfter,
    plan: planAfter,
    sessionSummary,
    repositoryLayout: layout
  });

  return {
    layout,
    goal,
    prompt,
    planBefore,
    planAfter,
    executionResult: resolvedExecution,
    reflection,
    sessionSummary,
    contextBefore,
    contextAfter,
    localProjectBrain
  };
}
