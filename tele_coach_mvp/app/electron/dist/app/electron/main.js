"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const node_url_1 = require("node:url");
const ipc_1 = require("./ipc");
const sqlite_1 = require("./sqlite");
const settings_1 = require("./windows/settings");
const overlay_1 = require("./windows/overlay");
const runner_1 = require("../../engine/stt/whisper/runner");
const transcript_normalizer_1 = require("../../engine/stt/transcript_normalizer");
const transcript_rolling_window_1 = require("../../engine/stt/transcript_rolling_window");
const transcript_segmenter_1 = require("../../engine/stt/transcript_segmenter");
const whisper_manager_1 = require("./whisper_manager");
const playbook_classifier_1 = require("../../engine/classifier/playbook_classifier");
const selector_1 = require("../../engine/response_engine/selector");
const redaction_1 = require("../../engine/privacy/redaction");
const feature_flag_loader_1 = require("./feature_flag_loader");
const event_logger_1 = require("../../engine/analytics/event_logger");
let overlayWindow = null;
let settingsWindow = null;
let tray = null;
let overlayMode = "compact";
let coachingEnabled = false;
let activeSessionId = null;
let audioChunkCounter = 0;
let debugSttEnabled = process.env.DEBUG_STT === "1" || process.env.DEBUG_STT === "true";
function debugSttLog(message) {
    if (!debugSttEnabled)
        return;
    console.log(message);
}
const sttRunner = new runner_1.WhisperRunner();
const transcriptNormalizer = new transcript_normalizer_1.TranscriptNormalizer();
const transcriptRollingWindow = new transcript_rolling_window_1.TranscriptRollingWindow();
let transcriptSessionState = (0, transcript_segmenter_1.createInitialTranscriptSessionState)();
let transcriptBuffer = "";
let lastObjectionSignature = "";
let lastObjectionId = "unknown";
let lastCoachingPack = null;
let lastConversationStage = "unknown";
let lastCoachingRefreshAt = 0;
let whisperFirstOutputLogged = false;
const db = (0, sqlite_1.bootstrapDatabase)();
let privacySettings = normalizeSettings(db.getPrivacySettings());
const featureFlags = (0, feature_flag_loader_1.loadFeatureFlags)();
const eventLogger = (0, event_logger_1.createEventLogger)(db, () => privacySettings, {
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
const allowDebugPanels = featureFlags.local_debug_panels_enabled && featureFlags.environment !== "production";
debugSttEnabled =
    debugSttEnabled ||
        featureFlags.environment === "development" ||
        (allowDebugPanels && privacySettings.debug_logging);
(0, runner_1.setWhisperDebugLogging)(debugSttEnabled);
function resolveRendererUrl() {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    if (devServerUrl)
        return devServerUrl;
    const indexPath = electron_1.app.isPackaged
        ? node_path_1.default.join(electron_1.app.getAppPath(), "app", "renderer", "dist", "index.html")
        : node_path_1.default.resolve(process.cwd(), "app", "renderer", "dist", "index.html");
    return (0, node_url_1.pathToFileURL)(indexPath).toString();
}
function getOverlayWindowOptionsFromSettings() {
    const pos = db.getOverlayPosition();
    return {
        x: pos.x ?? undefined,
        y: pos.y ?? undefined,
        opacity: Math.min(1, Math.max(0.4, privacySettings.overlay_opacity))
    };
}
function clamp(value, min, max) {
    if (!Number.isFinite(value))
        return min;
    if (value < min)
        return min;
    if (value > max)
        return max;
    return value;
}
function normalizeModel(model) {
    return model === "base.en" || model === "small.en" ? model : "tiny.en";
}
function normalizeSettings(next) {
    return {
        ...next,
        stt_model: normalizeModel(next.stt_model),
        overlay_opacity: Number(clamp(next.overlay_opacity, 0.4, 1).toFixed(2)),
        transcript_max_chars: Math.round(clamp(next.transcript_max_chars, 200, 3000)),
        coaching_refresh_throttle_ms: Math.round(clamp(next.coaching_refresh_throttle_ms, 250, 5000))
    };
}
function emitOverlayMode() {
    emitToWindows("overlay_mode", { mode: overlayMode });
}
function emitToWindows(channel, payload) {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send(channel, payload);
    }
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.webContents.send(channel, payload);
    }
}
function applyFeatureFlagsToPack(pack) {
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
function resolveSampleWavPath() {
    const candidates = [
        node_path_1.default.join(process.cwd(), "test_audio.wav"),
        node_path_1.default.join(process.cwd(), "bindings", "go", "samples", "jfk.wav"),
        node_path_1.default.join(process.cwd(), "assets", "sample.wav"),
        node_path_1.default.join(process.cwd(), "assets", "samples", "sample.wav")
    ];
    for (const candidate of candidates) {
        if (node_fs_1.default.existsSync(candidate))
            return candidate;
    }
    return null;
}
function parseWhisperStdout(raw) {
    return raw
        .split("\n")
        .map((line) => line.replace(/^\[[^\]]+\]\s*/, "").trim())
        .filter((line) => line.length > 0)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
}
async function runWhisperSmokeTest() {
    await whisper_manager_1.whisperManager.ensureReady(privacySettings.stt_model);
    const binaryPath = whisper_manager_1.whisperManager.getBinaryPath();
    const modelPath = whisper_manager_1.whisperManager.getModelPath();
    const binary_ok = node_fs_1.default.existsSync(binaryPath);
    const model_ok = node_fs_1.default.existsSync(modelPath);
    const samplePath = resolveSampleWavPath();
    if (!samplePath) {
        return {
            binary_ok,
            model_ok,
            launch_ok: false,
            transcript_ok: false,
            sample_output_preview: "",
            error: "No sample wav found. Add test_audio.wav in project root, bindings/go/samples/jfk.wav, or assets/sample.wav."
        };
    }
    const args = ["-m", modelPath, "-l", "en", "--output-txt", "--no-timestamps", "-f", samplePath];
    return await new Promise((resolve) => {
        let launch_ok = false;
        let stdout = "";
        let stderr = "";
        let settled = false;
        const startedAt = Date.now();
        const child = (0, node_child_process_1.spawn)(binaryPath, args, { stdio: ["ignore", "pipe", "pipe"] });
        const timer = setTimeout(() => {
            if (settled)
                return;
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
        }, 20000);
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
            if (settled)
                return;
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
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            const transcript = parseWhisperStdout(stdout);
            const looksLikeHelp = /usage:|--help|options:/i.test(stdout);
            const transcript_ok = code === 0 && transcript.length > 0 && !looksLikeHelp;
            if (!transcript_ok) {
                console.log(`[WhisperRuntime] exit_unexpected code=${String(code)} signal=${String(signal)} stderr="${stderr.trim()}"`);
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
function logSignalsFromPack(pack) {
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
function updateTrayMenu() {
    if (!tray)
        return;
    const menu = electron_1.Menu.buildFromTemplate([
        {
            label: "Toggle coaching",
            click: () => {
                coachingEnabled = !coachingEnabled;
                if (coachingEnabled) {
                    startRunner();
                }
                else {
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
                if (!settingsWindow || settingsWindow.isDestroyed())
                    return;
                settingsWindow.show();
                settingsWindow.focus();
            }
        },
        { type: "separator" },
        {
            label: "Quit",
            click: () => electron_1.app.quit()
        }
    ]);
    tray.setContextMenu(menu);
}
function createTray() {
    const icon = electron_1.nativeImage.createFromDataURL("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAJ0lEQVR42mNgwA8YGBgY/kfF4P///4eRkRGmGBQMA0YQjI8Pj0AFAAE6CAx5Cv4YAAAAAElFTkSuQmCC");
    tray = new electron_1.Tray(icon);
    tray.setToolTip("Tele Coach");
    updateTrayMenu();
}
function registerGlobalShortcuts() {
    electron_1.globalShortcut.register("CommandOrControl+Shift+L", () => {
        coachingEnabled = !coachingEnabled;
        if (coachingEnabled) {
            startRunner();
        }
        else {
            stopRunner("Coaching paused");
        }
        updateTrayMenu();
    });
    electron_1.globalShortcut.register("CommandOrControl+Shift+O", () => {
        toggleOverlayVisibility();
    });
}
function toggleOverlayVisibility() {
    if (!overlayWindow || overlayWindow.isDestroyed())
        return;
    if (overlayWindow.isVisible()) {
        overlayWindow.hide();
    }
    else {
        overlayWindow.show();
        overlayWindow.focus();
    }
}
function attachOverlayMovePersistence(window) {
    const persist = () => {
        const [x, y] = window.getPosition();
        db.setOverlayPosition({ x, y });
    };
    window.on("move", persist);
    window.on("moved", persist);
}
function attachRunnerEvents() {
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
        console.log(`[WhisperRuntime] launch binary="${payload.binaryPath}" model="${payload.modelPath}" args="${payload.args.join(" ")}"`);
    });
    sttRunner.on("runtime_exit", (payload) => {
        if (payload.code !== 0 || payload.signal) {
            console.log(`[WhisperRuntime] exit_unexpected code=${String(payload.code)} signal=${String(payload.signal)} stderr="${payload.stderr}"`);
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
function handleTranscriptChunk(chunk) {
    // Process chunk through normalizer
    const normalized = transcriptNormalizer.processChunk(chunk);
    if (!normalized) {
        // Chunk was filtered out (duplicate, micro-fluctuation, etc.)
        return;
    }
    // Update rolling window
    const windowState = transcriptRollingWindow.processChunk(normalized);
    // Update structured transcript segments
    transcriptSessionState = (0, transcript_segmenter_1.updateTranscriptSessionState)(transcriptSessionState, {
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
    }
    else {
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
function updateTranscriptBuffer(nextText) {
    const combined = `${transcriptBuffer} ${nextText}`.trim();
    transcriptBuffer = combined.slice(-privacySettings.transcript_max_chars);
}
function signatureForObjection(payload) {
    return `${payload.id}|${payload.confidence.toFixed(3)}|${payload.matched.join(",")}`;
}
/**
 * Handle objection classification using rolling window state
 */
function handleObjectionClassificationWithWindow(windowState) {
    // Use rolling coaching text for objection detection
    const coachingText = windowState.rollingCoachingText;
    if (!coachingText)
        return;
    // Update legacy buffer for compatibility
    transcriptBuffer = coachingText.slice(-privacySettings.transcript_max_chars);
    const result = (0, playbook_classifier_1.detectObjectionId)(coachingText);
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
function handleObjectionClassification(latestText) {
    updateTranscriptBuffer(latestText);
    const result = (0, playbook_classifier_1.detectObjectionId)(transcriptBuffer);
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
    const pack = applyFeatureFlagsToPack((0, selector_1.selectCoachingPack)(transcriptBuffer));
    logSignalsFromPack(pack);
    emitToWindows("coaching_pack", pack);
}
/**
 * Trigger coaching update with deduplication
 */
function triggerCoachingUpdate(windowState) {
    const coachingText = windowState.rollingCoachingText;
    if (!coachingText)
        return;
    const now = Date.now();
    if (now - lastCoachingRefreshAt < privacySettings.coaching_refresh_throttle_ms) {
        return;
    }
    const recentStableSegments = (0, transcript_segmenter_1.getRecentStableSegments)(transcriptSessionState, 10).map((s) => ({ id: s.id, text: s.text }));
    // Generate new coaching pack with context
    const newPack = applyFeatureFlagsToPack((0, selector_1.selectCoachingPack)(coachingText, {
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
function isCoachingPackSimilar(pack1, pack2) {
    if (!pack1 || !pack2)
        return false;
    // Check main objection
    if (pack1.objection?.id !== pack2.objection?.id)
        return false;
    // Check response text similarity
    const response1 = pack1.response?.text || "";
    const response2 = pack2.response?.text || "";
    // Consider similar if text is identical or very close
    if (response1 === response2)
        return true;
    // Check if length difference is small and content mostly overlaps
    const lengthDiff = Math.abs(response1.length - response2.length);
    if (lengthDiff <= 10 && (response1.includes(response2) || response2.includes(response1))) {
        return true;
    }
    return false;
}
function maybeStoreTranscript(text) {
    if (!privacySettings.store_transcript)
        return;
    const redacted = privacySettings.redaction_enabled ? (0, redaction_1.redactSensitiveText)(text) : text;
    eventLogger.logTranscriptRedacted({ text, redacted_text: redacted });
}
async function startRunner(fallbackMode = true) {
    debugSttLog(`[Main] startRunner called, whisper status: ${whisper_manager_1.whisperManager.getStatus()}`);
    const health = await whisper_manager_1.whisperManager.runStartupHealthCheck();
    if (!health.ok) {
        const reason = health.error ?? "Unknown Whisper health check failure.";
        console.log(`[WhisperRuntime] startup_health_check_failed reason="${reason}"`);
        emitToWindows("engine_status", {
            state: "error",
            detail: `Whisper health check failed. ${reason} Open Settings and run Whisper setup/verification before retrying.`
        });
        return;
    }
    const whisperStatus = whisper_manager_1.whisperManager.getStatus();
    debugSttLog(`[Main] Whisper status after health check: ${whisperStatus}`);
    const activeModel = whisper_manager_1.whisperManager.getActiveModel();
    if (activeModel !== privacySettings.stt_model) {
        const reverted = normalizeSettings({
            ...privacySettings,
            stt_model: activeModel
        });
        privacySettings = db.setPrivacySettings(reverted);
        emitToWindows("engine_status", {
            state: "running",
            detail: whisper_manager_1.whisperManager.getModelWarning() ??
                `Selected model unavailable. Reverted to ${activeModel}.`
        });
    }
    debugSttLog(`[Main] Whisper ready, starting runner`);
    // Reset transcript processing components
    transcriptNormalizer.reset();
    transcriptRollingWindow.reset();
    transcriptSessionState = (0, transcript_segmenter_1.createInitialTranscriptSessionState)();
    transcriptBuffer = "";
    lastObjectionSignature = "";
    lastObjectionId = "unknown";
    lastCoachingPack = null;
    lastConversationStage = "unknown";
    lastCoachingRefreshAt = 0;
    whisperFirstOutputLogged = false;
    activeSessionId = db.startSession();
    eventLogger.logSessionStarted(activeSessionId, { source: fallbackMode ? "fallback" : "live" });
    const runtimeBinaryPath = whisper_manager_1.whisperManager.getBinaryPath();
    const runtimeModelPath = whisper_manager_1.whisperManager.getModelPath();
    console.log(`[WhisperRuntime] runner_start binary="${runtimeBinaryPath}" model="${runtimeModelPath}"`);
    sttRunner.start({
        binaryPath: runtimeBinaryPath,
        modelPath: runtimeModelPath,
        fallbackMode
    });
    emitOverlayMode();
}
function stopRunner(reason) {
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
async function bootstrap() {
    const whisperPolicy = whisper_manager_1.whisperManager.getPolicySummary();
    console.log(`[WhisperRuntime] policy mode=${whisperPolicy.mode} platform=${whisperPolicy.platformKey} release=${whisperPolicy.releaseTag}`);
    const rendererUrl = resolveRendererUrl();
    overlayWindow = (0, overlay_1.createOverlayWindow)(rendererUrl, getOverlayWindowOptionsFromSettings());
    settingsWindow = (0, settings_1.createSettingsWindow)(rendererUrl);
    settingsWindow.hide();
    attachOverlayMovePersistence(overlayWindow);
    createTray();
    registerGlobalShortcuts();
    attachRunnerEvents();
    emitOverlayMode();
    (0, ipc_1.registerIpcHandlers)({
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
            if (!overlayWindow || overlayWindow.isDestroyed())
                return;
            overlayMode = overlayMode === "compact" ? "expanded" : "compact";
            (0, overlay_1.setOverlayMode)(overlayWindow, overlayMode);
            emitOverlayMode();
        },
        onLogOutcome: (payload) => {
            eventLogger.logOutcome(activeSessionId, payload);
        },
        onLogCopyAction: (payload) => {
            eventLogger.logCopyAction(activeSessionId, payload);
        },
        onGetSettings: () => {
            return privacySettings;
        },
        onUpdateSettings: (payload) => {
            const normalized = normalizeSettings(payload);
            const previousModel = privacySettings.stt_model;
            privacySettings = db.setPrivacySettings(normalized);
            debugSttEnabled =
                process.env.DEBUG_STT === "1" ||
                    process.env.DEBUG_STT === "true" ||
                    featureFlags.environment === "development" ||
                    (allowDebugPanels && privacySettings.debug_logging);
            (0, runner_1.setWhisperDebugLogging)(debugSttEnabled);
            if (overlayWindow && !overlayWindow.isDestroyed()) {
                overlayWindow.setOpacity(Math.min(1, Math.max(0.4, privacySettings.overlay_opacity)));
            }
            if (privacySettings.stt_model !== previousModel) {
                void whisper_manager_1.whisperManager.ensureReady(privacySettings.stt_model).then(() => {
                    const status = whisper_manager_1.whisperManager.getStatus();
                    const activeModel = whisper_manager_1.whisperManager.getActiveModel();
                    if (activeModel !== privacySettings.stt_model) {
                        privacySettings = db.setPrivacySettings(normalizeSettings({ ...privacySettings, stt_model: activeModel }));
                    }
                    if (status === "ready") {
                        emitToWindows("engine_status", {
                            state: coachingEnabled ? "running" : "stopped",
                            detail: whisper_manager_1.whisperManager.getModelWarning() ??
                                `Whisper model set to ${activeModel}.`
                        });
                    }
                });
            }
            return privacySettings;
        },
        onGetStats: () => {
            if (!featureFlags.operator_dashboard_enabled) {
                throw new Error("Dashboard is disabled by feature flag.");
            }
            return eventLogger.getLast7DayStats();
        },
        onRunManualTest: (payload) => {
            const text = payload.text.trim();
            if (!text)
                return;
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
            electron_1.app.relaunch();
            electron_1.app.exit(0);
        },
        onAudioChunk: (payload) => {
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
                status: whisper_manager_1.whisperManager.getStatus(),
                binaryPath: whisper_manager_1.whisperManager.getBinaryPath(),
                modelPath: whisper_manager_1.whisperManager.getModelPath(),
                activeModel: whisper_manager_1.whisperManager.getActiveModel(),
                warning: whisper_manager_1.whisperManager.getModelWarning()
            };
        },
        onWhisperInstall: async () => {
            await whisper_manager_1.whisperManager.install();
        },
        onWhisperRetry: async () => {
            await whisper_manager_1.whisperManager.install();
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
    whisper_manager_1.whisperManager.onStatusChange((event) => {
        emitToWindows("whisper_status", event);
        eventLogger.logWhisperStatus(activeSessionId, event);
    });
    // Don't block startup - let Whisper setup happen in background
    void whisper_manager_1.whisperManager.ensureReady(privacySettings.stt_model);
    if (privacySettings.auto_start_on_launch) {
        coachingEnabled = true;
        void startRunner(false);
        updateTrayMenu();
    }
}
electron_1.app.whenReady().then(bootstrap);
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin")
        electron_1.app.quit();
});
electron_1.app.on("activate", () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
        const rendererUrl = resolveRendererUrl();
        overlayWindow = (0, overlay_1.createOverlayWindow)(rendererUrl, getOverlayWindowOptionsFromSettings());
        attachOverlayMovePersistence(overlayWindow);
        emitOverlayMode();
    }
});
electron_1.app.on("before-quit", () => {
    electron_1.globalShortcut.unregisterAll();
    stopRunner("Application exiting");
    db.close();
});
