# v1.5.224 — GL live-registry compact diagnostic

Read-only follow-up to v1.5.223. Emits the decisive registry-cell, evidence, metadata, and protection fields in separate log records to avoid Apps Script log truncation. No QBO acquisition and no production writes.

Run in order:
1. `testQboGeneralLedgerLiveRegistryV1224Contract()`
2. `diagnoseQboGeneralLedgerLiveRegistryV1224ForFailedA98b()`
