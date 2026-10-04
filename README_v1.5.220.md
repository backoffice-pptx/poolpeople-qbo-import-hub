# App50 v1.5.220 — GL Run Snapshot V2 registry recovery

Step 6B controlled repair.

- Writes GL run-registry ExtractedAt separately with timestamp formatting and read-back verification.
- Adds self-describing `00_Metadata` to future `GL_RUN_SNAPSHOT_V2` artifacts.
- Adds zero-argument controlled recovery for interrupted v1.5.217 run `8e6119f0-969c-4b03-8bde-b78a12df850d`; recovery requires exactly 2,215 same-run GL rows and one exact persisted ExtractedAt value before writing only registry row 205 column B.
- Adds zero-argument v1.5.220 contract and September full-path validation fixtures.
- Historical legacy snapshot identities are not rewritten.

Run order:
1. `testQboGeneralLedgerRunSnapshotV1220Contract()`
2. `recoverQboGeneralLedgerExtractedAtV1220Failed217For2609()`
3. Stop and review logs before running `validateQboGeneralLedgerRunSnapshotV1220For2609()`.
