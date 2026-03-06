"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaybookSelector = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const DEFAULT_OPTIMAL_ANSWERS = {
    unknown: "Understood. To help you quickly, what is the one outcome you need most right now?",
    not_interested: "Completely fair. If priorities shift, I can share a one-page summary and reconnect when timing is better.",
    already_have_provider: "Makes sense. We can run a side-by-side benchmark without disrupting your current provider.",
    send_email: "Happy to. I will send a concise brief and include two decisions your team can make quickly.",
    no_budget: "Understood. We can scope a low-risk pilot and align timing with your next budget window.",
    not_my_job: "Thanks for clarifying. Who should be looped in so I can tailor this to their priorities?",
    call_back_later: "Absolutely. Let’s lock a specific callback slot so this does not fall through the cracks.",
    too_busy: "I hear you. I can keep this to a two-minute summary and follow up when your schedule clears.",
    bad_timing: "Makes sense. Let’s align this to your timeline and set a quick checkpoint when it is relevant.",
    rarely_do_checks: "Understood. A usage-based, low-volume setup can keep cost down while still covering risk.",
    compliance_concern: "Valid point. We can review controls against your compliance requirements before any rollout.",
    price: "Fair question. Let’s map expected savings and risk reduction against cost so value is clear.",
    contract: "Understood. We can prepare options now and benchmark ahead of your renewal window."
};
function detectCallStage(transcriptLength) {
    if (transcriptLength < 300)
        return "early";
    if (transcriptLength < 1200)
        return "mid";
    return "late";
}
function hashText(input) {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return Math.abs(hash >>> 0);
}
class PlaybookSelector {
    constructor(playbookPath) {
        this.lastLineByKey = new Map();
        const raw = node_fs_1.default.readFileSync(playbookPath, "utf-8");
        this.playbook = JSON.parse(raw);
    }
    reset() {
        this.lastLineByKey.clear();
    }
    select(objectionId, transcript) {
        const stage = detectCallStage(transcript.length);
        const entry = this.playbook.entries[objectionId] ?? this.playbook.entries.unknown;
        const empathy = this.pickLine(entry, "empathy_lines", objectionId, transcript);
        const discovery = this.pickLine(entry, "discovery_questions", objectionId, transcript);
        const thirdCategory = stage === "late" ? "next_step_closes" : "value_angles";
        const third = this.pickLine(entry, thirdCategory, objectionId, transcript);
        return {
            suggestions: [empathy, discovery, third],
            next_best_question: discovery,
            optimal_answer: entry.optimal_answer?.trim() ||
                DEFAULT_OPTIMAL_ANSWERS[objectionId] ||
                `${empathy} ${third}`.trim(),
            call_stage: stage
        };
    }
    pickLine(entry, category, objectionId, transcript) {
        const options = entry[category];
        if (!options || options.length === 0)
            return "";
        const key = `${objectionId}:${category}`;
        const previous = this.lastLineByKey.get(key) ?? "";
        const seed = `${objectionId}|${category}|${transcript.slice(-500)}`;
        let index = hashText(seed) % options.length;
        if (options.length > 1 && options[index] === previous) {
            index = (index + 1) % options.length;
        }
        const chosen = options[index];
        this.lastLineByKey.set(key, chosen);
        return chosen;
    }
}
exports.PlaybookSelector = PlaybookSelector;
