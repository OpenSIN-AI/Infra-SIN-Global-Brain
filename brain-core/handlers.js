/**
 * Brain handlers — one per logical operation, transport-agnostic.
 *
 * The goal is: whatever an agent asks for, it returns in a single round-trip
 * with every piece of context it needs to act — so the agent never has to
 * think about "where do I get this".
 */

import { createStableId } from "../src/lib/storage.js";
import { generateEmbedding } from "../src/engines/embedding-engine.js";

export function createHandlers({ store, bridge, promoter }) {
  return {
    /**
     * attach — an agent says "I'm working on project X, goal Y, give me
     * the prime-context". Returns everything in one payload so the client
     * can synchronously populate its working set.
     */
    async attach({ projectId, agentId, goal }) {
      if (!projectId) throw new Error("projectId required");
      const ultras = store.rules({ scope: "all", projectId });
      const decisions = store.entriesByType("decision")
        .filter((e) => e.source?.projectId === projectId)
        .slice(0, 20);
      const mistakes = store.entriesByType("mistake")
        .filter((e) => e.source?.projectId === projectId)
        .slice(0, 20);
      const forbidden = store.entriesByType("forbidden")
        .filter((e) => e.scope === "global" || e.source?.projectId === projectId);

      return {
        brain: "one-brain/v2",
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
          forbidden
        },
        stats: store.stats()
      };
    },

    /**
     * ask — generic retrieval. Given a natural-language query, embed,
     * vector-search, and return the top-N ranked entries plus any
     * ultra-rules that always apply.
     */
    async ask({ query, projectId, types, limit = 8 }) {
      if (!query) throw new Error("query required");
      let vector = null;
      try {
        vector = await generateEmbedding(query);
      } catch (err) {
        // Embedding may be unavailable in sandbox — fall back to substring
        // matching rather than crashing.
      }
      let hits = [];
      if (vector) {
        hits = store.vectorSearch(vector, { limit: limit * 2 });
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
    },

    async rules({ projectId, scope = "all" }) {
      return {
        rules: store.rules({ projectId, scope }),
        appliedSeq: store.cache.appliedSeq
      };
    },

    /**
     * ingest — agent pushes a newly discovered fact/decision/mistake.
     * We enrich, embed, and append. Auto-promoter scores asynchronously.
     */
    async ingest({ projectId, entry, actor }) {
      if (!entry?.text || !entry?.type) throw new Error("entry.text and entry.type required");
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
      await store.addKnowledge(enriched, { actor: actor ?? "agent" });
      if (projectId) bridge.scheduleMirror(projectId);
      return { id: enriched.id, scope: enriched.scope };
    },

    /**
     * sessionEnd — agent reports outcome, AutoPromoter uses this to score
     * the rules that were consulted.
     */
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
      return { ok: true, consulted: consultedRuleIds.length };
    },

    stats() {
      return { ...store.stats(), ts: new Date().toISOString() };
    },

    /**
     * adminTick — force the AutoPromoter to evaluate immediately. Used by
     * the smoke test and by ops when a rule landslide is pending.
     */
    async adminTick() {
      return promoter.tick();
    }
  };
}
