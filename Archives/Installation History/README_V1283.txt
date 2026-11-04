V1283 CHECKPOINT/FENCING CONTRACT SIMULATOR (ADDITIVE / READ-ONLY)
No scheduler file is overwritten. No automatic recovery or production checkpoint writes.
Run testQboDailyCheckpointFencingV1283 then previewQboDailyCheckpointFencingV1283.
Simulation establishes candidate transition invariants, NOT transactional durability in Apps Script.
Production integration requires atomic state mutation under scheduler lock, durable checkpoints tied to work-unit evidence, fencing at every side-effect boundary, recovery after independently verified execution termination, and integration tests.
Do not unpause production on the basis of these tests.
