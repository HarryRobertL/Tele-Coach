interface OutcomePayload {
  outcome: "worked" | "neutral" | "did_not_work";
}

interface PrivacySettings {
  store_transcript: boolean;
  store_events: boolean;
  redaction_enabled: boolean;
  overlay_opacity: number;
  stt_model: "tiny.en" | "base.en" | "small.en";
  auto_start_on_launch: boolean;
  debug_logging: boolean;
  transcript_max_chars: number;
  coaching_refresh_throttle_ms: number;
}

interface Last7DayStats {
  sessions_count: number;
  top_objections: Array<{ objection_id: string; count: number }>;
  outcomes_distribution: Array<{ outcome: "worked" | "neutral" | "did_not_work"; count: number }>;
}

interface FeatureFlags {
  environment: "development" | "pilot" | "production";
  quiet_logging: boolean;
  competitor_detection_enabled: boolean;
  intent_classification_enabled: boolean;
  momentum_engine_v2_enabled: boolean;
  adaptive_weighting_enabled: boolean;
  analytics_logging_enabled: boolean;
  operator_dashboard_enabled: boolean;
  local_debug_panels_enabled: boolean;
  whisper_upstream_fallback_allowed: boolean;
}

interface AudioChunkPayload {
  pcm16: Uint8Array;
  sampleRate: 16000;
  channels: 1;
  frameMs: 200;
  rms: number;
}

interface CoachingPack {
  objection_id: string;
  confidence: number;
  severity: "soft" | "medium" | "hard";
  response: string;
  question: string;
  bridge: string;
  momentum_level: "low" | "medium" | "high";
  momentum_score: number; // 0 to 100
  momentum_reasons: string[];
  competitor_mentions?: string[];
  intent?: "demo_ready" | "curious" | "brush_off" | "callback" | "price_check" | "competitor_locked" | "not_relevant" | "unknown";
  intent_confidence?: number;
  intent_signals?: string[];
  demo_readiness_score?: number; // 0 to 100
  conversation_stage?: "opening" | "rapport" | "discovery" | "objection_handling" | "value_exploration" | "demo_transition" | "next_step_close" | "ended" | "unknown";
  stage_confidence?: number;
  stage_reasons?: string[];
  timestamp: number;
}

type MainEventChannel =
  | "stt_partial"
  | "stt_final"
  | "coaching_pack"
  | "engine_status"
  | "overlay_mode"
  | "whisper_status";

interface MainEventPayloadMap {
  stt_partial: { text: string; tsMs: number };
  stt_final: { text: string; tsMs: number };
  coaching_pack: CoachingPack;
  engine_status: { state: "loading_model" | "running" | "stopped" | "error"; detail?: string };
  overlay_mode: { mode: "compact" | "expanded" };
  whisper_status: { status: "checking" | "missing" | "downloading" | "verifying" | "ready" | "error"; progress?: number; step?: string; error?: string };
}

interface WindowApi {
  invoke(
    channel:
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
      | "get_feature_flags",
    payload?:
      | OutcomePayload
      | PrivacySettings
      | { text: string }
      | { type: "response" | "question" | "bridge"; text_length: number }
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
  logCopyAction(payload: { type: "response" | "question" | "bridge"; text_length: number }): Promise<unknown>;
  getSettings(): Promise<PrivacySettings>;
  updateSettings(payload: PrivacySettings): Promise<PrivacySettings>;
  deleteData(): Promise<unknown>;
  getStats(): Promise<Last7DayStats>;
  getFeatureFlags(): Promise<FeatureFlags>;
  runManualTest(payload: { text: string }): Promise<unknown>;
  sendAudioChunk(payload: AudioChunkPayload): void;
  whisperStatus(): Promise<any>;
  whisperInstall(): Promise<void>;
  whisperRetry(): Promise<void>;
  runWhisperTest(): Promise<{
    binary_ok: boolean;
    model_ok: boolean;
    launch_ok: boolean;
    transcript_ok: boolean;
    sample_output_preview: string;
    error?: string;
  }>;
}

interface Window {
  api: WindowApi;
}
