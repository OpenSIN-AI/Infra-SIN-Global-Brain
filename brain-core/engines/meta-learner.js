/**
 * MetaLearner — the brain's introspection loop.
 *
 * Three reflexive subsystems, each triggered at a different cadence:
 *
 *   1. Dedup (online, on every ingest) — if a new non-ultra entry is
 *      semantically ≥ DEDUP_SIM to an existing active one of the same type
 *      and scope, we do NOT insert a new row. Instead we bump the existing
 *      entry's usageCount, append the new text as an alias, and emit a
 *      `meta.dedup` event. Ultra canon is immune (it's authored).
 *
 *   2. Contradictions (batch, per tick) — walk all active rules, find pairs
 *      with cosine sim ≥ CONTRA_SIM whose texts disagree on negation
 *      polarity (one says "always X", the other "never X"). Flag both with
 *      `contradictsWith` and emit `meta.contradiction`. AutoPromoter demotes
 *      on next tick.
 *
 *   3. Decay (batch, per tick) — scores of rules not consulted recently
 *      decay with a 30-day half-life. Ultra rules are exempt. Sub-threshold
 *      scores become demote candidates for the AutoPromoter.
 *
 * All three are pure read-then-write; they never block the ingest path.
 */

const DEFAULTS = {
  DEDUP_SIM: 0.92,           // cosine similarity to treat as duplicate
  DEDUP_JACCARD: 0.80,       // token-Jaccard fallback for dedup
  DEDUP_LEN_RATIO: 0.5,      // text length ratio guard (0.5..2x)
  CONTRA_SIM: 0.88,          // embedding-cosine threshold for contradiction
  CONTRA_JACCARD: 0.60,      // token-Jaccard threshold for contradiction
  DECAY_HALFLIFE_DAYS: 30,
  DECAY_SKIP_RECENT_DAYS: 14 // only decay rules idle this long
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

export class MetaLearner {
  constructor({ store, events, metrics, thresholds = {} } = {}) {
    this.store = store;
    this.events = events;
    this.metrics = metrics;
    this.t = { ...DEFAULTS, ...thresholds };
  }

  /**
   * Online dedup. Called synchronously before store.addKnowledge().
   * Returns { merged: true, into: id } when the caller should SKIP the insert,
   * or { merged: false } when the caller should proceed.
   *
   * Runs TWO parallel paths so dedup works regardless of embedding quality:
   *   - embedding cosine ≥ DEDUP_SIM
   *   - token Jaccard ≥ DEDUP_JACCARD
   * Either is sufficient to merge. Polarity mismatch vetoes both.
   */
  async maybeDedup(entry) {
    if (entry.ultra === true) return { merged: false };
    if (entry.dedup === false) return { merged: false };

    const candidates = new Map(); // id -> { sim }

    // Path A: embedding cosine
    if (entry.embedding?.length) {
      const vec = Float32Array.from(entry.embedding);
      const hits = await this.store.cache.index.search(vec, {
        limit: 5,
        minScore: this.t.DEDUP_SIM
      });
      for (const h of hits) candidates.set(h.id, { sim: h.score, via: "embedding" });
    }

    // Path B: token Jaccard — scoped to the same type index so it's O(|type|).
    const sameType = this.store.cache.byType.get(entry.type);
    if (sameType) {
      const entryTokens = tokens(entry.text);
      for (const id of sameType) {
        if (candidates.has(id)) continue;
        const existing = this.store.cache.entries.get(id);
        if (!existing || existing.status !== "active") continue;
        const j = jaccard(entryTokens, tokens(existing.text));
        if (j >= this.t.DEDUP_JACCARD) candidates.set(id, { sim: j, via: "jaccard" });
      }
    }

    for (const [id, match] of candidates) {
      const existing = this.store.cache.entries.get(id);
      if (!existing || existing.status !== "active") continue;
      if (existing.type !== entry.type) continue;
      if (existing.scope !== entry.scope) continue;
      if (existing.id === entry.id) continue;

      const ratio = entry.text.length / Math.max(1, existing.text.length);
      if (ratio < this.t.DEDUP_LEN_RATIO || ratio > 1 / this.t.DEDUP_LEN_RATIO) continue;
      if (polarity(entry.text) !== polarity(existing.text)) continue;

      existing.usageCount = (existing.usageCount ?? 0) + 1;
      existing.updatedAt = new Date().toISOString();
      existing.aliases = existing.aliases ?? [];
      if (entry.text !== existing.text && !existing.aliases.includes(entry.text)) {
        existing.aliases.push(entry.text);
        if (existing.aliases.length > 10) existing.aliases.shift();
      }
      this.metrics?.inc("brain_meta_dedup_total", { type: entry.type, via: match.via });
      this.events?.emit({
        kind: "meta.dedup",
        projectId: entry.source?.projectId ?? "global",
        summary: `dedup ${entry.type} into ${existing.id} (${match.via}=${match.sim.toFixed(3)})`,
        payload: { into: existing.id, sim: match.sim, via: match.via, rejectedText: entry.text }
      });
      return { merged: true, into: existing.id, sim: match.sim, via: match.via };
    }
    return { merged: false };
  }

  /**
   * Batch contradiction detector. Returns a list of { a, b, sim, via } pairs.
   *
   * Two parallel paths like dedup:
   *   - embedding cosine ≥ CONTRA_SIM   (semantic)
   *   - token Jaccard   ≥ CONTRA_JACCARD (textual)
   * Polarity mismatch is required — two rules that mostly agree but negate
   * each other's directive are the signal we're after.
   */
  async detectContradictions() {
    const rules = [];
    for (const entry of this.store.cache.entries.values()) {
      if (entry.status !== "active") continue;
      if (entry.type !== "rule" && entry.type !== "forbidden" && entry.type !== "solution") continue;
      rules.push(entry);
    }

    const found = [];
    const seen = new Set();
    const flag = (a, b, sim, via) => {
      if (polarity(a.text) === polarity(b.text)) return;
      const [lo, hi] = a.id < b.id ? [a, b] : [b, a];
      const key = `${lo.id}|${hi.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      found.push({ key, a: lo.id, b: hi.id, sim: +sim.toFixed(3), via });
      lo.contradictsWith = unique([...(lo.contradictsWith ?? []), hi.id]);
      hi.contradictsWith = unique([...(hi.contradictsWith ?? []), lo.id]);
    };

    // Path A: embedding cosine per rule
    for (const a of rules) {
      if (!a.embedding?.length) continue;
      const hits = await this.store.cache.index.search(Float32Array.from(a.embedding), {
        limit: 5,
        minScore: this.t.CONTRA_SIM
      });
      for (const hit of hits) {
        if (hit.id === a.id) continue;
        const b = this.store.cache.entries.get(hit.id);
        if (!b || b.status !== "active") continue;
        flag(a, b, hit.score, "embedding");
      }
    }

    // Path B: token Jaccard over all rule pairs. O(n²) but n is small
    // (ultra canon + promoted rules) so this stays cheap.
    const tok = new Map();
    for (const r of rules) tok.set(r.id, tokens(r.text));
    for (let i = 0; i < rules.length; i += 1) {
      const a = rules[i];
      const ta = tok.get(a.id);
      if (!ta.size) continue;
      for (let j = i + 1; j < rules.length; j += 1) {
        const b = rules[j];
        const tb = tok.get(b.id);
        if (!tb.size) continue;
        const jac = jaccard(ta, tb);
        if (jac >= this.t.CONTRA_JACCARD) flag(a, b, jac, "jaccard");
      }
    }

    for (const { a, b, sim, via } of found) {
      this.metrics?.inc("brain_meta_contradictions_total", { via });
      this.events?.emit({
        kind: "meta.contradiction",
        summary: `${a} ↔ ${b} ${via}=${sim}`,
        payload: { a, b, sim, via }
      });
    }
    return found;
  }

  /**
   * Exponential score decay with the configured half-life. Returns a map of
   * id -> new score for entries that actually moved.
   */
  applyDecay() {
    const changed = {};
    const now = Date.now();
    const skipMs = this.t.DECAY_SKIP_RECENT_DAYS * 24 * 3600 * 1000;
    const halfLifeMs = this.t.DECAY_HALFLIFE_DAYS * 24 * 3600 * 1000;

    for (const entry of this.store.cache.entries.values()) {
      if (entry.status !== "active") continue;
      if (entry.ultra === true) continue;
      if (entry.type !== "rule" && entry.type !== "solution") continue;
      const lastUsed = entry.lastUsedAt ? Date.parse(entry.lastUsedAt) : Date.parse(entry.createdAt ?? new Date());
      const idle = now - lastUsed;
      if (idle < skipMs) continue;
      const baseline = entry.score ?? 1;
      const next = +(baseline * Math.pow(0.5, idle / halfLifeMs)).toFixed(4);
      if (next < baseline - 1e-4) {
        entry.score = next;
        entry.driftStatus = next < 0.35 ? "demote-candidate" : "watch";
        changed[entry.id] = next;
      }
    }
    const n = Object.keys(changed).length;
    if (n) {
      this.metrics?.inc("brain_meta_decay_total", {}, n);
      this.events?.emit({
        kind: "meta.decay",
        summary: `decayed ${n} rules`,
        payload: changed
      });
    }
    return changed;
  }

  /**
   * One-shot tick: contradictions + decay. Dedup stays online on the
   * ingest path.
   */
  async tick() {
    const contradictions = await this.detectContradictions();
    const decayed = this.applyDecay();
    return { contradictions: contradictions.length, decayed: Object.keys(decayed).length };
  }
}

function polarity(text) {
  const t = ` ${String(text).toLowerCase()} `;
  for (const tok of NEGATION_TOKENS) {
    if (t.includes(` ${tok}`) || t.includes(`${tok} `)) return "negative";
  }
  return "positive";
}

function unique(arr) {
  return [...new Set(arr)];
}

/** Extract content tokens (lowercased, ≥3 chars, no stopwords, no negations). */
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
