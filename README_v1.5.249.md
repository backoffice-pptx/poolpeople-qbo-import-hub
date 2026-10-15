# v1.5.249 — Read-only rebuilt-partition diagnostic

Add module 4195, retaining all installed modules through v1.5.248. Run `inspectQboPhaseGRebuiltPartitionV1249` and share all log entries.

It requires the failed rebuilt verification at partition 1. It separates partition/index errors from duplicate IDs, compares every candidate's rows in that partition with its pre-sort source proof, and checks up to four affected candidates against fresh verified immutable source triplets. It also reports the three original audit candidate differences directly from Candidate_Comparison, so old execution logs need not be found manually.

No writes, triggers, new Script Properties, checkpoint changes, API acquisition, or ingestion occur. Syntax checked locally; live findings must be reviewed before recovery. Keep both Phase G and this rebuild paused; prospective CDC remains independent.
