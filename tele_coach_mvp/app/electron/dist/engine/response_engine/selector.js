"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectCoachingPack = selectCoachingPack;
const playbook_classifier_1 = require("../classifier/playbook_classifier");
const adaptive_weights_1 = require("../classifier/adaptive_weights");
const severity_rules_1 = require("../classifier/severity_rules");
const intent_classifier_1 = require("../classifier/intent_classifier");
const competitor_detector_1 = require("../classifier/competitor_detector");
const state_machine_1 = require("../conversation/state_machine");
const momentum_engine_1 = require("../scoring/momentum_engine");
const bridge_picker_1 = require("../playbooks/bridge_picker");
const playbook_loader_1 = require("../playbooks/playbook_loader");
const TIME_BUCKET_MS = 10000;
const UNKNOWN_REPLIES = [
    "Understood, thanks for sharing that.",
    "I hear you, and I appreciate the context."
];
const UNKNOWN_QUESTIONS = [
    "What would be most useful to solve first on your side?",
    "What is the main blocker right now?"
];
const lastReplyByObjection = {};
const lastQuestionByObjection = {};
const playbook = (0, playbook_loader_1.loadCreditsafePlaybookSafe)();
const objectionById = new Map(playbook.objections.map((o) => [o.id, o]));
function hashString(input) {
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
function seededPick(arr, seedText, lastByKey, key) {
    if (arr.length === 0)
        return "";
    const timeBucket = Math.floor(Date.now() / TIME_BUCKET_MS);
    const seed = `${seedText}|${timeBucket}`;
    const hash = hashString(seed);
    let index = hash % arr.length;
    const chosen = arr[index] ?? arr[0];
    const last = lastByKey[key];
    if (arr.length > 1 && last !== undefined && chosen === last) {
        index = (index + 1) % arr.length;
        const next = arr[index] ?? arr[0];
        lastByKey[key] = next;
        return next;
    }
    lastByKey[key] = chosen;
    return chosen;
}
function adaptivePick(arr, seedText, lastByKey, key, phraseBoosts, objectionBoost) {
    if (arr.length === 0)
        return "";
    const candidates = arr.map((text) => ({
        text,
        boost: (phraseBoosts[(0, adaptive_weights_1.normalizeAdaptivePhrase)(text)] ?? 0) + objectionBoost * 0.35
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
    let chosen = ranked[0]?.text ?? arr[0];
    if (ranked.length > 1 && last !== undefined && chosen === last) {
        chosen = ranked[1]?.text ?? chosen;
    }
    lastByKey[key] = chosen;
    return chosen;
}
function mapIntentToDemoReadiness(intent) {
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
function selectCoachingPack(transcript, context) {
    const adaptive = (0, adaptive_weights_1.getAdaptiveWeights)();
    const objection = (0, playbook_classifier_1.detectObjectionId)(transcript);
    const severity = (0, severity_rules_1.detectSeverity)(transcript);
    const entry = objectionById.get(objection.id);
    const replies = entry?.replies ?? UNKNOWN_REPLIES;
    const questions = entry?.questions ?? UNKNOWN_QUESTIONS;
    const transcriptTail = transcript.slice(-250);
    const seedBase = transcriptTail + objection.id;
    const objectionBoost = adaptive.objectionBoosts[objection.id] ?? 0;
    const response = adaptivePick(replies, seedBase + "reply", lastReplyByObjection, objection.id, adaptive.phraseBoosts, objectionBoost);
    const question = adaptivePick(questions, seedBase + "question", lastQuestionByObjection, objection.id, adaptive.phraseBoosts, objectionBoost);
    const bridgeSeedText = objection.id + severity + transcript.slice(-250);
    const bridge = (0, bridge_picker_1.pickBridge)(bridgeSeedText);
    const intent = (0, intent_classifier_1.classifyIntent)(transcript);
    const conversationState = (0, state_machine_1.deriveConversationState)({
        rollingText: context?.rollingText ?? transcript,
        recentSegments: context?.recentStableSegments ?? [],
        objectionId: objection.id,
        intent: intent.primary_intent
    });
    const competitorDetection = (0, competitor_detector_1.detectCompetitors)(transcript);
    const momentum = (0, momentum_engine_1.scoreMomentum)({
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
