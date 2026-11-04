# V1304 — crash-safe test authorization design (READ ONLY)

## Decision
Do **not** temporarily write synthetic claims into the live scheduler namespace. Apps Script hard termination can bypass `finally`, and a time-based cleanup may race a still-running writer. A paused scheduler does not prove that all continuations, manually invoked workers, or other project executions are absent.

## Implemented
- `testQboControlledWorkerRollbackV1304` deterministic, no mutations.
- `previewQboControlledWorkerRollbackV1304` reads V1303 preflight state; no mutations.
- Explicitly rejects production claim mutation even when all simulated gates are true.

## Recovery/test design to implement separately
1. Create a **separate Apps Script test deployment/project** with its own Script Properties and triggers, or refactor the production guard to accept an explicit injected property provider without changing production scheduler state. Test against a dedicated workbook only.
2. If a production-namespace test is ever necessary, require an independent supervisor outside the test execution, an authoritative execution-termination attestation, a durable before-image of affected keys, and manual recovery approval. An in-process `finally` or elapsed lease TTL alone does not suffice.
3. Keep automatic recovery and abandoned-lease clearing disabled until the writer lifecycle and fencing contract are proven.
4. Preserve Phase G and all 22 production destinations unchanged.

## Validation
Run `testQboControlledWorkerRollbackV1304`, then `previewQboControlledWorkerRollbackV1304`.
Scheduler must remain paused. **No mutating V1304 runner exists.**
