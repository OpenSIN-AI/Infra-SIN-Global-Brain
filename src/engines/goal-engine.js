import { goalFile } from "../lib/layout.js";
import {
  readJsonFile,
  sanitizeIdentifier,
  uniqueStrings,
  writeJsonFile
} from "../lib/storage.js";

export async function loadGoal(layout, goalId) {
  return readJsonFile(goalFile(layout, goalId), null);
}

export async function ensureGoal(layout, {
  goalId,
  description,
  constraints = [],
  tags = [],
  status = "active"
}) {
  const now = new Date().toISOString();
  const filePath = goalFile(layout, goalId);
  const existingGoal = await readJsonFile(filePath, null);

  if (existingGoal) {
    const nextGoal = {
      ...existingGoal,
      description: description ?? existingGoal.description,
      status,
      constraints: uniqueStrings([...(existingGoal.constraints ?? []), ...constraints]),
      tags: uniqueStrings([...(existingGoal.tags ?? []), ...tags]),
      updatedAt: now,
      history: [
        ...(existingGoal.history ?? []),
        {
          changedAt: now,
          description: description ?? existingGoal.description,
          status
        }
      ]
    };

    await writeJsonFile(filePath, nextGoal);
    return nextGoal;
  }

  const initialGoal = {
    id: sanitizeIdentifier(goalId, "default-goal"),
    projectId: layout.projectId,
    description,
    status,
    constraints: uniqueStrings(constraints),
    tags: uniqueStrings(tags),
    createdAt: now,
    updatedAt: now,
    history: [
      {
        changedAt: now,
        description,
        status
      }
    ]
  };

  await writeJsonFile(filePath, initialGoal);
  return initialGoal;
}
