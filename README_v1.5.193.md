# v1.5.193 — v1.5.192 Trigger Lifecycle Repair

v1.5.192 remained evidence-clean through cursor 120. It failed only while
creating the next continuation because prior one-time v1.5.192 triggers had
accumulated to the Apps Script project trigger quota.

The repair preserves the exact v1.5.192 run and iterator checkpoint. It deletes
consumed/stale v1.5.192 continuation triggers before each worker invocation,
then permits the worker to create one successor.

Exact recovery is frozen to:
- run `OBS_INDEX_FINAL_RECON_V192|6a9e8043-c161-485d-935b-9b1ca0796d2f`
- cursor 120
- observations/admitted 28,359
- FAILED error containing `too many triggers`

After copy + clasp push, run once:
`recoverQboObservationIndexFinalReconciliationTriggerQuotaV193`

Do not run the v1.5.192 start function and do not manually run the continuation.
