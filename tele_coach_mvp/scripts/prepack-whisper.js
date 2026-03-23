#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const crypto = require("node:crypto");
const { execSync } = require("node:child_process");
const os = require("node:os");
const { getWhisperPolicy } = require("./whisper_delivery_policy");

const projectRoot = path.resolve(__dirname, "..");
const BIN_DIR = path.join(projectRoot, "engine", "stt", "whisper", "bin");
const MODELS_DIR = path.join(projectRoot, "engine", "stt", "whisper", "models");
const REQUEST_TIMEOUT_MS = 60_000;
const MIN_MODEL_SIZE = 70 * 1024 * 1024;
const MIN_BINARY_SIZE = 500 * 1024;

function getPlatformArch() {
  const platform = (process.env.PREPACK_PLATFORM || process.argv[2] || "").toLowerCase();
  const arch = (process.env.PREPACK_ARCH || process.argv[3] || "").toLowerCase();
  if (!platform || !arch) {
    throw new Error("Usage: node scripts/prepack-whisper.js <platform> <arch>");
  }
  const normalizedPlatform = platform === "mac" ? "darwin" : platform === "win" ? "win32" : platform;
  if (normalizedPlatform === "win32" && arch !== "x64") {
    throw new Error("Windows packaging supports x64 only for Whisper artifacts.");
  }
  if (normalizedPlatform === "darwin" && arch !== "x64" && arch !== "arm64") {
    throw new Error("macOS packaging supports x64 and arm64 only for Whisper artifacts.");
  }
  const key =
    normalizedPlatform === "darwin"
      ? `darwin-${arch}`
      : normalizedPlatform === "win32"
        ? "win32-x64"
        : "linux-x64";
  return { platform: normalizedPlatform, arch, key };
}

function download(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "tele-coach-whisper-prepack" } },
      (response) => {
        if ([301, 302, 307, 308].includes(response.statusCode) && response.headers.location) {
          download(response.headers.location).then(resolve).catch(reject);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${url}`));
          return;
        }
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks)));
        response.on("error", reject);
      }
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Timeout downloading ${url}`));
    });
    req.on("error", reject);
  });
}

async function downloadWithRetries(url, retries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await download(url);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }
  throw lastError;
}

function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function resolveModelSource(policy) {
  if (policy.mode === "enterprise") {
    if (!policy.modelEnterprise.url || !policy.modelEnterprise.sha256) {
      throw new Error(
        `Enterprise mode requires ${policy.config.model.enterprise_url_env} and ${policy.config.model.enterprise_sha256_env}.`
      );
    }
    return {
      url: policy.modelEnterprise.url,
      checksum: policy.modelEnterprise.sha256,
      source: "enterprise-internal"
    };
  }
  return {
    url: policy.config.model.upstream_url,
    checksum: policy.config.model.sha256,
    source: "pilot-upstream"
  };
}

function resolveBinarySource(policy) {
  const platformConfig = policy.platformConfig;
  if (policy.mode === "enterprise") {
    if (!policy.binaryEnterprise.url || !policy.binaryEnterprise.sha256) {
      throw new Error(
        `Enterprise mode requires ${platformConfig.enterprise_zip_url_env} and ${platformConfig.enterprise_zip_sha256_env}.`
      );
    }
    return {
      url: policy.binaryEnterprise.url,
      checksum: policy.binaryEnterprise.sha256,
      source: "enterprise-internal"
    };
  }
  if (!platformConfig.upstream_zip_url) {
    if (platformConfig.upstream_build_from_source) {
      return {
        source: "pilot-build-from-source",
        releaseTag: policy.config.binary.release_tag
      };
    }
    if (policy.allowUpstreamFallback && policy.binaryEnterprise.url) {
      return {
        url: policy.binaryEnterprise.url,
        checksum: policy.binaryEnterprise.sha256,
        source: "pilot-internal-fallback"
      };
    }
    throw new Error(
      `No upstream binary is pinned for ${policy.platformKey}. ` +
        `Set ${platformConfig.enterprise_zip_url_env} and TELE_COACH_WHISPER_ALLOW_UPSTREAM_FALLBACK=1.`
    );
  }
  return {
    url: platformConfig.upstream_zip_url,
    checksum: platformConfig.upstream_zip_sha256,
    source: "pilot-upstream"
  };
}

function buildWhisperFromSource(policy, binaryPath) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tele-coach-whisper-src-"));
  const sourceDir = path.join(tmpRoot, "whisper.cpp");
  const buildDir = path.join(sourceDir, "build");
  try {
    execSync(
      `git clone --depth 1 --branch "${policy.config.binary.release_tag}" https://github.com/ggml-org/whisper.cpp "${sourceDir}"`,
      { stdio: "inherit" }
    );
    execSync(
      `cmake -S "${sourceDir}" -B "${buildDir}" -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON`,
      { stdio: "inherit" }
    );
    execSync(`cmake --build "${buildDir}" -j 4`, { stdio: "inherit" });
    const builtBinary = path.join(
      buildDir,
      "bin",
      process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli"
    );
    if (!fs.existsSync(builtBinary)) {
      throw new Error(`Source build completed but binary missing at ${builtBinary}`);
    }
    fs.copyFileSync(builtBinary, binaryPath);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

async function ensureModel(policy) {
  const modelPath = path.join(MODELS_DIR, policy.config.model.file_name);
  if (fs.existsSync(modelPath) && fs.statSync(modelPath).size >= MIN_MODEL_SIZE) {
    console.log("Prepack: model already present and valid");
    return;
  }
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  const source = resolveModelSource(policy);
  const modelBuffer = await downloadWithRetries(source.url, 3);
  const actualSha = sha256Buffer(modelBuffer);
  if (source.checksum && actualSha !== source.checksum) {
    throw new Error(`Model checksum mismatch. expected=${source.checksum} actual=${actualSha}`);
  }
  fs.writeFileSync(modelPath, modelBuffer);
  console.log(`Prepack: model saved to ${modelPath}`);
}

async function ensureBinary(policy) {
  const isWin = policy.platformKey.startsWith("win32");
  const binaryName = policy.platformConfig.runtime_binary_name;
  const binaryPath = path.join(BIN_DIR, binaryName);
  if (fs.existsSync(binaryPath) && fs.statSync(binaryPath).size >= MIN_BINARY_SIZE) {
    console.log(`Prepack: binary already present and valid for ${policy.platformKey}`);
    return;
  }
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const source = resolveBinarySource(policy);
  if (source.source === "pilot-build-from-source") {
    console.log(`Prepack: building Whisper from source tag ${source.releaseTag}...`);
    buildWhisperFromSource(policy, binaryPath);
  } else {
    const zipBuffer = await downloadWithRetries(source.url, 3);
    const actualSha = sha256Buffer(zipBuffer);
    if (source.checksum && actualSha !== source.checksum) {
      throw new Error(`Binary zip checksum mismatch. expected=${source.checksum} actual=${actualSha}`);
    }
    const zipPath = path.join(BIN_DIR, "whisper-binary.zip");
    fs.writeFileSync(zipPath, zipBuffer);
    const tempDir = path.join(os.tmpdir(), `whisper-prepack-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    try {
      execSync(`unzip -o -q "${zipPath}" -d "${tempDir}"`, { stdio: "inherit" });
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
          return fs.existsSync(candidate) && fs.statSync(candidate).size >= MIN_BINARY_SIZE;
        } catch {
          return false;
        }
      });
      if (!extracted) {
        throw new Error("Could not find valid whisper binary in downloaded archive");
      }
      fs.copyFileSync(extracted, binaryPath);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(zipPath, { force: true });
    }
  }
  if (!isWin) fs.chmodSync(binaryPath, 0o755);
  console.log(`Prepack: binary saved to ${binaryPath}`);
}

async function main() {
  const target = getPlatformArch();
  const policy = getWhisperPolicy({ platform: target.platform, arch: target.arch });
  if (policy.platformKey !== target.key) {
    throw new Error(`Policy mismatch: expected ${policy.platformKey}, got ${target.key}`);
  }
  console.log(
    `Prepack: mode=${policy.mode} platform=${policy.platformKey} release=${policy.config.binary.release_tag}`
  );
  await ensureModel(policy);
  await ensureBinary(policy);
  console.log("Prepack: done.");
}

main().catch((error) => {
  console.error(`Prepack failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
