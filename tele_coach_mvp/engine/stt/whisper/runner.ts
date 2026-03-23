import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pcm16ToWav } from "../wav_converter";

let debugSttEnabled =
  process.env.DEBUG_STT === "1" || process.env.DEBUG_STT === "true";
const MIN_BINARY_SIZE = 500 * 1024;
const MIN_MODEL_SIZE = 70 * 1024 * 1024;

export function setWhisperDebugLogging(enabled: boolean): void {
  debugSttEnabled = enabled;
}

function debugSttLog(message: string, ...args: unknown[]): void {
  if (!debugSttEnabled) return;
  console.log(message, ...args);
}

export interface WhisperRunnerOptions {
  binaryPath: string;
  modelPath: string;
  rollingWindowMs?: number;
  partialCadenceMs?: number;
  fallbackCadenceMs?: number;
  finalCadenceMs?: number;
  fallbackMode?: boolean;
}

export interface AudioChunkPayload {
  pcm16: Uint8Array;
  sampleRate: 16000;
  channels: 1;
  frameMs: 200;
  rms: number;
}

export type RunnerStatus = "loading_model" | "running" | "stopped" | "error";

export interface RunnerStatusEvent {
  state: RunnerStatus;
  detail?: string;
}

export interface RunnerPartialEvent {
  text: string;
  tsMs: number;
}

export interface RunnerFinalEvent {
  text: string;
  tsMs: number;
}

interface WhisperRuntimeLaunchEvent {
  binaryPath: string;
  modelPath: string;
  args: string[];
}

interface WhisperRuntimeExitEvent {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}

export class WhisperRunner extends EventEmitter {
  private options: Required<WhisperRunnerOptions> | null = null;
  private windowBytes = 0;
  private readonly chunks: Buffer[] = [];
  private partialTimer: NodeJS.Timeout | null = null;
  private running = false;
  private busy = false;
  private fallbackActive = false;
  private consecutiveErrors = 0;
  private lastPartialText = "";
  private lastFinalText = "";
  private lastFinalEmitAt = 0;

  start(options: WhisperRunnerOptions): void {
    if (this.running) return;
    const resolvedOptions: Required<WhisperRunnerOptions> = {
      rollingWindowMs: options.rollingWindowMs ?? 12000,
      partialCadenceMs: options.partialCadenceMs ?? 500,
      fallbackCadenceMs: options.fallbackCadenceMs ?? 2000,
      finalCadenceMs: options.finalCadenceMs ?? 2500,
      fallbackMode: options.fallbackMode ?? false,
      binaryPath: path.resolve(options.binaryPath),
      modelPath: path.resolve(options.modelPath)
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
      detail: `Loading Whisper model: ${path.basename(resolvedOptions.modelPath)}`
    } satisfies RunnerStatusEvent);

    if (!fs.existsSync(resolvedOptions.binaryPath)) {
      debugSttLog(`[WhisperRunner] ERROR: Binary missing at ${resolvedOptions.binaryPath}`);
      this.emit("status", {
        state: "error",
        detail: `whisper binary missing at ${resolvedOptions.binaryPath}. Sales floor mode: Use manual test input.`
      } satisfies RunnerStatusEvent);
      return;
    }
    if (!fs.existsSync(resolvedOptions.modelPath)) {
      debugSttLog(`[WhisperRunner] ERROR: Model missing at ${resolvedOptions.modelPath}`);
      this.emit("status", {
        state: "error",
        detail: `Selected model missing at ${resolvedOptions.modelPath}. Switch to tiny.en or download model assets.`
      } satisfies RunnerStatusEvent);
      return;
    }

    // Check if files are placeholders (too small)
    try {
      const binaryStats = fs.statSync(resolvedOptions.binaryPath);
      const modelStats = fs.statSync(resolvedOptions.modelPath);
      debugSttLog(`[WhisperRunner] File sizes: binary=${binaryStats.size} bytes, model=${modelStats.size} bytes`);
      
      if (binaryStats.size < MIN_BINARY_SIZE) {
        debugSttLog(`[WhisperRunner] ERROR: Binary too small (${binaryStats.size} bytes)`);
        this.emit("status", {
          state: "error",
          detail: `whisper binary is placeholder file. Sales floor mode: Use manual test input.`
        } satisfies RunnerStatusEvent);
        return;
      }
      
      if (modelStats.size < MIN_MODEL_SIZE) {
        debugSttLog(`[WhisperRunner] ERROR: Model too small (${modelStats.size} bytes)`);
        this.emit("status", {
          state: "error",
          detail: `model file is placeholder. Sales floor mode: Use manual test input.`
        } satisfies RunnerStatusEvent);
        return;
      }
      
      debugSttLog(`[WhisperRunner] File validation passed, starting runner`);
    } catch (error) {
      debugSttLog(`[WhisperRunner] ERROR: Failed to validate files:`, error);
      this.emit("status", {
        state: "error",
        detail: `Failed to validate Whisper files. Sales floor mode: Use manual test input.`
      } satisfies RunnerStatusEvent);
      return;
    }

    this.running = true;
    this.emit("status", {
      state: "running",
      detail: this.fallbackActive
        ? "Fallback mode active: transcribing every 2 seconds."
        : "Streaming mode active: ~500ms partial cadence."
    } satisfies RunnerStatusEvent);
    this.scheduleCadence();
  }

  ingestAudioChunk(chunk: AudioChunkPayload): void {
    if (!this.running || !this.options) return;
    const next = Buffer.from(chunk.pcm16);
    this.chunks.push(next);
    this.windowBytes += next.length;
    const maxBytes = this.maxWindowBytes(this.options.rollingWindowMs, chunk.sampleRate, chunk.channels);
    while (this.windowBytes > maxBytes && this.chunks.length > 0) {
      const removed = this.chunks.shift();
      this.windowBytes -= removed?.length ?? 0;
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.partialTimer) {
      clearInterval(this.partialTimer);
      this.partialTimer = null;
    }
    this.chunks.length = 0;
    this.windowBytes = 0;
    this.busy = false;
    this.emit("status", { state: "stopped", detail: "STT runner stopped." } satisfies RunnerStatusEvent);
  }

  private scheduleCadence(): void {
    if (!this.options) return;
    const cadence = this.fallbackActive ? this.options.fallbackCadenceMs : this.options.partialCadenceMs;
    if (this.partialTimer) {
      clearInterval(this.partialTimer);
      this.partialTimer = null;
    }
    this.partialTimer = setInterval(() => {
      void this.transcribeWindow();
    }, cadence);
  }

  private maxWindowBytes(windowMs: number, sampleRate: number, channels: number): number {
    const samples = Math.floor((windowMs / 1000) * sampleRate);
    return samples * channels * 2;
  }

  private async transcribeWindow(): Promise<void> {
    if (!this.running || !this.options || this.busy) return;
    if (this.windowBytes === 0) return;

    this.busy = true;
    try {
      const audio = Buffer.concat(this.chunks);
      debugSttLog(`[WhisperRunner] Processing audio: ${audio.length} bytes, ${this.chunks.length} chunks`);
      
      const text = await this.runWhisper(audio, this.options);
      this.consecutiveErrors = 0;
      debugSttLog(`[WhisperRunner] Whisper result: "${text}"`);
      this.emitPartial(text);
      this.maybeEmitFinal(text);
    } catch (error) {
      this.consecutiveErrors += 1;
      const detail = error instanceof Error ? error.message : "Unknown whisper runner error.";
      debugSttLog(`[WhisperRunner] Error: ${detail}`);
      this.emit("status", { state: "error", detail } satisfies RunnerStatusEvent);
      if (!this.fallbackActive && this.consecutiveErrors >= 3) {
        this.fallbackActive = true;
        this.scheduleCadence();
        this.emit("status", {
          state: "running",
          detail: "Switched to fallback mode: transcribing every 2 seconds."
        } satisfies RunnerStatusEvent);
      }
    } finally {
      this.busy = false;
    }
  }

  private runWhisper(audio: Buffer, options: Required<WhisperRunnerOptions>): Promise<string> {
    return new Promise((resolve, reject) => {
      // Use temp wav files for maximum runtime compatibility across Whisper binary variants.
      const tempWavPath = path.join(
        os.tmpdir(),
        `tele-coach-window-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`
      );
      let cleaned = false;
      const cleanup = async (): Promise<void> => {
        if (cleaned) return;
        cleaned = true;
        try {
          await fs.promises.rm(tempWavPath, { force: true });
        } catch {
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
      } satisfies WhisperRuntimeLaunchEvent);

      let stdout = "";
      let stderr = "";
      let settled = false;
      let child: ReturnType<typeof spawn> | null = null;

      const resolveOnce = async (text: string) => {
        if (settled) return;
        settled = true;
        await cleanup();
        resolve(text);
      };
      const rejectOnce = async (error: Error) => {
        if (settled) return;
        settled = true;
        await cleanup();
        reject(error);
      };

      void (async () => {
        try {
          const wavBuffer = pcm16ToWav(new Uint8Array(audio));
          debugSttLog(
            `[WhisperRunner] WAV conversion: ${audio.length} bytes PCM -> ${wavBuffer.byteLength} bytes WAV`
          );
          await fs.promises.writeFile(tempWavPath, Buffer.from(wavBuffer));
        } catch (error) {
          const detail = error instanceof Error ? error.message : "unknown wav write failure";
          debugSttLog(`[WhisperRunner] WAV write error: ${detail}`);
          await rejectOnce(new Error(`whisper temp wav write failed: ${detail}`));
          return;
        }

        child = spawn(options.binaryPath, args, { stdio: ["ignore", "pipe", "pipe"] });
        child.stdout?.on("data", (chunk: Buffer | string) => {
          stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk: Buffer | string) => {
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
          } satisfies WhisperRuntimeExitEvent);
          if (code !== 0) {
            await rejectOnce(
              new Error(`whisper exited with code ${code}. stderr: ${stderr || "empty"}`)
            );
            return;
          }
          const transcript = this.parseWhisperText(stdout);
          const lowerStdout = stdout.toLowerCase();
          const lowerStderr = stderr.toLowerCase();
          const looksLikeHelp =
            lowerStdout.includes("usage:") ||
            lowerStdout.includes("--help") ||
            lowerStdout.includes("options:");
          const stderrIndicatesError =
            (lowerStderr.includes("error") || lowerStderr.includes("failed")) &&
            !lowerStderr.includes("warnings");
          if (looksLikeHelp || stderrIndicatesError) {
            await rejectOnce(
              new Error(
                `whisper exited 0 but produced invalid transcript output. stdout="${stdout.trim()}" stderr="${stderr.trim()}"`
              )
            );
            return;
          }
          if (!transcript) {
            debugSttLog(
              `[WhisperRunner] Empty transcript window (exit 0). bytes_in=${audio.length} stderr_tail="${stderr.trim().slice(-200)}"`
            );
            await resolveOnce("");
            return;
          }
          await resolveOnce(transcript);
        });
      })();
    });
  }

  private parseWhisperText(raw: string): string {
    return raw
      .split("\n")
      .map((line) => line.replace(/^\[[^\]]+\]\s*/, "").trim())
      .filter((line) => line.length > 0)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private emitPartial(text: string): void {
    if (!text || text === this.lastPartialText) return;
    this.lastPartialText = text;
    this.emit("partial", { text, tsMs: Date.now() } satisfies RunnerPartialEvent);
  }

  private maybeEmitFinal(text: string): void {
    if (!text) return;
    const now = Date.now();
    const phraseBoundary = /[.!?]\s*$/.test(text);
    const cadenceBoundary = now - this.lastFinalEmitAt >= (this.options?.finalCadenceMs ?? 2500);
    if ((phraseBoundary || cadenceBoundary) && text !== this.lastFinalText) {
      this.lastFinalText = text;
      this.lastFinalEmitAt = now;
      this.emit("final", { text, tsMs: now } satisfies RunnerFinalEvent);
    }
  }
}
