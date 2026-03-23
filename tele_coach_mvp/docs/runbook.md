# tele_coach_mvp Runbook

## 1) Install Node.js (Intel Mac)
- Confirm architecture: `uname -m` should be `x86_64`.
- Install nvm if needed, then install Node 20:
  - `nvm install 20`
  - `nvm use 20`
- Verify:
  - `node -v`
  - `npm -v`

## 2) Install Dependencies
- Install Xcode command line tools (for `better-sqlite3` native build):
  - `xcode-select --install`
- From project root:
  - `npm install`
- Rebuild native module for Electron (recommended after install/version changes):
  - `npm run rebuild-native`

## 3) Configure Whisper delivery mode and artifacts
- Set delivery mode explicitly:
  - Pilot/dev: `export TELE_COACH_WHISPER_DELIVERY_MODE=pilot`
  - Enterprise/prod: `export TELE_COACH_WHISPER_DELIVERY_MODE=enterprise`
- For enterprise mode, set internal artifact env vars documented in `docs/WHISPER_SETUP_NOTES.md`.
- Runtime binary paths:
  - mac/linux: `engine/stt/whisper/bin/whisper`
  - windows: `engine/stt/whisper/bin/whisper.exe`
- Runtime model path:
  - `engine/stt/whisper/models/ggml-tiny.en.bin`

## 4) Run Dev
- Start renderer + Electron:
  - `npm run dev`
- Open settings from tray if not visible.
- Global shortcuts:
  - `Cmd/Ctrl+Shift+L` toggle coaching
  - `Cmd/Ctrl+Shift+O` toggle overlay visibility
  - `Cmd/Ctrl+1/2/3` copy suggestion slots

## 5) Build and Start Production
- Build:
  - `npm run build`
- Run built app:
  - `npm run start`
- Release gate (must pass before rollout):
  - `npm run typecheck`
  - `npm run verify-whisper`
  - `npm run test-whisper-runtime`

## Runtime Notes
- Local DB path: `data/app.sqlite`
- Tables: `sessions`, `events`, `suggestion_clicks`, `outcomes`
- Raw mic audio is never saved.

## Troubleshooting Mic Permission (macOS)
- If mic status shows error/denied:
  1. Open `System Settings` -> `Privacy & Security` -> `Microphone`.
  2. Enable microphone access for your terminal/IDE host app.
  3. Fully quit and relaunch the app.
- If still denied, reset permission prompt for the host app and retry.
