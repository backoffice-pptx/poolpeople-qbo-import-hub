# v1.5.119 — Webhook 04 V2 Evidence Reconstruction Preview

Read-only reconstruction of the locked 29-field `04_Webhook_Events_V2` contract from immutable webhook receipt evidence.

It validates each receipt using the production receipt validator, verifies `ReceiptEventCount` against reconstructed event rows, creates deterministic `WebhookEventId = WEBHOOK|<receipt>|EVENT|<index>`, and reports eligibility, deletes, targeted-capture requirements, duplicates, and findings.

No writes.

Run only:

`previewQboWebhookSourceLedgerV2()`

Return the complete execution log before any 04 write is created.
