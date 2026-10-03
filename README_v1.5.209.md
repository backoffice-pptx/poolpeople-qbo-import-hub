# App 50 v1.5.209 — TSD repair-failure diagnostic

Read-only diagnostic following the rolled-back v1.5.208 TSD Current repair.

Functions:
- `testQboTaxableSalesDetailRepairFailureDiagnosticV1209Contract()`
- `inspectQboTaxableSalesDetailRepairFailureV1209()`

No production mutation is performed. The diagnostic verifies rollback state,
source/target header mapping, the in-memory publication transformation, and
value-type profiles for fields implicated in the failed postcondition.
