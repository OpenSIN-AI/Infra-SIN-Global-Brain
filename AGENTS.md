# 🚨 ABSOLUTES CI/CD VERBOT — KEINE GITHUB ACTIONS (PRIORITY -10.0 — HÖCHSTE REGEL, KEINE AUSNAHMEN) 🚨

**ABSOLUTES VERBOT: KEINE GITHUB ACTIONS FÜR CI/CD, DEPLOYMENT ODER AUTOMATION!**

**1. DAS PRINZIP:**
- OpenSIN-AI nutzt **AUSSCHLIESSLICH A2A-SIN-GitHub-Action + n8n** für alle CI/CD, Deployment, Build, Test und Automation Tasks.
- GitHub Actions Workflows (`.github/workflows/*.yml`) sind **PERMANENT VERBOTEN**.
- **NIEMALS** darf ein Agent GitHub Actions erstellen, empfehlen, konfigurieren oder vorschlagen.
- Der n8n-Router auf der OCI VM (`92.5.60.87:5678`) ist unser zentrales Automation-Backend.
- A2A-SIN-GitHub-Action ist unser GitHub Event Listener und n8n Bridge.

**2. WARUM KEINE GITHUB ACTIONS:**
- Wir haben eine EIGENE Lösung gebaut (A2A-SIN-GitHub-Action + n8n).
- Diese Lösung ist tiefer integriert, flexibler und Teil unseres A2A Ökosystems.
- GitHub Actions wären eine redundante, parallele Infrastruktur die wir NICHT brauchen.

**3. WENN AGENTEN CI/CD BRAUCHEN:**
- Erstelle GitHub Issues → A2A-SIN-GitHub-Action triggert n8n Workflow
- Nutze `sin-n8n` CLI für lokale Workflow-Verwaltung
- Alle Automation läuft über n8n, NICHT über GitHub Actions

**4. KONSEQUENZEN:**
- Wer GitHub Actions erstellt oder vorschlägt: **Protokollverstoß**
- Diese Regel steht HIER und im Global Brain `.pcpm/rules.md` — sie ist UNÜBERSEHBAR

---

# 🚨 BOX STORAGE MANDATE (PRIORITY 00) 🚨

**ZWINGEND FÜR ALLE AGENTEN:** Alle Logs, Screenshots, Videos, Reports und Debug-Artefakte werden NICHT mehr lokal gespeichert, sondern automatisch in **Box.com** hochgeladen via `A2A-SIN-Box-Storage` API (room-09).

> **Migration abgeschlossen:** GitLab LogCenter ist deprecated. GitLab-Konto wurde gesperrt (zu viele Dateien). Box.com (10 GB free) ist der neue Standard.

**Architektur:**
- Zentraler Service: `room-09-box-storage` (A2A-SIN-Box-Storage)
- Box-Ordner: `/Public` für öffentliche Dateien, `/Cache` für Logs/Temp
- Jeder Upload erhält: `file.id`, `cdnUrl`, `publicUrl`
- Unbegrenzter Speicher durch automatische neue Volumes bei 9GB

**Pflicht-Nutzung:**
- Verwende `BOX_STORAGE_API_KEY` für Uploads
- Nutze die Python API aus `~/.config/opencode/AGENTS.md` oder `scripts/box_storage.py`
- KEINE lokalen Dateien — nur `/tmp/` als Zwischenspeicher (max 1h)
- SOFORT uploaden nach Erstellung (Screenshots, Logs, Crash-Dumps)

**Migration von GitLab LogCenter:**
- `gitlab_logcenter.py` ist deprecated → entferne alle Importe
- Bestehende Logs in Box.com `/Cache` migrieren via `scripts/migrate_gitlab_to_box.py`
- Alle Agents müssen auf `A2A-SIN-Box-Storage` umgestellt sein bis 2026-05-01

**Bekannte Issues:**
- Box.com API Token läuft nach 60 Min ab → JWT App für Production nötig
- Rate Limit Free Tier: 10k API calls/day → bei Erschöpfung: Premium Upgrade
- Uploads >2GB blockieren → Fragmentierung in Chunks geplant für v1.1

---

# 🚨 A2A-SIN AGENT CAPABILITY & ROUTING REGISTRY (PRIORITY -9.0) 🚨

**DAS PRINZIP: JEDER AGENT MUSS SOFORT WISSEN — WELCHER A2A-SIN AGENT IST FÜR WAS ZUSTÄNDIG!**

**ABSOLUTES VERBOT: Kein Agent darf Aufgaben ALLEINE lösen wenn es dafür einen spezialisierten A2A-SIN-Agenten gibt!**

**REGEL:** Wenn der User eine Aufgabe nennt, MUSS der Agent SOFORT analysieren:
1. Welche A2A-SIN-Agenten sind dafür zuständig?
2. Welche Aufgaben können PARALLEL delegiert werden?
3. Welche Aufgaben müssen NACHEINANDER laufen?
4. Welche Teams müssen involviert werden?

**NIEMALS** soll der User extra sagen müssen "nutz A2A-SIN-X für Y". Das muss AUTOMATISCH passieren!

---

## A2A-SIN AGENT REGISTRY — KATEGORIE 1: STORAGE & CREDENTIALS

| Trigger | Delegiere an | Zweck |
|---------|-------------|-------|
| Passwörter, Credentials, Secrets speichern/lesen | **A2A-SIN-PasswordManager** | Zentrale Passwortverwaltung für alle Agenten |
| Dateien, Logs, Screenshots speichern | **A2A-SIN-Storage** | Zentrale Dateiablage |
| Box.com Upload/Download | **A2A-SIN-Box-Storage** | Cloud Storage via Box.com |

## A2A-SIN AGENT REGISTRY — KATEGORIE 2: GOOGLE ECOSYSTEM

| Trigger | Delegiere an | Zweck |
|---------|-------------|-------|
| Google Docs (lesen, schreiben, bearbeiten, Tabs) | **A2A-SIN-Google-Apps** | ALLE Google Docs Operationen |
| Google Sheets (Tabellen, Daten, Enterprise-Sheets) | **A2A-SIN-Google-Apps** | ALLE Google Sheets Operationen |
| Google Drive, Google Calendar, Google Chat | **A2A-SIN-Google-Apps** | ALLE Google Workspace Services |
| Google Admin Console, Domain-Wide Delegation | **Team-SIN-Google** | Workspace Admin Tasks |

## A2A-SIN AGENT REGISTRY — KATEGORIE 3: APPLE ECOSYSTEM

| Trigger | Delegiere an | Zweck |
|---------|-------------|-------|
| Apple Mail, Kalender, Kontakte | **A2A-SIN-Apple-Mail** | Apple Mail + Calendar + Contacts |
| Apple Notes, Reminders, Notifications | **A2A-SIN-Apple-Notes** | Notes + Reminders + Notifications |
| Apple FaceTime, iMessage, SMS | **A2A-SIN-Apple-FaceTime** | FaceTime + Messages |
| Apple Photos, Files, Safari | **A2A-SIN-Apple-Photos-Files** | Photos + Files + Safari |
| Apple Shortcuts, SystemSettings, DeviceControl | **A2A-SIN-Apple-Shortcuts** | Shortcuts + Settings + Device |
| Apple Mobile (iOS Geräte) | **A2A-SIN-Apple-Mobile** | iOS Device Management |
| **ALLE Apple Tasks gesamt** | **Team-SIN-Apple** | Apple Ecosystem Orchestrierung |

## A2A-SIN AGENT REGISTRY — KATEGORIE 4: MESSAGING & KOMMUNIKATION

| Trigger | Delegiere an | Zweck |
|---------|-------------|-------|
| Telegram Bot erstellen, steuern, deployen | **A2A-SIN-Telegram** | Telegram Automation |
| WhatsApp Nachrichten, Gruppen, Business | **A2A-SIN-WhatsApp** | WhatsApp Automation |
| Signal Nachrichten | **A2A-SIN-Signal** | Signal Messenger |
| Discord Bot, Server, Channels | **A2A-SIN-Discord** | Discord Automation |
| Slack, Teams, Chatroom | **A2A-SIN-Teams** | Microsoft Teams + Chat |
| Email senden, empfangen, verwalten | **A2A-SIN-Email** | Email Automation |
| LINE Messenger | **A2A-SIN-LINE** | LINE Automation |
| WeChat Nachrichten | **A2A-SIN-WeChat** | WeChat Automation |
| Beeper (Universal Messenger) | **A2A-SIN-Beeper** | Multi-Platform Messaging |
| BlueBubbles (iMessage Bridge) | **A2A-SIN-BlueBubbles** | iMessage via Android Bridge |
| Matrix Chat | **A2A-SIN-Matrix** | Matrix Protocol |
| IRC Chat | **A2A-SIN-IRC** | IRC Protocol |
| **ALLE Messaging Tasks gesamt** | **Team-SIN-Messaging** | Messaging Orchestrierung |

## A2A-SIN AGENT REGISTRY — KATEGORIE 5: SOCIAL MEDIA & PLATTFORMEN

| Trigger | Delegiere an | Zweck |
|---------|-------------|-------|
| Instagram Posts, Stories, DMs | **A2A-SIN-Instagram** | Instagram Automation |
| X/Twitter Posts, Threads, DMs | **A2A-SIN-X-Twitter** | Twitter/X Automation |
| TikTok Videos, Shop, Comments | **A2A-SIN-TikTok** | TikTok Automation |
| TikTok Shop Produkte, Bestellungen | **A2A-SIN-TikTok-Shop** | TikTok Commerce |
| LinkedIn Posts, Jobs, Networking | **A2A-SIN-LinkedIn** | LinkedIn Automation |
| Reddit Posts, Comments, Subreddits | **A2A-SIN-Reddit** | Reddit Automation |
| YouTube Videos, Channel, Analytics | **A2A-SIN-YouTube** | YouTube Automation |
| Facebook, WebChat | **A2A-SIN-WebChat** | Facebook/Web Chat |
| Medium Artikel, Publications | **A2A-SIN-Medium** | Medium Publishing |
| Dev.to Artikel, Tech Blog | **A2A-SIN-DevTo** | Dev.to Publishing |
| Product Hunt Launch | **A2A-SIN-ProductHunt** | Product Hunt Launch |
| HackerNews Posts, Comments | **A2A-SIN-HackerNews** | HackerNews |
| StackOverflow Fragen, Antworten | **A2A-SIN-StackOverflow** | StackOverflow |
| Quora Antworten, Fragen | **A2A-SIN-Quora** | Quora |
| IndieHackers Build in Public | **A2A-SIN-IndieHackers** | IndieHackers |
| Lobsters Tech Posts | **A2A-SIN-Lobsters** | Lobsters |
| Slashdot News | **A2A-SIN-Slashdot** | Slashdot |
| Nostr Posts, Relays | **A2A-SIN-Nostr** | Nostr Protocol |
| Feishu (Lark) | **A2A-SIN-Feishu** | Feishu/Lark |
| Mindrift Tasks | **A2A-SIN-Mindrift** | Mindrift Platform |
| **ALLE Social Media Tasks gesamt** | **Team-SIN-Social** | Social Media Orchestrierung |

## A2A-SIN AGENT REGISTRY — KATEGORIE 6: E-COMMERCE & SHOP

| Trigger | Delegiere an | Zweck |
|---------|-------------|-------|
| Stripe Produkte, Zahlungen, Subscriptions | **A2A-SIN-Stripe** | Payment Processing |
| Shop Finance, Buchhaltung, Steuern | **A2A-SIN-Shop-Finance** | Shop Finance |
| Shop Logistik, Versand, Lieferanten | **A2A-SIN-Shop-Logistic** | Shop Logistics |
| Steuern, Tax Compliance | **A2A-SIN-Tax** | Tax Management |
| Contracts, Verträge | **A2A-SIN-Contract** | Contract Management |
| **ALLE Shop/E-Commerce Tasks gesamt** | **Team-SIN-Commerce** | E-Commerce Orchestrierung |

## A2A-SIN AGENT REGISTRY — KATEGORIE 7: CODING & DEVOPS

| Trigger | Delegiere an | Zweck |
|---------|-------------|-------|
| Code schreiben, refactoren, reviewen | **Team-SIN-Code-Core** | Core Development |
| Backend APIs, Datenbanken, Services | **Team-SIN-Code-Backend** | Backend Development |
| Frontend UI, React, Next.js, Styling | **Team-SIN-Code-Frontend** | Frontend Development |
| DevOps, CI/CD, Docker, Deployments | **A2A-SIN-Code-DevOps** | DevOps Automation |
| Security Audits, Pentesting, Exploits | **A2A-SIN-Security-Audit** | Security Auditing |
| Code AI, ML Models, Data Science | **A2A-SIN-Code-AI** | AI/ML Development |
| GitHub Actions, PRs, Issues | **A2A-SIN-Github-Action** | GitHub Automation |
| N8N Workflows, Automation | **A2A-SIN-N8N** | n8n Workflow Management |
| GitLab Logs, CI | **A2A-SIN-Code-GitLab-LogsCenter** | GitLab Integration |

## A2A-SIN AGENT REGISTRY — KATEGORIE 8: BUSINESS & MARKETING

| Trigger | Delegiere an | Zweck |
|---------|-------------|-------|
| Blog Posts, Content Creation | **Biz-SIN-Blog-Posts** | Blog Content |
| Marketing Kampagnen, Ads | **Biz-SIN-Marketing** | Marketing Automation |
| Job Suche, Freelancer, Upwork | **Biz-SIN-Jobs** | Job Platform Automation |
| Competitor Analysis | **Biz-SIN-Competitor-Tracker** | Competitor Tracking |
| Patente, Claims | **Biz-SIN-Patents** | Patent Management |
| Blueprints, Architektur | **Biz-SIN-Blueprints** | Architecture Blueprints |
| Ledger, GitHub Showcase | **Biz-SIN-Ledger** | Achievement Ledger |
| **ALLE Business Tasks gesamt** | **Team-SIN-Forum** | Forum/Community |

## A2A-SIN AGENT REGISTRY — KATEGORIE 9: SECURITY SUITE

| Trigger | Delegiere an | Zweck |
|---------|-------------|-------|
| Security Audit, Pentest | **A2A-SIN-Security-Audit** | Security Auditing |
| Auth, OAuth, Tokens | **A2A-SIN-Security-Auth** | Authentication Security |
| Cloud Security, AWS, GCP | **A2A-SIN-Security-Cloud** | Cloud Security |
| Crypto, Blockchain Security | **A2A-SIN-Security-Crypto** | Crypto Security |
| Exploit Development | **A2A-SIN-Security-Exploit** | Exploit Development |
| Forensics, Incident Response | **A2A-SIN-Security-Forensics** | Digital Forensics |
| Fuzzing, Vulnerability Scanning | **A2A-SIN-Security-Fuzz** | Fuzzing |
| IoT Security | **A2A-SIN-Security-IoT** | IoT Security |
| Malware Analysis | **A2A-SIN-Security-Malware** | Malware Analysis |
| Mobile Security | **A2A-SIN-Security-Mobile** | Mobile Security |
| Network Security | **A2A-SIN-Security-Network** | Network Security |
| Recon, OSINT | **A2A-SIN-Security-Recon** | Reconnaissance |
| Red Team, Offensive Security | **A2A-SIN-Security-RedTeam** | Red Team Operations |
| Social Engineering | **A2A-SIN-Security-Social** | Social Engineering |
| Web Security | **A2A-SIN-Security-Web** | Web Application Security |
| AI Security | **A2A-SIN-Security-AI** | AI/ML Security |
| **ALLE Security Tasks gesamt** | **Team-SIN-Code-CyberSec** | CyberSec Orchestrierung |

## A2A-SIN AGENT REGISTRY — KATEGORIE 10: ENTERTAINMENT & GAMING

| Trigger | Delegiere an | Zweck |
|---------|-------------|-------|
| Nintendo (Switch, eShop) | **A2A-SIN-Nintendo** | Nintendo Platform |
| PlayStation (PS5, PSN) | **A2A-SIN-PlayStation** | PlayStation Platform |
| Xbox | **A2A-SIN-Xbox** | Xbox Platform |
| TikTok Gaming | **A2A-SIN-TikTok** | TikTok Gaming Content |
| Medusa (Gaming Platform) | **A2A-SIN-Medusa** | Medusa Platform |
| Opal (Gaming) | **A2A-SIN-Opal** | Opal Platform |
| Zoom Meetings, Webinare | **A2A-SIN-Zoom** | Zoom Automation |

## A2A-SIN AGENT REGISTRY — KATEGORIE 11: INFRASTRUKTUR & TOOLS

| Trigger | Delegiere an | Zweck |
|---------|-------------|-------|
| Chrome Extension, Browser Automation | **MCP-SIN-chrome-extension** | Chrome Extension MCP |
| Computer Use (Screen Control) | **MCP-SIN-computer-use** | Computer Control MCP |
| MCP Gateway (Routing) | **MCP-SIN-mcp-gateway** | MCP Routing Gateway |
| MCP Memory (Knowledge) | **MCP-SIN-memory** | Memory MCP |
| Platform Auth | **MCP-SIN-platform-auth** | Platform Authentication |
| Browser Automation | **MCP-SIN-usebrowser** | Browser Automation MCP |
| Repo Sync | **CLI-SIN-Repo-Sync** | Repository Sync CLI |
| TelegramBot CLI | **CLI-SIN-TelegramBot** | Telegram CLI |
| Biometrics Plugin | **Plugin-SIN-Biometrics** | Biometric Auth |
| Swarm Plugin | **Plugin-SIN-Swarm** | Swarm Orchestration |
| Agent Forge (Agent Creation) | **Skill-SIN-Agent-Forge** | Agent Creation Skill |
| TelegramBot Creation | **Skill-SIN-Create-TelegramBot** | Bot Creation Skill |
| Enterprise Deep Debug | **Skill-SIN-Enterprise-Deep-Debug** | Debugging Skill |

## A2A-SIN AGENT REGISTRY — KATEGORIE 12: WORKER & EARNINGS

| Trigger | Delegiere an | Zweck |
|---------|-------------|-------|
| Prolific Surveys | **A2A-SIN-Worker-Prolific** | Prolific Survey Automation |
| HeyPiggy Tasks | **A2A-SIN-Worker-heypiggy** | HeyPiggy Automation |
| Money Earners (alle Plattformen) | **A2A-SIN-Team-MoneyEarners** | Money Earning Orchestrierung |
| MyCompany Management | **A2A-SIN-Team-MyCompany** | Company Management |

## A2A-SIN AGENT REGISTRY — KATEGORIE 13: CONTENT & RESEARCH

| Trigger | Delegiere an | Zweck |
|---------|-------------|-------|
| Research, Recherche | **A2A-SIN-Research** | Research Automation |
| Summary, Zusammenfassung | **A2A-SIN-Summary** | Content Summarization |
| ClaimWriter (Patents, Claims) | **A2A-SIN-ClaimWriter** | Claim Writing |
| Evidence, Beweise | **A2A-SIN-Evidence** | Evidence Management |
| Damages, Schadensersatz | **A2A-SIN-Damages** | Damage Claims |
| Compliance, DSGVO | **A2A-SIN-Compliance** | Compliance Management |
| Patents | **A2A-SIN-Patents** | Patent Management |
| **ALLE Research Tasks gesamt** | **Team-SIN-Research** | Research Orchestrierung |

## A2A-SIN AGENT REGISTRY — KATEGORIE 14: TEAMS (ORCHESTRIERUNG)

| Team | Zuständig für |
|------|--------------|
| **Team-SIN-Apple** | Orchestriert ALLE Apple-Agenten |
| **Team-SIN-Google** | Orchestriert ALLE Google-Agenten |
| **Team-SIN-Messaging** | Orchestriert ALLE Messaging-Agenten |
| **Team-SIN-Social** | Orchestriert ALLE Social Media Agenten |
| **Team-SIN-Commerce** | Orchestriert ALLE E-Commerce Agenten |
| **Team-SIN-Code-Core** | Orchestriert ALLE Coding-Agenten |
| **Team-SIN-Code-Backend** | Backend Development |
| **Team-SIN-Code-Frontend** | Frontend Development |
| **Team-SIN-Code-CyberSec** | Orchestriert ALLE Security-Agenten |
| **Team-SIN-Research** | Orchestriert ALLE Research-Agenten |
| **Team-SIN-Community** | Community Management |
| **Team-SIN-Forum** | Forum Management |
| **Team-SIN-Media-ComfyUI** | Media Generation (ComfyUI) |
| **Team-SIN-Media-Music** | Music Generation |
| **Team-SIN-Infrastructure** | Infrastructure Management |
| **Team-SIN-Legal** | Legal Management |
| **Team-SIN-Microsoft** | Microsoft Ecosystem |

---

## 🧠 INTELLIGENTE DELEGATIONSLOGIK — BEISPIELE

### Beispiel 1: "Baue mir einen neuen Shop mit Bezahlfunktionen"
```
PARALLEL:
  → Team-SIN-Google: Google Docs/Sheets für Shop-Dokumentation erstellen
  → A2A-SIN-Stripe: Produkte, Payment Intents, Subscriptions einrichten
  → Team-SIN-Code-Frontend: Shop Frontend bauen
  → Team-SIN-Code-Backend: Shop Backend + API bauen
  
NACHEINANDER:
  → A2A-SIN-Shop-Finance: Buchhaltung einrichten (nach Stripe)
  → A2A-SIN-Shop-Logistic: Versand/Lieferanten einrichten (nach Shop)
  → Biz-SIN-Marketing: Marketing Kampagne starten (nach Shop live)
  → Team-SIN-Social: Social Media Posts (nach Marketing)
```

### Beispiel 2: "Verändere Code in Thema XYZ"
```
ANALYSE:
  → Welche Komponenten sind betroffen?
  → Backend? → Team-SIN-Code-Backend delegieren
  → Frontend? → Team-SIN-Code-Frontend delegieren
  → Security? → A2A-SIN-Security-Audit delegieren
  → Datenbank? → Team-SIN-Code-Backend delegieren
  → Deployment? → A2A-SIN-Code-DevOps delegieren
  
ACTION: PARALLEL an alle betroffenen Teams delegieren!
```

### Beispiel 3: "Mach was in Google Docs"
```
SOFORT: → A2A-SIN-Google-Apps delegieren!
NICHT: Selbst versuchen Google Docs zu bearbeiten!
```

### Beispiel 4: "Speichere diese Credentials"
```
SOFORT: → A2A-SIN-PasswordManager delegieren!
NICHT: Selbst in eine Datei schreiben!
```

### Beispiel 5: "Erstelle einen Blog Post und teile ihn überall"
```
SEQUENZ:
  1. Biz-SIN-Blog-Posts: Blog Post erstellen
  2. Team-SIN-Social: PARALLEL auf allen Plattformen teilen:
     → A2A-SIN-X-Twitter
     → A2A-SIN-LinkedIn
     → A2A-SIN-Reddit
     → A2A-SIN-Instagram
     → A2A-SIN-Facebook
  3. Team-SIN-Forum: In Foren teilen
```

---

## ⚡ DELEGATIONSREGELN (ABSOLUT, KEINE AUSNAHMEN)

1. **SPEZIALISIERTE AGENTEN FIRST:** Wenn es einen A2A-SIN-Agenten für eine Aufgabe gibt → IMMEDIATE DELEGATION.
2. **PARALLEL WO MÖGLICH:** Unabhängige Tasks PARALLEL an verschiedene Agenten delegieren.
3. **TEAMS FÜR KOMPLEXE AUFGABEN:** Bei Aufgaben die mehrere Domänen betreffen → Teams als Orchestrator nutzen.
4. **NIEMALS ALLEINE MACHEN:** Ein Agent soll NIE versuchen, Aufgaben zu lösen die ein spezialisierter Agent besser kann.
5. **USER MUSS ES NICHT SAGEN:** Die Delegation passiert AUTOMATISCH basierend auf der Task-Analyse.

---

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

