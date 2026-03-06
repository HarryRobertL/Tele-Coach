"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const ipc_1 = require("./ipc");
const sqlite_1 = require("./sqlite");
const settings_1 = require("./windows/settings");
const overlay_1 = require("./windows/overlay");
const runner_1 = require("../../engine/stt/whisper/runner");
const rules_1 = require("../../engine/classifier/rules");
const selector_1 = require("../../engine/response_engine/selector");
const redaction_1 = require("../../engine/privacy/redaction");
const projectRoot = process.cwd();
let overlayWindow = null;
let settingsWindow = null;
let tray = null;
let overlayMode = "compact";
let coachingEnabled = false;
let audioChunkCounter = 0;
const sttRunner = new runner_1.WhisperRunner();
let transcriptBuffer = "";
let lastObjectionSignature = "";
let lastObjectionId = "unknown";
const db = (0, sqlite_1.bootstrapDatabase)();
let privacySettings = db.getPrivacySettings();
let activeSessionId = null;
function resolveRendererUrl() {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    if (devServerUrl)
        return devServerUrl;
    const indexPath = node_path_1.default.resolve(projectRoot, "app/renderer/dist/index.html");
    return `file://${indexPath}`;
}
function getOverlayWindowOptionsFromSettings() {
    const pos = db.getOverlayPosition();
    return {
        x: pos.x ?? undefined,
        y: pos.y ?? undefined,
        opacity: Math.min(1, Math.max(0.4, privacySettings.overlay_opacity))
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
    tray.setToolTip("Tele Coach MVP");
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
    electron_1.globalShortcut.register("CommandOrControl+1", () => {
        emitToWindows("shortcut_copy_suggestion", { slot: 1 });
    });
    electron_1.globalShortcut.register("CommandOrControl+2", () => {
        emitToWindows("shortcut_copy_suggestion", { slot: 2 });
    });
    electron_1.globalShortcut.register("CommandOrControl+3", () => {
        emitToWindows("shortcut_copy_suggestion", { slot: 3 });
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
    });
    sttRunner.on("partial", (payload) => {
        emitToWindows("stt_partial", payload);
        handleObjectionClassification(payload.text);
    });
    sttRunner.on("final", (payload) => {
        emitToWindows("stt_final", payload);
        handleObjectionClassification(payload.text);
        maybeStoreTranscript(payload.text);
    });
}
function updateTranscriptBuffer(nextText) {
    const combined = `${transcriptBuffer} ${nextText}`.trim();
    transcriptBuffer = combined.slice(-500);
}
function signatureForObjection(payload) {
    return `${payload.objection_id}|${payload.confidence.toFixed(3)}|${payload.matched_phrases.join(",")}`;
}
function handleObjectionClassification(latestText) {
    updateTranscriptBuffer(latestText);
    const result = (0, rules_1.classify)(transcriptBuffer);
    const signature = signatureForObjection(result);
    lastObjectionId = result.objection_id;
    if (signature !== lastObjectionSignature) {
        lastObjectionSignature = signature;
        if (privacySettings.store_events) {
            if (activeSessionId) {
                db.logObjectionEvent(activeSessionId, {
                    objection_id: result.objection_id,
                    confidence: result.confidence,
                    matched_phrases: result.matched_phrases
                });
            }
        }
    }
    // New response engine: emit coaching pack for renderer
    const pack = (0, selector_1.selectCoachingPack)(transcriptBuffer);
    emitToWindows("coaching_pack", pack);
}
function maybeStoreTranscript(text) {
    if (!privacySettings.store_transcript)
        return;
    const redacted = privacySettings.redaction_enabled ? (0, redaction_1.redactSensitiveText)(text) : text;
    db.logTranscript({ text, redacted_text: redacted });
}
function startRunner(fallbackMode = false) {
    transcriptBuffer = "";
    lastObjectionSignature = "";
    lastObjectionId = "unknown";
    activeSessionId = db.startSession();
    (0, rules_1.resetClassificationState)();
    sttRunner.start({
        binaryPath: node_path_1.default.resolve(projectRoot, "engine/stt/whisper/bin/whisper"),
        modelPath: node_path_1.default.resolve(projectRoot, "engine/stt/whisper/models/ggml_tiny_en.bin"),
        fallbackMode
    });
    emitOverlayMode();
}
function stopRunner(reason) {
    sttRunner.stop();
    if (activeSessionId) {
        db.endSession(activeSessionId);
        activeSessionId = null;
    }
    transcriptBuffer = "";
    lastObjectionSignature = "";
    lastObjectionId = "unknown";
    (0, rules_1.resetClassificationState)();
    emitToWindows("engine_status", { state: "stopped", detail: reason });
    emitOverlayMode();
}
async function bootstrap() {
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
            startRunner(false);
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
            if (!activeSessionId)
                return;
            db.logOutcome(activeSessionId, payload);
        },
        onGetSettings: () => {
            return privacySettings;
        },
        onUpdateSettings: (payload) => {
            privacySettings = db.setPrivacySettings(payload);
            if (overlayWindow && !overlayWindow.isDestroyed()) {
                overlayWindow.setOpacity(Math.min(1, Math.max(0.4, privacySettings.overlay_opacity)));
            }
            return privacySettings;
        },
        onLogSuggestionClick: (payload) => {
            if (!privacySettings.store_events)
                return;
            if (!activeSessionId)
                return;
            db.logSuggestionClick(activeSessionId, {
                slot: payload.slot,
                suggestion_text: payload.suggestion_text,
                objection_id: payload.objection_id
            });
        },
        onGetStats: () => {
            return db.getLast7DayStats();
        },
        onRunManualTest: (payload) => {
            const text = payload.text.trim();
            if (!text)
                return;
            emitToWindows("stt_final", { text, tsMs: Date.now() });
            handleObjectionClassification(text);
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
        }
    });
    emitToWindows("engine_status", {
        state: "stopped",
        detail: `DB ready at ${db.dbPath}. Start coaching to load model.`
    });
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
