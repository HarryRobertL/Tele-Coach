# Tele Coach - QA Checklist

## Purpose
Validate that the single source of truth path (playbook classifier → coaching_pack) works correctly, and that the **one-download** production build works with no user setup (Whisper and playbook bundled).

## Prerequisites
- Node.js 20+ installed
- Microphone access available for testing (for live coaching checks)
- For packaged testing: a built installer (e.g. from `npm run dist:mac:arm64` or `dist:win`)
- Whisper release gate must pass:
  - `npm run typecheck`
  - `npm run verify-whisper`
  - `npm run test-whisper-runtime`

## Testing Steps

### 1. Application Startup
- [ ] Run `npm run dev:smoke`
- [ ] Confirm app starts without errors
- [ ] Verify overlay window appears
- [ ] Check tray icon shows "Tele Coach" tooltip
- [ ] Confirm overlay header shows "Tele Coach" with "Live Call Coaching" subtitle

### 2. Idle State Validation
- [ ] Confirm objection shows "Listening" (not "—" or blank)
- [ ] Verify response shows "Ready when you are"
- [ ] Confirm question shows "Ask a quick question to open"
- [ ] Verify bridge shows "Are you near a screen for two minutes"
- [ ] Check severity badge shows "SOFT"
- [ ] Confirm momentum indicator shows "Low" with 0 filled slots
- [ ] Test copy buttons work for all idle state fields

### 3. One-download (packaged app)
- [ ] Install the packaged app from a fresh DMG/installer
- [ ] Launch the app; overlay appears with no "Speech engine setup" or download prompt
- [ ] Status shows Whisper ready (no setup screen)
- [ ] Run **Manual test** from Settings with a known phrase (e.g. "We already use Experian")
- [ ] Verify objection, response, question, and bridge update in the overlay
- [ ] Start coaching and speak a trigger phrase (e.g. "Not interested at all"); confirm coaching pack updates in real time

### 4. Manual Test (dev or packaged)
- [ ] Click "Start coaching" button
- [ ] Confirm microphone status changes from "idle" to "active"
- [ ] Speak a test phrase like "I'm not interested"
- [ ] Verify coaching_pack updates in UI with new objection
- [ ] Confirm objection changes do not flicker (smooth transitions)
- [ ] Check severity badge updates appropriately
- [ ] Verify momentum increases with demo phrases
- [ ] Test copy buttons copy correct text from active coaching pack

### 5. Demo Phrase Testing
Test these phrases to verify momentum scoring:
- [ ] "Are you near a screen for two minutes" → should increase momentum
- [ ] "How does this work" → should increase momentum  
- [ ] "We already use Experian" → should show medium severity
- [ ] "Not interested at all" → should show hard severity

### 6. Console & Error Validation
- [ ] Check browser console for no errors
- [ ] Verify no TypeScript compilation errors
- [ ] Confirm no undefined access errors in UI
- [ ] Check Electron main process console for no errors

### 7. Settings & Controls
- [ ] Test overlay mode toggle (compact/expanded)
- [ ] Verify settings window opens and functions
- [ ] Test privacy settings changes persist
- [ ] Confirm stop/start coaching works correctly

### 8. Global Shortcuts
- [ ] Test `Cmd+Shift+O` toggles overlay visibility
- [ ] Verify shortcuts work without conflicts

## Expected Behaviors

### Single Source of Truth Validation
- **Classification**: Both database logging and coaching pack use same `detectObjectionId()` results
- **No Flickering**: Objection changes should be smooth with proper throttling
- **Consistent Data**: Same objection ID, confidence, and matched phrases in both logging and UI
- **Momentum Scoring**: Should increase with demo invitation phrases and question words

### UI State Management
- **No Blank States**: All fields show meaningful content from first launch
- **Copy Functionality**: All copy buttons work even in idle state
- **Severity Display**: Badge colors match severity levels (soft/medium/hard)
- **Momentum Display**: Visual indicator matches calculated score (0-100 → 0-5 scale)

## Failure Indicators
❌ **Blank UI elements** on startup  
❌ **Console errors** during operation  
❌ **Flickering objections** between classifications  
❌ **Copy buttons disabled** in idle state  
❌ **Mismatched data** between logging and UI  
❌ **TypeScript compilation errors**  

## Success Criteria
✅ All checklist items pass  
✅ No console errors  
✅ Smooth user experience  
✅ Single source of truth path validated  

## Notes
- **One-download**: Packaged builds include Whisper and playbook; no user setup. QA should confirm overlay shows and coaching pack updates (manual test and/or live mic).
- The manual test (Settings) does not require a microphone; use it to verify objection/response/question/bridge updates.
- For automated testing, use the `run_manual_test` IPC call with sample transcripts.
- Momentum scoring is based on specific trigger phrases - see `engine/response_engine/selector.ts`
