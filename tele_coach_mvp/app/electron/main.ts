import { app, BrowserWindow, Menu, Tray, globalShortcut, nativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { registerIpcHandlers, type MainEventChannel } from "./ipc";
import {
  bootstrapDatabase,
  type Last7DayStats,
  type OutcomePayload,
  type PrivacySettings,
  type SttModelOption
} from "./sqlite";
import { createSettingsWindow } from "./windows/settings";
import { createOverlayWindow, setOverlayMode, type OverlayMode } from "./windows/overlay";
import {
  WhisperRunner,
  setWhisperDebugLogging,
  type AudioChunkPayload
} from "../../engine/stt/whisper/runner";
import { TranscriptNormalizer, type NormalizedTranscript } from "../../engine/stt/transcript_normalizer";
import { TranscriptRollingWindow, type RollingWindowState } from "../../engine/stt/transcript_rolling_window";
import {
  createInitialTranscriptSessionState,
  updateTranscriptSessionState,
  type TranscriptSessionState,
  getRecentStableSegments
} from "../../engine/stt/transcript_segmenter";
import { whisperManager } from "./whisper_manager";
import { detectObjectionId } from "../../engine/classifier/playbook_classifier";
import { selectCoachingPack } from "../../engine/response_engine/selector";
import { redactSensitiveText } from "../../engine/privacy/redaction";
import { loadFeatureFlags } from "./feature_flag_loader";
import { createEventLogger } from "../../engine/analytics/event_logger";

let overlayWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let overlayMode: OverlayMode = "compact";
let coachingEnabled = false;
let activeSessionId: string | null = null;
let audioChunkCounter = 0;

let debugSttEnabled =
  process.env.DEBUG_STT === "1" || process.env.DEBUG_STT === "true";
function debugSttLog(message: string): void {
  if (!debugSttEnabled) return;
  console.log(message);
}

const sttRunner = new WhisperRunner();
const transcriptNormalizer = new TranscriptNormalizer();
const transcriptRollingWindow = new TranscriptRollingWindow();
let transcriptSessionState: TranscriptSessionState = createInitialTranscriptSessionState();
let transcriptBuffer = "";
let lastObjectionSignature = "";
let lastObjectionId = "unknown";
let lastCoachingPack: any = null;
let lastConversationStage = "unknown";
let lastCoachingRefreshAt = 0;
let whisperFirstOutputLogged = false;

const db = bootstrapDatabase();
let privacySettings: PrivacySettings = normalizeSettings(db.getPrivacySettings());
const featureFlags = loadFeatureFlags();
const eventLogger = createEventLogger(db, () => privacySettings, {
  analyticsEnabled: () => featureFlags.analytics_logging_enabled
});
if (process.env.TELE_COACH_WHISPER_ALLOW_UPSTREAM_FALLBACK === undefined) {
  process.env.TELE_COACH_WHISPER_ALLOW_UPSTREAM_FALLBACK = featureFlags.whisper_upstream_fallback_allowed
    ? "true"
    : "false";
}
process.env.TELE_COACH_ADAPTIVE_WEIGHTING = featureFlags.adaptive_weighting_enabled
  ? "true"
  : "false";
const allowDebugPanels =
  featureFlags.local_debug_panels_enabled && featureFlags.environment !== "production";
debugSttEnabled =
  debugSttEnabled ||
  featureFlags.environment === "development" ||
  (allowDebugPanels && privacySettings.debug_logging);
setWhisperDebugLogging(debugSttEnabled);
 
function resolveRendererUrl(): string {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) return devServerUrl;
  const indexPath = app.isPackaged
    ? path.join(app.getAppPath(), "app", "renderer", "dist", "index.html")
    : path.resolve(process.cwd(), "app", "renderer", "dist", "index.html");
  return pathToFileURL(indexPath).toString();
}

function getOverlayWindowOptionsFromSettings(): { x?: number; y?: number; opacity: number } {
  const pos = db.getOverlayPosition();
  return {
    x: pos.x ?? undefined,
    y: pos.y ?? undefined,
    opacity: Math.min(1, Math.max(0.4, privacySettings.overlay_opacity))
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizeModel(model: string): SttModelOption {
  return model === "base.en" || model === "small.en" ? model : "tiny.en";
}

function normalizeSettings(next: PrivacySettings): PrivacySettings {
  return {
    ...next,
    stt_model: normalizeModel(next.stt_model),
    overlay_opacity: Number(clamp(next.overlay_opacity, 0.4, 1).toFixed(2)),
    transcript_max_chars: Math.round(clamp(next.transcript_max_chars, 200, 3000)),
    coaching_refresh_throttle_ms: Math.round(clamp(next.coaching_refresh_throttle_ms, 250, 5000))
  };
}

function emitOverlayMode(): void {
  emitToWindows("overlay_mode", { mode: overlayMode });
}

function emitToWindows<TPayload>(channel: MainEventChannel, payload: TPayload): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send(channel, payload);
  }
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send(channel, payload);
  }
}

function applyFeatureFlagsToPack(pack: any): any {
  const next = { ...pack };
  if (!featureFlags.competitor_detection_enabled) {
    next.competitor_mentions = [];
  }
  if (!featureFlags.intent_classification_enabled) {
    next.intent = "unknown";
    next.intent_confidence = 0;
    next.intent_signals = [];
  }
  if (!featureFlags.momentum_engine_v2_enabled) {
    next.momentum_level = "medium";
    next.momentum_score = 50;
    next.momentum_reasons = ["momentum_v2_disabled"];
  }
  return next;
}

interface WhisperSmokeResult {
  binary_ok: boolean;
  model_ok: boolean;
  launch_ok: boolean;
  transcript_ok: boolean;
  sample_output_preview: string;
  error?: string;
}

function resolveSampleWavPath(): string | null {
  const candidates = [
    path.join(process.cwd(), "test_audio.wav"),
    path.join(process.cwd(), "bindings", "go", "samples", "jfk.wav"),
    path.join(process.cwd(), "assets", "sample.wav"),
    path.join(process.cwd(), "assets", "samples", "sample.wav")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function parseWhisperStdout(raw: string): string {
  return raw
    .split("\n")
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, "").trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function runWhisperSmokeTest(): Promise<WhisperSmokeResult> {
  await whisperManager.ensureReady(privacySettings.stt_model);
  const binaryPath = whisperManager.getBinaryPath();
  const modelPath = whisperManager.getModelPath();
  const binary_ok = fs.existsSync(binaryPath);
  const model_ok = fs.existsSync(modelPath);
  const samplePath = resolveSampleWavPath();
  if (!samplePath) {
    return {
      binary_ok,
      model_ok,
      launch_ok: false,
      transcript_ok: false,
      sample_output_preview: "",
      error:
        "No sample wav found. Add test_audio.wav in project root, bindings/go/samples/jfk.wav, or assets/sample.wav."
    };
  }
  const args = ["-m", modelPath, "-l", "en", "--output-txt", "--no-timestamps", "-f", samplePath];
  return await new Promise<WhisperSmokeResult>((resolve) => {
    let launch_ok = false;
    let stdout = "";
    let stderr = "";
    let settled = false;
    const startedAt = Date.now();
    const child = spawn(binaryPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({
        binary_ok,
        model_ok,
        launch_ok,
        transcript_ok: false,
        sample_output_preview: "",
        error: "Whisper smoke test timed out after 20s."
      });
    }, 20_000);
    child.once("spawn", () => {
      launch_ok = true;
      console.log(`[WhisperRuntime] launch_success binary="${binaryPath}" model="${modelPath}"`);
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        binary_ok,
        model_ok,
        launch_ok: false,
        transcript_ok: false,
        sample_output_preview: "",
        error: `Launch failed: ${err.message}`
      });
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const transcript = parseWhisperStdout(stdout);
      const looksLikeHelp = /usage:|--help|options:/i.test(stdout);
      const transcript_ok = code === 0 && transcript.length > 0 && !looksLikeHelp;
      if (!transcript_ok) {
        console.log(
          `[WhisperRuntime] exit_unexpected code=${String(code)} signal=${String(
            signal
          )} stderr="${stderr.trim()}"`
        );
      }
      resolve({
        binary_ok,
        model_ok,
        launch_ok,
        transcript_ok,
        sample_output_preview: transcript.slice(0, 180),
        error: transcript_ok
          ? undefined
          : `code=${String(code)} signal=${String(signal)} stderr="${stderr.trim()}" stdout="${stdout.trim()}" duration_ms=${Date.now() - startedAt}`
      });
    });
  });
}

function logSignalsFromPack(pack: any): void {
  eventLogger.logCoachingPack(activeSessionId, pack);
  eventLogger.logSeverityDetected(activeSessionId, {
    severity: pack.severity,
    objection_id: pack.objection_id
  });
  eventLogger.logIntentDetected(activeSessionId, {
    intent: pack.intent ?? "unknown",
    confidence: pack.intent_confidence,
    signals: pack.intent_signals
  });
  if (Array.isArray(pack.competitor_mentions) && pack.competitor_mentions.length > 0) {
    eventLogger.logCompetitorDetected(activeSessionId, {
      mentions: pack.competitor_mentions,
      objection_id: pack.objection_id
    });
  }
  const nextStage = pack.conversation_stage ?? "unknown";
  if (nextStage !== lastConversationStage) {
    eventLogger.logStageChanged(activeSessionId, {
      from: lastConversationStage,
      to: nextStage,
      confidence: pack.stage_confidence
    });
    lastConversationStage = nextStage;
  }
}

function updateTrayMenu(): void {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    {
      label: "Toggle coaching",
      click: () => {
        coachingEnabled = !coachingEnabled;
        if (coachingEnabled) {
          startRunner();
        } else {
          stopRunner("Coaching paused");
        }
        updateTrayMenu();
      }
    },
    {
      label: "Toggle overlay visibility",
      click: () => {
        toggleOverlayVisibility();
      }
    },
    {
      label: "Show settings",
      click: () => {
        if (!settingsWindow || settingsWindow.isDestroyed()) return;
        settingsWindow.show();
        settingsWindow.focus();
      }
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => app.quit()
    }
  ]);
  tray.setContextMenu(menu);
}

function createTray(): void {
  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAJ0lEQVR42mNgwA8YGBgY/kfF4P///4eRkRGmGBQMA0YQjI8Pj0AFAAE6CAx5Cv4YAAAAAElFTkSuQmCC"
  );
  tray = new Tray(icon);
  tray.setToolTip("Tele Coach");
  updateTrayMenu();
}

function registerGlobalShortcuts(): void {
  globalShortcut.register("CommandOrControl+Shift+L", () => {
    coachingEnabled = !coachingEnabled;
    if (coachingEnabled) {
      startRunner();
    } else {
      stopRunner("Coaching paused");
    }
    updateTrayMenu();
  });

  globalShortcut.register("CommandOrControl+Shift+O", () => {
    toggleOverlayVisibility();
  });
}

function toggleOverlayVisibility(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (overlayWindow.isVisible()) {
    overlayWindow.hide();
  } else {
    overlayWindow.show();
    overlayWindow.focus();
  }
}

function attachOverlayMovePersistence(window: BrowserWindow): void {
  const persist = () => {
    const [x, y] = window.getPosition();
    db.setOverlayPosition({ x, y });
  };
  window.on("move", persist);
  window.on("moved", persist);
}

function attachRunnerEvents(): void {
  sttRunner.on("status", (payload) => {
    emitToWindows("engine_status", payload);
    if (payload.state === "error") {
      console.log(`[WhisperRuntime] launch_failure detail="${payload.detail ?? "unknown"}"`);
    }
    
    // Auto-switch to manual mode if Whisper fails
    if (payload.state === "error" && (payload.detail?.includes("whisper stdin pipe error") || payload.detail?.includes("Sales floor mode"))) {
      // Stop the failed runner and show manual input instructions
      setTimeout(() => {
        stopRunner("Switching to manual input mode");
        emitToWindows("engine_status", { 
          state: "stopped", 
          detail: "Sales floor mode: Use manual test input or restart with proper Whisper setup" 
        });
      }, 1000);
    }
  });

  sttRunner.on("runtime_launch", (payload) => {
    console.log(
      `[WhisperRuntime] launch binary="${payload.binaryPath}" model="${payload.modelPath}" args="${payload.args.join(
        " "
      )}"`
    );
  });

  sttRunner.on("runtime_exit", (payload) => {
    if (payload.code !== 0 || payload.signal) {
      console.log(
        `[WhisperRuntime] exit_unexpected code=${String(payload.code)} signal=${String(
          payload.signal
        )} stderr="${payload.stderr}"`
      );
    }
  });
  
  sttRunner.on("partial", (payload) => {
    if (!whisperFirstOutputLogged && payload.text.trim().length > 0) {
      whisperFirstOutputLogged = true;
      console.log("[WhisperRuntime] whisper_first_output_received");
    }
    handleTranscriptChunk({
      text: payload.text,
      tsMs: payload.tsMs,
      is_partial: true
    });
  });
  
  sttRunner.on("final", (payload) => {
    if (!whisperFirstOutputLogged && payload.text.trim().length > 0) {
      whisperFirstOutputLogged = true;
      console.log("[WhisperRuntime] whisper_first_output_received");
    }
    handleTranscriptChunk({
      text: payload.text,
      tsMs: payload.tsMs,
      is_partial: false
    });
  });
}

/**
 * Handle incoming transcript chunks with normalization and rolling window logic
 */
function handleTranscriptChunk(chunk: { text: string; tsMs: number; is_partial: boolean }): void {
  // Process chunk through normalizer
  const normalized = transcriptNormalizer.processChunk(chunk);
  if (!normalized) {
    // Chunk was filtered out (duplicate, micro-fluctuation, etc.)
    return;
  }

  // Update rolling window
  const windowState = transcriptRollingWindow.processChunk(normalized);

  // Update structured transcript segments
  transcriptSessionState = updateTranscriptSessionState(transcriptSessionState, {
    text: normalized.text,
    tsMs: normalized.tsMs,
    isPartial: normalized.isPartial
  });

  // Emit appropriate events to renderer
  if (normalized.isPartial) {
    emitToWindows("stt_partial", { 
      text: normalized.text, 
      tsMs: normalized.tsMs 
    });
  } else {
    emitToWindows("stt_final", { 
      text: normalized.text, 
      tsMs: normalized.tsMs 
    });
    maybeStoreTranscript(normalized.text);
    eventLogger.logTranscriptSegmentFinalized(activeSessionId, {
      chars: normalized.text.length,
      tsMs: normalized.tsMs
    });
  }

  // Handle objection classification and coaching
  handleObjectionClassificationWithWindow(windowState);

  // Trigger coaching update if needed
  if (normalized.shouldTriggerCoaching) {
    triggerCoachingUpdate(windowState);
  }

  // Periodic cleanup
  if (Math.random() < 0.01) { // 1% chance per chunk
    transcriptRollingWindow.cleanup();
  }
}

function updateTranscriptBuffer(nextText: string): void {
  const combined = `${transcriptBuffer} ${nextText}`.trim();
  transcriptBuffer = combined.slice(-privacySettings.transcript_max_chars);
}

function signatureForObjection(payload: { id: string; confidence: number; matched: string[] }): string {
  return `${payload.id}|${payload.confidence.toFixed(3)}|${payload.matched.join(",")}`;
}

/**
 * Handle objection classification using rolling window state
 */
function handleObjectionClassificationWithWindow(windowState: RollingWindowState): void {
  // Use rolling coaching text for objection detection
  const coachingText = windowState.rollingCoachingText;
  if (!coachingText) return;

  // Update legacy buffer for compatibility
  transcriptBuffer = coachingText.slice(-privacySettings.transcript_max_chars);
  
  const result = detectObjectionId(coachingText);
  const signature = signatureForObjection(result);
  lastObjectionId = result.id;
  
  if (signature !== lastObjectionSignature) {
    lastObjectionSignature = signature;
    if (privacySettings.store_events && activeSessionId) {
      db.logObjectionEvent(activeSessionId, {
        objection_id: result.id,
        confidence: result.confidence,
        matched_phrases: result.matched
      });
      eventLogger.logObjectionDetected(activeSessionId, {
        objection_id: result.id,
        confidence: result.confidence,
        matched_phrases: result.matched
      });
    }
  }
}

/**
 * Legacy function for backward compatibility
 */
function handleObjectionClassification(latestText: string): void {
  updateTranscriptBuffer(latestText);
  const result = detectObjectionId(transcriptBuffer);
  const signature = signatureForObjection(result);
  lastObjectionId = result.id;
  if (signature !== lastObjectionSignature) {
    lastObjectionSignature = signature;
    if (privacySettings.store_events && activeSessionId) {
      db.logObjectionEvent(activeSessionId, {
        objection_id: result.id,
        confidence: result.confidence,
        matched_phrases: result.matched
      });
      eventLogger.logObjectionDetected(activeSessionId, {
        objection_id: result.id,
        confidence: result.confidence,
        matched_phrases: result.matched
      });
    }
  }

  // New response engine: emit coaching pack for renderer
  const pack = applyFeatureFlagsToPack(selectCoachingPack(transcriptBuffer));
  logSignalsFromPack(pack);
  emitToWindows("coaching_pack", pack);
}

/**
 * Trigger coaching update with deduplication
 */
function triggerCoachingUpdate(windowState: RollingWindowState): void {
  const coachingText = windowState.rollingCoachingText;
  if (!coachingText) return;
  const now = Date.now();
  if (now - lastCoachingRefreshAt < privacySettings.coaching_refresh_throttle_ms) {
    return;
  }

  const recentStableSegments = getRecentStableSegments(transcriptSessionState, 10).map(
    (s) => ({ id: s.id, text: s.text })
  );

  // Generate new coaching pack with context
  const newPack = applyFeatureFlagsToPack(selectCoachingPack(coachingText, {
    rollingText: transcriptSessionState.rollingText,
    recentStableSegments
  }));
  
  // Simple deduplication - check if pack content is materially different
  if (lastCoachingPack && isCoachingPackSimilar(lastCoachingPack, newPack)) {
    return; // Skip update if too similar
  }

  lastCoachingPack = newPack;
  lastCoachingRefreshAt = now;
  logSignalsFromPack(newPack);
  emitToWindows("coaching_pack", newPack);
}

/**
 * Simple similarity check for coaching packs to avoid flicker
 */
function isCoachingPackSimilar(pack1: any, pack2: any): boolean {
  if (!pack1 || !pack2) return false;
  
  // Check main objection
  if (pack1.objection?.id !== pack2.objection?.id) return false;
  
  // Check response text similarity
  const response1 = pack1.response?.text || "";
  const response2 = pack2.response?.text || "";
  
  // Consider similar if text is identical or very close
  if (response1 === response2) return true;
  
  // Check if length difference is small and content mostly overlaps
  const lengthDiff = Math.abs(response1.length - response2.length);
  if (lengthDiff <= 10 && (response1.includes(response2) || response2.includes(response1))) {
    return true;
  }
  
  return false;
}

function maybeStoreTranscript(text: string): void {
  if (!privacySettings.store_transcript) return;
  const redacted = privacySettings.redaction_enabled ? redactSensitiveText(text) : text;
  eventLogger.logTranscriptRedacted({ text, redacted_text: redacted });
}

async function startRunner(fallbackMode = true): Promise<void> {
  debugSttLog(`[Main] startRunner called, whisper status: ${whisperManager.getStatus()}`);
  const health = await whisperManager.runStartupHealthCheck();
  if (!health.ok) {
    const reason = health.error ?? "Unknown Whisper health check failure.";
    console.log(`[WhisperRuntime] startup_health_check_failed reason="${reason}"`);
    emitToWindows("engine_status", {
      state: "error",
      detail: `Whisper health check failed. ${reason} Open Settings and run Whisper setup/verification before retrying.`
    });
    return;
  }
  const whisperStatus = whisperManager.getStatus();
  debugSttLog(`[Main] Whisper status after health check: ${whisperStatus}`);

  const activeModel = whisperManager.getActiveModel();
  if (activeModel !== privacySettings.stt_model) {
    const reverted = normalizeSettings({
      ...privacySettings,
      stt_model: activeModel
    });
    privacySettings = db.setPrivacySettings(reverted);
    emitToWindows("engine_status", {
      state: "running",
      detail:
        whisperManager.getModelWarning() ??
        `Selected model unavailable. Reverted to ${activeModel}.`
    });
  }

  debugSttLog(`[Main] Whisper ready, starting runner`);
  // Reset transcript processing components
  transcriptNormalizer.reset();
  transcriptRollingWindow.reset();
  transcriptSessionState = createInitialTranscriptSessionState();
  transcriptBuffer = "";
  lastObjectionSignature = "";
  lastObjectionId = "unknown";
  lastCoachingPack = null;
  lastConversationStage = "unknown";
  lastCoachingRefreshAt = 0;
  whisperFirstOutputLogged = false;
  activeSessionId = db.startSession();
  eventLogger.logSessionStarted(activeSessionId, { source: fallbackMode ? "fallback" : "live" });
  const runtimeBinaryPath = whisperManager.getBinaryPath();
  const runtimeModelPath = whisperManager.getModelPath();
  console.log(
    `[WhisperRuntime] runner_start binary="${runtimeBinaryPath}" model="${runtimeModelPath}"`
  );
  sttRunner.start({
    binaryPath: runtimeBinaryPath,
    modelPath: runtimeModelPath,
    fallbackMode
  });
  emitOverlayMode();
}

function stopRunner(reason: string): void {
  sttRunner.stop();
  if (activeSessionId) {
    eventLogger.logSessionEnded(activeSessionId, { reason });
    db.endSession(activeSessionId);
    activeSessionId = null;
  }
  
  // Reset transcript processing components
  transcriptNormalizer.reset();
  transcriptRollingWindow.reset();
  transcriptBuffer = "";
  lastObjectionSignature = "";
  lastObjectionId = "unknown";
  lastCoachingPack = null;
  lastConversationStage = "unknown";
  lastCoachingRefreshAt = 0;
  whisperFirstOutputLogged = false;
  
  emitToWindows("engine_status", { state: "stopped", detail: reason });
  emitOverlayMode();
}

async function bootstrap(): Promise<void> {
  const whisperPolicy = whisperManager.getPolicySummary();
  console.log(
    `[WhisperRuntime] policy mode=${whisperPolicy.mode} platform=${whisperPolicy.platformKey} release=${whisperPolicy.releaseTag}`
  );
  const rendererUrl = resolveRendererUrl();
  overlayWindow = createOverlayWindow(rendererUrl, getOverlayWindowOptionsFromSettings());
  settingsWindow = createSettingsWindow(rendererUrl);
  settingsWindow.hide();
  attachOverlayMovePersistence(overlayWindow);

  createTray();
  registerGlobalShortcuts();
  attachRunnerEvents();
  emitOverlayMode();

  registerIpcHandlers({
    onStartCoaching: () => {
      coachingEnabled = true;
      void startRunner(false);
      updateTrayMenu();
    },
    onStopCoaching: () => {
      coachingEnabled = false;
      stopRunner("Coaching stopped");
      updateTrayMenu();
    },
    onToggleOverlayMode: () => {
      if (!overlayWindow || overlayWindow.isDestroyed()) return;
      overlayMode = overlayMode === "compact" ? "expanded" : "compact";
      setOverlayMode(overlayWindow, overlayMode);
      emitOverlayMode();
    },
    onLogOutcome: (payload: OutcomePayload) => {
      eventLogger.logOutcome(activeSessionId, payload);
    },
    onLogCopyAction: (payload: { type: "response" | "question" | "bridge"; text_length: number }) => {
      eventLogger.logCopyAction(activeSessionId, payload);
    },
    onGetSettings: () => {
      return privacySettings;
    },
    onUpdateSettings: (payload: PrivacySettings) => {
      const normalized = normalizeSettings(payload);
      const previousModel = privacySettings.stt_model;
      privacySettings = db.setPrivacySettings(normalized);
      debugSttEnabled =
        process.env.DEBUG_STT === "1" ||
        process.env.DEBUG_STT === "true" ||
        featureFlags.environment === "development" ||
        (allowDebugPanels && privacySettings.debug_logging);
      setWhisperDebugLogging(debugSttEnabled);
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.setOpacity(Math.min(1, Math.max(0.4, privacySettings.overlay_opacity)));
      }
      if (privacySettings.stt_model !== previousModel) {
        void whisperManager.ensureReady(privacySettings.stt_model).then(() => {
          const status = whisperManager.getStatus();
          const activeModel = whisperManager.getActiveModel();
          if (activeModel !== privacySettings.stt_model) {
            privacySettings = db.setPrivacySettings(
              normalizeSettings({ ...privacySettings, stt_model: activeModel })
            );
          }
          if (status === "ready") {
            emitToWindows("engine_status", {
              state: coachingEnabled ? "running" : "stopped",
              detail:
                whisperManager.getModelWarning() ??
                `Whisper model set to ${activeModel}.`
            });
          }
        });
      }
      return privacySettings;
    },
    onGetStats: (): Last7DayStats => {
      if (!featureFlags.operator_dashboard_enabled) {
        throw new Error("Dashboard is disabled by feature flag.");
      }
      return eventLogger.getLast7DayStats();
    },
    onRunManualTest: (payload: { text: string }) => {
      const text = payload.text.trim();
      if (!text) return;
      
      // Use the new transcript processing system for manual tests
      handleTranscriptChunk({
        text,
        tsMs: Date.now(),
        is_partial: false
      });
    },
    onDeleteData: () => {
      stopRunner("Deleting local data");
      db.deleteDatabaseFile();
      app.relaunch();
      app.exit(0);
    },
    onAudioChunk: (payload: AudioChunkPayload) => {
      // Intentionally process in-memory only; never persist raw audio.
      audioChunkCounter += 1;
      sttRunner.ingestAudioChunk(payload);
      if (audioChunkCounter % 20 === 0) {
        emitToWindows("engine_status", {
          state: coachingEnabled ? "running" : "stopped",
          detail: `Audio chunks received: ${audioChunkCounter}`
        });
      }
    },
    onWhisperStatus: () => {
      return {
        status: whisperManager.getStatus(),
        binaryPath: whisperManager.getBinaryPath(),
        modelPath: whisperManager.getModelPath(),
        activeModel: whisperManager.getActiveModel(),
        warning: whisperManager.getModelWarning()
      };
    },
    onWhisperInstall: async () => {
      await whisperManager.install();
    },
    onWhisperRetry: async () => {
      await whisperManager.install();
    },
    onRunWhisperTest: async () => {
      return runWhisperSmokeTest();
    },
    onGetFeatureFlags: () => {
      return featureFlags;
    }
  });

  emitToWindows("engine_status", {
    state: "stopped",
    detail: `DB ready at ${db.dbPath}. Start coaching to load model.`
  });

  // Initialize Whisper Manager
  whisperManager.onStatusChange((event) => {
    emitToWindows("whisper_status", event);
    eventLogger.logWhisperStatus(activeSessionId, event);
  });

  // Don't block startup - let Whisper setup happen in background
  void whisperManager.ensureReady(privacySettings.stt_model);
  if (privacySettings.auto_start_on_launch) {
    coachingEnabled = true;
    void startRunner(false);
    updateTrayMenu();
  }
}

app.whenReady().then(bootstrap);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    const rendererUrl = resolveRendererUrl();
    overlayWindow = createOverlayWindow(rendererUrl, getOverlayWindowOptionsFromSettings());
    attachOverlayMovePersistence(overlayWindow);
    emitOverlayMode();
  }
});

app.on("before-quit", () => {
  globalShortcut.unregisterAll();
  stopRunner("Application exiting");
  db.close();
});
