"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerIpcHandlers = registerIpcHandlers;
const electron_1 = require("electron");
function registerIpcHandlers(options) {
    electron_1.ipcMain.handle("start_coaching", async () => {
        await options.onStartCoaching();
        return { ok: true };
    });
    electron_1.ipcMain.handle("stop_coaching", async () => {
        await options.onStopCoaching();
        return { ok: true };
    });
    electron_1.ipcMain.handle("toggle_overlay_mode", async () => {
        await options.onToggleOverlayMode();
        return { ok: true };
    });
    electron_1.ipcMain.handle("log_outcome", async (_event, payload) => {
        await options.onLogOutcome(payload);
        return { ok: true };
    });
    electron_1.ipcMain.on("audio_chunk", (_event, payload) => {
        void options.onAudioChunk(payload);
    });
}
