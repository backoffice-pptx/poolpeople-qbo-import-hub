# App 50 v1.5.222 — GL Step 6B live-registry diagnostic

Read-only diagnostic increment. No production GL export or registry repair is performed.

Operator functions:
- `testQboGeneralLedgerLiveRegistryV1222Contract()`
- `diagnoseQboGeneralLedgerLiveRegistryV1222ForFailedA98b()`

The diagnostic compares the ExtractedAt cell for the pre-filing legacy run, recovered V2 run, and failed a98b V2 run; inspects formats/formulas/notes/validation/merged ranges/protections; verifies the failed run timestamp independently from the cumulative GL rows and V2 00_Metadata; and reports spreadsheet locale/timezone and exact live registry identity.
