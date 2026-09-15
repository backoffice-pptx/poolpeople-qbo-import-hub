# v1.5.102 — Payload Artifact Source Population Audit

Read-only diagnostic explaining the workbook-level difference between
`SUM(05_Forward_Ingestion_Control.ObservationCount)` and
`SUM(06_Payload_Artifacts.ObservationCount)`.

## Added
- `125_QBO_PayloadArtifactSourcePopulationAudit.js`

## Run
`auditQboPayloadArtifactSourcePopulation()`

## Classification
Each exact source represented in 06 is classified as:

- **05_BACKED** — exact source exists once in 05. The audit compares 05 vs 06
  observation, payload, and shard totals.
- **01_ONLY_HISTORICAL** — absent from 05, exact source exists once in 01, and
  every 06 row has governed `HIST_PAYLOAD|...` / `HISTWU|...` historical lineage.
- **UNEXPLAINED** — identity or lineage cannot be proven by those rules.

The audit also lists 05 sources that do not yet have any 06 rows. This is
important while the 06 historical backfill is still running.

## Safety
READ ONLY:
- no physical payload files are opened or changed;
- no writes to 01, 05, 06;
- no Script Properties or trigger changes;
- no ingestion or State Application changes.
