export { createRepositoryLayout, createProjectBrainLayout } from "./lib/layout.js";
export { runOrchestration } from "./engines/orchestrator-engine.js";
export { buildInitialPlan, applyPlanUpdate, loadLatestPlan, savePlanVersion } from "./engines/plan-engine.js";
export { ensureGoal, loadGoal } from "./engines/goal-engine.js";
export { loadMergedKnowledge, applyMemoryUpdate } from "./engines/memory-engine.js";
export {
  appendSessionMessage,
  loadSessionMessages,
  loadSessionSummary,
  writeSessionSummary
} from "./engines/session-engine.js";
export { extractKnowledgeFromMessages, extractAndApplyTranscriptKnowledge } from "./engines/transcript-engine.js";
export { pullFromProjectBrain, bidirectionalSync } from "./engines/bidi-sync-engine.js";
export { setupProjectHooks, detectExistingHooks } from "./engines/hook-engine.js";
