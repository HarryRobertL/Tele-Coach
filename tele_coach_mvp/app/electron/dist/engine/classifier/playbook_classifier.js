"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectObjectionId = detectObjectionId;
exports.resetObjectionClassifierState = resetObjectionClassifierState;
const adaptive_weights_1 = require("./adaptive_weights");
const playbook_loader_1 = require("../playbooks/playbook_loader");
const MIN_CONFIDENCE = 0.62;
const COOLDOWN_MS = 3500;
const CONFIDENCE_JUMP_OVERRIDE = 0.28;
const MAX_TEXT_CHARS = 650;
const MAX_SENTENCES = 4;
let lastResult = {
    id: "unknown",
    matched: [],
    confidence: 0
};
let lastChangeAt = 0;
const playbook = (0, playbook_loader_1.loadCreditsafePlaybookSafe)();
const objectionIds = new Set(playbook.objections.map((objection) => objection.id));
const OBJECTION_ALIAS_PATTERNS = {
    send_email: [
        { phrase: "send me an email", weight: 0.9 },
        { phrase: "send it on email", weight: 0.88 },
        { phrase: "email me", weight: 0.82 },
        { phrase: "put it in an email", weight: 0.86 },
        { phrase: "send details by email", weight: 0.82 },
        { phrase: "send me the info", weight: 0.76 }
    ],
    not_interested_soft: [
        { phrase: "not interested", weight: 0.92 },
        { phrase: "no interest", weight: 0.78 },
        { phrase: "not for me", weight: 0.72 },
        { phrase: "not for us", weight: 0.72 },
        { phrase: "do not need", weight: 0.64 },
        { phrase: "dont need", weight: 0.64 }
    ],
    not_interested_cartwheel: [
        { phrase: "not interested at all", weight: 0.95 },
        { phrase: "really not interested", weight: 0.92 },
        { phrase: "definitely not interested", weight: 0.92 }
    ],
    busy: [
        { phrase: "too busy", weight: 0.92 },
        { phrase: "im busy", weight: 0.8 },
        { phrase: "i'm busy", weight: 0.8 },
        { phrase: "swamped", weight: 0.78 },
        { phrase: "in the middle of", weight: 0.72 },
        { phrase: "dont have time", weight: 0.8 },
        { phrase: "don't have time", weight: 0.8 }
    ],
    already_use_provider: [
        { phrase: "we use another provider", weight: 0.9 },
        { phrase: "we use another company", weight: 0.85 },
        { phrase: "already have a provider", weight: 0.9 },
        { phrase: "we already use", weight: 0.72 },
        { phrase: "we have a provider", weight: 0.76 },
        { phrase: "we have someone", weight: 0.72 },
        { phrase: "experian", weight: 0.88 },
        { phrase: "dun and bradstreet", weight: 0.92 },
        { phrase: "d&b", weight: 0.9 },
        { phrase: "d and b", weight: 0.9 },
        { phrase: "we use d and b", weight: 0.95 }
    ],
    tied_into_contract: [
        { phrase: "tied into a contract", weight: 0.95 },
        { phrase: "locked into a contract", weight: 0.95 },
        { phrase: "under contract", weight: 0.9 },
        { phrase: "contract renewal", weight: 0.78 },
        { phrase: "term not up", weight: 0.76 }
    ],
    dont_use_credit_checks: [
        { phrase: "we dont use credit checks", weight: 0.95 },
        { phrase: "we don't use credit checks", weight: 0.95 },
        { phrase: "we do not use credit checks", weight: 0.95 },
        { phrase: "we dont do credit checks", weight: 0.92 },
        { phrase: "we don't do credit checks", weight: 0.92 }
    ],
    who_are_creditsafe: [
        { phrase: "who are creditsafe", weight: 0.95 },
        { phrase: "who is creditsafe", weight: 0.95 },
        { phrase: "what is creditsafe", weight: 0.95 },
        { phrase: "never heard of creditsafe", weight: 0.92 }
    ],
    not_my_responsibility: [
        { phrase: "not my responsibility", weight: 0.95 },
        { phrase: "not my job", weight: 0.9 },
        { phrase: "not my decision", weight: 0.88 },
        { phrase: "im not the right person", weight: 0.82 },
        { phrase: "i'm not the right person", weight: 0.82 }
    ],
    data_accuracy: [
        { phrase: "data accuracy", weight: 0.92 },
        { phrase: "data is wrong", weight: 0.88 },
        { phrase: "incorrect data", weight: 0.88 },
        { phrase: "out of date", weight: 0.76 },
        { phrase: "inaccurate", weight: 0.82 }
    ],
    too_expensive: [
        { phrase: "too expensive", weight: 0.95 },
        { phrase: "its too expensive", weight: 0.92 },
        { phrase: "it's too expensive", weight: 0.92 },
        { phrase: "too costly", weight: 0.88 },
        { phrase: "price is too high", weight: 0.9 }
    ],
    no_budget: [
        { phrase: "no budget", weight: 0.95 },
        { phrase: "no budget for this", weight: 0.95 },
        { phrase: "we have no budget", weight: 0.92 },
        { phrase: "not in the budget", weight: 0.9 },
        { phrase: "budget is tight", weight: 0.78 }
    ],
    manual_process: [
        { phrase: "we do everything manually", weight: 0.95 },
        { phrase: "we do it manually", weight: 0.88 },
        { phrase: "manual process", weight: 0.82 },
        { phrase: "we do it by hand", weight: 0.82 }
    ],
    accountant_handles: [
        { phrase: "my accountant deals with that", weight: 0.95 },
        { phrase: "my accountant deals with it", weight: 0.95 },
        { phrase: "our accountant deals with it", weight: 0.95 },
        { phrase: "accountant handles it", weight: 0.9 }
    ],
    we_google_companies: [
        { phrase: "we google", weight: 0.92 },
        { phrase: "i google", weight: 0.82 },
        { phrase: "we just google", weight: 0.9 },
        { phrase: "we look them up online", weight: 0.78 }
    ]
};
function normalize(text) {
    return text
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^\w\s'.!?]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function sliceRecentInput(text) {
    const normalized = normalize(text);
    const byChars = normalized.slice(-MAX_TEXT_CHARS);
    const sentences = byChars
        .split(/(?<=[.!?])\s+/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (sentences.length <= MAX_SENTENCES) {
        return byChars;
    }
    return sentences.slice(-MAX_SENTENCES).join(" ");
}
function applyAdaptivePhraseWeight(baseWeight, phrase, adaptive) {
    const boost = adaptive.phraseBoosts[(0, adaptive_weights_1.normalizeAdaptivePhrase)(phrase)] ?? 0;
    return Math.max(0.4, baseWeight * (1 + boost));
}
function scoreObjection(objectionId, transcriptLower, triggers, adaptive) {
    const matched = [];
    const seenLower = new Set();
    let totalScore = 0;
    for (const trigger of triggers) {
        const t = trigger.toLowerCase();
        if (!seenLower.has(t) && transcriptLower.includes(t)) {
            seenLower.add(t);
            matched.push(trigger);
            totalScore += applyAdaptivePhraseWeight(0.95, trigger, adaptive);
        }
    }
    const aliases = OBJECTION_ALIAS_PATTERNS[objectionId] ?? [];
    for (const alias of aliases) {
        const phraseLower = alias.phrase.toLowerCase();
        if (!seenLower.has(phraseLower) && transcriptLower.includes(phraseLower)) {
            seenLower.add(phraseLower);
            matched.push(alias.phrase);
            totalScore += applyAdaptivePhraseWeight(alias.weight, alias.phrase, adaptive);
        }
    }
    const baselineConfidence = totalScore / (totalScore + 0.55);
    const objectionBoost = adaptive.objectionBoosts[objectionId] ?? 0;
    const confidence = Math.max(0, Math.min(1, Number((baselineConfidence + objectionBoost).toFixed(3))));
    return { matched, confidence };
}
/**
 * Detects objection from transcript using Creditsafe playbook triggers.
 * Uses cooldown (3s) and confidence jump (0.25) to avoid label thrashing.
 */
function detectObjectionId(transcript) {
    const normalized = sliceRecentInput(transcript);
    if (normalized.length === 0) {
        return lastResult;
    }
    const adaptive = (0, adaptive_weights_1.getAdaptiveWeights)();
    let best = {
        id: "unknown",
        matched: [],
        confidence: 0
    };
    for (const objection of playbook.objections) {
        const { matched, confidence } = scoreObjection(objection.id, normalized, objection.triggers, adaptive);
        if (confidence >= MIN_CONFIDENCE && confidence > best.confidence) {
            best = {
                id: objection.id,
                matched,
                confidence
            };
        }
    }
    // Optional generic fallback for common floor-language even if playbook is trimmed.
    if (best.id === "unknown") {
        const genericOrder = [
            { phrase: "send me an email", id: "send_email" },
            { phrase: "email me", id: "send_email" },
            { phrase: "not interested", id: "not_interested_soft" },
            { phrase: "remove me", id: "not_interested_cartwheel" },
            { phrase: "we use experian", id: "already_use_provider" },
            { phrase: "we use dnb", id: "already_use_provider" },
            { phrase: "we have no budget", id: "no_budget" },
            { phrase: "too expensive", id: "too_expensive" }
        ];
        for (const fallback of genericOrder) {
            if (normalized.includes(fallback.phrase) && objectionIds.has(fallback.id)) {
                best = {
                    id: fallback.id,
                    matched: [fallback.phrase],
                    confidence: 0.63
                };
                break;
            }
        }
    }
    const now = Date.now();
    const labelChanged = best.id !== lastResult.id;
    // Always allow switching to unknown so unrelated text clears quickly.
    if (labelChanged && best.id !== "unknown") {
        const inCooldown = now - lastChangeAt < COOLDOWN_MS;
        const confidenceJump = best.confidence - lastResult.confidence;
        if (inCooldown && confidenceJump <= CONFIDENCE_JUMP_OVERRIDE) {
            return lastResult;
        }
        lastChangeAt = now;
    }
    else if (labelChanged || best.confidence > lastResult.confidence) {
        lastChangeAt = now;
    }
    lastResult = best;
    return best;
}
function resetObjectionClassifierState() {
    lastResult = {
        id: "unknown",
        matched: [],
        confidence: 0
    };
    lastChangeAt = 0;
}
