# App 50 v1.5.216 — Phase G controlled disposition verifier repair

Repairs the v1.5.215 manifest verifier without relaxing destructive controls.

- Normalizes the `DispositionAuthorized` manifest summary cell so either Boolean `false` or text `FALSE` is accepted as the same preserved false value.
- Recomputes the v1.5.214 manifest-detail population count, ID fingerprint, and row fingerprint for all three preserved V2 datasets before live-state disposition is allowed.
- Retains exact Historical 07 authority, no-legacy-trigger, live population count/ID/full-row fingerprint, V2-only deletion, sheet-by-sheet resumability, legacy-property retirement, and replay-disabled initialization controls.
- Does not authorize or start observation replay.

Run: `controlledDisposeInitializeQboStateApplicationV2PhaseGV1215`
