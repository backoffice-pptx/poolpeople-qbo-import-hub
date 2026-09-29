# v1.5.105 — Native CDC Source Ledgers V2

Adds controlled historical reconstruction/backfill for the source-specific Native CDC evidence ledgers.

## V2 sheets
- `02_CDC_Run_Manifest_V2` — one row per committed Native CDC acquisition cycle.
- `03_Native_CDC_Events_V2` — one row per entity observation reported by Native CDC.

The existing V1 02/03 sheets are not overwritten.

## Authority
Authoritative input is the immutable committed Native CDC Drive manifest/entity evidence. Current 05 and 06 remain downstream transformation/artifact controls and are not used to manufacture source evidence.

## First run — preview only
`previewQboNativeCdcSourceLedgerV2Backfill()`

This performs the full reconstruction and validation in memory but writes nothing.

Expected preview controls include:
- committed cycle count
- 20 source evidence units per committed cycle
- zero-observation evidence units retained upstream
- total Native CDC event count
- eligible/ineligible counts
- manifest returned/live/deleted totals exactly equal reconstructed evidence totals
- count of observations using the governed runCompletedAt fallback because historical recovery lacks requestCompletedAt

## Backfill
Run only after preview is reviewed:

`backfillQboNativeCdcSourceLedgerV2()`

The write is idempotent by `CdcRunId` in 02 and `NativeCdcEventId` in 03. It writes only the two new V2 sheets.

## Important
This does not resume Native CDC, Native CDC ingestion, Webhooks, FULL_EXPORT State Capture ingestion, or State Application. It does not modify 01, current 05, 06, immutable Change Payloads, Drive source evidence, Script Properties, or triggers.
