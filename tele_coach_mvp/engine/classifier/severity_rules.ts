export type Severity = "soft" | "medium" | "hard";

const HARD_PHRASES = ["never", "remove me", "not interested at all"];
const MEDIUM_PHRASES = ["we are fine", "we already use", "we are set"];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detects objection severity from transcript text.
 * Input is normalized to lowercase with collapsed whitespace; empty input returns "soft".
 */
export function detectSeverity(text: string): Severity {
  const normalized = normalize(text);
  if (normalized.length === 0) return "soft";

  for (const phrase of HARD_PHRASES) {
    if (normalized.includes(phrase)) return "hard";
  }
  for (const phrase of MEDIUM_PHRASES) {
    if (normalized.includes(phrase)) return "medium";
  }
  return "soft";
}
