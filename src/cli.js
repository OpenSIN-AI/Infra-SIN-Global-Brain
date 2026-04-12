#!/usr/bin/env node

import path from "node:path";

import { createRepositoryLayout } from "./lib/layout.js";
import { readJsonFile } from "./lib/storage.js";
import { bidirectionalSync, pullFromProjectBrain } from "./engines/bidi-sync-engine.js";
import { buildActiveContext } from "./engines/context-engine.js";
import { ensureGoal } from "./engines/goal-engine.js";
import { setupProjectHooks, detectExistingHooks } from "./engines/hook-engine.js";
import { loadMergedKnowledge } from "./engines/memory-engine.js";
import { runOrchestration } from "./engines/orchestrator-engine.js";
import { loadLatestPlan } from "./engines/plan-engine.js";
import { appendSessionMessage, loadSessionSummary } from "./engines/session-engine.js";
import { extractAndApplyTranscriptKnowledge } from "./engines/transcript-engine.js";

function parseArguments(argv) {
  const [command = "help", ...rest] = argv;
  const options = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = rest[index + 1];

    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return { command, options };
}

function requireOption(options, key) {
  if (!options[key]) {
    throw new Error(`Missing required option --${key}`);
  }

  return options[key];
}

function printJson(data) {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

async function run() {
  const { command, options } = parseArguments(process.argv.slice(2));
  const rootDir = options.root ? path.resolve(options.root) : process.cwd();

  if (command === "help") {
    printJson({
      commands: [
        "init --project <project-id>",
        "log-message --project <project-id> --session <session-id> --role <user|assistant> --text <message>",
        "context --project <project-id> --goal-id <goal-id> --description <goal description>",
        "orchestrate --project <project-id> --goal-id <goal-id> --description <goal description> --task <task>",
        "orchestrate --execution-file <path-to-json> to inject a prepared execution result",
        "orchestrate --project-root <repo-path> to sync the small project brain into .pcpm",
        "extract-knowledge --project <project-id> --session <session-id> [--dry-run]",
        "sync --project <project-id> --project-root <repo-path>",
        "setup-hooks --project-root <repo-path> --project <project-id> [--goal-id <id>] [--description <desc>] [--agents-directive]"
      ]
    });
    return;
  }

  if (command === "init") {
    const projectId = requireOption(options, "project");
    const layout = await createRepositoryLayout({ rootDir, projectId });
    printJson(layout);
    return;
  }

  if (command === "log-message") {
    const projectId = requireOption(options, "project");
    const layout = await createRepositoryLayout({ rootDir, projectId });
    const event = await appendSessionMessage(layout, {
      sessionId: requireOption(options, "session"),
      role: requireOption(options, "role"),
      text: requireOption(options, "text")
    });
    printJson(event);
    return;
  }

  if (command === "context") {
    const projectId = requireOption(options, "project");
    const goalId = requireOption(options, "goal-id");
    const goalDescription = requireOption(options, "description");
    const sessionId = options.session ?? "default-session";
    const layout = await createRepositoryLayout({ rootDir, projectId });
    const goal = await ensureGoal(layout, { goalId, description: goalDescription });
    const plan = await loadLatestPlan(layout, goal.id);
    const knowledge = await loadMergedKnowledge(layout);
    const sessionSummary = await loadSessionSummary(layout, sessionId);
    printJson(buildActiveContext({ goal, plan, knowledge, sessionSummary }));
    return;
  }

  if (command === "orchestrate") {
    const executionResult = options["execution-file"]
      ? await readJsonFile(path.resolve(options["execution-file"]), null)
      : null;

    const result = await runOrchestration({
      rootDir,
      projectId: requireOption(options, "project"),
      projectRoot: options["project-root"] ? path.resolve(options["project-root"]) : null,
      goalId: requireOption(options, "goal-id"),
      goalDescription: requireOption(options, "description"),
      task: requireOption(options, "task"),
      sessionId: options.session ?? `session-${Date.now()}`,
      constraints: options.constraints ? options.constraints.split(",") : [],
      executionResult,
      dryRun: Boolean(options["dry-run"]),
      skipReflection: Boolean(options["skip-reflection"])
    });

    printJson({
      goal: result.goal,
      planAfter: result.planAfter,
      sessionSummary: result.sessionSummary,
      localProjectBrain: result.localProjectBrain
    });
    return;
  }

  if (command === "extract-knowledge") {
    const projectId = requireOption(options, "project");
    const sessionId = requireOption(options, "session");
    const layout = await createRepositoryLayout({ rootDir, projectId });
    const { OpenCodeRunner } = await import("./engines/opencode-runner.js");
    const runner = options["dry-run"] ? null : new OpenCodeRunner();

    const result = await extractAndApplyTranscriptKnowledge({
      layout,
      sessionId,
      runner,
      cwd: rootDir
    });

    printJson(result);
    return;
  }

  if (command === "sync") {
    const projectId = requireOption(options, "project");
    const projectRoot = options["project-root"] ? path.resolve(options["project-root"]) : null;
    const layout = await createRepositoryLayout({ rootDir, projectId });

    if (options.pull) {
      const result = await pullFromProjectBrain({ projectRoot, repositoryLayout: layout });
      printJson(result);
      return;
    }

    const goalId = options["goal-id"] ?? "default-goal";
    const goalDescription = options.description ?? "Continue development";
    const goal = await ensureGoal(layout, { goalId, description: goalDescription });
    const plan = await loadLatestPlan(layout, goal.id);
    const knowledge = await loadMergedKnowledge(layout);
    const sessionSummary = await loadSessionSummary(layout, options.session ?? "default-session");
    const context = buildActiveContext({ goal, plan, knowledge, sessionSummary });

    const result = await bidirectionalSync({
      projectRoot,
      context,
      plan,
      sessionSummary,
      repositoryLayout: layout
    });

    printJson(result);
    return;
  }

  if (command === "setup-hooks") {
    const projectRoot = path.resolve(requireOption(options, "project-root"));
    const projectId = requireOption(options, "project");
    const brainRepoPath = rootDir;

    const result = await setupProjectHooks({
      projectRoot,
      brainRepoPath,
      projectId,
      goalId: options["goal-id"] ?? "default-goal",
      goalDescription: options.description ?? "Continue development",
      sessionId: options.session ?? null,
      writeAgentsDirective: Boolean(options["agents-directive"])
    });

    printJson(result);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

run().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
