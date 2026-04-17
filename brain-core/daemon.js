/**
 * brain-core daemon — the single always-on process that every agent talks to.
 *
 * Wiring:
 *   [WAL] <- Store -> [HotCache]
 *                \--> NeuralBus.events (push)
 *                \--> ProjectBridge (disk mirror, debounced)
 *                \--> AutoPromoter (listens to session.commit)
 *
 *   HTTP + NATS both resolve to the SAME handlers; the transport is dumb.
 *
 * Run with:
 *   BRAIN_DATA_DIR=/var/lib/brain \
 *   BRAIN_WORKSPACE=/srv/global-brain \
 *   BRAIN_NATS_URL=nats://127.0.0.1:4222 \
 *   BRAIN_HTTP_PORT=7070 \
 *   node brain-core/daemon.js
 */

import path from "node:path";
import process from "node:process";

// Deduplicate noisy "[Embedding] Failed …" warnings from the embedding engine.
// First occurrence prints a compact line; the rest are suppressed so agents
// see clean logs.
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
import { createHandlers } from "./handlers.js";
import { AutoPromoter } from "./engines/auto-promoter.js";

async function main() {
  const dataDir = process.env.BRAIN_DATA_DIR ?? path.resolve(process.cwd(), "brain-data");
  const workspaceRoot = process.env.BRAIN_WORKSPACE ?? process.cwd();
  const natsUrl = process.env.BRAIN_NATS_URL ?? "";
  const httpPort = Number(process.env.BRAIN_HTTP_PORT ?? 7070);
  const httpHost = process.env.BRAIN_HTTP_HOST ?? "0.0.0.0";
  const checkpointMs = Number(process.env.BRAIN_CHECKPOINT_MS ?? 60_000);

  const store = new BrainStore({ dataDir });
  await store.open();

  const bridge = new ProjectBridge({ store, workspaceRoot });
  if (process.env.BRAIN_INGEST_ON_BOOT !== "0") {
    console.log("[brain] ingesting existing workspace …");
    await bridge.ingestAll();
  }

  const promoter = new AutoPromoter({ store });
  const handlers = createHandlers({ store, bridge, promoter });

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

    store.subscribe((record) => {
      const projectId = record.payload?.source?.projectId ?? record.payload?.projectId ?? "global";
      bus.publishEvent(projectId, { seq: record.seq, kind: record.kind });
      if (projectId && projectId !== "global") bridge.scheduleMirror(projectId);
    });
  } else {
    // Still mirror even without NATS so the on-disk tree stays fresh.
    store.subscribe((record) => {
      const projectId = record.payload?.source?.projectId ?? record.payload?.projectId;
      if (projectId) bridge.scheduleMirror(projectId);
    });
  }

  // ---- HTTP ----
  const http = await startHttpServer({ port: httpPort, host: httpHost, handlers });
  console.log(`[brain] http listening on ${httpHost}:${httpPort}`);

  // ---- Checkpoint loop ----
  const ckptTimer = setInterval(() => {
    store.checkpoint().catch((err) => console.error("[brain] checkpoint", err.message));
  }, checkpointMs);
  ckptTimer.unref();

  // ---- Auto-promotion loop (every 5 min) ----
  const promoteTimer = setInterval(() => {
    promoter.tick().catch((err) => console.error("[brain] promote", err.message));
  }, 5 * 60_000);
  promoteTimer.unref();

  const shutdown = async (sig) => {
    console.log(`[brain] ${sig} — shutting down`);
    clearInterval(ckptTimer);
    clearInterval(promoteTimer);
    await http.close().catch(() => {});
    if (bus) await bus.close().catch(() => {});
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
