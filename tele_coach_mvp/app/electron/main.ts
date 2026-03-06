import { app, BrowserWindow, Menu, Tray, globalShortcut, nativeImage } from "electron";
import path from "node:path";
import { registerIpcHandlers, type MainEventChannel } from "./ipc";
import {
  bootstrapDatabase,
  type Last7DayStats,
  type OutcomePayload,
  type PrivacySettings
} from "./sqlite";
import { createSettingsWindow } from "./windows/settings";
import { createOverlayWindow, setOverlayMode, type OverlayMode } from "./windows/overlay";
import { WhisperRunner, type AudioChunkPayload } from "../../engine/stt/whisper/runner";
import { classify, resetClassificationState } from "../../engine/classifier/rules";
import type { ObjectionClassification } from "../../engine/classifier/types";
import { selectCoachingPack } from "../../engine/response_engine/selector";
import { redactSensitiveText } from "../../engine/privacy/redaction";

const projectRoot = process.cwd();

let overlayWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let overlayMode: OverlayMode = "compact";
let coachingEnabled = false;
let audioChunkCounter = 0;
const sttRunner = new WhisperRunner();
let transcriptBuffer = "";
let lastObjectionSignature = "";
let lastObjectionId = "unknown";

const db = bootstrapDatabase();
let privacySettings: PrivacySettings = db.getPrivacySettings();
let activeSessionId: string | null = null;

function resolveRendererUrl(): string {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) return devServerUrl;
  const indexPath = path.resolve(projectRoot, "app/renderer/dist/index.html");
  return `file://${indexPath}`;
}

function getOverlayWindowOptionsFromSettings(): { x?: number; y?: number; opacity: number } {
  const pos = db.getOverlayPosition();
  return {
    x: pos.x ?? undefined,
    y: pos.y ?? undefined,
    opacity: Math.min(1, Math.max(0.4, privacySettings.overlay_opacity))
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
  tray.setToolTip("Tele Coach MVP");
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

  globalShortcut.register("CommandOrControl+1", () => {
    emitToWindows("shortcut_copy_suggestion", { slot: 1 });
  });
  globalShortcut.register("CommandOrControl+2", () => {
    emitToWindows("shortcut_copy_suggestion", { slot: 2 });
  });
  globalShortcut.register("CommandOrControl+3", () => {
    emitToWindows("shortcut_copy_suggestion", { slot: 3 });
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

function updateTranscriptBuffer(nextText: string): void {
  const combined = `${transcriptBuffer} ${nextText}`.trim();
  transcriptBuffer = combined.slice(-500);
}

function signatureForObjection(payload: ObjectionClassification): string {
  return `${payload.objection_id}|${payload.confidence.toFixed(3)}|${payload.matched_phrases.join(",")}`;
}

function handleObjectionClassification(latestText: string): void {
  updateTranscriptBuffer(latestText);
  const result = classify(transcriptBuffer);
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
  const pack = selectCoachingPack(transcriptBuffer);
  emitToWindows("coaching_pack", pack);
}

function maybeStoreTranscript(text: string): void {
  if (!privacySettings.store_transcript) return;
  const redacted = privacySettings.redaction_enabled ? redactSensitiveText(text) : text;
  db.logTranscript({ text, redacted_text: redacted });
}

function startRunner(fallbackMode = false): void {
  transcriptBuffer = "";
  lastObjectionSignature = "";
  lastObjectionId = "unknown";
  activeSessionId = db.startSession();
  resetClassificationState();
  sttRunner.start({
    binaryPath: path.resolve(projectRoot, "engine/stt/whisper/bin/whisper"),
    modelPath: path.resolve(projectRoot, "engine/stt/whisper/models/ggml_tiny_en.bin"),
    fallbackMode
  });
  emitOverlayMode();
}

function stopRunner(reason: string): void {
  sttRunner.stop();
  if (activeSessionId) {
    db.endSession(activeSessionId);
    activeSessionId = null;
  }
  transcriptBuffer = "";
  lastObjectionSignature = "";
  lastObjectionId = "unknown";
  resetClassificationState();
  emitToWindows("engine_status", { state: "stopped", detail: reason });
  emitOverlayMode();
}

async function bootstrap(): Promise<void> {
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
      startRunner(false);
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
      if (!activeSessionId) return;
      db.logOutcome(activeSessionId, payload);
    },
    onGetSettings: () => {
      return privacySettings;
    },
    onUpdateSettings: (payload: PrivacySettings) => {
      privacySettings = db.setPrivacySettings(payload);
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.setOpacity(Math.min(1, Math.max(0.4, privacySettings.overlay_opacity)));
      }
      return privacySettings;
    },
    onLogSuggestionClick: (payload) => {
      if (!privacySettings.store_events) return;
      if (!activeSessionId) return;
      db.logSuggestionClick(activeSessionId, {
        slot: payload.slot,
        suggestion_text: payload.suggestion_text,
        objection_id: payload.objection_id
      });
    },
    onGetStats: (): Last7DayStats => {
      return db.getLast7DayStats();
    },
    onRunManualTest: (payload: { text: string }) => {
      const text = payload.text.trim();
      if (!text) return;
      emitToWindows("stt_final", { text, tsMs: Date.now() });
      handleObjectionClassification(text);
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
    }
  });

  emitToWindows("engine_status", {
    state: "stopped",
    detail: `DB ready at ${db.dbPath}. Start coaching to load model.`
  });
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
