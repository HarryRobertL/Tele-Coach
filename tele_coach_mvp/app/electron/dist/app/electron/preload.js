"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const allowedInvokeChannels = new Set([
    "start_coaching",
    "stop_coaching",
    "toggle_overlay_mode",
    "log_outcome",
    "log_copy_action",
    "get_settings",
    "update_settings",
    "delete_data",
    "get_stats",
    "run_manual_test",
    "whisper_status",
    "whisper_install",
    "whisper_retry",
    "run_whisper_test",
    "get_feature_flags"
]);
const allowedSendChannels = new Set(["audio_chunk"]);
const allowedOnChannels = new Set([
    "stt_partial",
    "stt_final",
    "coaching_pack",
    "engine_status",
    "overlay_mode",
    "whisper_status"
]);
const api = {
    invoke(channel, payload) {
        if (!allowedInvokeChannels.has(channel)) {
            throw new Error(`Blocked invoke channel: ${channel}`);
        }
        return electron_1.ipcRenderer.invoke(channel, payload);
    },
    send(channel, payload) {
        if (!allowedSendChannels.has(channel)) {
            throw new Error(`Blocked send channel: ${channel}`);
        }
        electron_1.ipcRenderer.send(channel, payload);
    },
    on(channel, listener) {
        if (!allowedOnChannels.has(channel)) {
            throw new Error(`Blocked event channel: ${channel}`);
        }
        const wrapped = (_event, payload) => {
            listener(payload);
        };
        electron_1.ipcRenderer.on(channel, wrapped);
        return () => {
            electron_1.ipcRenderer.removeListener(channel, wrapped);
        };
    },
    startCoaching() {
        return electron_1.ipcRenderer.invoke("start_coaching");
    },
    stopCoaching() {
        return electron_1.ipcRenderer.invoke("stop_coaching");
    },
    toggleOverlayMode() {
        return electron_1.ipcRenderer.invoke("toggle_overlay_mode");
    },
    logOutcome(payload) {
        return electron_1.ipcRenderer.invoke("log_outcome", payload);
    },
    logCopyAction(payload) {
        return electron_1.ipcRenderer.invoke("log_copy_action", payload);
    },
    getSettings() {
        return electron_1.ipcRenderer.invoke("get_settings");
    },
    updateSettings(payload) {
        return electron_1.ipcRenderer.invoke("update_settings", payload);
    },
    deleteData() {
        return electron_1.ipcRenderer.invoke("delete_data");
    },
    getStats() {
        return electron_1.ipcRenderer.invoke("get_stats");
    },
    getFeatureFlags() {
        return electron_1.ipcRenderer.invoke("get_feature_flags");
    },
    runManualTest(payload) {
        return electron_1.ipcRenderer.invoke("run_manual_test", payload);
    },
    sendAudioChunk(payload) {
        electron_1.ipcRenderer.send("audio_chunk", payload);
    },
    whisperStatus() {
        return electron_1.ipcRenderer.invoke("whisper_status");
    },
    whisperInstall() {
        return electron_1.ipcRenderer.invoke("whisper_install");
    },
    whisperRetry() {
        return electron_1.ipcRenderer.invoke("whisper_retry");
    },
    runWhisperTest() {
        return electron_1.ipcRenderer.invoke("run_whisper_test");
    }
};
electron_1.contextBridge.exposeInMainWorld("api", api);
