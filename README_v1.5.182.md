# v1.5.182 — Governed controlled-test exclusion recovery

Repairs the v1.5.181 historical shard drain at the exact safe failure boundary.

The repair does **not** invent `ObservedAt`. It recognizes only a `FULL_EXPORT|STATE_CAPTURE_AUTOREG_TEST_*|...` artifact whose governed `01_Sources` chronology is absent. Before exclusion it re-reads the physical Change Payload shard and verifies its immutable hash, observation/payload counts, and observation-ID vector.

A governed exclusion consumes the physical 06 artifact and advances the artifact checkpoint, but creates no logical-07 records. State tracks `governedExcludedArtifactCount`, `governedExcludedObservationCount`, and the exact last exclusion. All other missing FULL_EXPORT chronology continues to fail closed.

For the currently proven population the final reconciliation equation is:

`734,858 logical-07 observations + 55 governed controlled-test exclusions = 734,913 physical-06 observations`.

Run `validateQboObservationIndexControlledTestExclusionRecoveryV182()` first. If valid, run `recoverQboObservationIndexHistoricalShardDrainV181()` once to resume the same historical run. The existing bounded continuation chain then continues. State Application remains disabled and legacy 07 is untouched.
