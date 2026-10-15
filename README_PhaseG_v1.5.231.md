# Phase G v1.5.231 — certified counter correction and journaled recovery

Add only 4160_QBO_PhaseGJournaledRecovery.js. Retain 4140 (v1229), 4150 (v1230), and existing 4090/4100 source and authority helpers. No existing module is replaced. This changed-files package belongs under the exact project directory 50 QBO Import Hub Standalone/.

## Initial action

Run recoverQboPhaseGFromCertifiedAuditV1231 once. Send the COUNTERS_CORRECTED log. The activation invocation rechecks every current partition against the completed audit before any mutation, so it may take several minutes.

It requires the exact original checkpoint hash, run/workbook IDs, cursor 1735, completed exact audit run/workbook, all 64 partition results, zero Differences rows, source-derived totals 405205/405177/28/0, unchanged iterator/in-flight source, and no visible old Phase G continuation triggers.

The checkpoint correction is a single property write: observationCount 405455 -> 405205 and admittedCount 405427 -> 405177, together with v1.5.231 recovery provenance and audited partition offsets. Manifest cursor, iterator token, diagnostic workbook, run identity, exception/blocked counters and historical lastProgressAt are preserved. No partition data is written by activation. Its own new continuation handler then writes the verified in-flight manifest using the durable journal.

## First-manifest verification pause

Wait for FIRST_MANIFEST_VERIFIED_PAUSED, or run inspectQboPhaseGJournaledRecoveryV1231 and send its log. Expected state: manifestCursor 1736, observationCount 405455, admittedCount 405427, exceptions 28, blocked 0, cleared in-flight fields and journal, firstManifestCommitted true, continueAfterFirst false. This time those counters include the newly committed 250-observation manifest; they are no longer overstated. Automatic work stops at this verification boundary.

After reviewing that log, continue with continueQboPhaseGJournaledRecoveryV1231. It enables continued journaled building and the final equal-time scan. Do not run that function early merely to bypass the first-manifest review. The same continuation function also resumes an interrupted active recovery from its durable journal.

If activation scheduling fails after COUNTERS_CORRECTED, do not activate again. Return the error and inspectQboPhaseGJournaledRecoveryV1231 log; the correction/provenance is durable. A hard engine termination may strand the new continuation chain; its journal is designed for manual resumption without a restart.

Do not run old recoveries, qboPhaseGGlobalEqualTimeV1219Continuation_, or a Phase G start function. Keep the old worker quiescent. The new handler is qboPhaseGJournaledV1231Continuation_; the checkpoint inspector includes its visible trigger IDs.

## Journal behavior

One manifest is active at a time. Before any writes, its verified source identity/hash, admission delta, next iterator token, original counters, fixed per-partition tail offsets, and slot cursor are stored in the same global state property. Work is bounded by a 90-second loop budget; an individual Apps Script service call can exceed this budget. The new handler serializes with a UserLock, not a project ScriptLock.

A retry reads only the journal-owned target range. Each row must be wholly blank or exactly equal to its expected source row; conflicting content or an unexpected tail extent causes refusal. It overwrites that same fixed range, flushes and reads it back, then checkpoints the slot cursor. It never clears or rewrites preceding committed ranges. Audited partition row counts advance only when the manifest commits.

After all slots are verified, counters, manifest cursor, next iterator token, in-flight clearance and journal clearance commit in one state-property write. If termination occurs before this commit, the journal remains and can be resumed. If it occurs after, the durable iterator points to the next manifest and committed counters are not incremented again.

At iterator exhaustion, governed final totals must match before switching to SCANNING_GLOBAL_PARTITIONS. The new handler scans one partition per invocation using the existing tie-classification helper; it checkpoints tie counts and partition cursor together and never resumes the old build worker. It completes only the equal-time diagnostic, not State Application replay.

Writes are limited to the existing Phase G diagnostic workbook tail ranges, its global checkpoint, and this recovery handler's own triggers. The completed audit workbook, source evidence, State Application and replay authorization are unchanged. Trigger visibility is scoped to the invoking user. Recovery assumes no other user/worker edits these partition sheets or the global checkpoint while it runs; visible old triggers and changed activation boundaries are refused.

## Validation

Node syntax passed. Mocked tests passed at 16 before/after checkpoint, partial/full tail-write and flush interruption boundaries. They verified committed-prefix preservation, no duplicate rows, exactly-once counter/token commit, and the first-manifest pause. Blank/exact retry rows were accepted and conflicting rows refused. Activation tests verified intended correction plus provenance, cursor/token/progress preservation, repeat-activation refusal, and six changed-audit/partition guard failures with zero writes. Apps Script runtime and real journaled recovery remain pending.

The audit establishes counter overstatement, not its historical cause. This package repairs the certified current boundary without claiming a root cause.
