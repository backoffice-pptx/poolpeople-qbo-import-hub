V1285 — Phase 1: live claim and export-start checkpoint integration

Files:
  24_TriggerManagement.js — replacement from supplied current source, with two V1285 guarded calls
  4284_QBO_DailyCheckpointStoreV1284.js — unchanged prerequisite included for verification

CHANGE BOUNDARY
- After scheduler claim is acquired, write CLAIMED checkpoint under scheduler lock.
- Before exporter invocation, write EXPORT_STARTED checkpoint.
- Both writes validate current run/index/exportKey/token and reject stale ownership.
- This DOES NOT implement snapshot-recorded checkpoint, queue-advance checkpoint,
  exporter write fencing, completion-evidence reconciliation, or automatic recovery.
- A checkpoint failure is fail-closed and may leave a claim needing manual recovery.
- This single-slot checkpoint is not a durable per-run event journal.
- Existing pause, V1280 no-age-takeover, and V1281 bounded watchdog retained.

CRITICAL: Do not push until source diff reviewed. Keep scheduler paused.
Tests: JavaScript syntax checked only; runtime execution NOT verified.
The read-only V1284 preview should remain checkpointPresent=false while paused/idle.
Do not unpause or invoke an exporter to test this change.
