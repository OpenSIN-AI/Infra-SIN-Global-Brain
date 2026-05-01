# Project Rules

## 🚨 CRITICAL ARCHITECTURE RULES

- [2026-04-14T16:00:00Z] KEINE CI/CD GITHUB ACTIONS! Wir nutzen AUSSCHLIESSLICH A2A-SIN-GitHub-Action + n8n für alle CI/CD, Deployment, Automation Tasks. GitHub Actions sind PERMANENT VERBOTEN. (priority: -10.0)
- [2026-04-14T16:30:00Z] A2A-SIN AGENT ROUTING PFLICHT! Jeder Agent MUSS bei jeder Aufgabe sofort prüfen: Welcher A2A-SIN-Agent ist dafür zuständig? Delegation MUSS automatisch erfolgen — User muss es NICHT extra sagen! Google Docs → A2A-SIN-Google-Apps, Passwörter → A2A-SIN-PasswordManager, Code → Team-SIN-Code-\*, etc. Siehe vollständige Registry in Global Brain AGENTS.md. (priority: -9.0)
- [2026-04-14T18:00:00Z] BOX STORAGE DEFAULT: All logs, screenshots, videos, reports, and debug artifacts MUST be uploaded to Box.com via A2A-SIN-Box-Storage (room-09). GitLab LogCenter is deprecated. Use `BOX_STORAGE_API_KEY` environment variable. Migration deadline: 2026-05-01. (priority: 00)

## Global Rules (synced from AGENTS.md)

- [2026-04-13T14:00:00Z] VISUAL ARTIFACT HANDLING: Agents MUST open images in macOS Preview.app via 'open -a Preview'. Never tell users to look in /tmp. (priority: -4.5)
- [2026-04-13T14:00:00Z] SIN-BRAIN AUTO-SYNC: After every chat turn, the global brain is automatically synchronized via sync-chat-turn hook. (priority: -4.0)
- [2026-04-13T14:00:00Z] OpenSIN-Neural-Bus is the central JetStream message bus. All agents must use it for cross-agent communication. (priority: 0)

## Project-Specific Rules

- MCP servers are preferred over CLI for agent-brain interaction
- All new features must have corresponding GitHub Issues
- All changes must be committed and pushed before marking as done
