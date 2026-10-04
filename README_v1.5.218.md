# App 50 v1.5.218 — GL Run Snapshot V2 Step 6B runtime repair

- Repairs the v1.5.217 General Ledger run-registry post-write timestamp assertion by comparing at whole-second precision rather than exact milliseconds after the Google Sheets round trip.
- Adds a zero-argument contract test with timestamp normalization checks.
- Adds a zero-argument recovery fixture for interrupted September run `8e6119f0-969c-4b03-8bde-b78a12df850d`; it requires the already-created V2 snapshot, validates the committed registry row and snapshot, identifies the prior September run, and persists only the missing run comparison.
- Keeps GL_RUN_SNAPSHOT_V2 prospective evidence semantics and all historical GL identities unchanged.
- Retains a fresh zero-argument September runtime fixture for use only after recovery succeeds.
