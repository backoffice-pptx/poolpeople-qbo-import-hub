# v1.5.104 — Gate A Native CDC Source Identity Parser Repair

## Change
Repairs the read-only v1.5.103 Gate A audit parser for Native CDC source identity.

Actual permanent Native CDC source identity is:
`NATIVE_CDC|<CycleBucket>|<CycleUuid>|<EntityType>`

The governed `CdcRunId` is:
`<CycleBucket>|<CycleUuid>`

v1.5.103 incorrectly assumed `CdcRunId` contained no pipe, causing all 24 Native CDC artifact populations in the completed 06 ledger to be reported as `NATIVE_CDC_SOURCE_ID_NOT_DERIVABLE`.

## Scope
- Changed file only: `126_QBO_PayloadArtifactPermanentLineageAudit.js`
- READ ONLY.
- No production evidence, workbook data, payloads, properties, triggers, or State Application are modified.

## Run
`auditQboPayloadArtifactPermanentLineage()`

## Expected effect
The 24 previously unresolved Native CDC artifact rows should classify under the governed Native CDC lineage path, most likely `NATIVE_CDC_02_03_BACKFILL_REQUIRED` while 02/03 remain empty.
