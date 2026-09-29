# v1.5.187 — Immutable payload read hardening + cursor-2540 recovery

The v1.5.186 diagnostic proved artifact 2540 is intact:
- JSON parses normally on reread;
- canonical `stableBody` hash exactly matches the authoritative 06 `PayloadShardHash`;
- 250 observations are present;
- FULL_EXPORT chronology registration is present.

v1.5.187 therefore treats the prior `INVALID_JSON` as a transient/incomplete Drive read, not an evidence exception.

Changes:
- bounded reread/reparse of an immutable Change Payload only when JSON parsing fails;
- maximum 4 parse attempts with exponential delay beginning at 1 second;
- each attempt still uses the existing bounded transient Drive-service read retry;
- after successful parse, all existing stableBody/hash/count/ObservationId-vector checks remain mandatory;
- semantic hash/count/vector/chronology failures are never retried;
- exact recovery boundary added for cursor 2540 with all frozen counters;
- recovery provenance advances to 1.5.187;
- no evidence exclusion or exception is added for these 250 observations.

Run first:
`validateQboObservationIndexArtifact2540RecoveryV187()`

Only after that gate is reviewed should the existing governed no-argument recovery
`recoverQboObservationIndexHistoricalShardDrainV181()` be run once.
