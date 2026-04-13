#!/usr/bin/env node
// MCP Server: sin-brain — read, write, and sync knowledge rules in the global brain.
// Agents use this to automatically add rules after discovering patterns or bugs.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const BRAIN_CLI = "/Users/jeremy/dev/global-brain/src/cli.js";
const GLOBAL_AGENTS_MD = path.join(process.env.HOME, ".config", "opencode", "AGENTS.md");

const server = new McpServer({
  name: "sin-brain",
  version: "1.0.0"
});

server.tool(
  "add_rule",
  "Add a new rule to the global brain (AGENTS.md) and optionally to the local project .pcpm/. Use this after discovering a bug pattern, a successful fix, or a new architectural constraint that all agents should follow.",
  {
    rule: z.string().describe("The rule text to add (clear, actionable, imperative)"),
    priority: z.number().optional().describe("Priority level (default: 0, lower = more important)"),
    scope: z.enum(["global", "project", "both"]).optional().describe("Where to add the rule (default: global)")
  },
  async ({ rule, priority = 0, scope = "global" }) => {
    try {
      const cmd = [
        "node",
        BRAIN_CLI,
        "add-rule",
        "--text",
        `"${rule.replace(/"/g, '\\"')}"`,
        "--priority",
        String(priority),
        "--scope",
        scope
      ].join(" ");

      const output = execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
      return {
        content: [{ type: "text", text: output.trim() }]
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error adding rule: ${err.stderr || err.message}` }]
      };
    }
  }
);

server.tool(
  "sync_brain",
  "Synchronize the local project brain (.pcpm/) with the global brain (AGENTS.md). Run this after completing a significant task to ensure all knowledge is pushed to the global brain.",
  {},
  async () => {
    try {
      const output = execSync(`node ${BRAIN_CLI} sync-chat-turn`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"]
      });
      return {
        content: [{ type: "text", text: output.trim() }]
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error syncing brain: ${err.stderr || err.message}` }]
      };
    }
  }
);

server.tool(
  "open_image_in_preview",
  "Opens an image file in macOS Preview.app. MUST be used whenever the agent creates or references screenshots/images. Never tell the user to look in /tmp — open the image directly!",
  {
    file_path: z.string().describe("Absolute path to the image file")
  },
  async ({ file_path }) => {
    const resolved = path.resolve(file_path);

    if (!fs.existsSync(resolved)) {
      return {
        content: [{ type: "text", text: `File not found: ${resolved}` }]
      };
    }

    try {
      execSync(`open -a Preview "${resolved}"`, { stdio: "pipe" });
      return {
        content: [{ type: "text", text: `Opened in Preview: ${resolved}` }]
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }]
      };
    }
  }
);

server.tool(
  "list_global_rules",
  "List all rules currently in the global brain (AGENTS.md). Use this to understand what rules and constraints are already in effect.",
  {},
  async () => {
    if (!fs.existsSync(GLOBAL_AGENTS_MD)) {
      return {
        content: [{ type: "text", text: "Global AGENTS.md not found. No rules configured." }]
      };
    }

    const content = fs.readFileSync(GLOBAL_AGENTS_MD, "utf8");
    const ruleRegex = /# 🚨.*?(?:PRIORITY\s*(-?\d+))?\n(.*?)(?=\n#\s|$)/gs;
    const rules = [];
    let match;

    while ((match = ruleRegex.exec(content)) !== null) {
      rules.push({
        priority: match[1] ? parseInt(match[1], 10) : 0,
        text: match[2].trim().substring(0, 200)
      });
    }

    return {
      content: [
        {
          type: "text",
          text: `Found ${rules.length} rules:\n${rules.map((r, i) => `${i + 1}. [P${r.priority}] ${r.text}`).join("\n")}`
        }
      ]
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
