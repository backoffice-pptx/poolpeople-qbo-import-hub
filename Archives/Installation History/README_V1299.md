# V1299 — Isolated workbook write integration

Additive source file only. Requires V1297 and V1298 deployed. Does not replace any exporter or scheduler code.

1. Push only `4299_QBO_IsolatedWriteIntegrationV1299.js`.
2. Run `previewQboIsolatedWriteIntegrationV1299` first (read-only).
3. Only when no active daily claim exists, run `runQboIsolatedWriteIntegrationV1299`.

**The second function MUTATES Google Drive:** it creates and retains one new, standalone Google Sheets workbook, writes two rows to it, and logs its URL. It does not write to production export destinations, invoke QBO, or change scheduler state. Retain the workbook until logs are reviewed; then it may be manually trashed.

This tests the manual/no-scheduler-context lease path and actual spreadsheet write/readback, plus lease release and wrong-token rejection. It does NOT validate the scheduled-worker identity path, exporter completion, interruption recovery, or concurrent Google Sheets write fencing. The daily scheduler must remain paused. Automatic recovery remains disabled.
