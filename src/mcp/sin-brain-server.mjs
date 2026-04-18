#!/usr/bin/env node
/**
 * MCP Server: sin-brain (compat v2)
 *
 * Historically this server shelled out to `node src/cli.js` for every single
 * tool invocation. That cost 200-500ms per call and forced every agent to
 * pay the Node startup penalty on every rule read/write.
 *
 * v2 keeps the exact same tool names and argument shapes for backwards
 * compatibility with every agent out there, but the implementation is now
 * a thin shim over `@opensin/brain-client` so each tool round-trips to the
 * long-running daemon in milliseconds.
 *
 * If the daemon is unreachable we fall back to the legacy CLI path so
 * existing integrations keep working during rollout.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

import { attach } from "../../brain-client/index.js";

const DEFAULT_BRAIN_URL = process.env.BRAIN_URL || "http://127.0.0.1:7070";
const PROJECT_ID = process.env.BRAIN_PROJECT_ID ?? process.env.PROJECT_ID ?? "global";
const AGENT_ID = process.env.BRAIN_AGENT_ID ?? "sin-brain-mcp";
const LEGACY_CLI = process.env.BRAIN_CLI || "/Users/jeremy/dev/global-brain/src/cli.js";
const GLOBAL_AGENTS_MD = process.env.AGENTS_MD
  || path.join(os.homedir() ?? process.env.HOME ?? "/root", ".config", "opencode", "AGENTS.md");

// Lazy + cached brain client. Resets on failure so a daemon restart self-heals.
let brainPromise = null;
async function brain() {
  if (!brainPromise) {
    brainPromise = attach({
      projectId: PROJECT_ID,
      agentId: AGENT_ID,
      projectRoot: process.cwd()
    }).catch((err) => {
      brainPromise = null;
      throw err;
    });
  }
  return brainPromise;
}

function daemonReachable() {
  // Synchronous probe so tool handlers can decide deterministically.
  // If BRAIN_URL is wrong we don't want to block forever.
  try {
    // Node 22+: fetch is sync-friendly via AbortSignal.timeout
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 250);
    return fetch(`${DEFAULT_BRAIN_URL}/health`, { signal: ac.signal })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => clearTimeout(to));
  } catch {
    return Promise.resolve(false);
  }
}

const server = new McpServer({
  name: "sin-brain",
  version: "2.0.0"
});

server.tool(
  "add_rule",
  "Add a new rule to the global brain. In v2 this writes directly to the always-on brain-core daemon — millisecond round-trip, no CLI spawn. Falls back to the legacy CLI if the daemon is unreachable.",
  {
    rule: z.string().describe("The rule text to add (clear, actionable, imperative)"),
    priority: z.number().optional().describe("Priority level (default: 0, lower = more important)"),
    scope: z.enum(["global", "project", "both"]).optional().describe("Where to add the rule (default: global)")
  },
  async ({ rule, priority = 0, scope = "global" }) => {
    if (await daemonReachable()) {
      try {
        const b = await brain();
        const daemonScope = scope === "both" ? "global" : scope;
        const res = await b.ingest({
          type: "rule",
          text: rule,
          scope: daemonScope,
          tags: ["mcp:add_rule", `priority:${priority}`]
        });
        return {
          content: [{
            type: "text",
            text: `Rule stored via brain-core: id=${res.id} scope=${res.scope} priority=${priority}`
          }]
        };
      } catch (err) {
        return { content: [{ type: "text", text: `brain-core write failed: ${err.message}` }] };
      }
    }

    // Legacy fallback — only reached if the daemon is down.
    try {
      const cmd = [
        "node",
        LEGACY_CLI,
        "add-rule",
        "--text",
        `"${rule.replace(/"/g, '\\"')}"`,
        "--priority",
        String(priority),
        "--scope",
        scope
      ].join(" ");
      const output = execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
      return { content: [{ type: "text", text: `[legacy] ${output.trim()}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error adding rule: ${err.stderr || err.message}` }] };
    }
  }
);

server.tool(
  "sync_brain",
  "Synchronize the local project brain. In v2 this triggers an admin tick on the daemon which flushes in-flight mirrors and re-evaluates the auto-promoter. Falls back to the legacy CLI sync if the daemon is unreachable.",
  {},
  async () => {
    if (await daemonReachable()) {
      try {
        const res = await fetch(`${DEFAULT_BRAIN_URL}/admin/tick`, { method: "POST" }).then((r) => r.json());
        if (res.ok) {
          const { promoted = [], demoted = [] } = res.result ?? {};
          return {
            content: [{
              type: "text",
              text: `brain-core tick OK — promoted=${promoted.length} demoted=${demoted.length}`
            }]
          };
        }
      } catch (err) {
        return { content: [{ type: "text", text: `brain-core tick failed: ${err.message}` }] };
      }
    }
    try {
      const output = execSync(`node ${LEGACY_CLI} sync-chat-turn`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"]
      });
      return { content: [{ type: "text", text: `[legacy] ${output.trim()}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error syncing brain: ${err.stderr || err.message}` }] };
    }
  }
);

server.tool(
  "open_image_in_preview",
  "Opens an image file in macOS Preview.app. MUST be used whenever the agent creates or references screenshots/images.",
  { file_path: z.string().describe("Absolute path to the image file") },
  async ({ file_path }) => {
    const resolved = path.resolve(file_path);
    if (!fs.existsSync(resolved)) {
      return { content: [{ type: "text", text: `File not found: ${resolved}` }] };
    }
    try {
      execSync(`open -a Preview "${resolved}"`, { stdio: "pipe" });
      return { content: [{ type: "text", text: `Opened in Preview: ${resolved}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }] };
    }
  }
);

server.tool(
  "list_global_rules",
  "List all rules currently in the global brain. In v2 this reads from the live daemon so newly-added rules (even ones added seconds ago by another agent) show up immediately. Falls back to reading AGENTS.md if the daemon is unreachable.",
  {},
  async () => {
    if (await daemonReachable()) {
      try {
        const b = await brain();
        const res = await b.rules();
        const rules = res.rules ?? [];
        const formatted = rules.map((r, i) => {
          const ultra = r.ultra ? "[ULTRA]" : `[P${r.priority ?? 0}]`;
          const scope = r.scope ?? "global";
          const text = (r.text ?? "").slice(0, 180);
          return `${i + 1}. ${ultra} (${scope}) ${text}`;
        });
        return {
          content: [{
            type: "text",
            text: `Found ${rules.length} rules in brain-core:\n${formatted.join("\n")}`
          }]
        };
      } catch (err) {
        return { content: [{ type: "text", text: `brain-core read failed: ${err.message}` }] };
      }
    }
    if (!fs.existsSync(GLOBAL_AGENTS_MD)) {
      return { content: [{ type: "text", text: "Daemon unreachable and AGENTS.md not found." }] };
    }
    const content = fs.readFileSync(GLOBAL_AGENTS_MD, "utf8");
    const ruleRegex = /# .*?(?:PRIORITY\s*(-?\d+(?:\.\d+)?))?\n([\s\S]*?)(?=\n#\s|$)/g;
    const rules = [];
    let match;
    while ((match = ruleRegex.exec(content)) !== null) {
      rules.push({
        priority: match[1] ? parseFloat(match[1]) : 0,
        text: match[2].trim().substring(0, 200)
      });
    }
    return {
      content: [{
        type: "text",
        text: `[legacy AGENTS.md] Found ${rules.length} rules:\n${rules.map((r, i) => `${i + 1}. [P${r.priority}] ${r.text}`).join("\n")}`
      }]
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
