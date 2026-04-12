import path from "node:path";

import {
  ensureDir,
  fileExists,
  readJsonFile,
  sanitizeIdentifier,
  writeJsonFile
} from "./storage.js";

export async function createRepositoryLayout({ rootDir = process.cwd(), projectId }) {
  const safeProjectId = sanitizeIdentifier(projectId, "default-project");
  const brainRoot = path.join(rootDir, "brain");
  const globalRoot = path.join(brainRoot, "global");
  const projectsRoot = path.join(brainRoot, "projects");
  const projectRoot = path.join(projectsRoot, safeProjectId);

  const layout = {
    rootDir,
    brainRoot,
    globalRoot,
    projectsRoot,
    projectId: safeProjectId,
    projectRoot,
    globalKnowledgeFile: path.join(globalRoot, "knowledge.json"),
    globalSessionAggregateFile: path.join(globalRoot, "session-summary.json"),
    projectGoalsDir: path.join(projectRoot, "goals"),
    projectPlansDir: path.join(projectRoot, "plans"),
    projectMemoryDir: path.join(projectRoot, "memory"),
    projectSessionsDir: path.join(projectRoot, "sessions"),
    projectContextDir: path.join(projectRoot, "context"),
    projectKnowledgeFile: path.join(projectRoot, "memory", "knowledge.json"),
    projectSessionAggregateFile: path.join(projectRoot, "sessions", "project-summary.json"),
    projectActiveContextFile: path.join(projectRoot, "context", "active-context.json")
  };

  await ensureDir(globalRoot);
  await ensureDir(projectsRoot);
  await ensureDir(layout.projectGoalsDir);
  await ensureDir(layout.projectPlansDir);
  await ensureDir(layout.projectMemoryDir);
  await ensureDir(path.join(layout.projectSessionsDir, "raw"));
  await ensureDir(path.join(layout.projectSessionsDir, "derived"));
  await ensureDir(layout.projectContextDir);

  await ensureBaselineJson(layout.globalKnowledgeFile, { entries: [] });
  await ensureBaselineJson(layout.globalSessionAggregateFile, { projects: [] });
  await ensureBaselineJson(layout.projectKnowledgeFile, { entries: [] });
  await ensureBaselineJson(layout.projectSessionAggregateFile, {
    projectId: safeProjectId,
    sessions: []
  });
  await ensureBaselineJson(layout.projectActiveContextFile, {
    generatedAt: null,
    context: null
  });

  return layout;
}

export function goalFile(layout, goalId) {
  return path.join(layout.projectGoalsDir, `${sanitizeIdentifier(goalId, "default-goal")}.json`);
}

export function planDirectory(layout, goalId) {
  return path.join(layout.projectPlansDir, sanitizeIdentifier(goalId, "default-goal"));
}

export function rawSessionFile(layout, sessionId) {
  return path.join(
    layout.projectSessionsDir,
    "raw",
    `${sanitizeIdentifier(sessionId, "default-session")}.jsonl`
  );
}

export function derivedSessionFile(layout, sessionId) {
  return path.join(
    layout.projectSessionsDir,
    "derived",
    `${sanitizeIdentifier(sessionId, "default-session")}.json`
  );
}

export function projectBrainRoot(projectRoot) {
  return path.join(projectRoot, ".pcpm");
}

export async function createProjectBrainLayout(projectRoot) {
  const localRoot = projectBrainRoot(projectRoot);
  const layout = {
    projectRoot,
    localRoot,
    contextFile: path.join(localRoot, "active-context.json"),
    knowledgeSummaryFile: path.join(localRoot, "knowledge-summary.json"),
    latestPlanFile: path.join(localRoot, "plan", "latest.json"),
    sessionSummaryFile: path.join(localRoot, "sessions", "latest-summary.json")
  };

  await ensureDir(path.join(localRoot, "plan"));
  await ensureDir(path.join(localRoot, "sessions"));
  await ensureBaselineJson(layout.contextFile, { generatedAt: null, context: null });
  await ensureBaselineJson(layout.knowledgeSummaryFile, { generatedAt: null, entries: [] });

  return layout;
}

async function ensureBaselineJson(filePath, defaultValue) {
  if (await fileExists(filePath)) {
    return readJsonFile(filePath, defaultValue);
  }

  await writeJsonFile(filePath, defaultValue);
  return defaultValue;
}
