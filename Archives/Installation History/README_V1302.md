# V1302 — Production property-reader verification (read-only)

Additive file only; does not replace scheduler or exporter code.

Run `testQboProductionPropertyReaderV1302`, then `previewQboProductionPropertyReaderV1302`.

The preview reads real scheduler Script Properties, compares key definitions,
and proves a deliberately mismatched synthetic identity is rejected.
It never creates a claim, changes properties, invokes an exporter, or writes a workbook.
It does NOT exercise a valid live scheduled-worker claim or a live write.
Keep the scheduler paused. Automatic recovery and abandoned-lease cleanup remain disabled.
