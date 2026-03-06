"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectObjectionId = detectObjectionId;
const playbook_loader_1 = require("../playbooks/playbook_loader");
const MIN_CONFIDENCE = 0.5;
const COOLDOWN_MS = 3000;
const CONFIDENCE_JUMP_OVERRIDE = 0.25;
let lastResult = {
    id: "unknown",
    matched: [],
    confidence: 0
};
let lastChangeAt = 0;
const playbook = (0, playbook_loader_1.loadCreditsafePlaybookSafe)();
function normalize(text) {
    return text.toLowerCase().trim();
}
function scoreObjection(transcriptLower, triggers) {
    const matched = [];
    const seenLower = new Set();
    for (const trigger of triggers) {
        const t = trigger.toLowerCase();
        if (!seenLower.has(t) && transcriptLower.includes(t)) {
            seenLower.add(t);
            matched.push(trigger);
        }
    }
    const triggerCount = Math.max(1, new Set(triggers.map((x) => x.toLowerCase())).size);
    const totalMatched = matched.length;
    const denominator = Math.max(2, triggerCount * 0.6);
    const confidence = Math.min(1, totalMatched / denominator);
    return { matched, confidence };
}
/**
 * Detects objection from transcript using Creditsafe playbook triggers.
 * Uses cooldown (3s) and confidence jump (0.25) to avoid label thrashing.
 */
function detectObjectionId(transcript) {
    const normalized = normalize(transcript);
    if (normalized.length === 0) {
        return lastResult;
    }
    let best = {
        id: "unknown",
        matched: [],
        confidence: 0
    };
    for (const objection of playbook.objections) {
        const { matched, confidence } = scoreObjection(normalized, objection.triggers);
        if (confidence >= MIN_CONFIDENCE && confidence > best.confidence) {
            best = {
                id: objection.id,
                matched,
                confidence
            };
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
