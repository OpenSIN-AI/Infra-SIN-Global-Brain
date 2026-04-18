/**
 * NeuralBus — NATS JetStream transport for Brain ↔ Agents.
 *
 * Subjects:
 *   brain.ask           : request/reply — agent asks a question
 *   brain.attach        : request/reply — agent claims a session
 *   brain.rules         : request/reply — live rules for project
 *   brain.ingest        : fire-and-forget — agent pushes knowledge
 *   brain.session.end   : fire-and-forget — agent commits session
 *   brain.events.<proj> : server-push stream — live context updates
 *
 * Every inbound message is validated, routed to the matching handler, and
 * replied to with a structured envelope. Handlers do NOT touch NATS.
 */

import { connect, JSONCodec, headers } from "nats";

const codec = JSONCodec();

export class NeuralBus {
  constructor({ servers, name = "brain-core" }) {
    this.servers = servers;
    this.name = name;
    this.nc = null;
    this.subs = [];
    this.handlers = new Map();
  }

  async connect() {
    this.nc = await connect({ servers: this.servers, name: this.name });
    console.log(`[neural-bus] connected to ${this.nc.getServer()}`);
  }

  async close() {
    for (const sub of this.subs) await sub.drain();
    if (this.nc) await this.nc.drain();
  }

  onRequest(subject, handler) {
    this.handlers.set(subject, handler);
    const sub = this.nc.subscribe(subject, { queue: "brain-core" });
    this.subs.push(sub);
    (async () => {
      for await (const msg of sub) {
        const started = process.hrtime.bigint();
        let response;
        try {
          const payload = msg.data.length ? codec.decode(msg.data) : {};
          const result = await handler(payload, msg);
          response = { ok: true, result };
        } catch (err) {
          response = { ok: false, error: err.message ?? String(err) };
        }
        const tookMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
        const hdrs = headers();
        hdrs.append("x-brain-ms", String(tookMs));
        if (msg.reply) msg.respond(codec.encode(response), { headers: hdrs });
      }
    })().catch((err) => console.error(`[neural-bus] ${subject} loop`, err));
  }

  /**
   * Fan out a record to every interested agent. We key the subject by
   * project so a sidecar can cheaply subscribe with `brain.events.my-app`.
   */
  publishEvent(projectId, record) {
    if (!this.nc) return;
    const subject = `brain.events.${projectId ?? "global"}`;
    this.nc.publish(subject, codec.encode(record));
  }

  /** Fire-and-forget publish on an arbitrary subject (used by Hive broadcast). */
  publish(subject, payload) {
    if (!this.nc) return;
    this.nc.publish(subject, codec.encode(payload));
  }

  /** Request/reply on an arbitrary subject (used for remote Hive workers). */
  async request(subject, payload, { timeout = 15_000 } = {}) {
    if (!this.nc) throw new Error("NATS not connected");
    const msg = await this.nc.request(subject, codec.encode(payload), { timeout });
    return codec.decode(msg.data);
  }
}

export { codec };
