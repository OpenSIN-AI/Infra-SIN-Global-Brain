/**
 * End-to-end smoke test for brain-core.
 *
 * Spawns the daemon in HTTP-only mode on an isolated data dir, hammers it
 * with attach/ask/ingest/session-end, forces an auto-promoter tick, and
 * asserts the expected ultra-rule transition. Exits 0 on success.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

async function waitForHealth(url, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`daemon not healthy at ${url}`);
}

async function call(url, body, method = "POST") {
  const init = { method };
  if (method !== "GET") {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body ?? {});
  }
  const r = await fetch(url, init);
  const j = await r.json();
  if (!j.ok) throw new Error(`${url}: ${j.error}`);
  return j.result;
}

async function run() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "brain-smoke-"));
  const port = 7400 + Math.floor(Math.random() * 200);
  const base = `http://127.0.0.1:${port}`;

  const daemon = spawn(process.execPath, ["brain-core/daemon.js"], {
    env: {
      ...process.env,
      BRAIN_DATA_DIR: tmp,
      BRAIN_WORKSPACE: tmp,
      BRAIN_HTTP_PORT: String(port),
      BRAIN_HTTP_HOST: "127.0.0.1",
      BRAIN_NATS_URL: "",
      BRAIN_INGEST_ON_BOOT: "0",
      BRAIN_CHECKPOINT_MS: "500"
    },
    stdio: ["ignore", "inherit", "inherit"]
  });
  daemon.on("exit", (code) => {
    if (code !== null && code !== 0) console.error(`[smoke] daemon exited ${code}`);
  });

  try {
    await waitForHealth(`${base}/health`);
    console.log("[smoke] daemon up");

    // 1. Ingest a rule
    const { id: ruleId } = await call(`${base}/ingest`, {
      projectId: "test-proj",
      entry: { type: "rule", text: "Always escape shell arguments", scope: "global" },
      actor: "smoke"
    });
    console.log(`[smoke] ingested rule ${ruleId}`);

    // 2. Attach and check the rule is present
    const attached = await call(`${base}/attach`, { projectId: "test-proj", agentId: "smoke" });
    const hasRule = [
      ...attached.primeContext.rules,
      ...attached.primeContext.ultraRules
    ].some((r) => r.id === ruleId);
    if (!hasRule) throw new Error("attach did not return ingested rule");
    console.log(`[smoke] attach returned ${attached.primeContext.rules.length} rules`);

    // 3. ask()
    const askRes = await call(`${base}/ask`, { query: "escape shell", projectId: "test-proj" });
    if (!askRes.hits.length && !askRes.ultraRules.length) throw new Error("ask returned empty");
    console.log(`[smoke] ask returned ${askRes.hits.length} hits`);

    // 4. Hammer session.end enough to cross promotion thresholds.
    const SESSIONS = 12;
    const PROJECTS = 4;
    for (let i = 0; i < SESSIONS; i += 1) {
      await call(`${base}/session/end`, {
        projectId: `proj-${i % PROJECTS}`,
        agentId: "smoke",
        consultedRuleIds: [ruleId],
        success: true
      });
    }
    console.log(`[smoke] simulated ${SESSIONS} sessions across ${PROJECTS} projects`);

    // 5. Force a promoter tick — verifies auto-promotion end-to-end.
    const tickRes = await call(`${base}/admin/tick`, {});
    console.log(`[smoke] promoter tick promoted=${tickRes.promoted.length} demoted=${tickRes.demoted.length}`);
    if (!tickRes.promoted.includes(ruleId)) {
      throw new Error(`rule ${ruleId} was not promoted — thresholds uses/rate/projects not met`);
    }

    // 6. Re-attach and verify the rule is now in ultraRules (canonical).
    const reattached = await call(`${base}/attach`, { projectId: "test-proj", agentId: "smoke" });
    const isUltra = reattached.primeContext.ultraRules.some((r) => r.id === ruleId);
    if (!isUltra) throw new Error("promoted rule did not appear in ultraRules on re-attach");
    console.log(`[smoke] rule promoted to ULTRA and delivered on attach in one round trip`);

    // 7. Latency check — ask() p95 under 150ms on a warm cache.
    const N = 200;
    const samples = [];
    for (let i = 0; i < N; i += 1) {
      const t = process.hrtime.bigint();
      await call(`${base}/ask`, { query: "shell", projectId: "test-proj" });
      samples.push(Number((process.hrtime.bigint() - t) / 1_000_000n));
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(N * 0.5)];
    const p95 = samples[Math.floor(N * 0.95)];
    console.log(`[smoke] ask latency p50=${p50}ms p95=${p95}ms`);
    if (p95 > 150) throw new Error(`ask p95 too high: ${p95}ms`);

    console.log("[smoke] OK");
  } finally {
    daemon.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 200));
    await rm(tmp, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error("[smoke] FAIL", err);
  process.exit(1);
});
