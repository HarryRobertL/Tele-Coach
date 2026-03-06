/**
 * Maps objection id from engine to human-friendly label for overlay display.
 */

const OVERRIDES: Record<string, string> = {
  unknown: "Unclear objection",
  not_interested_cartwheel: "Not interested",
  already_use_provider: "Already use provider"
};

/**
 * Converts objection id to human-friendly label.
 * - "unknown" -> "Unclear objection"
 * - "not_interested_cartwheel" -> "Not interested"
 * - "already_use_provider" -> "Already use provider"
 * - Other ids: snake_case -> Title Case (e.g. "send_email" -> "Send email")
 */
export function objectionIdToLabel(id: string): string {
  const overridden = OVERRIDES[id];
  if (overridden) return overridden;
  return id
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
