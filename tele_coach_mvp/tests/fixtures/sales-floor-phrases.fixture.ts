export interface SalesFloorContractCase {
  id: string;
  transcript: string;
  expect: {
    objectionId?: string;
    severity?: "soft" | "medium" | "hard";
    intent?: "demo_ready" | "curious" | "brush_off" | "callback" | "price_check" | "competitor_locked" | "not_relevant" | "unknown";
    stage?: "opening" | "rapport" | "discovery" | "objection_handling" | "value_exploration" | "demo_transition" | "next_step_close" | "ended" | "unknown";
    momentumLevel?: "low" | "medium" | "high";
    minScore?: number;
    maxScore?: number;
    reasonIncludes?: string[];
  };
}

/**
 * Redacted-safe script contract for floor language.
 * Keep each case short and deterministic; this suite should fail fast on classifier drift.
 */
export const SALES_FLOOR_PHRASES: SalesFloorContractCase[] = [
  {
    id: "competitor-plus-screen-now",
    transcript: "we use Experian but I can have a quick look now",
    expect: {
      objectionId: "already_use_provider",
      stage: "demo_transition",
      momentumLevel: "high",
      minScore: 70,
      reasonIncludes: ["competitor_named:experian", "screen_available_now"]
    }
  },
  {
    id: "send-email-six-months",
    transcript: "send me an email and call in six months",
    expect: {
      objectionId: "send_email",
      intent: "brush_off",
      stage: "ended",
      momentumLevel: "low",
      maxScore: 45
    }
  },
  {
    id: "hard-stop-calling",
    transcript: "remove me from your list and stop calling",
    expect: {
      severity: "hard",
      stage: "ended",
      momentumLevel: "low",
      maxScore: 5,
      reasonIncludes: ["remove_me_or_stop_calling"]
    }
  },
  {
    id: "discovery-process-question",
    transcript: "how do you currently decide who to extend credit to and what is your process",
    expect: {
      stage: "discovery",
      momentumLevel: "low",
      minScore: 25
    }
  },
  {
    id: "value-risk-language",
    transcript: "our payment behaviour visibility and credit risk monitoring are weak",
    expect: {
      stage: "value_exploration",
      momentumLevel: "low",
      minScore: 20
    }
  },
  {
    id: "budget-objection",
    transcript: "we have no budget and budget is tight",
    expect: {
      objectionId: "no_budget",
      severity: "soft",
      stage: "objection_handling"
    }
  },
  {
    id: "price-objection",
    transcript: "it's too expensive and price is too high",
    expect: {
      objectionId: "too_expensive",
      stage: "objection_handling"
    }
  },
  {
    id: "manual-process-objection",
    transcript: "we do everything manually right now",
    expect: {
      objectionId: "manual_process",
      stage: "objection_handling"
    }
  },
  {
    id: "accountant-objection",
    transcript: "my accountant deals with that",
    expect: {
      objectionId: "accountant_handles",
      stage: "objection_handling"
    }
  },
  {
    id: "demo-ready-ask",
    transcript: "can you show me now? i am at my desk",
    expect: {
      intent: "demo_ready",
      stage: "demo_transition",
      momentumLevel: "high",
      minScore: 75
    }
  }
];
