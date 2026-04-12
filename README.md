# global-brain

Persistent Code Plan Memory (PCPM) for AI coding agents. A cross-project knowledge store, versioned plan tracker, session logger, and context injector that prevents agents from forgetting, repeating mistakes, or working without a plan.

## What It Does

AI coding agents (via OpenCode CLI) lose all context between sessions. They forget decisions, repeat mistakes, revert to failed strategies, and improvise instead of following plans. **global-brain** fixes this by providing:

- **Persistent goals** with history tracking
- **Versioned plans** (immutable revisions, step/decision/issue tracking)
- **Structured memory** (facts, decisions, mistakes, solutions, rules, forbidden entries) with automatic invalidation
- **Session logging** (append-only JSONL transcripts + derived summaries)
- **Active context injection** (goal + plan + memory + session assembled for prompt injection)
- **Transcript-to-knowledge extraction** (LLM-powered retrospective analysis of conversation transcripts)
- **Bidirectional sync** (global brain ↔ project `.pcpm/` directories)
- **OpenCode hook integration** (automatic beforeRun/afterRun hooks for seamless operation)

## Architecture

```
global-brain/                    # This repo — the single source of truth
├── brain/
│   ├── global/                  # Cross-project knowledge + session aggregates
│   │   ├── knowledge.json       # Global knowledge store (rules, solutions)
│   │   └── session-summary.json # Aggregate of all project sessions
│   └── projects/
│       └── <project-id>/        # Per-project state
│           ├── goals/           # Goal definitions with history
│           ├── plans/           # Versioned plan revisions (immutable)
│           ├── memory/          # Project-scoped knowledge store
│           ├── sessions/        # Raw JSONL logs + derived summaries
│           └── context/         # Generated active context snapshots
│
└── .pcpm/                       # Synced into each project repo
    ├── active-context.json      # Latest context for agent consumption
    ├── knowledge-summary.json   # Merged knowledge (global + project)
    ├── plan/latest.json         # Current plan snapshot
    └── sessions/latest-summary.json
```

## Quick Start

```bash
# Clone the brain repo
git clone https://github.com/Delqhi/global-brain.git
cd global-brain

# Initialize a project
node src/cli.js init --project my-app

# Get active context (for prompt injection)
node src/cli.js context \
  --project my-app \
  --goal-id build-auth \
  --description "Build the authentication system"

# Run a full orchestration cycle (dry-run, no LLM)
node src/cli.js orchestrate \
  --project my-app \
  --goal-id build-auth \
  --description "Build the authentication system" \
  --task "Implement JWT token validation" \
  --dry-run --skip-reflection

# Extract knowledge from a session transcript
node src/cli.js extract-knowledge \
  --project my-app \
  --session session-001 \
  --dry-run

# Bidirectional sync with a project repo
node src/cli.js sync \
  --project my-app \
  --project-root /path/to/my-app

# Set up automatic OpenCode hooks in a project
node src/cli.js setup-hooks \
  --project my-app \
  --project-root /path/to/my-app \
  --goal-id build-auth \
  --description "Build the authentication system" \
  --agents-directive
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `help` | List all available commands |
| `init --project <id>` | Initialize project directories in the brain |
| `log-message --project <id> --session <id> --role <role> --text <msg>` | Append a message to a session transcript |
| `context --project <id> --goal-id <id> --description <desc>` | Build and print the active context |
| `orchestrate --project <id> --goal-id <id> --description <desc> --task <task>` | Full orchestration cycle |
| `extract-knowledge --project <id> --session <id>` | Extract structured knowledge from a transcript via LLM |
| `sync --project <id> --project-root <path>` | Bidirectional sync between brain and project `.pcpm/` |
| `setup-hooks --project-root <path> --project <id>` | Generate OpenCode beforeRun/afterRun hook scripts |

## Knowledge Types

| Type | Scope | Purpose |
|------|-------|---------|
| `fact` | project | Concrete technical facts discovered during work |
| `decision` | project | Architectural or strategic decisions with rationale |
| `mistake` | project | Errors, wrong approaches, dead ends to avoid |
| `solution` | global | Working fixes and successful approaches |
| `rule` | global | Stable cross-project rules |
| `forbidden` | project | Strategies that must never be reused |

## Invalidation Engine

When new knowledge contradicts old knowledge, the memory engine automatically marks old entries as `invalidated`. This prevents agents from acting on stale information.

Invalidation can happen via:
- **Explicit invalidations** in a memory update (`matchText`, `matchId`, `matchTopic`)
- **Topic replacement** (a new decision on the same topic invalidates the old one)
- **Entry-driven invalidation** (an entry's `invalidates` array targets specific old entries)

## OpenCode Integration

The hook engine generates shell scripts that integrate with OpenCode's hook system:

- **beforeRun**: Loads the active context (goal, plan, memory, session) and injects it into the agent's prompt
- **afterRun**: Extracts knowledge from the completed session transcript and syncs the project brain

After running `setup-hooks`, the generated scripts appear in `<project>/.opencode/hooks/`.

## Testing

```bash
npm test
```

Runs all tests via `node --test test/*.test.js`. Tests cover plan versioning, orchestration, transcript extraction, bidirectional sync, and hook generation.

## Programmatic API

```javascript
import {
  createRepositoryLayout,
  runOrchestration,
  extractKnowledgeFromMessages,
  bidirectionalSync,
  setupProjectHooks,
  loadMergedKnowledge,
  applyMemoryUpdate
} from "global-brain";
```

## Design Principles

1. **Git-native**: All state is JSON files in a Git repo. Sync across devices via `git pull/push`.
2. **No external dependencies**: Pure Node.js ESM, no npm packages required at runtime.
3. **LLM-agnostic**: Uses OpenCode CLI (`opencode run --format json`) as the only LLM interface.
4. **Append-only sessions**: Raw transcripts are JSONL append-only logs. Nothing is ever deleted.
5. **Immutable plan revisions**: Every plan change creates a new revision file. Full history preserved.
6. **Fail-safe memory**: Knowledge entries are never deleted, only marked as `invalidated`.
