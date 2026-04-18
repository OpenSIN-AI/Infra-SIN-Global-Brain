#!/usr/bin/env node
/**
 * brain-governance-smoke — exercises Phase 7 end-to-end:
 *
 *   1. Seed an ultra rule "Always use server components for data fetching in
 *      Next.js 16." so there's canon to drift against.
 *   2. Ingest a polarity-mismatching rule ("Never use server components…")
 *      with bypass-dedup to avoid the merge path. Assert the response has
 *      pendingReview=true, a pendingId, and at least one conflict pointing
 *      at the ultra rule.
 *   3. GET /review/list → the pending item is visible.
 *   4. Reject the pending item. GET /review/list → empty again, /review/stats
 *      shows rejected=1.
 *   5. Re-ingest another polarity-mismatching candidate, approve it.
 *      Assert the entry appears in /stats as an active rule.
 *   6. Ingest a non-conflicting rule ("Cache responses for 60s.") — must
 *      commit immediately without landing in pending.
 *   7. Verify Prometheus counters: pending_total, rejected_total,
 *      approved_total, accepted_total, gauge brain_governance_pending.
 *   8. Restart the daemon against the same data dir; approved entry must
 *      still be in /stats (WAL replay), pending queue empty (replay).
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 17890 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;

const dataDir = await mkdtemp(path.join(tmpdir(), "brain-gov-"));
const workspace = await mkdtemp(path.join(tmpdir(), "brain-gov-ws-"));

const baseEnv = {
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

function startDaemon() {
  const proc = spawn("node", ["brain-core/daemon.js"], {
    env: baseEnv,
    stdio: ["ignore", "pipe", "pipe"]
  });
  proc.stdout.on("data", (b) => process.stdout.write(b.toString().replace(/^/gm, "  daemon> ")));
  proc.stderr.on("data", (b) => process.stderr.write(b.toString().replace(/^/gm, "  daemon! ")));
  return proc;
}

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

async function stopDaemon(proc) {
  proc.kill("SIGTERM");
  await new Promise((resolve) => {
    const t = setTimeout(() => { proc.kill("SIGKILL"); resolve(); }, 3000);
    proc.once("exit", () => { clearTimeout(t); resolve(); });
  });
}

const results = [];
const ok = (name, details) => { results.push({ name, ok: true, details }); console.log(`  OK ${name}`, details ?? ""); };
const fail = (name, err) => { results.push({ name, ok: false, err }); console.error(`  FAIL ${name}: ${err}`); };

const asJson = async (res) => {
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error(`non-JSON response: ${text.slice(0, 200)}`); }
};

const ingest = async (entry, projectId = "smoke") => {
  const r = await asJson(await fetch(`${BASE}/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, entry })
  }));
  if (!r.ok) throw new Error(r.error);
  return r.result;
};

const seed = async (entry) => {
  const r = await asJson(await fetch(`${BASE}/admin/seed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entry })
  }));
  if (!r.ok) throw new Error(r.error);
  return r.result;
};

const reviewList = async (status = "pending") => {
  const r = await asJson(await fetch(`${BASE}/review/list?status=${status}&limit=50`));
  if (!r.ok) throw new Error(r.error);
  return r.result;
};

const reviewApprove = async (id, reviewer = "ceo", note = null) => {
  const r = await asJson(await fetch(`${BASE}/review/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, reviewer, note })
  }));
  if (!r.ok) throw new Error(r.error);
  return r.result;
};

const reviewReject = async (id, reviewer = "ceo", reason = null) => {
  const r = await asJson(await fetch(`${BASE}/review/reject`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, reviewer, reason })
  }));
  if (!r.ok) throw new Error(r.error);
  return r.result;
};

const reviewStats = async () => {
  const r = await asJson(await fetch(`${BASE}/review/stats`));
  if (!r.ok) throw new Error(r.error);
  return r.result;
};

const stats = async () => asJson(await fetch(`${BASE}/stats`));

async function run() {
  let daemon = startDaemon();
  await waitHealthy();

  // 1. Canon
  await seed({
    id: "ultra-rsc",
    type: "rule",
    heading: "React Server Components",
    text: "Always use server components for data fetching in Next.js 16.",
    priority: -10,
    scope: "global"
  });
  ok("seeded ultra canon");

  // 2. Conflicting ingest → must be held back
  const conflicting = await ingest({
    type: "rule",
    // Similar enough (many shared tokens) but opposite polarity.
    text: "Never use server components for data fetching in Next.js 16.",
    scope: "global",
    // dedup:false is for meta-learner bypass (dedup only merges same-polarity).
    dedup: false
  });
  if (conflicting.pendingReview === true && conflicting.pendingId &&
      conflicting.conflicts?.some((c) => c.id === "ultra-rsc")) {
    ok("governance holds polarity-flipping rule", {
      pendingId: conflicting.pendingId,
      conflicts: conflicting.conflicts.length,
      reason: conflicting.reason
    });
  } else {
    fail("governance holds polarity-flipping rule", JSON.stringify(conflicting));
  }

  // 3. /review/list shows it
  const listed = await reviewList("pending");
  if (listed.items.length === 1 && listed.items[0].id === conflicting.pendingId) {
    ok("review/list surfaces pending item");
  } else {
    fail("review/list surfaces pending item", JSON.stringify(listed).slice(0, 400));
  }

  // 4. Reject
  await reviewReject(conflicting.pendingId, "ceo", "ultra canon wins");
  const listedAfterReject = await reviewList("pending");
  const statsAfterReject = await reviewStats();
  if (listedAfterReject.items.length === 0 && statsAfterReject.rejected === 1) {
    ok("reject empties the queue and increments counters", statsAfterReject);
  } else {
    fail("reject empties the queue and increments counters",
      `list=${listedAfterReject.items.length} stats=${JSON.stringify(statsAfterReject)}`);
  }

  // 5. Approve path — second conflicting ingest, then approve.
  const conflicting2 = await ingest({
    id: "rule-never-rsc",
    type: "rule",
    text: "Never use server components for data fetching in edge runtime pages.",
    scope: "global",
    dedup: false
  });
  if (!conflicting2.pendingReview) {
    fail("second conflicting ingest also gated", JSON.stringify(conflicting2));
  } else {
    ok("second conflicting ingest also gated", { pendingId: conflicting2.pendingId });
    const approved = await reviewApprove(conflicting2.pendingId, "ceo", "edge caveat accepted");
    if (approved.committed === "rule-never-rsc") {
      ok("approve commits the held entry", approved);
    } else {
      fail("approve commits the held entry", JSON.stringify(approved));
    }
    const s = await stats();
    const rules = s.entriesByType?.rule ?? s.rules ?? 0;
    // The approved entry should be visible via /ask too.
    const ask = await asJson(await fetch(`${BASE}/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "edge runtime server components" })
    }));
    if (ask.ok && ask.result.hits.some((h) => h.id === "rule-never-rsc")) {
      ok("approved entry is retrievable via /ask", { rules });
    } else {
      fail("approved entry is retrievable via /ask", JSON.stringify(ask).slice(0, 300));
    }
  }

  // 6. Non-conflicting ingest → instant commit
  const benign = await ingest({
    type: "rule",
    text: "Cache downstream GraphQL responses for 60 seconds in production."
  });
  if (!benign.pendingReview && benign.dedup === false) {
    ok("non-conflicting ingest commits immediately", benign);
  } else {
    fail("non-conflicting ingest commits immediately", JSON.stringify(benign));
  }

  // 7. Prometheus + gauges
  const prom = await fetch(`${BASE}/metrics`).then((r) => r.text());
  const expected = [
    "brain_governance_pending_total",
    "brain_governance_rejected_total",
    "brain_governance_approved_total",
    "brain_governance_accepted_total",
    "brain_governance_pending "
  ];
  const missing = expected.filter((k) => !prom.includes(k));
  if (!missing.length) ok("Prometheus exposes every governance metric");
  else fail("Prometheus exposes every governance metric", `missing: ${missing.join(", ")}`);

  // 8. Durability — restart and verify state replays.
  await stopDaemon(daemon);
  daemon = startDaemon();
  await waitHealthy();

  const listedAfterRestart = await reviewList("pending");
  const statsAfterRestart = await reviewStats();
  const ask2 = await asJson(await fetch(`${BASE}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "edge runtime server components" })
  }));
  if (listedAfterRestart.items.length === 0 &&
      statsAfterRestart.approved === 1 && statsAfterRestart.rejected === 1 &&
      ask2.ok && ask2.result.hits.some((h) => h.id === "rule-never-rsc")) {
    ok("state survives daemon restart", statsAfterRestart);
  } else {
    fail("state survives daemon restart",
      JSON.stringify({ listedAfterRestart, statsAfterRestart, hits: ask2.result?.hits?.length }).slice(0, 400));
  }

  await stopDaemon(daemon);
}

try {
  await run();
} catch (err) {
  fail("unhandled", err.stack ?? err.message);
} finally {
  await rm(dataDir, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length ? "FAIL" : "OK"}: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
