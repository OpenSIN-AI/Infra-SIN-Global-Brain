/**
 * transcript-engine.js — Transcript-to-Knowledge Extraction
 *
 * Takes raw session JSONL transcripts (user/assistant message logs) and uses
 * an LLM call (via OpenCode CLI) to extract structured knowledge entries.
 *
 * The extraction prompt asks the LLM to identify:
 *   - facts: concrete technical facts discovered during the session
 *   - decisions: architectural or strategic decisions that were made
 *   - mistakes: errors, wrong approaches, dead ends encountered
 *   - solutions: working fixes, workarounds, successful approaches
 *   - rules: stable cross-project rules that emerged
 *   - forbidden: strategies/approaches that must never be reused
 *   - invalidations: previously-held beliefs that were proven wrong
 *
 * This engine is the bridge between raw conversation history and the
 * structured memory store. Without it, knowledge only enters the memory
 * engine through the orchestrator's execution/reflection cycle, which
 * means ad-hoc conversations and manual coding sessions are lost.
 *
 * Usage:
 *   CLI:  node src/cli.js extract-knowledge --project <id> --session <id>
 *   API:  import { extractKnowledgeFromTranscript } from "./engines/transcript-engine.js"
 */

import { readJsonlFile } from "../lib/storage.js";
import { rawSessionFile } from "../lib/layout.js";
import { OpenCodeRunner } from "./opencode-runner.js";
import { applyMemoryUpdate } from "./memory-engine.js";

/**
 * Maximum number of messages to include in a single extraction prompt.
 * If the transcript is longer, it gets chunked and each chunk is processed
 * separately, then results are merged. This prevents prompt overflow.
 */
const MAX_MESSAGES_PER_CHUNK = 60;

/**
 * Maximum characters of transcript text per chunk.
 * Even if message count is below MAX_MESSAGES_PER_CHUNK, we also cap by
 * total character length to stay within LLM context windows.
 */
const MAX_CHARS_PER_CHUNK = 40000;

/**
 * Builds the LLM prompt that instructs the model to extract structured
 * knowledge from a chunk of conversation transcript.
 *
 * The prompt is carefully structured to:
 *   1. Explain the 6 knowledge types + invalidations
 *   2. Provide the transcript as context
 *   3. Demand strict JSON output with no prose
 *
 * @param {Array<object>} messages - Array of {role, text, createdAt} objects
 * @param {string} projectId - Which project this transcript belongs to
 * @param {string} sessionId - Which session this transcript comes from
 * @returns {string} The complete extraction prompt
 */
function buildExtractionPrompt(messages, projectId, sessionId) {
  /**
   * Format each message as "ROLE: text" for the LLM to read.
   * We include timestamps so the LLM can understand temporal ordering
   * and identify which knowledge is most recent.
   */
  const formattedTranscript = messages
    .map((msg) => `[${msg.createdAt ?? "unknown"}] ${String(msg.role).toUpperCase()}: ${msg.text}`)
    .join("\n\n---\n\n");

  return [
    "SYSTEM:",
    "You are a knowledge extraction agent. Your job is to read a coding session transcript",
    "and extract structured knowledge entries that should be persisted for future sessions.",
    "",
    `PROJECT: ${projectId}`,
    `SESSION: ${sessionId}`,
    "",
    "EXTRACT THE FOLLOWING TYPES OF KNOWLEDGE:",
    "",
    "1. facts: Concrete technical facts discovered (e.g. 'Node.js v22 supports --test glob natively')",
    "2. decisions: Architectural or strategic decisions made (e.g. 'We chose ESM over CJS for this project')",
    "3. mistakes: Errors, wrong approaches, dead ends (e.g. 'Using innerHTML caused XSS vulnerability')",
    "4. solutions: Working fixes, successful approaches (e.g. 'Fixed CORS by adding proxy middleware')",
    "5. rules: Stable cross-project rules (e.g. 'Always validate JSON schema before writing to DB')",
    "6. forbidden: Strategies that must NEVER be reused (e.g. 'Never use eval() for JSON parsing')",
    "7. invalidations: Previously-held beliefs proven wrong. Each should have matchText (the old belief) and reason.",
    "",
    "RULES FOR EXTRACTION:",
    "- Only extract knowledge that is ACTIONABLE and REUSABLE across sessions",
    "- Do NOT extract trivial observations or generic programming knowledge",
    "- Each entry needs a 'text' field (the knowledge) and optionally 'topic', 'tags', 'rationale'",
    "- For decisions, set 'topic' to categorize (strategy, tooling, architecture, scope, etc.)",
    "- For invalidations, provide 'matchText' (the old wrong belief) and 'reason' (why it is wrong)",
    "- If no knowledge of a type exists, use an empty array []",
    "- Return ONLY valid JSON, no prose before or after",
    "",
    "TRANSCRIPT:",
    "```",
    formattedTranscript,
    "```",
    "",
    "OUTPUT (JSON only):",
    JSON.stringify(
      {
        facts: [{ text: "example fact", topic: "topic", tags: ["tag1"] }],
        decisions: [{ text: "example decision", topic: "strategy", rationale: "why", replacesTopic: false }],
        mistakes: [{ text: "example mistake", tags: ["debugging"] }],
        solutions: [{ text: "example solution", tags: ["fix"] }],
        rules: [{ text: "example rule" }],
        forbidden: [{ text: "example forbidden approach" }],
        invalidations: [{ matchText: "old wrong belief", reason: "why it is wrong" }]
      },
      null,
      2
    )
  ].join("\n");
}

/**
 * Splits a message array into chunks that fit within both message count
 * and character count limits. Each chunk can be independently processed
 * by the LLM without exceeding context window constraints.
 *
 * Chunking strategy: walk forward through messages, accumulating until
 * either message count or character budget is exceeded, then cut.
 *
 * @param {Array<object>} messages - Full transcript message array
 * @returns {Array<Array<object>>} Array of message chunks
 */
function chunkMessages(messages) {
  const chunks = [];
  let currentChunk = [];
  let currentChars = 0;

  for (const message of messages) {
    const messageChars = (message.text ?? "").length;

    /**
     * Check if adding this message would exceed either limit.
     * If so, finalize the current chunk and start a new one.
     */
    if (
      currentChunk.length >= MAX_MESSAGES_PER_CHUNK ||
      (currentChars + messageChars > MAX_CHARS_PER_CHUNK && currentChunk.length > 0)
    ) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentChars = 0;
    }

    currentChunk.push(message);
    currentChars += messageChars;
  }

  /** Don't forget the last chunk if it has any messages. */
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Merges multiple extraction results (from chunked processing) into a
 * single unified memoryUpdate object. Entries from later chunks are
 * appended after entries from earlier chunks, preserving temporal order.
 *
 * @param {Array<object>} results - Array of extraction result objects
 * @returns {object} Merged memoryUpdate with all 6 types + invalidations
 */
function mergeExtractionResults(results) {
  const merged = {
    facts: [],
    decisions: [],
    mistakes: [],
    solutions: [],
    rules: [],
    forbidden: [],
    invalidations: []
  };

  for (const result of results) {
    if (!result || typeof result !== "object") {
      continue;
    }

    for (const key of Object.keys(merged)) {
      const entries = result[key];

      if (Array.isArray(entries)) {
        merged[key].push(...entries);
      }
    }
  }

  return merged;
}

/**
 * Core extraction function: takes raw session messages and uses an LLM
 * to extract structured knowledge. Handles chunking for long transcripts
 * and merges results from multiple chunks.
 *
 * Can operate in two modes:
 *   1. Live mode (runner provided): actually calls the LLM
 *   2. Offline mode (runner = null): returns empty extraction
 *
 * @param {object} params
 * @param {Array<object>} params.messages - Raw session messages [{role, text, createdAt}]
 * @param {string} params.projectId - Project identifier
 * @param {string} params.sessionId - Session identifier
 * @param {OpenCodeRunner|null} params.runner - OpenCode runner instance (null = skip LLM)
 * @param {string} [params.cwd] - Working directory for the runner
 * @returns {Promise<object>} Merged extraction result (memoryUpdate shape)
 */
export async function extractKnowledgeFromMessages({
  messages,
  projectId,
  sessionId,
  runner = null,
  cwd = process.cwd()
}) {
  /**
   * If no messages, nothing to extract. Return empty structure.
   */
  if (!messages || messages.length === 0) {
    return mergeExtractionResults([]);
  }

  /**
   * If no runner is provided, we can't call the LLM.
   * Return empty extraction (offline/dry-run mode).
   */
  if (!runner) {
    return mergeExtractionResults([]);
  }

  /**
   * Split the transcript into manageable chunks.
   * Each chunk will be sent to the LLM independently.
   */
  const chunks = chunkMessages(messages);
  const chunkResults = [];

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    const prompt = buildExtractionPrompt(chunk, projectId, sessionId);

    try {
      const result = await runner.runJson(prompt, { cwd });
      chunkResults.push(result);
    } catch (error) {
      /**
       * If one chunk fails, we log the error but continue processing
       * remaining chunks. Partial extraction is better than no extraction.
       */
      process.stderr.write(
        `[transcript-engine] Chunk ${chunkIndex + 1}/${chunks.length} extraction failed: ${error.message}\n`
      );
      chunkResults.push(null);
    }
  }

  return mergeExtractionResults(chunkResults);
}

/**
 * High-level function that loads a raw session transcript from disk,
 * extracts knowledge via LLM, and applies the extracted knowledge
 * directly to the memory engine (both global and project stores).
 *
 * This is the main entry point for the CLI `extract-knowledge` command.
 *
 * @param {object} params
 * @param {object} params.layout - Repository layout object (from createRepositoryLayout)
 * @param {string} params.sessionId - Session ID whose transcript to process
 * @param {OpenCodeRunner|null} params.runner - OpenCode runner (null = dry-run)
 * @param {string} [params.cwd] - Working directory for the runner
 * @returns {Promise<object>} Result containing extracted knowledge and memory changes
 */
export async function extractAndApplyTranscriptKnowledge({
  layout,
  sessionId,
  runner = null,
  cwd = process.cwd()
}) {
  /**
   * Step 1: Load the raw JSONL transcript for the given session.
   * Each line is a {sessionId, role, text, metadata, createdAt} object.
   */
  const messages = await readJsonlFile(rawSessionFile(layout, sessionId));

  /**
   * Step 2: Run the LLM extraction pipeline on the loaded messages.
   */
  const extraction = await extractKnowledgeFromMessages({
    messages,
    projectId: layout.projectId,
    sessionId,
    runner,
    cwd
  });

  /**
   * Step 3: Apply the extracted knowledge to the memory stores.
   * This adds new entries and processes any invalidations.
   */
  const memoryChanges = await applyMemoryUpdate(layout, extraction, {
    projectId: layout.projectId,
    sessionId,
    sourceType: "transcript-extraction"
  });

  return {
    sessionId,
    projectId: layout.projectId,
    messageCount: messages.length,
    extraction,
    memoryChanges
  };
}
