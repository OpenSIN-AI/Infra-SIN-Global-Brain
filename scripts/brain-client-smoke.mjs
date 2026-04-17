/**
 * Client smoke — boots a daemon and drives it via the thin brain-client
 * to prove the one-import-one-call agent integration works end-to-end.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { BrainClient, attach } from "../brain-client/index.js";

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

async function run() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "brain-client-smoke-"));
  const port = 7650 + Math.floor(Math.random() * 100);

  const daemon = spawn(process.execPath, ["brain-core/daemon.js"], {
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
    await waitForHealth(`http://127.0.0.1:${port}/health`);
    process.env.BRAIN_URL = `http://127.0.0.1:${port}`;

    // One-liner attach — this is the agent developer experience.
    const t0 = process.hrtime.bigint();
    const brain = await attach({ projectId: "demo", agentId: "demo-agent", goal: "ship it" });
    const attachMs = Number((process.hrtime.bigint() - t0) / 1_000_000n);
    console.log(`[client-smoke] attach completed in ${attachMs}ms`);
    if (!brain.primeContext) throw new Error("no primeContext on attach");

    // Ingest + ask via client
    await brain.ingest({ type: "rule", text: "Never block the event loop", scope: "global" });
    const res = await brain.ask("never block");
    if (!res.hits.length) throw new Error("ask returned no hits via client");
    console.log(`[client-smoke] ask via client returned ${res.hits.length} hits`);

    await brain.close();
    console.log("[client-smoke] OK");
  } finally {
    daemon.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 200));
    await rm(tmp, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error("[client-smoke] FAIL", err);
  process.exit(1);
});
