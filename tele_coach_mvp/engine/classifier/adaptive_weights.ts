import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export interface AdaptiveWeights {
  objectionBoosts: Record<string, number>;
  phraseBoosts: Record<string, number>;
  stale: boolean;
}

interface OutcomeLearningRow {
  outcome_ts: number;
  outcome: "worked" | "neutral" | "did_not_work";
  objection_id: string | null;
  suggestion_text: string | null;
  matched_phrases_json: string | null;
}

interface AggregatedStat {
  total: number;
  count: number;
}

const MAX_ABS_BOOST = 0.2;
const CACHE_TTL_MS = 60_000;
const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
const LOOKBACK_MS = 60 * 24 * 60 * 60 * 1000;
const MIN_OBJECTION_SAMPLES = 2;
const MIN_PHRASE_SAMPLES = 2;

const DEBUG_ADAPTIVE =
  process.env.DEBUG_ADAPTIVE === "1" || process.env.DEBUG_ADAPTIVE === "true";

const NEUTRAL_WEIGHTS: AdaptiveWeights = {
  objectionBoosts: {},
  phraseBoosts: {},
  stale: true
};

let cached: { atMs: number; value: AdaptiveWeights } | null = null;

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizeBoost(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  const rounded = Number(raw.toFixed(4));
  return clamp(rounded, -MAX_ABS_BOOST, MAX_ABS_BOOST);
}

function outcomeScore(outcome: OutcomeLearningRow["outcome"]): number {
  if (outcome === "worked") return 1;
  if (outcome === "did_not_work") return -1;
  return 0;
}

export function normalizeAdaptivePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, " ");
}

function addStat(map: Map<string, AggregatedStat>, key: string, score: number): void {
  if (!key) return;
  const existing = map.get(key) ?? { total: 0, count: 0 };
  existing.total += score;
  existing.count += 1;
  map.set(key, existing);
}

function statToBoost(stat: AggregatedStat, minSamples: number): number {
  if (stat.count < minSamples) return 0;
  const mean = stat.total / stat.count; // -1..1
  const confidence = Math.min(1, stat.count / 8);
  return normalizeBoost(mean * MAX_ABS_BOOST * confidence);
}

function parseMatchedPhrases(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function readOutcomeLearningRows(dbPath: string): OutcomeLearningRow[] {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const cutoff = Date.now() - LOOKBACK_MS;
    const stmt = db.prepare(`
      SELECT
        o.ts AS outcome_ts,
        o.outcome AS outcome,
        COALESCE(
          (
            SELECT sc.objection_id
            FROM suggestion_clicks sc
            WHERE sc.session_id = o.session_id AND sc.ts <= o.ts
            ORDER BY sc.ts DESC
            LIMIT 1
          ),
          (
            SELECT json_extract(e.payload_json, '$.objection_id')
            FROM events e
            WHERE e.session_id = o.session_id
              AND e.type = 'objection_update'
              AND e.ts <= o.ts
            ORDER BY e.ts DESC
            LIMIT 1
          )
        ) AS objection_id,
        (
          SELECT sc.suggestion_text
          FROM suggestion_clicks sc
          WHERE sc.session_id = o.session_id AND sc.ts <= o.ts
          ORDER BY sc.ts DESC
          LIMIT 1
        ) AS suggestion_text,
        (
          SELECT json_extract(e.payload_json, '$.matched_phrases')
          FROM events e
          WHERE e.session_id = o.session_id
            AND e.type = 'objection_update'
            AND e.ts <= o.ts
          ORDER BY e.ts DESC
          LIMIT 1
        ) AS matched_phrases_json
      FROM outcomes o
      WHERE o.ts >= ?
      ORDER BY o.ts DESC
    `);
    return stmt.all(cutoff) as OutcomeLearningRow[];
  } finally {
    db.close();
  }
}

function toAdaptiveWeights(rows: OutcomeLearningRow[]): AdaptiveWeights {
  if (rows.length === 0) {
    return { ...NEUTRAL_WEIGHTS };
  }

  const objectionStats = new Map<string, AggregatedStat>();
  const phraseStats = new Map<string, AggregatedStat>();
  let newestTs = 0;

  for (const row of rows) {
    newestTs = Math.max(newestTs, row.outcome_ts);
    const score = outcomeScore(row.outcome);
    if (score === 0) continue;

    if (row.objection_id) {
      addStat(objectionStats, row.objection_id, score);
    }
    if (row.suggestion_text) {
      addStat(phraseStats, normalizeAdaptivePhrase(row.suggestion_text), score);
    }

    const matchedPhrases = parseMatchedPhrases(row.matched_phrases_json);
    for (const phrase of matchedPhrases) {
      // Lower learning pressure on phrase-level signal to avoid overfitting.
      addStat(phraseStats, normalizeAdaptivePhrase(phrase), score * 0.6);
    }
  }

  const objectionBoosts: Record<string, number> = {};
  for (const [key, stat] of objectionStats.entries()) {
    const boost = statToBoost(stat, MIN_OBJECTION_SAMPLES);
    if (boost !== 0) objectionBoosts[key] = boost;
  }

  const phraseBoosts: Record<string, number> = {};
  for (const [key, stat] of phraseStats.entries()) {
    const boost = statToBoost(stat, MIN_PHRASE_SAMPLES);
    if (boost !== 0) phraseBoosts[key] = boost;
  }

  const stale = newestTs === 0 || Date.now() - newestTs > STALE_AFTER_MS;
  return { objectionBoosts, phraseBoosts, stale };
}

function maybeDebugLog(weights: AdaptiveWeights): void {
  if (!DEBUG_ADAPTIVE) return;
  const objectionEntries = Object.entries(weights.objectionBoosts)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 5);
  const phraseEntries = Object.entries(weights.phraseBoosts)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 5);
  console.log(
    `[adaptive] stale=${weights.stale} objections=${JSON.stringify(
      objectionEntries
    )} phrases=${JSON.stringify(phraseEntries)}`
  );
}

export function getAdaptiveWeights(): AdaptiveWeights {
  const adaptiveEnabled = process.env.TELE_COACH_ADAPTIVE_WEIGHTING;
  if (adaptiveEnabled === "0" || adaptiveEnabled === "false") {
    return { ...NEUTRAL_WEIGHTS, stale: false };
  }
  const now = Date.now();
  if (cached && now - cached.atMs < CACHE_TTL_MS) {
    return cached.value;
  }

  const dbPath = path.resolve(process.cwd(), "data", "app.sqlite");
  if (!fs.existsSync(dbPath)) {
    cached = { atMs: now, value: { ...NEUTRAL_WEIGHTS } };
    return cached.value;
  }

  try {
    const rows = readOutcomeLearningRows(dbPath);
    const weights = toAdaptiveWeights(rows);
    maybeDebugLog(weights);
    cached = { atMs: now, value: weights };
    return weights;
  } catch {
    cached = { atMs: now, value: { ...NEUTRAL_WEIGHTS } };
    return cached.value;
  }
}

