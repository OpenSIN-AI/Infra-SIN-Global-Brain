# AGENTS.md — global-brain

## Purpose

This repository is the Persistent Code Plan Memory (PCPM) system — the single source of truth for all AI coding agent knowledge, plans, goals, and session history across every project.

## Rules for All Agents Working in This Repo

1. **Never modify brain data files directly.** Use the CLI (`node src/cli.js`) or the programmatic API (`src/index.js`) to read and write brain state. Direct JSON edits bypass the invalidation engine and break consistency.

2. **Never delete knowledge entries.** Entries are invalidated, never removed. Use the `invalidations` mechanism in memory updates to mark old knowledge as obsolete.

3. **Never overwrite plan revisions.** Plans are append-only versioned files (`revision-XXXX.json`). The `latest.json` symlink is managed by the plan engine. Never manually edit revision files.

4. **Always follow the current plan.** Before starting work on any project, load the active context via `node src/cli.js context` and follow the plan. Do not improvise or deviate without documenting the decision in a plan update.

5. **Never reuse forbidden strategies.** Check the memory's `forbidden` entries before proposing a solution. If a strategy is forbidden, it was forbidden for a reason.

6. **Extract knowledge after every session.** Use `node src/cli.js extract-knowledge` to retrospectively extract structured knowledge from session transcripts. This is how the brain learns from ad-hoc conversations.

7. **Sync bidirectionally.** After modifying brain state, run `node src/cli.js sync` to push changes to project `.pcpm/` directories and pull back any new project-local knowledge.

8. **Run tests before committing.** `npm test` must pass (10/10 tests) before any commit to this repo.

## Architecture Quick Reference

- `src/lib/storage.js` — JSON/JSONL I/O, ID generation, deduplication
- `src/lib/layout.js` — Directory structure and path resolution
- `src/engines/goal-engine.js` — Goal CRUD with history
- `src/engines/plan-engine.js` — Versioned plans with step/decision/issue tracking
- `src/engines/memory-engine.js` — Knowledge store with automatic invalidation
- `src/engines/session-engine.js` — Append-only session logs and summaries
- `src/engines/context-engine.js` — Active context builder for prompt injection
- `src/engines/control-engine.js` — Execution validation and forbidden strategy checks
- `src/engines/opencode-runner.js` — OpenCode CLI subprocess wrapper
- `src/engines/reflection-engine.js` — Post-execution LLM reflection
- `src/engines/sync-engine.js` — One-way push (global brain → project .pcpm/)
- `src/engines/bidi-sync-engine.js` — Bidirectional sync (global ↔ project)
- `src/engines/transcript-engine.js` — LLM-powered transcript-to-knowledge extraction
- `src/engines/hook-engine.js` — OpenCode beforeRun/afterRun hook generator
- `src/engines/orchestrator-engine.js` — Central closed-loop orchestration
- `src/mcp/sin-brain-server.mjs` — MCP server for rule management and brain sync
- `src/mcp/preview-server.mjs` — MCP server for opening images in macOS Preview

## LLM Interface

All LLM calls go through `opencode run --format json --fallback opencode/minimax-m2.5-free`. No direct API calls. The `OpenCodeRunner` class in `src/engines/opencode-runner.js` handles subprocess management, timeout, and JSON extraction.

## Data Flow

```
User task
  → Goal engine (load/create goal)
  → Plan engine (load latest plan)
  → Memory engine (load merged knowledge)
  → Context engine (build active context)
  → OpenCode runner (execute task with context)
  → Control engine (validate result, check forbidden)
  → Plan engine (save new revision)
  → Memory engine (apply knowledge updates + invalidations)
  → Reflection engine (post-execution LLM reflection)
  → Session engine (save transcript + summary)
  → Sync engine (push to project .pcpm/)
```

## MCP Servers

This repository provides two MCP servers that agents can connect to for real-time brain interaction:

### sin-brain MCP (`src/mcp/sin-brain-server.mjs`)
Provides tools for agents to manage rules and sync knowledge without manual CLI calls.

| Tool | Description |
|------|-------------|
| `add_rule` | Add a rule to global AGENTS.md and/or local .pcpm/ |
| `sync_brain` | Run bidirectional sync between local and global brain |
| `open_image_in_preview` | Open an image file in macOS Preview.app |
| `list_global_rules` | List all rules currently in the global brain |

### preview MCP (`src/mcp/preview-server.mjs`)
Dedicated MCP server for opening images in macOS Preview. Agents MUST use this whenever they create screenshots or visual artifacts — never tell users to "look in /tmp".

| Tool | Description |
|------|-------------|
| `open_in_preview` | Opens an image file in Preview.app with validation |

## CLI Commands (Extended)

| Command | Description |
|---------|-------------|
| `add-rule --text <rule> [--priority <n>] [--scope global\|project\|both]` | Add a rule to global brain and/or local .pcpm |
| `sync-chat-turn` | Auto-sync trigger — runs silently after each chat turn to check for unwritten rules |

---

## 🧠 OpenSIN-Neural-Bus Integration (JetStream Message Bus)

Das **OpenSIN-Neural-Bus** System (`https://github.com/OpenSIN-AI/OpenSIN-Neural-Bus`) ist der zentrale JetStream-basierte Message Bus für die gesamte OpenSIN-Agenten-Flotte. Es verbindet alle A2A-Agenten, OpenCode-Runtimes und das Global Brain über ein einheitliches Event-System.

### Neural-Bus im Global Brain Kontext

| Komponente | Zweck | Verbindung zu Global Brain |
|------------|-------|---------------------------|
| `OpenCodeJetStreamClient` | NATS/JetStream Client für OpenCode | Sendet Agent-Events an das Brain |
| `OpenSinAgentRuntime` | Agent Runtime Wrapper | Veröffentlicht Lessons Learned, Observations, Capabilities |
| `SUBJECTS` | Subject Taxonomy (workflow.request, workflow.reply, etc.) | Definiert die Event-Sprache des Brains |
| `createEventEnvelope` | Validierte Event-Envelopes | Garantiert strukturierte Brain-Updates |
| `Ouroboros Bridge` | `rememberLesson()` + `registerCapability()` | Direkter Schreibzugriff auf Brain-Memory |

### Core Architecture

```
OpenCode CLI / Agent Runtime
  ↓
OpenSinAgentRuntime (agentId, sessionId, bus)
  ↓
JetStream (nats://127.0.0.1:4222)
  ↓
Subjects: workflow.request, workflow.reply, agent.observation, agent.lesson
  ↓
Ouroboros Bridge → rememberLesson() / registerCapability()
  ↓
Global Brain (.pcpm/ → AGENTS.md → knowledge graph)
```

### Wichtige Patterns

**1. Durable Consumer (Restart Recovery):**
```ts
const worker = await runtime.consumeAssignedWork({
  subject: SUBJECTS.workflowRequest,
  stream: "OPENSIN_WORKFLOW_EVENTS",
  durableName: "issue-8-worker",  // Gleicher Name = Resume nach Restart
  deliverPolicy: "all",
  ackWaitMs: 500,
}, async (event) => { /* work */ });
```

**2. Lesson Publishing ins Brain:**
```ts
await runtime.publishLessonLearned({
  context: "JetStream reconnect handling",
  lesson: "Reuse the same durable consumer name so restart recovery is automatic.",
  successRate: 1.0,
});
// → Automatisch via Ouroboros Bridge ins Global Brain geschrieben
```

**3. Request/Reply Pattern:**
```ts
const server = await bus.serveRequests(SUBJECTS.workflowRequest, async (request) => {
  return createEventEnvelope({ kind: "workflow.reply", ... });
});
```

### Neural-Bus Subject Taxonomy

Alle Subjects sind in `docs/jetstream-subject-taxonomy.md` im Neural-Bus Repo dokumentiert. Die wichtigsten:

| Subject | Richtung | Zweck |
|---------|----------|-------|
| `workflow.request` | Client → Server | Arbeitsanfrage an Agent |
| `workflow.reply` | Server → Client | Antwort/Ergebnis |
| `agent.observation` | Agent → Brain | Zustandsmeldung (boot, error, done) |
| `agent.lesson` | Agent → Brain | Gelernte Lektion (wird ins Memory geschrieben) |
| `agent.capability` | Agent → Brain | Neue Fähigkeit registriert |

### Docker Local Verification
```bash
cd ~/dev/OpenSIN-Neural-Bus
docker compose up -d nats
npm install && npm test
```

---

## Parallel Exploration Mandate (PRIORITY -4.5)

Bei Codebase-Analyse auf grossen Projekten MUESSEN Agenten **5-10 parallele explore + 5-10 librarian-Agenten** starten. Ein einzelner Agent liefert nur ~20% Abdeckung.

```
task(subagent_type="explore", run_in_background=true, load_skills=[], description="Find APIs", prompt="[CONTEXT]: Grosse Codebase. [GOAL]: Alle API-Endpunkte. [REQUEST]: Dateipfade + Beschreibung.")
task(subagent_type="explore", run_in_background=true, load_skills=[], description="Find Services", prompt="[CONTEXT]: Grosse Codebase. [GOAL]: Alle Services. [REQUEST]: Dateipfade + Methoden + Dependencies.")
// ... 5-10 weitere parallele Agenten
```

Siehe [Agent Configuration Guide](https://github.com/OpenSIN-AI/OpenSIN-documentation/blob/main/docs/guide/agent-configuration.md) fuer vollstaendige Dokumentation.

---

## Agent Configuration System (v5)

Alle Agenten-Modelle werden durch ein mehrstufiges Konfigurationssystem verwaltet:

| Datei | Zweck |
|:---|:---|
| `opencode.json` | Haupt-Config (Provider, Modelle, MCPs, Agenten, Commands) |
| `oh-my-openagent.json` | Subagenten-Modelle (explore, librarian, oracle, etc.) |
| `oh-my-sin.json` | Zentrales A2A Team Register |
| `my-sin-team-code.json` | Team Coding Agenten + Modelle |
| `my-sin-team-worker.json` | Team Worker Agenten + Modelle |
| `my-sin-team-infrastructure.json` | Team Infra Agenten + Modelle |

Nach jeder Aenderung MUSS `sin-sync` ausgefuehrt werden.

