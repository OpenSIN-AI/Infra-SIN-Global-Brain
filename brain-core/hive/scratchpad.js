import { randomUUID } from "node:crypto";

/**
 * Scratchpad — shared working memory for a single orchestration run.
 *
 * Every parallel worker in a run can read + write the same pad. Writes use
 * optimistic concurrency (compare-and-swap on version), so two workers racing
 * on the same key don't silently clobber each other. `append` is separate and
 * atomic so multiple workers can stream partial output into the same list
 * without a CAS dance.
 *
 * Pads are project-scoped, TTL'd, and sweep themselves. They never hit the
 * WAL — they are intentionally ephemeral. Durable conclusions must be written
 * to `store.addKnowledge` as a reflection by the orchestrator at the end of
 * the run.
 */
export class Scratchpad {
  constructor({ events, defaultTtlMs = 5 * 60_000, sweepMs = 10_000 } = {}) {
    this.events = events;
    this.defaultTtlMs = defaultTtlMs;
    this.sweepMs = sweepMs;
    // id -> { id, projectId, createdAt, expiresAt, keys: Map<key, {version, value, updatedAt, updatedBy}>, log: [] }
    this.pads = new Map();
    this._timer = null;
  }

  startSweeper() {
    if (this._timer) return;
    this._timer = setInterval(() => this.sweep(), this.sweepMs);
    this._timer.unref?.();
  }

  stopSweeper() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  create({ projectId = "global", ttlMs, seed = {}, tags = [] } = {}) {
    const id = randomUUID();
    const now = Date.now();
    const pad = {
      id,
      projectId,
      tags,
      createdAt: now,
      expiresAt: now + (ttlMs ?? this.defaultTtlMs),
      keys: new Map(),
      log: []
    };
    for (const [k, v] of Object.entries(seed)) {
      pad.keys.set(k, { version: 1, value: v, updatedAt: now, updatedBy: "seed" });
    }
    this.pads.set(id, pad);
    return { id, projectId, expiresAt: pad.expiresAt };
  }

  get(padId, key) {
    const pad = this.pads.get(padId);
    if (!pad) return { ok: false, error: "unknown pad" };
    if (!key) {
      const obj = {};
      for (const [k, cell] of pad.keys) obj[k] = { value: cell.value, version: cell.version };
      return { ok: true, projectId: pad.projectId, keys: obj, log: pad.log };
    }
    const cell = pad.keys.get(key);
    if (!cell) return { ok: true, value: null, version: 0 };
    return { ok: true, value: cell.value, version: cell.version, updatedBy: cell.updatedBy };
  }

  /**
   * CAS write. `expectedVersion === null` treats "no prior entry" as match.
   * `expectedVersion === -1` is a forced write (use sparingly).
   */
  set(padId, key, value, { expectedVersion = null, actor = "anon" } = {}) {
    const pad = this.pads.get(padId);
    if (!pad) return { ok: false, error: "unknown pad" };
    const cell = pad.keys.get(key);
    const current = cell?.version ?? 0;
    if (expectedVersion !== -1 && expectedVersion !== null && expectedVersion !== current) {
      return { ok: false, error: "version-conflict", currentVersion: current };
    }
    const next = { version: current + 1, value, updatedAt: Date.now(), updatedBy: actor };
    pad.keys.set(key, next);
    pad.log.push({ at: next.updatedAt, actor, op: "set", key, version: next.version });
    if (pad.log.length > 500) pad.log.shift();
    return { ok: true, version: next.version };
  }

  /**
   * Append a chunk to an array-valued key. Auto-creates as []. Atomic —
   * multiple workers can stream findings into the same key safely.
   */
  append(padId, key, chunk, { actor = "anon" } = {}) {
    const pad = this.pads.get(padId);
    if (!pad) return { ok: false, error: "unknown pad" };
    const cell = pad.keys.get(key);
    const arr = Array.isArray(cell?.value) ? cell.value.slice() : [];
    arr.push(chunk);
    const next = {
      version: (cell?.version ?? 0) + 1,
      value: arr,
      updatedAt: Date.now(),
      updatedBy: actor
    };
    pad.keys.set(key, next);
    pad.log.push({ at: next.updatedAt, actor, op: "append", key, version: next.version });
    if (pad.log.length > 500) pad.log.shift();
    return { ok: true, version: next.version, length: arr.length };
  }

  destroy(padId) {
    return this.pads.delete(padId);
  }

  sweep(now = Date.now()) {
    const dead = [];
    for (const [id, pad] of this.pads) if (pad.expiresAt < now) dead.push(id);
    for (const id of dead) this.pads.delete(id);
    return dead.length;
  }

  stats() {
    let keys = 0;
    for (const pad of this.pads.values()) keys += pad.keys.size;
    return { pads: this.pads.size, keys };
  }
}
