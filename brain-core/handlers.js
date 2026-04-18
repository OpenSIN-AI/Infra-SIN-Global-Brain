/**
 * Brain handlers — one per logical operation, transport-agnostic.
 *
 * The goal is: whatever an agent asks for, it returns in a single round-trip
 * with every piece of context it needs to act — so the agent never has to
 * think about "where do I get this".
 *
 * v4: every handler observes latency into the metrics registry; `ingest`
 * runs the MetaLearner's online dedup before committing, so the brain
 * never writes a row it already has.
 */

import { createStableId } from "../src/lib/storage.js";
import { generateEmbedding } from "../src/engines/embedding-engine.js";

export function createHandlers({ store, bridge, promoter, metaLearner, governance, pendingStore, metrics, events }) {
  const timed = (name, labels, fn) => async (...args) => {
    const t0 = performance.now();
    try {
      const out = await fn(...args);
      metrics?.observe(name, performance.now() - t0, labels);
      return out;
    } catch (err) {
      metrics?.inc(`${name.replace(/_ms$/, "_errors_total")}`, labels);
      throw err;
    }
  };

  return {
    async attach({ projectId, agentId, goal }) {
      return timed("brain_attach_ms", { project: projectId ?? "?" }, async () => {
        if (!projectId) throw new Error("projectId required");
        metrics?.inc("brain_attaches_total", { project: projectId });

        const ultras = store.rules({ scope: "all", projectId });
        const decisions = store.entriesByType("decision")
          .filter((e) => e.source?.projectId === projectId)
          .slice(0, 20);
        const mistakes = store.entriesByType("mistake")
          .filter((e) => e.source?.projectId === projectId)
          .slice(0, 20);
        const forbidden = store.entriesByType("forbidden")
          .filter((e) => e.scope === "global" || e.source?.projectId === projectId);

        // Surface contradictions in the prime-context so agents can warn.
        const contradictions = [];
        for (const r of ultras) {
          if (r.contradictsWith?.length) {
            contradictions.push({ id: r.id, conflictsWith: r.contradictsWith });
          }
        }

        return {
          brain: "one-brain/v4",
          attachedAt: new Date().toISOString(),
          projectId,
          agentId: agentId ?? null,
          goal: goal ?? null,
          eventsSubject: `brain.events.${projectId}`,
          primeContext: {
            ultraRules: ultras.filter((e) => e.ultra === true),
            rules: ultras.filter((e) => e.ultra !== true).slice(0, 40),
            decisions,
            mistakes,
            forbidden,
            contradictions
          },
          stats: store.stats()
        };
      })();
    },

    async ask({ query, projectId, types, limit = 8 }) {
      return timed("brain_ask_ms", { project: projectId ?? "?" }, async () => {
        if (!query) throw new Error("query required");
        metrics?.inc("brain_asks_total", { project: projectId ?? "?" });

        let vector = null;
        try {
          vector = await generateEmbedding(query);
        } catch { /* fall back to substring */ }

        let hits = [];
        if (vector) {
          hits = await store.vectorSearch(vector, { limit: limit * 2 });
        } else {
          const q = String(query).toLowerCase();
          for (const entry of store.cache.entries.values()) {
            if (entry.status !== "active") continue;
            if (entry.text.toLowerCase().includes(q)) {
              hits.push({ id: entry.id, score: 1, entry });
            }
          }
        }
        let filtered = hits;
        if (projectId) {
          filtered = filtered.filter(
            (h) => h.entry.scope === "global" || h.entry.source?.projectId === projectId
          );
        }
        if (types?.length) {
          const typeSet = new Set(types);
          filtered = filtered.filter((h) => typeSet.has(h.entry.type));
        }
        metrics?.set("brain_ask_hits_last", filtered.length);
        return {
          query,
          ultraRules: store.rules({ projectId }).filter((e) => e.ultra === true),
          hits: filtered.slice(0, limit).map((h) => ({
            id: h.id,
            score: h.score,
            type: h.entry.type,
            scope: h.entry.scope,
            text: h.entry.text,
            ultra: h.entry.ultra === true
          }))
        };
      })();
    },

    async rules({ projectId, scope = "all" }) {
      return {
        rules: store.rules({ projectId, scope }),
        appliedSeq: store.cache.appliedSeq
      };
    },

    async ingest({ projectId, entry, actor }) {
      return timed("brain_ingest_ms", { project: projectId ?? "?" }, async () => {
        if (!entry?.text || !entry?.type) throw new Error("entry.text and entry.type required");
        metrics?.inc("brain_ingests_total", { project: projectId ?? "?", type: entry.type });

        const enriched = {
          id: entry.id ?? createStableId(entry.type),
          type: entry.type,
          text: entry.text,
          topic: entry.topic ?? null,
          status: "active",
          scope: entry.scope ?? (entry.type === "rule" || entry.type === "solution" ? "global" : "project"),
          score: entry.score ?? 1,
          tags: entry.tags ?? [],
          source: { projectId, ...(entry.source ?? {}) },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          usageCount: 0,
          successCount: 0,
          ultra: false
        };
        try {
          enriched.embedding = await generateEmbedding(enriched.text);
        } catch { /* optional */ }

        // Online semantic dedup — skip insert if we already know this.
        if (metaLearner) {
          const dedup = await metaLearner.maybeDedup(enriched);
          if (dedup.merged) {
            return { id: dedup.into, dedup: true, sim: dedup.sim };
          }
        }

        // Governance / drift gate — catch polarity-flipping ingest before commit.
        if (governance && pendingStore) {
          const verdict = await governance.evaluate(enriched);
          if (verdict.action === "pending-review") {
            const pending = pendingStore.add({
              entry: enriched,
              conflicts: verdict.conflicts,
              actor: actor ?? "agent",
              reason: verdict.reason
            });
            metrics?.set("brain_governance_pending", pendingStore.stats().pending);
            return {
              id: enriched.id,
              pendingReview: true,
              pendingId: pending.id,
              reason: verdict.reason,
              conflicts: verdict.conflicts
            };
          }
        }

        await store.addKnowledge(enriched, { actor: actor ?? "agent" });
        if (projectId) bridge.scheduleMirror(projectId);
        return { id: enriched.id, scope: enriched.scope, dedup: false };
      })();
    },

    async sessionEnd({ projectId, agentId, consultedRuleIds = [], success = true, summary = null }) {
      const payload = {
        projectId,
        agentId,
        consultedRuleIds,
        success,
        summary,
        endedAt: new Date().toISOString()
      };
      await store.commitSession(payload, { actor: agentId ?? "agent" });
      promoter.observeSession(payload);
      metrics?.inc("brain_sessions_total", { success: String(!!success) });
      return { ok: true, consulted: consultedRuleIds.length };
    },

    stats() {
      return { ...store.stats(), ts: new Date().toISOString() };
    },

    /** Rich snapshot for the dashboard — store + metrics in one call. */
    statsRich() {
      return {
        store: store.stats(),
        metrics: metrics?.snapshot() ?? { counters: {}, gauges: {}, histograms: {} },
        host: process.env.BRAIN_HTTP_HOST ?? "0.0.0.0",
        ts: new Date().toISOString()
      };
    },

    async adminTick() {
      const promoted = await promoter.tick();
      if (promoted.promoted?.length) metrics?.inc("brain_promotions_total", {}, promoted.promoted.length);
      if (promoted.demoted?.length) metrics?.inc("brain_demotions_total", {}, promoted.demoted.length);
      return promoted;
    },

    async adminMetaTick() {
      if (!metaLearner) return { contradictions: 0, decayed: 0 };
      return metaLearner.tick();
    },

    /**
     * diagnose — single endpoint that runs every reflexive check and
     * returns a health report. Useful for ops dashboards and CI.
     */
    async diagnose() {
      const s = store.stats();
      const promote = await promoter.tick();
      const meta = metaLearner ? await metaLearner.tick() : { contradictions: 0, decayed: 0 };
      return {
        store: s,
        autoPromoter: promote,
        metaLearner: meta,
        ts: new Date().toISOString()
      };
    },

    // ---- governance / drift gate review ----

    reviewList({ status = "pending", limit = 50 } = {}) {
      if (!pendingStore) throw new Error("pending store not configured");
      return {
        items: pendingStore.list({ status, limit }),
        stats: pendingStore.stats()
      };
    },

    reviewStats() {
      if (!pendingStore) throw new Error("pending store not configured");
      return pendingStore.stats();
    },

    async reviewApprove({ id, reviewer = "human", note = null }) {
      if (!pendingStore) throw new Error("pending store not configured");
      if (!id) throw new Error("id required");
      const approved = pendingStore.approve({ id, reviewer, note });
      // Commit the previously-held entry into the brain.
      await store.addKnowledge(approved.entry, { actor: reviewer ?? "human" });
      if (approved.entry.source?.projectId) {
        bridge.scheduleMirror(approved.entry.source.projectId);
      }
      metrics?.inc("brain_governance_approved_total", { type: approved.entry.type });
      metrics?.set("brain_governance_pending", pendingStore.stats().pending);
      events?.emit({
        kind: "governance.approved",
        projectId: approved.entry.source?.projectId ?? "global",
        summary: `approved ${approved.entry.type} ${approved.entry.id} by ${reviewer}`,
        payload: { pendingId: id, entryId: approved.entry.id, reviewer }
      });
      return { id, committed: approved.entry.id, reviewer };
    },

    reviewReject({ id, reviewer = "human", reason = null }) {
      if (!pendingStore) throw new Error("pending store not configured");
      if (!id) throw new Error("id required");
      const rejected = pendingStore.reject({ id, reviewer, reason });
      metrics?.inc("brain_governance_rejected_total", { type: rejected.entry.type });
      metrics?.set("brain_governance_pending", pendingStore.stats().pending);
      events?.emit({
        kind: "governance.rejected",
        projectId: rejected.entry.source?.projectId ?? "global",
        summary: `rejected ${rejected.entry.type} by ${reviewer}${reason ? ` (${reason})` : ""}`,
        payload: { pendingId: id, entryId: rejected.entry.id, reviewer, reason }
      });
      return { id, rejected: rejected.entry.id, reviewer, reason };
    },

    async seedUltra({ entry, actor = "seeder", reason = "authored" }) {
      if (!entry?.id || !entry?.type || !entry?.text) {
        throw new Error("seedUltra requires entry.id, entry.type, entry.text");
      }
      const enriched = {
        id: entry.id,
        type: entry.type,
        text: entry.text,
        topic: entry.topic ?? null,
        status: "active",
        scope: entry.scope ?? "global",
        score: entry.score ?? 1,
        priority: entry.priority ?? null,
        tags: entry.tags ?? [],
        source: entry.source ?? { origin: "seed" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        usageCount: 0,
        successCount: 0,
        ultra: true,
        dedup: false,
        ultraPromotion: {
          reason,
          heading: entry.heading ?? null,
          priority: entry.priority ?? null,
          promotedAt: new Date().toISOString()
        }
      };
      try {
        enriched.embedding = await generateEmbedding(enriched.text);
      } catch { /* embeddings optional */ }

      await store.addKnowledge(enriched, { actor });
      await store.promoteRule(enriched.id, enriched.ultraPromotion, { actor });
      metrics?.inc("brain_seeds_total");
      return { id: enriched.id, ultra: true, priority: enriched.priority };
    }
  };
}
