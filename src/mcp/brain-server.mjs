#!/usr/bin/env node
/**
 * MCP server — talks to brain-core instead of spawning the CLI.
 *
 * Every tool here is a thin shim over the BrainClient. The old `sin-brain`
 * server stays available for backwards compatibility, but new agents should
 * configure THIS server so all operations run in milliseconds.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { attach } from "../../brain-client/index.js";

const projectId = process.env.BRAIN_PROJECT_ID ?? process.env.PROJECT_ID ?? "default";
const agentId = process.env.BRAIN_AGENT_ID ?? "mcp-agent";

let brainPromise = null;
async function brain() {
  if (!brainPromise) {
    brainPromise = attach({ projectId, agentId, projectRoot: process.cwd() }).catch((err) => {
      brainPromise = null;
      throw err;
    });
  }
  return brainPromise;
}

const server = new McpServer({ name: "brain", version: "2.0.0" });

server.tool(
  "brain_ask",
  "Ask the global brain anything. Returns ultra-rules that always apply plus the top ranked knowledge entries for the query. Millisecond response.",
  {
    query: z.string().describe("Natural language question or topic"),
    types: z.array(z.string()).optional().describe("Filter by entry type (rule, decision, fact, solution, mistake, forbidden)"),
    limit: z.number().optional().describe("Max hits (default 8)")
  },
  async ({ query, types, limit }) => {
    const b = await brain();
    const res = await b.ask(query, { types, limit });
    return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
  }
);

server.tool(
  "brain_rules",
  "Get the currently active rules for this project. Ultra-rules (promoted, globally canonical) are listed first.",
  {},
  async () => {
    const b = await brain();
    const res = await b.rules();
    return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
  }
);

server.tool(
  "brain_add",
  "Add a new knowledge entry (rule, decision, mistake, solution, forbidden, fact). The auto-promoter will evaluate it for Ultra status.",
  {
    type: z.enum(["rule", "decision", "mistake", "solution", "forbidden", "fact"]),
    text: z.string(),
    topic: z.string().optional(),
    scope: z.enum(["global", "project"]).optional(),
    tags: z.array(z.string()).optional()
  },
  async ({ type, text, topic, scope, tags }) => {
    const b = await brain();
    const res = await b.ingest({ type, text, topic, scope, tags });
    return { content: [{ type: "text", text: `stored ${res.id} (scope=${res.scope})` }] };
  }
);

server.tool(
  "brain_attach",
  "Get the full prime-context for this project in one shot: ultra-rules, recent decisions, known mistakes, forbidden patterns.",
  {},
  async () => {
    const b = await brain();
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          attachedAt: b.attachedAt,
          primeContext: b.primeContext
        }, null, 2)
      }]
    };
  }
);

server.tool(
  "brain_end_session",
  "Report session outcome so the auto-promoter can score the rules that were consulted.",
  {
    consultedRuleIds: z.array(z.string()).optional(),
    success: z.boolean().optional(),
    summary: z.string().optional()
  },
  async ({ consultedRuleIds = [], success = true, summary }) => {
    const b = await brain();
    const res = await b.endSession({ consultedRuleIds, success, summary });
    return { content: [{ type: "text", text: JSON.stringify(res) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
