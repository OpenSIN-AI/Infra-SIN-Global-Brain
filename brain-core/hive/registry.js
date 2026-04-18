import { randomUUID } from "node:crypto";

/**
 * CapabilityRegistry — the yellow pages of the hive.
 *
 * Agents self-register with the capabilities they can execute, their cost,
 * expected latency, and an endpoint the orchestrator can call. The registry
 * tracks a rolling EMA of actual latency + success rate per (agent,capability)
 * and ranks candidates so the orchestrator always picks the cheapest, fastest,
 * most-successful specialist for any given sub-task.
 *
 * Self-healing: each agent must heartbeat within `heartbeatTtlMs`. A sweeper
 * (started by the daemon) removes agents that go silent, so routing never
 * sends work to a dead peer.
 *
 * Endpoint schemes (resolved by the Orchestrator):
 *   - "local:<name>"      → in-process function (registered via localFns)
 *   - "http://..."        → POST JSON, 15s timeout
 *   - "nats://<subject>"  → NATS request/reply via neural-bus
 */
export class CapabilityRegistry {
  constructor({ events, metrics, defaultTtlMs = 30_000, sweepMs = 5_000 } = {}) {
    this.events = events;
    this.metrics = metrics;
    this.defaultTtlMs = defaultTtlMs;
    this.sweepMs = sweepMs;

    // agentId -> { agentId, endpoint, caps: Map<capName, stats>, meta, ttlMs, lastHeartbeat }
    this.agents = new Map();
    // capName -> Set<agentId>
    this.byCap = new Map();
    // local:<name> -> async function (task, ctx) -> result
    this.localFns = new Map();

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

  /**
   * Register (or refresh) an agent. Idempotent on agentId.
   * `capabilities`: array of { name, cost?, avgLatencyMs?, weight? }
   */
  register({ agentId, endpoint, capabilities = [], meta = {}, heartbeatTtlMs }) {
    if (!agentId) throw new Error("registry.register requires agentId");
    if (!endpoint) throw new Error("registry.register requires endpoint");

    const existing = this.agents.get(agentId);
    const capMap = existing?.caps ?? new Map();
    for (const c of capabilities) {
      if (!c?.name) continue;
      const prior = capMap.get(c.name);
      capMap.set(c.name, {
        name: c.name,
        cost: c.cost ?? prior?.cost ?? 1,
        declaredLatencyMs: c.avgLatencyMs ?? prior?.declaredLatencyMs ?? 500,
        weight: c.weight ?? prior?.weight ?? 1,
        // observed stats (EMA) — start empty
        runs: prior?.runs ?? 0,
        successes: prior?.successes ?? 0,
        latencyEmaMs: prior?.latencyEmaMs ?? null
      });
      if (!this.byCap.has(c.name)) this.byCap.set(c.name, new Set());
      this.byCap.get(c.name).add(agentId);
    }

    const record = {
      agentId,
      endpoint,
      caps: capMap,
      meta: { ...(existing?.meta ?? {}), ...meta },
      ttlMs: heartbeatTtlMs ?? existing?.ttlMs ?? this.defaultTtlMs,
      lastHeartbeat: Date.now()
    };
    this.agents.set(agentId, record);

    this.metrics?.set("brain_hive_agents", this.agents.size);
    this.metrics?.inc("brain_hive_registrations_total");
    this.events?.emit({
      kind: "hive.register",
      summary: `agent ${agentId} registered [${[...capMap.keys()].join(",")}]`,
      payload: { agentId, capabilities: [...capMap.keys()], endpoint }
    });
    return { ok: true, agentId };
  }

  heartbeat(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return { ok: false, error: "unknown agent" };
    agent.lastHeartbeat = Date.now();
    return { ok: true, at: agent.lastHeartbeat };
  }

  unregister(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return { ok: false };
    for (const capName of agent.caps.keys()) {
      this.byCap.get(capName)?.delete(agentId);
    }
    this.agents.delete(agentId);
    this.metrics?.set("brain_hive_agents", this.agents.size);
    this.events?.emit({
      kind: "hive.unregister",
      summary: `agent ${agentId} left`,
      payload: { agentId }
    });
    return { ok: true };
  }

  /** Register an in-process function addressable as `local:<name>`. */
  registerLocalFn(name, fn) {
    if (typeof fn !== "function") throw new Error("registerLocalFn requires a function");
    this.localFns.set(name, fn);
  }

  resolveLocal(endpoint) {
    if (!endpoint?.startsWith("local:")) return null;
    return this.localFns.get(endpoint.slice(6)) ?? null;
  }

  sweep(now = Date.now()) {
    const dead = [];
    for (const [id, a] of this.agents) {
      if (now - a.lastHeartbeat > a.ttlMs) dead.push(id);
    }
    for (const id of dead) this.unregister(id);
    return dead;
  }

  /**
   * Pick the top-N agents for a capability, sorted by composite score:
   *   score = (observedSuccessRate^2) / ((1 + cost) * (1 + latencyMs/100))
   * Agents with no runs get a neutral prior so they can earn their way in.
   */
  find(capability, { topN = 3, exclude = [] } = {}) {
    const ids = this.byCap.get(capability);
    if (!ids) return [];
    const excludeSet = new Set(exclude);
    const scored = [];
    for (const id of ids) {
      if (excludeSet.has(id)) continue;
      const agent = this.agents.get(id);
      if (!agent) continue;
      const cap = agent.caps.get(capability);
      if (!cap) continue;
      const runs = cap.runs;
      const successRate = runs === 0 ? 0.7 /* prior */ : cap.successes / runs;
      const latencyMs = cap.latencyEmaMs ?? cap.declaredLatencyMs;
      const denom = (1 + cap.cost) * (1 + latencyMs / 100);
      const score = (successRate * successRate) / denom * (cap.weight ?? 1);
      scored.push({
        agentId: id,
        endpoint: agent.endpoint,
        capability,
        score: +score.toFixed(6),
        successRate: +successRate.toFixed(3),
        runs,
        latencyMs: Math.round(latencyMs),
        cost: cap.cost
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topN);
  }

  /**
   * Update rolling stats after a worker run. EMA with α=0.3 so the registry
   * reacts quickly but isn't whipsawed by one bad run.
   */
  recordRun(agentId, capability, { ok, latencyMs }) {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    const cap = agent.caps.get(capability);
    if (!cap) return;
    cap.runs += 1;
    if (ok) cap.successes += 1;
    const prior = cap.latencyEmaMs ?? latencyMs;
    cap.latencyEmaMs = Math.round(prior * 0.7 + latencyMs * 0.3);
    this.metrics?.inc("brain_hive_runs_total", { capability, ok: ok ? "true" : "false" });
    this.metrics?.observe("brain_hive_worker_ms", latencyMs, { capability });
  }

  snapshot() {
    const out = [];
    for (const a of this.agents.values()) {
      out.push({
        agentId: a.agentId,
        endpoint: a.endpoint,
        meta: a.meta,
        ageMs: Date.now() - a.lastHeartbeat,
        capabilities: [...a.caps.values()].map((c) => ({
          name: c.name,
          runs: c.runs,
          successRate: c.runs === 0 ? null : +(c.successes / c.runs).toFixed(3),
          latencyEmaMs: c.latencyEmaMs,
          cost: c.cost
        }))
      });
    }
    return out;
  }

  static makeRunId() {
    return randomUUID();
  }
}
