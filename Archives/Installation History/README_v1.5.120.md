# v1.5.120 — Webhook Targeted Capture Reconciliation

Read-only reconciliation of the 91 candidate 04 V2 webhook events from v1.5.119 against existing immutable targeted-capture evidence.

Expected population from v1.5.119:
- 91 total events
- 89 non-delete events requiring targeted capture
- 2 DELETE events where capture is not required
- 15 EMAILED events preserved as EMAILED

Run only:

`auditQboWebhookTargetedCaptureReconciliationV2()`

This package performs no writes.
