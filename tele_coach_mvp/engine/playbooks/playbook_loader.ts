import fs from "node:fs";
import path from "node:path";

export type Severity = "soft" | "medium" | "hard";

export interface PlaybookObjection {
  id: string;
  triggers: string[];
  severity: Severity;
  replies: string[];
  questions: string[];
}

export interface Playbook {
  objections: PlaybookObjection[];
}

const SEVERITIES: Severity[] = ["soft", "medium", "hard"];

function isSeverity(s: unknown): s is Severity {
  return typeof s === "string" && SEVERITIES.includes(s as Severity);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function assertPlaybookObjection(obj: unknown, index: number): asserts obj is PlaybookObjection {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error(
      `Creditsafe playbook: objections[${index}] must be an object, got ${Array.isArray(obj) ? "array" : typeof obj}`
    );
  }
  const o = obj as Record<string, unknown>;
  if (typeof o.id !== "string") {
    throw new Error(
      `Creditsafe playbook: objections[${index}].id must be a string, got ${typeof o.id}`
    );
  }
  if (!isStringArray(o.triggers)) {
    throw new Error(
      `Creditsafe playbook: objections[${index}].triggers must be an array of strings, got ${typeof o.triggers}`
    );
  }
  if (!isSeverity(o.severity)) {
    throw new Error(
      `Creditsafe playbook: objections[${index}].severity must be "soft" | "medium" | "hard", got ${JSON.stringify(o.severity)}`
    );
  }
  if (!isStringArray(o.replies)) {
    throw new Error(
      `Creditsafe playbook: objections[${index}].replies must be an array of strings, got ${typeof o.replies}`
    );
  }
  if (!isStringArray(o.questions)) {
    throw new Error(
      `Creditsafe playbook: objections[${index}].questions must be an array of strings, got ${typeof o.questions}`
    );
  }
}

function validatePlaybook(data: unknown): Playbook {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(
      `Creditsafe playbook: root must be an object, got ${Array.isArray(data) ? "array" : typeof data}`
    );
  }
  const root = data as Record<string, unknown>;
  if (!Array.isArray(root.objections)) {
    throw new Error(
      `Creditsafe playbook: objections must be an array, got ${typeof root.objections}`
    );
  }
  const objections: PlaybookObjection[] = [];
  for (let i = 0; i < root.objections.length; i++) {
    assertPlaybookObjection(root.objections[i], i);
    const obj = root.objections[i] as PlaybookObjection;
    objections.push({
      ...obj,
      triggers: [...new Set(obj.triggers)]
    });
  }
  return { objections };
}

/**
 * Loads and validates the Creditsafe playbook from engine/playbooks/creditsafe_playbook.json.
 * @throws Error if file is missing, invalid JSON, or shape validation fails
 */
export function loadCreditsafePlaybook(): Playbook {
  const filePath = path.join(__dirname, "creditsafe_playbook.json");
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Creditsafe playbook: failed to read file ${filePath}: ${message}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Creditsafe playbook: invalid JSON: ${message}`);
  }
  return validatePlaybook(data);
}

/**
 * Loads the playbook; on any failure returns a fallback playbook with no objections
 * so callers can fall back to "unknown" objection and generic content.
 */
export function loadCreditsafePlaybookSafe(): Playbook {
  try {
    return loadCreditsafePlaybook();
  } catch {
    return { objections: [] };
  }
}
