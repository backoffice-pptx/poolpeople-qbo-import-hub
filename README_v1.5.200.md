# v1.5.200 — Historical Webhook Chronology Diagnostic Physical-07 Locator Repair

Repairs only the v1.5.199 physical-07 locator.

v1.5.199 incorrectly used the current 06 artifact cursor to decide whether an
ObservationId could reside in legacy physical 07 storage. v1.5.200 instead
searches all bounded legacy v1.5.175 shards by exact ObservationId, plus exact
post-conversion artifact-cursor shard candidates.

The diagnostic remains read-only and requires the exact known population of
21 historical WEBHOOK observations.

Run directly from Apps Script:

`auditQboHistoricalWebhookChronologyV200`
