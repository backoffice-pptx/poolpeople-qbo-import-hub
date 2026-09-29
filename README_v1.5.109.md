# v1.5.109 — Native CDC Legacy Run Evidence Audit

Read-only targeted audit of the three `QBO_Native_CDC_Run_*` folders discovered by v1.5.108.

## Goal

Establish what the immutable Sep. 10 legacy evidence actually supports before creating:

- `02a_CDC_Run_Attempts_V2`
- `02b_CDC_Committed_Runs_V2`
- corrected/rebuilt `03_Native_CDC_Events_V2`

The diagnostic does not invent a modern CycleBucket for pre-CycleId runs. It derives a deterministic candidate historical identity as:

`LEGACY_NATIVE_CDC_RUN|<UUID from immutable folder name>`

and reports that identity basis explicitly.

It inventories every file recursively, parses JSON evidence, reports manifest status/watermark/counts, summarizes entity evidence where detectable, and searches `06_Payload_Artifacts` for rows containing the legacy UUID/run/folder identity.

## Run only

`auditQboNativeCdcLegacyRunEvidence()`

## Mutation

None. It does not modify Drive, Sheets, Script Properties, triggers, payloads, ingestion state, or State Application.

Do not run v1.5.106 yet.
