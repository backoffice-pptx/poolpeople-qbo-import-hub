# v1.5.198 — Historical Webhook Chronology Diagnostic

Read-only diagnostic for the 21 WEBHOOK observations already represented by
historical `06_Payload_Artifacts` and logical 07.

## Purpose

For every existing webhook observation, compare:

- current logical-07 `ObservedAt`
- immutable Change Payload `observedAt`
- `04_Webhook_Events_V2.ReceivedAt`
- `04_Webhook_Events_V2.TargetedCaptureAt`
- source change time / operation / exact receipt-event lineage

The diagnostic is intended to determine whether any historical webhook DELETE
observation used processing time and whether non-DELETE observations use the
retained targeted-capture timestamp.

## Population gate

Expected existing historical population:

- 21 WEBHOOK 06 artifacts
- 21 WEBHOOK observations

The diagnostic fails closed if that population has drifted.

## Prerequisite

Exact completed global ObservationId reconciliation:

`OBS_INDEX_GLOBAL_ID_V197|431424dd-b788-4b78-b670-c77528552ca5`

## Run

Run directly from the Apps Script editor:

`auditQboHistoricalWebhookChronologyV198`

No `3490_QBO_OperatorCommands.js` wrapper is added because the function is
already directly runnable with no arguments.

## Safety

Read only. No writes to workbook evidence, Drive evidence, Script Properties,
triggers, ingestion state, or State Application.
