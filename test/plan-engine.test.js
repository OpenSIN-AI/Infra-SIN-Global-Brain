import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createRepositoryLayout } from "../src/lib/layout.js";
import { applyPlanUpdate, buildInitialPlan, loadLatestPlan, savePlanVersion } from "../src/engines/plan-engine.js";

test("plan engine creates versioned revisions and loads the latest snapshot", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "global-brain-plan-"));
  const layout = await createRepositoryLayout({ rootDir, projectId: "alpha" });
  const initialPlan = buildInitialPlan({
    projectId: layout.projectId,
    goalId: "login-system",
    goalDescription: "Build the login system"
  });

  await savePlanVersion(layout, initialPlan);

  const updatedPlan = applyPlanUpdate(initialPlan, {
    strategy: "api-b",
    steps: [{ id: "step-1", title: "Implement API B", status: "in_progress" }],
    decisions: [{ text: "Switch to API B", topic: "strategy" }]
  });

  await savePlanVersion(layout, updatedPlan);

  const latestPlan = await loadLatestPlan(layout, "login-system");

  assert.equal(latestPlan.revision, 2);
  assert.equal(latestPlan.strategy, "api-b");
  assert.equal(latestPlan.steps[0].title, "Implement API B");
  assert.equal(latestPlan.decisions[0].text, "Switch to API B");
});
