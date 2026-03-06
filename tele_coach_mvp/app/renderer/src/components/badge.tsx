type BadgeTone = "success" | "neutral";

interface BadgeProps {
  label: string;
  tone?: BadgeTone;
}

export function Badge({ label, tone = "neutral" }: BadgeProps): JSX.Element {
  const color = tone === "success" ? "#CFFF04" : "#9CA3AF";
  return (
    <span style={{ display: "inline-block", marginBottom: 8, color }}>
      {label}
    </span>
  );
}
