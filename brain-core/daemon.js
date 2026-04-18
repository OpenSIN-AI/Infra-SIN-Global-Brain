/**
 * brain-core daemon — the single always-on process that every agent talks to.
 *
 * Wiring (v4):
 *   [WAL] <- Store -> [HotCache / VectorIndex]
 *                \--> EventBus (in-process fan-out)
 *                        \--> SSE /events
 *                        \--> MetaLearner
 *                        \--> metrics
 *                        \--> event-log JSONL (optional)
 *                \--> NeuralBus.events (push, cross-process via NATS)
 *                \--> ProjectBridge (disk mirror, debounced)
 *                \--> AutoPromoter (listens to session.commit)
 *                \--> MetaLearner (dedup online, tick for contradictions+decay)
 *
 *   HTTP + NATS both resolve to the SAME handlers; the transport is dumb.
 *
 * Run with:
 *   BRAIN_DATA_DIR=/var/lib/brain \
 *   BRAIN_WORKSPACE=/srv/global-brain \
 *   BRAIN_NATS_URL=nats://127.0.0.1:4222 \
 *   BRAIN_HTTP_PORT=7070 \
 *   BRAIN_EVENT_LOG=/var/lib/brain/events.jsonl \
 *   node brain-core/daemon.js
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// Deduplicate noisy "[Embedding] Failed …" warnings from the embedding engine.
const _origWarn = console.warn.bind(console);
let _embedWarnPrinted = false;
console.warn = (...args) => {
  const first = args[0];
  if (typeof first === "string" && first.startsWith("[Embedding]")) {
    if (_embedWarnPrinted) return;
    _embedWarnPrinted = true;
    _origWarn("[brain] embedding provider unavailable — using deterministic fallback vectors");
    return;
  }
  _origWarn(...args);
};

import { BrainStore } from "./lib/store.js";
import { ProjectBridge } from "./lib/project-bridge.js";
import { NeuralBus } from "./transport/neural-bus.js";
import { startHttpServer } from "./transport/http.js";
import { EventBus } from "./transport/events.js";
import { createHandlers } from "./handlers.js";
import { AutoPromoter } from "./engines/auto-promoter.js";
import { MetaLearner } from "./engines/meta-learner.js";
import { Metrics } from "./engines/metrics.js";
import { CapabilityRegistry } from "./hive/registry.js";
import { Scratchpad } from "./hive/scratchpad.js";
import { BroadcastCortex } from "./hive/broadcast.js";
import { ConsensusEngine } from "./hive/consensus.js";
import { Orchestrator } from "./hive/orchestrator.js";
import { createHiveHandlers } from "./hive/handlers.js";
import { generateEmbedding } from "../src/engines/embedding-engine.js";

async function main() {
  const dataDir = process.env.BRAIN_DATA_DIR ?? path.resolve(process.cwd(), "brain-data");
  const workspaceRoot = process.env.BRAIN_WORKSPACE ?? process.cwd();
  const natsUrl = process.env.BRAIN_NATS_URL ?? "";
  const httpPort = Number(process.env.BRAIN_HTTP_PORT ?? 7070);
  const httpHost = process.env.BRAIN_HTTP_HOST ?? "0.0.0.0";
  const checkpointMs = Number(process.env.BRAIN_CHECKPOINT_MS ?? 60_000);
  const metaTickMs = Number(process.env.BRAIN_META_TICK_MS ?? 10 * 60_000);
  const eventLogPath = process.env.BRAIN_EVENT_LOG ?? "";

  const store = new BrainStore({ dataDir });
  await store.open();

  const metrics = new Metrics();
  const events = new EventBus({ ringSize: 1000 });
  const bridge = new ProjectBridge({ store, workspaceRoot });
  if (process.env.BRAIN_INGEST_ON_BOOT !== "0") {
    console.log("[brain] ingesting existing workspace …");
    await bridge.ingestAll();
  }

  const promoter = new AutoPromoter({ store });
  const metaLearner = new MetaLearner({ store, events, metrics });

  // Expose current cardinalities as gauges, refreshed on every commit.
  const refreshGauges = () => {
    const s = store.stats();
    metrics.set("brain_cache_entries", s.entries);
    metrics.set("brain_cache_rules", s.rules);
    metrics.set("brain_cache_ultra_rules", s.ultraRules);
    metrics.set("brain_cache_vectors", s.vectors);
    metrics.set("brain_cache_projects", s.projects);
    metrics.set("brain_applied_seq", s.appliedSeq);
  };
  refreshGauges();

  const handlers = createHandlers({ store, bridge, promoter, metaLearner, metrics, events });

  // ---- Hive layer (phase 6+7) ----
  const registry = new CapabilityRegistry({ events, metrics });
  registry.startSweeper();
  const scratchpad = new Scratchpad({ events });
  scratchpad.startSweeper();
  const broadcast = new BroadcastCortex({ events });
  const consensus = new ConsensusEngine({ store, events, metrics, generateEmbedding });
  const orchestrator = new Orchestrator({
    store, registry, scratchpad, broadcast, consensus, events, metrics
  });
  const hiveHandlers = createHiveHandlers({
    registry, scratchpad, broadcast, consensus, orchestrator, metrics
  });

  metrics.set("brain_hive_agents", 0);

  // ---- Store → Event fan-out ----
  let eventLogStream = null;
  if (eventLogPath) {
    fs.mkdirSync(path.dirname(eventLogPath), { recursive: true });
    eventLogStream = fs.createWriteStream(eventLogPath, { flags: "a" });
  }

  store.subscribe((record) => {
    refreshGauges();
    metrics.inc("brain_wal_appends_total", { kind: record.kind });
    const evt = events.emit(EventBus.summariseRecord(record));
    if (eventLogStream) eventLogStream.write(JSON.stringify(evt) + "\n");
  });

  // ---- NATS ----
  let bus = null;
  if (natsUrl) {
    bus = new NeuralBus({ servers: natsUrl.split(",") });
    await bus.connect();
    bus.onRequest("brain.ask", handlers.ask);
    bus.onRequest("brain.attach", handlers.attach);
    bus.onRequest("brain.rules", handlers.rules);
    bus.onRequest("brain.ingest", handlers.ingest);
    bus.onRequest("brain.session.end", handlers.sessionEnd);
    bus.onRequest("brain.admin.tick", handlers.adminTick);
    bus.onRequest("brain.admin.meta.tick", handlers.adminMetaTick);
    bus.onRequest("brain.admin.diagnose", handlers.diagnose);
    bus.onRequest("brain.admin.seed", handlers.seedUltra);

    // Hive subjects
    bus.onRequest("brain.hive.register", hiveHandlers.hiveRegister);
    bus.onRequest("brain.hive.heartbeat", hiveHandlers.hiveHeartbeat);
    bus.onRequest("brain.hive.unregister", hiveHandlers.hiveUnregister);
    bus.onRequest("brain.hive.agents", hiveHandlers.hiveAgents);
    bus.onRequest("brain.hive.find", hiveHandlers.hiveFind);
    bus.onRequest("brain.hive.broadcast", hiveHandlers.hiveBroadcast);
    bus.onRequest("brain.hive.history", hiveHandlers.hiveHistory);
    bus.onRequest("brain.hive.propose", hiveHandlers.hivePropose);
    bus.onRequest("brain.hive.vote", hiveHandlers.hiveVote);
    bus.onRequest("brain.hive.proposals", hiveHandlers.hiveProposals);
    bus.onRequest("brain.hive.proposal.status", hiveHandlers.hiveProposalStatus);
    bus.onRequest("brain.hive.orchestrate", hiveHandlers.hiveOrchestrate);
    bus.onRequest("brain.hive.scratchpad.create", hiveHandlers.scratchpadCreate);
    bus.onRequest("brain.hive.scratchpad.get", hiveHandlers.scratchpadGet);
    bus.onRequest("brain.hive.scratchpad.set", hiveHandlers.scratchpadSet);
    bus.onRequest("brain.hive.scratchpad.append", hiveHandlers.scratchpadAppend);

    broadcast.attachNeuralBus(bus);
    orchestrator.attachNeuralBus(bus);

    events.subscribe((e) => {
      bus.publishEvent(e.projectId ?? "global", { seq: e.seq, kind: e.kind, summary: e.summary });
    });
    store.subscribe((record) => {
      const projectId = record.payload?.source?.projectId ?? record.payload?.projectId;
      if (projectId && projectId !== "global") bridge.scheduleMirror(projectId);
    });
  } else {
    store.subscribe((record) => {
      const projectId = record.payload?.source?.projectId ?? record.payload?.projectId;
      if (projectId) bridge.scheduleMirror(projectId);
    });
  }

  // ---- HTTP ----
  const http = await startHttpServer({
    port: httpPort, host: httpHost, handlers, hiveHandlers, broadcast, events, metrics
  });
  console.log(`[brain] http listening on ${httpHost}:${httpPort}  (dashboard: http://${httpHost}:${httpPort}/)`);

  // ---- Checkpoint loop ----
  const ckptTimer = setInterval(() => {
    store.checkpoint().catch((err) => console.error("[brain] checkpoint", err.message));
  }, checkpointMs);
  ckptTimer.unref();

  // ---- Auto-promotion loop (every 5 min) ----
  const promoteTimer = setInterval(async () => {
    try {
      const r = await promoter.tick();
      if (r.promoted?.length) metrics.inc("brain_promotions_total", {}, r.promoted.length);
      if (r.demoted?.length) metrics.inc("brain_demotions_total", {}, r.demoted.length);
    } catch (err) { console.error("[brain] promote", err.message); }
  }, 5 * 60_000);
  promoteTimer.unref();

  // ---- Meta-learner loop (contradictions + decay) ----
  const metaTimer = setInterval(() => {
    metaLearner.tick().catch((err) => console.error("[brain] meta", err.message));
  }, metaTickMs);
  metaTimer.unref();

  const shutdown = async (sig) => {
    console.log(`[brain] ${sig} — shutting down`);
    clearInterval(ckptTimer);
    clearInterval(promoteTimer);
    clearInterval(metaTimer);
    registry.stopSweeper();
    scratchpad.stopSweeper();
    await http.close().catch(() => {});
    if (bus) await bus.close().catch(() => {});
    if (eventLogStream) eventLogStream.end();
    await store.checkpoint().catch(() => {});
    await store.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  console.log("[brain] READY", store.stats());
}

main().catch((err) => {
  console.error("[brain] fatal", err);
  process.exit(1);
});
