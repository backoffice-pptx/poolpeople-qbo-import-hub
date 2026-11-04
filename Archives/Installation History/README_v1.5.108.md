# v1.5.108 — Native CDC Attempt Classification Audit

## Purpose

Read-only historical evidence diagnostic supporting the proposed progression:

- `02a_CDC_Run_Attempts_V2` — all governed Native CDC acquisition attempts
- `02b_CDC_Committed_Runs_V2` — committed subset of 02a
- `03_Native_CDC_Events_V2` — observations belonging to committed runs

This version does **not** create either 02a or 02b.

It recursively finds every cycle/run-like folder in the governed Native CDC evidence root and classifies each folder exactly once from its folder identity plus manifest evidence.

Recognized classifications:

- `COMMITTED_SUCCESS`
- `FAILED_UNCOMMITTED`
- `SUCCESS_UNCOMMITTED`
- `INCOMPLETE_UNCOMMITTED`
- `MISSING_MANIFEST`
- `MULTIPLE_MANIFESTS`
- `INVALID_MANIFEST_JSON`
- `UNCLASSIFIED_MANIFEST`

The audit also compares the `COMMITTED_SUCCESS` subset to the current `02_CDC_Run_Manifest_V2`.

## Run

Run only:

`auditQboNativeCdcAttemptClassification()`

The execution log emits a compact `SUMMARY` first, followed by one `ATTEMPT` line per cycle-like folder. This avoids losing the key counts when Apps Script truncates large object output.

## Mutation

None. No workbook, Drive evidence, Script Properties, triggers, payloads, ingestion state, or State Application are modified.

Do not run v1.5.106 until this diagnostic closes the Native CDC attempt population.
