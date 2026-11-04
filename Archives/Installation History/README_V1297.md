# V1297 — invocation-scoped identity propagation (REVIEW)

**NOT PRODUCTION-AUTHORIZED. Keep scheduler paused.** Based on source archive `50_QBO_Import_Hub_Standalone_Source_20261103_174030.zip`, which predates deployment of V1296 design-only module. Compare replacements against current source.

Replaces `24_TriggerManagement.js` and `21_ExportFramework.js`; adds `4297_QBO_WorkerPropagationV1297.js`.

The scheduled exporter invocation receives an execution-local immutable identity via a scoped `try/finally`. Workbook lease metadata is sourced from this context when present, rather than mutable scheduler Script Properties. Other/manual exporters retain legacy metadata behavior.

**Limitations:** Lease ownership is NOT verified against immutable context at each Sheets mutation. This does NOT solve long in-flight Sheets writes, abandoned leases, execution-liveness verification, or automatic recovery. Do not claim full fencing. Scope is a JavaScript execution global, not a persistent cross-execution attestation. Validate compatibility with all exporter invocation paths before deployment.

After source diff review, tests: `testQboWorkerPropagationV1297`, `previewQboWorkerPropagationV1297`.
