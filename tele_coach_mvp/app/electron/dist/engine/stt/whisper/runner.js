"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhisperRunner = void 0;
exports.setWhisperDebugLogging = setWhisperDebugLogging;
const node_events_1 = require("node:events");
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const wav_converter_1 = require("../wav_converter");
let debugSttEnabled = process.env.DEBUG_STT === "1" || process.env.DEBUG_STT === "true";
const MIN_BINARY_SIZE = 500 * 1024;
const MIN_MODEL_SIZE = 70 * 1024 * 1024;
function setWhisperDebugLogging(enabled) {
    debugSttEnabled = enabled;
}
function debugSttLog(message, ...args) {
    if (!debugSttEnabled)
        return;
    console.log(message, ...args);
}
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
            detail: `Loading Whisper model: ${node_path_1.default.basename(resolvedOptions.modelPath)}`
        });
        if (!node_fs_1.default.existsSync(resolvedOptions.binaryPath)) {
            debugSttLog(`[WhisperRunner] ERROR: Binary missing at ${resolvedOptions.binaryPath}`);
            this.emit("status", {
                state: "error",
                detail: `whisper binary missing at ${resolvedOptions.binaryPath}. Sales floor mode: Use manual test input.`
            });
            return;
        }
        if (!node_fs_1.default.existsSync(resolvedOptions.modelPath)) {
            debugSttLog(`[WhisperRunner] ERROR: Model missing at ${resolvedOptions.modelPath}`);
            this.emit("status", {
                state: "error",
                detail: `Selected model missing at ${resolvedOptions.modelPath}. Switch to tiny.en or download model assets.`
            });
            return;
        }
        // Check if files are placeholders (too small)
        try {
            const binaryStats = node_fs_1.default.statSync(resolvedOptions.binaryPath);
            const modelStats = node_fs_1.default.statSync(resolvedOptions.modelPath);
            debugSttLog(`[WhisperRunner] File sizes: binary=${binaryStats.size} bytes, model=${modelStats.size} bytes`);
            if (binaryStats.size < MIN_BINARY_SIZE) {
                debugSttLog(`[WhisperRunner] ERROR: Binary too small (${binaryStats.size} bytes)`);
                this.emit("status", {
                    state: "error",
                    detail: `whisper binary is placeholder file. Sales floor mode: Use manual test input.`
                });
                return;
            }
            if (modelStats.size < MIN_MODEL_SIZE) {
                debugSttLog(`[WhisperRunner] ERROR: Model too small (${modelStats.size} bytes)`);
                this.emit("status", {
                    state: "error",
                    detail: `model file is placeholder. Sales floor mode: Use manual test input.`
                });
                return;
            }
            debugSttLog(`[WhisperRunner] File validation passed, starting runner`);
        }
        catch (error) {
            debugSttLog(`[WhisperRunner] ERROR: Failed to validate files:`, error);
            this.emit("status", {
                state: "error",
                detail: `Failed to validate Whisper files. Sales floor mode: Use manual test input.`
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
            debugSttLog(`[WhisperRunner] Processing audio: ${audio.length} bytes, ${this.chunks.length} chunks`);
            const text = await this.runWhisper(audio, this.options);
            this.consecutiveErrors = 0;
            debugSttLog(`[WhisperRunner] Whisper result: "${text}"`);
            this.emitPartial(text);
            this.maybeEmitFinal(text);
        }
        catch (error) {
            this.consecutiveErrors += 1;
            const detail = error instanceof Error ? error.message : "Unknown whisper runner error.";
            debugSttLog(`[WhisperRunner] Error: ${detail}`);
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
            // Use temp wav files for maximum runtime compatibility across Whisper binary variants.
            const tempWavPath = node_path_1.default.join(node_os_1.default.tmpdir(), `tele-coach-window-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`);
            let cleaned = false;
            const cleanup = async () => {
                if (cleaned)
                    return;
                cleaned = true;
                try {
                    await node_fs_1.default.promises.rm(tempWavPath, { force: true });
                }
                catch {
                    // Ignore cleanup failures for temp artifacts.
                }
            };
            const args = [
                "-m",
                options.modelPath,
                "-ng",
                "-nfa",
                "-l",
                "en",
                "--no-timestamps",
                "-f",
                tempWavPath
            ];
            debugSttLog(`[WhisperRunner] Spawning: ${options.binaryPath} with args:`, args);
            this.emit("runtime_launch", {
                binaryPath: options.binaryPath,
                modelPath: options.modelPath,
                args
            });
            let stdout = "";
            let stderr = "";
            let settled = false;
            let child = null;
            const resolveOnce = async (text) => {
                if (settled)
                    return;
                settled = true;
                await cleanup();
                resolve(text);
            };
            const rejectOnce = async (error) => {
                if (settled)
                    return;
                settled = true;
                await cleanup();
                reject(error);
            };
            void (async () => {
                try {
                    const wavBuffer = (0, wav_converter_1.pcm16ToWav)(new Uint8Array(audio));
                    debugSttLog(`[WhisperRunner] WAV conversion: ${audio.length} bytes PCM -> ${wavBuffer.byteLength} bytes WAV`);
                    await node_fs_1.default.promises.writeFile(tempWavPath, Buffer.from(wavBuffer));
                }
                catch (error) {
                    const detail = error instanceof Error ? error.message : "unknown wav write failure";
                    debugSttLog(`[WhisperRunner] WAV write error: ${detail}`);
                    await rejectOnce(new Error(`whisper temp wav write failed: ${detail}`));
                    return;
                }
                child = (0, node_child_process_1.spawn)(options.binaryPath, args, { stdio: ["ignore", "pipe", "pipe"] });
                child.stdout?.on("data", (chunk) => {
                    stdout += chunk.toString();
                });
                child.stderr?.on("data", (chunk) => {
                    stderr += chunk.toString();
                });
                child.once("error", async (err) => {
                    await rejectOnce(new Error(`Failed to launch whisper binary: ${err.message}`));
                });
                child.once("close", async (code, signal) => {
                    this.emit("runtime_exit", {
                        code,
                        signal,
                        stderr: stderr.trim()
                    });
                    if (code !== 0) {
                        await rejectOnce(new Error(`whisper exited with code ${code}. stderr: ${stderr || "empty"}`));
                        return;
                    }
                    const transcript = this.parseWhisperText(stdout);
                    const lowerStdout = stdout.toLowerCase();
                    const lowerStderr = stderr.toLowerCase();
                    const looksLikeHelp = lowerStdout.includes("usage:") ||
                        lowerStdout.includes("--help") ||
                        lowerStdout.includes("options:");
                    const stderrIndicatesError = (lowerStderr.includes("error") || lowerStderr.includes("failed")) &&
                        !lowerStderr.includes("warnings");
                    if (looksLikeHelp || stderrIndicatesError) {
                        await rejectOnce(new Error(`whisper exited 0 but produced invalid transcript output. stdout="${stdout.trim()}" stderr="${stderr.trim()}"`));
                        return;
                    }
                    if (!transcript) {
                        debugSttLog(`[WhisperRunner] Empty transcript window (exit 0). bytes_in=${audio.length} stderr_tail="${stderr.trim().slice(-200)}"`);
                        await resolveOnce("");
                        return;
                    }
                    await resolveOnce(transcript);
                });
            })();
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
