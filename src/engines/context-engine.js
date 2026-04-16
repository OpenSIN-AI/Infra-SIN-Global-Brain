/**
 * context-engine.js — Phase IV: Lossless Artifact Injection + Intent-Aware Context
 *
 * Erweiterungen:
 * 1. Lossless Artifact Injection — Base64-Bilder, rohe Logs, Metriken direkt ins Kontextfenster
 * 2. Intent-Aware Context Assembly — Zielgerichtete Kontext-Zusammenstellung
 * 3. Meta-Cognitive Context Injection — Confidence Thresholds + Judgment Leitplanken
 * 4. Mandatory Working Set Items — Hart injizierte Ground Truth vor LLM-Inferenz
 */

import { getForbiddenKnowledge, selectKnowledgeEntries } from "./memory-engine.js";
import { summarizePlan } from "./plan-engine.js";
import { buildRetrievalPlan as retrievePlan } from "./retrieval-planner.js";

/**
 * Lossless Artifact — repraesentiert ein unveraendertes Artefakt
 * das direkt ins Kontextfenster injiziert wird.
 *
 * @typedef {Object} LosslessArtifact
 * @property {string} id - Eindeutige Identifikator
 * @property {string} type - 'image', 'log', 'metric', 'raw_text'
 * @property {string} mimeType - MIME-Typ (z.B. 'image/jpeg', 'text/plain')
 * @property {string} data - Base64-kodierte Daten oder roher Text
 * @property {string} source - Herkunft des Artefakts
 * @property {number} size - Groesse in Bytes
 * @property {string} timestamp - Erstellungszeitpunkt
 */

/**
 * Injiziert Lossless Artefakte in den aktiven Kontext.
 * Bilder werden als Base64-Data-URIs kodiert, Logs als roher Text.
 *
 * @param {Object} context - Bestehender Kontext aus buildActiveContext
 * @param {Array<LosslessArtifact>} artifacts - Liste der zu injizierenden Artefakte
 * @returns {Object} Erweiterter Kontext mit artifacts-Array
 */
export function injectLosslessArtifacts(context, artifacts = []) {
  if (!artifacts || artifacts.length === 0) {
    return context;
  }

  return {
    ...context,
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id,
      type: artifact.type,
      mimeType: artifact.mimeType,
      // Base64-Data-URI fuer Bilder, roher Text fuer Logs
      content: artifact.type === "image"
        ? `data:${artifact.mimeType};base64,${artifact.data}`
        : artifact.data,
      source: artifact.source,
      size: artifact.size,
      timestamp: artifact.timestamp,
      // Flag fuer das LLM: Dieses Artefakt MUSS unberuehrt verarbeitet werden
      lossless: true
    })),
    // Hinweis fuer das LLM: Artefakte sind forensisch unveraendert
    artifactNotice: artifacts.length > 0
      ? `⚠️ ${artifacts.length} lossless artifact(s) injected — process original data without approximation`
      : null
  };
}

/**
 * Erstellt ein Image-Artefakt aus Base64-kodierten Bilddaten.
 * Typischerweise aus Screenshots des Ponder & Press Frameworks.
 *
 * @param {string} base64Data - Base64-kodierte Bilddaten
 * @param {string} mimeType - Bildtyp (z.B. 'image/jpeg')
 * @param {string} source - Herkunft (z.B. 'active-screenshot')
 * @returns {LosslessArtifact}
 */
export function createImageArtifact(base64Data, mimeType = "image/jpeg", source = "screenshot") {
  return {
    id: `artifact-img-${Date.now()}`,
    type: "image",
    mimeType,
    data: base64Data,
    source,
    size: Math.round(base64Data.length * 0.75),
    timestamp: new Date().toISOString()
  };
}

/**
 * Erstellt ein Log-Artefakt aus rohen Log-Daten.
 *
 * @param {string} logContent - Rohe Log-Inhalte
 * @param {string} source - Herkunft (z.B. 'console', 'server', 'browser')
 * @returns {LosslessArtifact}
 */
export function createLogArtifact(logContent, source = "system") {
  return {
    id: `artifact-log-${Date.now()}`,
    type: "log",
    mimeType: "text/plain",
    data: logContent,
    source,
    size: Buffer.byteLength(logContent, "utf8"),
    timestamp: new Date().toISOString()
  };
}

/**
 * Erstellt ein Metrik-Artefakt aus System-Metriken.
 *
 * @param {Object} metrics - Metrik-Daten (z.B. { cpu: 45, memory: 2048, latency: 120 })
 * @param {string} source - Herkunft
 * @returns {LosslessArtifact}
 */
export function createMetricArtifact(metrics, source = "system") {
  const content = JSON.stringify(metrics, null, 2);
  return {
    id: `artifact-metric-${Date.now()}`,
    type: "metric",
    mimeType: "application/json",
    data: content,
    source,
    size: Buffer.byteLength(content, "utf8"),
    timestamp: new Date().toISOString()
  };
}

/**
 * Erweiterte Kontext-Zusammenstellung mit Intent-Aware Retrieval.
 * Beruecksichtigt nicht nur aktive Eintraege, sondern auch:
 * - Mandatory Working Set Items (hart injizierte Ground Truth)
 * - Escalation Index fuer priorisierten Abruf
 * - Meta-Cognitive Confidence Thresholds
 *
 * @param {Object} params - goal, plan, knowledge, sessionSummary, options
 * @returns {Object} Erweiterter aktiver Kontext
 */
export function buildActiveContext({ goal, plan, knowledge, sessionSummary, options = {} }) {
  const activeKnowledge = knowledge.active ?? [];
  const {
    mandatoryItems = [],
    confidenceThreshold = 0.7,
    enableArtifacts = true,
    maxKnowledgePerType = 8
  } = options;

  // Escalation-Index-basierte Sortierung (wenn verfuegbar)
  const sortByEscalation = (entries) =>
    [...entries]
      .map((entry) => ({
        ...entry,
        escalationIndex: entry.escalationIndex ?? calculateSimplePriority(entry)
      }))
      .sort((a, b) => b.escalationIndex - a.escalationIndex)
      .slice(0, maxKnowledgePerType);

  return {
    generatedAt: new Date().toISOString(),
    goal: {
      id: goal.id,
      description: goal.description,
      constraints: goal.constraints ?? [],
      status: goal.status
    },
    plan: plan ? summarizePlan(plan) : null,
    memory: {
      rules: sortByEscalation(activeKnowledge.filter((e) => e.type === "rule")),
      decisions: sortByEscalation(activeKnowledge.filter((e) => e.type === "decision")),
      mistakes: sortByEscalation(activeKnowledge.filter((e) => e.type === "mistake")),
      solutions: sortByEscalation(activeKnowledge.filter((e) => e.type === "solution")),
      facts: sortByEscalation(activeKnowledge.filter((e) => e.type === "fact")),
      forbidden: getForbiddenKnowledge(activeKnowledge, { scope: "project" }).slice(0, maxKnowledgePerType),
      drifting: activeKnowledge.filter((entry) => entry.driftStatus === "watch" || entry.driftStatus === "stale").slice(0, maxKnowledgePerType)
    },
    session: sessionSummary
      ? {
          sessionId: sessionSummary.sessionId,
          messageCount: sessionSummary.messageCount,
          currentStrategy: sessionSummary.currentStrategy,
          invalidatedEntries: sessionSummary.invalidatedEntries,
          lastUserMessage: sessionSummary.lastUserMessage,
          lastAssistantMessage: sessionSummary.lastAssistantMessage
        }
      : null,
    // Mandatory Working Set Items — hart injizierte Ground Truth
    mandatory: mandatoryItems.length > 0 ? mandatoryItems : null,
    // Meta-Cognitive Confidence Threshold
    metaCognitive: {
      confidenceThreshold,
      instruction: confidenceThreshold < 1.0
        ? `If your confidence in the generated solution is below ${confidenceThreshold}, STOP execution and generate clarifying questions for the orchestrator.`
        : null
    },
    // Lossless Artifacts (optional, wird via injectLosslessArtifacts befuellt)
    artifacts: enableArtifacts ? [] : undefined
  };
}

/**
 * Vereinfachte Prioritaets-Berechnung fuer Eintraege ohne Escalation Index.
 * Fallback wenn invalidation-engine noch nicht den EI berechnet hat.
 *
 * @param {Object} entry - Knowledge Entry
 * @returns {number} Prioritaet (0.0 - 1.0)
 */
function calculateSimplePriority(entry) {
  const scoreWeight = (entry.score ?? 1) * 0.5;
  const recencyWeight = Math.max(0, 1 - ((entry.ageDays ?? 0) / 30)) * 0.3;
  const accessWeight = Math.min((entry.accessCount ?? 0) / 50, 1) * 0.2;
  return scoreWeight + recencyWeight + accessWeight;
}

/**
 * Erstellt einen Intent-Aware Retrieval Plan.
 * Delegiert an retrieval-planner.js für intent detection und planning.
 *
 * @param {string} task - Die auszuführende Aufgabe
 * @param {Object} context - Aktueller Kontext
 * @param {Object} knowledge - Verfügbares Wissen
 * @returns {Object} Retrieval-Plan mit Intent, Constraints, History, Graph-Hops
 */
export function buildRetrievalPlan(task, context, knowledge) {
  return retrievePlan(task, context);
}

// ============================================================================
// BESTEHENDE FUNKTION (unveraendert übernommen)
// ============================================================================

export function buildExecutionPrompt({ goal, plan, context, task }) {
  const contextJson = JSON.stringify(context, null, 2);

  return [
    "SYSTEM:",
    "You are a controlled coding agent that must use persistent plan and memory state.",
    "",
    "NON-NEGOTIABLE RULES:",
    "1. Follow the current plan instead of improvising.",
    "2. Never reuse invalidated strategies or forbidden knowledge.",
    "3. If the strategy truly must change, document the decision in planUpdate and memoryUpdate.",
    "4. Return valid JSON only.",
    "",
    "CURRENT GOAL:",
    JSON.stringify(goal, null, 2),
    "",
    "CURRENT PLAN:",
    JSON.stringify(plan, null, 2),
    "",
    "ACTIVE CONTEXT:",
    contextJson,
    "",
    // Meta-Cognitive Judgment Injection (wenn vorhanden)
    context.metaCognitive?.instruction
      ? `META-COGNITIVE: ${context.metaCognitive.instruction}\n`
      : "",
    // Lossless Artifact Notice (wenn vorhanden)
    context.artifactNotice
      ? `${context.artifactNotice}\n`
      : "",
    "TASK:",
    task,
    "",
    "OUTPUT SCHEMA:",
    JSON.stringify(
      {
        resultSummary: "what happened",
        planUpdate: {
          strategy: "optional new strategy",
          status: "optional plan status",
          steps: [
            {
              id: "step-id",
              title: "step title",
              status: "pending|in_progress|done",
              validation: ["validation command or proof"]
            }
          ],
          decisions: [
            {
              text: "decision text",
              topic: "strategy",
              rationale: "why"
            }
          ],
          issues: [
            {
              text: "open issue",
              status: "open|resolved"
            }
          ],
          notes: ["important note"]
        },
        memoryUpdate: {
          facts: ["fact worth remembering"],
          decisions: [
            {
              text: "decision worth persisting",
              topic: "strategy",
              replacesTopic: true
            }
          ],
          mistakes: ["mistake to avoid later"],
          solutions: ["working solution"],
          rules: ["stable cross-project rule"],
          forbidden: ["outdated path that must not be reused"],
          invalidations: [
            {
              matchText: "outdated knowledge text",
              reason: "why it is obsolete"
            }
          ]
        }
      },
      null,
      2
    )
  ].filter(Boolean).join("\n");
}
