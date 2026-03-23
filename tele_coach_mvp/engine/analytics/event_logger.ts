import type { AppDatabase, Last7DayStats, OutcomePayload } from "../../app/electron/sqlite";
import type { CoachingPack } from "../response_engine/types";

export type TeleCoachEventType =
  | "session_started"
  | "session_ended"
  | "transcript_segment_finalized"
  | "objection_detected"
  | "severity_detected"
  | "competitor_detected"
  | "intent_detected"
  | "stage_changed"
  | "coaching_pack_generated"
  | "response_copied"
  | "question_copied"
  | "bridge_copied"
  | "outcome_marked"
  | "whisper_error"
  | "whisper_ready";

export interface EventLoggerSummary {
  topObjections: Array<{ objection_id: string; count: number }>;
  topCompetitorMentions: Array<{ competitor: string; count: number }>;
  stageDistribution: Array<{ stage: string; count: number }>;
  averageMomentum: number | null;
  mostCopiedResponseTypes: Array<{ copy_type: "response" | "question" | "bridge"; count: number }>;
  sessionCountsPerDay: Array<{ day: string; count: number }>;
}

export interface EventLogger {
  logSessionStarted(sessionId: string | null, payload?: Record<string, unknown>): void;
  logSessionEnded(sessionId: string | null, payload?: Record<string, unknown>): void;
  logTranscriptSegmentFinalized(
    sessionId: string | null,
    payload: { segment_id?: string; chars: number; tsMs?: number }
  ): void;
  logObjectionDetected(
    sessionId: string | null,
    payload: { objection_id: string; confidence: number; matched_phrases: string[] }
  ): void;
  logSeverityDetected(
    sessionId: string | null,
    payload: { severity: "soft" | "medium" | "hard"; objection_id?: string }
  ): void;
  logCompetitorDetected(
    sessionId: string | null,
    payload: { mentions: string[]; objection_id?: string }
  ): void;
  logIntentDetected(
    sessionId: string | null,
    payload: { intent: string; confidence?: number; signals?: string[] }
  ): void;
  logStageChanged(
    sessionId: string | null,
    payload: { from: string; to: string; confidence?: number }
  ): void;
  logCoachingPack(sessionId: string | null, payload: CoachingPack): void;
  logCopyAction(
    sessionId: string | null,
    payload: { type: "response" | "question" | "bridge"; text_length: number }
  ): void;
  logOutcome(sessionId: string | null, payload: OutcomePayload): void;
  logWhisperStatus(
    sessionId: string | null,
    payload: {
      status: "checking" | "missing" | "downloading" | "verifying" | "ready" | "error";
      detail?: string;
      progress?: number;
      step?: string;
      error?: string;
    }
  ): void;
  logTranscriptRedacted(payload: { text: string; redacted_text: string }): void;
  getLast7DayStats(): Last7DayStats;
  getSummary(days?: number): EventLoggerSummary;
}

function emptySummary(): EventLoggerSummary {
  return {
    topObjections: [],
    topCompetitorMentions: [],
    stageDistribution: [],
    averageMomentum: null,
    mostCopiedResponseTypes: [],
    sessionCountsPerDay: []
  };
}

export function createEventLogger(
  db: AppDatabase,
  privacy: () => { store_events: boolean; store_transcript: boolean; redaction_enabled: boolean },
  options?: { analyticsEnabled?: () => boolean }
): EventLogger {
  function analyticsEnabled(): boolean {
    return options?.analyticsEnabled ? options.analyticsEnabled() : true;
  }

  function safeLog(
    sessionId: string | null,
    eventType: TeleCoachEventType,
    payload: Record<string, unknown>
  ): void {
    if (!sessionId || !privacy().store_events || !analyticsEnabled()) return;
    try {
      db.logEvent(sessionId, eventType, payload);
    } catch {
      // Fail gracefully; analytics should never break live coaching.
    }
  }

  return {
    logSessionStarted(sessionId, payload) {
      safeLog(sessionId, "session_started", payload ?? {});
    },
    logSessionEnded(sessionId, payload) {
      safeLog(sessionId, "session_ended", payload ?? {});
    },
    logTranscriptSegmentFinalized(sessionId, payload) {
      safeLog(sessionId, "transcript_segment_finalized", payload);
    },
    logObjectionDetected(sessionId, payload) {
      safeLog(sessionId, "objection_detected", payload);
    },
    logSeverityDetected(sessionId, payload) {
      safeLog(sessionId, "severity_detected", payload);
    },
    logCompetitorDetected(sessionId, payload) {
      if (!payload.mentions || payload.mentions.length === 0) return;
      safeLog(sessionId, "competitor_detected", {
        ...payload,
        primary_mention: payload.mentions[0]
      });
    },
    logIntentDetected(sessionId, payload) {
      safeLog(sessionId, "intent_detected", payload);
    },
    logStageChanged(sessionId, payload) {
      safeLog(sessionId, "stage_changed", payload);
    },
    logCoachingPack(sessionId, payload) {
      safeLog(sessionId, "coaching_pack_generated", {
        objection_id: payload.objection_id,
        confidence: payload.confidence,
        severity: payload.severity,
        intent: payload.intent ?? "unknown",
        intent_confidence: payload.intent_confidence ?? null,
        stage: payload.conversation_stage ?? "unknown",
        stage_confidence: payload.stage_confidence ?? null,
        momentum_level: payload.momentum_level,
        momentum_score: payload.momentum_score,
        competitor_mentions: payload.competitor_mentions ?? []
      });
    },
    logCopyAction(sessionId, payload) {
      const eventType: TeleCoachEventType =
        payload.type === "question"
          ? "question_copied"
          : payload.type === "bridge"
            ? "bridge_copied"
            : "response_copied";
      safeLog(sessionId, eventType, payload);
    },
    logOutcome(sessionId, payload) {
      if (!sessionId || !privacy().store_events || !analyticsEnabled()) return;
      try {
        db.logOutcome(sessionId, payload);
      } catch {
        // ignore db failure
      }
      safeLog(sessionId, "outcome_marked", { outcome: payload.outcome });
    },
    logWhisperStatus(sessionId, payload) {
      if (payload.status === "ready") {
        safeLog(sessionId, "whisper_ready", payload);
      } else if (payload.status === "error") {
        safeLog(sessionId, "whisper_error", payload);
      }
    },
    logTranscriptRedacted(payload) {
      if (!privacy().store_transcript) return;
      try {
        db.logTranscript(payload);
      } catch {
        // ignore db failure
      }
    },
    getLast7DayStats() {
      try {
        return db.getLast7DayStats();
      } catch {
        return {
          sessions_count: 0,
          top_objections: [],
          outcomes_distribution: []
        };
      }
    },
    getSummary(days = 7) {
      if (!analyticsEnabled()) return emptySummary();
      const sinceTs = Date.now() - days * 24 * 60 * 60 * 1000;
      try {
        const topObjections = db
          .getEventCounts("objection_detected", "objection_id", sinceTs, 10)
          .map((row) => ({ objection_id: row.key, count: row.count }));
        const topCompetitorMentions = db
          .getEventCounts("competitor_detected", "primary_mention", sinceTs, 10)
          .map((row) => ({ competitor: row.key, count: row.count }));
        const stageDistribution = db
          .getEventCounts("stage_changed", "to", sinceTs, 20)
          .map((row) => ({ stage: row.key, count: row.count }));
        const averageMomentum = db.getAverageEventNumericPayload(
          "coaching_pack_generated",
          "momentum_score",
          sinceTs
        );
        const copyCounts = db.getEventTypeCounts(
          ["response_copied", "question_copied", "bridge_copied"],
          sinceTs
        );
        const mostCopiedResponseTypes = copyCounts.map((row) => ({
          copy_type: row.key.replace("_copied", "") as "response" | "question" | "bridge",
          count: row.count
        }));
        const sessionCountsPerDay = db.getSessionCountsPerDay(sinceTs);
        return {
          topObjections,
          topCompetitorMentions,
          stageDistribution,
          averageMomentum: averageMomentum === null ? null : Number(averageMomentum.toFixed(2)),
          mostCopiedResponseTypes,
          sessionCountsPerDay
        };
      } catch {
        return emptySummary();
      }
    }
  };
}

