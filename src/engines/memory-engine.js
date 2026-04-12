import {
  cloneJsonCompatible,
  createStableId,
  readJsonFile,
  toArray,
  uniqueStrings,
  writeJsonFile
} from "../lib/storage.js";

const DEFAULT_SCOPE_BY_TYPE = {
  decision: "project",
  fact: "project",
  mistake: "project",
  forbidden: "project",
  solution: "global",
  rule: "global"
};

function normalizeKnowledgeEntry(type, entry, sourceMeta) {
  const candidate = typeof entry === "string" ? { text: entry } : { ...entry };
  const text = candidate.text ?? candidate.summary ?? candidate.decision ?? candidate.rule ?? candidate.solution;

  if (!text) {
    return null;
  }

  const now = new Date().toISOString();

  return {
    id: candidate.id ?? createStableId(type),
    type,
    text,
    topic: candidate.topic ?? null,
    status: "active",
    scope: candidate.scope ?? DEFAULT_SCOPE_BY_TYPE[type] ?? "project",
    tags: uniqueStrings(candidate.tags),
    source: sourceMeta,
    rationale: candidate.rationale ?? candidate.reason ?? null,
    createdAt: candidate.createdAt ?? now,
    updatedAt: now,
    invalidatedBy: [],
    invalidates: toArray(candidate.invalidates),
    replacesTopic: candidate.replacesTopic ?? Boolean(candidate.topic && type === "decision")
  };
}

function normalizeInvalidation(invalidation) {
  if (typeof invalidation === "string") {
    return {
      matchText: invalidation,
      scope: "all",
      reason: null
    };
  }

  return {
    matchId: invalidation.matchId ?? invalidation.id ?? null,
    matchText: invalidation.matchText ?? invalidation.text ?? null,
    matchTopic: invalidation.matchTopic ?? invalidation.topic ?? null,
    matchType: invalidation.matchType ?? invalidation.type ?? null,
    scope: invalidation.scope ?? "all",
    reason: invalidation.reason ?? null
  };
}

function matchesInvalidation(entry, invalidation) {
  if (entry.status !== "active") {
    return false;
  }

  if (invalidation.matchId && entry.id === invalidation.matchId) {
    return true;
  }

  if (invalidation.matchText && entry.text === invalidation.matchText) {
    return true;
  }

  if (invalidation.matchTopic && entry.topic === invalidation.matchTopic) {
    if (!invalidation.matchType || entry.type === invalidation.matchType) {
      return true;
    }
  }

  return false;
}

export async function loadKnowledge(layout, scope) {
  const filePath = scope === "global" ? layout.globalKnowledgeFile : layout.projectKnowledgeFile;
  return readJsonFile(filePath, { entries: [] });
}

export async function loadMergedKnowledge(layout) {
  const globalKnowledge = await loadKnowledge(layout, "global");
  const projectKnowledge = await loadKnowledge(layout, "project");

  return {
    global: globalKnowledge.entries ?? [],
    project: projectKnowledge.entries ?? [],
    active: [...(globalKnowledge.entries ?? []), ...(projectKnowledge.entries ?? [])].filter(
      (entry) => entry.status === "active"
    )
  };
}

export function normalizeMemoryUpdate(memoryUpdate = {}, sourceMeta = {}) {
  const entries = [
    ...toArray(memoryUpdate.facts).map((entry) => normalizeKnowledgeEntry("fact", entry, sourceMeta)),
    ...toArray(memoryUpdate.decisions).map((entry) => normalizeKnowledgeEntry("decision", entry, sourceMeta)),
    ...toArray(memoryUpdate.mistakes).map((entry) => normalizeKnowledgeEntry("mistake", entry, sourceMeta)),
    ...toArray(memoryUpdate.solutions).map((entry) => normalizeKnowledgeEntry("solution", entry, sourceMeta)),
    ...toArray(memoryUpdate.rules).map((entry) => normalizeKnowledgeEntry("rule", entry, sourceMeta)),
    ...toArray(memoryUpdate.forbidden).map((entry) => normalizeKnowledgeEntry("forbidden", entry, sourceMeta))
  ].filter(Boolean);

  const explicitInvalidations = toArray(memoryUpdate.invalidations).map(normalizeInvalidation);
  const entryDrivenInvalidations = entries.flatMap((entry) => {
    const invalidations = entry.invalidates.map((target) => normalizeInvalidation(target));

    if (entry.replacesTopic && entry.topic) {
      invalidations.push(
        normalizeInvalidation({
          matchTopic: entry.topic,
          matchType: entry.type,
          scope: entry.scope,
          reason: `${entry.type} topic replaced by ${entry.id}`
        })
      );
    }

    return invalidations;
  });

  return {
    entries,
    invalidations: [...explicitInvalidations, ...entryDrivenInvalidations]
  };
}

async function writeKnowledge(layout, scope, knowledge) {
  const filePath = scope === "global" ? layout.globalKnowledgeFile : layout.projectKnowledgeFile;
  await writeJsonFile(filePath, knowledge);
}

function applyInvalidations(knowledgeEntries, invalidations, actorEntryIds) {
  const invalidatedEntries = [];
  const now = new Date().toISOString();
  const protectedIds = new Set(actorEntryIds ?? []);

  for (const entry of knowledgeEntries) {
    if (protectedIds.has(entry.id)) {
      continue;
    }

    const matchingInvalidation = invalidations.find((invalidation) => matchesInvalidation(entry, invalidation));

    if (!matchingInvalidation) {
      continue;
    }

    entry.status = "invalidated";
    entry.updatedAt = now;
    entry.invalidatedAt = now;
    entry.invalidatedBy = uniqueStrings([...(entry.invalidatedBy ?? []), ...(actorEntryIds ?? ["system"])]);
    entry.invalidationReason = matchingInvalidation.reason ?? null;
    invalidatedEntries.push(cloneJsonCompatible(entry));
  }

  return invalidatedEntries;
}

export async function applyMemoryUpdate(layout, memoryUpdate, sourceMeta = {}) {
  const normalized = normalizeMemoryUpdate(memoryUpdate, sourceMeta);
  const globalKnowledge = await loadKnowledge(layout, "global");
  const projectKnowledge = await loadKnowledge(layout, "project");

  const globalEntries = [...(globalKnowledge.entries ?? [])];
  const projectEntries = [...(projectKnowledge.entries ?? [])];
  const addedEntries = [];

  for (const entry of normalized.entries) {
    const targetEntries = entry.scope === "global" ? globalEntries : projectEntries;
    targetEntries.push(entry);
    addedEntries.push(cloneJsonCompatible(entry));
  }

  const addedEntryIds = addedEntries.map((entry) => entry.id);

  const invalidatedEntries = [
    ...applyInvalidations(globalEntries, normalized.invalidations, addedEntryIds),
    ...applyInvalidations(projectEntries, normalized.invalidations, addedEntryIds)
  ];

  await writeKnowledge(layout, "global", { entries: globalEntries });
  await writeKnowledge(layout, "project", { entries: projectEntries });

  return {
    addedEntries,
    invalidatedEntries,
    invalidations: normalized.invalidations
  };
}

export function selectKnowledgeEntries(entries, type, limit = 5) {
  return entries
    .filter((entry) => entry.type === type && entry.status === "active")
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
    .slice(0, limit);
}
