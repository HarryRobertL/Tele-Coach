# Architecture Notes: Tele Coach MVP

## 1. File roles (summary)

### app/electron/main.ts
- Electron main process entry: creates overlay/settings windows, tray, global shortcuts.
- Owns **transcript buffer**, STT runner, classifier, playbook selector; wires runner events → classification → suggestion emission.
- Registers IPC handlers (start/stop coaching, settings, outcome logging, audio chunk ingestion, manual test).
- Sends to renderer: `stt_partial`, `stt_final`, `objection_update`, `suggestions_update`, `engine_status`, `overlay_mode`, `shortcut_copy_suggestion`.

### engine/classifier/types.ts
- Defines `ObjectionId` union and `ObjectionClassification` interface (`objection_id`, `confidence`, `matched_phrases`).

### engine/classifier/rules.ts
- Pattern-based objection classifier: rule list with phrase/weight, `classify(text)` returns best match above `MIN_CONFIDENCE` (0.55).
- Throttling: `CHANGE_COOLDOWN_MS` (4000), `CHANGE_JUMP_OVERRIDE` (0.3); uses `sliceRecentInput` (max 500 chars, 3 sentences) and internal `lastResult`/`lastChangeAt` state.
- Exports `classify()`, `resetClassificationState()`.

### engine/playbooks/selector.ts
- Loads playbook JSON (e.g. `default_en.json`); `PlaybookSelector.select(objectionId, transcript)` returns three suggestions (empathy, discovery, value/close) plus `next_best_question`, `optimal_answer`, `call_stage`.
- Call stage from transcript length (early &lt;300, mid &lt;1200, late otherwise). Picks lines via deterministic hash to avoid immediate repetition.

### app/renderer/src (overlay UI, IPC, display)
- **overlay_view.tsx**: Main overlay; holds all UI state; subscribes via `window.api.on()` to `engine_status`, `stt_partial`, `stt_final`, `objection_update`, `suggestions_update`, `overlay_mode`; drives AudioCapture and sends chunks with `window.api.sendAudioChunk()`; renders compact block (objection + best line) or expanded (TranscriptView + SuggestionView).
- **suggestion_view.tsx**: Display block for suggestions list, next best question, optimal answer, call stage, objection, confidence, matched phrases; copy-to-clipboard and `logSuggestionClick`; listens for `shortcut_copy_suggestion`.
- **transcript_view.tsx**: Display block for partial and final transcript text only.
- **window_api.d.ts**: Declares `MainEventChannel`, `MainEventPayloadMap`, and `WindowApi` for type-safe IPC in renderer.

### IPC event constants (main ↔ renderer)
- **Main → renderer (main sends):** `MainEventChannel` in `app/electron/ipc.ts` (and mirrored in `app/electron/preload.ts` / `app/renderer/src/window_api.d.ts`): `stt_partial`, `stt_final`, `objection_update`, `suggestions_update`, `engine_status`, `overlay_mode`, `shortcut_copy_suggestion`.
- **Renderer → main (invoke/send):** `RendererInvokeChannel` and `RendererSendChannel` in `app/electron/ipc.ts`; preload exposes `startCoaching`, `stopCoaching`, `toggleOverlayMode`, `logOutcome`, `getSettings`, `updateSettings`, `logSuggestionClick`, `deleteData`, `getStats`, `runManualTest`, and `sendAudioChunk` (send).

---

## 2. Data flow (transcript → overlay)

```
Microphone
    → AudioCapture (renderer)
    → sendAudioChunk (IPC send "audio_chunk")
    → main: sttRunner.ingestAudioChunk()
    → WhisperRunner
        → emit("partial", { text, tsMs }) / emit("final", { text, tsMs })
    → main: attachRunnerEvents
        → stt_partial / stt_final → emitToWindows(...)
        → handleObjectionClassification(payload.text)
            → updateTranscriptBuffer(text)   // transcript buffer
            → classify(transcriptBuffer)     // classification (throttled in rules.ts)
            → objection_update → emitToWindows("objection_update", result)
            → emitSuggestionsForObjection(result.objection_id)
                → playbookSelector.select(objectionId, transcriptBuffer)
                → suggestions_update → emitToWindows("suggestions_update", selection)
    → overlay window webContents
        → overlay_view.tsx: window.api.on("suggestions_update", ...) → setSuggestions, setNextBestQuestion, setOptimalAnswer, setCallStage
        → SuggestionView / TranscriptView (and compact block) render from state.
```

---

## 3. Key findings

### Where transcript buffer lives
- **File:** `app/electron/main.ts`
- **Variable:** `transcriptBuffer` (module-level string, line ~26).
- **Updated by:** `updateTranscriptBuffer(nextText)` — appends and keeps last 500 chars: `combined.slice(-500)`.
- **Reset:** In `startRunner()` and `stopRunner()` (set to `""`).

### How classification is triggered and throttled
- **Triggered:** On every STT **partial** and **final** event in `attachRunnerEvents()`: both call `handleObjectionClassification(payload.text)` (no separate throttle at main level).
- **Throttling (inside classifier):** In `engine/classifier/rules.ts`, `classify()` uses:
  - **Change cooldown:** 4000 ms (`CHANGE_COOLDOWN_MS`) before switching to a *different* objection label; same-label confidence updates allowed without cooldown.
  - **Confidence jump override:** If label would change but still in cooldown, a confidence increase ≥ 0.3 (`CHANGE_JUMP_OVERRIDE`) overrides and allows the change.
  - **Input scope:** Only last 500 chars and last 3 sentences via `sliceRecentInput()`.
- **Emission deduplication (main):** `handleObjectionClassification` only sends `objection_update` when `signatureForObjection(result)` differs from `lastObjectionSignature`.

### How suggestions are selected
- **Entry:** `emitSuggestionsForObjection(objectionId)` in `app/electron/main.ts` (called after each classification).
- **Selection:** `playbookSelector.select(objectionId, transcriptBuffer)` in `engine/playbooks/selector.ts`:
  - Resolves playbook entry by `objectionId` (fallback to `unknown`).
  - `detectCallStage(transcript.length)` → early / mid / late.
  - Picks one line each from empathy_lines, discovery_questions, and (for late) next_step_closes or (early/mid) value_angles via `pickLine()` (hash-based, avoids repeating same line per category).
- **Deduplication:** Main only emits when signature `objectionId|call_stage|suggestions.join("||")` differs from `lastSuggestionSignature`.

### IPC event that sends coaching data to the renderer
- **Event name:** `suggestions_update`
- **Emitted in:** `app/electron/main.ts` inside `emitSuggestionsForObjection()` via `emitToWindows("suggestions_update", { ... })`.
- **Received in:** `app/renderer/src/components/overlay_view.tsx` with `window.api.on("suggestions_update", (payload) => { ... })`.

---

## 4. Payload shape emitted to renderer (coaching / suggestions)

**Channel:** `suggestions_update`

**Exact payload (TypeScript):**

```ts
{
  suggestions: [string, string, string];   // 3 coaching lines (empathy, discovery, value/close)
  next_best_question: string;
  optimal_answer: string;
  call_stage: "early" | "mid" | "late";
}
```

Defined in: `app/electron/preload.ts` (`MainEventPayloadMap.suggestions_update`), `app/renderer/src/window_api.d.ts` (same shape), and produced in `engine/playbooks/selector.ts` as `SuggestionSelection`.

---

## 5. Key functions and file locations

| Responsibility              | Function / symbol           | File                          |
|----------------------------|-----------------------------|-------------------------------|
| Transcript buffer          | `transcriptBuffer`, `updateTranscriptBuffer` | `app/electron/main.ts`        |
| Classification trigger     | `handleObjectionClassification`             | `app/electron/main.ts`        |
| Classification + throttle  | `classify`, `resetClassificationState`      | `engine/classifier/rules.ts`  |
| Objection types            | `ObjectionId`, `ObjectionClassification`    | `engine/classifier/types.ts`  |
| Suggestion selection       | `emitSuggestionsForObjection`               | `app/electron/main.ts`       |
| Playbook selection logic   | `PlaybookSelector.select`, `pickLine`       | `engine/playbooks/selector.ts`|
| Send to overlay/settings   | `emitToWindows`                             | `app/electron/main.ts`       |
| IPC channel types          | `MainEventChannel`, `RendererInvokeChannel` | `app/electron/ipc.ts`         |
| Suggestions payload type   | `MainEventPayloadMap.suggestions_update`     | `app/electron/preload.ts`    |
| Overlay IPC listeners + UI | `OverlayView`, `window.api.on(...)`          | `app/renderer/src/components/overlay_view.tsx` |
| Suggestions display        | `SuggestionView`                            | `app/renderer/src/components/suggestion_view.tsx` |
| Transcript display         | `TranscriptView`                            | `app/renderer/src/components/transcript_view.tsx` |
