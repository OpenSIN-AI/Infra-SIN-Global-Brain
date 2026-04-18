/**
 * EventBus — in-process fan-out of every committed brain mutation.
 *
 * Anyone inside the daemon (SSE endpoint, meta-learner, event-log writer,
 * metrics recorder) subscribes here. It is NOT the NeuralBus — that one
 * crosses process boundaries. This one is cheap, synchronous, and always on.
 *
 * Event shape (normalised, transport-friendly):
 *   { seq, ts, kind, projectId, summary, payload? }
 *
 * Kinds we emit:
 *   knowledge.add | knowledge.invalidate | rule.promote | rule.demote
 *   session.commit | meta.dedup | meta.contradiction | meta.decay
 *   metrics.tick
 *
 * The bus keeps a rolling ring buffer of the last N events so late-joining
 * SSE clients can replay recent history on connect.
 */

export class EventBus {
  constructor({ ringSize = 500 } = {}) {
    this.subs = new Set();
    this.ring = [];
    this.ringSize = ringSize;
    this.nextLocalSeq = 0;
  }

  emit(event) {
    this.nextLocalSeq += 1;
    const normalised = {
      localSeq: this.nextLocalSeq,
      ts: event.ts ?? new Date().toISOString(),
      seq: event.seq ?? null,
      kind: event.kind,
      projectId: event.projectId ?? "global",
      summary: event.summary ?? null,
      payload: event.payload ?? null
    };
    this.ring.push(normalised);
    if (this.ring.length > this.ringSize) this.ring.splice(0, this.ring.length - this.ringSize);
    for (const fn of this.subs) {
      try { fn(normalised); } catch { /* subscribers MUST NOT break the writer */ }
    }
    return normalised;
  }

  subscribe(fn) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  history({ sinceLocalSeq = 0, limit = 100, kinds = null } = {}) {
    const all = sinceLocalSeq
      ? this.ring.filter((e) => e.localSeq > sinceLocalSeq)
      : this.ring;
    const filtered = kinds ? all.filter((e) => kinds.includes(e.kind)) : all;
    return filtered.slice(-limit);
  }

  /**
   * Derive a transport-friendly event from a raw WAL record. Central
   * summarisation keeps every downstream consumer (SSE, meta-learner,
   * event-log) on the same shape.
   */
  static summariseRecord(record) {
    const p = record.payload ?? {};
    const projectId = p?.source?.projectId ?? p?.projectId ?? "global";
    let summary = null;
    switch (record.kind) {
      case "knowledge.add":
        summary = `${p.type ?? "entry"}:${p.id ?? "?"} "${truncate(p.text ?? "", 60)}"`;
        break;
      case "knowledge.invalidate":
        summary = `invalidate ${p.id ?? "?"}${p.reason ? " — " + p.reason : ""}`;
        break;
      case "rule.promote":
        summary = `PROMOTE ${p.id ?? "?"} to ultra`;
        break;
      case "rule.demote":
        summary = `DEMOTE ${p.id ?? "?"}${p.reason ? " — " + JSON.stringify(p.reason) : ""}`;
        break;
      case "session.commit":
        summary = `session end success=${p.success} consulted=${p.consultedRuleIds?.length ?? 0}`;
        break;
      default:
        summary = record.kind;
    }
    return {
      seq: record.seq,
      ts: record.ts ?? new Date().toISOString(),
      kind: record.kind,
      projectId,
      summary
    };
  }
}

function truncate(s, n) {
  s = String(s).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
