# App 50 v1.5.246 — Resume the existing queue audit after a Drive service error

Replace only `4192_QBO_PhaseGExplicitManifestQueueRecovery.js` with this package's copy. Retain the patched 4160 module installed in v1.5.245 and all other modules.

Run **`resumeQboPhaseGExplicitQueueAuditV1246` once**, then share the log. It requires the existing audit at exactly candidate 309/683, 124523 expected rows, zero compared partitions, the saved `Service error: Drive`, and the unchanged frozen Phase G boundary. It validates the existing inventory and private workbook header, saves a resume evidence record, preserves all audit rows and metadata, and reinstalls the one-minute audit trigger with a fresh bounded retry budget. No new audit or Script Property is created. The original global checkpoint is unchanged; prospective CDC continues independently.

This patch classifies the exact platform error `Service error: Drive` as transient. The earlier v1245 filter omitted it. At most three automatic attempts are permitted at an unchanged audit position. Integrity failures and `Invalid argument` do not qualify for automatic retry. Repeated hard terminations at one position also reach the existing retry limit.

Check progress using the existing **`inspectQboPhaseGExplicitQueueAuditV1245`** function. The audit identity deliberately remains v1.5.245. Wait for `READY_FOR_EXPLICIT_QUEUE_ACTIVATION`; do not rerun the start function or any Phase G worker during this audit. Activation remains a separate step after the certificate is reviewed.

The existing audit workbook may contain an uncheckpointed tail from an interrupted write. Its worker reuses the durable row offset and overwrites only that uncommitted private range before committing progress. No committed Phase G partition range is cleared or repaired by this patch.

Local syntax and mocked integration checks passed for the existing membership/tail/queue guards plus the Drive error classification, exact-position resume, unchanged global checkpoint/rows/metadata, one trigger, fresh three-attempt budget, and refusal of a duplicate resume or changed checkpoint. Live service behavior remains subject to the on-platform audit.
