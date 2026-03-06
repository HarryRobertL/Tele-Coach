interface OutcomePayload {
  outcome: "worked" | "neutral" | "did_not_work";
}

interface PrivacySettings {
  store_transcript: boolean;
  store_events: boolean;
  redaction_enabled: boolean;
  overlay_opacity: number;
}

interface Last7DayStats {
  sessions_count: number;
  top_objections: Array<{ objection_id: string; count: number }>;
  outcomes_distribution: Array<{ outcome: "worked" | "neutral" | "did_not_work"; count: number }>;
}

interface AudioChunkPayload {
  pcm16: Uint8Array;
  sampleRate: 16000;
  channels: 1;
  frameMs: 200;
  rms: number;
}

type MainEventChannel =
  | "stt_partial"
  | "stt_final"
  | "coaching_pack"
  | "engine_status"
  | "overlay_mode"
  | "shortcut_copy_suggestion";

interface MainEventPayloadMap {
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
  engine_status: { state: "loading_model" | "running" | "stopped" | "error"; detail?: string };
  overlay_mode: { mode: "compact" | "expanded" };
  shortcut_copy_suggestion: { slot: 1 | 2 | 3 };
}

interface WindowApi {
  invoke(
    channel:
      | "start_coaching"
      | "stop_coaching"
      | "toggle_overlay_mode"
      | "log_outcome"
      | "get_settings"
      | "update_settings"
      | "log_suggestion_click"
      | "delete_data"
      | "get_stats"
      | "run_manual_test",
    payload?:
      | OutcomePayload
      | PrivacySettings
      | { slot: number; suggestion_text: string; objection_id: string }
      | { text: string }
  ): Promise<unknown>;
  send(channel: "audio_chunk", payload: AudioChunkPayload): void;
  on<TChannel extends MainEventChannel>(
    channel: TChannel,
    listener: (payload: MainEventPayloadMap[TChannel]) => void
  ): () => void;
  startCoaching(): Promise<unknown>;
  stopCoaching(): Promise<unknown>;
  toggleOverlayMode(): Promise<unknown>;
  logOutcome(payload: OutcomePayload): Promise<unknown>;
  getSettings(): Promise<PrivacySettings>;
  updateSettings(payload: PrivacySettings): Promise<PrivacySettings>;
  logSuggestionClick(payload: {
    slot: number;
    suggestion_text: string;
    objection_id: string;
  }): Promise<unknown>;
  deleteData(): Promise<unknown>;
  getStats(): Promise<Last7DayStats>;
  runManualTest(payload: { text: string }): Promise<unknown>;
  sendAudioChunk(payload: AudioChunkPayload): void;
}

interface Window {
  api: WindowApi;
}
