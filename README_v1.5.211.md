# App 50 v1.5.211 — TSD Semantic Date Writer Contract Refinement

## Purpose

Refines the v1.5.210 isolated writer contract so acceptance is based on normalized semantic date equality rather than the physical JavaScript type returned by Google Sheets.

Production recovery remains blocked until the isolated contract passes.

## Runtime result

The v1.5.211 isolated temporary-workbook test proved:

- serialized publication row semantically equals the immutable snapshot;
- physical `Report_AsOf_DateTime` reads back semantically exactly;
- physical `Recognition_Date` reads back semantically exactly;
- physical `Source_Transaction_Date` reads back semantically exactly;
- the isolated physical writer preserves core business state, full source representation, and lineage.

Observed physical types remained:

- `Report_AsOf_DateTime` — String
- `Recognition_Date` — Date
- `Source_Transaction_Date` — Date

The overall test still failed because two obsolete pre-write assertions required `Recognition_Date` and `Source_Transaction_Date` to already be canonical date-only strings. Those assertions tested representation rather than governed semantic equality.

No production mutation was performed. The temporary test file was trashed.

## Disposition

Remove the obsolete pre-write physical-format assertions. Physical type is diagnostic only; normalized semantic equality is authoritative.
