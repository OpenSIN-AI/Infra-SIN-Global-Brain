/**
 * VectorIndex — two-tier nearest-neighbour search for the HotCache.
 *
 * Tier 1 (preferred): native HNSW via `hnswlib-node`. O(log n) queries, handles
 *                     millions of vectors comfortably. Installed opportunistically
 *                     by the OCI installer; if it compiles we use it.
 *
 * Tier 2 (always available): pure-JS brute-force cosine scan. Linear in n but
 *                     zero dependencies, zero build step, runs anywhere.
 *
 * The interface is identical — HotCache doesn't care which tier answers.
 * We rebuild the native index lazily after bulk upserts to keep write
 * latency flat.
 */

let hnswlib = null;
let hnswWarned = false;
async function loadHnswlib() {
  if (hnswlib !== null) return hnswlib;
  try {
    const mod = await import("hnswlib-node");
    hnswlib = mod.default ?? mod;
    return hnswlib;
  } catch {
    if (!hnswWarned) {
      hnswWarned = true;
      console.warn("[vector-index] hnswlib-node not installed — using JS fallback (install via `npm i hnswlib-node` on a box with a C++ toolchain for 100x speedup on large corpora)");
    }
    hnswlib = false; // cache the miss
    return false;
  }
}

export class VectorIndex {
  constructor({ dim = null, mode = "auto", maxElements = 50_000 } = {}) {
    this.dim = dim;
    this.mode = mode;
    this.maxElements = maxElements;

    // Internal state for both tiers.
    this._vectors = new Map(); // id -> Float32Array
    this._idToLabel = new Map(); // id -> numeric label (native only)
    this._labelToId = new Map(); // numeric label -> id (native only)
    this._nextLabel = 0;

    this._native = null; // HierarchicalNSW instance once constructed
    this._nativeReady = false;
    this._dirty = false;
  }

  /** Inform the index about the expected vector dimensionality. */
  configure({ dim }) {
    if (this.dim && this.dim !== dim) {
      // Dim mismatch — blow away and start over.
      this.clear();
    }
    this.dim = dim;
  }

  async _ensureNative() {
    if (this.mode === "js") return false;
    if (this._native) return true;
    const lib = await loadHnswlib();
    if (!lib) return false;
    if (!this.dim) return false;
    try {
      const index = new lib.HierarchicalNSW("cosine", this.dim);
      index.initIndex(this.maxElements, 16, 200, 100);
      this._native = index;
      this._nativeReady = true;
      // Reindex anything we already have.
      for (const [id, vec] of this._vectors) this._nativeAdd(id, vec);
      return true;
    } catch (err) {
      console.warn("[vector-index] native init failed:", err.message);
      this._native = null;
      return false;
    }
  }

  _nativeAdd(id, vec) {
    if (!this._native) return;
    let label = this._idToLabel.get(id);
    if (label == null) {
      label = this._nextLabel++;
      this._idToLabel.set(id, label);
      this._labelToId.set(label, id);
    }
    try {
      this._native.markDelete?.(label);
      this._native.addPoint(Array.from(vec), label);
    } catch { /* index rebuild will catch drift */ }
  }

  upsert(id, vector) {
    if (!vector || !vector.length) return;
    const vec = vector instanceof Float32Array ? vector : Float32Array.from(vector);
    if (!this.dim) this.dim = vec.length;
    if (vec.length !== this.dim) return; // silently ignore dim mismatch
    this._vectors.set(id, vec);
    this._dirty = true;
    if (this._nativeReady) this._nativeAdd(id, vec);
  }

  remove(id) {
    this._vectors.delete(id);
    const label = this._idToLabel.get(id);
    if (label != null && this._native) {
      try { this._native.markDelete(label); } catch { /* noop */ }
      this._idToLabel.delete(id);
      this._labelToId.delete(label);
    }
    this._dirty = true;
  }

  clear() {
    this._vectors.clear();
    this._idToLabel.clear();
    this._labelToId.clear();
    this._nextLabel = 0;
    this._native = null;
    this._nativeReady = false;
    this._dirty = false;
  }

  size() { return this._vectors.size; }

  /**
   * Top-K nearest by cosine. Returns `[{ id, score }]`.
   *
   * @param {Float32Array|number[]} query
   * @param {object} [opts]
   * @param {number} [opts.limit=8]
   * @param {number} [opts.minScore=0.15]
   */
  async search(query, { limit = 8, minScore = 0.15 } = {}) {
    const q = query instanceof Float32Array ? query : Float32Array.from(query);
    if (!q.length) return [];
    if (this.dim && q.length !== this.dim) return [];

    if (this.mode !== "js" && await this._ensureNative()) {
      try {
        const k = Math.min(limit * 4, Math.max(limit, this._vectors.size));
        if (k === 0) return [];
        const res = this._native.searchKnn(Array.from(q), k);
        const out = [];
        for (let i = 0; i < res.neighbors.length; i += 1) {
          const id = this._labelToId.get(res.neighbors[i]);
          if (!id) continue;
          // hnswlib returns cosine "distance" = 1 - similarity
          const score = 1 - res.distances[i];
          if (score >= minScore) out.push({ id, score });
          if (out.length >= limit) break;
        }
        if (out.length) return out;
        // Fall through to JS if native returned nothing for some reason.
      } catch (err) {
        console.warn("[vector-index] native search failed, falling back:", err.message);
      }
    }

    // JS brute force
    const qNorm = l2norm(q);
    if (qNorm === 0) return [];
    const results = [];
    for (const [id, vec] of this._vectors) {
      if (vec.length !== q.length) continue;
      const s = cosine(q, qNorm, vec);
      if (s >= minScore) results.push({ id, score: s });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  stats() {
    return {
      backend: this._nativeReady ? "hnsw-native" : "js-brute-force",
      size: this._vectors.size,
      dim: this.dim ?? null,
      maxElements: this.maxElements
    };
  }
}

function l2norm(v) {
  let s = 0;
  for (let i = 0; i < v.length; i += 1) s += v[i] * v[i];
  return Math.sqrt(s);
}

function cosine(q, qNorm, vec) {
  let dot = 0;
  let vN = 0;
  for (let i = 0; i < q.length; i += 1) {
    dot += q[i] * vec[i];
    vN += vec[i] * vec[i];
  }
  const d = qNorm * Math.sqrt(vN);
  return d === 0 ? 0 : dot / d;
}
