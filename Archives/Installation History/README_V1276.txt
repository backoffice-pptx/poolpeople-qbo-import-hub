V1276 — generalized V1274 STAGING journal recovery (1.5.276)

INSTALL: Add 4224_QBO_PhaseGGeneralizedJournalRecoveryV1276.js to App 50.
Dependencies: existing V1271, V1272, V1274 and V1275 source functions.
Do NOT delete or replace V1274 or V1275. No overlapping function names.

1. Keep V1274 HALTED. Do not run its worker or starter.
2. Run previewQboPhaseGJournalRecoveryV1276(). Share the complete PREVIEW log before recovery.
3. Only after review, run recoverQboPhaseGJournalV1276().
4. Verify state using inspectQboPhaseGGlobalIdentityV1274().

Recovery handles any STAGING journal of 1–10 source index files, using the
checkpoint's iterator token. It validates the index's hashes, reconstructs
source-derived bucket entries, compares existing artifacts' hashes AND exact
entry arrays, writes only missing bucket files, verifies all 16, then commits.
No index, source, completed Phase G workbook or daily exports are changed.

Interruption behavior:
- During artifact writes: repeat preview then recover; existing files are checked.
- After checkpoint save but before journal removal: repeat preview then recover;
  V1276 verifies its own postcommit checkpoint and source before clearing journal.
- After journal deletion but before resume: run
  inspectQboPhaseGRecoveryRearmV1276(), then (after review)
  rearmQboPhaseGAfterRecoveryV1276(). Never run the general recovery without a journal.

V1274's worker may still encounter later partial writes. V1276 is reusable
for future STAGING journals, but is intentionally not an automatic retry.

IMPORTANT: If a pending journal phase is CHECKING, this package deliberately
refuses to recover it. That requires separate evidence-based review.
