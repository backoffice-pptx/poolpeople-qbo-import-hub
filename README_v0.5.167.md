# App 21 v0.5.167 — verified master backups, Current checkpoint index, August readiness recovery

Install every changed/added JS file in this folder. Retains v0.5.166 publication ownership guards. V3 is not activated.

Run in order:
1. `testSalesTaxMasterBackupsV05167` — eleven in-memory regression checks, no audit-data writes.
2. `backfillSalesTaxCurrentCheckpointIndexV05167` — indexes up to three existing Master Backups per execution. Repeat until COMPLETE. Already indexed files are skipped. It writes the index only; it never recalculates report data. Legacy metadata stays explicitly unverified; absent fields remain blank/UNKNOWN.
3. `previewAugustReadinessRecoveryV05167` — read-only exact Current/filed-checkpoint binding and saved-value check. Expect READY, Rows 15 (or ALREADY_RESTORED).
4. `restoreAugustReadinessFromFiledCheckpointV05167` — guarded restoration of the 15 saved readiness rows, with verified BEFORE_RECOVERY and AFTER_RECOVERY native copies. Exact restored retry is a no-op; conflicting existing August rows fail.

Current keeps `99_Master_Checkpoint` with exact file IDs, direct links, stage, period, available run/manifest lineage, timestamp and verification status. Copies use `99_Checkpoint_Identity` for their own metadata. The lifecycle checkpoint writer uses verified full copies and indexes them in Current. Historical, pre-filing and the historical supersession publisher use the same BEFORE_UPDATE / AFTER_UPDATE coordinator. Script locking serializes these covered operations. Other external writers must not change Current during execution; change detection supplements this lock but cannot lock external writers.

Full native copies retain all tabs, including unmanaged tabs. Verification compares non-formula values, formulas, number formats, notes, grid/frozen dimensions, merges and the existing index. Formula recalculation results are deliberately excluded from comparison. Other visual formatting, validation, charts and objects are preserved by native Drive copy but not individually verified. Copy failures stop before report mutation. A failure after update can leave a partially changed Current; the verified BEFORE_UPDATE checkpoint remains available. No automatic rollback is attempted.

The publication coordinator checks unrelated-period values after the update and preserves the index. Existing governed formulas stop publication before the report writer runs. These guards do not yet implement the broader planned schema-extra-column guard or append-only archive for replaced mode evidence.

August recovery pins Current 1jlPV0ePI_R4IUoefM1qvEFujAVxuUIMc_67WSMggeD8 and FILED checkpoint 1qB2RPcCCTQYp5NUfsMT61KnmTwwyHSmlKMprH0Km15s. Both must retain PreFiling f47ed9e8-bbf1-44db-944e-ecd12c15b26a, Level1 105c83a7-c923-499f-9648-9c2abb6b2de2 and manifest 36d787f4-8cc3-4f45-8768-65d461963985. Copies the historical saved content/formatting, including the then-saved finding descriptions, without updating them to later findings. Saved filing values: gross 36,358; taxable 36,681; non-taxable control -323; tax 3,026.18. Leaves September readiness and other sheets intact. Does not change approval/filing registries or reconstruct filing values.

Local checks: eleven coordinator/index regressions; actual audited Current/FILED capture recovery planning, exact restored retry and conflicting-row rejection. Runtime execution remains pending. No live audit sheets were changed while preparing this package.

Still planned: append-only shared evidence history, complete extra-column preflight, broader writer coverage, run-snapshot metadata/naming cleanup and separate Sheet2 investigation. Existing backups/run snapshots are not renamed, moved or deleted.
