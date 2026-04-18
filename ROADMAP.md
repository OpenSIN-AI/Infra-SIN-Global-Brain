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

## Phase 3 — Observability &nbsp;`next`

Operators need to see: which rules fire, which agents are attached, which
sessions are outliers.

**Exit criteria**

- [ ] `GET /events` Server-Sent-Events stream (mirror of the NATS `brain.events.*` fan-out)
- [ ] `GET /metrics` — Prometheus exposition: `brain_attach_total`, `brain_ask_duration_ms_bucket`, `brain_rules_total{status}`, `brain_ultra_total`, `brain_promote_total`, `brain_demote_total`
- [ ] Dashboard route `GET /` — zero-dep HTML + SSE: live rule count, active agents, promotion/demotion feed, p95 latency spark-line, top 10 most-consulted rules
- [ ] `brain-core/lib/audit.js` — append-only `audit.jsonl` next to the WAL: every rule promote/demote with actor + reason + rule delta. Retention via logrotate.

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

## Phase 5 — Reflexive Meta-Learning &nbsp;`planned`

The brain notices its own patterns and writes rules about its own decisions.
Current AutoPromoter handles threshold rules; this phase handles second-order
rules ("rules that say when to trust rules").

**Exit criteria**

- [ ] `brain-core/engines/meta-promoter.js` — runs every hour, mines session outcomes for patterns like "rules tagged `#security` that came from agent X have 40% false-positive rate → auto-demote".
- [ ] Every meta-decision appended as its own `decision` entry so the next meta-tick can see its own history.
- [ ] `brain.stats.meta` exposes: top 10 auto-discovered patterns, their confidence, their effect on promotions.
- [ ] Test: plant 20 rules with known skew, run meta-tick, assert the exact expected demotions.

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

## Phase 7 — Governance / Drift Gates &nbsp;`planned`

Today any agent can push a rule. We need a tripwire for rules that silently
contradict the canon.

**Exit criteria**

- [ ] Ingest path runs a cheap semantic conflict check against existing Ultra-rules (cosine ≥ 0.85 + opposing polarity detector).
- [ ] Rules that would conflict land in `status: "pending-review"` and are NOT served on `attach()`.
- [ ] Review MCP tool — any agent with role `reviewer` can `brain_review(id, verdict)`.
- [ ] All rules tagged `#authored` (from AGENTS.md seed) skip the gate — they're canon by construction.

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
