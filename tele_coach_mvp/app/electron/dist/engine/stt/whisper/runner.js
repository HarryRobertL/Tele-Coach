"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhisperRunner = void 0;
const node_events_1 = require("node:events");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
class WhisperRunner extends node_events_1.EventEmitter {
    constructor() {
        super(...arguments);
        this.options = null;
        this.windowBytes = 0;
        this.chunks = [];
        this.partialTimer = null;
        this.running = false;
        this.busy = false;
        this.fallbackActive = false;
        this.consecutiveErrors = 0;
        this.lastPartialText = "";
        this.lastFinalText = "";
        this.lastFinalEmitAt = 0;
    }
    start(options) {
        if (this.running)
            return;
        const resolvedOptions = {
            rollingWindowMs: options.rollingWindowMs ?? 12000,
            partialCadenceMs: options.partialCadenceMs ?? 500,
            fallbackCadenceMs: options.fallbackCadenceMs ?? 2000,
            finalCadenceMs: options.finalCadenceMs ?? 2500,
            fallbackMode: options.fallbackMode ?? false,
            binaryPath: node_path_1.default.resolve(options.binaryPath),
            modelPath: node_path_1.default.resolve(options.modelPath)
        };
        this.options = resolvedOptions;
        this.fallbackActive = resolvedOptions.fallbackMode;
        this.windowBytes = 0;
        this.chunks.length = 0;
        this.lastPartialText = "";
        this.lastFinalText = "";
        this.lastFinalEmitAt = 0;
        this.consecutiveErrors = 0;
        this.emit("status", {
            state: "loading_model",
            detail: `Loading tiny English model: ${resolvedOptions.modelPath}`
        });
        if (!node_fs_1.default.existsSync(resolvedOptions.binaryPath)) {
            this.emit("status", {
                state: "error",
                detail: `whisper binary missing at ${resolvedOptions.binaryPath}. Place whisper.cpp binary at engine/stt/whisper/bin/whisper`
            });
            return;
        }
        if (!node_fs_1.default.existsSync(resolvedOptions.modelPath)) {
            this.emit("status", {
                state: "error",
                detail: `model missing at ${resolvedOptions.modelPath}. Place tiny model at engine/stt/whisper/models/ggml_tiny_en.bin`
            });
            return;
        }
        this.running = true;
        this.emit("status", {
            state: "running",
            detail: this.fallbackActive
                ? "Fallback mode active: transcribing every 2 seconds."
                : "Streaming mode active: ~500ms partial cadence."
        });
        this.scheduleCadence();
    }
    ingestAudioChunk(chunk) {
        if (!this.running || !this.options)
            return;
        const next = Buffer.from(chunk.pcm16);
        this.chunks.push(next);
        this.windowBytes += next.length;
        const maxBytes = this.maxWindowBytes(this.options.rollingWindowMs, chunk.sampleRate, chunk.channels);
        while (this.windowBytes > maxBytes && this.chunks.length > 0) {
            const removed = this.chunks.shift();
            this.windowBytes -= removed?.length ?? 0;
        }
    }
    stop() {
        if (!this.running)
            return;
        this.running = false;
        if (this.partialTimer) {
            clearInterval(this.partialTimer);
            this.partialTimer = null;
        }
        this.chunks.length = 0;
        this.windowBytes = 0;
        this.busy = false;
        this.emit("status", { state: "stopped", detail: "STT runner stopped." });
    }
    scheduleCadence() {
        if (!this.options)
            return;
        const cadence = this.fallbackActive ? this.options.fallbackCadenceMs : this.options.partialCadenceMs;
        if (this.partialTimer) {
            clearInterval(this.partialTimer);
            this.partialTimer = null;
        }
        this.partialTimer = setInterval(() => {
            void this.transcribeWindow();
        }, cadence);
    }
    maxWindowBytes(windowMs, sampleRate, channels) {
        const samples = Math.floor((windowMs / 1000) * sampleRate);
        return samples * channels * 2;
    }
    async transcribeWindow() {
        if (!this.running || !this.options || this.busy)
            return;
        if (this.windowBytes === 0)
            return;
        this.busy = true;
        try {
            const audio = Buffer.concat(this.chunks);
            const text = await this.runWhisper(audio, this.options);
            this.consecutiveErrors = 0;
            this.emitPartial(text);
            this.maybeEmitFinal(text);
        }
        catch (error) {
            this.consecutiveErrors += 1;
            const detail = error instanceof Error ? error.message : "Unknown whisper runner error.";
            this.emit("status", { state: "error", detail });
            if (!this.fallbackActive && this.consecutiveErrors >= 3) {
                this.fallbackActive = true;
                this.scheduleCadence();
                this.emit("status", {
                    state: "running",
                    detail: "Switched to fallback mode: transcribing every 2 seconds."
                });
            }
        }
        finally {
            this.busy = false;
        }
    }
    runWhisper(audio, options) {
        return new Promise((resolve, reject) => {
            const args = [
                "-m",
                options.modelPath,
                "-l",
                "en",
                "--output-txt",
                "--no-timestamps",
                "-f",
                "-"
            ];
            const child = (0, node_child_process_1.spawn)(options.binaryPath, args, { stdio: ["pipe", "pipe", "pipe"] });
            let stdout = "";
            let stderr = "";
            let settled = false;
            const resolveOnce = (text) => {
                if (settled)
                    return;
                settled = true;
                resolve(text);
            };
            const rejectOnce = (error) => {
                if (settled)
                    return;
                settled = true;
                reject(error);
            };
            child.stdout.on("data", (chunk) => {
                stdout += chunk.toString();
            });
            child.stderr.on("data", (chunk) => {
                stderr += chunk.toString();
            });
            child.stdin.on("error", (err) => {
                rejectOnce(new Error(`whisper stdin pipe error: ${err.message}`));
            });
            child.once("error", (err) => {
                rejectOnce(new Error(`Failed to launch whisper binary: ${err.message}`));
            });
            child.once("close", (code) => {
                if (code !== 0) {
                    rejectOnce(new Error(`whisper exited with code ${code}. stderr: ${stderr || "empty"}`));
                    return;
                }
                resolveOnce(this.parseWhisperText(stdout));
            });
            try {
                child.stdin.write(audio);
                child.stdin.end();
            }
            catch (error) {
                const detail = error instanceof Error ? error.message : "unknown stdin write failure";
                rejectOnce(new Error(`whisper stdin write failed: ${detail}`));
            }
        });
    }
    parseWhisperText(raw) {
        return raw
            .split("\n")
            .map((line) => line.replace(/^\[[^\]]+\]\s*/, "").trim())
            .filter((line) => line.length > 0)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
    }
    emitPartial(text) {
        if (!text || text === this.lastPartialText)
            return;
        this.lastPartialText = text;
        this.emit("partial", { text, tsMs: Date.now() });
    }
    maybeEmitFinal(text) {
        if (!text)
            return;
        const now = Date.now();
        const phraseBoundary = /[.!?]\s*$/.test(text);
        const cadenceBoundary = now - this.lastFinalEmitAt >= (this.options?.finalCadenceMs ?? 2500);
        if ((phraseBoundary || cadenceBoundary) && text !== this.lastFinalText) {
            this.lastFinalText = text;
            this.lastFinalEmitAt = now;
            this.emit("final", { text, tsMs: now });
        }
    }
}
exports.WhisperRunner = WhisperRunner;
