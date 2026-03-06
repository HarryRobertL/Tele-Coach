import { contextBridge, ipcRenderer } from "electron";
import type { Last7DayStats, OutcomePayload, PrivacySettings } from "./sqlite";
import type { AudioChunkPayload, MainEventChannel, RendererInvokeChannel, RendererSendChannel } from "./ipc";

type EngineState = "loading_model" | "running" | "stopped" | "error";

export interface MainEventPayloadMap {
  stt_partial: { text: string; tsMs: number };
  stt_final: { text: string; tsMs: number };
  coaching_pack: {
    objection: { id: string; confidence: number; matched: string[] };
    severity: "soft" | "medium" | "hard";
    response: string;
    question: string;
    bridge: string;
    momentum: { level: "low" | "medium" | "high"; score: number; reason: string[] };
  };
  engine_status: { state: EngineState; detail?: string };
  overlay_mode: { mode: "compact" | "expanded" };
  shortcut_copy_suggestion: { slot: 1 | 2 | 3 };
}

const allowedInvokeChannels = new Set<RendererInvokeChannel>([
  "start_coaching",
  "stop_coaching",
  "toggle_overlay_mode",
  "log_outcome",
  "get_settings",
  "update_settings",
  "log_suggestion_click",
  "delete_data",
  "get_stats",
  "run_manual_test"
]);

const allowedSendChannels = new Set<RendererSendChannel>(["audio_chunk"]);

const allowedOnChannels = new Set<MainEventChannel>([
  "stt_partial",
  "stt_final",
  "coaching_pack",
  "engine_status",
  "overlay_mode",
  "shortcut_copy_suggestion"
]);

const api = {
  invoke(channel: RendererInvokeChannel, payload?: OutcomePayload): Promise<unknown> {
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
  getSettings(): Promise<PrivacySettings> {
    return ipcRenderer.invoke("get_settings");
  },
  updateSettings(payload: PrivacySettings): Promise<PrivacySettings> {
    return ipcRenderer.invoke("update_settings", payload);
  },
  logSuggestionClick(payload: {
    slot: number;
    suggestion_text: string;
    objection_id: string;
  }): Promise<unknown> {
    return ipcRenderer.invoke("log_suggestion_click", payload);
  },
  deleteData(): Promise<unknown> {
    return ipcRenderer.invoke("delete_data");
  },
  getStats(): Promise<Last7DayStats> {
    return ipcRenderer.invoke("get_stats");
  },
  runManualTest(payload: { text: string }): Promise<unknown> {
    return ipcRenderer.invoke("run_manual_test", payload);
  },
  sendAudioChunk(payload: AudioChunkPayload): void {
    ipcRenderer.send("audio_chunk", payload);
  }
};

contextBridge.exposeInMainWorld("api", api);

export type PreloadApi = typeof api;
