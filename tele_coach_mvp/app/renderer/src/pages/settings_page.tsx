import { useEffect, useState } from "react";
import { HotkeyHelp } from "../components/hotkey_help";

interface RuntimeFlags {
  environment: "development" | "pilot" | "production";
  operator_dashboard_enabled: boolean;
  local_debug_panels_enabled: boolean;
}

export function SettingsPage(): JSX.Element {
  const [settings, setSettings] = useState({
    store_transcript: false,
    store_events: true,
    redaction_enabled: true,
    overlay_opacity: 0.95,
    stt_model: "tiny.en" as "tiny.en" | "base.en" | "small.en",
    auto_start_on_launch: false,
    debug_logging: false,
    transcript_max_chars: 500,
    coaching_refresh_throttle_ms: 700
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testTranscriptBox, setTestTranscriptBox] = useState("");
  const [testStatus, setTestStatus] = useState("");
  const [sttStatusNote, setSttStatusNote] = useState("");
  const [whisperTestResult, setWhisperTestResult] = useState("");
  const [runtimeFlags, setRuntimeFlags] = useState<RuntimeFlags>({
    environment: "production",
    operator_dashboard_enabled: false,
    local_debug_panels_enabled: false
  });
  const [stats, setStats] = useState<Last7DayStats>({
    sessions_count: 0,
    top_objections: [],
    outcomes_distribution: []
  });

  useEffect(() => {
    let mounted = true;
    void window.api.getSettings().then((loaded) => {
      if (!mounted) return;
      setSettings(loaded);
      setLoading(false);
    });
    void window.api.getFeatureFlags().then((flags) => {
      if (!mounted) return;
      const next = flags as Partial<RuntimeFlags>;
      setRuntimeFlags({
        environment:
          next.environment === "development" ||
          next.environment === "pilot" ||
          next.environment === "production"
            ? next.environment
            : "production",
        operator_dashboard_enabled: next.operator_dashboard_enabled ?? false,
        local_debug_panels_enabled: next.local_debug_panels_enabled ?? false
      });
    });
    void window.api.getStats().then((loadedStats) => {
      if (!mounted) return;
      setStats(loadedStats);
    }).catch(() => {
      // Dashboard can be disabled by feature flags.
    });
    return () => {
      mounted = false;
    };
  }, []);

  async function updateSetting(
    key: keyof typeof settings,
    value: boolean | number | "tiny.en" | "base.en" | "small.en"
  ): Promise<void> {
    const next = { ...settings, [key]: value };
    setSettings(next);
    setSaving(true);
    try {
      const persisted = await window.api.updateSettings(next);
      setSettings(persisted);
      if (key === "stt_model") {
        const status = await window.api.whisperStatus();
        const warning = (status as { warning?: string }).warning;
        if (persisted.stt_model !== value) {
          setSttStatusNote(
            warning ??
              `Selected model unavailable. Reverted to ${persisted.stt_model}.`
          );
        } else if (warning) {
          setSttStatusNote(warning);
        } else {
          setSttStatusNote(`Model set to ${persisted.stt_model}.`);
        }
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteData(): Promise<void> {
    // App relaunch is triggered by main process after deletion.
    await window.api.deleteData();
  }

  async function refreshStats(): Promise<void> {
    if (!runtimeFlags.operator_dashboard_enabled) return;
    const next = await window.api.getStats();
    setStats(next);
  }

  async function runManualTest(): Promise<void> {
    const text = testTranscriptBox.trim();
    if (!text) {
      setTestStatus("Enter transcript text first.");
      return;
    }
    await window.api.runManualTest({ text });
    setTestStatus("Manual test pushed to overlay.");
  }

  async function runWhisperTest(): Promise<void> {
    const result = await window.api.runWhisperTest();
    if (result.transcript_ok) {
      setWhisperTestResult(
        `Whisper test passed. Preview: ${result.sample_output_preview || "(empty)"}`
      );
      return;
    }
    setWhisperTestResult(
      `Whisper test failed. ${result.error ?? "Unknown runtime error."}`
    );
  }

  if (loading) {
    return (
      <main className="panel">
        <h1>Settings</h1>
        <p>Loading local privacy settings...</p>
      </main>
    );
  }

  const showDebugPanels =
    runtimeFlags.local_debug_panels_enabled && runtimeFlags.environment === "development";

  return (
    <main className="panel">
      <h1>Settings</h1>
      <p>Local-only configuration for Tele Coach.</p>
      <p>{saving ? "Saving..." : "Settings saved locally."}</p>
      <section>
        <h2>Privacy</h2>
        <label>
          <input
            type="checkbox"
            checked={settings.store_transcript}
            onChange={(event) => {
              void updateSetting("store_transcript", event.target.checked);
            }}
          />
          Store transcript locally
        </label>
        <br />
        <label>
          <input
            type="checkbox"
            checked={settings.store_events}
            onChange={(event) => {
              void updateSetting("store_events", event.target.checked);
            }}
          />
          Store events locally (objection + suggestion clicks)
        </label>
        <br />
        <label>
          <input
            type="checkbox"
            checked={settings.redaction_enabled}
            onChange={(event) => {
              void updateSetting("redaction_enabled", event.target.checked);
            }}
          />
          Redaction enabled before transcript storage
        </label>
        <p />
        <label>
          Overlay opacity: {settings.overlay_opacity.toFixed(2)}
          <br />
          <input
            type="range"
            min={0.4}
            max={1}
            step={0.05}
            value={settings.overlay_opacity}
            onChange={(event) => {
              const nextValue = Number(event.target.value);
              void updateSetting("overlay_opacity", nextValue);
            }}
          />
        </label>
      </section>
      <section>
        <h2>Speech Engine (STT)</h2>
        <label>
          Whisper model
          <br />
          <select
            value={settings.stt_model}
            onChange={(event) => {
              void updateSetting(
                "stt_model",
                event.target.value as "tiny.en" | "base.en" | "small.en"
              );
            }}
          >
            <option value="tiny.en">tiny.en (default, fastest)</option>
            <option value="base.en">base.en</option>
            <option value="small.en">small.en</option>
          </select>
        </label>
        <p>Model files are expected under `engine/stt/whisper/models/`.</p>
        {sttStatusNote ? <p>{sttStatusNote}</p> : null}
        <label>
          <input
            type="checkbox"
            checked={settings.auto_start_on_launch}
            onChange={(event) => {
              void updateSetting("auto_start_on_launch", event.target.checked);
            }}
          />
          Auto-start coaching on launch
        </label>
        <br />
        <label>
          <input
            type="checkbox"
            checked={settings.debug_logging}
            disabled={!showDebugPanels}
            onChange={(event) => {
              void updateSetting("debug_logging", event.target.checked);
            }}
          />
          Enable STT debug logging
        </label>
        {!showDebugPanels ? <p>Debug controls are hidden outside development mode.</p> : null}
        <p />
        <label>
          Transcript max chars: {settings.transcript_max_chars}
          <br />
          <input
            type="number"
            min={200}
            max={3000}
            step={50}
            value={settings.transcript_max_chars}
            onChange={(event) => {
              void updateSetting("transcript_max_chars", Number(event.target.value));
            }}
          />
        </label>
        <p />
        <label>
          Coaching refresh throttle (ms): {settings.coaching_refresh_throttle_ms}
          <br />
          <input
            type="number"
            min={250}
            max={5000}
            step={50}
            value={settings.coaching_refresh_throttle_ms}
            onChange={(event) => {
              void updateSetting("coaching_refresh_throttle_ms", Number(event.target.value));
            }}
          />
        </label>
      </section>
      <section>
        <h2>Delete Local Data</h2>
        <p>Deletes local SQLite data and restarts the app.</p>
        <button type="button" onClick={() => void handleDeleteData()}>
          Delete Data
        </button>
      </section>
      <section>
        <h2>Last 7 Days</h2>
        {!runtimeFlags.operator_dashboard_enabled ? (
          <p>Operator dashboard is disabled in this environment.</p>
        ) : null}
        <button type="button" onClick={() => void refreshStats()}>
          Refresh Stats
        </button>
        <p>
          Global shortcuts: `Cmd/Ctrl+Shift+L` (toggle coaching), `Cmd/Ctrl+Shift+O` (overlay
          visibility), `Cmd/Ctrl+1/2/3` (copy suggestion slot).
        </p>
        <p><strong>Sessions:</strong> {stats.sessions_count}</p>
        <p><strong>Top objections:</strong></p>
        <ul>
          {stats.top_objections.length === 0 ? (
            <li>No objection events yet.</li>
          ) : (
            stats.top_objections.map((row) => (
              <li key={row.objection_id}>
                {row.objection_id}: {row.count}
              </li>
            ))
          )}
        </ul>
        <p><strong>Outcomes distribution:</strong></p>
        <ul>
          {stats.outcomes_distribution.length === 0 ? (
            <li>No outcomes yet.</li>
          ) : (
            stats.outcomes_distribution.map((row) => (
              <li key={row.outcome}>
                {row.outcome}: {row.count}
              </li>
            ))
          )}
        </ul>
      </section>
      {showDebugPanels ? (
        <section>
          <h2>Manual Transcript Test</h2>
          <p>Use this to test classifier + playbook without whisper/STT.</p>
          <textarea
            value={testTranscriptBox}
            onChange={(event) => {
              setTestTranscriptBox(event.target.value);
            }}
            rows={5}
            style={{ width: "100%" }}
            placeholder="Type transcript text here..."
          />
          <p />
          <button type="button" onClick={() => void runManualTest()}>
            Run Test
          </button>
          {testStatus ? <p>{testStatus}</p> : null}
          <p />
          <button type="button" onClick={() => void runWhisperTest()}>
            Run Whisper Test
          </button>
          {whisperTestResult ? <p>{whisperTestResult}</p> : null}
        </section>
      ) : null}
      <HotkeyHelp />
    </main>
  );
}
