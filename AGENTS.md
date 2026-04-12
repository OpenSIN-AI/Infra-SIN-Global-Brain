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
