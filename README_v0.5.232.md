# v0.5.232 — sequence 4 isolated fresh capture

Merge each project folder into its complete local repository; clasp push separately in App 21 and App 50. Do not clear either project directory. Existing v221 operators and the sequence 3 proof are preserved.

App 21: prepareSalesTaxNewPairFreshCaptureV05232
App 50: testSalesTaxIsolatedFreshCaptureV05232Contract
App 50: previewSalesTaxIsolatedFreshCaptureV05232
App 50: processSalesTaxIsolatedFreshCaptureV05232

Stop if any function fails. Return the final capture log. App 21 setup creates one isolated proof and request. It checks recovered sequence 4 timestamps, zero expected/recorded economic changes, no production pre-filing registration, and the exact recorded validated pair. It then revalidates the physical pair through the existing V3 loader. No production activation or registration is performed. Original PARTIAL ingestion log is preserved and completion is not retroactively certified.

Summary e32ad4cc-12a7-42e3-9916-37f9ebbe4817; Detail 0cc9d157-b9e1-4b1d-9ec4-66165d8f5bdb; pairing 84bd9d8f-5263-4a63-b057-98f5fc7b0c0d; period 2609. Run V3_FRESH_PROOF_PREFILING_2609_1011. Proof name ISOLATED_V3_FRESH_CAPTURE_2609_V05232. App 21 property SALES_TAX_NEW_PAIR_FRESH_CAPTURE_V05232_BOOK_ID.

App 50 routes only the exact isolated request to the established acquisition worker. It performs fresh September GL, TSD and Recognition acquisition in normal evidence stores, writing completion to the isolated request ledger. Production control and isolated run registry are checked unchanged. Previous sequence 3 capture run IDs are reuse exclusions, not inputs to the new capture. This operator does not bind the completed capture, bind Bank, freeze a manifest, publish a report, or activate V3.

The fresh TSD/Recognition results will determine whether the reported invoice 64842 and 64965 checkbox corrections close the prior 115.87 taxable discrepancy. Do not assume Liability totals must change: these zero-rate corrections may change TSD classification while Liability totals and tax due stay unchanged.

Local App 50 contract checks passed 13/13. They are local code checks, not QBO acquisition or Apps Script runtime certification. Physical setup and capture must be executed in the respective Apps Script projects. Existing dependencies through v231 App 21 and established capture worker App 50 are required.
