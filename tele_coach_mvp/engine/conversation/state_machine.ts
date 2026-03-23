import type { IntentType } from "../classifier/intent_classifier";

export type ConversationStage =
  | "opening"
  | "rapport"
  | "discovery"
  | "objection_handling"
  | "value_exploration"
  | "demo_transition"
  | "next_step_close"
  | "ended"
  | "unknown";

export interface ConversationStateInput {
  rollingText: string;
  recentSegments?: Array<{ id: string; text: string }>;
  objectionId: string;
  intent: IntentType;
}

export interface ConversationState {
  stage: ConversationStage;
  confidence: number;
  reasons: string[];
}

export function hasAny(text: string, phrases: readonly string[]): string[] {
  const lower = text.toLowerCase();
  const hits: string[] = [];
  for (const phrase of phrases) {
    if (lower.includes(phrase)) {
      hits.push(phrase);
    }
  }
  return hits;
}

export function deriveConversationState(input: ConversationStateInput): ConversationState {
  const { rollingText, recentSegments = [], objectionId, intent } = input;
  const lower = rollingText.toLowerCase();
  const reasons: string[] = [];

  const stableCount = recentSegments.length;

  // Combine last few segments for localized phrase checks
  const recentText = recentSegments
    .slice(Math.max(0, stableCount - 5))
    .map((s) => s.text)
    .join(" ")
    .toLowerCase();

  const textForRules = recentText || lower;

  // --- Ended ---
  const endedPhrases = [
    "goodbye",
    "thanks bye",
    "thank you, bye",
    "thank you bye",
    "remove me",
    "take me off your list",
    "not interested remove me",
    "no more calls",
    "do not call again"
  ];
  const endedHits = hasAny(textForRules, endedPhrases);
  if (endedHits.length > 0 || intent === "not_relevant" || intent === "brush_off") {
    if (endedHits.length > 0) reasons.push(`ended_phrases:${endedHits.join("|")}`);
    if (intent === "not_relevant" || intent === "brush_off") reasons.push(`intent:${intent}`);
    return {
      stage: "ended",
      confidence: 0.9,
      reasons
    };
  }

  // --- Demo transition ---
  const demoPhrases = [
    "are you near a screen",
    "near a screen",
    "share my screen",
    "show you your report",
    "show you the report",
    "quick look",
    "two minutes",
    "walk you through",
    "walkthrough",
    "demo",
    "screen share",
    "jump on a screen"
  ];
  const demoHits = hasAny(textForRules, demoPhrases);
  if (demoHits.length > 0 || intent === "demo_ready") {
    if (demoHits.length > 0) reasons.push(`demo_phrases:${demoHits.join("|")}`);
    if (intent === "demo_ready") reasons.push("intent:demo_ready");
    return {
      stage: "demo_transition",
      confidence: 0.85,
      reasons
    };
  }

  // --- Next step close ---
  const closePhrases = [
    "call you next week",
    "call me next week",
    "later today",
    "later this week",
    "tomorrow",
    "book me in",
    "schedule a call",
    "set up a call",
    "send a summary",
    "send me a summary",
    "after i have seen it",
    "after showing you",
    "follow up",
    "touch base"
  ];
  const closeHits = hasAny(textForRules, closePhrases);
  if (closeHits.length > 0 || intent === "callback") {
    if (closeHits.length > 0) reasons.push(`close_phrases:${closeHits.join("|")}`);
    if (intent === "callback") reasons.push("intent:callback");
    return {
      stage: "next_step_close",
      confidence: 0.8,
      reasons
    };
  }

  // --- Objection handling ---
  if (objectionId && objectionId !== "unknown") {
    reasons.push(`objection:${objectionId}`);
    return {
      stage: "objection_handling",
      confidence: 0.8,
      reasons
    };
  }

  // --- Discovery ---
  const discoveryPhrases = [
    "how do you currently",
    "how are you currently",
    "what is your current process",
    "what does your process look like",
    "who do you use",
    "who are you using",
    "how many checks",
    "how often do you check",
    "what kind of customers",
    "what sort of customers",
    "what do you look at",
    "how do you decide"
  ];
  const discoveryHits = hasAny(textForRules, discoveryPhrases);
  const questionMarks = (textForRules.match(/\?/g) || []).length;
  if (discoveryHits.length > 0 || questionMarks >= 2) {
    if (discoveryHits.length > 0) reasons.push(`discovery_phrases:${discoveryHits.join("|")}`);
    if (questionMarks >= 2) reasons.push(`question_marks:${questionMarks}`);
    return {
      stage: "discovery",
      confidence: 0.75,
      reasons
    };
  }

  // --- Value exploration ---
  const valuePhrases = [
    "reports",
    "payment behaviour",
    "payment behavior",
    "insolvency",
    "credit risk",
    "risk management",
    "process improvement",
    "improve your process",
    "collections process",
    "credit checks",
    "monitoring",
    "portfolio",
    "limit decisions"
  ];
  const valueHits = hasAny(textForRules, valuePhrases);
  if (valueHits.length > 0) {
    reasons.push(`value_phrases:${valueHits.join("|")}`);
    return {
      stage: "value_exploration",
      confidence: 0.7,
      reasons
    };
  }

  // --- Opening / rapport ---
  const openingPhrases = [
    "hi ",
    "hello",
    "good morning",
    "good afternoon",
    "good evening",
    "how are you",
    "thanks for taking the call",
    "quick call",
    "speaking",
    "is that"
  ];
  const openingHits = hasAny(textForRules, openingPhrases);
  if (stableCount <= 2 || openingHits.length > 0) {
    if (openingHits.length > 0) reasons.push(`opening_phrases:${openingHits.join("|")}`);
    reasons.push(`stable_count:${stableCount}`);
    return {
      stage: "opening",
      confidence: 0.6,
      reasons
    };
  }

  // Fallback
  return {
    stage: "unknown",
    confidence: 0.4,
    reasons
  };
}

