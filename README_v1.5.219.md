# App50 v1.5.219 — GL ExtractedAt Diagnostic

Step 6B diagnostic only. This package does not change the production GL export path.

Run in order:
1. `testQboGeneralLedgerExtractedAtV1219Contract()` — zero-argument contract test.
2. `diagnoseQboGeneralLedgerExtractedAtV1219Failed217For2609()` — read-only production diagnostic for interrupted run `8e6119f0-969c-4b03-8bde-b78a12df850d`, plus a temporary isolated Sheets Date round-trip test. The temporary spreadsheet is trashed before return.

Do not run a fresh September GL extraction until the diagnostic result is reviewed.
