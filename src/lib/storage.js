import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export async function ensureDir(directoryPath) {
  await fs.mkdir(directoryPath, { recursive: true });
  return directoryPath;
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile(filePath, fallbackValue = null) {
  if (!(await fileExists(filePath))) {
    return fallbackValue;
  }

  const raw = await fs.readFile(filePath, "utf8");

  if (!raw.trim()) {
    return fallbackValue;
  }

  return JSON.parse(raw);
}

export async function writeJsonFile(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return filePath;
}

export async function appendJsonlRecord(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, `${JSON.stringify(data)}\n`, "utf8");
  return filePath;
}

export async function readJsonlFile(filePath) {
  if (!(await fileExists(filePath))) {
    return [];
  }

  const raw = await fs.readFile(filePath, "utf8");

  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function listJsonFiles(directoryPath) {
  if (!(await fileExists(directoryPath))) {
    return [];
  }

  const entries = await fs.readdir(directoryPath);
  return entries.filter((entry) => entry.endsWith(".json")).sort();
}

export function sanitizeIdentifier(value, fallbackValue = "default") {
  const sanitized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/gu, "-")
    .replace(/^-+/u, "")
    .replace(/-+$/u, "");

  return sanitized || fallbackValue;
}

export function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null || value === "") {
    return [];
  }

  return [value];
}

export function uniqueStrings(values) {
  return [...new Set(toArray(values).map((value) => String(value).trim()).filter(Boolean))];
}

export function extractJsonFromText(rawText) {
  const text = String(rawText ?? "").trim();

  if (!text) {
    throw new Error("Unable to extract JSON from an empty response.");
  }

  if (text.startsWith("{") || text.startsWith("[")) {
    return JSON.parse(text);
  }

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/u);

  if (fencedMatch?.[1]) {
    return JSON.parse(fencedMatch[1].trim());
  }

  const objectMatch = text.match(/(\{[\s\S]*\})/u);
  if (objectMatch?.[1]) {
    return JSON.parse(objectMatch[1]);
  }

  const arrayMatch = text.match(/(\[[\s\S]*\])/u);
  if (arrayMatch?.[1]) {
    return JSON.parse(arrayMatch[1]);
  }

  throw new Error("Unable to locate a JSON object in the provided text.");
}

export function createStableId(prefix) {
  return `${sanitizeIdentifier(prefix, "entry")}-${randomUUID()}`;
}

export function cloneJsonCompatible(data) {
  return JSON.parse(JSON.stringify(data));
}
