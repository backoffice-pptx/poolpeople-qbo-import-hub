# App50 v1.5.221 — Step 6B interrupted-run diagnostic + call-chain repair

Changes:
- Passes the exact production `extractedAt` into `createQboGeneralLedgerRunSnapshotV2_()`.
- Repairs unreachable V2 metadata validation so metadata is validated before success is returned.
- Adds zero-argument structural contract test `testQboGeneralLedgerRunSnapshotV1221Contract()`.
- Adds read-only interrupted-run diagnostic `diagnoseQboGeneralLedgerInterruptedRunV1221For2609()` for run `6885afa7-640e-4c2c-9751-492f2451cb22`.
- Diagnostic does not call QBO export and does not write production GL data.

Run only:
1. `testQboGeneralLedgerRunSnapshotV1221Contract()`
2. `diagnoseQboGeneralLedgerInterruptedRunV1221For2609()`

Do not rerun the September full-path fixture until the diagnostic is reviewed.
