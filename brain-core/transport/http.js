/**
 * HTTP transport — Fastify. Routes every handler. Also serves:
 *   GET /             -> redirect to /dashboard.html
 *   GET /dashboard.html -> self-contained live ops UI
 *   GET /events       -> SSE stream of every committed brain mutation
 *   GET /metrics      -> Prometheus text format
 *   GET /stats/rich   -> { store, metrics } JSON for the dashboard
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Fastify from "fastify";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_HTML = path.resolve(__dirname, "..", "dashboard", "index.html");

export async function startHttpServer({ port, host, handlers, hiveHandlers = null, broadcast = null, events, metrics }) {
  const app = Fastify({ logger: false });

  // ---- ops / UI ----

  app.get("/", async (_req, reply) => reply.redirect("/dashboard.html"));

  app.get("/dashboard.html", async (_req, reply) => {
    try {
      const html = await readFile(DASHBOARD_HTML, "utf8");
      reply.header("Content-Type", "text/html; charset=utf-8");
      return html;
    } catch (err) {
      reply.code(500);
      return `dashboard missing: ${err.message}`;
    }
  });

  app.get("/health", async () => ({ ok: true, ts: new Date().toISOString() }));

  app.get("/stats", async () => handlers.stats());

  app.get("/stats/rich", async () => handlers.statsRich());

  // ---- Prometheus ----

  app.get("/metrics", async (_req, reply) => {
    if (!metrics) { reply.code(503); return "metrics disabled"; }
    reply.header("Content-Type", "text/plain; version=0.0.4");
    return metrics.toPrometheus();
  });

  // ---- SSE event stream ----

  app.get("/events", (req, reply) => {
    if (!events) { reply.code(503); return reply.send("events disabled"); }
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    });

    // replay last 50
    for (const e of events.history({ limit: 50 })) {
      raw.write(`data: ${JSON.stringify(e)}\n\n`);
    }
    const unsub = events.subscribe((e) => {
      raw.write(`data: ${JSON.stringify(e)}\n\n`);
    });
    const hb = setInterval(() => raw.write(`: ping\n\n`), 25_000);
    hb.unref();
    const close = () => {
      clearInterval(hb);
      unsub();
      try { raw.end(); } catch { /* already closed */ }
    };
    req.raw.on("close", close);
    req.raw.on("aborted", close);
    // tell fastify we've taken over
    reply.hijack();
  });

  // ---- RPC ----

  const post = (route, name) => app.post(route, async (req, reply) => {
    try { return { ok: true, result: await handlers[name](req.body ?? {}) }; }
    catch (err) { reply.code(400); return { ok: false, error: err.message }; }
  });
  const get = (route, name, arg = "query") => app.get(route, async (req, reply) => {
    try { return { ok: true, result: await handlers[name](req[arg] ?? {}) }; }
    catch (err) { reply.code(400); return { ok: false, error: err.message }; }
  });

  post("/ask", "ask");
  post("/attach", "attach");
  get("/rules", "rules");
  post("/ingest", "ingest");
  post("/session/end", "sessionEnd");
  post("/admin/tick", "adminTick");
  post("/admin/meta/tick", "adminMetaTick");
  post("/admin/seed", "seedUltra");
  get("/admin/diagnose", "diagnose");

  // ---- Hive (phase 6+7) ----
  if (hiveHandlers) {
    const hpost = (route, name) => app.post(route, async (req, reply) => {
      try { return { ok: true, result: await hiveHandlers[name](req.body ?? {}) }; }
      catch (err) { reply.code(400); return { ok: false, error: err.message }; }
    });
    const hget = (route, name) => app.get(route, async (req, reply) => {
      try { return { ok: true, result: await hiveHandlers[name](req.query ?? {}) }; }
      catch (err) { reply.code(400); return { ok: false, error: err.message }; }
    });
    hpost("/hive/register", "hiveRegister");
    hpost("/hive/heartbeat", "hiveHeartbeat");
    hpost("/hive/unregister", "hiveUnregister");
    hget("/hive/agents", "hiveAgents");
    hget("/hive/find", "hiveFind");
    hpost("/hive/scratchpad/create", "scratchpadCreate");
    hpost("/hive/scratchpad/get", "scratchpadGet");
    hpost("/hive/scratchpad/set", "scratchpadSet");
    hpost("/hive/scratchpad/append", "scratchpadAppend");
    hpost("/hive/scratchpad/destroy", "scratchpadDestroy");
    hpost("/hive/broadcast", "hiveBroadcast");
    hpost("/hive/history", "hiveHistory");
    hpost("/hive/propose", "hivePropose");
    hpost("/hive/vote", "hiveVote");
    hget("/hive/proposals", "hiveProposals");
    hpost("/hive/proposal/status", "hiveProposalStatus");
    hpost("/hive/orchestrate", "hiveOrchestrate");

    // Run-scoped SSE — live DAG visualization.
    if (broadcast) {
      app.get("/hive/events/:runId", (req, reply) => {
        const runId = req.params.runId;
        const raw = reply.raw;
        raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no"
        });
        const unsub = broadcast.subscribe(runId, (msg) => {
          raw.write(`data: ${JSON.stringify(msg)}\n\n`);
        }, { replay: true });
        const hb = setInterval(() => raw.write(`: ping\n\n`), 25_000);
        hb.unref();
        const close = () => { clearInterval(hb); unsub(); try { raw.end(); } catch {} };
        req.raw.on("close", close);
        req.raw.on("aborted", close);
        reply.hijack();
      });
    }
  }

  await app.listen({ port, host });
  return app;
}
