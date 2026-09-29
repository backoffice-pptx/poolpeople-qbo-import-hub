# v1.5.180 — Controlled historical shard-writer canary

This release does not enable the general historical worker. The operator function
`recoverQboObservationIndexHistoricalShardWriterCanaryV180()` has exact preconditions for the retained failed run at cursor 1,137 / 201,614 observations. It commits exactly artifact 1,137 through shard → lookup → manifest, re-verifies all three immutable files, then checkpoints the retained historical run to cursor 1,138 / 201,864 and stops in `PAUSED_SHARD_WRITER_CANARY`.

No continuation trigger is installed. The legacy 07 sheet is never written or deleted.

After the canary completes, run `validateQboObservationIndexShardWriterCanaryV180()`.
