# Sales Floor Script Contract

The **sales-floor phrase fixture** locks how real call language maps to objection, stage, intent, and momentum. When script language evolves, update the fixture so reps/ops and engineering stay aligned.

## Where it lives

- **Fixture:** `tests/fixtures/sales-floor-phrases.fixture.ts`
- **Test:** `tests/sales-floor-contract.test.ts`
- **Run:** `npm run test:contract`

## How to update a row safely

1. **Change the transcript** if reps use different wording.
2. **Change the `expect` block** to match what the system *should* output for that wording.
3. Run `npm run test:contract` — if it fails, either:
   - Fix the fixture `expect` values (if the new wording is correct and the system is wrong), or
   - Extend the classifier/playbook (if the system should handle the new wording but doesn’t yet).

## Expect fields (all optional)

| Field | Meaning |
|-------|---------|
| `objectionId` | e.g. `send_email`, `already_use_provider`, `no_budget` |
| `severity` | `soft`, `medium`, `hard` |
| `intent` | e.g. `demo_ready`, `brush_off`, `callback` |
| `stage` | e.g. `discovery`, `objection_handling`, `demo_transition`, `ended` |
| `momentumLevel` | `low`, `medium`, `high` |
| `minScore` / `maxScore` | Momentum score range (0–100) |
| `reasonIncludes` | Momentum reasons that must appear (e.g. `competitor_named:experian`) |

Only include fields you care about; omit the rest.

## Adding a new scenario

1. Add a new object to `SALES_FLOOR_PHRASES` with a unique `id`.
2. Set `transcript` to the exact phrase (or a short, representative snippet).
3. Set `expect` to the desired outputs.
4. Run `npm run test:contract` and fix any failures.

## Who does what

- **Reps/ops:** Propose new transcripts and expected behaviour when script language changes.
- **Engineering:** Update the fixture, extend classifiers/playbooks if needed, and keep tests passing in CI.

## Quick check

```bash
npm run test:contract
```
