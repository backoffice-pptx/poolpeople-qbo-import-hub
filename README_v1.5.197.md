# v1.5.197 — Global ObservationId Uniqueness Reconciliation

Adds a bounded, resumable, evidence-read-only global uniqueness audit for the historical physical Observation Index.

## Gate

Requires the exact completed v192 reconciliation run `OBS_INDEX_FINAL_RECON_V192|6a9e8043-c161-485d-935b-9b1ca0796d2f` with 2,418 triplets, 734,858 observations, the 734,786 / 52 / 20 classification partition, and zero v192 failure counters.

## Method

The collection pass reads each reconciled shard once, verifies its stable-body hash and ObservationId vector/count contract, and routes each exact `OBS|<sha256>` ID to one of 16 first-hex-prefix tabs in a dedicated audit spreadsheet. Source evidence is never modified. The evaluation pass loads one prefix partition at a time and performs exact string comparison, keeping memory bounded.

Terminal invariants:

- scanned ObservationIds = 734,858
- sum of prefix populations = 734,858
- distinct ObservationIds = 734,858
- global duplicate ObservationIds = 0

Successful completion status is `COMPLETE_PENDING_DEEP_LINEAGE_CHRONOLOGY_RECONCILIATION`.

## Operator functions

Run `testQboObservationIndexGlobalIdReconciliationPrerequisitesV197()` first. It is read-only.

After the prerequisite passes, run `startQboObservationIndexGlobalIdReconciliationV197()` once. Continuations are automatic.

Use `statusQboObservationIndexGlobalIdReconciliationV197()` for read-only status checks.
