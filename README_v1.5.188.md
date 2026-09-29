# v1.5.188 — Folder-resolution Drive hardening + cursor-3132 recovery

Built from the fresh App 50 source export supplied 2026-09-24.

- Resolve governed shard/manifest/lookup folders once per worker invocation.
- Retry only `Service error: Drive` during folder resolution: 4 attempts,
  exponential delay starting at 1 second.
- Semantic folder identity/cardinality failures remain fail-closed.
- Add exact frozen cursor-3132 recovery boundary.
- Correct normal drain/recovery provenance to 1.5.188.
- No evidence counts, exclusions, or classifications changed.

Run first:
`validateQboObservationIndexFolderResolutionRecoveryV188()`

Do not recover until the gate is reviewed.
