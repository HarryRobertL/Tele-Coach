import { useEffect } from "react";
import { SeverityBadge } from "./severity_badge";
import type { Severity } from "../lib/theme_tokens";

interface SuggestionViewProps {
  suggestions: [string, string, string];
  nextBestQuestion: string;
  optimalAnswer: string;
  callStage: "early" | "mid" | "late";
  objectionId: string;
  objectionConfidence: number;
  severity: Severity;
  matchedPhrases: string[];
}

export function SuggestionView({
  suggestions,
  nextBestQuestion,
  optimalAnswer,
  callStage,
  objectionId,
  objectionConfidence,
  severity,
  matchedPhrases
}: SuggestionViewProps): JSX.Element {
  async function copySuggestion(index: number): Promise<void> {
    const line = suggestions[index] ?? "";
    if (!line) return;
    try {
      await navigator.clipboard.writeText(line);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = line;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    await window.api.logSuggestionClick({
      slot: index + 1,
      suggestion_text: line,
      objection_id: objectionId
    });
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "1" || event.key === "2" || event.key === "3") {
        const idx = Number(event.key) - 1;
        void copySuggestion(idx);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    const offShortcut = window.api.on("shortcut_copy_suggestion", (payload) => {
      void copySuggestion(payload.slot - 1);
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      offShortcut();
    };
  }, [objectionId, suggestions]);

  return (
    <section>
      <h2>Coaching Suggestions</h2>
      <ul>
        {!suggestions[0] && !suggestions[1] && !suggestions[2] ? (
          <li>Awaiting classified speech input.</li>
        ) : (
          suggestions.map((suggestion, index) => (
            <li key={`${suggestion}-${index}`} className="suggestion-item">
              <span>{index + 1}. {suggestion}</span>
              <button
                type="button"
                className="copy-button"
                onClick={() => {
                  void copySuggestion(index);
                }}
              >
                Copy ({index + 1})
              </button>
            </li>
          ))
        )}
      </ul>
      <h3>Next Best Question</h3>
      <p>{nextBestQuestion || "Awaiting discovery question."}</p>
      <h3>Optimal Answer</h3>
      <p>{optimalAnswer || "Awaiting optimal answer."}</p>
      <p><strong>Call stage:</strong> {callStage}</p>
      <p><strong>Objection:</strong> {objectionId || "unknown"} <SeverityBadge severity={severity} /></p>
      <p><strong>Confidence:</strong> {objectionConfidence.toFixed(2)}</p>
      <p>
        <strong>Matched phrases:</strong>{" "}
        {matchedPhrases.length > 0 ? matchedPhrases.join(", ") : "none"}
      </p>
    </section>
  );
}
