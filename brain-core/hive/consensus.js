import { createHash, randomUUID } from "node:crypto";

/**
 * ConsensusEngine — the collective upgrade path for canon.
 *
 * Workflow:
 *   1. Any agent proposes a rule: `propose({type, text, tags, projectId})`.
 *   2. Other agents vote: `vote(id, {agentId, projectId, verdict})`.
 *      Verdicts: "agree" | "reject".
 *   3. When a proposal reaches the quorum (≥ 3 distinct agents agreeing from
 *      ≥ 2 distinct projects, with ≤ 1 reject), the engine commits it as a
 *      regular (non-ultra) rule via `store.addKnowledge`. The AutoPromoter's
 *      normal thresholds then decide if it ever becomes ultra.
 *
 * Dedup: if two proposals share the same `text + type + scope`, the second is
 * merged into the first (votes on either count for both). This prevents the
 * same idea from being crowdsourced under three slightly different names.
 *
 * Expiry: proposals that don't hit quorum within `ttlMs` are auto-rejected.
 */
const DEFAULTS = {
  minAgents: 3,
  minProjects: 2,
  maxRejects: 1,
  ttlMs: 7 * 24 * 60 * 60_000 // 7 days
};

export class ConsensusEngine {
  constructor({ store, events, metrics, config = {}, generateEmbedding } = {}) {
    this.store = store;
    this.events = events;
    this.metrics = metrics;
    this.cfg = { ...DEFAULTS, ...config };
    this.generateEmbedding = generateEmbedding ?? (async () => []);
    // id -> proposal
    this.proposals = new Map();
    // fingerprint -> id (for dedup)
    this.byFingerprint = new Map();
  }

  _fingerprint(type, scope, text) {
    return createHash("sha1").update(`${type}|${scope}|${text.trim().toLowerCase()}`).digest("hex");
  }

  propose({ agentId, projectId = "global", type = "rule", scope = "global", text, tags = [], reason = null }) {
    if (!agentId || !text) throw new Error("consensus.propose requires agentId + text");
    const fp = this._fingerprint(type, scope, text);
    const existingId = this.byFingerprint.get(fp);
    if (existingId) {
      const p = this.proposals.get(existingId);
      if (p && p.status === "pending") {
        // attach proposer as auto-agree if they aren't already present
        if (!p.votes.some((v) => v.agentId === agentId)) {
          p.votes.push({ agentId, projectId, verdict: "agree", reason: reason ?? "re-propose", at: Date.now() });
        }
        this.events?.emit({ kind: "hive.proposal.dup", summary: `dup proposal merged into ${existingId}`, payload: { id: existingId } });
        return this._maybeCommit(p);
      }
    }

    const id = randomUUID();
    const proposal = {
      id,
      fingerprint: fp,
      agentId,
      projectId,
      type,
      scope,
      text,
      tags,
      reason,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.cfg.ttlMs,
      status: "pending",
      votes: [{ agentId, projectId, verdict: "agree", reason: reason ?? "proposer", at: Date.now() }]
    };
    this.proposals.set(id, proposal);
    this.byFingerprint.set(fp, id);
    this.metrics?.inc("brain_hive_proposals_total", { type });
    this.events?.emit({
      kind: "hive.proposal",
      summary: `proposal ${id} by ${agentId}: ${text.slice(0, 60)}`,
      payload: { id, type, text, projectId, agentId }
    });
    return this._maybeCommit(proposal);
  }

  vote(proposalId, { agentId, projectId = "global", verdict, reason = null }) {
    const p = this.proposals.get(proposalId);
    if (!p) return { ok: false, error: "unknown proposal" };
    if (p.status !== "pending") return { ok: false, error: `proposal ${p.status}`, status: p.status };
    if (!["agree", "reject"].includes(verdict)) return { ok: false, error: "verdict must be agree|reject" };
    const existing = p.votes.find((v) => v.agentId === agentId);
    if (existing) existing.verdict = verdict;
    else p.votes.push({ agentId, projectId, verdict, reason, at: Date.now() });
    this.metrics?.inc("brain_hive_votes_total", { verdict });
    this.events?.emit({
      kind: "hive.vote",
      summary: `${agentId} ${verdict} ${proposalId}`,
      payload: { proposalId, agentId, verdict }
    });
    return this._maybeCommit(p);
  }

  async _maybeCommit(p) {
    const tally = this._tally(p);
    if (tally.rejects > this.cfg.maxRejects) {
      p.status = "rejected";
      this.metrics?.inc("brain_hive_proposals_rejected_total");
      this.events?.emit({ kind: "hive.proposal.rejected", summary: `rejected ${p.id}`, payload: { id: p.id, tally } });
      return { ok: true, id: p.id, status: "rejected", tally };
    }
    if (tally.agreeAgents >= this.cfg.minAgents && tally.agreeProjects >= this.cfg.minProjects) {
      const ruleId = await this._commit(p);
      p.status = "promoted";
      p.ruleId = ruleId;
      this.metrics?.inc("brain_hive_proposals_promoted_total");
      this.events?.emit({
        kind: "hive.proposal.promoted",
        summary: `promoted ${p.id} → rule ${ruleId}`,
        payload: { id: p.id, ruleId, tally }
      });
      return { ok: true, id: p.id, status: "promoted", ruleId, tally };
    }
    return { ok: true, id: p.id, status: "pending", tally };
  }

  _tally(p) {
    const agreeAgents = new Set();
    const agreeProjects = new Set();
    const rejectAgents = new Set();
    for (const v of p.votes) {
      if (v.verdict === "agree") {
        agreeAgents.add(v.agentId);
        agreeProjects.add(v.projectId);
      } else if (v.verdict === "reject") {
        rejectAgents.add(v.agentId);
      }
    }
    return {
      agrees: agreeAgents.size,
      rejects: rejectAgents.size,
      agreeAgents: agreeAgents.size,
      agreeProjects: agreeProjects.size,
      votes: p.votes.length
    };
  }

  async _commit(p) {
    const id = `consensus:${p.fingerprint.slice(0, 12)}`;
    const now = new Date().toISOString();
    let embedding = [];
    try { embedding = await this.generateEmbedding(p.text); } catch { /* optional */ }

    const entry = {
      id,
      type: p.type,
      scope: p.scope,
      text: p.text,
      tags: ["consensus", ...p.tags],
      status: "active",
      score: 1,
      usageCount: 0,
      successCount: 0,
      source: {
        origin: "consensus",
        proposalId: p.id,
        proposer: p.agentId,
        projects: [...new Set(p.votes.filter((v) => v.verdict === "agree").map((v) => v.projectId))]
      },
      createdAt: now,
      updatedAt: now,
      embedding
    };
    await this.store.addKnowledge(entry, { actor: "consensus" });
    return id;
  }

  status(id) {
    const p = this.proposals.get(id);
    if (!p) return { ok: false, error: "unknown" };
    return { ok: true, proposal: { ...p, tally: this._tally(p) } };
  }

  list({ status = "pending", limit = 50 } = {}) {
    const out = [];
    for (const p of this.proposals.values()) {
      if (status && p.status !== status) continue;
      out.push({ id: p.id, type: p.type, text: p.text, status: p.status, tally: this._tally(p), createdAt: p.createdAt });
    }
    return out.slice(0, limit);
  }

  expireOld(now = Date.now()) {
    let expired = 0;
    for (const p of this.proposals.values()) {
      if (p.status !== "pending") continue;
      if (p.expiresAt < now) { p.status = "expired"; expired += 1; }
    }
    return expired;
  }
}
