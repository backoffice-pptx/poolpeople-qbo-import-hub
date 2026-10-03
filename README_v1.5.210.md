# App 50 v1.5.210 — TSD Date-Safe Current Publication Writer

## Purpose

Introduces a date-safe physical publication path for `QBO_Taxable_Sales_Detail_Data` `01_Current` after the v1.5.209 diagnostic proved that the failed v1.5.208 write/rollback path stripped Date-valued cells from the mutable Current publication.

Immutable `02_Detail_Snapshots` remain the source of truth and are not modified.

## Writer contract

The publication writer serializes governed Date-valued snapshot fields before `setValues()`:

- `Report_AsOf_DateTime` → stable ISO timestamp representation.
- `Recognition_Date` → canonical date-only semantic value.
- `Source_Transaction_Date` → canonical date-only semantic value.

Post-write comparison is semantic: equivalent Google Sheets physical representations must normalize to the same governed value.

## Isolated runtime result

The v1.5.210 temporary-workbook contract test established that:

- the serialized row was semantically equal to the snapshot;
- the physical writer preserved semantic dates and complete lineage;
- Google Sheets returned `Report_AsOf_DateTime` as a String;
- Google Sheets returned the two date-only fields as native Date values.

The overall contract test nevertheless failed because it incorrectly required the date-only fields to remain physical strings before/through the round trip.

No production mutation was performed. The temporary test file was trashed.

## Disposition

Writer behavior was semantically sound. Production recovery remained blocked pending correction of the test contract's physical-representation assumptions.
