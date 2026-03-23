import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { app } from "electron";

export interface OutcomePayload {
  outcome: "worked" | "neutral" | "did_not_work";
}

export type SttModelOption = "tiny.en" | "base.en" | "small.en";

export interface AppDatabase {
  dbPath: string;
  getPrivacySettings(): PrivacySettings;
  setPrivacySettings(next: PrivacySettings): PrivacySettings;
  getOverlayPosition(): { x: number | null; y: number | null };
  setOverlayPosition(next: { x: number; y: number }): void;
  startSession(): string;
  endSession(sessionId: string): void;
  logEvent(sessionId: string, type: string, payload: Record<string, unknown>): void;
  logOutcome(sessionId: string, payload: OutcomePayload): void;
  logObjectionEvent(
    sessionId: string,
    payload: { objection_id: string; confidence: number; matched_phrases: string[] }
  ): void;
  logSuggestionClick(
    sessionId: string,
    payload: { slot: number; suggestion_text: string; objection_id: string }
  ): void;
  logTranscript(payload: { text: string; redacted_text: string }): void;
  getLast7DayStats(): Last7DayStats;
  getEventCounts(
    type: string,
    payloadKey: string,
    sinceTs: number,
    limit?: number
  ): DbCountRow[];
  getAverageEventNumericPayload(
    type: string,
    payloadKey: string,
    sinceTs: number
  ): number | null;
  getEventTypeCounts(types: string[], sinceTs: number): DbCountRow[];
  getSessionCountsPerDay(sinceTs: number): DbSessionCountRow[];
  deleteDatabaseFile(): void;
  close(): void;
}

export interface PrivacySettings {
  store_transcript: boolean;
  store_events: boolean;
  redaction_enabled: boolean;
  overlay_opacity: number;
  stt_model: SttModelOption;
  auto_start_on_launch: boolean;
  debug_logging: boolean;
  transcript_max_chars: number;
  coaching_refresh_throttle_ms: number;
}

export interface Last7DayStats {
  sessions_count: number;
  top_objections: Array<{ objection_id: string; count: number }>;
  outcomes_distribution: Array<{ outcome: "worked" | "neutral" | "did_not_work"; count: number }>;
}

export interface DbCountRow {
  key: string;
  count: number;
}

export interface DbSessionCountRow {
  day: string;
  count: number;
}

const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  store_transcript: false,
  store_events: true,
  redaction_enabled: true,
  overlay_opacity: 0.95,
  stt_model: "tiny.en",
  auto_start_on_launch: false,
  debug_logging: false,
  transcript_max_chars: 500,
  coaching_refresh_throttle_ms: 700
};

export function bootstrapDatabase(): AppDatabase {
  const dbPath = app.isPackaged
    ? path.join(app.getPath("userData"), "app.sqlite")
    : path.resolve(process.cwd(), "data", "app.sqlite");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  let db = new Database(dbPath);

  try {
    db.pragma("journal_mode = WAL");
  } catch {
    // If placeholder text exists, recreate a clean sqlite file.
    try {
      db.close();
    } catch {
      // Ignore close failures during recovery.
    }
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL,
      ended_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS suggestion_clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      objection_id TEXT NOT NULL,
      suggestion_text TEXT NOT NULL,
      slot INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      outcome TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transcript_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text_redacted TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_events_type_ts ON events(type, ts);
    CREATE INDEX IF NOT EXISTS idx_events_session_ts ON events(session_id, ts);
    CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);
  `);

  const insertSession = db.prepare(
    "INSERT INTO sessions (id, started_at, ended_at) VALUES (?, ?, NULL)"
  );
  const endSessionStmt = db.prepare(
    "UPDATE sessions SET ended_at = ? WHERE id = ?"
  );
  const insertEvent = db.prepare(
    "INSERT INTO events (session_id, ts, type, payload_json) VALUES (?, ?, ?, ?)"
  );
  const insertSuggestionClick = db.prepare(
    `INSERT INTO suggestion_clicks (session_id, ts, objection_id, suggestion_text, slot)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertOutcome = db.prepare(
    "INSERT INTO outcomes (session_id, ts, outcome) VALUES (?, ?, ?)"
  );
  const insertTranscript = db.prepare(
    "INSERT INTO transcript_events (text_redacted) VALUES (?)"
  );
  const getSetting = db.prepare("SELECT value FROM app_settings WHERE key = ?");
  const upsertSetting = db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `);

  for (const [key, value] of Object.entries(DEFAULT_PRIVACY_SETTINGS)) {
    const existing = getSetting.get(key) as { value: string } | undefined;
    if (!existing) {
      upsertSetting.run(key, JSON.stringify(value));
    }
  }

  let isClosed = false;

  function safeClose(): void {
    if (isClosed) return;
    db.close();
    isClosed = true;
  }

  const statsSessionsStmt = db.prepare(`
    SELECT COUNT(*) AS count
    FROM sessions
    WHERE started_at >= ?
  `);
  const statsTopObjectionsStmt = db.prepare(`
    SELECT
      json_extract(payload_json, '$.objection_id') AS objection_id,
      COUNT(*) AS count
    FROM events
    WHERE type = 'objection_update' AND ts >= ?
    GROUP BY objection_id
    ORDER BY count DESC
    LIMIT 5
  `);
  const statsOutcomesStmt = db.prepare(`
    SELECT outcome, COUNT(*) AS count
    FROM outcomes
    WHERE ts >= ?
    GROUP BY outcome
    ORDER BY count DESC
  `);
  const eventCountsStmt = db.prepare(`
    SELECT
      json_extract(payload_json, '$.' || ?) AS key,
      COUNT(*) AS count
    FROM events
    WHERE type = ? AND ts >= ?
    GROUP BY key
    ORDER BY count DESC
    LIMIT ?
  `);
  const avgEventNumericStmt = db.prepare(`
    SELECT AVG(CAST(json_extract(payload_json, '$.' || ?) AS REAL)) AS avg_value
    FROM events
    WHERE type = ? AND ts >= ? AND json_extract(payload_json, '$.' || ?) IS NOT NULL
  `);
  const eventTypeCountsStmt = db.prepare(`
    SELECT type AS key, COUNT(*) AS count
    FROM events
    WHERE ts >= ? AND type IN (SELECT value FROM json_each(?))
    GROUP BY type
    ORDER BY count DESC
  `);
  const sessionCountsPerDayStmt = db.prepare(`
    SELECT
      strftime('%Y-%m-%d', datetime(started_at / 1000, 'unixepoch', 'localtime')) AS day,
      COUNT(*) AS count
    FROM sessions
    WHERE started_at >= ?
    GROUP BY day
    ORDER BY day DESC
  `);

  return {
    dbPath,
    getPrivacySettings(): PrivacySettings {
      return {
        store_transcript: JSON.parse((getSetting.get("store_transcript") as { value: string }).value),
        store_events: JSON.parse((getSetting.get("store_events") as { value: string }).value),
        redaction_enabled: JSON.parse((getSetting.get("redaction_enabled") as { value: string }).value),
        overlay_opacity: JSON.parse((getSetting.get("overlay_opacity") as { value: string }).value),
        stt_model: JSON.parse((getSetting.get("stt_model") as { value: string }).value) as SttModelOption,
        auto_start_on_launch: JSON.parse((getSetting.get("auto_start_on_launch") as { value: string }).value),
        debug_logging: JSON.parse((getSetting.get("debug_logging") as { value: string }).value),
        transcript_max_chars: JSON.parse((getSetting.get("transcript_max_chars") as { value: string }).value),
        coaching_refresh_throttle_ms: JSON.parse((getSetting.get("coaching_refresh_throttle_ms") as { value: string }).value)
      };
    },
    setPrivacySettings(next: PrivacySettings): PrivacySettings {
      upsertSetting.run("store_transcript", JSON.stringify(next.store_transcript));
      upsertSetting.run("store_events", JSON.stringify(next.store_events));
      upsertSetting.run("redaction_enabled", JSON.stringify(next.redaction_enabled));
      upsertSetting.run("overlay_opacity", JSON.stringify(next.overlay_opacity));
      upsertSetting.run("stt_model", JSON.stringify(next.stt_model));
      upsertSetting.run("auto_start_on_launch", JSON.stringify(next.auto_start_on_launch));
      upsertSetting.run("debug_logging", JSON.stringify(next.debug_logging));
      upsertSetting.run("transcript_max_chars", JSON.stringify(next.transcript_max_chars));
      upsertSetting.run("coaching_refresh_throttle_ms", JSON.stringify(next.coaching_refresh_throttle_ms));
      return this.getPrivacySettings();
    },
    getOverlayPosition(): { x: number | null; y: number | null } {
      const xRow = getSetting.get("overlay_x") as { value: string } | undefined;
      const yRow = getSetting.get("overlay_y") as { value: string } | undefined;
      return {
        x: xRow ? JSON.parse(xRow.value) : null,
        y: yRow ? JSON.parse(yRow.value) : null
      };
    },
    setOverlayPosition(next: { x: number; y: number }): void {
      upsertSetting.run("overlay_x", JSON.stringify(next.x));
      upsertSetting.run("overlay_y", JSON.stringify(next.y));
    },
    startSession(): string {
      const id = randomUUID();
      insertSession.run(id, Date.now());
      return id;
    },
    endSession(sessionId: string): void {
      endSessionStmt.run(Date.now(), sessionId);
    },
    logEvent(sessionId: string, type: string, payload: Record<string, unknown>): void {
      insertEvent.run(sessionId, Date.now(), type, JSON.stringify(payload));
    },
    logOutcome(sessionId: string, payload: OutcomePayload): void {
      insertOutcome.run(sessionId, Date.now(), payload.outcome);
    },
    logObjectionEvent(
      sessionId: string,
      payload: { objection_id: string; confidence: number; matched_phrases: string[] }
    ) {
      this.logEvent(sessionId, "objection_update", payload);
    },
    logSuggestionClick(
      sessionId: string,
      payload: { slot: number; suggestion_text: string; objection_id: string }
    ) {
      insertSuggestionClick.run(
        sessionId,
        Date.now(),
        payload.objection_id,
        payload.suggestion_text,
        payload.slot
      );
      this.logEvent(sessionId, "suggestion_click", payload);
    },
    logTranscript(payload: { text: string; redacted_text: string }) {
      // We never persist raw transcript text.
      void payload.text;
      insertTranscript.run(payload.redacted_text);
    },
    getLast7DayStats(): Last7DayStats {
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const sessionsRow = statsSessionsStmt.get(sevenDaysAgo) as { count: number };
      const topObjectionsRows = statsTopObjectionsStmt.all(sevenDaysAgo) as Array<{
        objection_id: string | null;
        count: number;
      }>;
      const outcomesRows = statsOutcomesStmt.all(sevenDaysAgo) as Array<{
        outcome: "worked" | "neutral" | "did_not_work";
        count: number;
      }>;
      return {
        sessions_count: sessionsRow?.count ?? 0,
        top_objections: topObjectionsRows
          .filter((row) => row.objection_id)
          .map((row) => ({ objection_id: row.objection_id as string, count: row.count })),
        outcomes_distribution: outcomesRows
      };
    },
    getEventCounts(type: string, payloadKey: string, sinceTs: number, limit = 10): DbCountRow[] {
      const rows = eventCountsStmt.all(payloadKey, type, sinceTs, limit) as Array<{
        key: string | null;
        count: number;
      }>;
      return rows
        .filter((row) => typeof row.key === "string" && row.key.length > 0)
        .map((row) => ({ key: row.key as string, count: row.count }));
    },
    getAverageEventNumericPayload(type: string, payloadKey: string, sinceTs: number): number | null {
      const row = avgEventNumericStmt.get(payloadKey, type, sinceTs, payloadKey) as {
        avg_value: number | null;
      };
      if (!row || row.avg_value === null || !Number.isFinite(row.avg_value)) {
        return null;
      }
      return Number(row.avg_value);
    },
    getEventTypeCounts(types: string[], sinceTs: number): DbCountRow[] {
      if (types.length === 0) return [];
      const rows = eventTypeCountsStmt.all(sinceTs, JSON.stringify(types)) as Array<{
        key: string;
        count: number;
      }>;
      return rows;
    },
    getSessionCountsPerDay(sinceTs: number): DbSessionCountRow[] {
      const rows = sessionCountsPerDayStmt.all(sinceTs) as Array<{ day: string | null; count: number }>;
      return rows
        .filter((row) => typeof row.day === "string" && row.day.length > 0)
        .map((row) => ({ day: row.day as string, count: row.count }));
    },
    deleteDatabaseFile() {
      safeClose();
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
      if (fs.existsSync(`${dbPath}-wal`)) {
        fs.unlinkSync(`${dbPath}-wal`);
      }
      if (fs.existsSync(`${dbPath}-shm`)) {
        fs.unlinkSync(`${dbPath}-shm`);
      }
    },
    close() {
      safeClose();
    }
  };
}
