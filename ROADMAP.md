# ONE-BRAIN Roadmap

The single always-on knowledge core for every OpenSIN agent. Each phase ships
a measurable capability — no phase is "done" until its exit criteria are
green in CI.

---

## Phase 1 — ONE-BRAIN Core &nbsp;`done`

Long-running daemon with WAL, hot cache, auto-promoter, transport-agnostic
handlers, thin client.

**Exit criteria** &nbsp;`met`

- [x] `brain-core/daemon.js` boots in <250 ms, serves HTTP + NATS with the same handlers
- [x] Write-ahead log + snapshots → crash recovery on restart
- [x] `AutoPromoter` promotes rules to Ultra on ≥10 uses × ≥3 projects × ≥90% success
- [x] `@opensin/brain-client` — single `attach()` call pulls prime context
- [x] `npm run brain:smoke` — rule → 12 sessions × 4 projects → Ultra, `ask()` p50/p95 = 1 ms
- [x] `npm run brain:smoke:client` — `attach()` end-to-end in <20 ms

---

## Phase 2 — Canon Seeding + Thin MCP + OCI Deploy &nbsp;`done`

Initial canon from `AGENTS.md`. Legacy MCP becomes millisecond-thin. One-shot
VM installer.

**Exit criteria** &nbsp;`met`

- [x] `POST /admin/seed` — privileged path plants rules directly as Ultra (no usage-data dance)
- [x] `npm run brain:seed` — parses `AGENTS.md`, seeds every PRIORITY ≤ −4 section as Ultra canon, idempotent
- [x] `npm run brain:smoke:seed` — seeds 3 canon rules, asserts they survive WAL replay after a daemon restart
- [x] `src/mcp/sin-brain-server.mjs` — same tool names, but every call hits the daemon over brain-client (no `node src/cli.js` spawn). Legacy CLI path kept as fallback only.
- [x] `npm run brain:pack` — builds `brain-oci.tar.gz` (≈130 KB). One-liner install on the VM:
      `tar xzf brain-oci.tar.gz -C /tmp/brain-oci && sudo bash /tmp/brain-oci/install.sh`
- [x] Installer auto-installs `nats-server` v2.10.22, creates `brain` service user, seeds canon, opportunistically tries `hnswlib-node`
- [x] `VectorIndex` — pluggable nearest-neighbour: HNSW-native when available, JS brute-force otherwise. HotCache uses it transparently.

---

## Phase 3 — Observability &nbsp;`done`

Operators see every rule that fires, every agent attached, every session
outlier — live, without leaving the VM.

**Exit criteria** &nbsp;`met`

- [x] `brain-core/transport/events.js` — in-process `EventBus` with rolling ring buffer (1000 events), normalised event envelope, central `summariseRecord(record)` so SSE + NATS + audit log all agree on shape.
- [x] `GET /events` Server-Sent-Events stream, replays last 50 on connect, 25 s heartbeat, mirrors the NATS `brain.events.*` fan-out.
- [x] `brain-core/engines/metrics.js` — Prometheus-text exposition with counters, gauges, histograms (13 fixed buckets + rolling p50/p95/p99 over last 512 samples). Zero external deps.
- [x] `GET /metrics` exports: `brain_asks_total`, `brain_ingests_total`, `brain_attaches_total`, `brain_sessions_total{success}`, `brain_promotions_total`, `brain_demotions_total`, `brain_seeds_total`, `brain_meta_dedup_total{via}`, `brain_meta_contradictions_total{via}`, `brain_meta_decay_total`, `brain_wal_appends_total{kind}`, plus histograms `brain_ask_ms`, `brain_ingest_ms`, `brain_attach_ms`, and gauges for every cache cardinality.
- [x] `GET /` — self-contained live dashboard (336 LOC, zero build, zero framework): cards for every counter/gauge, live event feed via SSE, Ultra-canon panel, latency histogram, meta-learner summary. Dark terminal aesthetic, three-colour system (bg / surface / accent-green).
- [x] `GET /stats/rich` — one-shot JSON of `{ store, metrics }` for the dashboard.
- [x] `GET /admin/diagnose` — rolls up store + AutoPromoter.tick + MetaLearner.tick in one call for CI + ops.
- [x] Optional append-only event log: set `BRAIN_EVENT_LOG=/var/lib/brain/events.jsonl` to stream every committed event to disk.
- [x] `npm run brain:smoke:meta` — 8 checks (dedup online, contradiction detector, Prometheus shape, stats/rich, dashboard.html, SSE roundtrip, diagnose) all green.

---

## Phase 4 — Replication &nbsp;`planned`

ONE-BRAIN is a single point of failure today. We fix that without losing the
"single source of truth" mental model: one primary, many hot-followers.

**Exit criteria**

- [ ] `brain-core/replica.js` — read-only replica mode. Subscribes to `brain.journal.*` (every WAL record re-published), applies through the same `store.#apply()` path as the primary.
- [ ] NATS JetStream config — durable stream `BRAIN_JOURNAL`, replicas consume with `durable=replica-<hostname>`
- [ ] Failover: a replica promotes itself after `replica_lag_ms > 5000` and a consensus ping via a tiny Raft-lite (≤300 LOC, no Paxos heroics — this is a 3-node brain not etcd).
- [ ] `brain-client` — always `attach()` to the primary, transparently re-resolves if primary is gone.
- [ ] Smoke test: kill primary mid-`ingest`, replica serves `attach()` in <2 s with zero lost records.

---

## Phase 5 — Reflexive Meta-Learning &nbsp;`done (core)`

The brain introspects: no duplicates written, no contradictions hidden, no
stale rules trusted. Three loops on one substrate.

**Exit criteria** &nbsp;`met`

- [x] `brain-core/engines/meta-learner.js` (198 LOC) — three loops, one class, zero external deps.
- [x] **Online dedup** on every `ingest` — embedding-cosine (≥0.92) + token-Jaccard (≥0.80) dual path. Same-type, same-scope, polarity-matching → merge into existing entry, bump `usageCount`, append the new text as an alias. Result: `{ dedup: true, into: id, sim, via }`. Ultra canon is immune (authored, never deduped).
- [x] **Contradiction detector** — embedding cosine (≥0.88) + token Jaccard (≥0.60), polarity mismatch required. Flags both entries with `contradictsWith[]` and emits `meta.contradiction` events. Surfaced in `attach().primeContext.contradictions` so agents warn on conflicting ultra canon.
- [x] **Confidence decay** — exponential 30-day half-life on rule `score` after 14 days of idleness. Ultra exempt. Sub-0.35 score flips `driftStatus` to `demote-candidate` for the AutoPromoter's next tick.
- [x] Robustness: the dual-path design keeps the meta-loop working even when the embedding provider is unreachable and the deterministic fallback produces low-quality vectors.
- [x] `POST /admin/meta/tick` + scheduled loop (default 10 min).
- [x] Test: `brain:smoke:meta` plants an exact duplicate, a semantically-unique rule, two opposing rules — asserts merge + new-row + contradiction detection.

---

## Phase 6 — Skill Crystallisation &nbsp;`planned`

Successful multi-step sessions get lifted from episodic → procedural memory.
Currently `solution` entries are just notes; this phase makes them callable.

**Exit criteria**

- [ ] `brain-core/engines/skill-miner.js` — scans session transcripts for "repeatable recipes" (same tool sequence across ≥3 sessions with ≥90% success).
- [ ] Each crystallised skill stored as `entry.type === "skill"` with `.steps: [{tool, args, outcome}]`.
- [ ] `brain.skills.suggest(projectId, goal)` — returns top-N skills ranked by cosine(goal-embedding, skill-embedding) × success-rate.
- [ ] MCP tool `brain_use_skill` — binds a skill's argument schema, executes steps in order, streams progress.

---

## Phase 7 — Governance / Drift Gates &nbsp;`done`

Any agent can push a rule, but we need a tripwire for ingest that silently
contradicts the canon. Drift is caught *before* it enters the hot cache,
not after.

**Exit criteria** &nbsp;`met`

- [x] `brain-core/engines/governance.js` — `GovernanceEngine.evaluate(entry)` runs on every non-ultra `ingest` before `store.addKnowledge()`. Dual path: embedding cosine ≥ 0.82 OR token Jaccard ≥ 0.55 against same-type active entries, then polarity mismatch is required to flag a conflict. Cheap (O(|type|) Jaccard, 1 HNSW/brute-force query), deterministic, same-process.
- [x] `brain-core/lib/pending-store.js` — durable JSONL queue (`$DATA/pending-review.jsonl`). Append-only, replay-on-boot, bounded audit history (200 entries). Conflicting ingests are captured *whole* (enriched entry + conflict list + actor + reason) so approve later commits the exact same row the original caller submitted.
- [x] Handlers: `reviewList`, `reviewStats`, `reviewApprove`, `reviewReject`. Approve commits the held entry via the normal `store.addKnowledge()` path and triggers the project-bridge mirror just like a fresh ingest.
- [x] HTTP: `GET /review/list`, `GET /review/stats`, `POST /review/approve`, `POST /review/reject`. NATS mirrors under `brain.review.*`.
- [x] Bypass rules: `entry.ultra === true` and explicit `entry.governance === "bypass"` skip the gate. Ultra canon from `brain:seed` is therefore immune by construction.
- [x] Observability: counters `brain_governance_accepted_total{type}`, `brain_governance_pending_total{type}`, `brain_governance_approved_total{type}`, `brain_governance_rejected_total{type}`, gauge `brain_governance_pending`, events `governance.pending` / `governance.approved` / `governance.rejected` on the SSE stream.
- [x] `npm run brain:smoke:governance` — 10 checks: ultra canon seed → polarity-flip ingest held → `/review/list` sees it → reject empties queue → second conflict → approve commits it → `/ask` retrieves approved entry → benign ingest commits immediately → every Prometheus counter + gauge present → state survives daemon restart.

---

## Phase 8 — Embedding Provider Abstraction &nbsp;`planned`

Today embeddings rely on OpenAI; when it's unreachable we fall back to a
deterministic hash vector. That works but limits semantic quality in the
fallback path.

**Exit criteria**

- [ ] `brain-core/engines/embedding-provider.js` — strategy pattern. Providers: `openai`, `local-minilm` (onnx), `hash-fallback`.
- [ ] Auto-probe on boot: if `OPENAI_API_KEY` → `openai`; else if `ONNX_MINILM_MODEL_PATH` → local; else hash.
- [ ] `ask()` latency budget unchanged (local-minilm must serve 384-dim vectors in <5 ms on CPU).
- [ ] Vector dim migration — when the provider changes, `VectorIndex.configure({dim})` rebuilds transparently.

---

## Phase 9 — Project-Template Bootstrapping &nbsp;`planned`

New repos should inherit relevant ultra-rules from similar projects before
any agent does work in them.

**Exit criteria**

- [ ] `brain-client.bootstrap({ projectId, description })` — embeds the description, finds the 3 most-similar existing projects, copies their non-conflicting project-scoped rules as `status: "inherited"` with source tagged.
- [ ] Inherited rules decay faster than authored ones so they get replaced as the new project finds its own patterns.
- [ ] Metric: `brain_bootstrap_hits` — how many inherited rules were consulted by the first 10 sessions of the project (direct signal that bootstrap delivers value).

---

## Phase 10 — Multi-Tenant Isolation &nbsp;`planned`

Right now `scope: "global"` is one global. For multi-org deploys we want
hard isolation.

**Exit criteria**

- [ ] `tenantId` first-class on every entry, every handler, every WAL record (migration writes `tenant: "default"` to existing records).
- [ ] NATS subject tree becomes `brain.<tenant>.ask` etc.; agents inherit tenant from their auth token.
- [ ] Row-level visibility: handlers filter `byTenant` before any other filter.
- [ ] Per-tenant quota: ingest rate limit + max entries, enforced at the WAL append.
- [ ] Smoke: two tenants, same rule ID, no cross-read.

---

## Instrumentation — Always On

- `[brain] READY` log on every boot with `stats()`
- Every handler records `x-brain-ms` on the NATS reply header
- WAL rotation at 64 MB; snapshot every 60 s (configurable)
- Checkpoint on `SIGTERM` — no record lost on systemd restart

## Non-Goals

- A separate HTTP API gateway. The brain-client IS the API.
- Multi-writer. One primary, period. Phase 4 adds hot-standby, not active-active.
- An ORM. Entries are plain objects persisted via WAL + snapshot. Schemas live in JSDoc.
