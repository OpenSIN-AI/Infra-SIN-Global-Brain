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

function normalizePlanStep(step, index) {
  const candidate = typeof step === "string" ? { title: step } : { ...step };
  const title = candidate.title ?? candidate.task ?? `step-${index + 1}`;

  return {
    id: sanitizeIdentifier(candidate.id ?? title, `step-${index + 1}`),
    title,
    status: candidate.status ?? "pending",
    notes: uniqueStrings(candidate.notes ?? candidate.note),
    dependsOn: uniqueStrings(candidate.dependsOn),
    validation: uniqueStrings(candidate.validation)
  };
}

function normalizeDecision(decision, index) {
  const candidate = typeof decision === "string" ? { text: decision } : { ...decision };
  const text = candidate.text ?? candidate.decision ?? candidate.summary ?? `decision-${index + 1}`;

  return {
    id: sanitizeIdentifier(candidate.id ?? text, `decision-${index + 1}`),
    text,
    topic: candidate.topic ?? null,
    rationale: candidate.rationale ?? candidate.reason ?? null,
    createdAt: candidate.createdAt ?? new Date().toISOString()
  };
}

function normalizeIssue(issue, index) {
  const candidate = typeof issue === "string" ? { text: issue } : { ...issue };
  const text = candidate.text ?? candidate.issue ?? candidate.summary ?? `issue-${index + 1}`;

  return {
    id: sanitizeIdentifier(candidate.id ?? text, `issue-${index + 1}`),
    text,
    status: candidate.status ?? "open",
    rationale: candidate.rationale ?? candidate.reason ?? null,
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
