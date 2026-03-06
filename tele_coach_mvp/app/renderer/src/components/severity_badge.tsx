import type { Severity } from "../lib/theme_tokens";

interface SeverityBadgeProps {
  severity: Severity;
}

const LABEL: Record<Severity, string> = {
  soft: "SOFT",
  medium: "MEDIUM",
  hard: "HARD"
};

export function SeverityBadge({ severity }: SeverityBadgeProps): JSX.Element {
  return (
    <span
      className={`severity-badge severity-badge--${severity}`}
      aria-label={`Objection severity: ${severity}`}
    >
      {LABEL[severity]}
    </span>
  );
}
