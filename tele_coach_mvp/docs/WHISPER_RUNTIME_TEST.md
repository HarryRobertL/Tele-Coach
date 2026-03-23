# Whisper Runtime Test

This verifies that Whisper does not just exist on disk, but can launch and produce real transcription text at runtime.

## Run

```bash
npm run test-whisper-runtime
```

The script resolves and validates:

- `engine/stt/whisper/bin/whisper` (or `whisper.exe` on Windows)
- `engine/stt/whisper/models/ggml-tiny.en.bin`

If no sample WAV exists, it generates one on macOS using:

```bash
say -o /tmp/telecoach_test.aiff "Hello this is a Whisper transcription test"
ffmpeg -i /tmp/telecoach_test.aiff -ar 16000 -ac 1 -c:a pcm_s16le /tmp/telecoach_test.wav
```

Then it runs:

```bash
engine/stt/whisper/bin/whisper -m engine/stt/whisper/models/ggml-tiny.en.bin -ng -nfa -nt -f /tmp/telecoach_test.wav
```

## What Success Looks Like

- Binary exists.
- Model exists and is larger than 70MB.
- Binary is executable.
- Whisper process starts and exits cleanly.
- Runtime is under 30 seconds.
- Output includes recognizable English transcript text.
- Script prints:
  - `WHISPER TRANSCRIPT: ...`
  - Structured JSON with:
    - `transcript_detected: true`
    - `error: null`

## Common macOS Failures

- `say` command missing or blocked by environment policy.
- `ffmpeg` not installed or not available on PATH.
- Binary exists but lacks execute permissions (`chmod +x ...`).
- Model exists but is too small/corrupt (bad download).
- Whisper exits with no transcript due to audio/model mismatch.

## Reinstall / Repair Whisper Assets

```bash
npm run setup-whisper
npm run verify-whisper
npm run test-whisper-runtime
```

