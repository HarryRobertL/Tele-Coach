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
    electron_1.ipcMain.handle("log_copy_action", async (_event, payload) => {
        await options.onLogCopyAction(payload);
        return { ok: true };
    });
    electron_1.ipcMain.handle("get_settings", async () => {
        return options.onGetSettings();
    });
    electron_1.ipcMain.handle("update_settings", async (_event, payload) => {
        return options.onUpdateSettings(payload);
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
    electron_1.ipcMain.handle("whisper_status", async () => {
        return options.onWhisperStatus();
    });
    electron_1.ipcMain.handle("whisper_install", async () => {
        await options.onWhisperInstall();
        return { ok: true };
    });
    electron_1.ipcMain.handle("whisper_retry", async () => {
        await options.onWhisperRetry();
        return { ok: true };
    });
    electron_1.ipcMain.handle("run_whisper_test", async () => {
        return options.onRunWhisperTest();
    });
    electron_1.ipcMain.handle("get_feature_flags", async () => {
        return options.onGetFeatureFlags();
    });
    electron_1.ipcMain.on("audio_chunk", (_event, payload) => {
        void options.onAudioChunk(payload);
    });
}
