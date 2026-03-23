# Whisper Source-of-Truth Policy

This document defines rollout-ready Whisper artifact policy for Tele Coach.

## Source of truth

All Whisper delivery/version/checksum decisions are pinned in:

- `config/whisper_delivery.json`

Do not hardcode URLs/checksums in app or scripts outside this file.

## Delivery modes

Set with:

- `TELE_COACH_WHISPER_DELIVERY_MODE=pilot|enterprise`

If not set:

- `development` and `pilot` environments default to `pilot`
- `production` defaults to `enterprise`

### `pilot` mode

- Uses pinned upstream assets where they exist.
- Allows internal fallback only when:
  - `TELE_COACH_WHISPER_ALLOW_UPSTREAM_FALLBACK=1`
  - internal platform env vars are present.

### `enterprise` mode (recommended for production)

- Internal artifacts only.
- No upstream fallback.
- Fails closed if required internal URL/checksum env vars are missing.

## Pinned versions and checksums

From `config/whisper_delivery.json`:

- Whisper binary version: `whisper.cpp v1.8.3`
- Pinned release tag: `v1.8.3`
- Model: `ggml-tiny.en.bin`
- Model SHA256: `921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f`
- Upstream zip SHA256:
  - `win32-x64`: `219dd423cd910b72e7794b9a17f578367ba815010afcff26e3d7b527b3c111fa`

`darwin-x64` and `darwin-arm64` use pinned upstream source build (`v1.8.3`) in pilot mode, or internal artifacts in enterprise mode.

## Enterprise env contract (required)

- `TELE_COACH_WHISPER_BINARY_URL_DARWIN_ARM64`
- `TELE_COACH_WHISPER_BINARY_ZIP_SHA256_DARWIN_ARM64`
- `TELE_COACH_WHISPER_BINARY_URL_DARWIN_X64`
- `TELE_COACH_WHISPER_BINARY_ZIP_SHA256_DARWIN_X64`
- `TELE_COACH_WHISPER_BINARY_URL_WIN32_X64`
- `TELE_COACH_WHISPER_BINARY_ZIP_SHA256_WIN32_X64`
- `TELE_COACH_WHISPER_MODEL_URL_ENTERPRISE`
- `TELE_COACH_WHISPER_MODEL_SHA256_ENTERPRISE`

## Runtime health gate

Before live coaching starts, the app runs a Whisper startup health check.

If it fails, Tele Coach:

- blocks coaching start,
- shows actionable remediation in UI,
- logs diagnostic reason in main process logs.
