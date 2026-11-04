# App 50 v1.5.247 — Read-only expected-partition diagnostic

Add module 4193 to the existing project. Keep modules 4160 and 4192 as installed through v1.5.246. Run `inspectQboPhaseGQueueExpectedPartitionV1247` once and share all execution-log entries.

This diagnostic requires the saved audit at COMPARE_PARTITIONS, all 683 candidates built, 329653 expected rows, partition cursor zero, and V1245_EXPECTED_PARTITION_INVALID. It uses the existing frozen-boundary and inventory guards and reads the failing partition's expected rows. It distinguishes wrong partition values, invalid candidate indices, missing metadata, and duplicate Observation IDs, with supplemental JSON and ID checks.

It reports up to eight duplicate/invalid samples in separate log entries and verifies affected sample IDs against at most four source triplets. Matching source evidence can distinguish an audit duplicate from an ID repeated in immutable source records. It makes no recovery decisions and does not weaken any audit guard.

No writes, new Script Properties, API acquisition, triggers, ingestion, or checkpoint changes occur. The UserLock prevents an overlapping journal/audit invocation while the diagnostic reads. Syntax checked locally; the actual rows must be diagnosed in Apps Script. Do not restart the audit, activate the queue, or run the Phase G worker until the findings are reviewed. Prospective CDC remains independent.
