/**
 * @opensin/brain-client — the one import every agent needs.
 *
 *   import { attach } from "@opensin/brain-client";
 *   const brain = await attach({ projectId: "my-app", goal });
 *   brain.primeContext.ultraRules;      // already there, zero round-trip
 *   brain.ask("how did we ship auth?"); // ~10 ms
 *   brain.on("rule-change", cb);        // live push from the bus
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
    const method = "brain.rules";
    const http = "/rules";
    return this.#request(method, http, payload, { httpMethod: "GET" });
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
    if (this.nc) await this.nc.drain();
  }

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
      const msg = await this.nc.request(subject, codec.encode(payload), { timeout: 5000 });
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
