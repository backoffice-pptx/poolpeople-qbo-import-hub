# v1.5.184 — Drive partial-commit recovery and transient retry

This release recovers the exact artifact-1864 failure proven by v1.5.183:
`SHARD_LOOKUP_PARTIAL`, manifest absent, no checkpoint advance.

Changes:
- exact recovery precondition for the frozen cursor-1864 state;
- state provenance advances to `1.5.184` on recovery;
- deterministic create-or-verify now retries only `Service error: Drive`;
- every retry re-lists the deterministic filename before create, so an ambiguous create failure is reconciled instead of blindly duplicated;
- semantic conflicts, duplicate filenames, hash mismatches, chronology failures, and lineage failures are never retried;
- durable shard/lookup/manifest verification reads get the same bounded transient-Drive retry;
- authoritative source reload for admission counts gets bounded transient-Drive retry;
- removes the unused admission-proxy count pass;
- controlled-test exclusion behavior remains unchanged.

Run `validateQboObservationIndexDrivePartialRecoveryV184()` first.
Only after that gate passes, run `recoverQboObservationIndexHistoricalShardDrainV181()` once.
The existing function name is retained as the governed no-argument operator; the deployed recovery implementation is v1.5.184.
