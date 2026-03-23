import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

const MIN_BINARY_SIZE = 500 * 1024;
const MIN_MODEL_SIZE = 70 * 1024 * 1024;
const MODEL_NAME = "ggml-tiny.en.bin";

/**
 * True when running from a packaged app (installer), false in development.
 */
export function isPackaged(): boolean {
  return app.isPackaged;
}

/**
 * Path to the app's resources directory when packaged (where extraResources are placed).
 * Empty string when not packaged.
 */
export function getResourcesPath(): string {
  if (!app.isPackaged) return "";
  return process.resourcesPath ?? "";
}

/**
 * When packaged, returns paths to bundled Whisper binary and model if both exist and pass size checks.
 * Returns null when not packaged or when bundled assets are missing/invalid.
 */
export function getBundledWhisperPaths(): { binaryPath: string; modelPath: string } | null {
  if (!app.isPackaged) return null;
  const resourcesPath = process.resourcesPath;
  if (!resourcesPath) return null;

  const binaryName = process.platform === "win32" ? "whisper.exe" : "whisper";
  const binaryPath = path.join(resourcesPath, "whisper", "bin", binaryName);
  const modelPath = path.join(resourcesPath, "whisper", "models", MODEL_NAME);

  try {
    if (!fs.existsSync(binaryPath) || !fs.existsSync(modelPath)) return null;
    const binaryStat = fs.statSync(binaryPath);
    const modelStat = fs.statSync(modelPath);
    if (binaryStat.size < MIN_BINARY_SIZE || modelStat.size < MIN_MODEL_SIZE) return null;
    return { binaryPath, modelPath };
  } catch {
    return null;
  }
}
