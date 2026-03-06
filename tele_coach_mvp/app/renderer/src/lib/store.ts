export interface AppSettings {
  micDeviceId: string | null;
  whisperModelPath: string;
}

export const defaultSettings: AppSettings = {
  micDeviceId: null,
  whisperModelPath: "engine/stt/whisper/models/ggml_tiny_en.bin"
};

export function loadSettings(): AppSettings {
  // TODO: Replace with IPC-backed read from local SQLite/config.
  return defaultSettings;
}
