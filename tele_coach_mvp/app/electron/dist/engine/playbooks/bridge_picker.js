"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pickBridge = pickBridge;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const TIME_BUCKET_MS = 10000;
const DEFAULT_BRIDGES = [
    "Let me just show you your report it makes more sense visually",
    "It takes two minutes no pitch just insight",
    "You will see exactly what other businesses see when they check you",
    "It is worth seeing once even if you never use us",
    "You might learn something about how your company is perceived financially"
];
let lastBridge = "";
function hashString(input) {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return Math.abs(hash >>> 0);
}
function loadBridges() {
    try {
        const filePath = node_path_1.default.join(__dirname, "bridges.json");
        const raw = node_fs_1.default.readFileSync(filePath, "utf-8");
        const data = JSON.parse(raw);
        if (Array.isArray(data.bridges) && data.bridges.length > 0) {
            return data.bridges;
        }
    }
    catch {
        // fall through to default
    }
    return [...DEFAULT_BRIDGES];
}
/**
 * Picks a bridge phrase stable per time window (10s), avoiding repeating the same bridge twice in a row.
 */
function pickBridge(seedText) {
    const bridges = loadBridges();
    const timeBucket = Math.floor(Date.now() / TIME_BUCKET_MS);
    const seed = `${seedText}|${timeBucket}`;
    const hash = hashString(seed);
    let index = hash % bridges.length;
    const chosen = bridges[index] ?? bridges[0];
    if (bridges.length > 1 && chosen === lastBridge) {
        index = (index + 1) % bridges.length;
        lastBridge = bridges[index] ?? bridges[0];
    }
    else {
        lastBridge = chosen;
    }
    return lastBridge;
}
