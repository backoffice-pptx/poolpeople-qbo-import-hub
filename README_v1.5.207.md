# App 50 v1.5.207 — TSD Current mismatch split-log diagnostic

Diagnostic-only increment. No production repair behavior is changed.

Purpose: preserve the v1.5.206 CORE_BUSINESS_FIELDS_V1 comparator while splitting runtime evidence into bounded per-period log records so Apps Script does not truncate the mismatch decomposition.

Run in order:
1. `testQboTaxableSalesDetailCurrentMismatchDiagnosticV1207Contract()`
2. `inspectQboTaxableSalesDetailCurrentLineage()`

Do NOT run `repairQboTaxableSalesDetailCurrentLineage()` until the diagnostic findings have been reviewed.
