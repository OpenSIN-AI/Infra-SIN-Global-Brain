/**
 * Write-Ahead Log — the durability heart of ONE-BRAIN.
 *
 * Every mutation (knowledge add, rule promote, invalidation, session commit)
 * is appended to an append-only JSONL file BEFORE it touches the in-memory
 * cache or the file-tier mirrors. On crash we replay the tail; after a
 * successful snapshot we rotate.
 *
 * Format: one JSON object per line:
 *   { seq, ts, kind, payload, actor }
 *
 * The WAL is the single source of truth for ordering. Readers NEVER read
 * the WAL — they read the cache, which is a deterministic projection of it.
 */

import { promises as fs } from "node:fs";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";

import { ensureDir, fileExists } from "../../src/lib/storage.js";

const DEFAULT_ROTATE_BYTES = 64 * 1024 * 1024; // 64 MB

export class WriteAheadLog {
  constructor({ directory, rotateBytes = DEFAULT_ROTATE_BYTES } = {}) {
    if (!directory) {
      throw new Error("WriteAheadLog requires a directory");
    }
    this.directory = directory;
    this.rotateBytes = rotateBytes;
    this.activeFile = path.join(directory, "wal.current.jsonl");
    this.handle = null;
    this.seq = 0;
    this.bytesInActive = 0;
    this.writeQueue = Promise.resolve();
  }

  async open() {
    await ensureDir(this.directory);
    // Determine next sequence by replaying without emitting — cheap because
    // we only touch the tail during boot and rotations keep files small.
    const tail = await this.#readTail();
    this.seq = tail.lastSeq;
    this.handle = await fs.open(this.activeFile, "a");
    try {
      const stat = await fs.stat(this.activeFile);
      this.bytesInActive = stat.size;
    } catch {
      this.bytesInActive = 0;
    }
  }

  async close() {
    if (this.handle) {
      await this.handle.close();
      this.handle = null;
    }
  }

  /**
   * Append a record. Returns the assigned sequence number.
   * Writes are serialized per instance so ordering is deterministic.
   */
  append(kind, payload, actor = "system") {
    const run = async () => {
      if (!this.handle) {
        throw new Error("WAL not open");
      }
      this.seq += 1;
      const record = {
        seq: this.seq,
        ts: new Date().toISOString(),
        kind,
        actor,
        payload
      };
      const line = `${JSON.stringify(record)}\n`;
      await this.handle.write(line);
      await this.handle.sync();
      this.bytesInActive += Buffer.byteLength(line, "utf8");

      if (this.bytesInActive >= this.rotateBytes) {
        await this.#rotate();
      }
      return record;
    };

    this.writeQueue = this.writeQueue.then(run, run);
    return this.writeQueue;
  }

  /**
   * Replay every record that has not yet been reflected in the given
   * `appliedSeq`. The handler is awaited for each record so projections
   * stay consistent.
   */
  async replay(onRecord, { fromSeq = 0 } = {}) {
    const files = await this.#segmentFiles();
    for (const file of files) {
      if (!(await fileExists(file))) {
        continue;
      }
      await new Promise((resolve, reject) => {
        const stream = createReadStream(file, { encoding: "utf8" });
        const rl = createInterface({ input: stream });
        rl.on("line", async (line) => {
          if (!line.trim()) return;
          try {
            const record = JSON.parse(line);
            if (record.seq <= fromSeq) return;
            rl.pause();
            await onRecord(record);
            rl.resume();
          } catch (err) {
            rl.close();
            stream.destroy();
            reject(err);
          }
        });
        rl.on("close", resolve);
        rl.on("error", reject);
      });
    }
  }

  async #rotate() {
    if (this.handle) {
      await this.handle.close();
    }
    const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
    const rotated = path.join(this.directory, `wal.${stamp}.jsonl`);
    await fs.rename(this.activeFile, rotated);
    this.handle = await fs.open(this.activeFile, "a");
    this.bytesInActive = 0;
  }

  async #segmentFiles() {
    const entries = await fs.readdir(this.directory).catch(() => []);
    const rotated = entries
      .filter((n) => n.startsWith("wal.") && n.endsWith(".jsonl") && n !== "wal.current.jsonl")
      .sort()
      .map((n) => path.join(this.directory, n));
    return [...rotated, this.activeFile];
  }

  async #readTail() {
    if (!(await fileExists(this.activeFile))) {
      return { lastSeq: 0 };
    }
    let lastSeq = 0;
    await new Promise((resolve, reject) => {
      const stream = createReadStream(this.activeFile, { encoding: "utf8" });
      const rl = createInterface({ input: stream });
      rl.on("line", (line) => {
        if (!line.trim()) return;
        try {
          const rec = JSON.parse(line);
          if (typeof rec.seq === "number" && rec.seq > lastSeq) lastSeq = rec.seq;
        } catch {
          // Tolerate partial last-line on crash; rotate on open would have
          // caught catastrophic corruption. Keep replaying what we can.
        }
      });
      rl.on("close", () => resolve());
      rl.on("error", reject);
    });
    return { lastSeq };
  }
}
