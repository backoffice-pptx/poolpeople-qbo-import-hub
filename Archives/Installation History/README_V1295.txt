V1295 — PARTIAL write-boundary lease-token guard (deployment review required).
Based on V1294 21_ExportFramework.js. Compare with CURRENT deployed source.
This is NOT complete scheduler-worker fencing. It validates the lease token before
framework-level mutation operations, including before snapshot completion.
A single long SpreadsheetApp mutation cannot be interrupted by these checks.
No worker-token attestation, no safe lease-clear protocol, no automatic recovery.
Manual exports and other callers of withExportWriteLock_ must be reviewed.
Keep daily scheduler PAUSED. Do not deploy without source-diff and compatibility review.
Tests: testQboWriteBoundariesV1295; previewQboWriteBoundariesV1295.
