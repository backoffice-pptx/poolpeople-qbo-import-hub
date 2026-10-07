# App 50 v1.5.213 — State Application V2 Phase G Preflight

## Purpose

Begins Phase G only after the v1.5.204 Final Historical 07 trust certification completed successfully.

This increment is **read-only**. It does not start or resume the legacy Canonical V2 rebuild.

The existing `95_QBO_StateCaptureContractV2Rebuild.js` replays legacy AVAILABLE Master Backup sources by export/source index. That execution model predates the final governed 05/06 authority and is not the Phase G contract, which requires replay of the certified logical observation population by `ObservedAt`.

## Operator function

Run:

`preflightQboStateApplicationV2PhaseGV1213()`

## Controls

The preflight:

1. requires the exact terminal Historical 07 certification run and certified counts;
2. requires both Webhook and Native CDC chronology gates to have passed;
3. inventories legacy Canonical V2 worker/watchdog triggers without changing them;
4. inventories legacy Canonical V2 rebuild/migration Script Properties without changing them;
5. inventories and fingerprints existing V2 rows in `10_Snapshot_Records`, `11_Change_Records`, and `12_Change_Detail`;
6. explicitly reports `legacyModule95Authorized:false`;
7. identifies existing V2 rows and/or legacy rebuild state as requiring controlled disposition before the new observation-led replay can start.

No workbook, Drive, Script Property, trigger, or State Application mutation is performed.

## Next decision

Review the SUMMARY output. It is the evidence basis for the next increment: controlled disposition of any legacy V2 partial state and design of the observation-led Phase G replay.
