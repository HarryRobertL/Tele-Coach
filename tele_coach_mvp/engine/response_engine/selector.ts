import { detectObjectionId } from "../classifier/playbook_classifier";
import {
  getAdaptiveWeights,
  normalizeAdaptivePhrase
} from "../classifier/adaptive_weights";
import { detectSeverity } from "../classifier/severity_rules";
import { classifyIntent } from "../classifier/intent_classifier";
import { detectCompetitors } from "../classifier/competitor_detector";
import { deriveConversationState } from "../conversation/state_machine";
import { scoreMomentum } from "../scoring/momentum_engine";
import { pickBridge } from "../playbooks/bridge_picker";
import { loadCreditsafePlaybookSafe } from "../playbooks/playbook_loader";
import type { CoachingPack } from "./types";

const TIME_BUCKET_MS = 10_000;

const UNKNOWN_REPLIES = [
  "Understood, thanks for sharing that.",
  "I hear you, and I appreciate the context."
];
const UNKNOWN_QUESTIONS = [
  "What would be most useful to solve first on your side?",
  "What is the main blocker right now?"
];

const lastReplyByObjection: Record<string, string> = {};
const lastQuestionByObjection: Record<string, string> = {};

const playbook = loadCreditsafePlaybookSafe();
const objectionById = new Map(playbook.objections.map((o) => [o.id, o]));

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0);
}

/**
 * Seeded selection from array; avoids repeating the same value twice in a row for the given key.
 */
function seededPick(
  arr: string[],
  seedText: string,
  lastByKey: Record<string, string>,
  key: string
): string {
  if (arr.length === 0) return "";
  const timeBucket = Math.floor(Date.now() / TIME_BUCKET_MS);
  const seed = `${seedText}|${timeBucket}`;
  const hash = hashString(seed);
  let index = hash % arr.length;
  const chosen = arr[index] ?? arr[0]!;
  const last = lastByKey[key];
  if (arr.length > 1 && last !== undefined && chosen === last) {
    index = (index + 1) % arr.length;
    const next = arr[index] ?? arr[0]!;
    lastByKey[key] = next;
    return next;
  }
  lastByKey[key] = chosen;
  return chosen;
}

function adaptivePick(
  arr: string[],
  seedText: string,
  lastByKey: Record<string, string>,
  key: string,
  phraseBoosts: Record<string, number>,
  objectionBoost: number
): string {
  if (arr.length === 0) return "";
  const candidates = arr.map((text) => ({
    text,
    boost:
      (phraseBoosts[normalizeAdaptivePhrase(text)] ?? 0) + objectionBoost * 0.35
  }));
  const hasMeaningfulSignal = candidates.some((candidate) => Math.abs(candidate.boost) >= 0.015);
  if (!hasMeaningfulSignal) {
    return seededPick(arr, seedText, lastByKey, key);
  }

  const timeBucket = Math.floor(Date.now() / TIME_BUCKET_MS);
  const seed = `${seedText}|adaptive|${timeBucket}`;
  const ranked = candidates
    .map((candidate) => {
      const tieBreaker = (hashString(`${seed}|${candidate.text}`) % 1000) / 1000 / 100;
      return {
        text: candidate.text,
        score: candidate.boost + tieBreaker
      };
    })
    .sort((a, b) => b.score - a.score);

  const last = lastByKey[key];
  let chosen = ranked[0]?.text ?? arr[0]!;
  if (ranked.length > 1 && last !== undefined && chosen === last) {
    chosen = ranked[1]?.text ?? chosen;
  }
  lastByKey[key] = chosen;
  return chosen;
}

function mapIntentToDemoReadiness(intent: string): number {
  switch (intent) {
    case "demo_ready":
      return 90;
    case "curious":
      return 65;
    case "callback":
      return 50;
    case "price_check":
      return 55;
    case "competitor_locked":
      return 45;
    case "brush_off":
      return 25;
    case "not_relevant":
      return 10;
    case "unknown":
    default:
      return 25;
  }
}

/**
 * Selects a full coaching pack: objection, severity, response, question, bridge, and momentum.
 */
export interface CoachingContext {
  rollingText?: string;
  recentStableSegments?: Array<{ id: string; text: string }>;
}

export function selectCoachingPack(
  transcript: string,
  context?: CoachingContext
): CoachingPack {
  const adaptive = getAdaptiveWeights();
  const objection = detectObjectionId(transcript);
  const severity = detectSeverity(transcript);

  const entry = objectionById.get(objection.id);
  const replies = entry?.replies ?? UNKNOWN_REPLIES;
  const questions = entry?.questions ?? UNKNOWN_QUESTIONS;

  const transcriptTail = transcript.slice(-250);
  const seedBase = transcriptTail + objection.id;
  const objectionBoost = adaptive.objectionBoosts[objection.id] ?? 0;

  const response = adaptivePick(
    replies,
    seedBase + "reply",
    lastReplyByObjection,
    objection.id,
    adaptive.phraseBoosts,
    objectionBoost
  );
  const question = adaptivePick(
    questions,
    seedBase + "question",
    lastQuestionByObjection,
    objection.id,
    adaptive.phraseBoosts,
    objectionBoost
  );

  const bridgeSeedText =
    objection.id + severity + transcript.slice(-250);
  const bridge = pickBridge(bridgeSeedText);

  const intent = classifyIntent(transcript);
  const conversationState = deriveConversationState({
    rollingText: context?.rollingText ?? transcript,
    recentSegments: context?.recentStableSegments ?? [],
    objectionId: objection.id,
    intent: intent.primary_intent
  });
  const competitorDetection = detectCompetitors(transcript);
  const momentum = scoreMomentum({
    transcript,
    intent: intent.primary_intent,
    stage: conversationState.stage,
    severity,
    competitorCategory: competitorDetection.category,
    competitorMentions: competitorDetection.mentions
  });
  const demoReadinessScore = mapIntentToDemoReadiness(intent.primary_intent);

  return {
    objection_id: objection.id,
    confidence: objection.confidence,
    severity,
    response,
    question,
    bridge,
    momentum_level: momentum.level,
    momentum_score: momentum.score,
    momentum_reasons: momentum.reasons,
    intent: intent.primary_intent,
    intent_confidence: intent.confidence,
    intent_signals: intent.signals,
    demo_readiness_score: demoReadinessScore,
    conversation_stage: conversationState.stage,
    stage_confidence: conversationState.confidence,
    stage_reasons: conversationState.reasons,
    competitor_mentions: competitorDetection.mentions,
    timestamp: Date.now()
  };
}
