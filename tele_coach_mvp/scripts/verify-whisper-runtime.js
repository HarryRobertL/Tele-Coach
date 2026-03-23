#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { getWhisperPolicy } = require("./whisper_delivery_policy");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const BIN_NAMES = process.platform === "win32"
  ? ["whisper.exe", "whisper-cli.exe", "whisper-cpp.exe"]
  : ["whisper", "whisper-cli", "whisper-cpp"];
const MODEL_FILE_CANDIDATES = {
  "tiny.en": ["ggml-tiny.en.bin", "ggml_tiny_en.bin"],
  "base.en": ["ggml-base.en.bin", "ggml_base_en.bin"],
  "small.en": ["ggml-small.en.bin", "ggml_small_en.bin"]
};
const MODEL_MIN_SIZE = {
  "tiny.en": 70 * 1024 * 1024,
  "base.en": 130 * 1024 * 1024,
  "small.en": 430 * 1024 * 1024
};
const MIN_BINARY_SIZE = 500 * 1024;
const TIMEOUT_MS = 20_000;

function parseWhisperText(raw) {
  return raw
    .split("\n")
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, "").trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferSelectedModel() {
  const dbPath = path.join(PROJECT_ROOT, "data", "app.sqlite");
  if (!fs.existsSync(dbPath)) return "tiny.en";
  try {
    const Database = require("better-sqlite3");
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const row = db
      .prepare("SELECT value FROM app_settings WHERE key = 'stt_model'")
      .get();
    db.close();
    if (!row || typeof row.value !== "string") return "tiny.en";
    const parsed = JSON.parse(row.value);
    return parsed === "base.en" || parsed === "small.en" ? parsed : "tiny.en";
  } catch {
    return "tiny.en";
  }
}

function resolveUserWhisperDirs() {
  const dirs = [];
  if (process.platform === "darwin") {
    dirs.push(
      path.join(os.homedir(), "Library", "Application Support", "tele-coach", "whisper"),
      path.join(os.homedir(), "Library", "Application Support", "Tele Coach", "whisper")
    );
  } else if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    dirs.push(
      path.join(appData, "tele-coach", "whisper"),
      path.join(appData, "Tele Coach", "whisper")
    );
  } else {
    dirs.push(path.join(os.homedir(), ".config", "tele-coach", "whisper"));
  }
  return dirs;
}

function existingFile(paths) {
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function resolveBinaryPath() {
  const policy = getWhisperPolicy();
  const primaryName = policy.platformConfig.runtime_binary_name;
  const candidates = [];
  const userDirs = resolveUserWhisperDirs();
  for (const dir of userDirs) {
    candidates.push(path.join(dir, primaryName));
  }
  candidates.push(path.join(PROJECT_ROOT, "engine", "stt", "whisper", "bin", primaryName));
  return existingFile(candidates);
}

function resolveModelPath(selectedModel) {
  const allModelOptions = [selectedModel, "tiny.en"];
  const seen = new Set();
  const candidates = [];
  const userDirs = resolveUserWhisperDirs();
  const roots = [
    ...userDirs,
    path.join(PROJECT_ROOT, "engine", "stt", "whisper", "models")
  ];
  for (const option of allModelOptions) {
    const names = MODEL_FILE_CANDIDATES[option] || MODEL_FILE_CANDIDATES["tiny.en"];
    for (const root of roots) {
      for (const name of names) {
        const full = path.join(root, name);
        if (!seen.has(full)) {
          seen.add(full);
          candidates.push(full);
        }
      }
    }
  }
  const minModelSize = MODEL_MIN_SIZE[selectedModel] ?? MODEL_MIN_SIZE["tiny.en"];
  for (const candidate of candidates) {
    try {
      const stats = fs.statSync(candidate);
      if (stats.size >= minModelSize) return candidate;
    } catch {
      // ignore
    }
  }
  return null;
}

function isExecutable(binaryPath) {
  try {
    if (process.platform === "win32") return true;
    fs.accessSync(binaryPath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isLikelyMachO(binaryPath) {
  if (process.platform !== "darwin") return true;
  try {
    const fd = fs.openSync(binaryPath, "r");
    const buf = Buffer.allocUnsafe(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    const magic = buf.readUInt32BE(0);
    const machoMagics = new Set([0xfeedface, 0xfeedfacf, 0xcafebabe, 0xcffaedfe]);
    return machoMagics.has(magic);
  } catch {
    return false;
  }
}

function isLikelyPE(binaryPath) {
  if (process.platform !== "win32") return true;
  try {
    const fd = fs.openSync(binaryPath, "r");
    const buf = Buffer.allocUnsafe(2);
    fs.readSync(fd, buf, 0, 2, 0);
    fs.closeSync(fd);
    return buf[0] === 0x4d && buf[1] === 0x5a; // MZ
  } catch {
    return false;
  }
}

function shouldSkipDir(name) {
  return name === "node_modules" || name === ".git" || name === "dist" || name === "release";
}

function findSampleWav(startDir) {
  const stack = [startDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) stack.push(full);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".wav")) {
        return full;
      }
    }
  }
  return null;
}

function runRealTranscription(binaryPath, modelPath, samplePath) {
  const tempSamplePath = path.join(
    os.tmpdir(),
    `tele-coach-whisper-runtime-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`
  );
  fs.copyFileSync(samplePath, tempSamplePath);
  const expectedTranscriptPath = `${tempSamplePath}.txt`;
  const args = ["-m", modelPath, "-l", "en", "--output-txt", "--no-timestamps", "-f", tempSamplePath];
  const startedAt = Date.now();
  const cleanup = () => {
    try {
      fs.rmSync(tempSamplePath, { force: true });
    } catch {
      // ignore cleanup errors
    }
    try {
      fs.rmSync(expectedTranscriptPath, { force: true });
    } catch {
      // ignore cleanup errors
    }
  };
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let launchOk = false;
    let settled = false;
    const child = spawn(binaryPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      cleanup();
      resolve({
        launchOk,
        transcriptOk: false,
        outputHasTranscript: false,
        stdout,
        stderr,
        exitCode: null,
        durationMs: Date.now() - startedAt,
        command: `${binaryPath} ${args.map((a) => JSON.stringify(a)).join(" ")}`
      });
    }, TIMEOUT_MS);
    child.once("spawn", () => {
      launchOk = true;
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stderr += `\nspawn_error: ${err.message}`;
      cleanup();
      resolve({
        launchOk: false,
        transcriptOk: false,
        outputHasTranscript: false,
        stdout,
        stderr,
        exitCode: null,
        durationMs: Date.now() - startedAt,
        command: `${binaryPath} ${args.map((a) => JSON.stringify(a)).join(" ")}`
      });
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      let transcript = "";
      let outputFileExists = false;
      let outputFileBytes = 0;
      if (fs.existsSync(expectedTranscriptPath)) {
        outputFileExists = true;
        try {
          const rawOutput = fs.readFileSync(expectedTranscriptPath, "utf8");
          outputFileBytes = Buffer.byteLength(rawOutput, "utf8");
          transcript = parseWhisperText(rawOutput);
        } catch {
          transcript = "";
        }
      }
      if (!transcript) {
        transcript = parseWhisperText(stdout);
      }
      const looksLikeHelp = /usage:|--help|options:/i.test(stdout + "\n" + stderr);
      const outputHasTranscript = transcript.length > 0 && !looksLikeHelp;
      const runtimeCompleted = code === 0 && outputFileExists && !looksLikeHelp;
      cleanup();
      resolve({
        launchOk,
        transcriptOk: runtimeCompleted,
        outputHasTranscript,
        outputFileExists,
        outputFileBytes,
        transcriptPreview: transcript.slice(0, 200),
        stdout,
        stderr,
        exitCode: code,
        durationMs: Date.now() - startedAt,
        command: `${binaryPath} ${args.map((a) => JSON.stringify(a)).join(" ")}`
      });
    });
  });
}

async function main() {
  const policy = getWhisperPolicy();
  const selectedModel = inferSelectedModel();
  const binaryPath = resolveBinaryPath();
  const modelPath = resolveModelPath(selectedModel);
  const samplePath = findSampleWav(PROJECT_ROOT);

  const binaryFound = Boolean(binaryPath);
  const binaryExecutable = binaryPath ? isExecutable(binaryPath) : false;
  const binaryRealistic = binaryPath
    ? fs.statSync(binaryPath).size >= MIN_BINARY_SIZE
    : false;
  const binaryLooksReal = binaryPath ? isLikelyMachO(binaryPath) : false;
  const binaryLooksPE = binaryPath ? isLikelyPE(binaryPath) : false;
  const modelFound = Boolean(modelPath);
  const modelRealistic = modelPath
    ? fs.statSync(modelPath).size >= (MODEL_MIN_SIZE[selectedModel] ?? MODEL_MIN_SIZE["tiny.en"])
    : false;

  let runtime = {
    launchOk: false,
    transcriptOk: false,
    outputHasTranscript: false,
    outputFileExists: false,
    outputFileBytes: 0,
    exitCode: null,
    durationMs: 0,
    stderr: "",
    stdout: "",
    command: ""
  };

  if (
    binaryFound &&
    binaryExecutable &&
    binaryRealistic &&
    binaryLooksPE &&
    modelFound &&
    modelRealistic &&
    samplePath
  ) {
    runtime = await runRealTranscription(binaryPath, modelPath, samplePath);
  }

  console.log("\nWhisper Runtime Verification");
  console.log("============================");
  console.log(`Delivery mode: ${policy.mode}`);
  console.log(`Platform key: ${policy.platformKey}`);
  console.log(`Pinned binary release: ${policy.config.binary.release_tag}`);
  console.log(`Selected model setting: ${selectedModel}`);
  console.log(`Resolved binary path: ${binaryPath || "not found"}`);
  console.log(`Resolved model path: ${modelPath || "not found"}`);
  console.log(`Sample wav path: ${samplePath || "not found"}`);
  if (!samplePath) {
    console.log(
      "Missing sample audio: add a WAV file (for example `test_audio.wav` at repo root) for real runtime transcription verification."
    );
  }
  if (runtime.command) {
    console.log(`Runtime command: ${runtime.command}`);
  }

  console.log("\nSummary");
  console.log(`Binary found: ${binaryFound ? "yes" : "no"}`);
  console.log(`Executable: ${binaryExecutable ? "yes" : "no"}`);
  console.log(`Binary realistic size: ${binaryRealistic ? "yes" : "no"}`);
  if (process.platform === "darwin") {
    console.log(`Likely macOS executable (Mach-O): ${binaryLooksReal ? "yes" : "no"}`);
  }
  if (process.platform === "win32") {
    console.log(`Likely Windows executable (PE): ${binaryLooksPE ? "yes" : "no"}`);
  }
  console.log(`Model found: ${modelFound ? "yes" : "no"}`);
  console.log(`Model realistic size: ${modelRealistic ? "yes" : "no"}`);
  console.log(`Real transcription ran: ${runtime.launchOk ? "yes" : "no"}`);
  console.log(`Output file created: ${runtime.outputFileExists ? "yes" : "no"}`);
  console.log(`Output file size bytes: ${runtime.outputFileBytes}`);
  console.log(`Output contained transcript text: ${runtime.outputHasTranscript ? "yes" : "no"}`);
  console.log(`Exit code: ${runtime.exitCode === null ? "null" : String(runtime.exitCode)}`);
  console.log(`Duration ms: ${runtime.durationMs}`);
  if (runtime.stderr) {
    console.log(`stderr: ${runtime.stderr.trim()}`);
  }

  const pass = Boolean(
    binaryFound &&
      binaryExecutable &&
      binaryRealistic &&
      binaryLooksPE &&
      (process.platform !== "darwin" || binaryLooksReal) &&
      modelFound &&
      modelRealistic &&
      samplePath &&
      runtime.transcriptOk
  );
  process.exit(pass ? 0 : 1);
}

main().catch((error) => {
  console.error(`verify-whisper-runtime failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
