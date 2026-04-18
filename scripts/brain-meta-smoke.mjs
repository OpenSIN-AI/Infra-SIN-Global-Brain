#!/usr/bin/env node
/**
 * brain-meta-smoke — exercises Phase 3 + 5 end-to-end:
 *
 *   1. Starts a fresh daemon on a random port in a scratch data dir.
 *   2. Ingests 3 entries, 2 of them near-duplicates, and asserts the
 *      second duplicate is merged (dedup path) while the third lands.
 *   3. Seeds two contradicting ultra rules ("always X" vs "never X"),
 *      runs /admin/meta/tick, asserts a contradiction was detected.
 *   4. GET /metrics → Prometheus text, must include brain_ingests_total.
 *   5. GET /stats/rich → has store + metrics.histograms.brain_ingest_ms.
 *   6. GET /dashboard.html → 200 with <title>brain-core.
 *   7. GET /events (SSE) → receives at least one event within 3s and closes.
 *   8. GET /admin/diagnose → rolled-up report.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 17090 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;

const dataDir = await mkdtemp(path.join(tmpdir(), "brain-meta-"));
const workspace = await mkdtemp(path.join(tmpdir(), "brain-ws-"));

const env = {
  ...process.env,
  BRAIN_DATA_DIR: dataDir,
  BRAIN_WORKSPACE: workspace,
  BRAIN_HTTP_PORT: String(PORT),
  BRAIN_HTTP_HOST: "127.0.0.1",
  BRAIN_NATS_URL: "",
  BRAIN_INGEST_ON_BOOT: "0",
  BRAIN_CHECKPOINT_MS: "600000",
  BRAIN_META_TICK_MS: "600000"
};

const daemon = spawn("node", ["brain-core/daemon.js"], { env, stdio: ["ignore", "pipe", "pipe"] });
let lastLog = "";
daemon.stdout.on("data", (b) => { const s = b.toString(); lastLog += s; process.stdout.write(s.replace(/^/gm, "  daemon> ")); });
daemon.stderr.on("data", (b) => process.stderr.write(b.toString().replace(/^/gm, "  daemon! ")));

async function waitHealthy(timeoutMs = 15_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error("daemon never became healthy");
}

const results = [];
const ok = (name, details) => { results.push({ name, ok: true, details }); console.log(`  OK ${name}`, details ?? ""); };
const fail = (name, err) => { results.push({ name, ok: false, err }); console.error(`  FAIL ${name}: ${err}`); };

async function run() {
  await waitHealthy();

  // --- 1. dedup ---
  const ing = async (entry) => {
    const r = await fetch(`${BASE}/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "smoke", entry })
    }).then((x) => x.json());
    if (!r.ok) throw new Error(r.error);
    return r.result;
  };

  const a = await ing({ type: "rule", text: "Always hash passwords with bcrypt before storing them." });
  const b = await ing({ type: "rule", text: "Always hash passwords with bcrypt before storing them." });
  const c = await ing({ type: "rule", text: "Use server components for data fetching in Next.js 16." });

  if (b.dedup === true && b.id === a.id) ok("dedup merges exact duplicate", { sim: b.sim });
  else fail("dedup merges exact duplicate", `expected merge but got ${JSON.stringify(b)}`);

  if (c.dedup === false && c.id !== a.id) ok("dedup lets distinct entry through", { id: c.id });
  else fail("dedup lets distinct entry through", JSON.stringify(c));

  // --- 2. contradictions ---
  const seed = async (entry) => {
    const r = await fetch(`${BASE}/admin/seed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entry })
    }).then((x) => x.json());
    if (!r.ok) throw new Error(r.error);
    return r.result;
  };

  await seed({
    id: "seed-always-client",
    type: "rule",
    heading: "Client components",
    text: "Always use client components for data fetching on pages.",
    priority: -8,
    scope: "global"
  });
  await seed({
    id: "seed-never-client",
    type: "rule",
    heading: "Client components",
    text: "Never use client components for data fetching on pages.",
    priority: -8,
    scope: "global"
  });

  const metaTick = await fetch(`${BASE}/admin/meta/tick`, { method: "POST" }).then((x) => x.json());
  if (metaTick.ok && metaTick.result.contradictions >= 1) {
    ok("contradiction detector flags opposing rules", metaTick.result);
  } else {
    fail("contradiction detector flags opposing rules", JSON.stringify(metaTick));
  }

  // --- 3. prometheus ---
  const prom = await fetch(`${BASE}/metrics`).then((r) => r.text());
  if (prom.includes("brain_ingests_total") && prom.includes("brain_ingest_ms_bucket")) {
    ok("/metrics exposes Prometheus counters + histograms");
  } else {
    fail("/metrics exposes Prometheus counters + histograms", "missing counters/histograms in output");
  }

  // --- 4. stats/rich ---
  const rich = await fetch(`${BASE}/stats/rich`).then((r) => r.json());
  const histKeys = Object.keys(rich.metrics?.histograms ?? {});
  if (rich.store && histKeys.some((k) => k.startsWith("brain_ingest_ms"))) {
    ok("/stats/rich has store + histograms", { histograms: histKeys.length });
  } else {
    fail("/stats/rich has store + histograms", JSON.stringify(rich).slice(0, 200));
  }

  // --- 5. dashboard.html ---
  const dash = await fetch(`${BASE}/dashboard.html`);
  const dashText = await dash.text();
  if (dash.status === 200 && dashText.includes("brain-core") && dashText.includes("EventSource")) {
    ok("dashboard.html is served and wired to /events");
  } else {
    fail("dashboard.html is served and wired to /events", `status=${dash.status}`);
  }

  // --- 6. SSE ---
  let sseGotEvent = false;
  const sseTimeout = new AbortController();
  const ssePromise = (async () => {
    const res = await fetch(`${BASE}/events`, { signal: sseTimeout.signal });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      if (chunk.includes("data: ")) { sseGotEvent = true; break; }
    }
  })();

  // Trigger a new event after opening the stream
  await sleep(200);
  await ing({ type: "decision", text: "Adopt brain v4 SSE events." });
  await Promise.race([ssePromise, sleep(3000)]);
  sseTimeout.abort();
  await ssePromise.catch(() => {});
  if (sseGotEvent) ok("SSE /events streams live events");
  else fail("SSE /events streams live events", "no chunk received within 3s");

  // --- 7. diagnose ---
  const diag = await fetch(`${BASE}/admin/diagnose`).then((r) => r.json());
  if (diag.ok && diag.result.store && diag.result.metaLearner && diag.result.autoPromoter) {
    ok("/admin/diagnose rolls up every subsystem", {
      contradictions: diag.result.metaLearner.contradictions,
      entries: diag.result.store.entries
    });
  } else {
    fail("/admin/diagnose rolls up every subsystem", JSON.stringify(diag).slice(0, 200));
  }
}

try {
  await run();
} catch (err) {
  fail("unhandled", err.stack ?? err.message);
} finally {
  daemon.kill("SIGTERM");
  await sleep(200);
  await rm(dataDir, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length ? "FAIL" : "OK"}: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
