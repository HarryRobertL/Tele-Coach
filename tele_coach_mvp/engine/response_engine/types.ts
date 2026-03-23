export interface CoachingPack {
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
