# V1301 — Actual guard / isolated property reader test

**REVIEW BEFORE PUSHING.** This package replaces `4298_QBO_WorkerWriteBoundaryV1298.js` with an optional fifth argument, `testPropertyReader`, and adds `4301_QBO_ActualGuardIsolatedV1301.js`. All existing four-argument production calls use the unchanged `PropertiesService.getScriptProperties()` path. Compare with your latest deployed `4298` before installing.

Run `previewQboActualGuardIsolatedV1301`, then `runQboActualGuardIsolatedV1301` if idle. The latter creates and retains a new Google Sheets workbook, writes 2 rows, and temporarily writes two `QBO_V1301_TEST_*` Script Properties, removed in `finally`. It invokes the real V1298 guard function using a dependency-injected reader for synthetic claim and lease evidence. It never writes real scheduler keys, never starts QBO exports, and does not call the QBO API.

**Scope limit:** Actual V1298 guard logic is tested with an injected property reader. The default production property reader, actual exporter callback, live concurrent writers, and original-worker termination are NOT tested. Do not resume the scheduler or enable recovery on this evidence alone.
