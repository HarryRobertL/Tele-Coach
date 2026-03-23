import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";

const execFileAsync = promisify(execFile);

interface WhisperRuntimeResult {
  binary_exists: boolean;
  model_exists: boolean;
  binary_executable: boolean;
  whisper_process_started: boolean;
  transcript_detected: boolean;
  transcript_preview: string;
  duration_ms: number;
  error: string | null;
}

interface WhisperExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
}

const PROJECT_ROOT = path.resolve(__dirname, "..");
const AIFF_PATH = "/tmp/telecoach_test.aiff";
const WAV_PATH = "/tmp/telecoach_test.wav";
const MAX_RUNTIME_MS = 60_000;
const MIN_MODEL_BYTES = 70 * 1024 * 1024;

function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveBinaryPath(): string {
  const binaryName = process.platform === "win32" ? "whisper.exe" : "whisper";
  const localPath = path.resolve(PROJECT_ROOT, "engine", "stt", "whisper", "bin", binaryName);
  if (fileExists(localPath)) return localPath;
  if (process.platform === "darwin") {
    const userPath = path.join(os.homedir(), "Library", "Application Support", "tele-coach", "whisper", binaryName);
    if (fileExists(userPath)) return userPath;
  }
  return localPath;
}

function resolveModelPath(): string {
  const candidates = ["ggml-tiny.en.bin", "ggml_tiny_en.bin"].map((name) =>
    path.resolve(PROJECT_ROOT, "engine", "stt", "whisper", "models", name)
  );
  for (const candidate of candidates) {
    if (fileExists(candidate)) return candidate;
  }
  return candidates[0];
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function extractTranscript(stdout: string): string {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const cleaned = lines
    .filter((line) => !line.startsWith("whisper_") && !line.startsWith("main:") && !line.startsWith("system_info:"))
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, "").trim())
    .filter((line) => line.length > 0);

  return cleaned.join(" ").replace(/\s+/g, " ").trim();
}

async function ensureSampleAudioExists(): Promise<void> {
  if (fileExists(WAV_PATH)) {
    return;
  }

  await execFileAsync("say", [
    "-o",
    AIFF_PATH,
    "Hello this is a Whisper transcription test"
  ]);

  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    AIFF_PATH,
    "-ar",
    "16000",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    WAV_PATH
  ]);
}

async function runWhisper(args: string[]): Promise<WhisperExecResult> {
  const binaryPath = resolveBinaryPath();
  const startedAt = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(binaryPath, args, {
      timeout: MAX_RUNTIME_MS,
      maxBuffer: 20 * 1024 * 1024
    });
    return {
      stdout,
      stderr,
      exitCode: 0,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? (err.message || ""),
      exitCode: typeof err.code === "number" ? err.code : null,
      durationMs: Date.now() - startedAt
    };
  }
}

async function main(): Promise<void> {
  const binaryPath = resolveBinaryPath();
  const modelPath = resolveModelPath();
  const result: WhisperRuntimeResult = {
    binary_exists: false,
    model_exists: false,
    binary_executable: false,
    whisper_process_started: false,
    transcript_detected: false,
    transcript_preview: "",
    duration_ms: 0,
    error: null
  };

  try {
    // Step 1: resolve and print absolute paths used by the app
    console.log("Whisper binary path:", binaryPath);
    console.log("Whisper model path:", modelPath);

    result.binary_exists = fileExists(binaryPath);
    result.model_exists = fileExists(modelPath);
    result.binary_executable = result.binary_exists && isExecutable(binaryPath);

    if (!result.binary_exists) {
      throw new Error(`Whisper binary does not exist at: ${binaryPath}`);
    }
    if (!result.binary_executable) {
      throw new Error(`Whisper binary is not executable: ${binaryPath}`);
    }
    if (!result.model_exists) {
      throw new Error(`Whisper model does not exist at: ${modelPath}`);
    }

    const modelStat = fs.statSync(modelPath);
    if (modelStat.size <= MIN_MODEL_BYTES) {
      throw new Error(
        `Whisper model is too small (${modelStat.size} bytes). Expected > ${MIN_MODEL_BYTES} bytes.`
      );
    }

    // Step 2: create/generate sample audio
    await ensureSampleAudioExists();
    if (!fileExists(WAV_PATH)) {
      throw new Error(`Sample WAV not found after generation: ${WAV_PATH}`);
    }

    // Step 3: run whisper and capture runtime data
    result.whisper_process_started = true;

    let whisperResult = await runWhisper([
      "-m",
      modelPath,
      "-ng",
      "-nfa",
      "-nt",
      "-f",
      WAV_PATH
    ]);
    let transcript = extractTranscript(whisperResult.stdout);
    let transcriptDetected = transcript.length > 0 && /[a-zA-Z]{3,}/.test(transcript);

    // Compatibility fallback for whisper-cli variants that require -f
    if (!transcriptDetected || whisperResult.exitCode !== 0) {
      const fallback = await runWhisper([
        "-m",
        modelPath,
        "-ng",
        "-nfa",
        "-nt",
        "-l",
        "en",
        "--no-timestamps",
        "-f",
        WAV_PATH
      ]);
      // Prefer fallback only if it improves outcome
      const fallbackTranscript = extractTranscript(fallback.stdout);
      const fallbackDetected =
        fallbackTranscript.length > 0 && /[a-zA-Z]{3,}/.test(fallbackTranscript);
      if (fallbackDetected || fallback.exitCode === 0) {
        whisperResult = fallback;
        transcript = fallbackTranscript;
        transcriptDetected = fallbackDetected;
      }
    }

    result.duration_ms = whisperResult.durationMs;
    result.transcript_detected = transcriptDetected;
    result.transcript_preview = transcript.slice(0, 220);

    console.log("\nWhisper exit code:", whisperResult.exitCode);
    console.log("Whisper duration ms:", whisperResult.durationMs);

    console.log("\nWHISPER TRANSCRIPT:");
    console.log(result.transcript_preview || "(no transcript text extracted)");

    if (whisperResult.stderr.trim().length > 0) {
      console.log("\nWhisper stderr:");
      console.log(whisperResult.stderr.trim());
    }

    // Step 4: strict success validation
    if (!result.transcript_detected) {
      throw new Error("Whisper ran but did not return recognizable transcript text.");
    }
    if (whisperResult.exitCode !== 0) {
      throw new Error(`Whisper exited with non-zero code: ${String(whisperResult.exitCode)}`);
    }
    if (result.duration_ms >= MAX_RUNTIME_MS) {
      throw new Error(`Whisper runtime exceeded ${MAX_RUNTIME_MS}ms (${result.duration_ms}ms).`);
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  // Step 5: structured result
  console.log("\nRUNTIME RESULT:");
  console.log(JSON.stringify(result, null, 2));

  const success =
    result.binary_exists &&
    result.model_exists &&
    result.binary_executable &&
    result.whisper_process_started &&
    result.transcript_detected &&
    result.duration_ms > 0 &&
    result.duration_ms < MAX_RUNTIME_MS &&
    result.error === null;

  process.exit(success ? 0 : 1);
}

void main();

