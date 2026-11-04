# v1.5.103 — Permanent Source Lineage Gate A

## Purpose
Read-only Gate A audit of every `06_Payload_Artifacts` row against the permanent source-specific evidence architecture.

## Permanent source ownership
- FULL_EXPORT / FULL_EXPORT_LEGACY -> `01_Sources`
- NATIVE_CDC -> `02_CDC_Run_Manifest` + `03_Native_CDC_Events`
- WEBHOOK -> `04_Webhook_Events`
- `05_Forward_Ingestion_Control` is corroborating transformation/checkpoint evidence, not source-lineage authority.
- `06_Payload_Artifacts` remains physical artifact authority.

## Important
- READ ONLY.
- No writes to 01/02/03/04/05/06, Drive evidence, payloads, Script Properties, triggers, ingestion state, or State Application.
- Does not treat `RegistrationMode` or `IngestionRunId` as permanent source identity.
- Because 02/03/04 have not yet been governed/backfilled, valid CDC/Webhook lineage can be reported as `*_BACKFILL_REQUIRED`.
- Historical webhook processing identity `WEBHOOK|HISTORICAL|<ReceiptId>|EVENT|<Index>` is normalized only for audit classification to permanent event identity `WEBHOOK|<ReceiptId>|EVENT|<Index>`; no data is changed.
- Known controlled-test lineage removed by the governed disposition is surfaced explicitly as `CONTROLLED_TEST_ORPHAN`, not silently accepted.

## Run
`auditQboPayloadArtifactPermanentLineage()`

## Gate A interpretation
The audit is designed to establish the exact artifact/source populations that the 02/03/04 and 05 V2 migrations must reproduce and reconcile. Do not migrate/backfill those ledgers from this module.
