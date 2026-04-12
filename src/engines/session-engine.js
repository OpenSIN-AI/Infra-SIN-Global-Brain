import { promises as fs } from "node:fs";

import {
  derivedSessionFile,
  rawSessionFile
} from "../lib/layout.js";
import {
  appendJsonlRecord,
  listJsonFiles,
  readJsonFile,
  readJsonlFile,
  sanitizeIdentifier,
  writeJsonFile
} from "../lib/storage.js";

export async function appendSessionMessage(layout, {
  sessionId,
  role,
  text,
  metadata = {}
}) {
  const safeSessionId = sanitizeIdentifier(sessionId, "default-session");
  const event = {
    sessionId: safeSessionId,
    role,
    text,
    metadata,
    createdAt: new Date().toISOString()
  };

  await appendJsonlRecord(rawSessionFile(layout, safeSessionId), event);
  return event;
}

export async function loadSessionMessages(layout, sessionId) {
  return readJsonlFile(rawSessionFile(layout, sessionId));
}

export async function loadSessionSummary(layout, sessionId) {
  return readJsonFile(derivedSessionFile(layout, sessionId), null);
}

export async function writeSessionSummary(layout, sessionId, summary) {
  const safeSessionId = sanitizeIdentifier(sessionId, "default-session");
  await writeJsonFile(derivedSessionFile(layout, safeSessionId), summary);
  await rebuildProjectSessionAggregate(layout);
  await rebuildGlobalSessionAggregate(layout);
  return summary;
}

export function buildSessionSummary({
  layout,
  sessionId,
  goalId,
  messages,
  plan,
  memoryChanges,
  reflectionSummary = null
}) {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user")?.text ?? null;
  const lastAssistantMessage = [...messages].reverse().find((message) => message.role === "assistant")?.text ?? null;

  return {
    sessionId: sanitizeIdentifier(sessionId, "default-session"),
    projectId: layout.projectId,
    goalId,
    messageCount: messages.length,
    lastUserMessage,
    lastAssistantMessage,
    currentStrategy: plan.strategy,
    openIssueCount: (plan.issues ?? []).filter((issue) => issue.status !== "resolved").length,
    invalidatedEntries: memoryChanges.invalidatedEntries.map((entry) => entry.text),
    addedKnowledge: memoryChanges.addedEntries.map((entry) => entry.text),
    reflectionSummary,
    updatedAt: new Date().toISOString()
  };
}

export async function rebuildProjectSessionAggregate(layout) {
  const derivedDirectory = `${layout.projectSessionsDir}/derived`;
  const summaryFiles = await listJsonFiles(derivedDirectory);
  const sessions = [];

  for (const file of summaryFiles) {
    const summary = await readJsonFile(`${derivedDirectory}/${file}`, null);
    if (summary) {
      sessions.push(summary);
    }
  }

  const aggregate = {
    projectId: layout.projectId,
    sessions: sessions.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
  };

  await writeJsonFile(layout.projectSessionAggregateFile, aggregate);
  return aggregate;
}

export async function rebuildGlobalSessionAggregate(layout) {
  const projectEntries = await fs.readdir(layout.projectsRoot, { withFileTypes: true });
  const projectSummaries = [];

  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) {
      continue;
    }

    const aggregateFile = `${layout.projectsRoot}/${projectEntry.name}/sessions/project-summary.json`;
    const aggregate = await readJsonFile(aggregateFile, null);

    if (!aggregate) {
      continue;
    }

    projectSummaries.push({
      projectId: projectEntry.name,
      sessionCount: aggregate.sessions.length,
      lastUpdatedAt: aggregate.sessions[0]?.updatedAt ?? null,
      sessions: aggregate.sessions
    });
  }

  const globalAggregate = {
    projects: projectSummaries.sort((left, right) =>
      String(right.lastUpdatedAt ?? "").localeCompare(String(left.lastUpdatedAt ?? ""))
    )
  };

  await writeJsonFile(layout.globalSessionAggregateFile, globalAggregate);
  return globalAggregate;
}
