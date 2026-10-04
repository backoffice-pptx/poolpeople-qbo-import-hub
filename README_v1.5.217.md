# v1.5.217 — General Ledger run-only evidence snapshot (Step 6B)

## Scope
Prospective repair of the General Ledger evidence artifact contract. Historical `SnapshotFileId` values are not rewritten.

## Contract
- New successful GL extracts create `GL_RUN_SNAPSHOT_V2`: one immutable spreadsheet containing exactly `QBO_GENERAL_LEDGER_HEADERS` and only the rows for one `ExtractRunId` and one report period.
- `QBO_GeneralLedgerRuns` gains append-only `SnapshotArtifactContract`. Historical blank values are interpreted as `LEGACY_FULL_STORE_CONTAINER_V1`; new rows record `GL_RUN_SNAPSHOT_V2`.
- The existing cumulative `QBO_GeneralLedger` workbook remains the mutable historical store.
- Existing snapshot consumption remains backward-compatible because evidence rows continue to be selected by `SnapshotFileId + ExtractRunId + ReportStartDate + ReportEndDate`.
- Snapshot creation validates exact header, exact row count, exact run identity, and exact period before the extraction is accepted.
- This increment does not implement the separate `GL_MASTER_BACKUP_V1` disaster-recovery policy; that is Step 6C.

## Manual validation
1. Run `testQboGeneralLedgerRunSnapshotV1217Contract()`; expect 10/10 PASS.
2. Run `validateQboGeneralLedgerRunSnapshotV1217For2609()`; this is an explicitly named one-time September 2026 regression fixture and performs a real GL extraction.
3. Confirm the new run records `SnapshotArtifactContract = GL_RUN_SNAPSHOT_V2`, snapshot validation passes, and comparison against the prior September run succeeds.
