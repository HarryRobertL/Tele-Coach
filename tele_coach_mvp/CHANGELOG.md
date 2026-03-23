# Changelog

All notable changes to Tele Coach will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

- (Add changes here for the next release.)

## [1.0.0] - YYYY-MM-DD

### Added

- One-download production build: Whisper binary and model bundled with the app; no user setup required after install.
- Playbook and bridges copied into the built app so objection/response/question/bridge work out of the box.
- Real-time call coaching: overlay with objection detection, suggested responses, questions, and bridges.
- Manual test in Settings to verify coaching without microphone.
- Packaging scripts: `dist:mac:arm64`, `dist:mac:x64`, `dist:win` (build + prepack Whisper + electron-builder).
- Code signing documented (macOS Developer ID, Windows certificate) in PACKAGING.md.
- Icon requirements documented in `assets/icons/README.md`.

### Changed

- (List breaking or notable changes.)

### Fixed

- (List bug fixes.)

---

When cutting a release:

1. Replace `[Unreleased]` with the new version and date.
2. Add a new `## [Unreleased]` section at the top for future changes.
3. Update the version in `package.json` to match.
