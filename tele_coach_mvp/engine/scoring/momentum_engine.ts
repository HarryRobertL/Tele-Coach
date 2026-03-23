import type { CompetitorCategory } from "../classifier/competitor_detector";
import type { IntentType } from "../classifier/intent_classifier";
import type { Severity } from "../classifier/severity_rules";
import type { ConversationStage } from "../conversation/state_machine";

export type MomentumLevel = "low" | "medium" | "high";

export interface MomentumInput {
  transcript: string;
  intent?: IntentType;
  stage?: ConversationStage;
  severity?: Severity;
  competitorCategory?: CompetitorCategory;
  competitorMentions?: string[];
}

export interface MomentumResult {
  score: number; // 0-100
  level: MomentumLevel;
  reasons: string[];
}

const DEMO_INVITE_PHRASES: readonly string[] = [
  "are you near a screen",
  "near a screen",
  "two minutes",
  "quick look",
  "show you your report",
  "show you the report",
  "show me",
  "walk you through",
  "screen share"
];

const SCREEN_AVAILABLE_PHRASES: readonly string[] = [
  "i can have a quick look now",
  "i can have a look now",
  "i can have a quick look",
  "i can have a look",
  "i can look now",
  "i'm at my desk",
  "i am at my desk",
  "at my desk now",
  "on my screen now",
  "near a screen now"
];

const QUESTION_HINTS: readonly string[] = [
  "how",
  "what",
  "when",
  "where",
  "who",
  "which",
  "can you",
  "could you",
  "would you"
];

const STOP_CALLING_PATTERNS: readonly RegExp[] = [
  /\bremove me\b/i,
  /\bstop calling\b/i,
  /\bdo not call again\b/i,
  /\bdon't call again\b/i,
  /\bno more calls\b/i,
  /\btake me off your list\b/i
];

const SEND_EMAIL_PATTERNS: readonly RegExp[] = [
  /\bsend me an email\b/i,
  /\bsend an email\b/i,
  /\bemail me\b/i
];

const NOT_INTERESTED_PATTERNS: readonly RegExp[] = [
  /\bnot interested\b/i,
  /\bnot interested at all\b/i
];

const CALLBACK_WITH_TIME_PATTERNS: readonly RegExp[] = [
  /\bcall (me )?(back )?(next week|tomorrow|later today|later this week)\b/i,
  /\bcall (me )?(in|after) (\d+|one|two|three|four|five|six|seven|eight|nine|ten) (day|days|week|weeks|month|months)\b/i,
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(?:at )?\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i
];

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function levelFromScore(score: number): MomentumLevel {
  if (score >= 70) return "high";
  if (score >= 35) return "medium";
  return "low";
}

function hasAnyPhrase(lowerText: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => lowerText.includes(phrase));
}

function countMatches(text: string, patterns: readonly RegExp[]): number {
  let count = 0;
  for (const pattern of patterns) {
    const globalPattern = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
    const matches = text.match(globalPattern);
    if (matches) {
      count += matches.length;
    }
  }
  return count;
}

function hasUserQuestion(text: string): boolean {
  const lower = text.toLowerCase();
  const lines = lower
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const userTaggedQuestion = lines.some((line) => {
    const userTagged =
      line.startsWith("prospect:") ||
      line.startsWith("customer:") ||
      line.startsWith("client:") ||
      line.startsWith("user:");
    return userTagged && (line.includes("?") || QUESTION_HINTS.some((hint) => line.includes(hint)));
  });
  if (userTaggedQuestion) return true;

  return lower.includes("?") && QUESTION_HINTS.some((hint) => lower.includes(hint));
}

function hasPattern(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function scoreMomentum(input: MomentumInput): MomentumResult {
  const transcript = input.transcript ?? "";
  const lower = transcript.toLowerCase();
  let score = 20;
  const reasons: string[] = ["base_score:20"];

  if (input.competitorCategory === "named_competitor") {
    score += 10;
    if (input.competitorMentions && input.competitorMentions.length > 0) {
      reasons.push(...input.competitorMentions.map((mention) => `competitor_named:${mention}`));
    } else {
      reasons.push("competitor_named");
    }
  } else if (input.competitorCategory === "generic_provider") {
    score += 6;
    reasons.push("competitor_generic_provider");
  }

  if (input.intent === "curious") {
    score += 10;
    reasons.push("intent_curious");
  }
  if (input.intent === "demo_ready") {
    score += 25;
    reasons.push("intent_demo_ready");
  }
  if (input.intent === "not_relevant") {
    score -= 25;
    reasons.push("intent_not_relevant");
  }

  if (input.stage === "discovery") {
    score += 8;
    reasons.push("stage_discovery");
  }
  if (input.stage === "value_exploration") {
    score += 10;
    reasons.push("stage_value_exploration");
  }
  if (input.stage === "demo_transition") {
    score += 18;
    reasons.push("stage_demo_transition");
  }

  if (hasUserQuestion(transcript)) {
    score += 6;
    reasons.push("user_question");
  }

  if (hasAnyPhrase(lower, DEMO_INVITE_PHRASES)) {
    score += 15;
    reasons.push("demo_invite_phrase");
  }

  if (hasPattern(transcript, CALLBACK_WITH_TIME_PATTERNS)) {
    score += 8;
    reasons.push("callback_with_specific_time");
  }

  if (hasAnyPhrase(lower, SCREEN_AVAILABLE_PHRASES)) {
    score += 20;
    reasons.push("screen_available_now");
  }

  if (input.severity === "hard") {
    score -= 20;
    reasons.push("severity_hard");
  }

  if (hasPattern(transcript, STOP_CALLING_PATTERNS)) {
    score -= 40;
    reasons.push("remove_me_or_stop_calling");
  }

  if (countMatches(transcript, SEND_EMAIL_PATTERNS) >= 2) {
    score -= 10;
    reasons.push("repeated_send_email_brush_off");
  }

  if (countMatches(transcript, NOT_INTERESTED_PATTERNS) >= 2) {
    score -= 15;
    reasons.push("repeated_not_interested");
  }

  const clampedScore = clampScore(score);
  return {
    score: clampedScore,
    level: levelFromScore(clampedScore),
    reasons
  };
}

