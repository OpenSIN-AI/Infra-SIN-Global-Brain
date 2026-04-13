# Project Rules

## Global Rules (synced from AGENTS.md)
- [2026-04-13T14:00:00Z] VISUAL ARTIFACT HANDLING: Agents MUST open images in macOS Preview.app via 'open -a Preview'. Never tell users to look in /tmp. (priority: -4.5)
- [2026-04-13T14:00:00Z] SIN-BRAIN AUTO-SYNC: After every chat turn, the global brain is automatically synchronized via sync-chat-turn hook. (priority: -4.0)
- [2026-04-13T14:00:00Z] OpenSIN-Neural-Bus is the central JetStream message bus. All agents must use it for cross-agent communication. (priority: 0)

## Project-Specific Rules
- MCP servers are preferred over CLI for agent-brain interaction
- All new features must have corresponding GitHub Issues
- All changes must be committed and pushed before marking as done
