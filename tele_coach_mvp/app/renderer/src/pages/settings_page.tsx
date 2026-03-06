import { useEffect, useState } from "react";
import { HotkeyHelp } from "../components/hotkey_help";

export function SettingsPage(): JSX.Element {
  const [settings, setSettings] = useState({
    store_transcript: false,
    store_events: true,
    redaction_enabled: true,
    overlay_opacity: 0.95
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testTranscriptBox, setTestTranscriptBox] = useState("");
  const [testStatus, setTestStatus] = useState("");
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
    void window.api.getStats().then((loadedStats) => {
      if (!mounted) return;
      setStats(loadedStats);
    });
    return () => {
      mounted = false;
    };
  }, []);

  async function updateSetting(
    key: keyof typeof settings,
    value: boolean | number
  ): Promise<void> {
    const next = { ...settings, [key]: value };
    setSettings(next);
    setSaving(true);
    try {
      const persisted = await window.api.updateSettings(next);
      setSettings(persisted);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteData(): Promise<void> {
    // App relaunch is triggered by main process after deletion.
    await window.api.deleteData();
  }

  async function refreshStats(): Promise<void> {
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

  if (loading) {
    return (
      <main className="panel">
        <h1>Settings</h1>
        <p>Loading local privacy settings...</p>
      </main>
    );
  }

  return (
    <main className="panel">
      <h1>Settings</h1>
      <p>Local-only configuration for Tele Coach MVP.</p>
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
        <h2>Delete Local Data</h2>
        <p>Deletes local SQLite data and restarts the app.</p>
        <button type="button" onClick={() => void handleDeleteData()}>
          Delete Data
        </button>
      </section>
      <section>
        <h2>Last 7 Days</h2>
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
      </section>
      <HotkeyHelp />
    </main>
  );
}
