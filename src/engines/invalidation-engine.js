/**
 * invalidation-engine.js — Phase IV: Escalation Index + Ebbinghaus Decay + Archival Memory
 *
 * Erweitert das bestehende Decay-System um:
 * 1. Weighted Escalation Index (EI) mit 5 Risikofaktoren (R1-R5)
 * 2. Ebbinghaus Decay-Kurve fuer biologisch-plausibles Vergessen
 * 3. Archival Memory (Cold Storage) fuer niedrig-EI Eintraege
 * 4. Recursive Deep-Truth Resolution fuer widerspruechliche Ketten
 */

import { uniqueStrings } from "../lib/storage.js";

/**
 * Ebbinghaus-Vergessenskurve: R(t) = e^(-t/S)
 * S = Staerke der Erinnerung (basierend auf score + access frequency)
 * Nach 1 Tag: ~37% bei S=1, bei haeufigem Zugriff steigt S
 */
function ebbinghausRetention(score, accessCount, ageDays) {
  const memoryStrength = score * (1 + Math.log10(1 + accessCount));
  return Math.exp(-ageDays / Math.max(memoryStrength, 0.1));
}

/**
 * Gewichteter Escalation Index (EI) mit 5 Risikofaktoren.
 * Berechnet sich als gewichtete Summe: EI = Σ(wi × Ri)
 *
 * R1 (0.30): Zugriffshaeufigkeit im Working Memory
 * R2 (0.25): Strukturelle Kausalitaetsstaerke (Graph-Kanten)
 * R3 (0.20): Empirisches Nutzerfeedback (Erfolgsquote)
 * R4 (0.15): Zeitliche Aktualitaet (Recency)
 * R5 (0.10): Widerspruchsfreiheit (keine Konflikte)
 *
 * @param {Object} entry - Knowledge Entry mit erweiterten Metadaten
 * @returns {number} Escalation Index (0.0 - 1.0)
 */
export function calculateEscalationIndex(entry) {
  // R1: Zugriffshaeufigkeit (0-1, normalisiert auf max 100 Zugriffe)
  const accessFrequency = Math.min((entry.accessCount ?? 0) / 100, 1);
  const R1 = accessFrequency;

  // R2: Strukturelle Kausalitaetsstaerke (0-1, normalisiert auf max 10 Kanten)
  const edgeCount = entry.edgeCount ?? entry.relatedEntries?.length ?? 0;
  const R2 = Math.min(edgeCount / 10, 1);

  // R3: Empirisches Nutzerfeedback (Erfolgsquote 0-1)
  const successRate = entry.successRate ?? entry.score ?? 1;
  const R3 = Math.max(0, Math.min(1, successRate));

  // R4: Zeitliche Aktualitaet (Recency) — Ebbinghaus-basiert
  const ageDays = entry.ageDays ?? 0;
  const R4 = ebbinghausRetention(entry.score ?? 1, entry.accessCount ?? 0, ageDays);

  // R5: Widerspruchsfreiheit (1.0 = keine Konflikte, 0.0 = viele Konflikte)
  const conflictCount = entry.conflictCount ?? 0;
  const invalidationCount = (entry.invalidatedBy ?? []).length;
  const R5 = Math.max(0, 1 - (conflictCount * 0.2) - (invalidationCount * 0.3));

  // Gewichtete Summe
  const EI = 0.30 * R1 + 0.25 * R2 + 0.20 * R3 + 0.15 * R4 + 0.10 * R5;

  return Number(Math.max(0, Math.min(1, EI)).toFixed(4));
}

/**
 * Erweiterte Decay-Funktion mit Ebbinghaus-Kurve und Escalation Index.
 * Ersetzt das bestehende decayKnowledgeEntries um biologisch-plausibles Vergessen.
 *
 * @param {Array} entries - Knowledge Entries
 * @param {Object} options - now, archivalThreshold, ebbinghausEnabled
 * @returns {Array} Entries mit erweiterten Metadaten (escalationIndex, ebbinghausRetention, archivalStatus)
 */
export function decayKnowledgeEntries(entries, { now = new Date(), archivalThreshold = 0.12, ebbinghausEnabled = true } = {}) {
  return entries.map((entry) => {
    const enrichedEntry = {
      ...entry,
      score: normalizeScore(entry.score, 1),
      driftStatus: entry.driftStatus ?? "fresh",
      driftReasons: uniqueStrings(entry.driftReasons),
      lastValidatedAt: entry.lastValidatedAt ?? entry.updatedAt ?? entry.createdAt ?? new Date().toISOString()
    };

    if (enrichedEntry.status !== "active") {
      return enrichedEntry;
    }

    const lastTouch = parseTimestamp(enrichedEntry.updatedAt ?? enrichedEntry.createdAt);
    if (lastTouch === null) {
      return enrichedEntry;
    }

    const ageDays = Math.max(0, (now.getTime() - lastTouch) / 86400000);

    // Ebbinghaus-basiertes Decay (optional, default: enabled)
    let nextScore;
    if (ebbinghausEnabled) {
      const retention = ebbinghausRetention(
        enrichedEntry.score,
        enrichedEntry.accessCount ?? 0,
        ageDays
      );
      nextScore = normalizeScore(enrichedEntry.score * retention);
      enrichedEntry.ebbinghausRetention = Number(retention.toFixed(4));
    } else {
      // Fallback: lineares Decay (bestehendes Verhalten)
      nextScore = normalizeScore(enrichedEntry.score * Math.pow(0.995, Math.min(ageDays, 180)));
    }

    enrichedEntry.score = nextScore;
    enrichedEntry.ageDays = Number(ageDays.toFixed(2));

    // Escalation Index berechnen
    enrichedEntry.escalationIndex = calculateEscalationIndex(enrichedEntry);

    // Archival Status bestimmen
    if (enrichedEntry.escalationIndex < archivalThreshold) {
      enrichedEntry.archivalStatus = "cold";
    } else if (enrichedEntry.escalationIndex < 0.35) {
      enrichedEntry.archivalStatus = "warm";
    } else {
      enrichedEntry.archivalStatus = "hot";
    }

    return enrichedEntry;
  });
}

/**
 * Versetzt Eintraege mit niedrigem Escalation Index in den Archival-Zustand.
 * Archiviere Eintraege werden komprimiert und in Cold Storage verschoben.
 *
 * @param {Array} entries - Decayte Knowledge Entries
 * @param {number} archivalThreshold - EI-Schwelle fuer Archivierung (Default: 0.12)
 * @returns {{active: Array, archived: Array}} Getrennte Listen
 */
export function archiveLowEscalationEntries(entries, archivalThreshold = 0.12) {
  const active = [];
  const archived = [];

  for (const entry of entries) {
    const ei = entry.escalationIndex ?? calculateEscalationIndex(entry);

    if (ei < archivalThreshold && entry.status === "active") {
      // Komprimiere Eintrag fuer Cold Storage
      archived.push({
        ...entry,
        archivalStatus: "archived",
        archivedAt: new Date().toISOString(),
        escalationIndex: ei,
        compressedText: compressMemoryEntry(entry),
        // Entferne redundante Felder fuer Platzersparnis
        source: undefined,
        rationale: undefined,
        driftReasons: undefined
      });
    } else {
      active.push(entry);
    }
  }

  return { active, archived };
}

/**
 * Komprimiert einen Memory-Eintrag auf das Wesentliche.
 * Verlustfreie Kompression: ID, Typ, Topic und Text bleiben erhalten.
 *
 * @param {Object} entry - Knowledge Entry
 * @returns {string} Komprimierte Repraesentation
 */
function compressMemoryEntry(entry) {
  return `[${entry.type}:${entry.id}] ${entry.topic ? `(${entry.topic}) ` : ""}${entry.text?.substring(0, 200) ?? ""}`;
}

/**
 * Rekursive Deep-Truth Aufloesung: Wenn ein archivierter Eintrag
 * mit einem neuen Eintrag kollidiert, wird die aktuellste, validierteste
 * Wahrheit zurueckgegeben.
 *
 * @param {Array} archivedEntries - Archivierte Eintraege
 * @param {Array} newEntries - Neue Eintraege
 * @returns {Array} Aufgeloeste Eintraege (neue haben Prioritaet)
 */
export function resolveDeepTruth(archivedEntries, newEntries) {
  const resolved = [...newEntries];
  const resolvedIds = new Set(newEntries.map((e) => e.id));

  for (const archived of archivedEntries) {
    // Nur hinzufuegen wenn nicht bereits durch neuen Eintrag ersetzt
    if (!resolvedIds.has(archived.id) && !archived.invalidatedBy?.length) {
      resolved.push({
        ...archived,
        archivalStatus: "rehydrated",
        rehydratedAt: new Date().toISOString()
      });
    }
  }

  return resolved;
}

/**
 * Berechnet die Vitalitaets-Punktzahl eines Eintrags.
 * Kombiniert Escalation Index, Access Frequency und Success Rate
 * zu einem einzelnen Vitalitaets-Metrikwert.
 *
 * @param {Object} entry - Knowledge Entry
 * @returns {number} Vitality Score (0.0 - 1.0)
 */
export function calculateVitalityScore(entry) {
  const ei = entry.escalationIndex ?? calculateEscalationIndex(entry);
  const accessBonus = Math.min((entry.accessCount ?? 0) / 50, 0.2);
  const successBonus = (entry.successRate ?? entry.score ?? 0.5) * 0.15;
  const freshnessBonus = Math.max(0, 1 - (entry.ageDays ?? 0) / 30) * 0.15;

  return Number(Math.min(1, ei + accessBonus + successBonus + freshnessBonus).toFixed(4));
}

// ============================================================================
// BESTEHENDE FUNKTIONEN (unveraendert übernommen)
// ============================================================================

const REPLACEMENT_HINTS = [
  "switch", "switched", "replace", "replaced", "supersede", "superseded",
  "obsolete", "deprecated", "deprecate", "retire", "retired",
  "migrate", "migrated", "no longer", "stop using", "forbidden", "avoid"
];

function normalizeScore(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, Number(parsed.toFixed(4))));
}

function parseTimestamp(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function hasReplacementSignal(entry) {
  const haystack = [entry.text, entry.rationale, ...(entry.tags ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return Boolean(entry.replacesTopic) || REPLACEMENT_HINTS.some((hint) => haystack.includes(hint));
}

function canAffectEntry(sourceEntry, targetEntry) {
  if (sourceEntry.id === targetEntry.id || targetEntry.status !== "active") return false;
  if (sourceEntry.scope === "global") return true;
  return targetEntry.scope === sourceEntry.scope;
}

export function enrichKnowledgeEntry(entry) {
  return {
    ...entry,
    score: normalizeScore(entry.score, 1),
    driftStatus: entry.driftStatus ?? "fresh",
    driftReasons: uniqueStrings(entry.driftReasons),
    lastValidatedAt: entry.lastValidatedAt ?? entry.updatedAt ?? entry.createdAt ?? new Date().toISOString()
  };
}

export function annotateKnowledgeDrift(entries, { now = new Date(), warningDays = 21, staleDays = 45, lowScoreThreshold = 0.45 } = {}) {
  return entries.map((entry) => {
    const enrichedEntry = enrichKnowledgeEntry(entry);
    if (enrichedEntry.status !== "active") {
      return {
        ...enrichedEntry,
        driftStatus: "invalidated",
        driftReasons: uniqueStrings([...(enrichedEntry.driftReasons ?? []), "invalidated"])
      };
    }
    const lastTouch = parseTimestamp(enrichedEntry.updatedAt ?? enrichedEntry.createdAt);
    const ageDays = lastTouch === null ? 0 : Math.max(0, (now.getTime() - lastTouch) / 86400000);
    const driftReasons = [];
    if (ageDays >= staleDays) driftReasons.push("stale-age");
    else if (ageDays >= warningDays) driftReasons.push("aging");
    if (enrichedEntry.score <= lowScoreThreshold) driftReasons.push("low-score");

    return {
      ...enrichedEntry,
      ageDays: Number(ageDays.toFixed(2)),
      driftStatus: driftReasons.includes("stale-age") && driftReasons.includes("low-score")
        ? "stale" : driftReasons.length > 0 ? "watch" : "fresh",
      driftReasons: uniqueStrings(driftReasons)
    };
  });
}

export function deriveAutomaticInvalidations(addedEntries, existingEntries) {
  const invalidations = [];
  for (const addedEntry of addedEntries) {
    if (!addedEntry || addedEntry.status !== "active") continue;
    const normalizedAddedText = String(addedEntry.text ?? "").trim().toLowerCase();
    for (const existingEntry of existingEntries) {
      if (!canAffectEntry(addedEntry, existingEntry)) continue;
      if (addedEntry.type === "forbidden" && normalizedAddedText && normalizedAddedText === String(existingEntry.text ?? "").trim().toLowerCase()) {
        invalidations.push({
          matchId: existingEntry.id,
          scope: existingEntry.scope,
          reason: `Forbidden entry ${addedEntry.id} superseded ${existingEntry.id}`
        });
        continue;
      }
      if (!addedEntry.topic || addedEntry.topic !== existingEntry.topic || addedEntry.text === existingEntry.text) continue;
      if (addedEntry.type === existingEntry.type && (addedEntry.replacesTopic || hasReplacementSignal(addedEntry))) {
        invalidations.push({
          matchId: existingEntry.id,
          scope: existingEntry.scope,
          reason: `${addedEntry.type} ${addedEntry.id} superseded topic ${addedEntry.topic}`
        });
        continue;
      }
      if (["decision", "rule", "forbidden"].includes(addedEntry.type) && hasReplacementSignal(addedEntry)) {
        invalidations.push({
          matchId: existingEntry.id,
          scope: existingEntry.scope,
          reason: `${addedEntry.type} ${addedEntry.id} contradicted topic ${addedEntry.topic}`
        });
      }
    }
  }
  return invalidations;
}

export function buildForbiddenList(entries, { scope = "all" } = {}) {
  return entries
    .filter((entry) => entry.type === "forbidden" && entry.status === "active")
    .filter((entry) => scope === "all" || entry.scope === "global" || entry.scope === scope)
    .sort((left, right) => {
      const scoreDelta = normalizeScore(right.score, 1) - normalizeScore(left.score, 1);
      if (scoreDelta !== 0) return scoreDelta;
      return String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""));
    });
}

export function buildConflictCandidates(existingEntries, incomingEntries) {
  const conflicts = [];
  for (const incomingEntry of incomingEntries) {
    if (!incomingEntry?.topic || incomingEntry.status !== "active") continue;
    const conflictingEntry = existingEntries.find(
      (existingEntry) =>
        existingEntry.status === "active" &&
        existingEntry.type === incomingEntry.type &&
        existingEntry.topic === incomingEntry.topic &&
        existingEntry.text !== incomingEntry.text
    );
    if (conflictingEntry) {
      conflicts.push({ existingEntry: conflictingEntry, incomingEntry });
    }
  }
  return conflicts;
}

export function chooseConflictWinner(existingEntry, incomingEntry) {
  const existingTimestamp = parseTimestamp(existingEntry.updatedAt ?? existingEntry.createdAt) ?? 0;
  const incomingTimestamp = parseTimestamp(incomingEntry.updatedAt ?? incomingEntry.createdAt) ?? 0;
  if (incomingTimestamp > existingTimestamp) return "incoming";
  if (existingTimestamp > incomingTimestamp) return "existing";
  if (incomingEntry.scope === "project" && existingEntry.scope !== "project") return "incoming";
  return "existing";
}
