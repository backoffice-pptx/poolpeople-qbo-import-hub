# App 50 — v1.5.215 Phase G Controlled Disposition + Initialization

Run: `controlledDisposeInitializeQboStateApplicationV2PhaseGV1215`

Safety:
- Requires exact Historical 07 certification and exact v1.5.214 manifest pointer/content.
- Re-verifies all live legacy V2 counts, ID fingerprints, and full-row fingerprints before first deletion.
- Deletes only rows carrying the governed V2 version marker; preserves headers and all non-V2 rows.
- Checkpoints each cleared sheet and is resumable after a transient failure.
- Retires abandoned legacy Canonical V2 rebuild and migration cursor properties only after all three V2 populations are proven cleared.
- Initializes a new Phase G replay state with `replayAuthorized:false` and `replayWorkerEnabled:false`.
- Does not replay any observation.
