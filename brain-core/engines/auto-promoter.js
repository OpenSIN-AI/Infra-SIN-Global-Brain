/**
 * AutoPromoter — the self-curating meta layer.
 *
 * A rule becomes an Ultra-Rule (globally canonical, always wins) when ALL of:
 *   - type is "rule" or "solution"
 *   - usageCount    >= MIN_USES          (default 10)
 *   - successRate   >= MIN_SUCCESS_RATE  (default 0.9)
 *   - crossProjects >= MIN_PROJECTS      (default 3)
 *   - noConflicts   == true              (no matching invalidation in 30d)
 *
 * A rule is demoted when:
 *   - recent (30d) successRate < DEMOTE_RATE (default 0.6)
 *   - OR a newer entry of the same topic with higher score invalidates it
 *   - OR decay has pushed its score below DEMOTE_SCORE (default 0.35)
 *
 * Runs in two modes:
 *   observeSession() — cheap, O(|consultedRules|), updates per-rule stats
 *   tick()           — O(|rules|), evaluates thresholds, promotes/demotes
 */

const DEFAULTS = {
  MIN_USES: 10,
  MIN_SUCCESS_RATE: 0.9,
  MIN_PROJECTS: 3,
  CONFLICT_WINDOW_MS: 30 * 24 * 3600 * 1000,
  DEMOTE_RATE: 0.6,
  DEMOTE_SCORE: 0.35
};

export class AutoPromoter {
  constructor({ store, thresholds = {} } = {}) {
    this.store = store;
    this.t = { ...DEFAULTS, ...thresholds };
    // id -> { uses, successes, projects:Set, lastSeen }
    this.stats = new Map();
  }

  observeSession({ consultedRuleIds = [], success = true, projectId = null }) {
    const now = Date.now();
    for (const id of consultedRuleIds) {
      const s = this.stats.get(id) ?? {
        uses: 0,
        successes: 0,
        projects: new Set(),
        lastSeen: 0
      };
      s.uses += 1;
      if (success) s.successes += 1;
      if (projectId) s.projects.add(projectId);
      s.lastSeen = now;
      this.stats.set(id, s);

      // Also reflect into the entry itself so downstream ranking sees it.
      const entry = this.store.cache.entries.get(id);
      if (entry) {
        entry.usageCount = (entry.usageCount ?? 0) + 1;
        if (success) entry.successCount = (entry.successCount ?? 0) + 1;
        entry.lastUsedAt = new Date().toISOString();
      }
    }
  }

  async tick() {
    const promoted = [];
    const demoted = [];
    for (const entry of this.store.cache.entries.values()) {
      if (entry.status !== "active") continue;
      if (entry.type !== "rule" && entry.type !== "solution") continue;

      const stat = this.stats.get(entry.id);
      const uses = stat?.uses ?? entry.usageCount ?? 0;
      const successes = stat?.successes ?? entry.successCount ?? 0;
      const rate = uses > 0 ? successes / uses : 0;
      const projects = stat?.projects.size ?? (entry.source?.projectId ? 1 : 0);
      const recent = stat?.lastSeen ? Date.now() - stat.lastSeen : Infinity;
      const noRecentConflicts = !entry.invalidatedBy?.length
        || (entry.invalidatedAt
            ? Date.now() - Date.parse(entry.invalidatedAt) > this.t.CONFLICT_WINDOW_MS
            : true);

      // --- promote ---
      if (
        entry.ultra !== true &&
        uses >= this.t.MIN_USES &&
        rate >= this.t.MIN_SUCCESS_RATE &&
        projects >= this.t.MIN_PROJECTS &&
        noRecentConflicts
      ) {
        await this.store.promoteRule(entry.id, {
          uses,
          rate: +rate.toFixed(3),
          projects,
          promotedAt: new Date().toISOString()
        });
        promoted.push(entry.id);
        continue;
      }

      // --- demote ---
      if (
        entry.ultra === true &&
        (
          (uses >= this.t.MIN_USES && rate < this.t.DEMOTE_RATE) ||
          (entry.score ?? 1) < this.t.DEMOTE_SCORE ||
          !noRecentConflicts
        )
      ) {
        await this.store.demoteRule(entry.id, {
          reason: "threshold-fail",
          rate: +rate.toFixed(3),
          score: entry.score ?? 1
        });
        demoted.push(entry.id);
      }

      // mark stale so rankers can deprioritize
      if (recent > 90 * 24 * 3600 * 1000) entry.driftStatus = "watch";
    }

    if (promoted.length || demoted.length) {
      console.log(`[promoter] tick promoted=${promoted.length} demoted=${demoted.length}`);
    }
    return { promoted, demoted };
  }
}
