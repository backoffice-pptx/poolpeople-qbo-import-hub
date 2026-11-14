# V1302 — Existing evidence adoption (review build)

Install `1631_QBO_PreFilingExistingEvidenceAdoptionV1302.js` into App 50 only after source review.

Run `testPreFilingCaptureEvidenceAdoptionContractV1302`, then `previewSelectedPreFilingCaptureEvidenceAdoptionV1302`. **Do not run apply until preview is reviewed.**

The preview uses the App 21 governed `PREFILING_WORKING_RUN_ID`, the existing capture ledger, and App 50 source workbooks. It fails closed unless there is exactly one successful TSD and Recognition log and one GL V2 run for the selected period. It validates GL V2 snapshot contents/metadata and Recognition GL lineage. It will not export anything.

Apply function: `applySelectedPreFilingCaptureEvidenceAdoptionV1302`. It fills the 9 evidence fields, processing/completion timestamps and status in the same existing request row; it does not invoke export functions, create a request, modify latest flags, or bind the App 21 pre-filing registry. That final binding and readiness remain separate gates.

**Important:** The current legacy `processLatestRequestedSalesTaxPreFilingCapture()` still performs fresh exports. Do not execute it for October. Future monthly routing must distinguish fresh acquisition from validated evidence adoption; this patch does not change that wrapper.

Potential issue to inspect: Recognition and TSD `90_Ingestion_Log` rows must have `Status=SUCCESS` and matching `Row_Count`; if evidence is ambiguous, preview stops rather than selecting newest. No October IDs are embedded.

This build is syntax-checked locally but not tested against production Google Apps Script.
