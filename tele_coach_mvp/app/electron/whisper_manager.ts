import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { isPackaged, getBundledWhisperPaths } from "./packaging";
import { loadWhisperDeliveryPolicy } from "./whisper_delivery";
import type { SttModelOption } from "./sqlite";

export type WhisperStatus = "checking" | "missing" | "downloading" | "verifying" | "ready" | "error";
export interface WhisperStatusEvent {
  status: WhisperStatus;
  progress?: number;
  step?: string;
  error?: string;
}

const MODEL_FILE_CANDIDATES: Record<SttModelOption, string[]> = {
  "tiny.en": ["ggml-tiny.en.bin", "ggml_tiny_en.bin"],
  "base.en": ["ggml-base.en.bin", "ggml_base_en.bin"],
  "small.en": ["ggml-small.en.bin", "ggml_small_en.bin"]
};

const PACKAGED_REINSTALL_MESSAGE =
  "Whisper runtime assets are missing from this packaged app. Reinstall Tele Coach.";
const HEALTH_CHECK_TIMEOUT_MS = 60_000;

export class WhisperManager {
  private readonly policy = loadWhisperDeliveryPolicy();
  private readonly whisperDir: string;
  private readonly useBundledPaths: boolean;
  private binaryPath: string;
  private modelPath: string;
  private status: WhisperStatus = "checking";
  private statusCallback?: (event: WhisperStatusEvent) => void;
  private selectedModel: SttModelOption = "tiny.en";
  private activeModel: SttModelOption = "tiny.en";
  private modelWarning: string | null = null;
  private lastHealthError: string | null = null;

  constructor() {
    const bundled = isPackaged() ? getBundledWhisperPaths() : null;
    this.useBundledPaths = Boolean(bundled);
    this.whisperDir = bundled
      ? path.join(process.resourcesPath, "whisper")
      : path.join(app.getPath("userData"), "whisper");
    this.binaryPath = bundled
      ? bundled.binaryPath
      : path.join(this.whisperDir, this.policy.platform.runtime_binary_name);
    this.modelPath = bundled
      ? bundled.modelPath
      : path.join(this.whisperDir, this.policy.config.model.file_name);
  }

  onStatusChange(callback: (event: WhisperStatusEvent) => void): void {
    this.statusCallback = callback;
  }

  getBinaryPath(): string {
    return this.binaryPath;
  }

  getModelPath(): string {
    return this.modelPath;
  }

  getActiveModel(): SttModelOption {
    return this.activeModel;
  }

  getModelWarning(): string | null {
    return this.modelWarning;
  }

  getStatus(): WhisperStatus {
    return this.status;
  }

  getLastHealthError(): string | null {
    return this.lastHealthError;
  }

  getPolicySummary(): { mode: string; platformKey: string; releaseTag: string } {
    return {
      mode: this.policy.mode,
      platformKey: this.policy.platformKey,
      releaseTag: this.policy.config.binary.release_tag
    };
  }

  async ensureReady(selectedModel: SttModelOption = this.selectedModel): Promise<void> {
    this.selectedModel = selectedModel;
    this.modelWarning = null;
    this.emitStatus({ status: "checking", step: "Checking Whisper installation..." });
    await fs.promises.mkdir(this.whisperDir, { recursive: true });

    const binaryResolved = await this.resolveBinaryPath();
    if (!binaryResolved) {
      this.emitStatus({
        status: this.useBundledPaths ? "error" : "missing",
        error: this.useBundledPaths ? PACKAGED_REINSTALL_MESSAGE : undefined,
        step: this.useBundledPaths
          ? undefined
          : this.missingBinaryGuidance()
      });
      return;
    }
    this.binaryPath = binaryResolved;

    const modelResolved = await this.resolveModelPath(this.selectedModel);
    if (!modelResolved) {
      this.emitStatus({
        status: this.useBundledPaths ? "error" : "missing",
        error: this.useBundledPaths
          ? PACKAGED_REINSTALL_MESSAGE
          : `Model "${this.selectedModel}" missing. Install tiny.en model assets.`,
        step: this.useBundledPaths ? undefined : "Click Download to install Whisper model assets."
      });
      return;
    }
    this.activeModel = modelResolved.model;
    this.modelPath = modelResolved.path;
    this.modelWarning = modelResolved.warning ?? null;

    const summary = this.getPolicySummary();
    this.emitStatus({
      status: "ready",
      step:
        this.modelWarning ??
        `Whisper ready (${this.activeModel}) • mode=${summary.mode} • platform=${summary.platformKey}`
    });
  }

  async install(): Promise<void> {
    this.emitStatus({
      status: "downloading",
      step: `Downloading Whisper components (${this.policy.mode})...`
    });
    await this.downloadAndExtractBinary();
    await this.downloadModel();
    this.emitStatus({ status: "verifying", step: "Verifying Whisper components..." });
    const binaryOk = await this.validateFile(this.binaryPath, this.policy.config.binary.min_size_bytes);
    const modelOk = await this.validateFile(
      path.join(this.whisperDir, this.policy.config.model.file_name),
      this.policy.config.model.min_size_bytes
    );
    if (!binaryOk || !modelOk) {
      throw new Error("Downloaded Whisper components failed file-size verification.");
    }
    await this.ensureReady(this.selectedModel);
  }

  async runStartupHealthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.ensureReady(this.selectedModel);
      if (this.status !== "ready") {
        if (this.useBundledPaths) {
          return { ok: false, error: "Whisper is not ready. Complete setup first." };
        }
        // Auto-remediate missing/corrupt runtime assets before blocking coaching startup.
        await this.install();
        await this.ensureReady(this.selectedModel);
        const statusAfterRemediation = this.getStatus();
        if (statusAfterRemediation !== "ready") {
          return { ok: false, error: "Whisper is not ready. Complete setup first." };
        }
      }
      const ok = await this.runBinaryHealthCheck(this.binaryPath, this.modelPath);
      if (!ok.ok) {
        this.lastHealthError = ok.error ?? "Whisper health check failed.";
        return { ok: false, error: this.lastHealthError };
      }
      this.lastHealthError = null;
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastHealthError = message;
      return { ok: false, error: message };
    }
  }

  private emitStatus(event: WhisperStatusEvent): void {
    this.status = event.status;
    this.statusCallback?.(event);
  }

  private missingBinaryGuidance(): string {
    const platform = this.policy.platformKey;
    if (this.policy.mode === "enterprise") {
      return `Missing enterprise Whisper binary for ${platform}. Set internal artifact env vars and reinstall.`;
    }
    return `Whisper binary missing for ${platform}. Click Download to install pinned assets.`;
  }

  private getModelCandidatePaths(model: SttModelOption): string[] {
    const roots = [
      this.whisperDir,
      path.join(process.cwd(), "engine", "stt", "whisper", "models"),
      path.join(process.resourcesPath || "", "whisper", "models")
    ];
    const seen = new Set<string>();
    for (const root of roots) {
      for (const fileName of MODEL_FILE_CANDIDATES[model]) {
        seen.add(path.join(root, fileName));
      }
    }
    return [...seen];
  }

  private async resolveModelPath(
    selectedModel: SttModelOption
  ): Promise<{ model: SttModelOption; path: string; warning?: string } | null> {
    for (const candidate of this.getModelCandidatePaths(selectedModel)) {
      if (await this.validateFile(candidate, this.policy.config.model.min_size_bytes)) {
        return { model: selectedModel, path: candidate };
      }
    }
    if (selectedModel !== "tiny.en") {
      for (const candidate of this.getModelCandidatePaths("tiny.en")) {
        if (await this.validateFile(candidate, this.policy.config.model.min_size_bytes)) {
          return {
            model: "tiny.en",
            path: candidate,
            warning: `Selected model "${selectedModel}" is unavailable. Falling back to tiny.en.`
          };
        }
      }
    }
    return null;
  }

  private async resolveBinaryPath(): Promise<string | null> {
    const candidates = [
      this.binaryPath,
      path.join(process.cwd(), "engine", "stt", "whisper", "bin", this.policy.platform.runtime_binary_name),
      path.join(process.resourcesPath || "", "whisper", "bin", this.policy.platform.runtime_binary_name)
    ];
    for (const candidate of [...new Set(candidates)]) {
      if (await this.validateFile(candidate, this.policy.config.binary.min_size_bytes)) {
        return candidate;
      }
    }
    return null;
  }

  private async validateFile(filePath: string, minSize: number): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(filePath);
      return stat.size >= minSize;
    } catch {
      return false;
    }
  }

  private async downloadAndExtractBinary(): Promise<void> {
    const binarySource = this.policy.binarySource;
    if (binarySource.source === "pilot-build-from-source") {
      await this.buildBinaryFromSource(binarySource.releaseTag ?? this.policy.config.binary.release_tag);
      return;
    }
    if (!binarySource.url) {
      throw new Error("Whisper binary source URL is missing.");
    }
    const tempZipPath = path.join(this.whisperDir, "whisper-binary.zip");
    await this.downloadWithProgress(binarySource.url, tempZipPath, `Whisper binary (${binarySource.source})`);
    if (binarySource.checksum) {
      const checksumOk = await this.verifyChecksum(tempZipPath, binarySource.checksum);
      if (!checksumOk) {
        await fs.promises.rm(tempZipPath, { force: true });
        throw new Error("Whisper binary zip checksum mismatch.");
      }
    }

    const tempDir = path.join(this.whisperDir, "temp-extract");
    await fs.promises.mkdir(tempDir, { recursive: true });
    try {
      execSync(`unzip -o -q "${tempZipPath}" -d "${tempDir}"`, { stdio: "pipe" });
      const binaryName = this.policy.platform.runtime_binary_name;
      const possiblePaths = [
        path.join(tempDir, binaryName),
        path.join(tempDir, "whisper", binaryName),
        path.join(tempDir, "bin", binaryName),
        path.join(tempDir, "Release", "whisper-cli.exe"),
        path.join(tempDir, "build", "bin", binaryName),
        path.join(tempDir, "src", binaryName)
      ];
      const extracted = possiblePaths.find((candidate) => {
        try {
          return fs.existsSync(candidate) && fs.statSync(candidate).size >= this.policy.config.binary.min_size_bytes;
        } catch {
          return false;
        }
      });
      if (!extracted) {
        throw new Error("Could not locate a valid Whisper CLI executable in the downloaded archive.");
      }
      await fs.promises.copyFile(extracted, this.binaryPath);
      if (process.platform !== "win32") {
        await fs.promises.chmod(this.binaryPath, 0o755);
      }
    } finally {
      await fs.promises.rm(tempZipPath, { force: true });
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  }

  private async buildBinaryFromSource(releaseTag: string): Promise<void> {
    this.emitStatus({
      status: "downloading",
      step: `Building Whisper from source (${releaseTag})...`
    });
    const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tele-coach-whisper-src-"));
    const sourceDir = path.join(tmpRoot, "whisper.cpp");
    const buildDir = path.join(sourceDir, "build");
    try {
      execSync(
        `git clone --depth 1 --branch "${releaseTag}" https://github.com/ggml-org/whisper.cpp "${sourceDir}"`,
        { stdio: "pipe" }
      );
      execSync(
        `cmake -S "${sourceDir}" -B "${buildDir}" -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON`,
        { stdio: "pipe" }
      );
      execSync(`cmake --build "${buildDir}" -j 4`, { stdio: "pipe" });
      const builtBinary = path.join(
        buildDir,
        "bin",
        process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli"
      );
      if (!(await this.validateFile(builtBinary, this.policy.config.binary.min_size_bytes))) {
        throw new Error(`Whisper build succeeded but binary is missing or too small at ${builtBinary}.`);
      }
      await fs.promises.copyFile(builtBinary, this.binaryPath);
      if (process.platform !== "win32") {
        await fs.promises.chmod(this.binaryPath, 0o755);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to build Whisper from source (${releaseTag}). Ensure git + cmake + build tools are installed. ${message}`
      );
    } finally {
      await fs.promises.rm(tmpRoot, { recursive: true, force: true });
    }
  }

  private async downloadModel(): Promise<void> {
    const targetModelPath = path.join(this.whisperDir, this.policy.config.model.file_name);
    await fs.promises.mkdir(path.dirname(targetModelPath), { recursive: true });
    if (!this.policy.modelSource.url) {
      throw new Error("Whisper model source URL is missing.");
    }
    await this.downloadWithProgress(this.policy.modelSource.url, targetModelPath, "Whisper model");
    if (this.policy.modelSource.checksum) {
      const checksumOk = await this.verifyChecksum(targetModelPath, this.policy.modelSource.checksum);
      if (!checksumOk) {
        throw new Error("Whisper model checksum mismatch.");
      }
    }
  }

  private async runBinaryHealthCheck(
    binaryPath: string,
    modelPath: string
  ): Promise<{ ok: boolean; error?: string }> {
    const wavPath = path.join(os.tmpdir(), "tele-coach-whisper-health.wav");
    await fs.promises.writeFile(wavPath, this.buildHealthWavBuffer());
    return await new Promise((resolve) => {
      // Force CPU path for health check to avoid GPU/driver-specific startup stalls.
      const args = ["-m", modelPath, "-ng", "-nfa", "-l", "en", "--no-timestamps", "-f", wavPath];
      const child = spawn(binaryPath, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      let timeout = false;
      const timer = setTimeout(() => {
        timeout = true;
        child.kill("SIGKILL");
      }, HEALTH_CHECK_TIMEOUT_MS);
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.once("error", (err) => {
        clearTimeout(timer);
        resolve({ ok: false, error: `Failed to launch Whisper health check: ${err.message}` });
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (timeout) {
          resolve({
            ok: false,
            error: `Whisper health check timed out after ${Math.round(HEALTH_CHECK_TIMEOUT_MS / 1000)}s.`
          });
          return;
        }
        if (code !== 0) {
          resolve({
            ok: false,
            error: `Whisper health check exited with code ${String(code)}. stderr=${stderr.trim()}`
          });
          return;
        }
        resolve({ ok: true });
      });
    });
  }

  private buildHealthWavBuffer(): Buffer {
    const sampleRate = 16_000;
    const durationMs = 500;
    const totalSamples = Math.floor((sampleRate * durationMs) / 1000);
    const pcm = Buffer.alloc(totalSamples * 2);
    for (let i = 0; i < totalSamples; i += 1) {
      const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.12;
      pcm.writeInt16LE(Math.round(sample * 32767), i * 2);
    }
    const dataSize = pcm.length;
    const header = Buffer.alloc(44);
    header.write("RIFF", 0, 4, "ascii");
    header.writeUInt32LE(36 + dataSize, 4);
    header.write("WAVE", 8, 4, "ascii");
    header.write("fmt ", 12, 4, "ascii");
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36, 4, "ascii");
    header.writeUInt32LE(dataSize, 40);
    return Buffer.concat([header, pcm]);
  }

  private async downloadWithProgress(
    url: string,
    filePath: string,
    description: string,
    maxRetries = 3
  ): Promise<void> {
    const maxContentLength = 200 * 1024 * 1024;
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        await fs.promises.rm(filePath, { force: true });
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 300_000);
        const response = await fetch(url, {
          method: "GET",
          signal: controller.signal
        }).finally(() => {
          clearTimeout(timeoutId);
        });
        if (!response.ok) {
          throw new Error(`Download failed with status ${response.status} ${response.statusText}`);
        }
        const contentLengthHeader = response.headers.get("content-length");
        const totalLength = Number(contentLengthHeader || "0");
        if (totalLength > maxContentLength) {
          throw new Error(
            `Download exceeds max size (${Math.round(maxContentLength / (1024 * 1024))}MB).`
          );
        }
        if (!response.body) {
          throw new Error("Download response body is empty.");
        }
        let downloadedLength = 0;
        const writer = createWriteStream(filePath);
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            downloadedLength += value.byteLength;
            if (downloadedLength > maxContentLength) {
              throw new Error(
                `Download exceeds max size (${Math.round(maxContentLength / (1024 * 1024))}MB).`
              );
            }
            if (totalLength > 0) {
              const progress = Math.round((downloadedLength / totalLength) * 100);
              this.emitStatus({
                status: "downloading",
                progress,
                step: `${description} (${progress}%)`
              });
            }
            if (!writer.write(Buffer.from(value))) {
              await once(writer, "drain");
            }
          }
          await new Promise<void>((resolve, reject) => {
            writer.end((err?: Error | null) => (err ? reject(err) : resolve()));
          });
        } catch (error) {
          writer.destroy();
          throw error;
        } finally {
          reader.releaseLock();
        }
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        await fs.promises.rm(filePath, { force: true });
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        }
      }
    }
    throw lastError ?? new Error(`Failed to download ${description}`);
  }

  private async verifyChecksum(filePath: string, expectedSha256: string): Promise<boolean> {
    const actualSha256 = await this.calculateSha256(filePath);
    return actualSha256 === expectedSha256;
  }

  private async calculateSha256(filePath: string): Promise<string> {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    for await (const chunk of stream) {
      hash.update(chunk);
    }
    return hash.digest("hex");
  }
}

export const whisperManager = new WhisperManager();
