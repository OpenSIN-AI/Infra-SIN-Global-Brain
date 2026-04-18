/**
 * Seeder smoke test.
 *
 * Boots a daemon on an isolated data dir, runs the AGENTS.md seeder against
 * it, and asserts that every PRIORITY -10..-4 section shows up as an
 * ultra-rule on a fresh attach — i.e. the initial canon actually reaches
 * every agent on their first round trip.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { seedFromAgentsMd, parseAgentsMd } from "../brain-core/seed/agents-md-seeder.js";
import fs from "node:fs";

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
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const agentsMdPath = path.join(repoRoot, "AGENTS.md");
  if (!fs.existsSync(agentsMdPath)) throw new Error(`AGENTS.md missing at ${agentsMdPath}`);

  const tmp = await mkdtemp(path.join(os.tmpdir(), "brain-seed-smoke-"));
  const port = 7600 + Math.floor(Math.random() * 200);
  const base = `http://127.0.0.1:${port}`;

  const daemon = spawn(process.execPath, ["brain-core/daemon.js"], {
    cwd: repoRoot,
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

  try {
    await waitForHealth(`${base}/health`);
    console.log("[seed-smoke] daemon up");

    // Parse locally so we know what to expect.
    const sections = parseAgentsMd(fs.readFileSync(agentsMdPath, "utf8"));
    const expected = sections.filter((s) => s.priority !== null && s.priority <= -4);
    if (!expected.length) throw new Error("AGENTS.md has no PRIORITY <= -4 sections — nothing to seed");
    console.log(`[seed-smoke] expecting ${expected.length} canon rules`);

    const results = await seedFromAgentsMd({ agentsMdPath, brainUrl: base, maxPriority: -4 });
    const ok = results.filter((r) => r.ok).length;
    console.log(`[seed-smoke] seeder reported ${ok}/${results.length} OK`);
    if (ok !== results.length) throw new Error("seeder had failures");

    // Idempotency: seeding again should not duplicate ids.
    const second = await seedFromAgentsMd({ agentsMdPath, brainUrl: base, maxPriority: -4 });
    if (second.filter((r) => r.ok).length !== results.length) throw new Error("second seed run diverged");
    console.log("[seed-smoke] idempotent rerun OK");

    // Attach and verify canon is present as ultra.
    const attached = await call(`${base}/attach`, { projectId: "any", agentId: "seed-smoke" });
    const ultraIds = new Set(attached.primeContext.ultraRules.map((r) => r.id));
    for (const r of results) {
      if (!ultraIds.has(r.id)) throw new Error(`canon rule missing on attach: ${r.heading}`);
    }
    console.log(`[seed-smoke] attach returned ${attached.primeContext.ultraRules.length} ultra rules — canon live`);

    // Crash-recover: restart daemon on same data dir and re-verify.
    daemon.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 400));

    const daemon2 = spawn(process.execPath, ["brain-core/daemon.js"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        BRAIN_DATA_DIR: tmp,
        BRAIN_WORKSPACE: tmp,
        BRAIN_HTTP_PORT: String(port),
        BRAIN_HTTP_HOST: "127.0.0.1",
        BRAIN_NATS_URL: "",
        BRAIN_INGEST_ON_BOOT: "0"
      },
      stdio: ["ignore", "inherit", "inherit"]
    });
    try {
      await waitForHealth(`${base}/health`);
      const reattached = await call(`${base}/attach`, { projectId: "any", agentId: "seed-smoke" });
      const ultraIds2 = new Set(reattached.primeContext.ultraRules.map((r) => r.id));
      for (const r of results) {
        if (!ultraIds2.has(r.id)) throw new Error(`canon rule LOST after restart: ${r.heading}`);
      }
      console.log(`[seed-smoke] WAL replay preserved ${reattached.primeContext.ultraRules.length} ultra rules`);
    } finally {
      daemon2.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 200));
    }

    console.log("[seed-smoke] OK");
  } finally {
    try { daemon.kill("SIGTERM"); } catch { /* already gone */ }
    await new Promise((r) => setTimeout(r, 200));
    await rm(tmp, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error("[seed-smoke] FAIL", err);
  process.exit(1);
});
