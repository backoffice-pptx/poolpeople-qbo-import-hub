V1290 — successful-export queue-advancement checkpoint, guarded.
Prerequisites: deployed V1284 checkpoint store, V1289 completion proof gate.
This package REPLACES 24_TriggerManagement.js. Review diff against current deployed source.
The scheduler must remain paused. Do NOT enable exports or automatic recovery.
Run testQboDailyQueueAdvanceV1290 and previewQboDailyQueueAdvanceV1290.
LIMITATIONS: Only the successful-export path is checkpoint-gated. Failed exports retain
existing queue handling. A crash after writing QUEUE_ADVANCED but before INDEX update
still needs controlled evidence reconciliation; do not auto-reclaim a claim.
No exporter write fencing, liveness verification, or automatic recovery is included.
