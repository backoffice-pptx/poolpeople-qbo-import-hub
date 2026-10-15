# Phase G v1.5.229 — read-only in-flight diagnostic

Add only 4140_QBO_PhaseGInFlightReadOnlyDiagnostic.js to App 50. Do not replace other modules. This is an additive diagnostic against the October 6 source export; it preserves the subsequent v1226–v1228 installed recovery modules.

Run inspectQboPhaseGInFlightV1229Part1 through inspectQboPhaseGInFlightV1229Part8 in order. Each reads eight partitions and prints per-partition results plus READ_COMPLETE. Return all eight execution logs. Stop if any guard fails; do not restart Phase G or run a recovery/continuation function.

Every invocation verifies the exact reported 1735 checkpoint, no visible continuation triggers, the in-flight source triplet hashes/references, 250 unique source ObservationIds, and that a fresh handle from the stored iterator token points to that exact manifest. The source artifact number 1719 is a filename identity; it is not assumed to be iterator cursor 1719.

Across all 64 partitions, logs establish physical row totals and missing, duplicate, mismatched, or misplaced in-flight rows. Source/shard/lookup evidence, diagnostic workbook, Script Properties and triggers are not changed. No replay or recovery is authorized.

Limit: this is an initial diagnostic, not certification of the entire committed population. The existing qboPhaseG1220RemoveManifestRows_ clears and rewrites whole affected partition ranges when retry rows already exist. A hard termination during that operation may damage committed rows. Even a matching aggregate row count and all 250 in-flight rows cannot certify all committed identities/content. A source-derived committed-population audit is required before recovery if that boundary remains uncertain. Partition totals should be compared against 405455 committed observations plus the physically present uncommitted observations, never by changing the checkpoint counters to fit the workbook.

Validation: Node syntax check; missing/exact/duplicate/mismatch comparison cases; exact checkpoint acceptance and changed cursor/count/token/workbook rejections; mutation API exclusion. Apps Script execution and real data validation remain pending. Trigger inventory is scoped to the invoking user's visible triggers.
