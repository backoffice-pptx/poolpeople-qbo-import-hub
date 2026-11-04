V1294 — conservative no-steal lease safeguard, based on uploaded 2026-11-03 17:40 source.
Replaces 21_ExportFramework.js only; adds 4294 diagnostic.
WARNING: This is NOT full mutation-boundary write fencing. No automatic recovery.
Any orphaned/expired lease now BLOCKS writes until independently reviewed and
explicitly cleared after proving no original writer remains. Do not unpause
the daily scheduler. This safeguard affects ALL callers of withExportWriteLock_,
including non-daily export paths. Review deployment impact before push.
Tests: testQboWriteLeaseNoStealV1294; previewQboWriteLeaseNoStealV1294.
No automatic lease cleanup included.
