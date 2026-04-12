import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runOrchestration } from "../src/engines/orchestrator-engine.js";
import { createRepositoryLayout } from "../src/lib/layout.js";
import { loadKnowledge } from "../src/engines/memory-engine.js";

test("orchestrator persists plan, session state, invalidation, and local project brain sync", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "global-brain-orchestrator-"));
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "global-brain-project-"));

  await runOrchestration({
    rootDir,
    projectId: "alpha",
    projectRoot,
    goalId: "login-system",
    goalDescription: "Build the login system",
    task: "Record the original API A strategy",
    sessionId: "session-a",
    executionResult: {
      resultSummary: "Documented API A as the first strategy.",
      planUpdate: {
        strategy: "api-a",
        steps: [{ id: "step-1", title: "Implement API A", status: "in_progress" }]
      },
      memoryUpdate: {
        decisions: [{ text: "Use API A", topic: "strategy", replacesTopic: true }]
      }
    },
    skipReflection: true
  });

  const secondRun = await runOrchestration({
    rootDir,
    projectId: "alpha",
    projectRoot,
    goalId: "login-system",
    goalDescription: "Build the login system",
    task: "Replace API A with API B after failures",
    sessionId: "session-a",
    executionResult: {
      resultSummary: "API B replaced API A after repeated failures.",
      planUpdate: {
        strategy: "api-b",
        steps: [{ id: "step-1", title: "Implement API B", status: "in_progress" }],
        decisions: [{ text: "Use API B", topic: "strategy" }]
      },
      memoryUpdate: {
        facts: ["API A failed repeatedly during this session."],
        decisions: [{ text: "Use API B", topic: "strategy", replacesTopic: true }],
        invalidations: [{ matchText: "Use API A", reason: "API B is the new approved strategy." }],
        rules: ["Never revert to invalidated strategies without explicit approval."]
      }
    },
    skipReflection: true
  });

  const layout = await createRepositoryLayout({ rootDir, projectId: "alpha" });
  const projectKnowledge = await loadKnowledge(layout, "project");
  const strategyEntries = projectKnowledge.entries.filter((entry) => entry.topic === "strategy");
  const invalidatedApiA = strategyEntries.find((entry) => entry.text === "Use API A");
  const activeApiB = strategyEntries.find((entry) => entry.text === "Use API B");
  const localContextRaw = await readFile(path.join(projectRoot, ".pcpm", "active-context.json"), "utf8");
  const localContext = JSON.parse(localContextRaw);

  assert.equal(secondRun.planAfter.strategy, "api-b");
  assert.equal(invalidatedApiA.status, "invalidated");
  assert.equal(activeApiB.status, "active");
  assert.equal(localContext.context.plan.strategy, "api-b");
  assert.equal(secondRun.sessionSummary.currentStrategy, "api-b");
});
