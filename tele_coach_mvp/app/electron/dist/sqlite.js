"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bootstrapDatabase = bootstrapDatabase;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const electron_1 = require("electron");
function bootstrapDatabase() {
    const dbPath = node_path_1.default.resolve(electron_1.app.getAppPath(), "data", "app.sqlite");
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(dbPath), { recursive: true });
    const db = new better_sqlite3_1.default(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
    const insertOutcome = db.prepare("INSERT INTO analytics_events (event_type, payload_json) VALUES (?, ?)");
    return {
        dbPath,
        logOutcome(payload) {
            insertOutcome.run("log_outcome", JSON.stringify(payload));
        },
        close() {
            db.close();
        }
    };
}
