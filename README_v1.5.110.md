# v1.5.110 — Native CDC Legacy Observation Audit

Read-only parsing of the two committed pre-CycleId Native CDC runs identified by v1.5.109.

Run only:

`auditQboNativeCdcLegacyObservations()`

It parses the 20 `cdc_<EntityType>.json` files per committed legacy run, reconciles parsed observations to manifest returned/live/deleted totals, reports entity counts and operation counts, and reports which evidence timestamp source is actually available for chronology.

No Drive, workbook, Script Properties, trigger, ingestion, payload, or State Application mutation.

v1.5.106 remains skipped/not installed.
