# v1.5.221 — Phase G Global Equal-Time Recovery Counter Correction

## Purpose
Correct the v1.5.220 recovery assumption after runtime proved that the next uncommitted manifest contains 250 observations while the saved cursor 1117 already includes all three manifests committed by the failed v1.5.219 invocation.

## Locked recovery state
- Same run: `PHASE_G_GLOBAL_TIE_V1219|f8717a54-3a18-476a-8fa0-4f27a8c03f92`
- Durable cursor: 1117 / 2418
- Durable observations: 264892
- Durable admitted: 264872
- Durable evidence exceptions: 20
- Durable blocked: 0
- Saved iterator token identifies the next uncommitted manifest (1118).

## Recovery behavior
`recoverQboStateApplicationV2PhaseGGlobalEqualTimeDiagnosticV1221()`:
1. Requires the exact failed checkpoint above and existing Phase G authority gates.
2. Resolves the next uncommitted manifest from the saved iterator token.
3. Verifies its immutable shard/lookup/manifest triplet.
4. Removes any rows for that manifest's ObservationIds that may have been partially written before the Spreadsheet service failure.
5. Preserves all committed counters exactly; no rollback is performed.
6. Restores `BUILDING_GLOBAL_PARTITIONS` and resumes the same run/workbook.

The v1.5.220 idempotent cleanup-before-append barrier remains active for all subsequent manifests, so a transient Spreadsheet failure cannot create duplicate rows when retried.

Replay remains disabled. State Application sheets 10/11/12 are not written.
