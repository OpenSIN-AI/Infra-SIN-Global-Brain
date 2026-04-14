#!/usr/bin/env node
// A2A-SIN Agent Discovery Engine
// Scannt ALLE OpenSIN-AI Repos und baut DYNAMISCH die Agent Registry
// Jeder Agent MUSS dieses Script VOR jeder Aufgabe ausfuehren!

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ORG = "OpenSIN-AI";
const OUTPUT_PATH = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  ".pcpm",
  "agent-registry.json"
);

// Smart keyword mapping — erkennt automatisch worum es bei einem Agent geht
const CAPABILITY_KEYWORDS = {
  google: ["google", "docs", "sheets", "drive", "calendar", "workspace", "gmail"],
  apple: ["apple", "macos", "mail", "notes", "reminders", "facetime", "imessage", "shortcuts", "safari"],
  messaging: ["telegram", "whatsapp", "signal", "discord", "slack", "teams", "chat", "messaging", "messenger", "email", "sms", "beeper", "bluebubbles", "matrix", "irc", "line", "wechat"],
  social: ["instagram", "twitter", "x-twitter", "tiktok", "linkedin", "reddit", "youtube", "facebook", "medium", "dev.to", "producthunt", "hackernews", "stackoverflow", "quora", "indiehackers", "lobsters", "slashdot", "nostr", "feishu", "social"],
  shop: ["stripe", "shop", "finance", "logistic", "tax", "contract", "commerce", "payment", "ecommerce"],
  code: ["code", "devops", "backend", "frontend", "ci-cd", "github-action", "gitlab", "coding"],
  security: ["security", "audit", "auth", "cloud", "crypto", "exploit", "forensics", "fuzz", "iot", "malware", "mobile", "network", "recon", "redteam", "social-engineering", "web-security", "ai-security", "cybersec"],
  entertainment: ["nintendo", "playstation", "xbox", "gaming", "zoom", "medusa", "opal"],
  infra: ["chrome", "mcp", "browser", "memory", "platform-auth", "repo-sync", "telegrambot", "biometrics", "swarm"],
  worker: ["prolific", "heypiggy", "money", "worker", "survey"],
  business: ["blog", "marketing", "jobs", "competitor", "patents", "blueprints", "ledger"],
  research: ["research", "summary", "claim", "evidence", "damages", "compliance", "patent"],
  storage: ["storage", "password", "credentials", "secrets", "box", "file"],
  team: ["team", "orchestrator", "orchestration"],
  prediction: ["mirofish", "prediction", "forecast", "simulation", "swarm-intelligence", "future"],
};

function run(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", env: process.env }).trim();
  } catch {
    return "";
  }
}

function extractCapabilities(name, description, topics, readme, agentJson) {
  const capabilities = new Set();
  const text = `${name} ${description} ${topics.join(" ")} ${readme}`.toLowerCase();

  for (const [category, keywords] of Object.entries(CAPABILITY_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) {
        capabilities.add(category);
        break;
      }
    }
  }

  // Agent.json capabilities
  if (agentJson && Array.isArray(agentJson.capabilities)) {
    for (const c of agentJson.capabilities) {
      capabilities.add(c.toLowerCase());
    }
  }

  return Array.from(capabilities);
}

function detectType(name, description, topics) {
  const n = name.toLowerCase();
  const t = topics.map((x) => x.toLowerCase());
  const d = (description || "").toLowerCase();

  if (n.startsWith("a2a-sin-") && !n.includes("team")) return "a2a-agent";
  if (n.startsWith("team-sin-")) return "team";
  if (n.startsWith("mcp-sin-")) return "mcp";
  if (n.startsWith("cli-sin-")) return "cli";
  if (n.startsWith("plugin-sin-")) return "plugin";
  if (n.startsWith("skill-sin-")) return "skill";
  if (n.startsWith("biz-sin-")) return "business";
  if (n.startsWith("template-sin-")) return "template";
  if (t.includes("a2a") || t.includes("agent")) return "a2a-agent";
  if (t.includes("team") || t.includes("orchestrator")) return "team";
  if (t.includes("mcp")) return "mcp";
  if (n.includes("worker") || n.includes("prolific") || n.includes("heypiggy")) return "worker";
  return "unknown";
}

function detectTriggers(name, description, readme, agentJson) {
  const triggers = [];
  const text = `${name} ${description} ${readme}`.toLowerCase();

  // Extract from agent.json description
  if (agentJson && agentJson.description) {
    triggers.push(agentJson.description.toLowerCase());
  }

  // Common trigger patterns
  if (text.includes("password") || text.includes("credential") || text.includes("secret")) {
    triggers.push("passwörter speichern", "credentials lesen", "secrets verwalten", "login daten");
  }
  if (text.includes("google") && text.includes("docs")) {
    triggers.push("google docs", "dokumente bearbeiten", "docs lesen");
  }
  if (text.includes("google") && text.includes("sheets")) {
    triggers.push("google sheets", "tabellen erstellen", "daten exportieren");
  }
  if (text.includes("telegram")) triggers.push("telegram bot", "telegram nachricht");
  if (text.includes("whatsapp")) triggers.push("whatsapp", "wa nachricht");
  if (text.includes("stripe")) triggers.push("zahlung", "payment", "stripe produkt", "abonnement");
  if (text.includes("shop") || text.includes("commerce")) triggers.push("shop", "e-commerce", "online shop");
  if (text.includes("security") || text.includes("audit")) triggers.push("security check", "pentest", "sicherheits audit");
  if (text.includes("storage")) triggers.push("datei speichern", "log speichern", "screenshot hochladen");
  if (text.includes("mirofish") || text.includes("prediction")) triggers.push("vorhersage", "prognose", "simulation", "zukunft", "trend analyse");

  return [...new Set(triggers)];
}

async function discoverAgents() {
  console.log("🔍 [A2A-SIN Agent Discovery] Scanning GitHub organization...");

  // Get all repos from GitHub API
  let repos = [];
  try {
    const reposJson = run(
      `gh api orgs/${ORG}/repos --paginate -q '.[] | {name, description, topics: (try .topics catch []), pushed_at}'`
    );
    repos = reposJson.split("\n").filter(Boolean).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch (e) {
    console.error(`❌ Failed to fetch repos: ${e.message}`);
    // Fallback: scan local repos
    console.log("🔄 Falling back to local repo scan...");
    const localRepos = run(`find /Users/jeremy/dev -maxdepth 1 -type d -name "A2A-SIN-*" -o -name "Team-SIN-*" -o -name "Biz-SIN-*" -o -name "CLI-SIN-*" -o -name "MCP-SIN-*" -o -name "Plugin-SIN-*" -o -name "Skill-SIN-*" -o -name "Template-SIN-*"`);
    repos = localRepos.split("\n").filter(Boolean).map((p) => ({
      name: path.basename(p),
      localPath: p,
      description: "",
      topics: [],
      pushed_at: null,
    }));
  }

  console.log(`📦 Found ${repos.length} repos in ${ORG}`);

  const agents = [];

  for (const repo of repos) {
    const name = repo.name;
    const description = repo.description || "";
    const topics = repo.topics || [];

    // Skip non-agent repos
    if (
      !name.startsWith("A2A-SIN-") &&
      !name.startsWith("Team-SIN-") &&
      !name.startsWith("Biz-SIN-") &&
      !name.startsWith("CLI-SIN-") &&
      !name.startsWith("MCP-SIN-") &&
      !name.startsWith("Plugin-SIN-") &&
      !name.startsWith("Skill-SIN-") &&
      !name.startsWith("Template-SIN-")
    ) {
      continue;
    }

    const type = detectType(name, description, topics);

    // Try to read local agent.json
    let agentJson = null;
    const localAgentJson = path.join("/Users/jeremy/dev", name, "agent.json");
    if (existsSync(localAgentJson)) {
      try {
        agentJson = JSON.parse(readFileSync(localAgentJson, "utf8"));
      } catch {}
    }

    // Try to read local README
    let readme = "";
    const localReadme = path.join("/Users/jeremy/dev", name, "README.md");
    if (existsSync(localReadme)) {
      readme = readFileSync(localReadme, "utf8").slice(0, 2000); // First 2000 chars
    }

    const capabilities = extractCapabilities(name, description, topics, readme, agentJson);
    const triggers = detectTriggers(name, description, readme, agentJson);

    agents.push({
      name,
      type,
      description: description || agentJson?.description || "No description",
      capabilities,
      triggers,
      topics,
      githubUrl: `https://github.com/${ORG}/${name}`,
      lastUpdated: repo.pushed_at || null,
      metadata: agentJson?.metadata || {},
    });
  }

  // Sort by type then name
  agents.sort((a, b) => {
    const typeOrder = { team: 0, "a2a-agent": 1, mcp: 2, cli: 3, plugin: 4, skill: 5, business: 6, worker: 7, template: 8, unknown: 9 };
    const ta = typeOrder[a.type] ?? 9;
    const tb = typeOrder[b.type] ?? 9;
    if (ta !== tb) return ta - tb;
    return a.name.localeCompare(b.name);
  });

  const registry = {
    version: "dynamic-discovery-v1",
    generatedAt: new Date().toISOString(),
    org: ORG,
    totalAgents: agents.length,
    agents,
    // Index by capability for fast lookup
    byCapability: {},
    // Index by trigger keyword for fast lookup
    byTrigger: {},
  };

  // Build capability index
  for (const agent of agents) {
    for (const cap of agent.capabilities) {
      if (!registry.byCapability[cap]) registry.byCapability[cap] = [];
      registry.byCapability[cap].push(agent.name);
    }
    for (const trigger of agent.triggers) {
      if (!registry.byTrigger[trigger]) registry.byTrigger[trigger] = [];
      registry.byTrigger[trigger].push(agent.name);
    }
  }

  // Write to .pcpm
  const outDir = path.dirname(OUTPUT_PATH);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(registry, null, 2));

  console.log(`✅ Agent Registry built: ${agents.length} agents`);
  console.log(`📋 Saved to: ${OUTPUT_PATH}`);
  console.log(`🔗 Capabilities: ${Object.keys(registry.byCapability).join(", ")}`);

  return registry;
}

// Run if called directly
if (process.argv[1] && process.argv[1].includes("discover-agents")) {
  discoverAgents().then((registry) => {
    // Also print routing hints
    console.log("\n🧠 QUICK ROUTING GUIDE:");
    for (const [trigger, agentNames] of Object.entries(registry.byTrigger)) {
      console.log(`  "${trigger}" → ${agentNames.join(", ")}`);
    }
  }).catch(console.error);
}

export { discoverAgents, CAPABILITY_KEYWORDS };
