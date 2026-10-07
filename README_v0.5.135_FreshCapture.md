# v0.5.135 — exact isolated fresh capture worker (App 50)

Prerequisite: App 21 runSalesTaxFreshCaptureSetupV05135() completed successfully.

Install this additive file into project `50 QBO Import Hub Standalone`, clasp push, then run:
1. testSalesTaxIsolatedFreshCaptureV05135Contract()
2. previewSalesTaxIsolatedFreshCaptureV05135()
3. If the preview PASS selects the new proof request in REQUESTED state: processSalesTaxIsolatedFreshCaptureV05135()

Do not use processLatestRequestedSalesTaxQboCapture: it selects the production ledger.

The new operator requires a unique exact-name native proof workbook, a completed isolated marker with matching production ID, one explicit V3 non-latest run, an exact fresh request identity and September dates, and the validated pair IDs. It delegates the existing processSalesTaxPreFilingCaptureRequest with that exact proof workbook/request. It does not alter the existing processor or global defaults.

A short ScriptLock protects a separate 15-minute request lease; no project ScriptLock is held across the exports. The normal worker's GL/TSD checkpoints and FAILED response remain available. PROCESSING requests fail closed; do not retry a timed-out operator without reviewing the log. A completed retry verifies and makes no fresh API acquisition. Ordinary QBO evidence stores/current views are updated by the normal exporters. Production control workbook and non-ledger proof tabs must remain physically unchanged. This does not bind capture to the proof registry or certify a complete V3 run.

Local validation used the actual existing worker with mocked exporter boundaries to verify three fresh acquisitions, checkpoint completion, no capture binding, lease cleanup and completed no-acquisition retry. Actual QBO/Sheets persistence still requires runtime validation.
