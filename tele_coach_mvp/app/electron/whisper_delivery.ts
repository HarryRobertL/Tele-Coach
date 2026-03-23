import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export type WhisperDeliveryMode = "pilot" | "enterprise";
export type TeleCoachEnvironment = "development" | "pilot" | "production";

interface WhisperPlatformConfig {
  runtime_binary_name: string;
  upstream_zip_url: string | null;
  upstream_zip_sha256: string | null;
  upstream_build_from_source?: boolean;
  enterprise_zip_url_env: string;
  enterprise_zip_sha256_env: string;
}

interface WhisperDeliveryConfig {
  default_mode_by_environment: Record<TeleCoachEnvironment, WhisperDeliveryMode>;
  binary: {
    version: string;
    release_tag: string;
    min_size_bytes: number;
  };
  model: {
    version: string;
    file_name: string;
    legacy_file_name: string;
    min_size_bytes: number;
    sha256: string;
    upstream_url: string;
    enterprise_url_env: string;
    enterprise_sha256_env: string;
  };
  platforms: Record<string, WhisperPlatformConfig>;
}

interface Source {
  url?: string;
  checksum?: string;
  source:
    | "pilot-upstream"
    | "pilot-internal-fallback"
    | "pilot-build-from-source"
    | "enterprise-internal";
  releaseTag?: string;
}

export interface WhisperDeliveryPolicy {
  mode: WhisperDeliveryMode;
  allowUpstreamFallback: boolean;
  platformKey: string;
  platform: WhisperPlatformConfig;
  config: WhisperDeliveryConfig;
  binarySource: Source;
  modelSource: Source;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function readConfig(): WhisperDeliveryConfig {
  const candidatePaths = [
    path.join(process.resourcesPath || "", "config", "whisper_delivery.json"),
    path.join(app.getAppPath(), "config", "whisper_delivery.json"),
    path.resolve(process.cwd(), "config", "whisper_delivery.json")
  ];
  const configPath = candidatePaths.find((candidate) => candidate && fs.existsSync(candidate));
  if (!configPath) {
    throw new Error(
      `Cannot locate whisper_delivery.json. Checked: ${candidatePaths.filter(Boolean).join(", ")}`
    );
  }
  const raw = fs.readFileSync(configPath, "utf8");
  return JSON.parse(raw) as WhisperDeliveryConfig;
}

function inferMode(config: WhisperDeliveryConfig): WhisperDeliveryMode {
  const explicit = process.env.TELE_COACH_WHISPER_DELIVERY_MODE;
  if (explicit === "pilot" || explicit === "enterprise") return explicit;
  const env = process.env.TELE_COACH_ENV as TeleCoachEnvironment | undefined;
  if (env && config.default_mode_by_environment[env]) {
    return config.default_mode_by_environment[env];
  }
  return "pilot";
}

function resolveModelSource(
  config: WhisperDeliveryConfig,
  mode: WhisperDeliveryMode
): Source {
  if (mode === "enterprise") {
    const url =
      process.env[config.model.enterprise_url_env] || process.env.TELE_COACH_WHISPER_MODEL_URL;
    const checksum =
      process.env[config.model.enterprise_sha256_env] ||
      process.env.TELE_COACH_WHISPER_MODEL_SHA256_ENTERPRISE;
    if (!url || !checksum) {
      throw new Error(
        `Enterprise Whisper mode requires ${config.model.enterprise_url_env} and ${config.model.enterprise_sha256_env}.`
      );
    }
    return { url, checksum, source: "enterprise-internal" };
  }
  return {
    url: config.model.upstream_url,
    checksum: config.model.sha256,
    source: "pilot-upstream"
  };
}

function resolveBinarySource(
  platform: WhisperPlatformConfig,
  mode: WhisperDeliveryMode,
  allowUpstreamFallback: boolean,
  platformKey: string,
  releaseTag: string
): Source {
  const enterpriseUrl = process.env[platform.enterprise_zip_url_env];
  const enterpriseSha = process.env[platform.enterprise_zip_sha256_env];
  if (mode === "enterprise") {
    if (!enterpriseUrl || !enterpriseSha) {
      throw new Error(
        `Enterprise Whisper mode requires ${platform.enterprise_zip_url_env} and ${platform.enterprise_zip_sha256_env} for ${platformKey}.`
      );
    }
    return { url: enterpriseUrl, checksum: enterpriseSha, source: "enterprise-internal" };
  }
  if (platform.upstream_zip_url) {
    return {
      url: platform.upstream_zip_url,
      checksum: platform.upstream_zip_sha256 ?? undefined,
      source: "pilot-upstream"
    };
  }
  if (platform.upstream_build_from_source) {
    return {
      source: "pilot-build-from-source",
      releaseTag
    };
  }
  if (allowUpstreamFallback && enterpriseUrl) {
    return {
      url: enterpriseUrl,
      checksum: enterpriseSha || undefined,
      source: "pilot-internal-fallback"
    };
  }
  throw new Error(
    `No upstream Whisper binary is pinned for ${platformKey}. ` +
      `Set ${platform.enterprise_zip_url_env} and TELE_COACH_WHISPER_ALLOW_UPSTREAM_FALLBACK=1, or use enterprise mode.`
  );
}

export function loadWhisperDeliveryPolicy(): WhisperDeliveryPolicy {
  const config = readConfig();
  const platformKey = `${process.platform}-${process.arch}`;
  const platform = config.platforms[platformKey];
  if (!platform) {
    throw new Error(
      `Unsupported Whisper platform ${platformKey}. Supported: ${Object.keys(config.platforms).join(", ")}`
    );
  }
  const mode = inferMode(config);
  const fallbackDefault = mode === "pilot";
  const allowUpstreamFallback = mode === "enterprise"
    ? false
    : parseBoolean(process.env.TELE_COACH_WHISPER_ALLOW_UPSTREAM_FALLBACK, fallbackDefault);
  return {
    mode,
    allowUpstreamFallback,
    platformKey,
    platform,
    config,
    binarySource: resolveBinarySource(
      platform,
      mode,
      allowUpstreamFallback,
      platformKey,
      config.binary.release_tag
    ),
    modelSource: resolveModelSource(config, mode)
  };
}
