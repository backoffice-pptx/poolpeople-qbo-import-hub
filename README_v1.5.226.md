# App 50 v1.5.226 — GL registry atomic timestamp repair + controlled a98b recovery

Scope: Step 6B only.

Changes:
- Repairs `appendQboGeneralLedgerRun_()` so `ExtractedAt` is persisted atomically in the initial registry row `setValues()` call. Timestamp formatting occurs after persistence; the existing flush/readback semantic verification remains.
- Adds zero-argument read-only contract test `testQboGeneralLedgerRegistryAtomicWriteV1226Contract()`.
- Adds zero-argument controlled recovery `recoverQboGeneralLedgerRegistryExtractedAtV1226ForFailedA98b()` for the already-created V2 run `a98b060b-ac45-4c05-a2b0-5c8670b5fc3f`.
- Recovery writes only the existing run registry's `ExtractedAt` cell after exact workbook/run/snapshot/period/row-count checks and independent agreement between 2,215 persisted GL rows and immutable V2 metadata at `2026-10-04T06:17:00.941Z`.
- Does not create a GL snapshot, registry run, or QBO acquisition during contract/recovery.

Operator order:
1. Run `testQboGeneralLedgerRegistryAtomicWriteV1226Contract()`.
2. Only if PASS, run `recoverQboGeneralLedgerRegistryExtractedAtV1226ForFailedA98b()`.
3. Do not run a fresh GL acquisition until the recovery result has been reviewed.
