// Bidirectional sync between project .pcpm/ directories and the global brain.
// Phase 1 built one-way push (global→project). This engine adds the reverse:
// reading .pcpm/ state from a project repo and merging new knowledge/decisions
// back into the global brain, with conflict detection and deduplication.

import path from "node:path";

import { createProjectBrainLayout, projectBrainRoot } from "../lib/layout.js";
import {
  cloneJsonCompatible,
  fileExists,
  readJsonFile,
  writeJsonFile
} from "../lib/storage.js";
import { loadKnowledge } from "./memory-engine.js";
import { summarizePlan } from "./plan-engine.js";

// Deduplication: check if an entry with the same text already exists
// in the target store (regardless of id). Prevents double-imports
// when the same .pcpm/ is synced multiple times.
function entryExistsInStore(entries, candidate) {
  return entries.some(
    (existing) =>
      existing.text === candidate.text &&
      existing.type === candidate.type &&
      existing.status === "active"
  );
}

// Merge knowledge entries from a project .pcpm/ back into the global brain.
// Only imports entries that don't already exist (by text+type dedup).
// Returns a list of newly imported entries and a list of skipped duplicates.
function mergeKnowledgeEntries(existingEntries, incomingEntries) {
  const imported = [];
  const skipped = [];
  const now = new Date().toISOString();

  for (const entry of incomingEntries) {
    if (!entry || !entry.text || entry.status !== "active") {
      continue;
    }

    if (entryExistsInStore(existingEntries, entry)) {
      skipped.push({ id: entry.id, text: entry.text, reason: "duplicate" });
      continue;
    }

    // Stamp the entry with import metadata so we know it came from a project sync
    const importedEntry = cloneJsonCompatible(entry);
    importedEntry.importedAt = now;
    importedEntry.importSource = "project-to-global-sync";
    existingEntries.push(importedEntry);
    imported.push(importedEntry);
  }

  return { imported, skipped };
}

// Pull knowledge from a project's .pcpm/ directory back into the global brain.
// This is the reverse of syncProjectBrain (sync-engine.js).
//
// Flow:
//   1. Read .pcpm/knowledge-summary.json from the project repo
//   2. Compare each entry against the global knowledge store
//   3. Import new entries that don't already exist (dedup by text+type)
//   4. Write updated global knowledge store
//   5. Return import report
export async function pullFromProjectBrain({ projectRoot, repositoryLayout }) {
  if (!projectRoot) {
    return { status: "skipped", reason: "no projectRoot provided" };
  }

  const pcpmRoot = projectBrainRoot(projectRoot);
  const knowledgeSummaryPath = path.join(pcpmRoot, "knowledge-summary.json");

  if (!(await fileExists(knowledgeSummaryPath))) {
    return { status: "skipped", reason: "no .pcpm/knowledge-summary.json found" };
  }

  const projectKnowledgeSummary = await readJsonFile(knowledgeSummaryPath, { entries: [] });
  const incomingEntries = projectKnowledgeSummary.entries ?? [];

  if (incomingEntries.length === 0) {
    return { status: "skipped", reason: "no entries in project knowledge summary" };
  }

  // Load current global knowledge store
  const globalKnowledge = await loadKnowledge(repositoryLayout, "global");
  const globalEntries = globalKnowledge.entries ?? [];

  // Separate incoming entries by target scope
  const globalScopeEntries = incomingEntries.filter((e) => e.scope === "global");
  const projectScopeEntries = incomingEntries.filter((e) => e.scope !== "global");

  // Merge global-scope entries into the global store
  const globalResult = mergeKnowledgeEntries(globalEntries, globalScopeEntries);

  // For project-scope entries, we merge them into the project store in the brain repo
  const projectKnowledge = await loadKnowledge(repositoryLayout, "project");
  const projectEntries = projectKnowledge.entries ?? [];
  const projectResult = mergeKnowledgeEntries(projectEntries, projectScopeEntries);

  // Write updated stores
  if (globalResult.imported.length > 0) {
    await writeJsonFile(repositoryLayout.globalKnowledgeFile, { entries: globalEntries });
  }

  if (projectResult.imported.length > 0) {
    await writeJsonFile(repositoryLayout.projectKnowledgeFile, { entries: projectEntries });
  }

  return {
    status: "completed",
    globalImported: globalResult.imported.length,
    globalSkipped: globalResult.skipped.length,
    projectImported: projectResult.imported.length,
    projectSkipped: projectResult.skipped.length,
    importedEntries: [...globalResult.imported, ...projectResult.imported],
    skippedEntries: [...globalResult.skipped, ...projectResult.skipped]
  };
}

// Full bidirectional sync: push global→project, then pull project→global.
// This is the recommended single call for keeping everything in sync.
//
// The order matters: push first so the project gets the latest global state,
// then pull back any new project-local knowledge into the global brain.
// This prevents the pull from re-importing entries that were just pushed.
export async function bidirectionalSync({
  projectRoot,
  context,
  plan,
  sessionSummary,
  repositoryLayout
}) {
  // Import the push function from the existing sync engine
  const { syncProjectBrain } = await import("./sync-engine.js");

  // Step 1: Push global→project (existing one-way sync)
  const pushResult = await syncProjectBrain({
    projectRoot,
    context,
    plan,
    sessionSummary,
    repositoryLayout
  });

  // Step 2: Pull project→global (new reverse sync)
  const pullResult = await pullFromProjectBrain({
    projectRoot,
    repositoryLayout
  });

  return {
    push: pushResult ? { status: "completed", localRoot: pushResult.localRoot } : { status: "skipped" },
    pull: pullResult
  };
}
