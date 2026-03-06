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
    electron_1.ipcMain.handle("get_settings", async () => {
        return options.onGetSettings();
    });
    electron_1.ipcMain.handle("update_settings", async (_event, payload) => {
        return options.onUpdateSettings(payload);
    });
    electron_1.ipcMain.handle("log_suggestion_click", async (_event, payload) => {
        await options.onLogSuggestionClick(payload);
        return { ok: true };
    });
    electron_1.ipcMain.handle("delete_data", async () => {
        await options.onDeleteData();
        return { ok: true };
    });
    electron_1.ipcMain.handle("get_stats", async () => {
        return options.onGetStats();
    });
    electron_1.ipcMain.handle("run_manual_test", async (_event, payload) => {
        await options.onRunManualTest(payload);
        return { ok: true };
    });
    electron_1.ipcMain.on("audio_chunk", (_event, payload) => {
        void options.onAudioChunk(payload);
    });
}
