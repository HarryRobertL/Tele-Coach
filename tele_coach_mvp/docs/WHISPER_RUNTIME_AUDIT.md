# Whisper Runtime Audit

This document captures the current runtime behavior of Whisper integration in Tele Coach.

## Binary path currently used

Observed by `npm run verify-whisper-runtime` on this machine:

- `/Users/harrylovell/ArbitraX-2/Ceditsafe Tele Coaching/tele_coach_mvp/engine/stt/whisper/bin/whisper`

Resolved by `app/electron/whisper_manager.ts` in this order:

1. userData whisper folder candidate(s), then
2. repo-local candidate(s) under `engine/stt/whisper/bin/`

## Model path currently used

Observed by `npm run verify-whisper-runtime` on this machine:

- `/Users/harrylovell/ArbitraX-2/Ceditsafe Tele Coaching/tele_coach_mvp/engine/stt/whisper/models/ggml-tiny.en.bin`

Resolved by `app/electron/whisper_manager.ts` based on selected STT model (`tiny.en`, `base.en`, `small.en`) with fallback to `tiny.en` when needed.

## Exact command line used to launch Whisper

In the real streaming runner path (`engine/stt/whisper/runner.ts`), the command is:

`<binaryPath> -m <modelPath> -l en --output-txt --no-timestamps -f -`

Input audio is provided via stdin as a WAV buffer converted from live PCM16 chunks.

Runtime verification command used:

`/Users/harrylovell/ArbitraX-2/Ceditsafe Tele Coaching/tele_coach_mvp/engine/stt/whisper/bin/whisper -m /Users/harrylovell/ArbitraX-2/Ceditsafe Tele Coaching/tele_coach_mvp/engine/stt/whisper/models/ggml-tiny.en.bin -l en --output-txt --no-timestamps -f /Users/harrylovell/ArbitraX-2/Ceditsafe Tele Coaching/tele_coach_mvp/bindings/go/samples/jfk.wav`

## How success is detected

Runner success now requires all of the following:

1. process exits with code `0`
2. parsed stdout transcript is non-empty
3. stdout does not look like usage/help text (e.g. `usage:`, `--help`, `options:`)
4. stderr does not indicate runtime failure

App-level runtime logs include:

- `[WhisperRuntime] runner_start ...`
- `[WhisperRuntime] launch ...`
- `[WhisperRuntime] whisper_first_output_received`

## How failure is detected

Failure is reported when any step breaks:

1. binary/model missing or placeholder-sized
2. spawn failure
3. non-zero exit code
4. exit code `0` with empty transcript
5. exit code `0` but output looks like help/usage text
6. unexpected exit logs:
   - `[WhisperRuntime] exit_unexpected code=<code> signal=<signal> stderr="<stderr>"`
