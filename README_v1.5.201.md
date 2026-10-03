# v1.5.201 — Historical Native CDC Chronology Diagnostic

Read-only deep-lineage/chronology audit for the exact historical Native CDC
population already represented in 06 / Change Payload / logical 07.

Expected population:
- 24 Native CDC 06 artifacts
- 58 Change Payload observations
- 58 exact logical-07 ObservationIds

The diagnostic reconciles each observation to `03_Native_CDC_Events_V2` and
classifies its chronology basis as:

- `REQUEST_COMPLETED_AT` when 03 `ObservedAt == RequestCompletedAt`
- `RUN_COMPLETED_AT_FALLBACK` when historical recovered evidence has blank
  `RequestCompletedAt` and 03 retains the governed committed-run fallback
- invalid/mismatch otherwise

It also verifies payload-to-07 ObservedAt and evidence-file lineage.

Requires the already validated v1.5.200 physical-07 locator.

Run directly:

`auditQboHistoricalNativeCdcChronologyV201`

No workbook, Drive, Script Properties, trigger, ingestion, or State Application writes.
