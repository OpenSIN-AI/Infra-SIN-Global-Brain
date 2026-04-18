/**
 * @opensin/brain-client — the one import every agent needs.
 *
 *   import { attach } from "@opensin/brain-client";
 *   const brain = await attach({ projectId: "my-app", goal });
 *   brain.primeContext.ultraRules;      // already there, zero round-trip
 *   brain.ask("how did we ship auth?"); // ~10 ms
 *   brain.on("rule-change", cb);        // live push from the bus
 *
 * Hive extensions (v4.1):
 *   await brain.hive.register({ endpoint, capabilities });
 *   const run = await brain.hive.orchestrate({ prompt });
 *   brain.hive.subscribeRun(run.runId, (msg) => console.log(msg));
 *
 * The client picks up `BRAIN_URL` and `BRAIN_NATS_URL` from env. If only the
 * HTTP URL is configured we degrade to HTTP polling. If neither is set, we
 * try the local `.pcpm/brain-pointer.json` (written by the daemon's
 * ProjectBridge when a project first connects).
 */

import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";

import { connect, JSONCodec } from "nats";

const codec = JSONCodec();

function resolveEndpoints({ projectRoot } = {}) {
  const httpUrl = process.env.BRAIN_URL ?? null;
  const natsUrl = process.env.BRAIN_NATS_URL ?? null;
  let pointer = null;
  if (projectRoot) {
    const file = path.join(projectRoot, ".pcpm", "brain-pointer.json");
    if (fs.existsSync(file)) {
      try { pointer = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* noop */ }
    }
  }
  return {
    httpUrl: httpUrl ?? pointer?.url ?? null,
    natsUrl: natsUrl ?? pointer?.natsUrl ?? null,
    projectIdHint: pointer?.projectId ?? null
  };
}

export class BrainClient extends EventEmitter {
  constructor({ httpUrl, natsUrl, projectId, agentId }) {
    super();
    this.httpUrl = httpUrl;
    this.natsUrl = natsUrl;
    this.projectId = projectId;
    this.agentId = agentId;
    this.nc = null;
    this.primeContext = null;
    this.attachedAt = null;
    this.hive = new HiveClient(this);
  }

  async attach(goal) {
    if (this.natsUrl) {
      this.nc = await connect({ servers: this.natsUrl.split(","), name: this.agentId ?? "agent" });
      this.#subscribeEvents();
    }
    const payload = { projectId: this.projectId, agentId: this.agentId, goal };
    const res = await this.#request("brain.attach", "/attach", payload);
    this.primeContext = res.primeContext;
    this.attachedAt = res.attachedAt;
    return res;
  }

  async ask(query, opts = {}) {
    const payload = { query, projectId: this.projectId, ...opts };
    return this.#request("brain.ask", "/ask", payload);
  }

  async rules(opts = {}) {
    const payload = { projectId: this.projectId, ...opts };
    return this.#request("brain.rules", "/rules", payload, { httpMethod: "GET" });
  }

  async ingest(entry) {
    const payload = { projectId: this.projectId, entry, actor: this.agentId };
    return this.#request("brain.ingest", "/ingest", payload);
  }

  async endSession({ consultedRuleIds = [], success = true, summary = null } = {}) {
    const payload = {
      projectId: this.projectId,
      agentId: this.agentId,
      consultedRuleIds,
      success,
      summary
    };
    return this.#request("brain.session.end", "/session/end", payload);
  }

  async close() {
    this.hive._stopHeartbeat();
    if (this.nc) await this.nc.drain();
  }

  // internal — used by HiveClient
  _request(subject, httpPath, payload, opts) {
    return this.#request(subject, httpPath, payload, opts);
  }
  _nc() { return this.nc; }

  #subscribeEvents() {
    const subject = `brain.events.${this.projectId}`;
    const sub = this.nc.subscribe(subject);
    (async () => {
      for await (const msg of sub) {
        const rec = codec.decode(msg.data);
        this.emit("event", rec);
        if (rec.kind === "rule.promote" || rec.kind === "rule.demote") {
          this.emit("rule-change", rec);
        }
      }
    })().catch(() => { /* loop dies on drain */ });
  }

  async #request(subject, httpPath, payload, { httpMethod = "POST" } = {}) {
    if (this.nc) {
      const msg = await this.nc.request(subject, codec.encode(payload), { timeout: 10_000 });
      const envelope = codec.decode(msg.data);
      if (!envelope.ok) throw new Error(envelope.error);
      return envelope.result;
    }
    if (!this.httpUrl) {
      throw new Error("brain-client: no transport configured (set BRAIN_URL or BRAIN_NATS_URL)");
    }
    const url = new URL(httpPath, this.httpUrl);
    const init = { method: httpMethod };
    if (httpMethod === "GET") {
      for (const [k, v] of Object.entries(payload ?? {})) {
        if (v != null) url.searchParams.set(k, String(v));
      }
    } else {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(payload ?? {});
    }
    const resp = await fetch(url, init);
    const json = await resp.json();
    if (!resp.ok || !json.ok) throw new Error(json.error ?? `HTTP ${resp.status}`);
    return json.result;
  }
}

/**
 * HiveClient — the fleet-level surface. Mounted at `brain.hive` on every
 * BrainClient. Every method is a one-liner for agent authors.
 */
export class HiveClient {
  constructor(brain) {
    this.brain = brain;
    this._heartbeatTimer = null;
  }

  /**
   * Register this agent as a worker in the hive. If `autoHeartbeat` is true
   * (default), the client keeps a background timer ticking heartbeats at
   * `heartbeatTtlMs / 3` so the registry never evicts you while you're alive.
   */
  async register({ endpoint, capabilities, meta = {}, heartbeatTtlMs = 30_000, autoHeartbeat = true } = {}) {
    const agentId = this.brain.agentId ?? meta.agentId;
    if (!agentId) throw new Error("hive.register requires brain.agentId");
    const result = await this.brain._request(
      "brain.hive.register", "/hive/register",
      { agentId, endpoint, capabilities, meta, heartbeatTtlMs }
    );
    if (autoHeartbeat) {
      const every = Math.max(1000, Math.floor(heartbeatTtlMs / 3));
      this._stopHeartbeat();
      this._heartbeatTimer = setInterval(() => {
        this.heartbeat().catch(() => { /* silent — sweeper will drop us if persistent */ });
      }, every);
      this._heartbeatTimer.unref?.();
    }
    return result;
  }

  async heartbeat() {
    return this.brain._request("brain.hive.heartbeat", "/hive/heartbeat", { agentId: this.brain.agentId });
  }

  async unregister() {
    this._stopHeartbeat();
    return this.brain._request("brain.hive.unregister", "/hive/unregister", { agentId: this.brain.agentId });
  }

  async agents() {
    return this.brain._request("brain.hive.agents", "/hive/agents", {}, { httpMethod: "GET" });
  }

  async find(capability, { topN = 3, exclude = [] } = {}) {
    return this.brain._request("brain.hive.find", "/hive/find", { capability, topN, exclude }, { httpMethod: "GET" });
  }

  async orchestrate({ prompt, plan = null, voice = "default", budgetMs = 60_000, inputs = {}, projectId } = {}) {
    return this.brain._request("brain.hive.orchestrate", "/hive/orchestrate", {
      prompt,
      plan,
      voice,
      budgetMs,
      inputs,
      projectId: projectId ?? this.brain.projectId,
      agentId: this.brain.agentId
    });
  }

  async propose({ type = "rule", scope = "global", text, tags = [], reason = null, projectId } = {}) {
    return this.brain._request("brain.hive.propose", "/hive/propose", {
      agentId: this.brain.agentId,
      projectId: projectId ?? this.brain.projectId,
      type, scope, text, tags, reason
    });
  }

  async vote(proposalId, { verdict, reason = null, projectId } = {}) {
    return this.brain._request("brain.hive.vote", "/hive/vote", {
      proposalId,
      agentId: this.brain.agentId,
      projectId: projectId ?? this.brain.projectId,
      verdict, reason
    });
  }

  async proposals({ status = "pending", limit = 50 } = {}) {
    return this.brain._request("brain.hive.proposals", "/hive/proposals", { status, limit }, { httpMethod: "GET" });
  }

  async broadcast({ runId, kind, payload = null, summary = null, nodeId = null } = {}) {
    return this.brain._request("brain.hive.broadcast", "/hive/broadcast", {
      runId, agentId: this.brain.agentId, nodeId, kind, payload, summary
    });
  }

  /**
   * Subscribe to the live telepathy channel of a specific run.
   * Uses NATS if connected; falls back to SSE otherwise.
   *
   * Returns an async unsubscribe function.
   */
  subscribeRun(runId, handler) {
    const nc = this.brain._nc();
    if (nc) {
      const sub = nc.subscribe(`brain.hive.${runId}`);
      (async () => {
        for await (const msg of sub) {
          try { handler(codec.decode(msg.data)); } catch { /* isolated */ }
        }
      })().catch(() => { /* drain */ });
      return async () => { await sub.drain(); };
    }
    // SSE fallback
    const url = new URL(`/hive/events/${runId}`, this.brain.httpUrl);
    const ac = new AbortController();
    (async () => {
      const res = await fetch(url, { signal: ac.signal });
      if (!res.body) return;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          try { handler(JSON.parse(line.slice(5).trim())); } catch { /* skip */ }
        }
      }
    })().catch(() => { /* aborted */ });
    return async () => ac.abort();
  }

  /**
   * Register a capability as an in-process function. Used when the agent
   * lives in the SAME process as the daemon (rare — but critical for the
   * smoke test and for single-binary distributions).
   */
  registerLocalFn(registryInstance, name, fn) {
    if (!registryInstance?.registerLocalFn) throw new Error("need daemon-local CapabilityRegistry");
    registryInstance.registerLocalFn(name, fn);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = null;
  }
}

/**
 * attach — convenience factory. One line to plug an agent into the brain.
 */
export async function attach({ projectId, agentId, goal, projectRoot } = {}) {
  const eps = resolveEndpoints({ projectRoot });
  const client = new BrainClient({
    httpUrl: eps.httpUrl,
    natsUrl: eps.natsUrl,
    projectId: projectId ?? eps.projectIdHint,
    agentId
  });
  await client.attach(goal);
  return client;
}
