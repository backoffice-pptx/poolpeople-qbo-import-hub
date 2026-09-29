# v1.5.192 — Final Sharded 07 Reconciliation Timeout Repair

Baseline: fresh App 50 source exported 2026-09-28.

## Why v1.5.192 exists

v1.5.191 reached cursor 955 / 2,418 and verified 214,252 observations, but its
continuation rebuilt the complete physical-file inventory before every bounded
work unit. One invocation processed zero triplets after spending its time on
that enumeration, and the following invocation hard-timed-out.

That is an orchestration/performance defect, not an evidence finding.

## Repair

v1.5.192 starts a separate reconciliation run from zero and persists a Drive
FileIterator continuation token for the manifest folder. Each invocation:

- resumes the prior manifest iterator;
- processes at most 6 triplets;
- has a 120-second normal runtime budget;
- resolves only the current triplets' shard and lookup files by exact name;
- checkpoints only after a complete triplet passes;
- preserves the v1.5.191 Script Properties state;
- removes any surviving v1.5.191 continuation trigger at v1.5.192 startup.

Evidence remains read-only. Only v1.5.192 audit state and continuation triggers
are mutated.

## Operator action

Run once from the Apps Script editor:

`startQboObservationIndexFinalReconciliationV192`

Do not restart v1.5.191 and do not manually invoke the v1.5.192 continuation.
