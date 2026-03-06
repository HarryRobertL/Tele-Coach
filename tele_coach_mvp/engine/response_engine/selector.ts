import { detectObjectionId } from "../classifier/playbook_classifier";
import { detectSeverity } from "../classifier/severity_rules";
import { pickBridge } from "../playbooks/bridge_picker";
import { loadCreditsafePlaybookSafe } from "../playbooks/playbook_loader";

export interface CoachingPack {
  objection: { id: string; confidence: number; matched: string[] };
  severity: "soft" | "medium" | "hard";
  response: string;
  question: string;
  bridge: string;
  momentum: { level: "low" | "medium" | "high"; score: number; reason: string[] };
}

const TIME_BUCKET_MS = 10_000;

const UNKNOWN_REPLIES = [
  "Understood, thanks for sharing that.",
  "I hear you, and I appreciate the context."
];
const UNKNOWN_QUESTIONS = [
  "What would be most useful to solve first on your side?",
  "What is the main blocker right now?"
];

const DEMO_INVITE_PHRASES = [
  "are you near a screen",
  "two minutes",
  "show you your report"
];
const QUESTION_WORDS = ["how", "what", "when", "who", "do you"];

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

function computeMomentum(
  transcript: string,
  objectionConfidence: number
): { level: "low" | "medium" | "high"; score: number; reason: string[] } {
  let score = 0;
  const reason: string[] = [];
  const lower = transcript.toLowerCase();

  for (const phrase of DEMO_INVITE_PHRASES) {
    if (lower.includes(phrase)) {
      score += 3;
      reason.push("demo_invite_phrase");
      break;
    }
  }
  if (lower.includes("?") || QUESTION_WORDS.some((w) => lower.includes(w))) {
    score += 1;
    reason.push("question_mark_or_question_word");
  }
  if (objectionConfidence > 0.7) {
    score += 1;
    reason.push("objection_confidence_above_0_7");
  }
  score = Math.min(5, score);

  let level: "low" | "medium" | "high" = "low";
  if (score >= 4) level = "high";
  else if (score >= 2) level = "medium";

  return { level, score, reason };
}

/**
 * Selects a full coaching pack: objection, severity, response, question, bridge, and momentum.
 */
export function selectCoachingPack(transcript: string): CoachingPack {
  const objection = detectObjectionId(transcript);
  const severity = detectSeverity(transcript);

  const entry = objectionById.get(objection.id);
  const replies = entry?.replies ?? UNKNOWN_REPLIES;
  const questions = entry?.questions ?? UNKNOWN_QUESTIONS;

  const transcriptTail = transcript.slice(-250);
  const seedBase = transcriptTail + objection.id;

  const response = seededPick(
    replies,
    seedBase + "reply",
    lastReplyByObjection,
    objection.id
  );
  const question = seededPick(
    questions,
    seedBase + "question",
    lastQuestionByObjection,
    objection.id
  );

  const bridgeSeedText =
    objection.id + severity + transcript.slice(-250);
  const bridge = pickBridge(bridgeSeedText);

  const momentum = computeMomentum(transcript, objection.confidence);

  return {
    objection: {
      id: objection.id,
      confidence: objection.confidence,
      matched: objection.matched
    },
    severity,
    response,
    question,
    bridge,
    momentum
  };
}
