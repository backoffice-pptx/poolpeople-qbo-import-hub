# v1.5.112 — Native CDC Initial Lookback Reconciliation Audit

Read-only targeted audit of the proven initial Native CDC lookback run:

`a993402a-abb5-4fbd-b3c7-e67ea26c364e`

This package intentionally uses **source observation** terminology. It does not characterize the 894 returned records as 894 business changes.

## What it proves

1. Parses the immutable initial-run CDC evidence using the verified legacy shape:
   `CDCResponse[] -> QueryResponse[] -> <EntityType>[]`.
2. Reconciles the entity population to the manifest totals.
3. Checks current `03_Native_CDC_Events_V2` for this exact historical run.
4. Inventories all Native CDC lineage currently present in 05 and 06.
5. Reads only Native CDC physical payload shards from 06 and compares their
   EntityType + EntityId population to the initial lookback population.

## Run only

`auditQboNativeCdcInitialLookbackReconciliation()`

## Mutation

None. No Drive, workbook, Script Properties, trigger, payload, ingestion,
or State Application writes.

## Version note

v1.5.106 was never downloaded/installed.
v1.5.110 and v1.5.111 were also not downloaded/installed.
This diagnostic is intentionally issued as v1.5.112 so prior proposed package
numbers remain unambiguous in the project history.
