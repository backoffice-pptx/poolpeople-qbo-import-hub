V1287 isolated persistence integration test, version 1.5.287.
Additive file only. No production scheduler files replaced.
Run in order, as three SEPARATE Apps Script executions:
1. beginQboDailyIsolatedPersistenceV1287
2. verifyQboDailyIsolatedPersistenceV1287
3. cleanupQboDailyIsolatedPersistenceV1287
4. previewQboDailyIsolatedPersistenceV1287 (expect testKeyPresent:false)

IMPORTANT: keep daily scheduler paused. Test requires paused and idle queue.
Only Script Properties key QBO_DAILY_V1287_ISOLATED_TEST_V1 is created/updated/deleted.
The scheduler lock is used. Production queue and V1284 checkpoint are read for comparison only.
No QBO API calls, exports, history writes, or trigger modifications.
If a test fails, run cleanupQboDailyIsolatedPersistenceV1287 and send all logs.
The simulated snapshot proof is NOT a real snapshot and does not validate exporter write fencing.
This test does NOT validate V1285 actual claim call sites or automatic recovery.
