export type IntentType =
  | "demo_ready"
  | "curious"
  | "brush_off"
  | "callback"
  | "price_check"
  | "competitor_locked"
  | "not_relevant"
  | "unknown";

export interface IntentClassification {
  primary_intent: IntentType;
  confidence: number;
  signals: string[];
}

const DEMO_READY_PHRASES = [
  "are you near a screen",
  "yes go on",
  "show me",
  "can you show",
  "i can have a look",
  "send me a link and show me",
  "i am at my desk",
  "i'm at my desk",
  "i can jump on",
  "book me in",
  "lets do it now",
  "let's do it now"
];

const CURIOUS_PHRASES = [
  "how does it work",
  "what do you do",
  "who are creditsafe",
  "what can you see",
  "what does it include"
];

const BRUSH_OFF_PHRASES = [
  "send an email",
  "send me an email",
  "not interested",
  "not now",
  "busy",
  "call back later",
  "no time"
];

const CALLBACK_PHRASES = [
  "call me next week",
  "later this month",
  "call me in six months",
  "call me in 6 months",
  "try again tomorrow",
  "reach back out"
];

const PRICE_CHECK_PHRASES = [
  "how much is it",
  "just give me the price",
  "too expensive",
  "what is the cost",
  "what's the cost"
];

const COMPETITOR_LOCKED_PHRASES = [
  "we use experian",
  "we already use experian",
  "tied into a contract",
  "already with dnb",
  "already with d&b",
  "already with dun and bradstreet"
];

const NOT_RELEVANT_PHRASES = [
  "we do not offer credit",
  "we don't offer credit",
  "not my area",
  "wrong person",
  "no sales calls"
];

function matchSignals(lowerTranscript: string, phrases: string[]): string[] {
  const signals: string[] = [];
  for (const phrase of phrases) {
    if (lowerTranscript.includes(phrase)) {
      signals.push(phrase);
    }
  }
  return signals;
}

export function classifyIntent(transcript: string): IntentClassification {
  const lower = transcript.toLowerCase();

  const demoSignals = matchSignals(lower, DEMO_READY_PHRASES);
  const curiousSignals = matchSignals(lower, CURIOUS_PHRASES);
  const brushOffSignals = matchSignals(lower, BRUSH_OFF_PHRASES);
  const callbackSignals = matchSignals(lower, CALLBACK_PHRASES);
  const priceSignals = matchSignals(lower, PRICE_CHECK_PHRASES);
  const competitorLockedSignals = matchSignals(lower, COMPETITOR_LOCKED_PHRASES);
  const notRelevantSignals = matchSignals(lower, NOT_RELEVANT_PHRASES);

  // Priority: demo_ready > not_relevant > competitor_locked > callback > brush_off > price_check > curious > unknown
  if (demoSignals.length > 0) {
    return {
      primary_intent: "demo_ready",
      confidence: 0.9,
      signals: demoSignals
    };
  }

  if (notRelevantSignals.length > 0) {
    return {
      primary_intent: "not_relevant",
      confidence: 0.9,
      signals: notRelevantSignals
    };
  }

  if (competitorLockedSignals.length > 0) {
    return {
      primary_intent: "competitor_locked",
      confidence: 0.85,
      signals: competitorLockedSignals
    };
  }

  if (callbackSignals.length > 0) {
    return {
      primary_intent: "callback",
      confidence: 0.8,
      signals: callbackSignals
    };
  }

  if (brushOffSignals.length > 0) {
    return {
      primary_intent: "brush_off",
      confidence: 0.75,
      signals: brushOffSignals
    };
  }

  if (priceSignals.length > 0) {
    return {
      primary_intent: "price_check",
      confidence: 0.7,
      signals: priceSignals
    };
  }

  if (curiousSignals.length > 0) {
    return {
      primary_intent: "curious",
      confidence: 0.65,
      signals: curiousSignals
    };
  }

  return {
    primary_intent: "unknown",
    confidence: 0.3,
    signals: []
  };
}

