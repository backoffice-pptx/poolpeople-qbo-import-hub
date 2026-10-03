# App 50 v1.5.206 — TSD Current mismatch decomposition

Read-only diagnostic increment following the v1.5.205 production inspector finding.

Run in order:
1. `testQboTaxableSalesDetailCurrentMismatchDiagnosticContract()`
2. `inspectQboTaxableSalesDetailCurrentLineage()`

Do NOT run `repairQboTaxableSalesDetailCurrentLineage()` until the v1.5.206 diagnostic output has been reviewed.

The diagnostic separates core governed business fields from lineage metadata and raw/source representation. It reports exact, expected-only, current-only, core-changed, and representation-only rows with bounded samples and taxable deltas. No production data is mutated by either requested operator.
