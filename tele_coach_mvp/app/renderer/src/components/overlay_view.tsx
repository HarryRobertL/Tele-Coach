import { useEffect, useMemo, useState } from "react";
import { Badge } from "./badge";
import { SeverityBadge } from "./severity_badge";
import { TranscriptView } from "./transcript_view";
import { WhisperSetup } from "./whisper_setup";
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
  const [whisperStatus, setWhisperStatus] = useState<"checking" | "missing" | "downloading" | "verifying" | "ready" | "error">("ready");
  const [whisperProgress, setWhisperProgress] = useState<number | undefined>();
  const [whisperStep, setWhisperStep] = useState<string | undefined>();
  const [whisperError, setWhisperError] = useState<string | undefined>();
  const [coachingPack, setCoachingPack] = useState<CoachingPackPayload>({
    objection_id: "idle",
    confidence: 0,
    severity: "soft",
    response: "Ready when you are",
    question: "Ask a quick question to open",
    bridge: "Are you near a screen for two minutes",
    momentum_level: "low",
    momentum_score: 0,
    momentum_reasons: [],
    timestamp: Date.now()
  });

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
    const unsubscribeSttPartial = window.api.on("stt_partial", (payload) => {
      setPartialText(payload.text);
    });

    const unsubscribeSttFinal = window.api.on("stt_final", (payload) => {
      setFinalText(payload.text);
    });

    const unsubscribeCoachingPack = window.api.on("coaching_pack", (payload) => {
      setCoachingPack(payload);
    });

    const unsubscribeEngineStatus = window.api.on("engine_status", (payload) => {
      setEngineStatus(payload.state);
      setEngineDetail(payload.detail ?? "");
    });

    const unsubscribeOverlayMode = window.api.on("overlay_mode", (payload) => {
      setOverlayMode(payload.mode);
    });

    const unsubscribeWhisperStatus = window.api.on("whisper_status", (payload) => {
      setWhisperStatus(payload.status);
      setWhisperProgress(payload.progress);
      setWhisperStep(payload.step);
      setWhisperError(payload.error);
    });

    return () => {
      unsubscribeSttPartial();
      unsubscribeSttFinal();
      unsubscribeCoachingPack();
      unsubscribeEngineStatus();
      unsubscribeOverlayMode();
      unsubscribeWhisperStatus();
      void capture.stop();
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

  async function copyToClipboard(
    text: string,
    type: "response" | "question" | "bridge"
  ): Promise<void> {
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
    await window.api.logCopyAction({ type, text_length: text.length });
  }

  async function handleWhisperInstall(): Promise<void> {
    try {
      await window.api.whisperInstall();
    } catch (error) {
      console.error("Failed to install Whisper:", error);
    }
  }

  async function handleWhisperRetry(): Promise<void> {
    try {
      await window.api.whisperRetry();
    } catch (error) {
      console.error("Failed to retry Whisper installation:", error);
    }
  }

  const pack = coachingPack;
  const objectionLabel = pack.objection_id === "idle" ? "Listening" : objectionIdToLabel(pack.objection_id);
  const severity = pack.severity;
  const responseText = pack.response;
  const questionText = pack.question;
  const bridgeText = pack.bridge;

  const momentumScore = Math.max(0, Math.min(100, Math.round(pack.momentum_score)));
  const momentumScoreSlots = Math.ceil(momentumScore / 20); // Keep 5-slot visual indicator
  const momentumLevel = pack.momentum_level;
  const momentumLabel = momentumLevel.charAt(0).toUpperCase() + momentumLevel.slice(1);

  const competitorSignals = useMemo(() => {
    const signals: string[] = [];
    if (pack.competitor_mentions && pack.competitor_mentions.length > 0) {
      for (const mention of pack.competitor_mentions) {
        signals.push(
          mention === "dnb"
            ? "DNB"
            : mention
                .split(" ")
                .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                .join(" ")
        );
      }
    } else if (pack.momentum_reasons.includes("competitor_generic_provider")) {
      signals.push("Existing provider");
    }
    return signals;
  }, [pack.competitor_mentions, pack.momentum_reasons]);

  const intentLabel = useMemo(() => {
    const intent = pack.intent ?? "unknown";
    switch (intent) {
      case "demo_ready":
        return "Demo ready";
      case "curious":
        return "Curious";
      case "callback":
        return "Callback";
      case "price_check":
        return "Price check";
      case "competitor_locked":
        return "Competitor locked";
      case "brush_off":
        return "Brush off";
      case "not_relevant":
        return "Not relevant";
      case "unknown":
      default:
        return "Unknown";
    }
  }, [pack.intent]);

  const stageLabel = useMemo(() => {
    const stage = pack.conversation_stage ?? "unknown";
    switch (stage) {
      case "opening":
        return "Opening";
      case "rapport":
        return "Rapport";
      case "discovery":
        return "Discovery";
      case "objection_handling":
        return "Objection handling";
      case "value_exploration":
        return "Value exploration";
      case "demo_transition":
        return "Demo transition";
      case "next_step_close":
        return "Next step / close";
      case "ended":
        return "Ended";
      case "unknown":
      default:
        return "Unknown";
    }
  }, [pack.conversation_stage]);

  const errorBanner =
    micStatus === "error"
      ? `Microphone error: ${micDetail || "Permission denied or unavailable input device."}`
      : engineStatus === "error"
        ? `Engine error: ${engineDetail || "Whisper assets missing or failed to load."}`
        : "";
  const canStartCoaching =
    whisperStatus === "ready" &&
    engineStatus !== "running" &&
    engineStatus !== "loading_model" &&
    micStatus !== "error";
  // Keep VAD responsive for low-amplitude laptop microphone input.
  const vadPercent = Math.min(100, Math.max(0, Math.round(rms * 20000)));
  const transcriptPreview = (partialText || finalText || "").trim();

  return (
    <main className="panel" aria-label="Coach overlay">
      <div className="drag-region" />
      <header className="overlay-header">
        <h1 className="overlay-header__title">Tele Coach</h1>
        <p className="overlay-header__subtitle">Live Call Coaching</p>
      </header>
      <section className="momentum-indicator" aria-label="Interest level">
        <div className="momentum-indicator__label">{`Interest Level ${momentumScore}`}</div>
        <div className="momentum-indicator__row">
          <span className="momentum-indicator__level">{momentumLabel}</span>
          <div
            className="momentum-indicator__bar"
            role="meter"
            aria-valuenow={momentumScore}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Interest level ${momentumLabel}, ${momentumScore} of 100`}
          >
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className={`momentum-indicator__slot ${i < momentumScoreSlots ? "momentum-indicator__slot--filled" : ""}`}
              />
            ))}
          </div>
        </div>
      </section>
      <p className="status-line">
        Intent: <strong>{intentLabel}</strong>
      </p>
      <p className="status-line">
        Stage: <strong>{stageLabel}</strong>
      </p>
      <Badge label={`ENGINE: ${engineStatus.toUpperCase()}`} tone="success" />
      {errorBanner ? <div className="error-banner">{errorBanner}</div> : null}
      {whisperStatus !== "ready" ? (
        <div className="error-banner">
          Whisper is not ready for live coaching. Complete setup/verification in Settings.
        </div>
      ) : null}
      {engineDetail ? <p className="status-line">{engineDetail}</p> : null}
      <p className="status-line">
        Mic: <strong>{micStatus}</strong> {micDetail ? `- ${micDetail}` : ""}
      </p>
      <div className="vad-wrap" aria-label="Voice activity">
        <div className="vad-fill" style={{ width: `${vadPercent}%` }} />
      </div>
      <p className="status-line">
        Live transcript:{" "}
        <strong>{transcriptPreview.length > 0 ? transcriptPreview : "(no speech text yet)"}</strong>
      </p>
      <div className="controls">
        <button
          type="button"
          onClick={handleStart}
          disabled={!canStartCoaching}
          title={!canStartCoaching ? "Whisper health check must pass before coaching can start." : undefined}
        >
          Start coaching
        </button>
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
          {competitorSignals.length > 0 && (
            <div className="coaching-pack__competitor-mention">
              {competitorSignals.map((signal, index) => (
                <div key={signal + index}>Competitor signal: {signal}</div>
              ))}
            </div>
          )}
        </div>
        <div className="coaching-pack__block">
          <div className="coaching-pack__label">RESPONSE</div>
          <div className="coaching-pack__row">
            <div className="coaching-pack__content">{responseText}</div>
            <button
              type="button"
              className="copy-button"
              onClick={() => { void copyToClipboard(responseText, "response"); }}
              disabled={false}
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
              onClick={() => { void copyToClipboard(questionText, "question"); }}
              disabled={false}
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
              onClick={() => { void copyToClipboard(bridgeText, "bridge"); }}
              disabled={false}
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

      <WhisperSetup
        status={whisperStatus}
        progress={whisperProgress}
        step={whisperStep}
        error={whisperError}
        onInstall={handleWhisperInstall}
        onRetry={handleWhisperRetry}
      />
    </main>
  );
}
