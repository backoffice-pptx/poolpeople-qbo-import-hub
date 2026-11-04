V1289 — guarded snapshot-completion boundary (1.5.289)

Source: V1285 package's 24_TriggerManagement.js, not a fresh post-V1285 clasp pull.
Compare against your current deployed 24_TriggerManagement.js BEFORE copying.
This package replaces the scheduler file and adds 4289. It requires V1284 checkpoint module.

Behavior: On a successful exporter return, read back the latest matching export history row, verify exact attempt timestamp and immutable snapshot metadata, then persist SNAPSHOT_RECORDED checkpoint before queue advancement. Failure HOLDS the claim/queue, does not classify the exporter as ERROR, and does not schedule a duplicate. This is fail-closed, not automatic recovery.

LIMITATIONS: No write-boundary fencing, no QUEUE_ADVANCED or RUN_FINALIZED checkpoints, no automated recovery, no proof of actual Apps Script execution termination. Export-error and retry paths retain existing scheduler behavior. A hold requires operator inspection.

TESTS: testQboDailyCompletionProofV1289; previewQboDailyCompletionProofV1289. Both avoid production writes.

DO NOT DEPLOY before reviewing source diff. Keep scheduler paused.
