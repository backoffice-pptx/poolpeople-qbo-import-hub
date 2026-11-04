# v1.5.181 — Controlled resumable historical shard drain

This release adds a read-only preflight and a new resumable shard-only drain. It resumes only the exact v1.5.180 canary checkpoint (artifact 1,138 / 201,864 observations) and never calls the legacy 07 sheet writer.

Run `validateQboObservationIndexHistoricalShardDrainPreflightV181()` first. Only after it passes, run `recoverQboObservationIndexHistoricalShardDrainV181()` once.

The drain processes bounded batches (max 20 artifacts / 5,000 observations / 180 seconds), checkpoints only after shard + lookup + manifest are committed and re-verified, and schedules one continuation when more work remains.

On exhaustion it stops at `COMPLETE_SHARDED_PENDING_RECONCILIATION`. It does not delete the legacy 07 sheet, retire its authority, build the compact entity catalog, or enable State Application.
