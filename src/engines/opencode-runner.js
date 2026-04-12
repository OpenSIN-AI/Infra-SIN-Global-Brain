import { spawn } from "node:child_process";

import { extractJsonFromText } from "../lib/storage.js";

function collectTextParts(stdout) {
  const textParts = [];

  for (const line of stdout.split(/\r?\n/u)) {
    if (!line.trim()) {
      continue;
    }

    try {
      const event = JSON.parse(line);

      if (event.type === "text") {
        textParts.push(event.part?.text ?? event.text ?? "");
      }
    } catch {
      textParts.push(line);
    }
  }

  return textParts.join("").trim();
}

export class OpenCodeRunner {
  constructor({ fallbackModel = "opencode/minimax-m2.5-free", timeoutMs = 120000 } = {}) {
    this.fallbackModel = fallbackModel;
    this.timeoutMs = timeoutMs;
  }

  async runText(prompt, { cwd = process.cwd() } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(
        "opencode",
        ["run", prompt, "--format", "json", "--fallback", this.fallbackModel],
        {
          cwd,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"]
        }
      );

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, this.timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      });

      child.on("close", (exitCode) => {
        clearTimeout(timeoutHandle);

        if (timedOut) {
          reject(new Error(`OpenCode runner timed out after ${this.timeoutMs}ms.`));
          return;
        }

        if (exitCode !== 0) {
          reject(new Error(`OpenCode runner failed with exit code ${exitCode}: ${stderr}`));
          return;
        }

        resolve(collectTextParts(stdout));
      });
    });
  }

  async runJson(prompt, options = {}) {
    const text = await this.runText(prompt, options);
    return extractJsonFromText(text);
  }
}
