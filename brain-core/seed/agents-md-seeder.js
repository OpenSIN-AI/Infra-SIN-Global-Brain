/**
 * AGENTS.md → Ultra-Canon Seeder
 *
 * Parses AGENTS.md, picks every section that carries an explicit
 * PRIORITY marker (e.g. `PRIORITY -10.0`, `PRIORITY -9.0`, `PRIORITY 00`)
 * and seeds it into the daemon via the privileged `/admin/seed` endpoint
 * as an ultra rule.
 *
 * Design notes:
 * - Seeding is intentionally idempotent — id is derived from the heading so
 *   rerunning never duplicates.
 * - We don't try to parse the whole document as rules. Only authored
 *   priority sections become canon; everything else is documentation.
 * - Priority 00 is normalised to -10 (both exist in the source today for
 *   historical reasons — both mean "highest importance").
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Parse AGENTS.md into H1 sections, tagging each with the priority marker
 * found in its heading (if any).
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
        // "00" in the source means "super-high"; normalise to -10.
        if (/^0+$/.test(raw)) priority = -10;
        else if (/^\d{2,}$/.test(raw) && !raw.startsWith("-")) priority = -parseFloat(raw);
        else priority = parseFloat(raw);
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
 * Pull a short imperative statement out of a section. Preference order:
 *  1. first bold-wrapped sentence between 20 and 400 chars
 *  2. first bullet item
 *  3. first non-empty, non-code, non-table line > 20 chars
 *  4. the heading itself
 */
function extractStatement(section) {
  const text = section.lines.join("\n");
  const bold = text.match(/\*\*([^*]+?)\*\*/);
  if (bold && bold[1].length >= 20 && bold[1].length <= 400) return bold[1].trim();
  for (const raw of section.lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("```") || line.startsWith("|") || line.startsWith("#")) continue;
    if (line.startsWith("- ") || line.startsWith("* ")) {
      const stripped = line.replace(/^[-*]\s+/, "").trim();
      if (stripped.length >= 20) return stripped.slice(0, 400);
    }
    if (line.length >= 20) return line.slice(0, 400);
  }
  return section.heading;
}

function stableId(heading) {
  return `ultra-canon-${crypto.createHash("sha1").update(heading).digest("hex").slice(0, 12)}`;
}

/**
 * Seed ultra rules into the brain from AGENTS.md.
 *
 * @param {object} opts
 * @param {string} opts.agentsMdPath
 * @param {string} opts.brainUrl                http endpoint of the daemon
 * @param {number} [opts.maxPriority=-4]        seed sections with priority <= this
 *                                              (lower = more important)
 * @param {number} [opts.detailBytes=4000]      max bytes of section body to keep
 * @returns {Promise<Array<{id,heading,priority,ok,error?}>>}
 */
export async function seedFromAgentsMd({
  agentsMdPath,
  brainUrl,
  maxPriority = -4,
  detailBytes = 4000
}) {
  const text = fs.readFileSync(agentsMdPath, "utf8");
  const sections = parseAgentsMd(text);
  const canonical = sections.filter(
    (s) => s.priority !== null && s.priority <= maxPriority
  );

  const results = [];
  for (const section of canonical) {
    const id = stableId(section.heading);
    const statement = extractStatement(section);
    const detail = section.lines.join("\n").trim().slice(0, detailBytes);

    const payload = {
      entry: {
        id,
        type: "rule",
        text: statement,
        topic: "canon",
        scope: "global",
        priority: section.priority,
        tags: ["canon", "seeded", "agents-md"],
        source: {
          origin: "AGENTS.md",
          heading: section.heading,
          detail
        },
        heading: section.heading
      },
      actor: "seed:agents-md",
      reason: `priority ${section.priority} canon`
    };

    try {
      const res = await fetch(`${brainUrl}/admin/seed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        results.push({ id, heading: section.heading, priority: section.priority, ok: false, error: json.error ?? `HTTP ${res.status}` });
      } else {
        results.push({ id, heading: section.heading, priority: section.priority, ok: true });
      }
    } catch (err) {
      results.push({ id, heading: section.heading, priority: section.priority, ok: false, error: err.message });
    }
  }

  return results;
}

// CLI entry: node brain-core/seed/agents-md-seeder.js [path]
if (import.meta.url === `file://${process.argv[1]}`) {
  const brainUrl = process.env.BRAIN_URL || "http://127.0.0.1:7070";
  const agentsMdPath = process.argv[2] || path.resolve(process.cwd(), "AGENTS.md");
  const maxPriority = process.env.MAX_PRIORITY ? parseFloat(process.env.MAX_PRIORITY) : -4;

  seedFromAgentsMd({ agentsMdPath, brainUrl, maxPriority })
    .then((results) => {
      const ok = results.filter((r) => r.ok).length;
      console.log(`[seed] ${ok}/${results.length} ultra rules seeded from ${agentsMdPath}`);
      for (const r of results) {
        const mark = r.ok ? "OK  " : "FAIL";
        const pri = String(r.priority).padStart(5);
        const head = r.heading.length > 72 ? r.heading.slice(0, 69) + "..." : r.heading;
        console.log(`  ${mark}  P${pri}  ${head}${r.error ? `  (${r.error})` : ""}`);
      }
      if (ok !== results.length) process.exit(1);
    })
    .catch((err) => {
      console.error("[seed] fatal:", err.message);
      process.exit(1);
    });
}
