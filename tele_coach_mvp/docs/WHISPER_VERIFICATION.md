# Whisper Verification

Tele Coach release validation for Whisper is strict and deterministic.

## Required release gate

Release is blocked unless all commands pass:

1. `npm run typecheck`
2. `npm run verify-whisper`
3. `npm run test-whisper-runtime`

## 1) Asset verification (`npm run verify-whisper`)

- expected Whisper binary/model files exist
- file sizes are realistic
- executable/checksum checks pass against pinned values
- delivery mode/platform/release metadata are printed

## 2) Runtime verification (`npm run test-whisper-runtime`)

- resolves binary/model paths exactly as app uses them
- launches Whisper with real runtime arguments
- requires non-empty transcript output
- fails on non-zero exit code or runtime timeout

## 3) Supplemental runtime audit (`npm run verify-whisper-runtime`)

This command provides additional diagnostics (binary format checks, sample audio path, runtime command).

## Interpreting failures (fail closed)

- `Binary found: no` / `Executable: no`
  - wrong/missing binary path or bad permissions
- `Model found: no`
  - model missing or wrong model name
- `Real transcription ran: no`
  - spawn failure or timeout
- `Output contained transcript text: no`
  - launch succeeded but output was usage/help text, empty output, or failure output

## CI gating guidance (if no workflow file is present)

Use this validation stage snippet:

```yaml
- name: Whisper release gate
  run: |
    npm ci
    npm run typecheck
    npm run verify-whisper
    npm run test-whisper-runtime
```
