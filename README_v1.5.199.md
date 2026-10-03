# v1.5.199 — Historical Webhook Chronology Diagnostic Repair

Repairs v1.5.198's incorrect assumption that `04_Webhook_Events_V2` is
physically present in the current State Capture workbook.

The source confirms that the historical webhook payload population can predate
the controlled V2 source-ledger write. Therefore this diagnostic reads the
**immutable webhook receipt referenced by each payload's exact evidence
lineage** as the authority for `ReceivedAt` and receipt event identity.

It still reconciles the same exact 21 WEBHOOK 06 artifacts / 21 observations
against physical logical 07.

For non-DELETE observations it compares 07 `ObservedAt` to the immutable
payload's `rawEntityEvidence.acquiredAt`, which is the captured QBO entity
timestamp used to build that payload.

For DELETE observations it compares 07 `ObservedAt` directly to the immutable
receipt's validated `receivedAt`.

## Run

`auditQboHistoricalWebhookChronologyV199`

Read only. No workbook, Drive, Script Properties, trigger, ingestion, or State
Application writes.
