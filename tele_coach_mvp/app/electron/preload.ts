import { contextBridge, ipcRenderer } from "electron";
import type { Last7DayStats, OutcomePayload, PrivacySettings } from "./sqlite";
import type { AudioChunkPayload, MainEventChannel, RendererInvokeChannel, RendererSendChannel } from "./ipc";
import type { CoachingPack } from "../../engine/response_engine/types";

type EngineState = "loading_model" | "running" | "stopped" | "error";

export interface MainEventPayloadMap {
  stt_partial: { text: string; tsMs: number };
  stt_final: { text: string; tsMs: number };
  coaching_pack: CoachingPack;
  engine_status: { state: EngineState; detail?: string };
  overlay_mode: { mode: "compact" | "expanded" };
  whisper_status: { status: "checking" | "missing" | "downloading" | "verifying" | "ready" | "error"; progress?: number; step?: string; error?: string };
}

const allowedInvokeChannels = new Set<RendererInvokeChannel>([
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

const allowedSendChannels = new Set<RendererSendChannel>(["audio_chunk"]);

const allowedOnChannels = new Set<MainEventChannel>([
  "stt_partial",
  "stt_final",
  "coaching_pack",
  "engine_status",
  "overlay_mode",
  "whisper_status"
]);

const api = {
  invoke(
    channel: RendererInvokeChannel,
    payload?:
      | OutcomePayload
      | PrivacySettings
      | { text: string }
      | { type: "response" | "question" | "bridge"; text_length: number }
  ): Promise<unknown> {
    if (!allowedInvokeChannels.has(channel)) {
      throw new Error(`Blocked invoke channel: ${channel}`);
    }
    return ipcRenderer.invoke(channel, payload);
  },
  send(channel: RendererSendChannel, payload: AudioChunkPayload): void {
    if (!allowedSendChannels.has(channel)) {
      throw new Error(`Blocked send channel: ${channel}`);
    }
    ipcRenderer.send(channel, payload);
  },
  on<TChannel extends MainEventChannel>(
    channel: TChannel,
    listener: (payload: MainEventPayloadMap[TChannel]) => void
  ): () => void {
    if (!allowedOnChannels.has(channel)) {
      throw new Error(`Blocked event channel: ${channel}`);
    }
    const wrapped = (_event: unknown, payload: MainEventPayloadMap[TChannel]) => {
      listener(payload);
    };
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
  startCoaching(): Promise<unknown> {
    return ipcRenderer.invoke("start_coaching");
  },
  stopCoaching(): Promise<unknown> {
    return ipcRenderer.invoke("stop_coaching");
  },
  toggleOverlayMode(): Promise<unknown> {
    return ipcRenderer.invoke("toggle_overlay_mode");
  },
  logOutcome(payload: OutcomePayload): Promise<unknown> {
    return ipcRenderer.invoke("log_outcome", payload);
  },
  logCopyAction(payload: { type: "response" | "question" | "bridge"; text_length: number }): Promise<unknown> {
    return ipcRenderer.invoke("log_copy_action", payload);
  },
  getSettings(): Promise<PrivacySettings> {
    return ipcRenderer.invoke("get_settings");
  },
  updateSettings(payload: PrivacySettings): Promise<PrivacySettings> {
    return ipcRenderer.invoke("update_settings", payload);
  },
  deleteData(): Promise<unknown> {
    return ipcRenderer.invoke("delete_data");
  },
  getStats(): Promise<Last7DayStats> {
    return ipcRenderer.invoke("get_stats");
  },
  getFeatureFlags(): Promise<any> {
    return ipcRenderer.invoke("get_feature_flags");
  },
  runManualTest(payload: { text: string }): Promise<unknown> {
    return ipcRenderer.invoke("run_manual_test", payload);
  },
  sendAudioChunk(payload: AudioChunkPayload): void {
    ipcRenderer.send("audio_chunk", payload);
  },
  whisperStatus(): Promise<any> {
    return ipcRenderer.invoke("whisper_status");
  },
  whisperInstall(): Promise<void> {
    return ipcRenderer.invoke("whisper_install");
  },
  whisperRetry(): Promise<void> {
    return ipcRenderer.invoke("whisper_retry");
  },
  runWhisperTest(): Promise<unknown> {
    return ipcRenderer.invoke("run_whisper_test");
  }
};

contextBridge.exposeInMainWorld("api", api);

export type PreloadApi = typeof api;
