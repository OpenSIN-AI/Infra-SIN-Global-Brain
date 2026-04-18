/**
 * GovernanceEngine — the brain's drift gate on the ingest path.
 *
 * What it does:
 *   Before a new (non-ultra) knowledge entry is committed via
 *   store.addKnowledge(), the ingest handler asks the GovernanceEngine
 *   whether this entry contradicts the existing canon. A "contradiction"
 *   here means:
 *     (A) the new text is semantically close (embedding cosine) or
 *         textually close (token Jaccard) to an ACTIVE existing entry of
 *         the same type, AND
 *     (B) their negation polarity differs ("always X" vs "never X").
 *
 *   If (A)+(B) fire on at least one existing canon, the new entry is
 *   routed to pending-review instead of being committed. Otherwise we
 *   return { action: "accept" } and the ingest path continues as before.
 *
 * Why it's a separate engine (not a method on MetaLearner):
 *   MetaLearner detects contradictions after the fact, flagging pairs
 *   already committed to the WAL. Governance runs BEFORE the commit so a
 *   bad entry never reaches the cache in the first place. Sharing the
 *   polarity + similarity primitives but not the write path keeps both
 *   components single-purpose.
 *
 * Bypass rules:
 *   - `entry.ultra === true` (authored canon) never gates.
 *   - `entry.governance === "bypass"` escape hatch for seeders that
 *     already ran their own review pipeline.
 *
 * Thresholds are intentionally slightly more permissive than MetaLearner's
 * CONTRA_* because we want to catch *potential* drift at ingest time and
 * defer to a human reviewer, not auto-reject.
 */

const DEFAULTS = {
  CONFLICT_SIM: 0.82,        // embedding cosine threshold
  CONFLICT_JACCARD: 0.55,    // token Jaccard threshold
  MAX_CONFLICTS: 5,
  LEN_RATIO_MIN: 0.4         // skip comparisons between tiny and huge texts
};

const NEGATION_TOKENS = [
  "never", "don't", "do not", "no ", "avoid", "forbidden",
  "must not", "must-not", "mustn't", "nie", "nicht", "kein"
];

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "so", "of", "in", "on", "at", "to",
  "for", "with", "by", "from", "as", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would", "should",
  "can", "could", "may", "might", "must", "shall", "this", "that", "these",
  "those", "it", "its", "we", "you", "they", "them", "their", "our", "your",
  "always", "never", "not", "no", "yes", "all", "any", "some", "when", "where",
  "how", "why", "what", "which", "who", "whom", "der", "die", "das", "und",
  "oder", "aber", "nicht", "kein", "ist", "sind", "wird", "werden", "nie",
  "immer", "auf", "für", "mit", "von", "zu"
]);

const GATED_TYPES = new Set(["rule", "forbidden", "solution", "decision"]);

export class GovernanceEngine {
  constructor({ store, events, metrics, thresholds = {} } = {}) {
    this.store = store;
    this.events = events;
    this.metrics = metrics;
    this.t = { ...DEFAULTS, ...thresholds };
  }

  /**
   * Evaluate an enriched entry. Returns:
   *   { action: "accept" } — ingest should proceed
   *   { action: "pending-review", reason, conflicts: [{id, sim, via, polarity}] }
   *     — ingest should route to PendingStore
   *
   * Never throws on missing embedding; falls back to Jaccard silently.
   */
  async evaluate(entry) {
    if (!entry || !entry.text || !entry.type) {
      return { action: "accept", reason: "invalid-entry" };
    }
    if (entry.ultra === true) {
      return { action: "accept", reason: "ultra-bypass" };
    }
    if (entry.governance === "bypass") {
      return { action: "accept", reason: "explicit-bypass" };
    }
    if (!GATED_TYPES.has(entry.type)) {
      return { action: "accept", reason: "type-not-gated" };
    }

    const candidates = new Map(); // id -> { sim, via }

    // Path A: embedding cosine over active vectors of the same type.
    if (entry.embedding?.length && this.store?.cache?.index) {
      const vec = Float32Array.from(entry.embedding);
      const hits = await this.store.cache.index.search(vec, {
        limit: 8,
        minScore: this.t.CONFLICT_SIM
      });
      for (const h of hits) {
        if (h.id === entry.id) continue;
        candidates.set(h.id, { sim: h.score, via: "embedding" });
      }
    }

    // Path B: token Jaccard restricted to same type for O(|type|).
    const sameType = this.store?.cache?.byType?.get(entry.type);
    if (sameType) {
      const entryTokens = tokens(entry.text);
      for (const id of sameType) {
        if (candidates.has(id)) continue;
        const existing = this.store.cache.entries.get(id);
        if (!existing || existing.status !== "active") continue;
        const j = jaccard(entryTokens, tokens(existing.text));
        if (j >= this.t.CONFLICT_JACCARD) {
          candidates.set(id, { sim: j, via: "jaccard" });
        }
      }
    }

    // Filter: must be same-scope, same-type, polarity-mismatch, length-plausible.
    const newPolarity = polarity(entry.text);
    const conflicts = [];
    for (const [id, match] of candidates) {
      const existing = this.store.cache.entries.get(id);
      if (!existing || existing.status !== "active") continue;
      if (existing.type !== entry.type) continue;
      if (existing.scope !== entry.scope) continue;
      if (existing.id === entry.id) continue;

      const ratio = entry.text.length / Math.max(1, existing.text.length);
      if (ratio < this.t.LEN_RATIO_MIN || ratio > 1 / this.t.LEN_RATIO_MIN) continue;

      const existingPolarity = polarity(existing.text);
      if (existingPolarity === newPolarity) continue;

      conflicts.push({
        id,
        sim: +match.sim.toFixed(3),
        via: match.via,
        polarity: existingPolarity,
        text: existing.text.slice(0, 240),
        ultra: existing.ultra === true
      });
      if (conflicts.length >= this.t.MAX_CONFLICTS) break;
    }

    if (conflicts.length === 0) {
      this.metrics?.inc("brain_governance_accepted_total", { type: entry.type });
      return { action: "accept", reason: "no-conflict" };
    }

    this.metrics?.inc("brain_governance_pending_total", { type: entry.type });
    this.events?.emit({
      kind: "governance.pending",
      projectId: entry.source?.projectId ?? "global",
      summary: `${entry.type} pending review — ${conflicts.length} conflict(s)`,
      payload: { type: entry.type, conflicts: conflicts.map((c) => c.id), polarity: newPolarity }
    });
    return {
      action: "pending-review",
      reason: `polarity-mismatch (${conflicts.length} candidate${conflicts.length === 1 ? "" : "s"})`,
      polarity: newPolarity,
      conflicts
    };
  }
}

function polarity(text) {
  const t = ` ${String(text).toLowerCase()} `;
  for (const tok of NEGATION_TOKENS) {
    if (t.includes(` ${tok}`) || t.includes(`${tok} `)) return "negative";
  }
  return "positive";
}

function tokens(text) {
  const out = new Set();
  const matches = String(text).toLowerCase().match(/[a-z0-9äöüß][a-z0-9äöüß-]{2,}/g);
  if (!matches) return out;
  for (const tok of matches) {
    if (STOPWORDS.has(tok)) continue;
    if (NEGATION_TOKENS.some((n) => n.trim() === tok)) continue;
    out.add(tok);
  }
  return out;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
