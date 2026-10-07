# App 50 v1.5.214 — State Application V2 Phase G controlled-disposition manifest

## Purpose
Preserve immutable evidence of the exact legacy/partial V2 State Application population and abandoned Canonical V2 rebuild/migration Script Properties before any controlled disposition.

## Run
`preserveQboStateApplicationV2PhaseGDispositionManifestV1214`

## Safety
- Does **not** clear/delete/rewrite `10_Snapshot_Records`, `11_Change_Records`, or `12_Change_Detail`.
- Does **not** authorize legacy module 95.
- Requires the exact Final Historical 07 certification and exact v1.5.213 V2 population fingerprints.
- Fails closed if legacy Canonical V2 triggers are active or the V2 population drifted.
- Creates a dedicated evidence spreadsheet containing each legacy V2 record ID, source row number, and full-row SHA-256 plus a snapshot of legacy rebuild/migration Script Properties.
- Stores one bounded pointer/state property: `QBO_PHASE_G_V1214_MANIFEST_STATE`.

## Next gate
A later version must independently verify the manifest/token and recheck that the State Application V2 population is unchanged before controlled clearing/reinitialization is allowed.
