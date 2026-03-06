import { useEffect, useMemo, useState } from "react";
import { Badge } from "./badge";
import { SeverityBadge } from "./severity_badge";
import { TranscriptView } from "./transcript_view";
import { AudioCapture, type MicStatus } from "../lib/audio_capture";
import { objectionIdToLabel } from "../lib/objection_label";
import type { Severity } from "../lib/theme_tokens";

type CoachingPackPayload = MainEventPayloadMap["coaching_pack"];

export function OverlayView(): JSX.Element {
  const [engineStatus, setEngineStatus] = useState("stopped");
  const [engineDetail, setEngineDetail] = useState("");
  const [overlayMode, setOverlayMode] = useState<"compact" | "expanded">("compact");
  const [micStatus, setMicStatus] = useState<MicStatus>("idle");
  const [micDetail, setMicDetail] = useState("");
  const [rms, setRms] = useState(0);
  const [partialText, setPartialText] = useState("");
  const [finalText, setFinalText] = useState("");
  const [coachingPack, setCoachingPack] = useState<CoachingPackPayload | null>(null);

  const capture = useMemo(
    () =>
      new AudioCapture({
        sampleRate: 16000,
        channels: 1,
        frameMs: 200,
        onChunk: (chunk) => {
          window.api.sendAudioChunk(chunk);
        },
        onRms: (value) => {
          setRms(value);
        },
        onStatus: (status, detail) => {
          setMicStatus(status);
          setMicDetail(detail ?? "");
        }
      }),
    []
  );

  useEffect(() => {
    const offStatus = window.api.on("engine_status", (payload) => {
      setEngineStatus(payload.state);
      setEngineDetail(payload.detail ?? "");
    });
    const offPartial = window.api.on("stt_partial", (payload) => {
      setPartialText(payload.text);
    });
    const offFinal = window.api.on("stt_final", (payload) => {
      setFinalText(payload.text);
    });
    const offCoachingPack = window.api.on("coaching_pack", (payload) => {
      setCoachingPack(payload);
    });
    const offOverlayMode = window.api.on("overlay_mode", (payload) => {
      setOverlayMode(payload.mode);
    });

    return () => {
      void capture.stop();
      offStatus();
      offPartial();
      offFinal();
      offCoachingPack();
      offOverlayMode();
    };
  }, [capture]);

  async function handleStart(): Promise<void> {
    try {
      await capture.startSafe();
      await window.api.startCoaching();
    } catch {
      // Mic status is already updated by AudioCapture.startSafe().
    }
  }

  async function handleStop(): Promise<void> {
    await capture.stop();
    await window.api.stopCoaching();
  }

  async function handleToggleMode(): Promise<void> {
    await window.api.toggleOverlayMode();
  }

  async function handleLogOutcome(outcome: "worked" | "neutral" | "did_not_work"): Promise<void> {
    await window.api.logOutcome({ outcome });
  }

  async function copyToClipboard(text: string): Promise<void> {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  }

  const pack = coachingPack;
  const objectionLabel = pack ? objectionIdToLabel(pack.objection.id) : "—";
  const severity = pack?.severity ?? "soft";
  const responseText = pack?.response ?? "—";
  const questionText = pack?.question ?? "—";
  const bridgeText = pack?.bridge ?? "—";

  const momentumScore = pack ? Math.min(5, pack.momentum.score) : 0;
  const momentumLevel = pack?.momentum.level ?? "low";
  const momentumLabel = momentumLevel.charAt(0).toUpperCase() + momentumLevel.slice(1);

  const errorBanner =
    micStatus === "error"
      ? `Microphone error: ${micDetail || "Permission denied or unavailable input device."}`
      : engineStatus === "error"
        ? `Engine error: ${engineDetail || "Whisper assets missing or failed to load."}`
        : "";

  return (
    <main className="panel" aria-label="Coach overlay">
      <div className="drag-region" />
      <header className="overlay-header">
        <h1 className="overlay-header__title">Harry&apos;s Creditsafe Insight Assist</h1>
        <p className="overlay-header__subtitle">Live Call Coaching</p>
      </header>
      <section className="momentum-indicator" aria-label="Interest level">
        <div className="momentum-indicator__label">Interest Level</div>
        <div className="momentum-indicator__row">
          <span className="momentum-indicator__level">{momentumLabel}</span>
          <div className="momentum-indicator__bar" role="meter" aria-valuenow={momentumScore} aria-valuemin={0} aria-valuemax={5} aria-label={`Interest level ${momentumLabel}, ${momentumScore} of 5`}>
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className={`momentum-indicator__slot ${i < momentumScore ? "momentum-indicator__slot--filled" : ""}`}
              />
            ))}
          </div>
        </div>
      </section>
      <Badge label={`ENGINE: ${engineStatus.toUpperCase()}`} tone="success" />
      {errorBanner ? <div className="error-banner">{errorBanner}</div> : null}
      {engineDetail ? <p className="status-line">{engineDetail}</p> : null}
      <p className="status-line">
        Mic: <strong>{micStatus}</strong> {micDetail ? `- ${micDetail}` : ""}
      </p>
      <div className="vad-wrap" aria-label="Voice activity">
        <div className="vad-fill" style={{ width: `${Math.min(100, rms * 250)}%` }} />
      </div>
      <div className="controls">
        <button type="button" onClick={handleStart}>Start coaching</button>
        <button type="button" onClick={handleStop}>Stop coaching</button>
        <button type="button" onClick={handleToggleMode}>Toggle overlay mode</button>
        <button type="button" onClick={() => { void handleLogOutcome("worked"); }}>Worked</button>
        <button type="button" onClick={() => { void handleLogOutcome("neutral"); }}>Neutral</button>
        <button type="button" onClick={() => { void handleLogOutcome("did_not_work"); }}>
          Did Not Work
        </button>
      </div>
      <section className="coaching-pack compact-block" aria-label="Coaching pack">
        <div className="coaching-pack__block">
          <div className="coaching-pack__label">OBJECTION</div>
          <div className="coaching-pack__content">
            {objectionLabel}
            {" "}
            <SeverityBadge severity={severity} />
          </div>
        </div>
        <div className="coaching-pack__block">
          <div className="coaching-pack__label">RESPONSE</div>
          <div className="coaching-pack__row">
            <div className="coaching-pack__content">{responseText}</div>
            <button
              type="button"
              className="copy-button"
              onClick={() => { void copyToClipboard(responseText); }}
              disabled={!pack?.response}
              aria-label="Copy response"
            >
              Copy
            </button>
          </div>
        </div>
        <div className="coaching-pack__block">
          <div className="coaching-pack__label">QUESTION</div>
          <div className="coaching-pack__row">
            <div className="coaching-pack__content">{questionText}</div>
            <button
              type="button"
              className="copy-button"
              onClick={() => { void copyToClipboard(questionText); }}
              disabled={!pack?.question}
              aria-label="Copy question"
            >
              Copy
            </button>
          </div>
        </div>
        <div className="coaching-pack__block">
          <div className="coaching-pack__label">BRIDGE</div>
          <div className="coaching-pack__row">
            <div className="coaching-pack__content">{bridgeText}</div>
            <button
              type="button"
              className="copy-button"
              onClick={() => { void copyToClipboard(bridgeText); }}
              disabled={!pack?.bridge}
              aria-label="Copy bridge"
            >
              Copy
            </button>
          </div>
        </div>
      </section>

      {overlayMode === "expanded" ? (
        <TranscriptView partialText={partialText} finalText={finalText} />
      ) : null}
    </main>
  );
}
