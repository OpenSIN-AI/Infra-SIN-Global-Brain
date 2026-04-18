/**
 * HotCache — in-RAM projections that serve every Brain read.
 *
 * - `rules`      : ordered list of active rule/forbidden entries, keyed by id
 * - `entries`    : all active knowledge (all types), keyed by id
 * - `byType`     : secondary index type -> Set<id>
 * - `byProject`  : project scope index projectId -> Set<id>
 * - `vectors`    : id -> Float32Array embedding for cosine search
 * - `ultraRules` : globally promoted rules that ALWAYS win (order preserved)
 *
 * The cache is rebuilt on boot by replaying WAL records; after that it is
 * mutated synchronously in the same code path that appends to the WAL, so
 * readers never see torn state.
 */

import { LRUCache } from "lru-cache";

import { VectorIndex } from "../engines/vector-index.js";

export class HotCache {
  constructor({ maxQueryCache = 10_000, vectorMode = "auto" } = {}) {
    this.rules = new Map();        // id -> entry
    this.entries = new Map();      // id -> entry
    this.byType = new Map();       // type -> Set<id>
    this.byProject = new Map();    // projectId -> Set<id>
    this.vectors = new Map();      // id -> Float32Array (mirrors index for quick dim checks)
    this.ultraRules = [];          // ordered ids
    this.appliedSeq = 0;
    this.queryCache = new LRUCache({ max: maxQueryCache, ttl: 30_000 });
    this.index = new VectorIndex({ mode: vectorMode });
  }

  /**
   * Upsert an entry. Returns the stored shape (readonly by convention).
   */
  upsert(entry) {
    if (!entry?.id) return null;
    this.entries.set(entry.id, entry);

    const typeSet = this.byType.get(entry.type) ?? new Set();
    typeSet.add(entry.id);
    this.byType.set(entry.type, typeSet);

    if (entry.source?.projectId) {
      const projSet = this.byProject.get(entry.source.projectId) ?? new Set();
      projSet.add(entry.id);
      this.byProject.set(entry.source.projectId, projSet);
    }

    if (entry.type === "rule" || entry.type === "forbidden") {
      this.rules.set(entry.id, entry);
    }

    if (Array.isArray(entry.embedding) && entry.embedding.length) {
      const vec = Float32Array.from(entry.embedding);
      this.vectors.set(entry.id, vec);
      this.index.upsert(entry.id, vec);
    }

    if (entry.ultra === true) {
      if (!this.ultraRules.includes(entry.id)) this.ultraRules.push(entry.id);
    }

    this.queryCache.clear();
    return entry;
  }

  invalidate(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.status = "invalidated";
    this.rules.delete(id);
    this.index.remove(id);
    const ultraIdx = this.ultraRules.indexOf(id);
    if (ultraIdx !== -1) this.ultraRules.splice(ultraIdx, 1);
    this.queryCache.clear();
  }

  setAppliedSeq(seq) {
    if (seq > this.appliedSeq) this.appliedSeq = seq;
  }

  /** Get all active rules with ultra rules first, in priority order. */
  activeRules({ scope, projectId } = {}) {
    const cacheKey = `rules:${scope ?? "all"}:${projectId ?? "*"}`;
    const cached = this.queryCache.get(cacheKey);
    if (cached) return cached;

    const ultraSet = new Set(this.ultraRules);
    const ultras = this.ultraRules
      .map((id) => this.entries.get(id))
      .filter((e) => e && e.status === "active");

    const rest = [];
    for (const entry of this.rules.values()) {
      if (entry.status !== "active") continue;
      if (ultraSet.has(entry.id)) continue;
      if (scope && entry.scope !== scope && scope !== "all") continue;
      if (projectId && entry.scope === "project" && entry.source?.projectId !== projectId) continue;
      rest.push(entry);
    }
    rest.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const out = [...ultras, ...rest];
    this.queryCache.set(cacheKey, out);
    return out;
  }

  entriesByType(type) {
    const ids = this.byType.get(type);
    if (!ids) return [];
    const out = [];
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (entry && entry.status === "active") out.push(entry);
    }
    return out;
  }

  /** Cosine similarity search — delegates to the pluggable VectorIndex. */
  async vectorSearch(query, { limit = 8, minScore = 0.15 } = {}) {
    if (!query || !query.length) return [];
    const hits = await this.index.search(query, { limit: limit * 2, minScore });
    const out = [];
    for (const { id, score } of hits) {
      const entry = this.entries.get(id);
      if (!entry || entry.status !== "active") continue;
      out.push({ id, score, entry });
      if (out.length >= limit) break;
    }
    return out;
  }

  stats() {
    return {
      appliedSeq: this.appliedSeq,
      entries: this.entries.size,
      rules: this.rules.size,
      ultraRules: this.ultraRules.length,
      vectors: this.vectors.size,
      projects: this.byProject.size,
      vectorIndex: this.index.stats()
    };
  }
}
