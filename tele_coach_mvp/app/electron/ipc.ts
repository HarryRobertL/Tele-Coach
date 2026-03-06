import { ipcMain } from "electron";
import type { Last7DayStats, OutcomePayload, PrivacySettings } from "./sqlite";

export type RendererInvokeChannel =
  | "start_coaching"
  | "stop_coaching"
  | "toggle_overlay_mode"
  | "log_outcome"
  | "get_settings"
  | "update_settings"
  | "log_suggestion_click"
  | "delete_data"
  | "get_stats"
  | "run_manual_test";

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
  | "shortcut_copy_suggestion";

export interface RegisterIpcHandlersOptions {
  onStartCoaching: () => Promise<void> | void;
  onStopCoaching: () => Promise<void> | void;
  onToggleOverlayMode: () => Promise<void> | void;
  onLogOutcome: (payload: OutcomePayload) => Promise<void> | void;
  onAudioChunk: (payload: AudioChunkPayload) => Promise<void> | void;
  onGetSettings: () => Promise<PrivacySettings> | PrivacySettings;
  onUpdateSettings: (payload: PrivacySettings) => Promise<PrivacySettings> | PrivacySettings;
  onLogSuggestionClick: (payload: {
    slot: number;
    suggestion_text: string;
    objection_id: string;
  }) => Promise<void> | void;
  onDeleteData: () => Promise<void> | void;
  onGetStats: () => Promise<Last7DayStats> | Last7DayStats;
  onRunManualTest: (payload: { text: string }) => Promise<void> | void;
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

  ipcMain.handle("get_settings", async () => {
    return options.onGetSettings();
  });

  ipcMain.handle("update_settings", async (_event, payload: PrivacySettings) => {
    return options.onUpdateSettings(payload);
  });

  ipcMain.handle(
    "log_suggestion_click",
    async (
      _event,
      payload: { slot: number; suggestion_text: string; objection_id: string }
    ) => {
      await options.onLogSuggestionClick(payload);
      return { ok: true };
    }
  );

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

  ipcMain.on("audio_chunk", (_event, payload: AudioChunkPayload) => {
    void options.onAudioChunk(payload);
  });
}
