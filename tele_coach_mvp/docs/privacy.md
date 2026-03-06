# Privacy & Local Data

## Core Privacy Guarantees
- Microphone audio is processed in-memory and is **not saved to disk**.
- No cloud speech processing is used; STT runs locally via `whisper.cpp`.
- No transcript data is sent to external services by design.

## What Is Stored Locally
- SQLite file: `data/app.sqlite`.
- App settings:
  - `store_transcript` (default `false`)
  - `store_events` (default `true`)
  - `redaction_enabled` (default `true`)
- Event analytics (only when `store_events=true`):
  - objection classifications (`objection_id`, confidence, matched phrases)
  - suggestion click events (which suggestion index/text was clicked)
- Transcript snippets are only stored when `store_transcript=true`.
  - Stored transcript text is redacted when `redaction_enabled=true`.
  - Raw audio is never stored.

## Redaction Coverage
When redaction is enabled, these patterns are replaced before transcript storage:
- email addresses
- phone numbers
- postcode-like patterns (UK and US ZIP style)
- company numbers

## Deleting Local Data
- Open the Settings page.
- Click **Delete Data**.
- The app deletes `data/app.sqlite` and restarts.
- This removes local settings and analytics/transcript history.
