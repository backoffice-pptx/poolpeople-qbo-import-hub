# App 50 v1.5.212 — Final TSD Semantic Writer Contract and Current Recovery

## Purpose

Completes Step 1 of the controlled sales-tax evidence-contract migration by validating the semantic date-safe writer and recovering the mutable Taxable Sales Detail `01_Current` publication directly from the latest immutable `02_Detail_Snapshots`.

Historical snapshot evidence is never rewritten.

## Final isolated writer contract

`testQboTaxableSalesDetailDateSafeWriterV1212Contract()` requires:

1. the prepared publication row to be semantically equal to the immutable snapshot;
2. physical `Report_AsOf_DateTime` to normalize exactly;
3. physical `Recognition_Date` to normalize exactly;
4. physical `Source_Transaction_Date` to normalize exactly;
5. the isolated physical writer to preserve core business state, full source representation, and lineage.

Runtime validation: all five checks passed. The temporary test file was trashed.

Observed physical types are diagnostic only. In the validated run, report-as-of read back as String while both date-only fields read back as native Date values; normalized semantic values were exact.

## Controlled production recovery

After the isolated contract passed, `recoverQboTaxableSalesDetailCurrentV1212()` was authorized and executed.

Preconditions classified 202607, 202608, and 202609 as safe legacy Current-publication field-loss states with:

- zero taxable delta;
- no expected-only or current-only rows;
- no representation-only rows;
- changed fields limited to the previously proven Date-valued publication loss.

The recovery rebuilt `01_Current` from the latest immutable snapshot for each period using the date-safe writer.

## Runtime postconditions

All three periods passed core business, full source representation, and lineage equality:

| Period | Rows | Taxable |
| --- | ---: | ---: |
| 202607 | 215 | 44,803.50 |
| 202608 | 151 | 36,680.88 |
| 202609 | 261 | 34,785.61 |

Completion result:

- Status: `SUCCESS`
- Published rows: 627
- Periods: 3
- `Historical_Snapshots_Mutated`: false
- `Snapshot_Fingerprint_Unchanged`: true

## Rollback control

If a future recovery write fails, rollback is not considered successful merely because the rollback write completes. v1.5.212 verifies semantic restoration of the captured pre-mutation Current state. A failed restoration is reported distinctly.

This codifies the lesson from v1.5.208: rollback success requires proven semantic restoration.

## Final disposition

**TSD `01_Current` publication defect — RESOLVED.**

The immutable TSD snapshots were intact. The defect was confined to the mutable Current publication. v1.5.212 restored Current from immutable evidence and proved exact semantic and lineage equivalence without mutating historical snapshots.
