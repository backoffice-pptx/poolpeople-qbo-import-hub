# v1.5.225 — GL live-registry diagnostic contract repair

- Reconciles the compact read-only diagnostic contract with the actual metadata-read implementation.
- Replaces the brittle v1.5.224 metadata assertion with checks for the real `SpreadsheetApp.openById(expectedSnapshotId)` + `00_Metadata` + `ExtractedAt` path.
- Keeps the diagnostic read-only: no QBO acquisition, no production GL writes, no registry repair.
- Emits compact separate log records for registry context, legacy/recovered/failed cells, evidence agreement, protections, and result.

Operator functions:
- `testQboGeneralLedgerLiveRegistryV1225Contract()`
- `diagnoseQboGeneralLedgerLiveRegistryV1225ForFailedA98b()`
