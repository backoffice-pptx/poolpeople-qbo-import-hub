# v1.5.101 — Targeted Source → Payload Audit

Changed-file package for **50 QBO Import Hub Standalone**.

## Added
- `124_QBO_TargetedSourcePayloadAudit.js`

## Purpose
Read-only end-to-end audit of one exact FULL_EXPORT source:
- original source workbook observation population,
- exact `05_Forward_Ingestion_Control` aggregate,
- exact `06_Payload_Artifacts` rows,
- actual physical Change Payload JSON shards.

The diagnostic independently opens every physical shard identified by the exact 06 source identity and compares actual `payloads.length`, `stableBody.observationCount`, observation IDs, hashes, cursor ranges, and source identity.

## Default target
`FULL_EXPORT|0815f34c-ba66-4ed0-b2fb-89b9be3ecf1e|INVOICES`

## Run
`auditQboTargetedInvoiceSourcePayloads()`

Generic entry point:
`auditQboTargetedSourcePayloads('<exact IngestionSourceId>')`

## Safety
READ ONLY. No writes to 01, 05, 06, source evidence, payload artifacts, Script Properties, triggers, ingestion state, or State Application.
