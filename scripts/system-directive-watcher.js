#!/usr/bin/env node
// @bun
/**
 * system-directive-watcher.js
 *
 * Background watcher that monitors OpenCode session messages for
 * [SYSTEM DIRECTIVE: OH-MY-OPENCODE - ...] patterns and automatically
 * creates follow-up todos when detected.
 *
 * Usage:
 * bun run system-directive-watcher.js
 * bun run system-directive-watcher.js --daemon
 * bun run system-directive-watcher.js --log=/tmp/oh-my-opencode.log
 * bun run system-directive-watcher.js --interval=5000
 */

import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir, tmpdir } from "os";
import { spawn } from "child_process";

const DIRECTIVE_ACTIONS = {
  'TODO CONTINUATION': [
    { title: 'Global Brain aktualisieren', priority: 'high' },
    { title: 'Local Brain aktualisieren', priority: 'high' },
    { title: 'Todo-Liste prüfen und aktualisieren', priority: 'medium' },
  ],
  'BRAIN SYNC ENFORCER': [
    { title: 'Brain Sync durchführen: Global Brain (.pcpm/) + Local Brain (AGENTS.md)', priority: 'high' },
  ],
  'CODE CHECK': [
    { title: 'Code-Check: Repositories updated + pushed + merged', priority: 'high' },
    { title: 'Issues/Priorities aktualisiert', priority: 'medium' },
  ],
  'DOCUMENTATION CHECK': [
    { title: 'Dokumentation reviewen: README, ADRs, Changelog', priority: 'high' },
    { title: 'Fehlende Docs erstellen', priority: 'medium' },
  ],
  'ORGANIZATION CHECK': [
    { title: 'GitHub-Hygiene: Issues labeln, PRs verlinken', priority: 'high' },
    { title: 'Traceability: Commit-Messages mit Issue-ID', priority: 'high' },
    { title: 'Backlog/Technical Debt als Issues erfassen', priority: 'medium' },
    { title: 'Stakeholder-Kommentare/@mentions prüfen', priority: 'medium' },
  ],
  'RALPH LOOP': [
    { title: 'Ralph Loop Status prüfen', priority: 'medium' },
    { title: 'Global Brain aktualisieren', priority: 'high' },
  ],
  'BOULDER CONTINUATION': [
    { title: 'Global Brain aktualisieren', priority: 'high' },
    { title: 'Local Brain aktualisieren', priority: 'high' },
  ],
  'DELEGATION REQUIRED': [
    { title: 'Aufgabe an passenden Agent delegieren', priority: 'high' },
    { title: 'Global Brain aktualisieren', priority: 'high' },
  ],
  'COMPACTION CONTEXT': [
    { title: 'Global Brain nach Compaction aktualisieren', priority: 'high' },
    { title: 'Context-Zusammenfassung prüfen', priority: 'medium' },
  ],
  'CONTEXT WINDOW MONITOR': [
    { title: 'Wichtigste Infos sichern (Context wird knapp)', priority: 'high' },
  ],
  'WORK STOP BRAIN CHECK': [
    { title: 'Global Brain wurde aktualisiert?', priority: 'critical' },
    { title: 'Local Brain wurde aktualisiert?', priority: 'critical' },
    { title: 'Mit "Brains updated" bestätigen', priority: 'low' },
  ],
};

const SYSTEM_DIRECTIVE_RE = /\[SYSTEM DIRECTIVE: OH-MY-OPENCODE - ([^\]]+)\]/g;
const STATE_FILE = join(tmpdir(), "opensin-directive-watcher-state.json");
const processedDirectives = new Set();

// Stopp-Muster in Agent-Nachrichten (deutsch/englisch)
const WORK_STOP_PATTERNS = [
  /arbeit\s+gestoppt/i,
  /arbeit\s+beendet/i,
  /task\s+stopped/i,
  /work\s+stopped/i,
  /stoppe\s+die\s+arbeit/i,
  /arbeiten\s+beendet/i,
  /abgeschlossen/i,
  /erledigt/i,
  /finished/i,
  /done/i,
  /complete/i,
];

function loadState() {
  if (!existsSync(STATE_FILE)) return;
  try {
    const data = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    const entries = Array.from(data.processed || []);
    for (const entry of entries.slice(-100)) {
      processedDirectives.add(entry);
    }
  } catch (e) {
    console.error("[watcher] State load error:", e.message);
  }
}

function saveState() {
  try {
    const data = {
      processed: Array.from(processedDirectives),
      lastUpdated: new Date().toISOString(),
    };
    const tmpFile = STATE_FILE + ".tmp";
    writeFileSync(tmpFile, JSON.stringify(data, null, 2), "utf-8");
    renameSync(tmpFile, STATE_FILE);
  } catch (e) {
    console.error("[watcher] State save error:", e.message);
  }
}

function extractDirectives(content) {
  const results = [];
  let match;
  const regex = /\[SYSTEM DIRECTIVE: OH-MY-OPENCODE - ([^\]]+)\]/g;
  while (true) {
    match = regex.exec(content);
    if (match === null) break;
    results.push({
      type: match[1].trim(),
      fullMatch: match[0],
    });
  }
  return results;
}

function processMessage(msg, sessionId, messageIndex) {
  const types = [];
  if (msg?.content) {
    const found = extractDirectives(msg.content);
    for (const d of found) {
      types.push(d.type);
    }
  }
  if (msg?.system) {
    const found = extractDirectives(msg.system);
    for (const d of found) {
      types.push(d.type);
    }
  }
  return types;
}

async function injectTodos(sessionId, todos) {
  // Wir schreiben Todos in die PCPM-Inbox.
  // OpenCode synchronisiert .pcpm automatisch mit dem Session-Speicher.
  // Die todos erscheinen dann in der Todo-Liste des Agents.
  //
  // Format: jede Zeile = JSON-Objekt mit Feldern, die todowrite versteht:
  // { title, priority, sessionId, source, createdAt }

  const pcpmDir = join(process.env.HOME, '.pcpm');
  const todoInboxFile = join(pcpmDir, 'todo-inbox.jsonl');

  try {
    // Stelle sicher, dass .pcpm exists
    if (!existsSync(pcpmDir)) {
      import('fs').then(fs => fs.mkdirSync(pcpmDir, { recursive: true }));
    }

    const now = new Date().toISOString();
    const lines = todos.map(todo => {
      return JSON.stringify({
        title: todo.title || todo.content,
        priority: todo.priority || 'medium',
        sessionId,
        source: 'system-directive-watcher',
        createdAt: now,
        content: todo.title || todo.content,
        status: 'pending',
      });
    });

    // Append atomar
    const fs = await import('fs');
    fs.appendFileSync(todoInboxFile, lines.join('\n') + '\n', 'utf-8');
    console.log(`[watcher] ✅ ${todos.length} Todo(s) nach ${todoInboxFile} geschrieben`);
  } catch (err) {
    console.error(`[watcher] ❌ Fehler beim Schreiben der Todos:`, err);
    // Fallback: Log nur
    console.log(`[watcher] Manuel erstellen:`);
    for (const t of todos) {
      console.log(`   - [${t.priority || 'medium'}] ${t.title || t.content}`);
    }
  }
}

function findSessionDirs() {
  const candidates = [
    join(homedir(), ".local/share/opencode/messages"),
    join(homedir(), ".config/opencode/sessions"),
    join(process.cwd(), ".opencode/sessions"),
  ];
  const dirs = [];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      for (const entry of readdirSync(candidate)) {
        const fullPath = join(candidate, entry);
        if (statSync(fullPath).isDirectory()) {
          dirs.push(fullPath);
        }
      }
    } catch (e) {}
  }
  return dirs;
}

async function scanSession(dir, sessionId, sinceMs) {
  try {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json") && !file.endsWith(".jsonl")) continue;
      const filePath = join(dir, file);
      const stat = statSync(filePath);
      if (stat.mtimeMs < sinceMs) continue;

      const content = readFileSync(filePath, "utf-8");
      let messages;
      try {
        messages = JSON.parse(content);
      } catch (e) {
        messages = [];
      }
      if (!Array.isArray(messages)) messages = [messages];

      for (let idx = 0; idx < messages.length; idx++) {
        const msg = messages[idx];

        // 1. System Directives aus content und system
        const types = processMessage(msg, sessionId, idx);
        for (const type of types) {
          const key = `${sessionId}:${idx}:${type}`;
          if (processedDirectives.has(key)) continue;

          processedDirectives.add(key);
          console.log(`[watcher] DETECTED: "${type}" in session ${sessionId} msg#${idx}`);

          const actions = DIRECTIVE_ACTIONS[type];
          if (actions?.length) {
            console.log(`[watcher]   -> Creating ${actions.length} auto-todos`);
            await injectTodos(sessionId, actions);
          }
        }

        // 2. Work Stop Erkennung (nur Assistant-Nachrichten)
        if (msg.role === 'assistant') {
          const text = msg.content || '';
          for (const pattern of WORK_STOP_PATTERNS) {
            if (pattern.test(text)) {
              const key = `${sessionId}:${idx}:WORK_STOP`;
              if (!processedDirectives.has(key)) {
                processedDirectives.add(key);
                console.log(`[watcher] WORK STOP DETECTED in session ${sessionId} msg#${idx}: "${text.substring(0, 60)}..."`);
                const actions = DIRECTIVE_ACTIONS['WORK STOP BRAIN CHECK'];
                if (actions?.length) {
                  await injectTodos(sessionId, actions);
                }
              }
              break; // Nur einmal pro Nachricht triggern
            }
          }
        }
      }
    }
  } catch (e) {}
}

function tailLogFile(logFile) {
  const tail = spawn("tail", ["-F", "-n", "0", logFile]);
  tail.stdout.on("data", (data) => {
    for (const line of data.toString().split("\n")) {
      if (!line.trim()) continue;
      const directives = extractDirectives(line);
      for (const d of directives) {
        const key = `log:${d.fullMatch}`;
        if (processedDirectives.has(key)) continue;
        processedDirectives.add(key);
        console.log(`[watcher] DETECTED (log): "${d.type}"`);
      }
    }
  });
}

async function pollLoop(intervalMs) {
  let lastCheck = Date.now();
  while (true) {
    try {
      for (const dir of findSessionDirs()) {
        await scanSession(dir, dir.split("/").pop(), lastCheck);
      }
      lastCheck = Date.now();
      saveState();
    } catch (e) {
      console.error("[watcher] Poll error:", e.message);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function runDaemon() {
  const pidFile = join(tmpdir(), "opensin-directive-watcher.pid");
  if (existsSync(pidFile)) {
    const rawPid = readFileSync(pidFile, "utf-8").trim();
    const existingPid = Number.parseInt(rawPid, 10);
    try {
      if (!Number.isFinite(existingPid) || existingPid <= 0) {
        unlinkSync(pidFile);
      } else {
        process.kill(existingPid, 0);
        console.log(`[watcher] Already running (PID ${rawPid})`);
        process.exit(0);
      }
    } catch (e) {
      try { unlinkSync(pidFile); } catch (unlinkError) {}
    }
  }
  writeFileSync(pidFile, process.pid.toString(), "utf-8");
  process.on("exit", () => {
    try { unlinkSync(pidFile); } catch (e) {}
  });
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
  await pollLoop(3000);
}

const args = process.argv.slice(2);
loadState();

if (args.includes("--daemon")) {
  runDaemon().catch((e) => { console.error("[watcher] Fatal:", e); process.exit(1); });
} else {
  const logFile = args.find((a) => a.startsWith("--log="))?.split("=")[1];
  const interval = parseInt(args.find((a) => a.startsWith("--interval="))?.split("=")[1] || "3000");

  console.log("[watcher] Starting...");
  console.log(`[watcher] Directives: ${Object.keys(DIRECTIVE_ACTIONS).join(", ")}`);
  console.log(`[watcher] State entries: ${processedDirectives.size}`);
  console.log("");

  if (logFile && existsSync(logFile)) {
    tailLogFile(logFile);
  } else {
    await pollLoop(interval);
  }
}
