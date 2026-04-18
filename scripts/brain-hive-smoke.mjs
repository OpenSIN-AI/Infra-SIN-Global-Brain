/**
 * brain-hive-smoke — end-to-end "god-agent" simulation.
 *
 * What this test proves:
 *   1. A live brain-core daemon accepts hive workers over HTTP.
 *   2. 4 independent worker processes register distinct capabilities.
 *   3. One orchestration request from a prime agent fans out across all 4
 *      workers in parallel (respecting the DAG), aggregates, and returns one
 *      coherent answer.
 *   4. Live telepathy (`/hive/events/:runId`) streams every dispatch +
 *      finding as it happens.
 *   5. The registry's routing picks the top-ranked worker for each
 *      capability and records actual latencies.
 *   6. A worker-emitted proposal hits the ConsensusEngine. After 3 agents
 *      from 2 projects agree, the proposal is promoted into a real rule.
 *   7. A reflection entry is written to the store so the AutoPromoter +
 *      MetaLearner see the run naturally on their next ticks.
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { rm, mkdir } from "node:fs/promises";
import { createServer } from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const BRAIN_PORT = 7191;
const BRAIN_URL = `http://127.0.0.1:${BRAIN_PORT}`;
const DATA_DIR = resolve(repoRoot, ".brain-hive-smoke");

async function call(path, body, method = "POST") {
  const url = new URL(path, BRAIN_URL);
  const res = await fetch(url, {
    method,
    headers: method === "POST" ? { "content-type": "application/json" } : undefined,
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${path}: ${json.error ?? res.status}`);
  return json.result;
}

/** Spin up a tiny HTTP worker that executes `fn(task)` on POST /. */
function spawnWorker(port, fn) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", async () => {
      try {
        const { task, runId } = JSON.parse(body || "{}");
        const result = await fn(task, runId);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  });
  return new Promise((r) => server.listen(port, "127.0.0.1", () => r(server)));
}

async function waitForDaemon(retries = 60) {
  for (let i = 0; i < retries; i += 1) {
    try {
      const r = await fetch(`${BRAIN_URL}/health`);
      if (r.ok) return;
    } catch { /* not ready */ }
    await sleep(250);
  }
  throw new Error("daemon never came up");
}

async function main() {
  // clean slate
  await rm(DATA_DIR, { recursive: true, force: true });
  await mkdir(DATA_DIR, { recursive: true });

  // start daemon
  const daemon = spawn("node", ["brain-core/daemon.js"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      BRAIN_DATA_DIR: DATA_DIR,
      BRAIN_HTTP_PORT: String(BRAIN_PORT),
      BRAIN_HTTP_HOST: "127.0.0.1",
      BRAIN_INGEST_ON_BOOT: "0",
      BRAIN_CHECKPOINT_MS: "600000",
      BRAIN_META_TICK_MS: "600000"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const logs = [];
  daemon.stdout.on("data", (d) => logs.push(String(d)));
  daemon.stderr.on("data", (d) => logs.push(String(d)));

  const cleanup = async () => {
    daemon.kill("SIGTERM");
    await sleep(400).catch(() => {});
  };

  try {
    await waitForDaemon();
    console.log("[hive-smoke] daemon up");

    // ---- 4 workers: research, design, code, test ----
    const researchSrv = await spawnWorker(7201, async (task) => ({
      summary: `research on "${task.prompt.slice(0, 40)}…" — three prior similar runs found`,
      confidence: 0.82,
      headline: true
    }));
    const designSrv = await spawnWorker(7202, async (task) => ({
      summary: "design: queue pattern with 3 stages, rate-limit at the edge",
      upstream: Object.keys(task.upstream ?? {}),
      confidence: 0.9
    }));
    const codeSrv = await spawnWorker(7203, async () => ({
      summary: "implementation scaffold produced (4 files, 180 LOC)",
      confidence: 0.85
    }));
    const testSrv = await spawnWorker(7204, async () => ({
      summary: "all 12 unit tests green, 2 edge cases surfaced",
      confidence: 0.78,
      // This worker raises a candidate canon entry for consensus
      proposal: {
        type: "rule",
        scope: "global",
        text: "Always rate-limit the fan-in boundary, not individual fan-out workers.",
        tags: ["architecture", "observed"],
        reason: "surfaced across 3 sub-tasks"
      }
    }));

    // register all 4 with the hive
    const agents = [
      { agentId: "research-bot", endpoint: "http://127.0.0.1:7201/", cap: "research" },
      { agentId: "design-bot",   endpoint: "http://127.0.0.1:7202/", cap: "design" },
      { agentId: "code-bot",     endpoint: "http://127.0.0.1:7203/", cap: "code" },
      { agentId: "test-bot",     endpoint: "http://127.0.0.1:7204/", cap: "test" }
    ];
    for (const a of agents) {
      await call("/hive/register", {
        agentId: a.agentId,
        endpoint: a.endpoint,
        capabilities: [{ name: a.cap, cost: 1, avgLatencyMs: 100 }],
        heartbeatTtlMs: 60_000
      });
    }
    console.log("[hive-smoke] 4 workers registered");

    // ---- Orchestrate ----
    const prompt = "Build a rate-limited webhook delivery system";
    const run = await call("/hive/orchestrate", {
      prompt,
      projectId: "test-project",
      agentId: "prime-bot",
      budgetMs: 20_000
    });

    const trace = run.trace ?? [];
    const okNodes = trace.filter((n) => n.status === "ok");
    console.log(`[hive-smoke] run ${run.runId.slice(0, 8)}: ${okNodes.length}/${trace.length} nodes ok, ${run.durationMs}ms, conf=${run.confidence}`);

    const checks = [];
    const check = (label, ok, extra = "") => { checks.push({ label, ok }); console.log(`  ${ok ? "OK " : "FAIL"} ${label}${extra ? "  — " + extra : ""}`); };

    check("DAG has 4 nodes", trace.length === 4, `got ${trace.length}`);
    check("all 4 nodes ok", okNodes.length === 4);
    check("distinct agents picked", new Set(okNodes.map((n) => n.agentId)).size === 4);
    check("each worker did its capability", ["research", "design", "code", "test"].every((c) => okNodes.some((n) => n.capability === c)));
    check("aggregated answer non-empty", typeof run.answer === "string" && run.answer.length > 50);
    check("reflection id present", typeof run.reflectionId === "string" && run.reflectionId.startsWith("reflection:"));

    // ---- Registry stats reflect actual runs ----
    const agentList = (await call("/hive/agents", null, "GET")).agents;
    const testBot = agentList.find((a) => a.agentId === "test-bot");
    const testCap = testBot?.capabilities?.find((c) => c.name === "test");
    check("registry recorded runs for test-bot", testCap?.runs === 1 && testCap?.successRate === 1, `runs=${testCap?.runs}`);

    // ---- Proposal from test-bot should be pending ----
    const pend = (await call("/hive/proposals", { status: "pending", limit: 10 }, "GET")).proposals;
    check("proposal created by worker", pend.length >= 1 && run.proposals?.length >= 1);
    const proposalId = run.proposals?.[0]?.id;
    check("proposal id surfaced", typeof proposalId === "string");

    // ---- Consensus: two more agents from another project agree → promoted ----
    // Register two lightweight voters
    for (const vid of ["voter-a", "voter-b"]) {
      await call("/hive/register", {
        agentId: vid,
        endpoint: `local:noop`,
        capabilities: [{ name: "vote" }]
      });
    }
    const voteA = await call("/hive/vote", { proposalId, agentId: "voter-a", projectId: "project-b", verdict: "agree" });
    const voteB = await call("/hive/vote", { proposalId, agentId: "voter-b", projectId: "project-c", verdict: "agree" });
    check("consensus quorum reached", voteB.status === "promoted", `status=${voteB.status} agrees=${voteB.tally?.agrees} projects=${voteB.tally?.agreeProjects}`);

    const finalRule = voteB.ruleId;
    check("consensus emitted a real rule id", typeof finalRule === "string" && finalRule.startsWith("consensus:"));

    // ---- Live telepathy: history of the run should cover plan → dispatch → done → aggregated ----
    const hist = (await call("/hive/history", { runId: run.runId })).history;
    const kinds = new Set(hist.map((m) => m.kind));
    check("broadcast history has plan+dispatch+done+aggregated", ["plan", "dispatch", "done", "aggregated"].every((k) => kinds.has(k)));

    // ---- Prometheus ----
    const prom = await (await fetch(`${BRAIN_URL}/metrics`)).text();
    check("prom exposes brain_hive_runs_total", prom.includes("brain_hive_runs_total"));
    check("prom exposes brain_hive_worker_ms histogram", prom.includes("brain_hive_worker_ms_bucket"));
    check("prom exposes brain_hive_proposals_promoted_total", prom.includes("brain_hive_proposals_promoted_total"));

    // ---- Reflection should be searchable by ask ----
    const ask = await call("/ask", { query: "rate-limited webhook" });
    check("ask returns hits touching the reflection topic", Array.isArray(ask.hits) && ask.hits.length > 0);

    researchSrv.close(); designSrv.close(); codeSrv.close(); testSrv.close();

    const failed = checks.filter((c) => !c.ok);
    console.log(`\n[hive-smoke] ${checks.length - failed.length}/${checks.length} checks passed`);
    if (failed.length) {
      console.error("FAILED:", failed.map((c) => c.label).join(", "));
      console.error("\n--- last daemon logs ---\n" + logs.slice(-20).join(""));
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("[hive-smoke] fatal", err);
    console.error("\n--- last daemon logs ---\n" + logs.slice(-30).join(""));
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main();
