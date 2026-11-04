# Native CDC v1.5.232 — capture-only readiness inspection

Add 4170_QBO_NativeCdcCaptureOnlyReadiness.js to App 50. Run inspectQboNativeCdcCaptureOnlyReadinessV1232 once and return the full execution log.

This diagnostic performs no QBO request and no writes or trigger changes. It reads a whitelist of live CDC properties and replay controls, current-user trigger inventory, and the latest manifest referenced by the saved cycle state. It computes the actual watermark age and configured lookback deadline with overlap, verifies manifest/cycle/watermark consistency and the manifest entity set, reports response counts including possible 1000-object saturation, and fingerprints deployed acquisition/handoff functions for source comparison.

Blockers are readiness findings, not authorization to resume. Even zero blockers does not authorize capture: the existing production collector automatically registers completed cycles in the ingestion ledger, and the reviewed source lacks a response-saturation guard. The next capture-only package must isolate this handoff and fail closed before watermark advancement on uncertain response completeness. It must preserve the existing watermark as the starting boundary, acquisition evidence, Phase G checkpoint/source population, and replay-disabled state.

The last-file name supplied by the user is only a clue. The durable live watermark and committed manifest establish the capture boundary. Configured initial lookback is 29 days; maximum lookback is 30 days, with a 15-minute overlap. The 29-day point is an operational margin, not the configured hard limit.

Manifest metadata verification does not rehash every entity payload or certify the entire source inventory. Any inconsistencies require evidence inspection before capture resumes. Trigger inventory is limited to the invoking user's visible triggers. The inspector reports all visible handlers so additional downstream or other-user controls can be reviewed.

The live global Phase G checkpoint is intentionally not read or hashed by this inspection because the journaled worker is legitimately progressing in parallel. No Phase G worker or recovery function is invoked. CDC/replay properties must remain unchanged during the inspection.

Source review used 50_QBO_Import_Hub_Standalone_Source_20261006_154451.zip. The diagnostic logs hashes of deployed functions; the subsequent mutation package must be bound to reviewed current code, rather than blindly replacing parallel changes.

Validation: Node syntax; mocked valid boundary, expired lookback, unpaused collector, enabled replay, downstream trigger and saturated response-count cases; absence of mutation/QBO request APIs. Live boundary validation remains pending.
