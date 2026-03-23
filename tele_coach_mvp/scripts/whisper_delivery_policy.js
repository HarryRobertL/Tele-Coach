#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function parseBoolean(raw, fallback) {
  if (raw === undefined) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function platformKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

function inferMode(config) {
  const explicit = process.env.TELE_COACH_WHISPER_DELIVERY_MODE;
  if (explicit === "pilot" || explicit === "enterprise") return explicit;
  const env = process.env.TELE_COACH_ENV;
  if (env && config.default_mode_by_environment?.[env]) {
    return config.default_mode_by_environment[env];
  }
  return "pilot";
}

function getEnterpriseModelSource(config) {
  const model = config.model;
  const url = process.env[model.enterprise_url_env] || process.env.TELE_COACH_WHISPER_MODEL_URL;
  const sha =
    process.env[model.enterprise_sha256_env] || process.env.TELE_COACH_WHISPER_MODEL_SHA256_ENTERPRISE;
  return { url, sha256: sha };
}

function getEnterpriseBinarySource(platformConfig) {
  const url = process.env[platformConfig.enterprise_zip_url_env];
  const sha = process.env[platformConfig.enterprise_zip_sha256_env];
  return { url, sha256: sha };
}

function getWhisperPolicy(options = {}) {
  const projectRoot = options.projectRoot || path.resolve(__dirname, "..");
  const configPath = path.join(projectRoot, "config", "whisper_delivery.json");
  const config = readJson(configPath);
  const key = platformKey(options.platform, options.arch);
  const platformConfig = config.platforms?.[key];
  if (!platformConfig) {
    throw new Error(
      `Whisper artifacts are not configured for ${key}. Supported keys: ${Object.keys(
        config.platforms || {}
      ).join(", ")}`
    );
  }
  const mode = inferMode(config);
  const fallbackDefault = mode === "pilot";
  const allowUpstreamFallback = parseBoolean(
    process.env.TELE_COACH_WHISPER_ALLOW_UPSTREAM_FALLBACK,
    fallbackDefault
  );
  const modelEnterprise = getEnterpriseModelSource(config);
  const binaryEnterprise = getEnterpriseBinarySource(platformConfig);
  return {
    mode,
    allowUpstreamFallback: mode === "enterprise" ? false : allowUpstreamFallback,
    platformKey: key,
    platformConfig,
    config,
    configPath,
    modelEnterprise,
    binaryEnterprise
  };
}

module.exports = {
  getWhisperPolicy,
  parseBoolean
};
