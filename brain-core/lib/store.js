/**
 * Store — the in-process, single-writer brain state.
 *
 * Write path:
 *   request -> validate -> append(WAL) -> apply(cache) -> mirror(disk, async)
 *
 * Every write produces exactly one WAL record so crash recovery is trivial:
 * on boot we open WAL, replay every record through `apply()`, which puts the
 * cache into the same state it had before the crash. Mirrors are eventual;
 * we rebuild them from the cache at checkpoint time.
 *
 * Supported record kinds:
 *   - knowledge.add       : add an entry (rule/decision/fact/solution/...)
 *   - knowledge.invalidate: mark an entry invalidated
 *   - rule.promote        : promote rule to ultra status
 *   - rule.demote         : remove ultra status
 *   - session.commit      : register a session outcome used for scoring
 */

import path from "node:path";

import { HotCache } from "./hot-cache.js";
import { WriteAheadLog } from "./wal.js";
import { ensureDir, readJsonFile, writeJsonFile } from "../../src/lib/storage.js";

export class BrainStore {
  constructor({ dataDir }) {
    if (!dataDir) throw new Error("BrainStore requires dataDir");
    this.dataDir = dataDir;
    this.walDir = path.join(dataDir, "wal");
    this.snapshotDir = path.join(dataDir, "snapshots");
    this.cache = new HotCache();
    this.wal = new WriteAheadLog({ directory: this.walDir });
    this.listeners = new Set();
    this.ready = false;
  }

  async open() {
    await ensureDir(this.dataDir);
    await ensureDir(this.snapshotDir);
    await this.wal.open();

    const snapshot = await this.#loadSnapshot();
    if (snapshot) {
      this.#applySnapshot(snapshot);
    }

    await this.wal.replay(async (record) => {
      await this.#apply(record, { replaying: true });
    }, { fromSeq: this.cache.appliedSeq });

    this.ready = true;
  }

  async close() {
    await this.wal.close();
  }

  /** Subscribe to every applied record (post-commit). */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---- write path ----

  async addKnowledge(entry, { actor = "system" } = {}) {
    if (!entry?.id || !entry?.type || !entry?.text) {
      throw new Error("addKnowledge requires id/type/text");
    }
    const record = await this.wal.append("knowledge.add", entry, actor);
    await this.#apply(record, { replaying: false });
    return entry;
  }

  async invalidateKnowledge(id, reason, { actor = "system" } = {}) {
    const record = await this.wal.append(
      "knowledge.invalidate",
      { id, reason: reason ?? null },
      actor
    );
    await this.#apply(record, { replaying: false });
  }

  async promoteRule(id, promotion, { actor = "meta-learning" } = {}) {
    const record = await this.wal.append(
      "rule.promote",
      { id, promotion },
      actor
    );
    await this.#apply(record, { replaying: false });
  }

  async demoteRule(id, reason, { actor = "meta-learning" } = {}) {
    const record = await this.wal.append(
      "rule.demote",
      { id, reason: reason ?? null },
      actor
    );
    await this.#apply(record, { replaying: false });
  }

  async commitSession(summary, { actor = "agent" } = {}) {
    const record = await this.wal.append("session.commit", summary, actor);
    await this.#apply(record, { replaying: false });
  }

  // ---- read path ----

  rules(filter) {
    return this.cache.activeRules(filter);
  }

  entriesByType(type) {
    return this.cache.entriesByType(type);
  }

  vectorSearch(query, opts) {
    return this.cache.vectorSearch(query, opts);
  }

  stats() {
    return this.cache.stats();
  }

  // ---- checkpointing ----

  async checkpoint() {
    const payload = {
      appliedSeq: this.cache.appliedSeq,
      savedAt: new Date().toISOString(),
      entries: [...this.cache.entries.values()],
      ultraRules: [...this.cache.ultraRules]
    };
    const file = path.join(this.snapshotDir, "latest.json");
    await writeJsonFile(file, payload);
    return file;
  }

  async #loadSnapshot() {
    const file = path.join(this.snapshotDir, "latest.json");
    return readJsonFile(file, null);
  }

  #applySnapshot(snapshot) {
    for (const entry of snapshot.entries ?? []) {
      this.cache.upsert(entry);
    }
    for (const id of snapshot.ultraRules ?? []) {
      if (!this.cache.ultraRules.includes(id)) this.cache.ultraRules.push(id);
    }
    this.cache.setAppliedSeq(snapshot.appliedSeq ?? 0);
  }

  async #apply(record, { replaying }) {
    switch (record.kind) {
      case "knowledge.add": {
        this.cache.upsert(record.payload);
        break;
      }
      case "knowledge.invalidate": {
        this.cache.invalidate(record.payload.id);
        break;
      }
      case "rule.promote": {
        const entry = this.cache.entries.get(record.payload.id);
        if (entry) {
          entry.ultra = true;
          entry.ultraPromotion = record.payload.promotion ?? null;
          this.cache.upsert(entry);
        }
        break;
      }
      case "rule.demote": {
        const entry = this.cache.entries.get(record.payload.id);
        if (entry) {
          entry.ultra = false;
          entry.ultraPromotion = null;
          const idx = this.cache.ultraRules.indexOf(record.payload.id);
          if (idx !== -1) this.cache.ultraRules.splice(idx, 1);
          this.cache.upsert(entry);
        }
        break;
      }
      case "session.commit": {
        // Scoring hook — meta-learning subscribers react here.
        break;
      }
      default:
        // Unknown record kinds are tolerated during replay (forward compat).
        break;
    }
    this.cache.setAppliedSeq(record.seq);
    if (!replaying) {
      for (const fn of this.listeners) {
        try { fn(record); } catch { /* listener must not break writer */ }
      }
    }
  }
}
