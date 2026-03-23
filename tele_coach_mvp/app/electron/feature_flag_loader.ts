import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export type TeleCoachEnvironment = "development" | "pilot" | "production";

export interface FeatureFlagToggles {
  competitor_detection_enabled: boolean;
  intent_classification_enabled: boolean;
  momentum_engine_v2_enabled: boolean;
  adaptive_weighting_enabled: boolean;
  analytics_logging_enabled: boolean;
  operator_dashboard_enabled: boolean;
  local_debug_panels_enabled: boolean;
  whisper_upstream_fallback_allowed: boolean;
}

export interface FeatureFlags extends FeatureFlagToggles {
  environment: TeleCoachEnvironment;
  quiet_logging: boolean;
}

let cachedFlags: FeatureFlags | null = null;

const DEFAULT_TOGGLES: FeatureFlagToggles = {
  competitor_detection_enabled: true,
  intent_classification_enabled: true,
  momentum_engine_v2_enabled: true,
  adaptive_weighting_enabled: false,
  analytics_logging_enabled: true,
  operator_dashboard_enabled: false,
  local_debug_panels_enabled: false,
  whisper_upstream_fallback_allowed: false
};

const MODE_DEFAULTS: Record<TeleCoachEnvironment, Partial<FeatureFlagToggles>> = {
  development: {
    local_debug_panels_enabled: true,
    analytics_logging_enabled: true,
    operator_dashboard_enabled: true,
    whisper_upstream_fallback_allowed: true
  },
  pilot: {
    local_debug_panels_enabled: false,
    analytics_logging_enabled: true,
    operator_dashboard_enabled: true,
    adaptive_weighting_enabled: true,
    whisper_upstream_fallback_allowed: true
  },
  production: {
    local_debug_panels_enabled: false,
    analytics_logging_enabled: true,
    operator_dashboard_enabled: false,
    adaptive_weighting_enabled: false,
    whisper_upstream_fallback_allowed: false
  }
};

interface FeatureFlagConfigFile {
  environment?: TeleCoachEnvironment;
  flags?: Partial<FeatureFlagToggles>;
  modes?: Partial<Record<TeleCoachEnvironment, Partial<FeatureFlagToggles>>>;
}

function normalizeEnvironment(value: unknown): TeleCoachEnvironment {
  if (value === "development" || value === "pilot" || value === "production") {
    return value;
  }
  return "production";
}

function pickKnownFlags(raw: unknown): Partial<FeatureFlagToggles> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const obj = raw as Record<string, unknown>;
  const next: Partial<FeatureFlagToggles> = {};
  for (const key of Object.keys(DEFAULT_TOGGLES) as Array<keyof FeatureFlagToggles>) {
    if (typeof obj[key] === "boolean") {
      next[key] = obj[key] as boolean;
    }
  }
  return next;
}

function readJsonSafe<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function resolveUserOverridePath(): string | null {
  try {
    return path.join(app.getPath("userData"), "feature_flags.override.json");
  } catch {
    return null;
  }
}

export function loadFeatureFlags(): FeatureFlags {
  if (cachedFlags) return cachedFlags;

  const configPath = path.resolve(process.cwd(), "config", "feature_flags.json");
  const fileConfig = readJsonSafe<FeatureFlagConfigFile>(configPath);
  const envFromProcess = normalizeEnvironment(process.env.TELE_COACH_ENV);
  const envFromFile = normalizeEnvironment(fileConfig?.environment);
  const environment =
    process.env.TELE_COACH_ENV !== undefined ? envFromProcess : envFromFile;

  const baseModeDefaults = MODE_DEFAULTS[environment] ?? {};
  const modeOverridesFromFile = pickKnownFlags(
    fileConfig?.modes && fileConfig.modes[environment]
  );
  const explicitFlagsFromFile = pickKnownFlags(fileConfig?.flags);

  const overridePath = resolveUserOverridePath();
  const localOverride = overridePath
    ? readJsonSafe<{
        environment?: TeleCoachEnvironment;
        flags?: Partial<FeatureFlagToggles>;
      }>(overridePath)
    : null;
  const localFlags = pickKnownFlags(localOverride?.flags);

  const toggles: FeatureFlagToggles = {
    ...DEFAULT_TOGGLES,
    ...baseModeDefaults,
    ...modeOverridesFromFile,
    ...explicitFlagsFromFile,
    ...localFlags
  };

  cachedFlags = {
    ...toggles,
    environment,
    quiet_logging: environment === "production"
  };
  return cachedFlags;
}

