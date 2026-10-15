# Phase G v1.5.230 — committed-population audit

Install only the new 4150_QBO_PhaseGCommittedPopulationAudit.js module. Retain v1229 (4140) and the existing source helper modules. The package adds no repair or replay capability.

Run startQboPhaseGCommittedPopulationAuditV1230 once. It validates the exact v1229 checkpoint and absence of visible Phase G continuation triggers, resolves the saved iterator boundary, freezes the committed source manifest membership, and creates a separate audit workbook. Share the STARTED execution log. Audit-only continuations process up to 12 manifests per invocation, then sort the expected rows and compare one partition per invocation. This is a sustained audit, not an immediate result.

Check progress with inspectQboPhaseGCommittedPopulationAuditV1230. When complete, return the COMPLETE log and Partition_Results/Differences from the audit workbook. The STARTED log supplies its workbookId. Recovery remains unauthorized.

If an audit continuation fails or no further progress occurs, return its error and the audit checkpoint log. continueQboPhaseGCommittedPopulationAuditV1230 resumes the existing audit; do not start another audit or restart Phase G. A changed global checkpoint or invalid source evidence causes refusal.

Membership: all 2418 source manifest IDs minus the remaining IDs from a fresh handle of the durable iterator token must yield exactly 1735 committed manifests. The next remaining manifest must be the exact in-flight artifact. Filename numbering and freshly enumerated Drive order are not used to identify the committed set. The audit verifies each committed manifest/shard/lookup triplet using the existing hash/reference verifier before producing its expected rows.

Expected source counts are compared independently with the checkpoint (405455 total, 405427 admitted, 28 exceptions, 0 blocked). If the source-derived committed counts differ, the audit still reports the source/workbook differences and explicitly reports sourceCountsMatchCheckpoint=false. No checkpoint adjustment occurs.

Partition_Results columns: Partition, ExpectedRows, ActualRows, ExactRows, MissingRows, UnexpectedRows, MismatchedRows, DuplicateExpectedRows, DuplicateActualRows, Status. Differences contain full expected/actual ten-field JSON and observation IDs. Multiset comparison retains duplicate multiplicity. Cross-partition errors appear as missing in the expected partition and unexpected in the actual partition.

Writes are restricted to the newly created private audit workbook, QBO_PHASE_G_COMMITTED_AUDIT_V1230_STATE, and qboPhaseGCommittedAuditV1230Continuation_ triggers. Existing diagnostic workbook, Phase G checkpoint/token/counters, immutable source artifacts, and State Application are preserved. It uses a UserLock to serialize audit invocations; it does not hold a project ScriptLock. Trigger checks cover the invoking user's visible triggers.

Build retries overwrite only the uncommitted audit row interval at the durable row offset. They never clear/rewrite committed ranges. Sorting is idempotent. Partition-result retries overwrite only the uncommitted audit results/differences at their durable offsets. No continuation invokes the Phase G worker. Hard termination can strand an audit trigger chain; manual audit continuation preserves its checkpoint.

The audit assumes governed source artifacts remain immutable and the existing paused Phase G workbook is not manually edited during the audit. An exact comparison certifies the ten partition fields against the source-derived committed manifest population, not all other project data or replay readiness.

Validation: Node syntax check; exact/missing/unexpected/content-mismatch comparison; duplicate source/actual multiplicity; prototype-like ID; mixed differences; worksheet expansion; absence of destructive cleanup/project lock/Phase G worker calls. Apps Script runtime, source boundary and live comparison remain pending.
