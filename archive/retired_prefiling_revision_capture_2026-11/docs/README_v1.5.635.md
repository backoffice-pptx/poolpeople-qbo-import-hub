# App 50 v1.5.635 — stranded recovery checkpoint hardening

**Candidate; no production capture authorization.** Both versioned modules retain `PRODUCTION_RELEASED:false` in the integrated gate.

## Install

Add `1653_QBO_PrefilingRevisionRecoveryHardeningV15635.js` and `1654_QBO_PrefilingRevisionIntegratedGateV15635.js` to the root of `50 QBO Import Hub Standalone`. Keep 1649–1651 and existing exporter files intact. Review changes, then `clasp push`.

## Scope

The new v1.5.635 recovery object retains v1.5.631 independent evidence certification and candidate uniqueness checks. It uses the durable in-flight error marker to identify the family rather than advancing from populated checkpoint fields. If the checkpoint is already fully attached, it requires exact identity agreement, independently certifies the evidence and writes only the status transition; no exporter invocation. Partial or conflicting checkpoints fail closed. Earlier/later family checkpoint order and Recognition GL lineage are checked.

## Read-only checks

`previewRegistryQboPrefilingIntegratedGateV15635()` and `certifyRegistryQboPrefilingRevisionV15635()` are parameterless read-only functions. Recovery preview requires explicit control/request/family/candidate arguments. `attachConfirmedQboPrefilingRecoveryV15635(...)` is a **production write** and must not be invoked until there is a real interrupted request with independently verified evidence and operator authorization.

## Validation

`fixtures/rev635_recovery_test.js` uses offline mocks. 12/12 tests passed, including a stranded GL checkpoint, conflict, partial checkpoint, and failed certification. The fixtures do not simulate all TSD/Recognition write interruptions or real Apps Script execution. No live export or workbook mutation performed.

## Hold

Do not enable production capture or run `runOneQboPrefilingIntegratedCaptureV15635` / `finalizeQboPrefilingIntegratedCaptureV15635`. Production release requires separate authorization.
