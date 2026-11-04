# V1300 isolated synthetic-worker integration

Additive module; no scheduler/framework replacement. **Review before deployment.**

Run `previewQboSyntheticWorkerIntegrationV1300` first, then `runQboSyntheticWorkerIntegrationV1300` only if no active production claim and no test namespace remains.

The test creates and RETAINS a new isolated Google Sheets workbook; writes two rows. It writes and removes two namespaced Script Properties `QBO_V1300_TEST_CLAIM` and `QBO_V1300_TEST_LEASE`, and never writes real scheduler claim or lease keys. A failure still executes namespaced cleanup. It makes no QBO API calls or production export writes.

**Scope:** exercises actual immutable context, dependency-injected scheduled decision checks, and real Sheets writes. It does **not** execute the production `qboV1298AssertWriteBoundary_` scheduled path or the actual 22 exporters. Passing is not authorization to resume scheduler or automatic recovery. No abandoned lease cleanup is implemented.
