# System Directive Watcher — Anleitung

## Überblick

Der **System Directive Watcher** ist ein Hintergrund-Script, das OpenCode-Session-Nachrichten überwacht und bei erkannten System Directives automatisch Todos erstellt.

**Was er tut:**

- Pollt alle 3 Sekunden OpenCode-Session-Dateien
- Erkennt `[SYSTEM DIRECTIVE: OH-MY-OPENCODE - ...]` Pattern
- Erkennt Work-Stop-Phrasen in Assistant-Nachrichten
- Schreibt Todos nach `~/.pcpm/todo-inbox.jsonl`
- State wird in `/tmp/opensin-directive-watcher-state.json` gespeichert (keine Duplikate)

## Installation

Das Script liegt unter:

```
~/.config/opencode/scripts/system-directive-watcher.js
```

**Ausführbar machen:**

```bash
chmod +x ~/.config/opencode/scripts/system-directive-watcher.js
```

## Usage

```bash
# Einfacher Test-Lauf (einmal polling)
bun run ~/.config/opencode/scripts/system-directive-watcher.js

# Daemon-Modus (permanent, mit PID-Datei)
bun run ~/.config/opencode/scripts/system-directive-watcher.js --daemon

# Log-File tailen statt Polling
bun run ~/.config/opencode/scripts/system-directive-watcher.js --log=/tmp/oh-my-opencode.log

# Eigenes Poll-Intervall
bun run ~/.config/opencode/scripts/system-directive-watcher.js --interval=5000
```

## Als Daemon installieren (macOS LaunchAgent)

```bash
cat > ~/Library/LaunchAgents/com.sin.system-directive-watcher.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.sin.system-directive-watcher</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/bun</string>
    <string>run</string>
    <string>/Users/jeremy/.config/opencode/scripts/system-directive-watcher.js</string>
    <string>--daemon</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/system-directive-watcher.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/system-directive-watcher.err</string>
</dict>
</plist>
EOF

# Aktivieren
launchctl load ~/Library/LaunchAgents/com.sin.system-directive-watcher.plist
```

## Unterstützte Directives

| Directive                | Auto-Todos                                                               |
| ------------------------ | ------------------------------------------------------------------------ |
| `TODO CONTINUATION`      | Global Brain aktualisieren, Local Brain aktualisieren, Todo-Liste prüfen |
| `BRAIN SYNC ENFORCER`    | Brain Sync: Global Brain + Local Brain                                   |
| `CODE CHECK`             | Repositories synced, Issues aktualisiert                                 |
| `DOCUMENTATION CHECK`    | README/ADRs/Changelog reviewen                                           |
| `ORGANIZATION CHECK`     | GitHub-Hygiene, Traceability, Backlog                                    |
| `RALPH LOOP`             | Ralph Loop Status, Global Brain                                          |
| `BOULDER CONTINUATION`   | Global Brain, Local Brain                                                |
| `DELEGATION REQUIRED`    | Delegationsziel, Global Brain                                            |
| `COMPACTION CONTEXT`     | Global Brain nach Compaction                                             |
| `CONTEXT WINDOW MONITOR` | Wichtigste Infos sichern                                                 |
| `WORK STOP BRAIN CHECK`  | Global Brain?, Local Brain?, "Brains updated"                            |

## Work Stop Erkennung

Wenn der Agent Nachrichten mit folgenden Phrasen sendet, wird automatisch die `WORK STOP BRAIN CHECK` Directive getriggert:

- arbeit gestoppt / arbeit beendet
- task stopped / work stopped
- stoppe die arbeit
- abgeschlossen / erledigt / finished / done / complete

## Eigene Directives hinzufügen

Im Script die `DIRECTIVE_ACTIONS` Map erweitern:

```javascript
'MEINE DIRECTIVE': [
  { title: 'Mein Todo 1', priority: 'high' },
  { title: 'Mein Todo 2', priority: 'medium' },
],
```

## Todo-Inbox Format

Todos werden nach `~/.pcpm/todo-inbox.jsonl` geschrieben (eine Zeile pro Todo):

```jsonl
{"title":"Global Brain aktualisieren","priority":"high","sessionId":"...","source":"system-directive-watcher","createdAt":"2026-04-16T...","status":"pending"}
{"title":"Local Brain aktualisieren","priority":"high","sessionId":"...","source":"system-directive-watcher","createdAt":"2026-04-16T...","status":"pending"}
```

## Troubleshooting

**Watcher startet nicht:**

```bash
bun --version
node --check ~/.config/opencode/scripts/system-directive-watcher.js
```

**Keine Todos erscheinen:**

```bash
ls -la ~/.pcpm/
cat ~/.pcpm/todo-inbox.jsonl
```

**State-Datei zu groß:**

```bash
rm /tmp/opensin-directive-watcher-state.json
```

## Architektur

```
OpenCode Session
    ↓ (alle 3s poll)
system-directive-watcher.js
    ↓ Regex: [SYSTEM DIRECTIVE: OH-MY-OPENCODE - ...]
erkannte Directive
    ↓ lookup in DIRECTIVE_ACTIONS
Todo-Liste
    ↓ schreiben nach
~/.pcpm/todo-inbox.jsonl
    ↓ OpenCode synct
Session Todo-Liste
```
