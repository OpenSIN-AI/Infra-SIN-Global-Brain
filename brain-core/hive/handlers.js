/**
 * Hive handlers — transport-agnostic RPC surface for the hive layer.
 *
 * Every handler is a thin shim on top of the underlying engines. HTTP + NATS
 * both call into the same functions, so any new subject lights up both
 * transports without a second wiring pass.
 */
export function createHiveHandlers({ registry, scratchpad, broadcast, consensus, orchestrator, metrics }) {
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
    // ---- registry ----
    hiveRegister: (p) => registry.register(p),
    hiveHeartbeat: ({ agentId }) => registry.heartbeat(agentId),
    hiveUnregister: ({ agentId }) => registry.unregister(agentId),
    hiveAgents: () => ({ agents: registry.snapshot() }),
    hiveFind: ({ capability, topN = 3, exclude = [] }) => ({
      candidates: registry.find(capability, { topN, exclude })
    }),

    // ---- scratchpad ----
    scratchpadCreate: (p = {}) => scratchpad.create(p),
    scratchpadGet: ({ padId, key }) => scratchpad.get(padId, key),
    scratchpadSet: ({ padId, key, value, expectedVersion, actor }) =>
      scratchpad.set(padId, key, value, { expectedVersion, actor }),
    scratchpadAppend: ({ padId, key, chunk, actor }) =>
      scratchpad.append(padId, key, chunk, { actor }),
    scratchpadDestroy: ({ padId }) => ({ ok: scratchpad.destroy(padId) }),

    // ---- broadcast ----
    hiveBroadcast: (msg) => {
      const emitted = broadcast.emit(msg);
      return { ok: true, at: emitted.at };
    },
    hiveHistory: ({ runId }) => ({ history: broadcast.history(runId) }),

    // ---- consensus ----
    hivePropose: (p) => consensus.propose(p),
    hiveVote: ({ proposalId, ...rest }) => consensus.vote(proposalId, rest),
    hiveProposals: (p = {}) => ({ proposals: consensus.list(p) }),
    hiveProposalStatus: ({ id }) => consensus.status(id),

    // ---- orchestrator ----
    hiveOrchestrate: timed("brain_hive_orchestrate_ms", {}, (p) => orchestrator.orchestrate(p))
  };
}
