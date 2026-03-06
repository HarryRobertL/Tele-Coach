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
let overlayWindow = null;
let settingsWindow = null;
let tray = null;
let overlayMode = "compact";
let coachingEnabled = false;
let coachingTicker = null;
let audioChunkCounter = 0;
let lastAudioRms = 0;
const db = (0, sqlite_1.bootstrapDatabase)();
function resolveRendererUrl() {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    if (devServerUrl)
        return devServerUrl;
    const indexPath = node_path_1.default.resolve(__dirname, "../../renderer/dist/index.html");
    return `file://${indexPath}`;
}
function emitToWindows(channel, payload) {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send(channel, payload);
    }
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.webContents.send(channel, payload);
    }
}
function startCoachingSimulation() {
    if (coachingTicker)
        return;
    let counter = 0;
    coachingTicker = setInterval(() => {
        counter += 1;
        emitToWindows("stt_partial", {
            text: `Listening... sample phrase ${counter}`,
            tsMs: Date.now()
        });
        if (counter % 3 === 0) {
            emitToWindows("stt_final", {
                text: "Finalized sentence placeholder from local STT.",
                tsMs: Date.now()
            });
            emitToWindows("suggestions_update", {
                suggestions: [
                    "Ask a clarifying question.",
                    "Acknowledge and confirm next step."
                ]
            });
            emitToWindows("objection_update", {
                text: "Price concern detected (placeholder).",
                level: "medium"
            });
        }
    }, 2000);
}
function stopCoachingSimulation() {
    if (!coachingTicker)
        return;
    clearInterval(coachingTicker);
    coachingTicker = null;
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
                    startCoachingSimulation();
                    emitToWindows("engine_status", { state: "running", detail: "Coaching enabled" });
                }
                else {
                    stopCoachingSimulation();
                    emitToWindows("engine_status", { state: "idle", detail: "Coaching paused" });
                }
                updateTrayMenu();
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
async function bootstrap() {
    const rendererUrl = resolveRendererUrl();
    overlayWindow = (0, overlay_1.createOverlayWindow)(rendererUrl);
    settingsWindow = (0, settings_1.createSettingsWindow)(rendererUrl);
    settingsWindow.hide();
    createTray();
    (0, ipc_1.registerIpcHandlers)({
        onStartCoaching: () => {
            coachingEnabled = true;
            startCoachingSimulation();
            emitToWindows("engine_status", { state: "running", detail: "Coaching started" });
            updateTrayMenu();
        },
        onStopCoaching: () => {
            coachingEnabled = false;
            stopCoachingSimulation();
            emitToWindows("engine_status", { state: "idle", detail: "Coaching stopped" });
            updateTrayMenu();
        },
        onToggleOverlayMode: () => {
            if (!overlayWindow || overlayWindow.isDestroyed())
                return;
            overlayMode = overlayMode === "compact" ? "expanded" : "compact";
            (0, overlay_1.setOverlayMode)(overlayWindow, overlayMode);
        },
        onLogOutcome: (payload) => {
            db.logOutcome(payload);
        },
        onAudioChunk: (payload) => {
            // Intentionally process in-memory only; never persist raw audio.
            audioChunkCounter += 1;
            lastAudioRms = payload.rms;
            if (audioChunkCounter % 20 === 0) {
                emitToWindows("engine_status", {
                    state: coachingEnabled ? "running" : "idle",
                    detail: `Audio chunks: ${audioChunkCounter}, last RMS: ${lastAudioRms.toFixed(3)}`
                });
            }
        }
    });
    emitToWindows("engine_status", { state: "idle", detail: `DB ready at ${db.dbPath}` });
}
electron_1.app.whenReady().then(bootstrap);
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin")
        electron_1.app.quit();
});
electron_1.app.on("activate", () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
        const rendererUrl = resolveRendererUrl();
        overlayWindow = (0, overlay_1.createOverlayWindow)(rendererUrl);
    }
});
electron_1.app.on("before-quit", () => {
    stopCoachingSimulation();
    db.close();
});
