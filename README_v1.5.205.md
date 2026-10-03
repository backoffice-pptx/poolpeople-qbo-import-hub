# v1.5.205 — Taxable Sales Detail Current-Lineage Publication Repair

Step 1 of the controlled sales-tax evidence-contract migration.

- Preserves `02_Detail_Snapshots` as immutable evidence.
- Repairs future `01_Current` publication so rows retain `Snapshot_Sequence`, `Snapshot_Run_ID`, and `Report_AsOf_DateTime` from the exact latest accepted snapshot.
- Adds a read-only inspector that proves business-state equality separately from lineage-publication equality.
- Adds a guarded one-time repair that refuses to proceed if current business state differs from the latest immutable snapshot for any period.
- Rebuilds `01_Current` only from the latest immutable snapshot per period and verifies the postcondition.
- Adds a contract test reproducing the legacy blank-lineage defect and proving the repaired publication contract.

Recommended execution order:
1. `testQboTaxableSalesDetailCurrentLineageContract()`
2. `inspectQboTaxableSalesDetailCurrentLineage()` — preserve/log the pre-repair defect evidence.
3. `repairQboTaxableSalesDetailCurrentLineage()`
4. `inspectQboTaxableSalesDetailCurrentLineage()` — expected PASS.

No historical snapshot rows are rewritten by the repair.
