// Seeder — parses AGENTS.md priority sections and ingests them into the brain
// as *ultra* rules. These become the initial canon every attached agent
// receives on attach(). Idempotent: running it twice does not duplicate
// (id is derived from the section heading).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Parse AGENTS.md into priority-tagged sections.
 * A section starts with `# <heading>` and optionally carries a
 * `PRIORITY <n>` or `PRIORITY -<n.n>` marker in the heading.
 */
export function parseAgentsMd(text) {
  const lines = text.split("\n");
  const sections = [];
  let current = null;

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.*)$/);
    if (h1) {
      if (current) sections.push(current);
      const heading = h1[1].trim();
      const priMatch = heading.match(/PRIORITY\s*(-?\d+(?:\.\d+)?|\d{2,})/i);
      let priority = null;
      if (priMatch) {
        const raw = priMatch[1];
        priority = /^\d{2,}$/.test(raw) && !raw.startsWith("-") ? -parseFloat(raw) : parseFloat(raw);
      }
      current = { heading, priority, lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

/**
 * Extract the "verdict" of a section — the short imperative line that
 * captures the rule. We prefer the first bold sentence, fall back to
 * the first non-empty non-code line.
 */
function extractVerdict(section) {
  const text = section.lines.join("\n");
  const bold = text.match(/\*\*([^*]+?)\*\*/);
  if (bold && bold[1].length > 20 && bold[1].length < 400) return bold[1].trim();
  for (const raw of section.lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("```") || line.startsWith("|") || line.startsWith("#")) continue;
    if (line.startsWith("- ") || line.startsWith("* ")) return line.replace(/^[-*]\s+/, "").trim();
    if (line.length > 20) return line.slice(0, 400);
  }
  return section.heading;
}

function stableId(heading) {
  return `ultra-canon-${crypto.createHash("sha1").update(heading).digest("hex").slice(0, 12)}`;
}

/**
 * Seed ultra rules into the brain from AGENTS.md.
 *
 * Only sections with an explicit PRIORITY marker become ultra rules — so
 * seeding is a conscious, authored operation, not a grab-everything.
 *
 * @param {object} opts
 * @param {string} opts.agentsMdPath
 * @param {string} opts.brainUrl   HTTP endpoint of the daemon
 * @param {number} [opts.maxPriority]  only seed rules with priority <= this
 *                                     (lower = more important; default -3)
 */
export async function seedFromAgentsMd({ agentsMdPath, brainUrl, maxPriority = -3 }) {
  const text = fs.readFileSync(agentsMdPath, "utf8");
  const sections = parseAgentsMd(text);
  const canonical = sections.filter((s) => s.priority !== null && s.priority <= maxPriority);

  const results = [];
  for (const section of canonical) {
    const id = stableId(section.heading);
    const verdict = extractVerdict(section);
    const body = section.lines.join("\n").trim().slice(0, 4000);

    const payload = {
      id,
      type: "rule",
      payload: {
        scope: "global",
        priority: section.priority,
        statement: verdict,
        detail: body,
        source: "AGENTS.md",
        heading: section.heading,
        ultra: true,
        seededAt: new Date().toISOString()
      }
    };

    const res = await fetch(`${brainUrl}/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then((r) => r.json());

    results.push({ id, heading: section.heading, priority: section.priority, ok: res.ok });
  }

  return results;
}

// CLI entry: node brain-core/seed/agents-md-seeder.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const brainUrl = process.env.BRAIN_URL || "http://127.0.0.1:7451";
  const agentsMdPath = process.argv[2] || path.resolve(process.cwd(), "AGENTS.md");
  const maxPriority = process.env.MAX_PRIORITY ? parseFloat(process.env.MAX_PRIORITY) : -3;

  seedFromAgentsMd({ agentsMdPath, brainUrl, maxPriority })
    .then((results) => {
      console.log(`[seed] seeded ${results.filter((r) => r.ok).length}/${results.length} ultra rules from ${agentsMdPath}`);
      for (const r of results) {
        console.log(`  ${r.ok ? "OK" : "FAIL"}  P${r.priority}  ${r.heading.slice(0, 80)}`);
      }
    })
    .catch((err) => {
      console.error("[seed] failed:", err.message);
      process.exit(1);
    });
}
