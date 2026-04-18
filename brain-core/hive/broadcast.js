/**
 * BroadcastCortex — live telepathy between agents during a run.
 *
 * Every message is:
 *   1. Fan-out to in-process subscribers for that runId (for the orchestrator
 *      and same-VM agents).
 *   2. Mirrored into the EventBus (so SSE, Prometheus, audit log pick it up).
 *   3. Optionally published on NATS subject `brain.hive.<runId>` so agents on
 *      other VMs see it too.
 *
 * Message kinds:
 *   - "plan"        planner emitted a DAG
 *   - "dispatch"    orchestrator assigned a node to an agent
 *   - "thinking"    worker mid-execution hint ("about to call search API")
 *   - "finding"     worker reports a partial result other workers can use
 *   - "blocking"    worker is stuck / needs help
 *   - "done"        worker finished a node
 *   - "aggregated"  prime composed the final answer
 *   - "proposal"    worker proposes a rule to consensus
 */
export class BroadcastCortex {
  constructor({ events, neuralBus } = {}) {
    this.events = events;
    this.neuralBus = neuralBus ?? null;
    // runId -> Set<handler>
    this.subscribers = new Map();
    // rolling per-run log so late subscribers can catch up
    this.runLogs = new Map(); // runId -> [msg...]
    this.maxPerRun = 200;
  }

  attachNeuralBus(bus) {
    this.neuralBus = bus;
  }

  emit(msg) {
    const enriched = {
      at: msg.at ?? new Date().toISOString(),
      runId: msg.runId,
      agentId: msg.agentId ?? null,
      nodeId: msg.nodeId ?? null,
      kind: msg.kind,
      payload: msg.payload ?? null,
      summary: msg.summary ?? `${msg.kind} ${msg.agentId ?? ""}`.trim()
    };

    // 1. per-run fan-out
    const subs = this.subscribers.get(enriched.runId);
    if (subs) for (const fn of subs) { try { fn(enriched); } catch { /* isolated */ } }

    // 2. rolling log
    let log = this.runLogs.get(enriched.runId);
    if (!log) { log = []; this.runLogs.set(enriched.runId, log); }
    log.push(enriched);
    if (log.length > this.maxPerRun) log.shift();

    // 3. global EventBus mirror (for dashboard + /events SSE + audit log)
    this.events?.emit({
      kind: `hive.${enriched.kind}`,
      projectId: enriched.payload?.projectId ?? "hive",
      summary: enriched.summary,
      payload: enriched
    });

    // 4. NATS mirror for cross-VM agents
    if (this.neuralBus?.publish) {
      try { this.neuralBus.publish(`brain.hive.${enriched.runId}`, enriched); } catch { /* best-effort */ }
    }

    return enriched;
  }

  subscribe(runId, handler, { replay = true } = {}) {
    if (!this.subscribers.has(runId)) this.subscribers.set(runId, new Set());
    this.subscribers.get(runId).add(handler);
    if (replay) {
      const log = this.runLogs.get(runId) ?? [];
      for (const m of log) { try { handler(m); } catch { /* isolated */ } }
    }
    return () => {
      this.subscribers.get(runId)?.delete(handler);
      if (this.subscribers.get(runId)?.size === 0) this.subscribers.delete(runId);
    };
  }

  history(runId) {
    return this.runLogs.get(runId) ?? [];
  }

  /** Close a run: purge after a delay so late subscribers can still replay. */
  close(runId, ttlMs = 60_000) {
    setTimeout(() => {
      this.runLogs.delete(runId);
      this.subscribers.delete(runId);
    }, ttlMs).unref?.();
  }
}
