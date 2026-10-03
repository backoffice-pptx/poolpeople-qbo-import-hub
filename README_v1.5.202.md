# v1.5.202 — Final Historical Logical-07 Trust Certification

This is the final combined historical deep-lineage + chronology gate before
paused evidence catch-up.

It is evidence-read-only. It creates only:
- a dedicated audit spreadsheet containing the exact Change Payload ObservationIds,
- one bounded Script Property checkpoint,
- one one-time continuation trigger.

## What it proves

1. Re-reads all 3,455 rows of `06_Payload_Artifacts` and all immutable Change
   Payload shards.
2. Revalidates shard hashes/counts and the governed 55-observation controlled-test exclusion.
3. Revalidates all 734,779 FULL_EXPORT observations against exact
   `01_Sources.ObservationCompletedAt`.
4. Builds the exact 734,858 non-excluded Change Payload ObservationId set.
5. Compares that set exactly, prefix-by-prefix, to the already globally-unique
   734,858 ObservationIds in the completed v1.5.197 audit workbook.
6. Re-runs the validated v1.5.200 historical Webhook chronology gate.
7. Re-runs the validated v1.5.201 historical Native CDC chronology gate.
8. Completes only if every source population and identity/chronology invariant passes.

Expected source partition:
- FULL_EXPORT: 3,409 artifacts / 734,779 observations
- Native CDC: 24 / 58
- Webhook: 21 / 21
- governed controlled-test exclusion: 1 / 55
- physical 06 total: 3,455 / 734,913
- logical 07 total: 734,858

## Run

Start once from Apps Script:

`startQboFinalHistorical07TrustCertificationV202`

The continuation chain is automatic.

Status is directly runnable:

`statusQboFinalHistorical07TrustCertificationV202`

Do not manually invoke the continuation function.
Do not restart while status is running.
