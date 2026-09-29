# v1.5.121 — Controlled 04 Webhook V2 Write

Writes only `04_Webhook_Events_V2` after re-running the clean v1.5.119 source preview and v1.5.120 targeted-capture reconciliation.

Locked expected population:
- 88 receipts
- 91 events
- 91 eligible source events
- 15 EMAILED preserved exactly
- 2 DELETE / capture NOT_REQUIRED
- 1 PRESENT_VALID historical targeted capture
- 88 MISSING_HISTORICAL_CAPTURE

Run only:

`writeQboWebhookSourceLedgerV2()`

No writes to 05, 06, payload evidence, Drive, Script Properties, triggers, or State Application.
