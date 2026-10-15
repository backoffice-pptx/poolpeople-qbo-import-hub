# v0.5.233 — interrupted sequence 4 capture inspection

Merge into complete App 50, clasp push, then run inspectSalesTaxSequence4CaptureTimeoutV05233. Return the log. No retry/reset operator is included.

Exact isolated proof 1874i0XHm2s-vFrk9MG2Ctx5vWQ55GGoClNUFa685MbY; request fe40ed2e-d7d5-4490-9707-c02cfc738b6f; interrupted GL run bdb730d2-6b3e-4462-b427-f74fada528e6.

Reads the exact request without requiring REQUESTED/FAILED (a hard termination may leave PROCESSING), validates its marker/context, exposes all acquisition checkpoints/error/status, counts GL master rows with the interrupted run ID, inspects exact GL run registry records and physical file presence for recorded snapshot IDs. Master row presence alone never certifies snapshot completion. Physical file presence is not full artifact content validation. A zero registry row count means no committed run registry evidence was found, not that no orphan file can exist.

Checks proof values and GL registry values unchanged during inspection. No QBO acquisition, file creation, request mutation, registry repair, capture binding, or V3 activation. Local JavaScript syntax check passed; Apps Script execution is pending. This may still be affected by an ongoing Sheets service timeout; retrying this read-only inspector is safe.
