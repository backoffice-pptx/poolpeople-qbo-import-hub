# App 50 v1.5.220 — Phase G Global Equal-Time Diagnostic Spreadsheet Recovery

## Purpose
Recover the existing v1.5.219 global equal-time run after the Spreadsheet service failure at committed manifest cursor 1117, without restarting or duplicating torn partition rows.

## Recovery contract
- Requires exact failed run `PHASE_G_GLOBAL_TIE_V1219|f8717a54-3a18-476a-8fa0-4f27a8c03f92`.
- Requires exact failed-state cursor/counters from the 2026-10-05 incident.
- Uses the saved iterator token to identify the next uncommitted manifest.
- Reconciles the poisoned in-memory counters by subtracting that manifest's exact admission population.
- Removes any partially written rows for that uncommitted manifest by ObservationId from affected partitions.
- Resumes the same workbook/run at manifest cursor 1117.
- Future manifest writes are idempotent: any rows from the in-flight manifest are removed before the complete manifest is appended.
- Counters and cursor advance only after successful partition writes + Spreadsheet flush.
- Transient Spreadsheet/Drive service errors schedule retry while retaining the committed cursor.
- State Application 10/11/12 remains read-only and replay remains disabled.

## Operator function
`recoverQboStateApplicationV2PhaseGGlobalEqualTimeDiagnosticV1220`

Do not rerun the v1.5.219 start function.
