export function validateExecutionResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Execution result must be a JSON object.");
  }

  if (!result.resultSummary || typeof result.resultSummary !== "string") {
    throw new Error("Execution result must include a string resultSummary field.");
  }

  if (!result.planUpdate || typeof result.planUpdate !== "object") {
    throw new Error("Execution result must include a planUpdate object.");
  }

  return {
    ...result,
    memoryUpdate: result.memoryUpdate && typeof result.memoryUpdate === "object" ? result.memoryUpdate : {}
  };
}

export function assertStrategyIsNotForbidden(plan, context) {
  const forbiddenEntries = context.memory?.forbidden ?? [];
  const currentStrategy = String(plan.strategy ?? "").trim().toLowerCase();

  if (!currentStrategy) {
    return;
  }

  const conflictingEntry = forbiddenEntries.find((entry) => entry.text.trim().toLowerCase() === currentStrategy);

  if (conflictingEntry) {
    throw new Error(
      `Plan strategy "${plan.strategy}" is explicitly forbidden by memory entry ${conflictingEntry.id}.`
    );
  }
}

export function buildDryRunExecution({ task, currentStrategy }) {
  return validateExecutionResult({
    resultSummary: `Dry run placeholder executed for task: ${task}`,
    planUpdate: {
      strategy: currentStrategy,
      steps: [
        {
          id: "dry-run-step",
          title: task,
          status: "in_progress",
          validation: ["Replace dry-run with a live execution result."]
        }
      ],
      notes: ["Dry run produced a scaffolded placeholder instead of a live coding action."]
    },
    memoryUpdate: {
      facts: [`Dry run captured task intent: ${task}`]
    }
  });
}
