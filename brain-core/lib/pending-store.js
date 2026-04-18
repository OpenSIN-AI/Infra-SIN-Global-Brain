/**
 * PendingStore — durable queue of knowledge entries held back by the
 * GovernanceEngine until a human (or another authority) signs off.
 *
 * Why a separate store (not the WAL)?
 *   Pending entries are not yet truth. The WAL is the log of *accepted*
 *   brain mutations; mixing tentative ingests there would pollute replay
 *   semantics. Instead we keep an append-only JSONL journal plus an
 *   in-memory index that rebuilds on boot.
 *
 * File format: one JSON object per line with { op, ts, item } where
 *   op = "add" | "approve" | "reject"
 *   item = PendingItem (for add) or { id, reviewer, note | reason } (other ops)
 *
 * On open(), we replay the journal and materialise the set of open items.
 * Approved/rejected items are kept in a bounded history ring for audit.
 *
 * Approve is the only path that actually commits into the brain — it hands
 * the original enriched entry back to the caller who is expected to run
 * store.addKnowledge() exactly like the ingest path would have.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { ensureDir } from "../../src/lib/storage.js";

const HISTORY_LIMIT = 200;

export class PendingStore {
  constructor({ dataDir, historyLimit = HISTORY_LIMIT } = {}) {
    if (!dataDir) throw new Error("PendingStore requires dataDir");
    this.file = path.join(dataDir, "pending-review.jsonl");
    this.historyLimit = historyLimit;
    this.open = new Map();          // id -> PendingItem
    this.history = [];              // recently approved/rejected, newest first
    this.stream = null;
    this.counters = { added: 0, approved: 0, rejected: 0 };
  }

  async init() {
    await ensureDir(path.dirname(this.file));
    if (fs.existsSync(this.file)) {
      const text = fs.readFileSync(this.file, "utf8");
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const rec = JSON.parse(line);
          this.#applyRecord(rec, { replaying: true });
        } catch { /* skip corrupt line */ }
      }
    }
    this.stream = fs.createWriteStream(this.file, { flags: "a" });
  }

  async close() {
    if (this.stream) {
      await new Promise((resolve) => this.stream.end(resolve));
      this.stream = null;
    }
  }

  /**
   * Add a new pending item. Returns the created PendingItem.
   * `entry` is the fully-enriched knowledge object the ingest pipeline
   * produced; `conflicts` is a list of existing-entry references.
   */
  add({ entry, conflicts = [], actor = "agent", reason = null }) {
    if (!entry?.id || !entry?.type || !entry?.text) {
      throw new Error("PendingStore.add: entry requires id/type/text");
    }
    const item = {
      id: `pend-${randomUUID().slice(0, 8)}`,
      status: "pending",
      createdAt: new Date().toISOString(),
      actor: actor ?? "agent",
      reason: reason ?? null,
      conflicts: Array.isArray(conflicts) ? conflicts : [],
      entry
    };
    this.#journal({ op: "add", ts: item.createdAt, item });
    this.#applyRecord({ op: "add", item }, { replaying: false });
    return item;
  }

  approve({ id, reviewer = "human", note = null }) {
    const item = this.open.get(id);
    if (!item) throw new Error(`PendingStore.approve: unknown id ${id}`);
    const decision = { id, reviewer, note, ts: new Date().toISOString() };
    this.#journal({ op: "approve", ts: decision.ts, item: decision });
    this.#applyRecord({ op: "approve", item: decision }, { replaying: false });
    return { ...item, status: "approved", reviewer, note, decidedAt: decision.ts };
  }

  reject({ id, reviewer = "human", reason = null }) {
    const item = this.open.get(id);
    if (!item) throw new Error(`PendingStore.reject: unknown id ${id}`);
    const decision = { id, reviewer, reason, ts: new Date().toISOString() };
    this.#journal({ op: "reject", ts: decision.ts, item: decision });
    this.#applyRecord({ op: "reject", item: decision }, { replaying: false });
    return { ...item, status: "rejected", reviewer, reason, decidedAt: decision.ts };
  }

  list({ limit = 50, status = "pending" } = {}) {
    if (status === "pending") {
      return [...this.open.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, limit);
    }
    return this.history.filter((h) => status === "all" || h.status === status).slice(0, limit);
  }

  get(id) {
    return this.open.get(id) ?? this.history.find((h) => h.id === id) ?? null;
  }

  stats() {
    return {
      pending: this.open.size,
      history: this.history.length,
      ...this.counters
    };
  }

  // ---- internal ----

  #journal(record) {
    if (!this.stream) throw new Error("PendingStore not initialised");
    this.stream.write(JSON.stringify(record) + "\n");
  }

  #applyRecord(record, { replaying }) {
    switch (record.op) {
      case "add": {
        const item = record.item;
        this.open.set(item.id, item);
        this.counters.added += 1;
        break;
      }
      case "approve": {
        const decision = record.item;
        const item = this.open.get(decision.id);
        if (item) {
          this.open.delete(decision.id);
          this.#pushHistory({
            ...item,
            status: "approved",
            reviewer: decision.reviewer,
            note: decision.note ?? null,
            decidedAt: decision.ts
          });
        }
        this.counters.approved += 1;
        break;
      }
      case "reject": {
        const decision = record.item;
        const item = this.open.get(decision.id);
        if (item) {
          this.open.delete(decision.id);
          this.#pushHistory({
            ...item,
            status: "rejected",
            reviewer: decision.reviewer,
            reason: decision.reason ?? null,
            decidedAt: decision.ts
          });
        }
        this.counters.rejected += 1;
        break;
      }
      default:
        break;
    }
    // replaying flag reserved for future listeners; no-op today
    void replaying;
  }

  #pushHistory(item) {
    this.history.unshift(item);
    if (this.history.length > this.historyLimit) {
      this.history.length = this.historyLimit;
    }
  }
}
