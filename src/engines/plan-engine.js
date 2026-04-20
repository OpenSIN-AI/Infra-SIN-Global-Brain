/**
 * ==============================================================================
 * DATEI: src/engines/plan-engine.js
 * PROJEKT: Infra-SIN-Global-Brain
 * ZWECK: Verwaltet Ausführungspläne für Agenten-Tasks
 * 
 * WICHTIG FÜR ENTWICKLER:
 * Diese Datei erstellt, speichert und lädt Versionshistorien von Plänen.
 * Ein Plan definiert SCHRITTE, die ein Agent ausführen muss, um ein Ziel zu erreichen.
 * 
 * ACHTUNG: Pläne sind VERSIONIERT. Jede Änderung erzeugt eine neue Version.
 * Das ermöglicht es, bei Fehlern zu früheren Versionen zurückzukehren.
 * 
 * HAUPTFUNKTIONEN:
 * - buildInitialPlan: Erstellt ersten Plan für ein neues Ziel
 * - applyPlanUpdate: Wendet Änderungen auf bestehenden Plan an
 * - loadLatestPlan: Lädt die neueste Version eines Plans
 * - savePlanVersion: Speichert eine neue Version
 * 
 * WAS IST EIN PLAN?
 * Ein Plan besteht aus:
 * - steps: Array von Schritten (was getan werden muss)
 * - decisions: Getroffene Entscheidungen (warum etwas getan wird)
 * - issues: Offene Probleme (was noch geklärt werden muss)
 * - strategy: Gewählte Strategie (wie es getan wird)
 * ==============================================================================
 */

import path from "node:path";

import { planDirectory } from "../lib/layout.js";
import {
  ensureDir,
  listJsonFiles,
  readJsonFile,
  sanitizeIdentifier,
  toArray,
  uniqueStrings,
  writeJsonFile
} from "../lib/storage.js";

/**
 * FUNKTION: normalizePlanStep
 * 
 * WAS MACHT SIE: Wandelt rohe Schritt-Daten in standardisiertes Format um
 * WARUM WICHTIG: Agenten können Schritte in verschiedenen Formaten liefern
 * DIESE FUNKTION: Macht alle Formate einheitlich und fügt Defaults hinzu
 * 
 * PARAMETER:
 * - step: Rohdaten (String oder Objekt)
 * - index: Position im Array (für ID-Generierung)
 * 
 * RÜCKGABE: Standardisiertes Schritt-Objekt mit allen erforderlichen Feldern
 */
function normalizePlanStep(step, index) {
  // FALL 1: String übergeben -> in Objekt umwandeln
  // FALL 2: Objekt übergeben -> Kopie erstellen (Original nicht ändern!)
  const candidate = typeof step === "string" ? { title: step } : { ...step };
  
  // Titel extrahieren: Priorisiere title, dann task, dann generiere Default
  const title = candidate.title ?? candidate.task ?? `step-${index + 1}`;

  // Standardisiertes Objekt zurückgeben
  return {
    // ID: Entweder vorhanden, oder aus Titel generiert, oder Default
    id: sanitizeIdentifier(candidate.id ?? title, `step-${index + 1}`),
    title,
    // Status: Standardmäßig "pending" (noch nicht begonnen)
    status: candidate.status ?? "pending",
    // Notizen: In Array umwandeln und Duplikate entfernen
    notes: uniqueStrings(candidate.notes ?? candidate.note),
    // Abhängigkeiten: Welche Schritte müssen vorher erledigt sein?
    dependsOn: uniqueStrings(candidate.dependsOn),
    // Validierung: Woran erkennen wir, dass Schritt erfolgreich war?
    validation: uniqueStrings(candidate.validation)
  };
}

/**
 * FUNKTION: normalizeDecision
 * 
 * WAS MACHT SIE: Standardisiert Entscheidungs-Objekte
 * WARUM WICHTIG: Entscheidungen müssen nachvollziehbar dokumentiert sein
 * 
 * PARAMETER:
 * - decision: Rohdaten (String oder Objekt)
 * - index: Position im Array
 * 
 * RÜCKGABE: Standardisiertes Entscheidungs-Objekt mit Metadaten
 */
function normalizeDecision(decision, index) {
  // String in Objekt umwandeln oder Objekt kopieren
  const candidate = typeof decision === "string" ? { text: decision } : { ...decision };
  
  // Text extrahieren: Verschiedene mögliche Feldnamen unterstützen
  const text = candidate.text ?? candidate.decision ?? candidate.summary ?? `decision-${index + 1}`;

  return {
    // ID generieren
    id: sanitizeIdentifier(candidate.id ?? text, `decision-${index + 1}`),
    text,
    // Thema: Worum geht es? (optional)
    topic: candidate.topic ?? null,
    // Begründung: Warum wurde so entschieden? (KRITISCH für Lernen!)
    rationale: candidate.rationale ?? candidate.reason ?? null,
    // Zeitstempel: Wann wurde entschieden?
    createdAt: candidate.createdAt ?? new Date().toISOString()
  };
}

/**
 * FUNKTION: normalizeIssue
 * 
 * WAS MACHT SIE: Standardisiert Problem-Beschreibungen
 * WARUM WICHTIG: Offene Probleme dürfen nicht verloren gehen
 * 
 * PARAMETER:
 * - issue: Rohdaten (String oder Objekt)
 * - index: Position im Array
 * 
 * RÜCKGABE: Standardisiertes Issue-Objekt mit Status-Tracking
 */
function normalizeIssue(issue, index) {
  // String in Objekt umwandeln oder Objekt kopieren
  const candidate = typeof issue === "string" ? { text: issue } : { ...issue };
  
  // Text extrahieren
  const text = candidate.text ?? candidate.issue ?? candidate.summary ?? `issue-${index + 1}`;

  return {
    // ID generieren
    id: sanitizeIdentifier(candidate.id ?? text, `issue-${index + 1}`),
    text,
    // Status: "open", "in-progress", "resolved"
    status: candidate.status ?? "open",
    // Begründung: Warum ist das ein Problem? Wie wurde es gelöst?
    rationale: candidate.rationale ?? candidate.reason ?? null,
    // Zeitstempel: Wann wurde das Problem erkannt?
    createdAt: candidate.createdAt ?? new Date().toISOString()
  };
}

function mergeById(existingItems, incomingItems) {
  const itemMap = new Map(existingItems.map((item) => [item.id, item]));

  for (const item of incomingItems) {
    itemMap.set(item.id, {
      ...(itemMap.get(item.id) ?? {}),
      ...item
    });
  }

  return [...itemMap.values()];
}

export function buildInitialPlan({ projectId, goalId, goalDescription, constraints = [] }) {
  const now = new Date().toISOString();

  return {
    revision: 1,
    projectId,
    goalId: sanitizeIdentifier(goalId, "default-goal"),
    goalDescription,
    status: "active",
    strategy: "initial-discovery",
    constraints: uniqueStrings(constraints),
    steps: [],
    decisions: [],
    issues: [],
    notes: [],
    createdAt: now,
    updatedAt: now
  };
}

export async function loadLatestPlan(layout, goalId) {
  const planRoot = planDirectory(layout, goalId);
  const latestFile = path.join(planRoot, "latest.json");
  const latestPlan = await readJsonFile(latestFile, null);

  if (latestPlan) {
    return latestPlan;
  }

  const files = await listJsonFiles(planRoot);
  const latestVersionFile = files.filter((file) => file.startsWith("revision-")).at(-1);

  if (!latestVersionFile) {
    return null;
  }

  return readJsonFile(path.join(planRoot, latestVersionFile), null);
}

export function applyPlanUpdate(currentPlan, planUpdate = {}) {
  const nextRevision = Number(currentPlan.revision ?? 0) + 1;
  const normalizedSteps = toArray(planUpdate.steps).map(normalizePlanStep);
  const normalizedDecisions = toArray(planUpdate.decisions).map(normalizeDecision);
  const normalizedIssues = toArray(planUpdate.issues).map(normalizeIssue);

  return {
    ...currentPlan,
    revision: nextRevision,
    status: planUpdate.status ?? currentPlan.status,
    strategy: planUpdate.strategy ?? currentPlan.strategy,
    constraints: uniqueStrings([...(currentPlan.constraints ?? []), ...(planUpdate.constraints ?? [])]),
    steps: mergeById(currentPlan.steps ?? [], normalizedSteps),
    decisions: mergeById(currentPlan.decisions ?? [], normalizedDecisions),
    issues: mergeById(currentPlan.issues ?? [], normalizedIssues),
    notes: uniqueStrings([...(currentPlan.notes ?? []), ...(planUpdate.notes ?? [])]),
    updatedAt: new Date().toISOString()
  };
}

export async function savePlanVersion(layout, plan) {
  const planRoot = planDirectory(layout, plan.goalId);
  const revisionLabel = String(plan.revision).padStart(4, "0");
  const revisionFile = path.join(planRoot, `revision-${revisionLabel}.json`);
  const latestFile = path.join(planRoot, "latest.json");

  await ensureDir(planRoot);
  await writeJsonFile(revisionFile, plan);
  await writeJsonFile(latestFile, plan);

  return revisionFile;
}

export function summarizePlan(plan) {
  return {
    goalId: plan.goalId,
    revision: plan.revision,
    status: plan.status,
    strategy: plan.strategy,
    openSteps: (plan.steps ?? []).filter((step) => step.status !== "done"),
    latestDecisions: (plan.decisions ?? []).slice(-5),
    openIssues: (plan.issues ?? []).filter((issue) => issue.status !== "resolved")
  };
}
