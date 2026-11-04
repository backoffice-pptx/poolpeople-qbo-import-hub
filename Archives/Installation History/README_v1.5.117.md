# v1.5.117 — Native CDC Historical Reconstruction Parser Repair

Changes only the read-only reconstruction preview module 135.

Repairs:
- Native CDC tombstones are detected from QueryResponse status, entity `status == "Deleted"`, or explicit Deleted boolean.
- Entity-level status is preserved as QboStatus.
- Modern request/acquisition timing is recovered from committed manifest `entityEvidence`.
- ObservedAt uses requestCompletedAt first; QBO response `time` remains QboResponseTime.
- EvidenceHashType and evidence status align with the established V2 source ledger.
- Delete observations receive `DELETE_TOMBSTONE`.
- Adds a hard preview gate requiring the already-established modern population to reconcile exactly 61/61 by NativeCdcEventId.

No writes.

Run only:

`previewQboNativeCdcHistoricalReconstructionV2()`

Expected before any 03 write:
- 41 attempts
- 32 committed runs
- 955 observations
- 894 initial-lookback observations
- 955 eligible
- modernIdentityGate.valid = true
- modernIdentityGate.exactEventIdentityMatchCount = 61
- findingCount = 0
