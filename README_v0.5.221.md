# v0.5.221 — Exact new-pair App50 acquisition wrapper
Install1633 in complete App50; clasp push. App21 companion setup must finish first.
Run testSalesTaxIsolatedFreshCaptureV05221Contract, previewSalesTaxIsolatedFreshCaptureV05221, then processSalesTaxIsolatedFreshCaptureV05221 after preview PASS.
The existing parameterized acquisition worker handles a single exact new isolated request. Wrapper is bound to new sequence3 Summary/Detail/evaluation and a distinct new proof name/run. It rejects production destination, incomplete setup, mismatched pair/context, old capture reuse, and checks production control/proof registry preservation.
Fresh evidence exports use existing normal stores. It does not promote or bind the run or activate V3. Short lease claim/release avoids holding ScriptLock across exports. Failed requests can be inspected/retried through the exact wrapper; do not run the latest-production-request operator.
Source based on App50 full source export 20261010_212931; old wrapper retained unchanged.
