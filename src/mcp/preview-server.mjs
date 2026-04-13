#!/usr/bin/env node
// MCP Server: Opens image files in macOS Preview.app automatically.
// Agents use this tool instead of telling users to "look in /tmp".

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const server = new McpServer({
  name: "sin-preview",
  version: "1.0.0"
});

server.tool(
  "open_in_preview",
  "Opens an image file in the macOS Preview.app. Use this whenever you create or reference screenshots, images, or visual artifacts so the user can see them immediately without manual file browsing.",
  {
    file_path: z.string().describe("Absolute path to an image file (PNG, JPG, GIF, PDF, etc.)")
  },
  async ({ file_path }) => {
    const resolved = path.resolve(file_path);

    if (!fs.existsSync(resolved)) {
      return {
        content: [{ type: "text", text: `Error: File not found: ${resolved}` }]
      };
    }

    const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".pdf", ".tiff", ".webp", ".bmp", ".svg"];
    const ext = path.extname(resolved).toLowerCase();

    if (!imageExtensions.includes(ext)) {
      return {
        content: [{ type: "text", text: `Error: Not an image file (extension ${ext}): ${resolved}` }]
      };
    }

    try {
      execSync(`open -a Preview "${resolved}"`, { stdio: "pipe" });
      return {
        content: [{ type: "text", text: `Opened in Preview: ${resolved}` }]
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error opening file in Preview: ${err.message}` }]
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
