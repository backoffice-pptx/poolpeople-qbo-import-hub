V1286 isolated validation of V1285 integration, version 1.5.286.

Adds one JS file; does not overwrite scheduler or checkpoint store.
Run testQboDailyV1285IntegrationV1286 then previewQboDailyV1285IntegrationV1286.

IMPORTANT: Tests exercise the ACTUAL V1284 assertion and parsing functions with in-memory fake properties. They DO NOT call the live qboDailyV1284Checkpoint_ writer or acquire a real worker claim, and therefore cannot prove actual persistence, phase monotonicity, idempotent writes, lock behavior, or checkpoint failure handling. No automatic recovery. Keep daily scheduler paused.

Review observation: in V1285 runNextScheduledQboExport, CLAIMED checkpoint is called after claimDailyQboWorker_ creates live claim; EXPORT_STARTED is called after history start, before exporter invocation. Failures at either point may leave an active claim; these calls currently occur outside the exporter try block. This is a fail-closed risk requiring controlled repair and tests.
