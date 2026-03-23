"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bootstrapDatabase = bootstrapDatabase;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const electron_1 = require("electron");
const DEFAULT_PRIVACY_SETTINGS = {
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
function bootstrapDatabase() {
    const dbPath = electron_1.app.isPackaged
        ? node_path_1.default.join(electron_1.app.getPath("userData"), "app.sqlite")
        : node_path_1.default.resolve(process.cwd(), "data", "app.sqlite");
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(dbPath), { recursive: true });
    let db = new better_sqlite3_1.default(dbPath);
    try {
        db.pragma("journal_mode = WAL");
    }
    catch {
        // If placeholder text exists, recreate a clean sqlite file.
        try {
            db.close();
        }
        catch {
            // Ignore close failures during recovery.
        }
        if (node_fs_1.default.existsSync(dbPath)) {
            node_fs_1.default.unlinkSync(dbPath);
        }
        db = new better_sqlite3_1.default(dbPath);
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
    const insertSession = db.prepare("INSERT INTO sessions (id, started_at, ended_at) VALUES (?, ?, NULL)");
    const endSessionStmt = db.prepare("UPDATE sessions SET ended_at = ? WHERE id = ?");
    const insertEvent = db.prepare("INSERT INTO events (session_id, ts, type, payload_json) VALUES (?, ?, ?, ?)");
    const insertSuggestionClick = db.prepare(`INSERT INTO suggestion_clicks (session_id, ts, objection_id, suggestion_text, slot)
     VALUES (?, ?, ?, ?, ?)`);
    const insertOutcome = db.prepare("INSERT INTO outcomes (session_id, ts, outcome) VALUES (?, ?, ?)");
    const insertTranscript = db.prepare("INSERT INTO transcript_events (text_redacted) VALUES (?)");
    const getSetting = db.prepare("SELECT value FROM app_settings WHERE key = ?");
    const upsertSetting = db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `);
    for (const [key, value] of Object.entries(DEFAULT_PRIVACY_SETTINGS)) {
        const existing = getSetting.get(key);
        if (!existing) {
            upsertSetting.run(key, JSON.stringify(value));
        }
    }
    let isClosed = false;
    function safeClose() {
        if (isClosed)
            return;
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
        getPrivacySettings() {
            return {
                store_transcript: JSON.parse(getSetting.get("store_transcript").value),
                store_events: JSON.parse(getSetting.get("store_events").value),
                redaction_enabled: JSON.parse(getSetting.get("redaction_enabled").value),
                overlay_opacity: JSON.parse(getSetting.get("overlay_opacity").value),
                stt_model: JSON.parse(getSetting.get("stt_model").value),
                auto_start_on_launch: JSON.parse(getSetting.get("auto_start_on_launch").value),
                debug_logging: JSON.parse(getSetting.get("debug_logging").value),
                transcript_max_chars: JSON.parse(getSetting.get("transcript_max_chars").value),
                coaching_refresh_throttle_ms: JSON.parse(getSetting.get("coaching_refresh_throttle_ms").value)
            };
        },
        setPrivacySettings(next) {
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
        getOverlayPosition() {
            const xRow = getSetting.get("overlay_x");
            const yRow = getSetting.get("overlay_y");
            return {
                x: xRow ? JSON.parse(xRow.value) : null,
                y: yRow ? JSON.parse(yRow.value) : null
            };
        },
        setOverlayPosition(next) {
            upsertSetting.run("overlay_x", JSON.stringify(next.x));
            upsertSetting.run("overlay_y", JSON.stringify(next.y));
        },
        startSession() {
            const id = (0, node_crypto_1.randomUUID)();
            insertSession.run(id, Date.now());
            return id;
        },
        endSession(sessionId) {
            endSessionStmt.run(Date.now(), sessionId);
        },
        logEvent(sessionId, type, payload) {
            insertEvent.run(sessionId, Date.now(), type, JSON.stringify(payload));
        },
        logOutcome(sessionId, payload) {
            insertOutcome.run(sessionId, Date.now(), payload.outcome);
        },
        logObjectionEvent(sessionId, payload) {
            this.logEvent(sessionId, "objection_update", payload);
        },
        logSuggestionClick(sessionId, payload) {
            insertSuggestionClick.run(sessionId, Date.now(), payload.objection_id, payload.suggestion_text, payload.slot);
            this.logEvent(sessionId, "suggestion_click", payload);
        },
        logTranscript(payload) {
            // We never persist raw transcript text.
            void payload.text;
            insertTranscript.run(payload.redacted_text);
        },
        getLast7DayStats() {
            const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
            const sessionsRow = statsSessionsStmt.get(sevenDaysAgo);
            const topObjectionsRows = statsTopObjectionsStmt.all(sevenDaysAgo);
            const outcomesRows = statsOutcomesStmt.all(sevenDaysAgo);
            return {
                sessions_count: sessionsRow?.count ?? 0,
                top_objections: topObjectionsRows
                    .filter((row) => row.objection_id)
                    .map((row) => ({ objection_id: row.objection_id, count: row.count })),
                outcomes_distribution: outcomesRows
            };
        },
        getEventCounts(type, payloadKey, sinceTs, limit = 10) {
            const rows = eventCountsStmt.all(payloadKey, type, sinceTs, limit);
            return rows
                .filter((row) => typeof row.key === "string" && row.key.length > 0)
                .map((row) => ({ key: row.key, count: row.count }));
        },
        getAverageEventNumericPayload(type, payloadKey, sinceTs) {
            const row = avgEventNumericStmt.get(payloadKey, type, sinceTs, payloadKey);
            if (!row || row.avg_value === null || !Number.isFinite(row.avg_value)) {
                return null;
            }
            return Number(row.avg_value);
        },
        getEventTypeCounts(types, sinceTs) {
            if (types.length === 0)
                return [];
            const rows = eventTypeCountsStmt.all(sinceTs, JSON.stringify(types));
            return rows;
        },
        getSessionCountsPerDay(sinceTs) {
            const rows = sessionCountsPerDayStmt.all(sinceTs);
            return rows
                .filter((row) => typeof row.day === "string" && row.day.length > 0)
                .map((row) => ({ day: row.day, count: row.count }));
        },
        deleteDatabaseFile() {
            safeClose();
            if (node_fs_1.default.existsSync(dbPath)) {
                node_fs_1.default.unlinkSync(dbPath);
            }
            if (node_fs_1.default.existsSync(`${dbPath}-wal`)) {
                node_fs_1.default.unlinkSync(`${dbPath}-wal`);
            }
            if (node_fs_1.default.existsSync(`${dbPath}-shm`)) {
                node_fs_1.default.unlinkSync(`${dbPath}-shm`);
            }
        },
        close() {
            safeClose();
        }
    };
}
