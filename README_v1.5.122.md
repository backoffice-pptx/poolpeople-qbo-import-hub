# v1.5.122 — Controlled 04 Webhook V2 Write helper repair

Repairs v1.5.121's workbook accessor only:
- incorrect nonexistent `qboStateCaptureOpenWorkbook_()`
- replaced with existing governed App 50 helper `getQboStateCaptureSpreadsheet_()`

v1.5.121 failed before any 04 write occurred. All evidence/population gates remain unchanged.

Run only:

`writeQboWebhookSourceLedgerV2()`
