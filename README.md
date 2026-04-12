# global-brain

Persistent Code Plan Memory (PCPM) v3 for AI coding agents. A cross-project knowledge store, versioned plan tracker, session logger, and context injector that prevents agents from forgetting, repeating mistakes, or working without a plan.

> **v3** adds a full knowledge graph, score/drift tracking, automatic invalidation derivation, timestamp-based conflict resolution, and quality-scored reflections.

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
- **Knowledge graph** (JSON graph tracking how entries relate: invalidates, supports, extends, contradicts)
- **Score/drift tracking** (entries decay over time; `fresh` → `watch` → `stale` → auto-invalidation)
- **Conflict resolution** (timestamp-based winner selection during bidirectional sync)
- **Quality-scored reflections** (0–1 quality score + concrete improvement suggestions per session)
- **Meta-Learning & Strategy Scoring** (Scores strategies based on outcomes across sessions)
- **Hybrid GraphRAG integration** (Scripts to import Microsoft GraphRAG outputs into the agent brain)

## 🤖 Universal Agent Initialization (Copy & Paste)

Whenever you start working with an AI Agent in a **new project**, you must connect the project to the Global-Brain first. Paste the following universal instruction directly into your prompt to force the agent to set up its memory correctly. 

**Why it works:** It uses dynamic variables (`$PWD` and `basename`) so you don't even have to change the project name—it works instantly in any folder. The prompt explains the concept of "amnesia" to the LLM, ensuring it treats this task with the highest priority.

```markdown
🚨 OBERSTE PRIORITÄT: GLOBAL-BRAIN INITIALISIERUNG 🚨

Bevor du mit der eigentlichen Aufgabe beginnst oder Code schreibst, MUSST du dieses Projekt an unser "Global-Brain" (DPMA v4) ankoppeln. 

**WARUM DU DAS TUN MUSST:**
Du bist Teil einer Agenten-Flotte. Ohne diese Ankopplung leidest du an Amnesie: Du wirst nach dieser Session alles vergessen, alte Bugs wiederholen und unsere globalen Architektur-Regeln ignorieren. Durch die Ankopplung erhältst du sofortigen Zugriff auf das "Hive Mind" – das globale Wissen aller anderen Agenten sowie das lokale Langzeitgedächtnis dieses spezifischen Projekts. 

**DEINE AUFGABE (SOFORT AUSFÜHREN):**
Führe den folgenden Befehl im Terminal (im Root-Verzeichnis dieses Projekts) aus. Der Befehl installiert die notwendigen OpenCode-Hooks und verbindet das Projekt mit dem Global-Brain.

\`\`\`bash
node /Users/jeremy/dev/global-brain/src/cli.js setup-hooks \
  --project $(basename "$PWD") \
  --project-root "$PWD" \
  --agents-directive
\`\`\`

**ERWARTETES ERGEBNIS:**
1. Der Befehl erstellt eine `.opencode/opencode.json` mit `beforeRun` und `afterRun` Hooks.
2. Es wird eine initiales `.pcpm/` (Persistent Code Plan Memory) Setup erzeugt.
3. Ab dem nächsten Run wird dein System-Prompt automatisch mit dem kollektiven Gedächtnis und den Projekt-Plänen angereichert.

**REGEL:** 
Führe diesen Terminal-Befehl aus. Bestätige mir kurz, dass die Hooks erfolgreich registriert wurden, und beginne ERST DANACH mit der eigentlichen Aufgabe, die ich dir gestellt habe.
```

## Architecture

```
global-brain/                    # This repo — the single source of truth
├── brain/
│   ├── global/                  # Cross-project knowledge + session aggregates
│   │   ├── knowledge.json       # Global knowledge store (rules, solutions)
│   │   ├── knowledge-graph.json # v3: global knowledge graph (nodes + edges)
│   │   ├── meta-scores.json     # v4: Strategy scoring across runs
│   │   └── session-summary.json # Aggregate of all project sessions
│   └── projects/
│       └── <project-id>/        # Per-project state
│           ├── goals/           # Goal definitions with history
│           ├── plans/           # Versioned plan revisions (immutable)
│           ├── memory/          # Project-scoped knowledge store
│           │   └── knowledge-graph.json  # v3: project knowledge graph
│           ├── sessions/        # Raw JSONL logs + derived summaries
│           └── context/         # Generated active context snapshots
│               └── sync-conflicts.json  # v3: conflict reports from sync
│
└── .pcpm/                       # Synced into each project repo
    ├── active-context.json      # Latest context for agent consumption
    ├── knowledge-summary.json   # Merged knowledge (global + project)
    ├── plan/latest.json         # Current plan snapshot
    ├── sessions/latest-summary.json
    └── sync-conflicts.json      # v3: conflict reports (mirrored)
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

## Invalidation Engine (v3)

When new knowledge contradicts old knowledge, the memory engine automatically marks old entries as `invalidated`. This prevents agents from acting on stale information.

Invalidation can happen via:
- **Explicit invalidations** in a memory update (`matchText`, `matchId`, `matchTopic`)
- **Topic replacement** (a new decision on the same topic supersedes the old one)
- **Entry-driven invalidation** (an entry's `invalidates` array targets specific old entries by id or text)
- **Auto-invalidation derivation** — the engine inspects new forbidden/mistake entries and marks any older same-topic entry as automatically invalidated, creating a `invalidates` edge in the knowledge graph

## Knowledge Graph (v3)

Every knowledge entry is a **node** in a JSON graph. When entries are created or invalidated, the engine writes **directed edges** between them:

| Relation | Meaning |
|----------|---------|
| `invalidates` | This entry supersedes / voids the target |
| `supports` | This entry confirms or reinforces the target |
| `extends` | This entry builds on the target |
| `contradicts` | This entry disagrees with the target |
| `conflicts_with` | Detected during sync; winner selected by `updatedAt` |

Graph files live at:
- `brain/global/knowledge-graph.json` — global graph
- `brain/projects/<id>/memory/knowledge-graph.json` — project graph

CLI / API summary:

```javascript
import { getRelatedKnowledge, summarizeKnowledgeGraph } from "global-brain";

const related = getRelatedKnowledge(graph, entryId);        // edges for one node
const summary = summarizeKnowledgeGraph(graph);             // { nodes, edges, relations: {...} }
```

## Score & Drift Tracking (v3)

Every knowledge entry carries a numeric **score** (0–1) that decays over time based on age:

| Age | Score range | Drift status |
|-----|-------------|--------------|
| < 14 days | ≥ 0.7 | `fresh` |
| 14–30 days | 0.4–0.69 | `watch` |
| > 30 days | < 0.4 | `stale` |

Entries with status `watch` or `stale` appear in the **drifting** section of the active context so agents are aware of potentially outdated knowledge. Entries that drop below 0.2 are candidates for auto-invalidation on the next `loadMergedKnowledge` call.

The `forbidden` list in the context is ordered by score (highest first) so the most relevant prohibitions appear at the top.

## Conflict Resolution (v3)

During bidirectional sync, when a knowledge entry exists in both the global brain and the project `.pcpm/`, the engine compares `updatedAt` timestamps:

- **Incoming wins** if its `updatedAt` is strictly newer → global entry is overwritten
- **Existing wins** on ties → no change
- All conflicts are written to both `brain/projects/<id>/context/sync-conflicts.json` and `.pcpm/sync-conflicts.json` for audit

After conflict resolution the knowledge graph is updated with a `conflicts_with` edge between the two versions.

## Reflections (v3)

Each orchestration cycle ends with a structured reflection:

```json
{
  "qualityScore": 0.82,
  "suggestions": ["Add more granular step tracking", "Log decision rationale"],
  "summary": "Session completed successfully. JWT endpoint implemented.",
  "newMemoryEntries": [...]
}
```

`qualityScore` (0–1) is derived from:
- Presence of explicit decisions logged
- Absence of failure signals (`error`, `failed`, `reverted`) in the result
- Number of new memory entries produced

The score and suggestions are stored in the session summary for trend analysis across sessions.

## Meta-Learning & Scoring (v4)

The Orchestrator automatically calls the `MetaLearningEngine` at the end of each session to evaluate the active strategy.
Strategies are scored based on execution success (`qualityScore` > 0.8 yields `success` -> 1.0, otherwise partial -> 0.6). Over time, `brain/global/meta-scores.json` builds a historical record of which strategies actually work, allowing agents to query `getBestStrategy(goalType)` to pick the most reliable approach for future goals.

## Hybrid GraphRAG Integration (v4)

PCPM supports importing static code insights generated by **Microsoft GraphRAG**. 
While GraphRAG indexes a huge codebase into static Parquet/JSON files, the global-brain takes that output and transforms it into live, actionable Agent Memory (invalidations, strategy relations, facts).

To use:
1. Run Microsoft GraphRAG on your target repo: `python -m graphrag.index --root .`
2. Export the parquet output to JSON
3. Run `node scripts/import-graphrag.js` to ingest entities and relationships into the PCPM knowledge graph.

## OpenCode Integration

The hook engine generates shell scripts that integrate with OpenCode's hook system:

- **beforeRun**: Loads the active context (goal, plan, memory, session) and injects it into the agent's prompt
- **afterRun**: Extracts knowledge from the completed session transcript and syncs the project brain

After running `setup-hooks`, the generated scripts appear in `<project>/.opencode/hooks/`.

## Testing

```bash
npm test
```

Runs all tests via `node --test test/*.test.js`. Tests cover plan versioning, orchestration, transcript extraction, bidirectional sync, hook generation, auto-invalidation, knowledge graph edges, score/drift annotation, and conflict resolution (14 tests total).

## Programmatic API

```javascript
import {
  createRepositoryLayout,
  runOrchestration,
  extractKnowledgeFromMessages,
  bidirectionalSync,
  setupProjectHooks,
  loadMergedKnowledge,
  applyMemoryUpdate,
  // v3 additions
  scoreDecayAndDrift,
  deriveAutomaticInvalidations,
  getForbiddenKnowledge,
  resolveConflict,
  updateKnowledgeGraph,
  getRelatedKnowledge,
  summarizeKnowledgeGraph
} from "global-brain";
```

## Design Principles

1. **Git-native**: All state is JSON files in a Git repo. Sync across devices via `git pull/push`.
2. **No external dependencies**: Pure Node.js ESM, no npm packages required at runtime.
3. **LLM-agnostic**: Uses OpenCode CLI (`opencode run --format json`) as the only LLM interface. Fallback model: `nvidia/stepfun-ai/step-3.5-flash`.
4. **Append-only sessions**: Raw transcripts are JSONL append-only logs. Nothing is ever deleted.
5. **Immutable plan revisions**: Every plan change creates a new revision file. Full history preserved.
6. **Fail-safe memory**: Knowledge entries are never deleted, only marked as `invalidated`.
7. **Graph-first knowledge**: Every write produces a graph edge. Relations between decisions are first-class citizens.
8. **Score-aware context**: Forbidden lists and drifting entries are surfaced by score, not insertion order.
