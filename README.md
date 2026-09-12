# v1.5.43 — Daily Scheduler Lock-Domain Separation

Production recovery exposed that App 50's independent Native CDC, State Capture, GL backfill, audit, and daily FULL_EXPORT paths all shared the project-wide Apps Script `ScriptLock`. Some non-scheduler pipelines legitimately hold that lock across long-running work, which caused `resumeQboExportSchedule()` to time out for 30 seconds even when the daily scheduler had no active worker claim.

This change isolates daily FULL_EXPORT scheduler coordination onto `LockService.getUserLock()`. The daily starter, manual resume/remove controls, worker claim, and claim finalization now serialize within the trigger owner's scheduler domain instead of competing with unrelated App 50 project-wide execution locks. Workbook write-lease registry locking remains project-wide so destination-workbook ownership stays cross-user safe; registry contention is already classified as retryable and does not consume the queue position.

No exporter data contract, destination schema, queue ordering, 90-second workbook lease wait, or CDC/state-capture behavior changed.

# v1.5.42 — Scheduler ScriptLock Scope Hardening

Changed-files-only package for `50 QBO Import Hub Standalone`.

## Why this change is required

The first production recovery attempt after v1.5.40 passed preflight but timed out for 30 seconds at `LockService.getScriptLock().waitLock(30000)`. The new read-only scheduler diagnostic then showed the stranded run still at queue index 17 with no active worker token. Source review identified the contention mechanism: scheduler control paths were holding the project-wide ScriptLock while performing variable-latency run-history spreadsheet I/O.

## Corrections

- `finalizeDailyQboWorkerClaim_()` now holds ScriptLock only while validating the worker token and mutating Script Properties. Run-history spreadsheet updates occur after lock release.
- `resumeQboExportSchedule()` is now two-phase: it briefly captures queue identity, reconstructs/repairs durable run history outside ScriptLock, then reacquires the lock for a compare-and-set queue commit.
- `startDailyQboExportSchedule()` uses the same short-lock/two-phase pattern for unfinished-run recovery.
- Both recovery paths abort rather than overwrite state if another execution changes RunId/QueueIndex or establishes a healthy worker claim during history reconstruction.
- New-run startup writes scheduler state atomically, records durable run history outside ScriptLock, and rolls back its own queue state if run-history creation fails before a worker claims it.
- The 30-second ScriptLock timeout and 90-second workbook write-lease timeout remain unchanged; this release removes variable-latency work from the ScriptLock critical sections instead of masking contention with longer waits.

## Scope

No exporter schemas, QBO queries, workbook destinations, snapshot contracts, CDC logic, or workbook-lease retry classification changed.

After copying/pushing, rerun:

```javascript
resumeQboExportSchedule()
```

If recovery succeeds, immediately inspect:

```javascript
diagnoseQboExportSchedulerState()
```

---

# v1.5.41 — Scheduler Runtime-State Diagnostic

Changed-files-only package for `50 QBO Import Hub Standalone`.

## Why this change is required

The first v1.5.40 recovery attempt timed out acquiring `ScriptLock` before it entered the recovery critical section. The trigger inventory shows the persistent daily starter and one transient worker trigger, but trigger existence alone cannot prove whether a worker execution currently owns the scheduler claim.

## Diagnostic added

Adds read-only `diagnoseQboExportSchedulerState()` to report the persisted daily-run and active-worker claim without acquiring `ScriptLock`:

- `runId`
- `queueIndex`
- `activeToken`
- `activeIndex`
- `activeExportKey`
- `activeStartedAt`
- `activeAgeMs`
- `stale`
- `staleThresholdMs`
- script timezone

The diagnostic does not mutate queue state, worker state, run history, or triggers. No scheduler execution/recovery behavior changes in this release.

After copying/pushing, run only:

```javascript
diagnoseQboExportSchedulerState()
```

Use that result before retrying `resumeQboExportSchedule()`.

---

# v1.5.40 — Daily Export Scheduler Recovery Hardening

Changed-files-only package for `50 QBO Import Hub Standalone`.

## Why this change is required

The September 11, 2026 production run `9ff6e204-18d8-4f81-b965-7749429886b3` exposed two independent orchestration failure modes. `PURCHASES` timed out waiting for the shared destination-workbook write lease and was incorrectly consumed as a terminal failed queue position. Later, `SALES_RECEIPTS` was left `RUNNING` when its Apps Script execution ended without reaching normal catch/finally cleanup, severing the transient trigger chain and leaving the parent daily run stranded.

## Corrections

- Daily workers now atomically claim one queue position with a persistent worker token under ScriptLock.
- A second worker that fires while a healthy claim is active defers instead of launching an overlapping exporter.
- Every claimed exporter arms a watchdog trigger before long-running work begins. A platform-level termination therefore leaves a successor trigger capable of recovering the chain.
- Worker claims older than 12 minutes are treated as stale; the stranded RUNNING attempt is closed as `INTERRUPTED` and the same queue position is retried.
- Workbook write-lease timeout now raises typed scheduler error `QBO_WRITE_LEASE_BUSY`. The daily scheduler records that attempt as `INTERRUPTED`, does not increment FailedExports, and does not advance QueueIndex.
- Write-lease registry metadata now records acquiring sheet, scheduled RunId/export key, worker token, acquired time, and expiry. Lease-contention errors report the owner metadata when available.
- The durable daily starter no longer automatically marks an unfinished queue `REPLACED`. It preserves a live worker or reconstructs the existing run from durable history and resumes the first incomplete exporter.
- Queue cleanup also removes active-worker claim properties.
- Failure-path regression coverage now includes retryable write-lease errors and stale-worker threshold behavior.

## Scope and safety

This release changes production daily-export orchestration and shared workbook-lease diagnostics only. It does **not** change QBO exporter schemas, canonical fields, snapshot contents, State Capture processing rules, General Ledger extraction, historical audit contracts, or CDC acquisition behavior.

The 90-second workbook-lease wait remains unchanged. Contention is now treated as a retryable orchestration condition rather than hidden by a larger timeout.

After copying/pushing, run the pure regression suite first:

```javascript
testQboFailurePathRegression()
```

Then inspect scheduler state:

```javascript
listQboExportTriggers()
```

For the stranded September 11 run, use the existing recovery entry point rather than starting a replacement run:

```javascript
resumeQboExportSchedule()
```

---

# v1.5.39 — Recursive Contract Audit Bounded-Batch Orchestration

Changed-files-only package for `50 QBO Import Hub Standalone`.

## Why this change is required

The v1.5.37 historical recursive audit completed successfully but took roughly 11 hours wall-clock because the worker intentionally processed only one historical source per transient trigger. That pattern was safe for initial validation, but trigger latency dominated the one-time historical run. v1.5.39 keeps the v1.5.38 matcher/retry corrections and changes only the audit execution/orchestration so the corrected rerun does not repeat the one-source-per-trigger model.

## Orchestration corrections

- Each worker processes multiple historical sources in one execution.
- Worker execution is bounded by a conservative 240,000 ms runtime budget and a maximum of 25 sources per execution.
- Cursor/counters/run-row state are checkpointed after every successfully completed source before the worker begins the next source.
- A continuation trigger is scheduled only when work remains after the bounded batch.
- The watchdog now uses the same script lock as the worker. If a batch is actively running, the watchdog does not mistake the absence of a pending worker trigger for a stalled run and cannot seed an overlapping worker.
- `resumeQboRecursiveContractCoverageAudit()` now schedules a worker and returns instead of doing historical source processing inline.
- Startup remains short and separate from processing.
- v1.5.38 numeric-string equivalence, source idempotency, and COMPLETE-run counter reconciliation are retained unchanged.

## Scope and safety

v1.5.39 changes only the one-time recursive historical contract-audit runner and App 50 version marker. It does **not** change exporter schemas, canonical writes, migration cursors, production export scheduling, or the future production CDC schedule. The bounded-batch/checkpoint/watchdog pattern is intentionally aligned with lessons to carry into the CDC orchestration design, but this historical audit remains a one-time process.

After copying/pushing, run once:

```javascript
startQboRecursiveContractCoverageAudit()
```

Do not start the v1.5.38 package first. Use the new v1.5.39 RunId as the sole baseline for final contract consolidation.

---

# v1.5.38 — Recursive Contract Audit Numeric-Scalar + Retry Reconciliation Hardening

Changed-files-only package for `50 QBO Import Hub Standalone`.

## Why this change is required

Consolidation of the completed v1.5.37 run proved that parent/child traversal is working, but exposed one remaining matcher false-negative pattern: QBO commonly returns reference IDs, document numbers, and postal codes as JSON strings while Google Sheets may materialize the same digit-only values as Numbers. The v1.5.36/v1.5.37 typed matcher therefore marked some physically governed fields as `UNCOVERED` even when the exporter mapped them directly (for example `CustomerRef.value -> CustomerId` and `DocNumber -> DocNumber`).

The v1.5.37 persisted audit output also showed retry/re-entry duplicates in some sources, causing the COMPLETE run counters to exceed the unique persisted source/path population.

## Corrections

- Adds a lossless integer-equivalence key for safe integer values so QBO digit-only strings can match equivalent Google Sheets numeric cells.
- Does **not** collapse leading-zero strings into numbers, preserving identifiers where formatting is significant.
- Keeps semantic-compatibility requirements from v1.5.36; numeric equivalence alone cannot prove coverage.
- Makes source processing idempotent by clearing prior rows for the same RunId + ExportKey + SourceId before every source execution.
- Reconciles final COMPLETE counters from unique persisted audit evidence rather than cumulative retry counters.
- Advances audit version to `RECURSIVE_CONTRACT_COVERAGE_V3`.

## Scope and safety

v1.5.38 changes only recursive contract-audit matching/output integrity and the App 50 version marker. It does **not** change exporter schemas, canonical writes, migration cursors, production export scheduling, or `99_TriggeredCalls.js`.

After copying/pushing, run once:

```javascript
startQboRecursiveContractCoverageAudit()
```

Do not remediate exporter contracts until the v1.5.38 run reaches `COMPLETE` and the new RunId is consolidated.

---

# v1.5.37 — Recursive Contract Audit Startup Hardening

Changed-files-only package for `50 QBO Import Hub Standalone`.

## Why this change is required

A v1.5.36 manual start was cancelled during initialization after the new RunId and RUNNING status had been written, but before StartedAt, cursor, and counters were reset. That left a mixed Script Properties state: a new RunId attached to the completed v1.5.35 cursor/counters.

## Startup corrections

- Fresh audit state is written with one `setProperties(...)` batch rather than one property at a time.
- Startup immediately reads the persisted state back and verifies RunId, status, StartedAt, cursor `0/0`, and all counters at zero.
- The run row is written before the audit trigger chain is installed.
- The manual `startQboRecursiveContractCoverageAudit()` execution no longer processes the first historical source inline. It installs the watchdog and schedules the first worker, then exits.
- This keeps manual startup short and prevents source-processing duration from affecting initialization integrity.

## Scope and safety

v1.5.37 includes the v1.5.36 matcher hardening unchanged. It does **not** change exporter schemas, canonical writes, migration cursors, production scheduling, or `99_TriggeredCalls.js`.

Before deploying v1.5.37, stop the partially initialized v1.5.36 state with:

```javascript
stopQboRecursiveContractCoverageAudit()
```

After copying/pushing v1.5.37, start a new clean run once:

```javascript
startQboRecursiveContractCoverageAudit()
```

The start call should return quickly with cursor `0/0` and zero counters. The trigger chain then performs the full audit automatically.

---

# v1.5.36 — Recursive Contract Audit Matcher Hardening

Changed-files-only package for `50 QBO Import Hub Standalone`.

## Why this audit must be rerun

The completed v1.5.35 recursive audit proved that parent and governed child datasets were traversed, but consolidation exposed matcher defects that can create both false positives and false negatives. v1.5.36 corrects the audit before any exporter-contract remediation is attempted.

## Matcher corrections

- Non-RawJSON JSON containers now require both exact raw-subtree equality **and semantic compatibility** with the matched API subtree. Unrelated empty `{}` / `[]` values can no longer prove coverage merely because their serialized values happen to be equal.
- Scalar comparisons now use typed comparison keys and date-equivalence keys. QBO `YYYY-MM-DD` values can match Google Sheets date cells without being defeated by Date-object/timezone rendering.
- Flattened scalar coverage now always requires semantic compatibility; repeated or coincidentally equal values alone are not sufficient.
- Semantic aliases now cover common QBO/export naming conventions such as `Txn`/`Transaction`, `Amt`/`Amount`, `Qty`/`Quantity`, `Addr`/`Address`, reference `.value` → `Id`, and `CurrencyRef.value` → `CurrencyCode`.
- Recurring transaction `EmbeddedTransactionJSON` and `LineDetailJSON` retain explicit governed semantic handling.

The recursive audit version is now `RECURSIVE_CONTRACT_COVERAGE_V2`.

## Scope and safety

v1.5.36 changes only recursive contract-audit matching logic and the App 50 version marker. It does **not** change exporter schemas, canonical writes, state-migration cursors, production export scheduling, or `99_TriggeredCalls.js`. Existing v1.5.35 audit rows remain intact and are isolated by RunId. A fresh call to `startQboRecursiveContractCoverageAudit()` appends a new run with a new RunId.

## Test sequence

After copying/pushing this package, run once:

```javascript
startQboRecursiveContractCoverageAudit()
```

The transient worker/watchdog trigger chain will process the remaining sources automatically. Do not remediate exporter contracts until the v1.5.36 run reaches `COMPLETE` and its findings are consolidated.

---

# v1.5.35 — Automated Recursive Parent + Child Contract Coverage Audit

## Purpose

This version adds a second-generation historical contract audit that reruns the entire canonical entity scope automatically and checks both parent and governed child data structures.

Architecture rule remains:

**Canonical state derives from governed flattened export contract plus governed child datasets; RawJSON is validation evidence.**

RawJSON is therefore used only to discover/validate QBO business-state paths. A RawJSON column never satisfies contract coverage by itself.

## New audit datasets in `QBO State Capture`

- `91_Contract_Audit_Paths` — one row per observed canonical path/source/contract level, including coverage method, represented column, match rate, confidence, and action-required status.
- `92_Contract_Audit_Sources` — one summary row per historical source audited.
- `93_Contract_Audit_Runs` — durable run status, cursor, totals, errors, and completion state.

## Coverage methods

The recursive audit can prove a path through:

1. a consistently matching flattened scalar column;
2. an exact non-RawJSON JSON container that preserves the corresponding QBO subtree; or
3. a governed child dataset whose own flattened contract was independently audited.

Object/array containers are considered covered when every observed descendant path is proven covered. Low-sample or ambiguous matches are reported as `REVIEW_REQUIRED`; no unproven mapping is silently treated as complete.

## Automated execution

Run only:

`startQboRecursiveContractCoverageAudit()`

That function starts a fresh run, processes the first source immediately, and installs isolated audit-only triggers for the remaining work. The audit does not use or modify `99_TriggeredCalls.js` and does not alter the production export scheduler.

A watchdog trigger restores the next audit worker after an unexpected hard Apps Script termination. Cursor and in-progress-source state are durable Script Properties. If a source must be retried, rows for that same run/source are removed before the retry to avoid duplicate audit evidence.

Administrative functions:

- `listQboRecursiveContractCoverageAuditStatus()`
- `stopQboRecursiveContractCoverageAudit()`
- `resumeQboRecursiveContractCoverageAudit()`

## Scope

The automated audit uses `QBO_STATE_CAPTURE.CANONICAL_MIGRATION_SCOPE`, currently 21 entities from Payment Methods through Refund Receipts. It audits every `AVAILABLE` registered historical source for each entity.

The existing v1.5.34 top-level audit remains intact as historical diagnostic evidence. v1.5.35 does not change exporter behavior, canonical writes, migration cursors, or production scheduling.

---

# v1.5.34 — Complete Historical Contract Coverage Registry

Changed-files-only package for `50 QBO Import Hub Standalone`.

## Purpose

Extends the existing read-only historical flattened-contract coverage audit to the five State Capture exports that were configured for canonical migration but omitted from the audit registry:

- DEPOSITS
- JOURNAL_ENTRIES
- SALES_RECEIPTS
- RECURRING_TRANSACTIONS
- REFUND_RECEIPTS

This package does **not** remediate any newly discovered contract gaps and performs no canonical writes. It only completes the discovery scope so remediation can be based on the full App 50 export population.

## Cursor continuity

The completed v1.5.33 audit cursor is already positioned at `exportIndex: 16, sourceIndex: 0`. Because the five omitted exports are appended after `PURCHASES`, the next call to `auditQboHistoricalFlattenedContractCoverageNext()` will begin directly with `DEPOSITS` without resetting or rerunning prior sources.

## Test sequence

After copying/pushing this package, run only:

```javascript
auditQboHistoricalFlattenedContractCoverageNext()
```

Expected first export: `DEPOSITS`, `sourceIndex: 0`. Continue one source per run until the audit returns `complete: true`.

Do not resume canonical migration/process-write capture and do not remediate the outstanding contract findings until these five exports have completed discovery.

---

# v1.5.33 — Credit Memo Governed Contract

Changed-files-only package for `50 QBO Import Hub Standalone`.

## Governance correction

The v1.5.32 read-only diagnostic established seven QBO Credit Memo top-level business-state fields that were present in complete RawJSON evidence but absent from the historical flattened parent contract:

- Balance
- BillEmailBcc
- BillEmailCc
- FreeFormAddress
- RecurDataRef
- ShipFromAddr
- TaxExemptionRef

All seven are governed business state and are included in the flattened contract beginning with v1.5.33. Historical constancy is not used as a reason to exclude a field.

The diagnostic also established that historical `Balance` exactly matched flattened `RemainingCredit` in all 2,530 rows across all 10 historical sources. v1.5.33 nevertheless externalizes `Balance` independently rather than relying on historical equality.

## Exporter changes

`42_QBO_CreditMemos.js` adds governed representations for all seven fields. Complex objects retain lossless JSON columns plus useful convenience columns.

## Historical coverage behavior

`76_QBO_HistoricalFlattenedContractCoverageAudit.js` now requires a v1.5.33 Credit Memo physical signature before treating the seven fields as covered. Historical backups that predate v1.5.33 will therefore continue to report exactly the known seven-field omission and are governed by the controlled historical exception evidence.

## Historical exception evidence

Public function:

```javascript
auditQboCreditMemoHistoricalExceptionEvidence()
```

Prerequisite: v1.5.32 `auditQboCreditMemoUncoveredFields()` must still be present in the project.

Expected evidence from the already-completed v1.5.32 diagnostic:

- sources: 10
- source rows / complete RawJSON rows: 2,530
- truncated RawJSON: 0
- invalid RawJSON: 0
- distinct Credit Memos: 253
- cross-source changes across all seven fields: 0
- `Balance` vs historical flattened `RemainingCredit`: 2,530 / 2,530 exact, 0 mismatches

No canonical writes or cursor changes are performed by the exception-evidence function.

## Test sequence

After copying/pushing this package, run only:

```javascript
auditQboCreditMemoHistoricalExceptionEvidence()
```

Do not resume `auditQboHistoricalFlattenedContractCoverageNext()` until the exception evidence is reviewed.
