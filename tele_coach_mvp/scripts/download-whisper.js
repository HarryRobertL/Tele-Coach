#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { execSync } = require("node:child_process");
const os = require("node:os");
const crypto = require("node:crypto");
const { getWhisperPolicy } = require("./whisper_delivery_policy");

const WHISPER_DIR = path.join(__dirname, "..", "engine", "stt", "whisper");
const BIN_DIR = path.join(WHISPER_DIR, "bin");
const MODELS_DIR = path.join(WHISPER_DIR, "models");
const MIN_BINARY_SIZE = 500 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const DOWNLOAD_RETRIES = 3;

function downloadFile(url, filePath, attempt = 1) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    const req = https.get(
      url,
      { headers: { "User-Agent": "tele-coach-whisper-setup" } },
      (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          file.close();
          fs.rmSync(filePath, { force: true });
          downloadFile(res.headers.location, filePath, attempt).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.rmSync(filePath, { force: true });
          reject(new Error(`Failed to download ${url}: ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close(() => resolve());
        });
      }
    );
    req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
      req.destroy(new Error(`Download timeout for ${url}`));
    });
    req.on("error", (err) => {
      file.close(() => {
        fs.rmSync(filePath, { force: true });
        if (attempt < DOWNLOAD_RETRIES) {
          setTimeout(() => {
            downloadFile(url, filePath, attempt + 1).then(resolve).catch(reject);
          }, attempt * 1000);
          return;
        }
        reject(err);
      });
    });
  });
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
}

function ensureFileSize(filePath, minSize) {
  const stats = fs.statSync(filePath);
  if (stats.size < minSize) {
    throw new Error(
      `File too small: ${filePath} has ${stats.size} bytes (minimum ${minSize})`
    );
  }
}

function resolveModelSource(policy) {
  const model = policy.config.model;
  if (policy.mode === "enterprise") {
    if (!policy.modelEnterprise.url) {
      throw new Error(
        `Enterprise mode requires ${model.enterprise_url_env} to be set to an internal model URL.`
      );
    }
    if (!policy.modelEnterprise.sha256) {
      throw new Error(
        `Enterprise mode requires ${model.enterprise_sha256_env} to be set for model integrity verification.`
      );
    }
    return {
      url: policy.modelEnterprise.url,
      checksum: policy.modelEnterprise.sha256,
      source: "enterprise-internal"
    };
  }
  return {
    url: model.upstream_url,
    checksum: model.sha256,
    source: "pilot-upstream"
  };
}

function resolveBinarySource(policy) {
  const platformConfig = policy.platformConfig;
  const enterpriseUrl = policy.binaryEnterprise.url;
  const enterpriseSha = policy.binaryEnterprise.sha256;
  if (policy.mode === "enterprise") {
    if (!enterpriseUrl) {
      throw new Error(
        `Enterprise mode requires ${platformConfig.enterprise_zip_url_env} for ${policy.platformKey}.`
      );
    }
    if (!enterpriseSha) {
      throw new Error(
        `Enterprise mode requires ${platformConfig.enterprise_zip_sha256_env} for ${policy.platformKey}.`
      );
    }
    return { url: enterpriseUrl, checksum: enterpriseSha, source: "enterprise-internal" };
  }
  if (!platformConfig.upstream_zip_url) {
    if (platformConfig.upstream_build_from_source) {
      return {
        source: "pilot-build-from-source",
        releaseTag: policy.config.binary.release_tag
      };
    }
    if (policy.allowUpstreamFallback && enterpriseUrl) {
      return {
        url: enterpriseUrl,
        checksum: enterpriseSha,
        source: "pilot-internal-fallback"
      };
    }
    throw new Error(
      `No upstream binary is pinned for ${policy.platformKey}. ` +
        `Provide ${platformConfig.enterprise_zip_url_env} and enable TELE_COACH_WHISPER_ALLOW_UPSTREAM_FALLBACK=1, ` +
        `or switch to enterprise mode with internal artifacts.`
    );
  }
  return {
    url: platformConfig.upstream_zip_url,
    checksum: platformConfig.upstream_zip_sha256 || undefined,
    source: "pilot-upstream"
  };
}

function buildWhisperFromSource(policy, finalBinaryPath) {
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
    const builtBinary = path.join(buildDir, "bin", process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli");
    if (!fs.existsSync(builtBinary)) {
      throw new Error(`Source build completed but binary missing at ${builtBinary}`);
    }
    fs.copyFileSync(builtBinary, finalBinaryPath);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function extractZipAndInstallBinary(zipPath, finalBinaryPath) {
  const tempDir = path.join(os.tmpdir(), `whisper-extract-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });
  try {
    execSync(`unzip -o -q "${zipPath}" -d "${tempDir}"`, { stdio: "inherit" });
    const candidateNames =
      process.platform === "win32"
        ? ["whisper.exe", "whisper-cli.exe", "whisper-cpp.exe"]
        : ["whisper", "whisper-cli", "whisper-cpp"];
    const possiblePaths = [];
    for (const binName of candidateNames) {
      possiblePaths.push(
        path.join(tempDir, binName),
        path.join(tempDir, "whisper", binName),
        path.join(tempDir, "bin", binName),
        path.join(tempDir, "build", "bin", binName),
        path.join(tempDir, "src", binName),
        path.join(tempDir, "Release", binName)
      );
    }
    const extracted = possiblePaths.find((p) => {
      if (!fs.existsSync(p)) return false;
      try {
        return fs.statSync(p).size >= MIN_BINARY_SIZE;
      } catch {
        return false;
      }
    });
    if (!extracted) {
      throw new Error("Could not find a valid whisper CLI binary in downloaded archive.");
    }
    fs.copyFileSync(extracted, finalBinaryPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function downloadWhisper() {
  const policy = getWhisperPolicy();
  const modelConfig = policy.config.model;
  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  const modelSource = resolveModelSource(policy);
  const binarySource = resolveBinarySource(policy);
  console.log(
    `Whisper setup mode=${policy.mode} platform=${policy.platformKey} release=${policy.config.binary.release_tag}`
  );

  const modelPath = path.join(MODELS_DIR, modelConfig.file_name);
  console.log(`Downloading model from ${modelSource.source}: ${modelSource.url}`);
  await downloadFile(modelSource.url, modelPath);
  ensureFileSize(modelPath, modelConfig.min_size_bytes);
  if (modelSource.checksum) {
    const actual = sha256(modelPath);
    if (actual !== modelSource.checksum) {
      throw new Error(
        `Model checksum mismatch. expected=${modelSource.checksum} actual=${actual}`
      );
    }
  }

  const finalBinaryName = policy.platformConfig.runtime_binary_name;
  const finalBinaryPath = path.join(BIN_DIR, finalBinaryName);
  if (binarySource.source === "pilot-build-from-source") {
    console.log(`Building Whisper from source tag ${binarySource.releaseTag} for ${policy.platformKey}`);
    buildWhisperFromSource(policy, finalBinaryPath);
  } else {
    const zipPath = path.join(BIN_DIR, "whisper-binary.zip");
    console.log(`Downloading binary from ${binarySource.source}: ${binarySource.url}`);
    await downloadFile(binarySource.url, zipPath);
    ensureFileSize(zipPath, 200 * 1024);
    if (binarySource.checksum) {
      const actual = sha256(zipPath);
      if (actual !== binarySource.checksum) {
        throw new Error(
          `Binary zip checksum mismatch. expected=${binarySource.checksum} actual=${actual}`
        );
      }
    }
    try {
      extractZipAndInstallBinary(zipPath, finalBinaryPath);
    } finally {
      fs.rmSync(zipPath, { force: true });
    }
  }
  if (process.platform !== "win32") {
    fs.chmodSync(finalBinaryPath, 0o755);
  }
  ensureFileSize(finalBinaryPath, MIN_BINARY_SIZE);

  console.log("Whisper setup complete.");
  console.log(`Binary: ${finalBinaryPath}`);
  console.log(`Model: ${modelPath}`);
}

downloadWhisper().catch((error) => {
  console.error(`Failed to download Whisper: ${error instanceof Error ? error.message : String(error)}`);
  console.log("\nPolicy guidance:");
  console.log("- Select mode: TELE_COACH_WHISPER_DELIVERY_MODE=pilot|enterprise");
  console.log("- Enterprise mode requires internal URL + checksum env vars per platform.");
  console.log("- Pilot mode uses pinned upstream artifacts where available.");
  process.exit(1);
});
