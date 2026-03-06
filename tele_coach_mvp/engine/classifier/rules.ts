import type { ObjectionClassification, ObjectionId } from "./types";

interface RuleDefinition {
  id: Exclude<ObjectionId, "unknown">;
  patterns: Array<{ phrase: string; weight: number }>;
}

const MIN_CONFIDENCE = 0.55;
const CHANGE_COOLDOWN_MS = 4000;
const CHANGE_JUMP_OVERRIDE = 0.3;
const MAX_TEXT_CHARS = 500;
const MAX_SENTENCES = 3;

const rules: RuleDefinition[] = [
  {
    id: "not_interested",
    patterns: [
      { phrase: "not interested", weight: 0.75 },
      { phrase: "no interest", weight: 0.65 },
      { phrase: "dont need this", weight: 0.45 },
      { phrase: "not for me", weight: 0.45 },
      { phrase: "we are all set", weight: 0.6 },
      { phrase: "not looking right now", weight: 0.55 }
    ]
  },
  {
    id: "already_have_provider",
    patterns: [
      { phrase: "already have a provider", weight: 0.8 },
      { phrase: "already have someone", weight: 0.7 },
      { phrase: "we use another company", weight: 0.65 },
      { phrase: "already covered", weight: 0.55 },
      { phrase: "happy with current provider", weight: 0.75 },
      { phrase: "existing vendor handles this", weight: 0.7 }
    ]
  },
  {
    id: "send_email",
    patterns: [
      { phrase: "send me an email", weight: 0.8 },
      { phrase: "email me", weight: 0.65 },
      { phrase: "put it in an email", weight: 0.65 },
      { phrase: "send details by email", weight: 0.65 },
      { phrase: "just send info", weight: 0.55 },
      { phrase: "send me information", weight: 0.55 }
    ]
  },
  {
    id: "no_budget",
    patterns: [
      { phrase: "no budget", weight: 0.85 },
      { phrase: "budget is tight", weight: 0.65 },
      { phrase: "cant afford", weight: 0.8 },
      { phrase: "not in the budget", weight: 0.8 },
      { phrase: "we dont have funds", weight: 0.75 },
      { phrase: "spend freeze", weight: 0.7 }
    ]
  },
  {
    id: "not_my_job",
    patterns: [
      { phrase: "not my job", weight: 0.85 },
      { phrase: "not my decision", weight: 0.8 },
      { phrase: "im not the right person", weight: 0.75 },
      { phrase: "someone else handles this", weight: 0.65 },
      { phrase: "talk to procurement", weight: 0.7 },
      { phrase: "my manager owns this", weight: 0.7 }
    ]
  },
  {
    id: "call_back_later",
    patterns: [
      { phrase: "call me back later", weight: 0.8 },
      { phrase: "call back later", weight: 0.75 },
      { phrase: "try me next week", weight: 0.6 },
      { phrase: "reach out later", weight: 0.6 },
      { phrase: "circle back later", weight: 0.65 },
      { phrase: "check back next month", weight: 0.65 }
    ]
  },
  {
    id: "too_busy",
    patterns: [
      { phrase: "too busy", weight: 0.85 },
      { phrase: "swamped right now", weight: 0.65 },
      { phrase: "in the middle of something", weight: 0.65 },
      { phrase: "dont have time", weight: 0.7 },
      { phrase: "up against a deadline", weight: 0.7 },
      { phrase: "in meetings all day", weight: 0.55 }
    ]
  },
  {
    id: "bad_timing",
    patterns: [
      { phrase: "bad timing", weight: 0.85 },
      { phrase: "not a good time", weight: 0.8 },
      { phrase: "wrong time", weight: 0.65 },
      { phrase: "catch me another time", weight: 0.65 },
      { phrase: "timing is off", weight: 0.75 },
      { phrase: "maybe next quarter", weight: 0.65 }
    ]
  },
  {
    id: "rarely_do_checks",
    patterns: [
      { phrase: "we rarely do checks", weight: 0.9 },
      { phrase: "we dont do many checks", weight: 0.8 },
      { phrase: "hardly run checks", weight: 0.7 },
      { phrase: "not many background checks", weight: 0.7 },
      { phrase: "low check volume", weight: 0.8 },
      { phrase: "small hiring volume", weight: 0.65 }
    ]
  },
  {
    id: "compliance_concern",
    patterns: [
      { phrase: "compliance concern", weight: 0.8 },
      { phrase: "data privacy", weight: 0.65 },
      { phrase: "legal concern", weight: 0.7 },
      { phrase: "regulatory risk", weight: 0.7 },
      { phrase: "gdpr concern", weight: 0.75 },
      { phrase: "security review required", weight: 0.75 }
    ]
  },
  {
    id: "price",
    patterns: [
      { phrase: "too expensive", weight: 0.85 },
      { phrase: "price is too high", weight: 0.85 },
      { phrase: "cost is high", weight: 0.65 },
      { phrase: "cheaper option", weight: 0.6 },
      { phrase: "too costly", weight: 0.75 },
      { phrase: "price point is high", weight: 0.75 }
    ]
  },
  {
    id: "contract",
    patterns: [
      { phrase: "under contract", weight: 0.85 },
      { phrase: "locked into a contract", weight: 0.9 },
      { phrase: "contract renewal", weight: 0.65 },
      { phrase: "cant switch until contract ends", weight: 0.9 },
      { phrase: "agreement in place", weight: 0.65 },
      { phrase: "term not up yet", weight: 0.7 }
    ]
  }
];

let lastResult: ObjectionClassification = {
  objection_id: "unknown",
  confidence: 0,
  matched_phrases: []
};
let lastChangeAt = 0;

export function resetClassificationState(): void {
  lastResult = {
    objection_id: "unknown",
    confidence: 0,
    matched_phrases: []
  };
  lastChangeAt = 0;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\w\s'.!?-]/g, " ").replace(/\s+/g, " ").trim();
}

function sliceRecentInput(text: string): string {
  const normalized = normalize(text);
  const byChars = normalized.slice(-MAX_TEXT_CHARS);
  const sentences = byChars
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= MAX_SENTENCES) return byChars;
  return sentences.slice(-MAX_SENTENCES).join(" ");
}

function bestMatch(text: string): ObjectionClassification {
  let winner: ObjectionClassification = {
    objection_id: "unknown",
    confidence: 0,
    matched_phrases: []
  };

  for (const rule of rules) {
    let total = 0;
    const matched: string[] = [];
    for (const pattern of rule.patterns) {
      if (text.includes(pattern.phrase)) {
        total += pattern.weight;
        matched.push(pattern.phrase);
      }
    }
    const confidence = Math.min(1, Number(total.toFixed(3)));
    if (confidence > winner.confidence) {
      winner = {
        objection_id: confidence >= MIN_CONFIDENCE ? rule.id : "unknown",
        confidence,
        matched_phrases: matched
      };
    }
  }

  if (winner.confidence < MIN_CONFIDENCE) {
    return {
      objection_id: "unknown",
      confidence: Number(winner.confidence.toFixed(3)),
      matched_phrases: []
    };
  }

  return winner;
}

export function classify(text: string): ObjectionClassification {
  const scoped = sliceRecentInput(text);
  const candidate = bestMatch(scoped);
  const now = Date.now();
  const labelChanged = candidate.objection_id !== lastResult.objection_id;

  if (labelChanged) {
    const inCooldown = now - lastChangeAt < CHANGE_COOLDOWN_MS;
    const confidenceJump = candidate.confidence - lastResult.confidence;
    if (inCooldown && confidenceJump < CHANGE_JUMP_OVERRIDE) {
      return lastResult;
    }
    lastChangeAt = now;
  } else if (candidate.confidence > lastResult.confidence) {
    // Same label updates are allowed without cooldown restrictions.
    lastChangeAt = now;
  }

  lastResult = candidate;
  return candidate;
}
