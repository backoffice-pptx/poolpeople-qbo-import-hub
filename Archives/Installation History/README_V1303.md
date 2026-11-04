# V1303 — read-only controlled worker preflight

Additive module only. Requires V1302 and deployed scheduler constants.

Run `testQboControlledWorkerPreflightV1303`, then `previewQboControlledWorkerPreflightV1303`.

No production claim, scheduler property, workbook, or lease is created or changed.
`eligibleForDesignReview` is NOT authorization to mutate production properties.

## Proposed controlled test rollback contract (not implemented)

1. Under scheduler lock, require paused and idle, no checkpoint or lease, and no competing execution.
2. Capture an exact presence/value snapshot for every scheduler property that might be modified.
3. Write a unique test owner marker, compare-and-swap under lock, and establish a bounded claim.
4. Exercise a dedicated workbook only, never production export destinations.
5. In finally, reacquire scheduler lock, verify the same test owner and unchanged non-test state, and restore exact prior presence/value (delete absent keys, restore present keys).
6. If ownership differs or liveness is uncertain, FAIL CLOSED and do not overwrite another execution's state. Preserve forensic evidence and require manual recovery.
7. Independently confirm no active worker execution before any lease cleanup. An expired lease alone does not prove termination.

Keep the daily scheduler paused and automatic recovery disabled.
