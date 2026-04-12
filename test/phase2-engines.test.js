import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import { createRepositoryLayout, createProjectBrainLayout } from "../src/lib/layout.js";
import { writeJsonFile, readJsonFile, appendJsonlRecord } from "../src/lib/storage.js";
import { rawSessionFile } from "../src/lib/layout.js";
import { applyMemoryUpdate } from "../src/engines/memory-engine.js";
import { extractKnowledgeFromMessages } from "../src/engines/transcript-engine.js";
import { pullFromProjectBrain, bidirectionalSync } from "../src/engines/bidi-sync-engine.js";
import { setupProjectHooks, detectExistingHooks } from "../src/engines/hook-engine.js";
import { syncProjectBrain } from "../src/engines/sync-engine.js";

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test("transcript extraction returns empty when no runner is provided (offline mode)", async () => {
  const result = await extractKnowledgeFromMessages({
    messages: [
      { role: "user", text: "Fix the login bug", createdAt: "2026-04-12T10:00:00Z" },
      { role: "assistant", text: "Found the issue in auth.js line 42", createdAt: "2026-04-12T10:01:00Z" }
    ],
    projectId: "test-project",
    sessionId: "test-session",
    runner: null
  });

  assert.deepStrictEqual(result.facts, []);
  assert.deepStrictEqual(result.decisions, []);
  assert.deepStrictEqual(result.mistakes, []);
  assert.deepStrictEqual(result.solutions, []);
  assert.deepStrictEqual(result.rules, []);
  assert.deepStrictEqual(result.forbidden, []);
  assert.deepStrictEqual(result.invalidations, []);
});

test("transcript extraction returns empty for empty message array", async () => {
  const result = await extractKnowledgeFromMessages({
    messages: [],
    projectId: "test-project",
    sessionId: "test-session",
    runner: { runJson: async () => ({}) }
  });

  assert.deepStrictEqual(result.facts, []);
});

test("transcript extraction merges results from a mock runner", async () => {
  const mockRunner = {
    async runJson() {
      return {
        facts: [{ text: "Node 22 supports test glob" }],
        decisions: [{ text: "Use ESM", topic: "architecture" }],
        mistakes: [],
        solutions: [{ text: "Add --test flag" }],
        rules: [],
        forbidden: [],
        invalidations: []
      };
    }
  };

  const result = await extractKnowledgeFromMessages({
    messages: [
      { role: "user", text: "How do I run tests?", createdAt: "2026-04-12T10:00:00Z" },
      { role: "assistant", text: "Use node --test", createdAt: "2026-04-12T10:01:00Z" }
    ],
    projectId: "test-project",
    sessionId: "test-session",
    runner: mockRunner
  });

  assert.equal(result.facts.length, 1);
  assert.equal(result.facts[0].text, "Node 22 supports test glob");
  assert.equal(result.decisions.length, 1);
  assert.equal(result.solutions.length, 1);
});

test("bidirectional sync: pull imports new entries from .pcpm into global brain", async () => {
  const brainDir = await createTempDir("brain-bidi-");
  const projectDir = await createTempDir("project-bidi-");

  const layout = await createRepositoryLayout({ rootDir: brainDir, projectId: "bidi-test" });

  // Seed the project .pcpm with a knowledge entry that doesn't exist in global
  const localBrain = await createProjectBrainLayout(projectDir);
  await writeJsonFile(localBrain.knowledgeSummaryFile, {
    generatedAt: new Date().toISOString(),
    entries: [
      {
        id: "fact-from-project-001",
        type: "fact",
        text: "PostgreSQL requires VACUUM after bulk deletes",
        topic: "database",
        status: "active",
        scope: "global",
        tags: ["postgres"],
        createdAt: "2026-04-12T09:00:00Z",
        updatedAt: "2026-04-12T09:00:00Z"
      }
    ]
  });

  const pullResult = await pullFromProjectBrain({
    projectRoot: projectDir,
    repositoryLayout: layout
  });

  assert.equal(pullResult.status, "completed");
  assert.equal(pullResult.globalImported, 1);
  assert.equal(pullResult.globalSkipped, 0);

  // Verify the entry was written to the global knowledge store
  const globalKnowledge = await readJsonFile(layout.globalKnowledgeFile);
  const imported = globalKnowledge.entries.find((e) => e.id === "fact-from-project-001");
  assert.ok(imported, "imported entry should exist in global store");
  assert.equal(imported.text, "PostgreSQL requires VACUUM after bulk deletes");
  assert.ok(imported.importedAt, "importedAt should be stamped");

  // Running pull again should skip the duplicate
  const secondPull = await pullFromProjectBrain({
    projectRoot: projectDir,
    repositoryLayout: layout
  });

  assert.equal(secondPull.globalImported, 0);
  assert.equal(secondPull.globalSkipped, 1);

  await fs.rm(brainDir, { recursive: true, force: true });
  await fs.rm(projectDir, { recursive: true, force: true });
});

test("bidirectional sync: full push+pull cycle preserves data", async () => {
  const brainDir = await createTempDir("brain-full-bidi-");
  const projectDir = await createTempDir("project-full-bidi-");

  const layout = await createRepositoryLayout({ rootDir: brainDir, projectId: "full-bidi" });

  // Add a global knowledge entry
  await applyMemoryUpdate(layout, {
    rules: [{ text: "Always use parameterized queries", topic: "security" }]
  }, { sourceType: "test" });

  // Push to project (one-way), which populates .pcpm/knowledge-summary.json
  const plan = { revision: 1, strategy: "test", steps: [], status: "active" };
  await syncProjectBrain({
    projectRoot: projectDir,
    context: { generatedAt: new Date().toISOString() },
    plan,
    sessionSummary: null,
    repositoryLayout: layout
  });

  // Verify .pcpm was populated
  const localBrain = await createProjectBrainLayout(projectDir);
  const pushed = await readJsonFile(localBrain.knowledgeSummaryFile);
  assert.ok(pushed.entries.length > 0, "push should populate .pcpm entries");

  // Now add a NEW entry to the project .pcpm that doesn't exist in global
  pushed.entries.push({
    id: "solution-local-001",
    type: "solution",
    text: "Use connection pooling for PostgreSQL",
    topic: "database",
    status: "active",
    scope: "global",
    tags: ["postgres"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  await writeJsonFile(localBrain.knowledgeSummaryFile, pushed);

  // Pull back — should import only the new entry
  const pullResult = await pullFromProjectBrain({
    projectRoot: projectDir,
    repositoryLayout: layout
  });

  assert.equal(pullResult.status, "completed");
  assert.equal(pullResult.globalImported, 1, "should import only the new solution entry");

  const globalKnowledge = await readJsonFile(layout.globalKnowledgeFile);
  const newEntry = globalKnowledge.entries.find((e) => e.id === "solution-local-001");
  assert.ok(newEntry, "new entry should be in global store");

  await fs.rm(brainDir, { recursive: true, force: true });
  await fs.rm(projectDir, { recursive: true, force: true });
});

test("hook engine creates hook scripts and config for a project", async () => {
  const brainDir = await createTempDir("brain-hooks-");
  const projectDir = await createTempDir("project-hooks-");

  const result = await setupProjectHooks({
    projectRoot: projectDir,
    brainRepoPath: brainDir,
    projectId: "hooks-test",
    goalId: "goal-1",
    goalDescription: "Build the auth system",
    writeAgentsDirective: true
  });

  // Verify all files were created
  const beforeExists = await fs.access(result.beforeRunScript).then(() => true).catch(() => false);
  const afterExists = await fs.access(result.afterRunScript).then(() => true).catch(() => false);
  const configExists = await fs.access(result.configFile).then(() => true).catch(() => false);
  const directiveExists = await fs.access(result.agentsDirective).then(() => true).catch(() => false);

  assert.ok(beforeExists, "beforeRun script should exist");
  assert.ok(afterExists, "afterRun script should exist");
  assert.ok(configExists, "config file should exist");
  assert.ok(directiveExists, "agents directive should exist");

  // Verify config content
  const config = await readJsonFile(result.configFile);
  assert.equal(config.pcpm.projectId, "hooks-test");
  assert.equal(config.pcpm.goalId, "goal-1");
  assert.equal(config.pcpm.autoSync, true);

  // Verify beforeRun script contains the brain CLI path
  const beforeContent = await fs.readFile(result.beforeRunScript, "utf8");
  assert.ok(beforeContent.includes("PCPM beforeRun hook"), "beforeRun should have correct header");
  assert.ok(beforeContent.includes("goal-1"), "beforeRun should reference goalId");

  // Verify agents directive content
  const directiveContent = await fs.readFile(result.agentsDirective, "utf8");
  assert.ok(directiveContent.includes("hooks-test"), "directive should reference projectId");
  assert.ok(directiveContent.includes("Build the auth system"), "directive should reference goal");

  // Verify detectExistingHooks finds the config
  const detected = await detectExistingHooks(projectDir);
  assert.ok(detected, "detectExistingHooks should find the config");
  assert.equal(detected.pcpm.projectId, "hooks-test");

  await fs.rm(brainDir, { recursive: true, force: true });
  await fs.rm(projectDir, { recursive: true, force: true });
});

test("hook engine skips agents directive when not requested", async () => {
  const brainDir = await createTempDir("brain-hooks2-");
  const projectDir = await createTempDir("project-hooks2-");

  const result = await setupProjectHooks({
    projectRoot: projectDir,
    brainRepoPath: brainDir,
    projectId: "no-directive",
    writeAgentsDirective: false
  });

  assert.equal(result.agentsDirective, null);

  await fs.rm(brainDir, { recursive: true, force: true });
  await fs.rm(projectDir, { recursive: true, force: true });
});

test("pullFromProjectBrain skips when no .pcpm directory exists", async () => {
  const brainDir = await createTempDir("brain-nopcpm-");
  const projectDir = await createTempDir("project-nopcpm-");

  const layout = await createRepositoryLayout({ rootDir: brainDir, projectId: "nopcpm-test" });

  const result = await pullFromProjectBrain({
    projectRoot: projectDir,
    repositoryLayout: layout
  });

  assert.equal(result.status, "skipped");
  assert.ok(result.reason.includes("knowledge-summary.json"));

  await fs.rm(brainDir, { recursive: true, force: true });
  await fs.rm(projectDir, { recursive: true, force: true });
});
