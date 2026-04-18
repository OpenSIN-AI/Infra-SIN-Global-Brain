import { randomUUID } from "node:crypto";
import { aggregate } from "./aggregator.js";

/**
 * Orchestrator — the god-agent conductor.
 *
 * One entry point: `orchestrate({ prompt, projectId, agentId, plan, voice })`.
 *
 * What happens inside (user sees ONE voice):
 *   1. Plan — if `plan` not provided, call the top-ranked "planner"
 *      capability, or fall back to a heuristic splitter. Plan is a small DAG
 *      of `{ id, capability, deps, input }` nodes.
 *   2. Create scratchpad. Seed with the prime context (ultra canon, project
 *      rules, forbiddens, decisions, contradictions) + the prompt.
 *   3. Dispatch — topological-parallel execution. Nodes whose deps are all
 *      fulfilled are run concurrently. Each node:
 *        - registry.find(capability) → pick #1 (swap to #2 on failure)
 *        - resolve endpoint (local: / http: / nats:)
 *        - broadcast "dispatch", call worker with context, broadcast "done"
 *        - registry.recordRun() on every result
 *   4. Aggregate — VoiceAggregator composes the unified answer.
 *   5. Reflect — the orchestrator writes a decision-type knowledge entry
 *      capturing prompt, plan, per-node outcomes, timings. The AutoPromoter
 *      + MetaLearner pick this up naturally on their next ticks.
 *   6. Proposals — any worker that emitted a `proposal` in its result is
 *      forwarded to the ConsensusEngine.
 *
 * Failure semantics:
 *   - A node retries once on a different agent if the first fails.
 *   - A node that still fails becomes `{ status: "error" }` in the trace.
 *     The run continues — other nodes can still aggregate around the hole.
 *   - Budget exceeded → all pending nodes cancel, aggregate with what we have.
 */
export class Orchestrator {
  constructor({ store, registry, scratchpad, broadcast, consensus, events, metrics, httpFetch = globalThis.fetch, neuralBus = null } = {}) {
    this.store = store;
    this.registry = registry;
    this.scratchpad = scratchpad;
    this.broadcast = broadcast;
    this.consensus = consensus;
    this.events = events;
    this.metrics = metrics;
    this.httpFetch = httpFetch;
    this.neuralBus = neuralBus;
  }

  attachNeuralBus(bus) {
    this.neuralBus = bus;
  }

  async orchestrate({
    prompt,
    projectId = "global",
    agentId = "prime",
    plan = null,
    voice = "default",
    budgetMs = 60_000,
    inputs = {}
  }) {
    if (!prompt) throw new Error("orchestrate requires a prompt");
    const runId = randomUUID();
    const startedAt = Date.now();
    const deadline = startedAt + budgetMs;

    // 1. build prime context for every worker to inherit
    const primeContext = await this._primeContext(projectId);

    // 2. scratchpad
    const pad = this.scratchpad.create({
      projectId,
      ttlMs: budgetMs + 60_000,
      seed: { prompt, primeContext, inputs },
      tags: ["hive", "run"]
    });

    // 3. plan
    const usedPlan = plan ?? await this._plan(prompt, projectId, pad.id);
    this.broadcast.emit({ runId, agentId, kind: "plan", summary: `plan(${usedPlan.length} nodes)`, payload: { plan: usedPlan, padId: pad.id, projectId } });
    this.metrics?.inc("brain_hive_runs_total", { status: "started" });

    // 4. topological-parallel execution
    const byId = new Map();
    for (const n of usedPlan) byId.set(n.id, { ...n, status: "pending", result: null });
    const done = new Set();
    const nodeResults = [];

    const readyNext = () => {
      const ready = [];
      for (const n of byId.values()) {
        if (n.status !== "pending") continue;
        if ((n.deps ?? []).every((d) => done.has(d))) ready.push(n);
      }
      return ready;
    };

    while (done.size < byId.size) {
      const ready = readyNext();
      if (!ready.length) {
        // either all running, or cycle/stall — advance by awaiting any currently running
        // (we don't separately track in-flight; readyNext returns pending with deps met
        //  so if it's empty and done.size < byId.size, we've got a broken plan)
        for (const n of byId.values()) {
          if (n.status === "pending") {
            n.status = "error";
            n.error = "unreachable-deps";
            nodeResults.push(this._toResult(n));
            done.add(n.id);
          }
        }
        break;
      }

      // time budget
      if (Date.now() > deadline) {
        for (const n of ready) {
          n.status = "error";
          n.error = "budget-exceeded";
          nodeResults.push(this._toResult(n));
          done.add(n.id);
        }
        break;
      }

      await Promise.all(ready.map(async (n) => {
        const upstream = {};
        for (const depId of n.deps ?? []) {
          const dep = byId.get(depId);
          upstream[depId] = dep?.result ?? null;
        }
        const res = await this._runNode({ runId, projectId, node: n, prompt, upstream, padId: pad.id, primeContext, deadline });
        n.status = res.status;
        n.result = res.result;
        n.agentId = res.agentId;
        n.latencyMs = res.latencyMs;
        n.confidence = res.confidence;
        n.error = res.error;
        nodeResults.push(this._toResult(n));
        done.add(n.id);
      }));
    }

    // 5. aggregate
    const agg = aggregate({ prompt, nodes: nodeResults, primeAgentId: agentId, voice });
    this.broadcast.emit({ runId, agentId, kind: "aggregated", summary: `answer ready (${agg.confidence})`, payload: { confidence: agg.confidence, voice } });

    // 6. reflection → store
    const reflectionId = await this._writeReflection({ runId, projectId, agentId, prompt, plan: usedPlan, nodes: nodeResults, aggregate: agg, durationMs: Date.now() - startedAt });

    // 7. harvest proposals
    const proposals = [];
    for (const n of nodeResults) {
      const p = n.result?.proposal;
      if (!p?.text) continue;
      try {
        const out = await this.consensus.propose({
          agentId: n.agentId ?? agentId,
          projectId,
          type: p.type ?? "rule",
          scope: p.scope ?? "global",
          text: p.text,
          tags: p.tags ?? [],
          reason: p.reason ?? `run ${runId}`
        });
        proposals.push(out);
        this.broadcast.emit({ runId, agentId: n.agentId ?? agentId, kind: "proposal", summary: `proposal ${out.id} from ${n.capability}`, payload: out });
      } catch { /* swallow */ }
    }

    // 8. close run
    this.metrics?.inc("brain_hive_runs_total", { status: "completed" });
    this.metrics?.observe("brain_hive_run_ms", Date.now() - startedAt);
    this.broadcast.close(runId);

    return {
      runId,
      padId: pad.id,
      answer: agg.answer,
      tldr: agg.tldr,
      confidence: agg.confidence,
      trace: agg.trace,
      durationMs: Date.now() - startedAt,
      reflectionId,
      proposals
    };
  }

  async _primeContext(projectId) {
    const cache = this.store.cache;
    const ultra = cache.ultraRules.map((id) => cache.entries.get(id)).filter(Boolean);
    const projRules = [];
    const projSet = cache.byProject.get(projectId) ?? new Set();
    for (const id of projSet) {
      const e = cache.entries.get(id);
      if (!e || e.status !== "active") continue;
      if (e.type === "rule" || e.type === "forbidden") projRules.push(e);
    }
    return {
      ultraRules: ultra.map((e) => ({ id: e.id, text: e.text, priority: e.priority ?? null })),
      rules: projRules.map((e) => ({ id: e.id, text: e.text, type: e.type })),
      contradictions: ultra.filter((e) => e.contradictsWith?.length).map((e) => ({ id: e.id, with: e.contradictsWith }))
    };
  }

  async _plan(prompt, projectId, padId) {
    // prefer a registered planner capability
    const [pick] = this.registry.find("plan");
    if (pick) {
      try {
        const planNode = {
          id: "plan",
          capability: "plan",
          deps: [],
          input: { prompt, projectId, padId }
        };
        const res = await this._runNode({
          runId: "planning",
          projectId,
          node: planNode,
          prompt,
          upstream: {},
          padId,
          primeContext: null,
          deadline: Date.now() + 10_000
        });
        if (res.status === "ok" && Array.isArray(res.result?.dag)) return this._normaliseDag(res.result.dag);
      } catch { /* fall through to heuristic */ }
    }
    return this._heuristicPlan(prompt);
  }

  _heuristicPlan(prompt) {
    const p = prompt.toLowerCase();
    const pick = (arr) => arr.find((x) => this.registry.find(x).length > 0);
    const has = (...w) => w.some((x) => p.includes(x));

    if (has("debug", "fix", "error", "bug", "broken", "kaputt")) {
      return this._normaliseDag([
        { id: "reproduce", capability: pick(["research", "reproduce"]) ?? "research" },
        { id: "diagnose", capability: pick(["analyze", "design"]) ?? "design", deps: ["reproduce"] },
        { id: "fix", capability: pick(["code", "implement"]) ?? "code", deps: ["diagnose"] },
        { id: "verify", capability: pick(["test", "verify"]) ?? "test", deps: ["fix"] }
      ]);
    }
    if (has("build", "implement", "add ", "baue", "erstelle", "feature")) {
      return this._normaliseDag([
        { id: "research", capability: pick(["research"]) ?? "research" },
        { id: "design", capability: pick(["design"]) ?? "design", deps: ["research"] },
        { id: "code", capability: pick(["code", "implement"]) ?? "code", deps: ["design"] },
        { id: "test", capability: pick(["test"]) ?? "test", deps: ["code"] }
      ]);
    }
    if (has("compare", "analyze", "analyse", "vergleiche")) {
      return this._normaliseDag([
        { id: "gather", capability: pick(["research"]) ?? "research" },
        { id: "conclude", capability: pick(["summary", "design"]) ?? "summary", deps: ["gather"] }
      ]);
    }
    // default: research + synthesise
    return this._normaliseDag([
      { id: "research", capability: pick(["research"]) ?? "research" },
      { id: "answer", capability: pick(["summary"]) ?? "summary", deps: ["research"] }
    ]);
  }

  _normaliseDag(nodes) {
    return nodes.map((n) => ({
      id: n.id,
      capability: n.capability,
      deps: n.deps ?? [],
      input: n.input ?? null
    }));
  }

  async _runNode({ runId, projectId, node, prompt, upstream, padId, primeContext, deadline }) {
    const startedAt = Date.now();
    const candidates = this.registry.find(node.capability, { topN: 2 });
    if (!candidates.length) {
      this.broadcast.emit({ runId, nodeId: node.id, kind: "done", summary: `no agent for ${node.capability}`, payload: { status: "error", error: "no-agent" } });
      return { status: "error", error: `no agent for ${node.capability}`, agentId: null, latencyMs: 0, result: null, confidence: 0 };
    }

    const task = {
      prompt,
      projectId,
      nodeId: node.id,
      capability: node.capability,
      input: node.input,
      upstream,
      padId,
      primeContext,
      deadlineMs: Math.max(250, deadline - Date.now())
    };

    for (const cand of candidates) {
      this.broadcast.emit({ runId, nodeId: node.id, agentId: cand.agentId, kind: "dispatch", summary: `${node.capability} → ${cand.agentId}`, payload: { candidate: cand } });
      try {
        const result = await this._invoke(cand, task, runId);
        const latencyMs = Date.now() - startedAt;
        this.registry.recordRun(cand.agentId, node.capability, { ok: true, latencyMs });
        this.broadcast.emit({ runId, nodeId: node.id, agentId: cand.agentId, kind: "done", summary: `${node.capability} ok (${latencyMs}ms)`, payload: { latencyMs, confidence: result?.confidence ?? 1 } });
        return {
          status: "ok",
          agentId: cand.agentId,
          latencyMs,
          result,
          confidence: result?.confidence ?? 1,
          error: null
        };
      } catch (err) {
        const latencyMs = Date.now() - startedAt;
        this.registry.recordRun(cand.agentId, node.capability, { ok: false, latencyMs });
        this.broadcast.emit({ runId, nodeId: node.id, agentId: cand.agentId, kind: "done", summary: `${node.capability} FAIL: ${err.message}`, payload: { error: err.message } });
        // try next candidate
      }
    }
    return { status: "error", error: "all-candidates-failed", agentId: null, latencyMs: Date.now() - startedAt, result: null, confidence: 0 };
  }

  async _invoke(cand, task, runId) {
    const ep = cand.endpoint ?? "";
    if (ep.startsWith("local:")) {
      const fn = this.registry.resolveLocal(ep);
      if (!fn) throw new Error(`local fn not registered: ${ep}`);
      return await fn(task, { runId, broadcast: (msg) => this.broadcast.emit({ runId, agentId: cand.agentId, nodeId: task.nodeId, ...msg }), scratchpad: this.scratchpad });
    }
    if (ep.startsWith("http://") || ep.startsWith("https://")) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), task.deadlineMs).unref?.();
      try {
        const res = await this.httpFetch(ep, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task, runId }),
          signal: ctrl.signal
        });
        if (!res.ok) throw new Error(`http ${res.status}`);
        return await res.json();
      } finally {
        clearTimeout(timer);
      }
    }
    if (ep.startsWith("nats://")) {
      if (!this.neuralBus?.request) throw new Error("NATS not attached");
      const subject = ep.slice("nats://".length);
      return await this.neuralBus.request(subject, { task, runId }, { timeout: task.deadlineMs });
    }
    throw new Error(`unknown endpoint scheme: ${ep}`);
  }

  _toResult(n) {
    return {
      id: n.id,
      capability: n.capability,
      agentId: n.agentId ?? null,
      status: n.status,
      result: n.result,
      confidence: n.confidence ?? null,
      latencyMs: n.latencyMs ?? null,
      error: n.error ?? null
    };
  }

  async _writeReflection({ runId, projectId, agentId, prompt, plan, nodes, aggregate: agg, durationMs }) {
    const text = `Hive run ${runId.slice(0, 8)}: "${prompt.slice(0, 120)}" → ${nodes.length} nodes, conf=${agg.confidence}, ${durationMs}ms`;
    const entry = {
      id: `reflection:${runId}`,
      type: "decision",
      scope: "project",
      text,
      status: "active",
      score: 1,
      usageCount: 0,
      successCount: nodes.filter((n) => n.status === "ok").length,
      tags: ["hive", "reflection"],
      source: {
        origin: "hive",
        runId,
        primeAgent: agentId,
        projectId,
        plan: plan.map((p) => ({ id: p.id, capability: p.capability, deps: p.deps })),
        trace: nodes.map((n) => ({ id: n.id, capability: n.capability, agentId: n.agentId, status: n.status, latencyMs: n.latencyMs, confidence: n.confidence, error: n.error })),
        confidence: agg.confidence,
        durationMs
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await this.store.addKnowledge(entry, { actor: `hive:${agentId}` });
    return entry.id;
  }
}
