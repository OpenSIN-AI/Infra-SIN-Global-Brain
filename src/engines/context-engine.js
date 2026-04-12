import { selectKnowledgeEntries } from "./memory-engine.js";
import { summarizePlan } from "./plan-engine.js";

export function buildActiveContext({ goal, plan, knowledge, sessionSummary }) {
  const activeKnowledge = knowledge.active ?? [];

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
      rules: selectKnowledgeEntries(activeKnowledge, "rule", 8),
      decisions: selectKnowledgeEntries(activeKnowledge, "decision", 8),
      mistakes: selectKnowledgeEntries(activeKnowledge, "mistake", 8),
      solutions: selectKnowledgeEntries(activeKnowledge, "solution", 8),
      facts: selectKnowledgeEntries(activeKnowledge, "fact", 8),
      forbidden: selectKnowledgeEntries(activeKnowledge, "forbidden", 8)
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
      : null
  };
}

export function buildExecutionPrompt({ goal, plan, context, task }) {
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
    JSON.stringify(context, null, 2),
    "",
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
              topic: "strategy|scope|tooling",
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
  ].join("\n");
}
