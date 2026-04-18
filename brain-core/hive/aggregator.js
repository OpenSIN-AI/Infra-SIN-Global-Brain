/**
 * VoiceAggregator — N parallel worker outputs collapse into one user-facing
 * response. The end user sees ONE voice even though 50 agents worked.
 *
 * Default strategy (deterministic, no LLM required):
 *   - Group node outputs by their declared "role" (plan / research / code /
 *     test / ...). Unknown roles become plain sections.
 *   - Weight by worker-reported confidence (default 1.0).
 *   - Emit a markdown-structured answer with a "tldr" synthesized from the
 *     highest-confidence plan + any findings tagged `headline: true`.
 *   - Preserve trace metadata (which agent did what, in what order, how long)
 *     so the orchestrator can write a reflection entry.
 *
 * A capability-based aggregator (e.g. a high-quality LLM rewriter) can be
 * plugged in via the orchestrator's `voice` parameter — when set, the
 * orchestrator dispatches the collected nodes to that capability instead of
 * using the default aggregator.
 */
export function aggregate({ prompt, nodes = [], primeAgentId = "prime", voice = "default" }) {
  const byRole = new Map();
  for (const n of nodes) {
    if (!n || n.status !== "ok") continue;
    const role = n.capability ?? "unknown";
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role).push(n);
  }

  // tldr: the single highest-confidence "plan" output, or the first finding
  // marked as headline, or the single non-plan result if exactly one exists.
  let tldr = null;
  const plans = (byRole.get("plan") ?? []).slice().sort((a, b) => (b.confidence ?? 1) - (a.confidence ?? 1));
  if (plans.length) tldr = summarise(plans[0].result);
  else {
    for (const arr of byRole.values()) {
      const h = arr.find((n) => n.result?.headline === true);
      if (h) { tldr = summarise(h.result); break; }
    }
  }
  if (!tldr) {
    const flat = [...byRole.values()].flat();
    if (flat.length === 1) tldr = summarise(flat[0].result);
  }

  // Markdown body
  const sections = [];
  const orderedRoles = ["plan", "research", "design", "code", "test", "risk", "summary"];
  const roles = [...byRole.keys()].sort((a, b) => {
    const ia = orderedRoles.indexOf(a);
    const ib = orderedRoles.indexOf(b);
    const sa = ia === -1 ? 99 : ia;
    const sb = ib === -1 ? 99 : ib;
    return sa - sb;
  });
  for (const role of roles) {
    const arr = byRole.get(role);
    const header = `### ${prettyRole(role)}`;
    const bullets = arr
      .sort((a, b) => (b.confidence ?? 1) - (a.confidence ?? 1))
      .map((n) => {
        const conf = n.confidence != null ? ` _(conf=${n.confidence.toFixed(2)}, ${n.agentId})_` : ` _(${n.agentId})_`;
        return `- ${summarise(n.result)}${conf}`;
      })
      .join("\n");
    sections.push(`${header}\n${bullets}`);
  }

  const body = [
    tldr ? `**TL;DR** — ${tldr}` : null,
    ...sections
  ].filter(Boolean).join("\n\n");

  // Aggregate confidence = weighted average
  let wSum = 0, w = 0;
  for (const n of nodes) {
    if (n.status !== "ok") continue;
    const c = n.confidence ?? 1;
    wSum += c;
    w += 1;
  }
  const confidence = w === 0 ? 0 : +(wSum / w).toFixed(3);

  return {
    answer: body || `${prompt}\n\n(no worker returned a result)`,
    tldr,
    confidence,
    primeAgentId,
    voice,
    trace: nodes.map((n) => ({
      id: n.id,
      capability: n.capability,
      agentId: n.agentId,
      status: n.status,
      latencyMs: n.latencyMs,
      confidence: n.confidence ?? null,
      error: n.error ?? null
    }))
  };
}

function summarise(result) {
  if (result == null) return "(empty)";
  if (typeof result === "string") return result.length > 400 ? `${result.slice(0, 400)}…` : result;
  if (typeof result === "object") {
    if (typeof result.summary === "string") return result.summary;
    if (typeof result.text === "string") return result.text.length > 400 ? `${result.text.slice(0, 400)}…` : result.text;
    try { return JSON.stringify(result).slice(0, 300); } catch { return "(unserialisable)"; }
  }
  return String(result);
}

function prettyRole(r) {
  const map = { plan: "Plan", research: "Research", design: "Design", code: "Implementation", test: "Verification", risk: "Risks", summary: "Summary" };
  return map[r] ?? r.replace(/(^|-)([a-z])/g, (_, p, c) => (p ? " " : "") + c.toUpperCase());
}
