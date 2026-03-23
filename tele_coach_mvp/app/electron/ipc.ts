import { ipcMain } from "electron";
import type { Last7DayStats, OutcomePayload, PrivacySettings } from "./sqlite";

export type RendererInvokeChannel =
  | "start_coaching"
  | "stop_coaching"
  | "toggle_overlay_mode"
  | "log_outcome"
  | "log_copy_action"
  | "get_settings"
  | "update_settings"
  | "delete_data"
  | "get_stats"
  | "run_manual_test"
  | "whisper_status"
  | "whisper_install"
  | "whisper_retry"
  | "run_whisper_test"
  | "get_feature_flags";

export type RendererSendChannel = "audio_chunk";

export interface AudioChunkPayload {
  pcm16: Uint8Array;
  sampleRate: 16000;
  channels: 1;
  frameMs: 200;
  rms: number;
}

export type MainEventChannel =
  | "stt_partial"
  | "stt_final"
  | "coaching_pack"
  | "engine_status"
  | "overlay_mode"
  | "whisper_status";

export interface RegisterIpcHandlersOptions {
  onStartCoaching: () => Promise<void> | void;
  onStopCoaching: () => Promise<void> | void;
  onToggleOverlayMode: () => Promise<void> | void;
  onLogOutcome: (payload: OutcomePayload) => Promise<void> | void;
  onLogCopyAction: (
    payload: { type: "response" | "question" | "bridge"; text_length: number }
  ) => Promise<void> | void;
  onAudioChunk: (payload: AudioChunkPayload) => Promise<void> | void;
  onGetSettings: () => Promise<PrivacySettings> | PrivacySettings;
  onUpdateSettings: (payload: PrivacySettings) => Promise<PrivacySettings> | PrivacySettings;
  onDeleteData: () => Promise<void> | void;
  onGetStats: () => Promise<Last7DayStats> | Last7DayStats;
  onRunManualTest: (payload: { text: string }) => Promise<void> | void;
  onWhisperStatus: () => Promise<any> | any;
  onWhisperInstall: () => Promise<void> | void;
  onWhisperRetry: () => Promise<void> | void;
  onRunWhisperTest: () => Promise<any> | any;
  onGetFeatureFlags: () => Promise<any> | any;
}

export function registerIpcHandlers(options: RegisterIpcHandlersOptions): void {
  ipcMain.handle("start_coaching", async () => {
    await options.onStartCoaching();
    return { ok: true };
  });

  ipcMain.handle("stop_coaching", async () => {
    await options.onStopCoaching();
    return { ok: true };
  });

  ipcMain.handle("toggle_overlay_mode", async () => {
    await options.onToggleOverlayMode();
    return { ok: true };
  });

  ipcMain.handle("log_outcome", async (_event, payload: OutcomePayload) => {
    await options.onLogOutcome(payload);
    return { ok: true };
  });

  ipcMain.handle(
    "log_copy_action",
    async (
      _event,
      payload: { type: "response" | "question" | "bridge"; text_length: number }
    ) => {
      await options.onLogCopyAction(payload);
      return { ok: true };
    }
  );

  ipcMain.handle("get_settings", async () => {
    return options.onGetSettings();
  });

  ipcMain.handle("update_settings", async (_event, payload: PrivacySettings) => {
    return options.onUpdateSettings(payload);
  });

  ipcMain.handle("delete_data", async () => {
    await options.onDeleteData();
    return { ok: true };
  });

  ipcMain.handle("get_stats", async () => {
    return options.onGetStats();
  });

  ipcMain.handle("run_manual_test", async (_event, payload: { text: string }) => {
    await options.onRunManualTest(payload);
    return { ok: true };
  });

  ipcMain.handle("whisper_status", async () => {
    return options.onWhisperStatus();
  });

  ipcMain.handle("whisper_install", async () => {
    await options.onWhisperInstall();
    return { ok: true };
  });

  ipcMain.handle("whisper_retry", async () => {
    await options.onWhisperRetry();
    return { ok: true };
  });

  ipcMain.handle("run_whisper_test", async () => {
    return options.onRunWhisperTest();
  });

  ipcMain.handle("get_feature_flags", async () => {
    return options.onGetFeatureFlags();
  });

  ipcMain.on("audio_chunk", (_event, payload: AudioChunkPayload) => {
    void options.onAudioChunk(payload);
  });
}
