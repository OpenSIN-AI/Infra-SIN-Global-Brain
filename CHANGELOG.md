## [unreleased]

### 🚀 Features

- Complete PCPM system with Phase 1 foundation + Phase 2 features
- V3 — invalidation engine, knowledge graph, conflict resolution, score/drift tracking
- DPMA v4 — Meta-Learning, GraphRAG integration, OpenCode Hooks
- Record canonical create-flow runtime rule
- Sin-brain CLI/MCP, Preview MCP, Auto-Sync Hook, Neural-Bus integration
- Fill local brain (.pcpm) with complete knowledge, plan, and context
- Add A2A-SIN Agent Capability & Routing Registry (PRIORITY -9.0) — automatic delegation for all agents
- Add Box Storage default rule to .pcpm/rules.md (priority 00)
- Replace static agent registry with dynamic discovery engine (PRIORITY -9.0) — auto-scans all repos, builds byTrigger/byCapability indexes, never stale
- Document Box Storage migration as completed solution (sol-box-storage-migration)
- Update agent registry with A2A-SIN-MiroFish (prediction/simulation agent)
- Add Cloudflare Pages SPA routing rules and wrangler deploy knowledge (opensin-websites-fixed)
- Neue Regeln für Chrome Password Manager und Credentials-Auto-Save
- Session summary aktualisiert mit neuer Arbeit
- Add GitHub PAT for OpenSIN-AI GHCR
- Add Cloudflare cache issue documentation with zone ID
- Box.com CORS Aktivierung Anleitung + Chrome Password Manager Integration
- Add repo audit results with all created issues
- Comprehensive OpenSIN repo audit + SSOT sync plan
- Add a2a.delqhi.com → chat.opensin.ai migration status + final audit numbers
- Discord infrastructure audit findings
- REPO SYNC COMPLETE — all 12 repos updated with SSOT refs
- Add full Discord infrastructure audit status
- _(global-brain)_ Phase IV Langzeitgedächtnis - Phase 1 implementation
- _(global-brain)_ Add MAGMA dimension taxonomy to graph edges
- _(global-brain)_ Phase 2 MAGMA - Embedding generation and dimensioned graph
- _(global-brain)_ Phase 2 MAGMA - GraphRAG engine and integration
- Add System Directive Watcher with WORK STOP BRAIN CHECK

### 🐛 Bug Fixes

- _(hook-engine)_ Stop polluting native opencode.json
- BrainRepoPath now correctly points to global-brain root instead of cwd
- Clear stale directive watcher pid locks

### 💼 Other

- OH-MY-OPENCODE compaction shows stale TODO context
- Docker-Empire README 26→25 containers gefixt
- Add Vercel deploy token
- Add model upgrade rule 2026-04-16
- Add OCI VM disk-full prevention knowledge to global-brain
- Add repo-governance and pr-watcher

### 📚 Documentation

- Add universal agent initialization prompt to README
- Enforce BUN-ONLY package manager mandate
- Add agent configuration documentation and parallel exploration mandate
- Npm -> bun in README test section
- Add MAGMA GraphRAG documentation

### ⚙️ Miscellaneous Tasks

- Add CRITICAL rule — NO GitHub Actions CI/CD, use A2A-SIN-GitHub-Action + n8n only (priority -10.0)
- Add Box Storage Mandate to Global Brain configuration
- Ensure A2A-SIN-MiroFish in agent registry after addition
