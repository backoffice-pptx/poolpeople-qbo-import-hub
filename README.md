
### v1.5.52 — Governed source evidence / Raw Entity Evidence adapters
- Changes the Change Payload contract to explicitly separate immutable `SourceEvidence`, embedded complete `RawEntityEvidence`, and governed `NormalizedEntityState`.
- Source evidence artifacts remain immutable in Drive and are referenced/hashed rather than duplicated wholesale into every entity payload.
- Native CDC entity objects are extracted from the CDC response envelope and may serve directly as Raw Entity Evidence only when governed V2 normalization proves them complete; otherwise a targeted QBO entity fetch is required.
- Webhook receipts are treated strictly as change signals. Non-delete webhook events require targeted QBO fetch before successful normalization; delete events produce governed tombstones.
- Historical webhook replay refuses to promote a later fetched state as the earlier webhook event state when QBO `LastUpdatedTime` is newer than the webhook event.
- Empty CDC source responses establish acquisition coverage but create no Change Payloads.
- FULL_EXPORT remains an independent comprehensive observation/corroboration source, never a deferred completion mechanism for partial CDC/Webhook observations.
- Adds `98_QBO_SourceObservationAdapters.js` and readiness test `testQboSourceObservationAdapterReadiness()`.

# v1.5.50 — Native CDC 30-Minute Production Acquisition


### v1.5.51 — Immutable Change Payload + shared V2 observation normalization
- Adds `96_QBO_ChangePayloadContract.js`: one immutable entity observation per Change Payload; payload creation does not determine `BusinessStateChanged`.
- Adds `97_QBO_ObservationNormalization.js`: shared raw-entity normalization into `QBO_CANONICAL_STATE_V2_FLATTENED_CONTRACT` using the production FULL_EXPORT row builders and governed child contracts.
- Historical reconstruction can embed the exact RawJSON used for normalization in the immutable payload while retaining source hash/reference/provenance.
- Establishes the normalization boundary required for FULL_EXPORT, Native CDC, Webhooks, and historical replay before State Application.
- Historical backfill orchestration and State Application batching are intentionally not wired in this package.

Changed-files-only package for `50 QBO Import Hub Standalone`.

## Purpose

Replaces the legacy monolithic Native CDC production runner with the governed recurring acquisition architecture. Native CDC acquisition is independent of State Application and may run while the V2 historical canonical rebuild continues.

## Production execution model

- One durable starter trigger runs every 30 minutes, 24/7.
- A cycle freezes one `windowStart` / `windowEnd` and one `CycleId`.
- 20 supported QBO entities are processed in bounded waves of up to 5 entities.
- Continuations are scheduled approximately 2 minutes apart.
- Each entity has `EntityRunId` / `WorkUnitId` identity derived from `CycleId|EntityName`.
- Each worker has a `ContinuationId`, heartbeat, worker lease, runtime budget, and resumable entity cursor.
- ScriptLock is used only for short control, lease, and checkpoint mutations. QBO calls and Drive evidence writes occur outside the project-wide lock.
- Per-entity named leases prevent duplicate acquisition for the same entity.
- Immutable entity response JSON is reconciled before checkpoint advancement.
- If Apps Script terminates after writing evidence but before checkpointing, the next worker recovers the existing file and reconstructs missing metadata rather than issuing a replacement observation.
- The authoritative Native CDC watermark advances only after all 20 entity work units are successfully evidenced and the full-cycle manifest is persisted.
- Failed/partial cycles do not advance the watermark.
- The 30-minute starter also acts as stale-cycle recovery by ensuring a continuation for an already-running cycle rather than starting an overlapping window.

## State Application boundary

This package performs acquisition only. It does not write State Capture snapshots, change records, or change detail. Native CDC evidence, Webhooks evidence, and FULL_EXPORT observations will later converge through the normalized observation / State Application pipeline.

## Initial validation and enablement

After copy/push, run in this order and review each log before proceeding:

```javascript
testQboNativeCdcProductionConfiguration()
listQboNativeCdcStatus()
installQboNativeCdcTriggers()
startQboNativeCdcCycle()
```

Then use:

```javascript
listQboNativeCdcStatus()
listQboNativeCdcTriggers()
```

Do not manually invoke `runNextQboNativeCdcWave()` during normal production operation.

---

# v1.5.49 — State Capture Contract V2 + Controlled Rebuild/Replay

The State Capture Contract Impact Review is resolved as **VERSION + CONTROLLED REBUILD/REPLAY**. `QBO_CANONICAL_STATE_V1` is preserved as historical evidence and is not reconciled in place.

## Canonical contract

`QBO_CANONICAL_STATE_V2_FLATTENED_CONTRACT` derives canonical business state from the governed flattened parent export plus governed child datasets. RawJSON is independent validation/evidence only and is not canonical input. The V2 builder excludes QBO version/audit metadata, root entity identity, reference display names when a stable ID is present, address technical object IDs, and RawJSON evidence columns. Explicit serialization scaffolding (`declaredType`, `scope`, `globalScope`) is removed from governed JSON containers.

## Controlled rebuild/replay

The V2 replay appends a new versioned snapshot/change/detail stream. It does not delete or rewrite V1 rows. Replay runs historical AVAILABLE sources oldest-to-newest, checkpoints after every source, uses deterministic V2 IDs/hashes for idempotent retries, and uses a bounded worker plus watchdog so hard Apps Script termination can be resumed.

Locking follows the Sep. 12 production remediation doctrine: the replay never holds a project-wide `ScriptLock` while processing a source or writing State Capture data. A rebuild-specific worker lease is stored in Script Properties; `ScriptLock` is used only for short atomic lease/control-property mutations. The lease is heartbeated while a bounded worker is active, expires if a worker is hard-killed, and allows the watchdog to restore the worker chain only when no active lease exists. Source checkpoints still advance only after snapshot/change/detail writes are flushed and their deterministic IDs are reconciled from the workbook.

Before starting replay, run:

```javascript
testQboCanonicalV2ContractReadiness()
validateQboFlatteningRemediationContract()
```

Then start once:

```javascript
startQboCanonicalV2Rebuild()
```

Status/recovery controls:

```javascript
listQboCanonicalV2RebuildStatus()
resumeQboCanonicalV2Rebuild()
stopQboCanonicalV2Rebuild()
```

Do not run the legacy V1 `migrateQboCanonicalState*` entry points after deploying this package. They remain in source only as historical migration/reconciliation evidence.

---

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


## v1.5.53 — Durable Change Payload persistence + historical normalization backfill
- Adds immutable, idempotent JSON shard persistence in governed `QBO_CHANGE_PAYLOADS_FOLDER`.
- Adds bounded within-source historical FULL_EXPORT normalization with exact SourceIndex + RecordCursor + WorkUnitIndex resume.
- Watchdog recovery uses durable heartbeat/progress evidence, not lease expiry alone.
- State Application remains disabled in this package.
- Historical Master Backup source artifacts currently use `SOURCE_LINEAGE_SHA256` (cryptographic lineage/reference hash), while each embedded entity RawJSON retains its actual SHA-256.


## v1.5.54 — Historical payload eligibility/control repair
- Restricts historical entity Change Payload backfill to `QBO_STATE_CAPTURE.CANONICAL_MIGRATION_SCOPE`; `PREFERENCES` remains a distinct non-entity/current-preferences scope and is not forced through entity normalization.
- Existing in-flight v1.5.53 run states are forward-compatible: unsupported source IDs already frozen into a run are explicitly skipped with durable progress rather than retried as errors.
- Compacts historical backfill status output so operational fields are not hidden by the frozen source ID list.
- Adds pause/resume trigger controls that preserve the durable cursor and run state.


## v1.5.55 — Historical evidence exceptions and deterministic-error blocking

- Historical FULL_EXPORT rows with an entity Id but missing, truncated, or invalid RawJSON no longer create fabricated normalized state and no longer strand the backfill.
- They are persisted as immutable `EVIDENCE_EXCEPTION` Change Payloads with `rawEntityEvidence.complete=false`, an explicit completeness reason, source/workbook/row provenance, and no normalized state.
- Normalized payload contract version advances to `QBO_CHANGE_PAYLOAD_V3`; already persisted V2 payloads remain immutable historical observations.
- State Application must ignore `EVIDENCE_EXCEPTION` payloads as canonical state inputs while retaining them as audit/completeness evidence.
- Unhandled worker errors now set the backfill to `BLOCKED` and suppress automatic continuation, preventing deterministic retry storms. `resumeQboHistoricalChangePayloadBackfill()` can explicitly resume either RUNNING or BLOCKED state after repair.
- Backfill status now includes `evidenceExceptionCount`.
- `inspectCurrentQboHistoricalChangePayloadBlockedRow()` reports the current source/row, entity Id, RawJSON length, truncation state, and JSON validity without logging the RawJSON body.
- The Sep 13 production blocker was confirmed as legacy Deposit Id `69279` in `QBO_Export_Deposits_20260901_030229`, row 14: its RawJSON is larger than a Google Sheets cell and carries the governed truncation marker.


### v1.5.56 diagnostic repair
- Repairs `inspectCurrentQboHistoricalChangePayloadBlockedRow()` to use the governed export manifest API (`getQboExportManifestEntry_`) and `sheetNames[0]`.
- No historical payload persistence or resume semantics changed from v1.5.55.


## v1.5.57 — Blocked-row diagnostic cursor repair
- `inspectCurrentQboHistoricalChangePayloadBlockedRow()` now prefers a row number preserved in the durable error when that error targets the current source.
- Falls back to the durable record cursor only when no matching row is encoded in the error.
- Diagnostic output reports `rowSelection` and `preservedError` so the inspected row is auditable.
- No Change Payload persistence, evidence-exception, cursor, or resume semantics changed from v1.5.55/v1.5.56.


## v1.5.58 — Recurring Transaction wrapper identity normalization repair
- Repairs shared normalization for QBO `RecurringTransaction` source wrappers whose RawJSON shape is `{Invoice:{...}}`, `{SalesReceipt:{...}}`, etc.
- Governed recurring-template identity is `RecurDataRef.value` / `RecurringTransactionId`, not the embedded transaction `Id`.
- Repairs recurring child-row parent identity to use the same governed recurring-template identity.
- Advances normalization version to `QBO_OBSERVATION_NORMALIZATION_V3_RECURRING_WRAPPER_IDENTITY`; existing immutable payloads remain unchanged.
- Adds `testQboRecurringTransactionObservationNormalization()` regression test.
- No historical cursor, shard persistence, evidence-exception, or State Application behavior changes.


## v1.5.59 — Recurring Transaction regression-test identity assertion repair
- Corrects `testQboRecurringTransactionObservationNormalization()` to validate `RecurringTransactionId` at the governed export-builder boundary.
- Confirms `QBO_CANONICAL_STATE_V2` intentionally excludes row identity fields from canonical parent/child row objects while `normalized.entityId` carries the governed entity identity.
- No recurring normalization semantics, normalization version, historical cursor, persistence, evidence-exception, or State Application behavior changed from v1.5.58.

## v1.5.60 — Shared Forward-Ingestion Control + Native CDC Manual Validation

- Added `103_QBO_ForwardIngestionControl.js` with durable `05_Forward_Ingestion_Control` ledger.
- The forward-ingestion ledger, not Drive folder enumeration and not `90_Ingestion_Log`, is the authoritative processed/unprocessed/checkpoint control for forward source observations.
- Ledger contract is source-neutral for `NATIVE_CDC`, `WEBHOOK`, and `FULL_EXPORT`.
- Added `104_QBO_NativeCdcForwardIngestion.js` for controlled manual registration and ingestion of a fully committed Native CDC cycle.
- Native CDC cycle registration is idempotent by `NATIVE_CDC|<CycleId>|<EntityType>` and registers all 20 entity evidence units, including empty evidence files.
- Empty CDC evidence units create no Change Payloads but are durably marked processed after evidence validation.
- Non-empty CDC evidence is processed in bounded record batches through the existing source adapter, shared V3 normalization, and deterministic Change Payload shard persistence.
- No State Application writes are enabled.
- No automatic registration hook or ingestion trigger is enabled in this phase; those will be wired only after runtime validation.
- No changes were made to shared normalization/persistence modules used by the active historical backfill.


## v1.5.61 — Native CDC readiness normalization-version reference repair

- Repairs `testQboNativeCdcForwardIngestionReadiness()` to read the active normalization version from `QBO_CHANGE_PAYLOAD_CONTRACT_.NORMALIZATION_VERSION`.
- Removes the invalid reference to non-existent `QBO_OBSERVATION_NORMALIZATION_`.
- Test-only/readiness repair; no Native CDC acquisition, forward-ingestion ledger, persistence, normalization, historical backfill, or State Application behavior changed from v1.5.60.

### v1.5.62 — Native CDC manifest cycle identity adapter repair
- Corrects manual Native CDC forward-ingestion registration to read the production manifest's governed `cycleId` field.
- Replaces the invalid `cdcRunId` lookup in `104_QBO_NativeCdcForwardIngestion.js`.
- No acquisition scheduling, normalization, persistence, historical backfill, automatic registration/dispatch, or State Application behavior changes.


### v1.5.63 — Native CDC non-empty historical-cycle manual registration
- Adds `registerLatestUnregisteredNonEmptyQboNativeCdcCycleForIngestion()` for controlled manual validation/backfill discovery.
- The helper scans the governed Native CDC evidence root only to discover a completed non-empty cycle; `05_Forward_Ingestion_Control` remains authoritative for registration/progress/resume.
- Selects the most recent SUCCESS + watermark-committed cycle with `returnedEntityCount > 0` that is not already fully registered, then reuses the existing manifest registration path.
- No acquisition scheduling, normalization, persistence, historical backfill, automatic dispatcher, or State Application semantics changed.


## v1.5.64 — Native CDC production maintenance pause/resume controls

- Adds `pauseQboNativeCdcProduction()` and `resumeQboNativeCdcProduction()`.
- Pause is intentionally broader than removing only the recurring starter: when no Native CDC cycle/worker is active, it sets a durable production-pause flag and removes both `startQboNativeCdcCycle` and all pending `runNextQboNativeCdcWave` triggers.
- Pause refuses with `REFUSED_ACTIVE_CYCLE` when the durable cycle state is `RUNNING`, `INITIALIZING`, or `FINALIZING`, or when a worker lease is still active. It does not reset the successful watermark, cycle state, entity metadata, manifests, or source evidence.
- A starter or continuation invocation that was already dispatched but reaches the control path after the pause flag is set becomes a no-op. This closes the race where deleting a trigger alone cannot cancel an execution that Apps Script has already started.
- While paused, `startQboNativeCdcCycle()`, `resumeQboNativeCdcCycle()`, continuation claiming, and continuation scheduling all honor the durable pause flag.
- Resume clears the pause flag, removes any stale managed triggers, and installs only the recurring `startQboNativeCdcCycle` trigger. It does not create a continuation trigger and does not alter the committed watermark.
- `listQboNativeCdcStatus()` and configuration readiness output now report `productionPaused`.
- Native CDC internal production version advances from `1.1.0` to `1.1.1`. No CDC windowing, entity acquisition, watermark semantics, forward-ingestion normalization, historical backfill, or State Application behavior changes.


## v1.5.65 — Native CDC production handoff, dispatcher, and date-partitioned evidence

- Native CDC acquisition remains a separate pipeline from ingestion and State Application.
- A SUCCESS cycle is registered into `05_Forward_Ingestion_Control` only after the authoritative watermark is committed and the final manifest is persisted.
- The post-commit handoff is durable: a durable FIFO of pending manifest registrations is stored in Script Properties before registration; transient registration failure does not reopen or roll back the acquisition watermark, later cycles cannot overwrite an older pending handoff, and the independent dispatcher retries the oldest handoff idempotently.
- `dispatchQboNativeCdcIngestion` runs independently of acquisition and drains only `NATIVE_CDC` rows from the forward-ingestion ledger through the already runtime-validated adapter/normalization/persistence path.
- Dispatcher cadence is 5 minutes with a separate pipeline lease enforcing one active Native CDC ingestion worker chain. Installation/removal is explicit through `installQboNativeCdcIngestionDispatcher()` and `removeQboNativeCdcIngestionDispatcher()`.
- New Native CDC evidence is stored under `Native CDC/YYYY/MM/DD/<cycle folder>` using UTC dates. Existing flat cycle folders are not moved or rewritten. Manual/backfill discovery supports both layouts.
- `pauseQboNativeCdcProduction()` continues to govern acquisition only: it removes the recurring cycle starter and queued acquisition continuations. The independent ingestion dispatcher is intentionally separate.
- State Application remains disabled.


### v1.5.66 — Forward-ingestion RegisteredAt integrity repair
- `05_Forward_Ingestion_Control.RegisteredAt` is now a required immutable registration timestamp.
- Native CDC manifest registration computes one registration timestamp per cycle handoff and passes it explicitly to all 20 source-unit registrations.
- The shared registration boundary verifies `RegisteredAt` persisted immediately after each insert and fails closed if the cell is blank.
- `repairQboNativeCdc0400RegisteredAt()` performs the one-time repair for the 20 v1.5.65 `0400Z` rows using the observed automatic handoff time `2026-09-14T04:22:53Z` from the production execution log.
- `validateQboNativeCdcRegisteredAtCompleteness()` verifies no Native CDC control rows have blank `RegisteredAt` values.
- No acquisition, watermark, Change Payload, historical backfill, or State Application semantics changed.


## v1.5.67 — Historical Native CDC acquisition-output registration backfill

- Adds `105_QBO_NativeCdcHistoricalRegistrationBackfill.js` for the one-time discovery and registration of historical Native CDC acquisition evidence into `05_Forward_Ingestion_Control`.
- Discovery supports both the preserved legacy flat `Native CDC/<cycle>` layout and the prospective UTC `Native CDC/YYYY/MM/DD/<cycle>` layout. Historical evidence is never moved, renamed, or rewritten.
- Startup freezes the ordered set of committed manifests that still contain one or more unregistered source units. Resume authority is the durable backfill state in Script Properties; Drive enumeration is discovery-only.
- Registration remains idempotent by `NATIVE_CDC|<CycleId>|<EntityType>` and reuses the shared forward-ingestion ledger.
- Historical temporal safety is enforced before registration: non-delete observations must normalize completely from the captured CDC entity object itself. The historical backfill never performs a current targeted QBO fetch and never treats current QBO state as historical event state.
- Historical evidence that is missing, corrupted, count-mismatched, or incomplete is still inventoried in the ledger as `BLOCKED` with an explicit evidence exception so the normal Native CDC dispatcher cannot process it silently.
- `103_QBO_ForwardIngestionControl.js` now supports controlled initial registration as `AVAILABLE` or `BLOCKED`; forward production registrations continue to default to `AVAILABLE`.
- The backfill is bounded, resumable, idempotent, checkpoints after each completed cycle, and uses its own short-lived worker lease and one-time continuation trigger chain.
- `previewQboNativeCdcHistoricalRegistrationBackfill()` is discovery-only and performs no ledger mutation.
- State Application remains disabled.

## v1.5.68 — FULL_EXPORT forward ingestion

- Preserves the locked source-ownership boundary: `01_Sources` remains the authoritative FULL_EXPORT/FULL_EXPORT_LEGACY inventory, while `05_Forward_Ingestion_Control` is the shared Native CDC / Webhook / FULL_EXPORT processing and checkpoint ledger.
- Adds `106_QBO_FullExportForwardIngestion.js` to bridge only post-cutover standard `FULL_EXPORT` sources from `01_Sources` into `05_Forward_Ingestion_Control`, normalize parent RawJSON through the governed V2 observation contract, and persist immutable Change Payload shards.
- Adds a durable one-time cutover marker via `initializeQboFullExportForwardIngestionCutover()`. Historical pre-cutover `01_Sources` rows are never swept into the forward path; they remain owned by the controlled historical Change Payload backfill.
- `FULL_EXPORT_LEGACY` is historical-backfill-only. `PREFERENCES` remains deliberately deferred from entity Change Payload ingestion pending its separate governed attribute-level Preferences State History implementation.
- The standard FULL_EXPORT production auto-registration wrapper now attempts the exact `01_Sources` -> `05_Forward_Ingestion_Control` handoff after `01_Sources` registration has completed and released its lock. A forward-ingestion handoff failure is logged and cannot retroactively turn a successful QBO export into an exporter failure.
- Adds `registerPendingQboFullExportSourcesForForwardIngestion()` as an idempotent recovery scan. It reads `01_Sources` as discovery authority but only registers eligible post-cutover rows missing from `05`.
- Adds independent 5-minute `dispatchQboFullExportIngestion` support with its own pipeline lease, bounded 100-row work units, 210-second runtime budget, 30-second minimum-safe-new-work threshold, and durable checkpointing through the shared ledger.
- Forward FULL_EXPORT RawJSON is fail-closed: missing, truncated, invalid, identity-mismatched, or non-normalizable raw entity evidence blocks that source rather than manufacturing canonical state.
- The controlled `testQboStateCaptureAutoRegistrationOnce()` path now also performs the FULL_EXPORT forward-ingestion handoff when v1.5.68 is present, allowing runtime proof of `01_Sources -> 05 -> Change Payloads` before the nightly FULL_EXPORT schedule is re-enabled.
- State Application remains disabled. No writes to `10_Snapshot_Records`, `11_Change_Records`, or `12_Change_Detail` are enabled in this release.

## v1.5.69 — Webhook forward ingestion

- Adds `107_QBO_WebhookForwardIngestion.js` for post-cutover QBO Webhook receipt ingestion into the shared `05_Forward_Ingestion_Control` ledger.
- Preserves the locked ownership boundary: Webhook evidence does **not** write to `01_Sources`; `01_Sources` remains FULL_EXPORT-specific. The governed Webhooks Drive folder is discovery/evidence storage only, while `05_Forward_Ingestion_Control` remains the authoritative processed/unprocessed/checkpoint control.
- Adds a durable one-time forward cutover via `initializeQboWebhookForwardIngestionCutover()`. The normal forward dispatcher never sweeps pre-cutover historical receipts; those remain reserved for a separate controlled historical Webhook reconstruction/backfill.
- Adds an independent 5-minute `dispatchQboWebhookIngestion` path with its own pipeline lease, bounded 25-event batches, 210-second runtime budget, and 30-second minimum-safe-new-work threshold.
- Webhook receipts are fail-closed before ingestion: source marker, verified signature flag, receipt timestamp, raw-payload SHA-256, base64 payload integrity, declared event count, entity identity, supported entity type, and realm identity are validated.
- Non-delete webhook events still require a targeted QBO fetch. To make retries deterministic, the fetched complete entity is frozen first as an immutable deterministic artifact in governed `QBO_CAPTURED_STATES_FOLDER`; a retry reuses that exact captured state before rebuilding/persisting the Change Payload.
- `98_QBO_SourceObservationAdapters.js` now accepts an already-captured complete Webhook entity as adapter input while retaining the same completeness and temporal-match checks. If no captured entity is supplied, the adapter retains its existing targeted-fetch behavior.
- Delete events continue to normalize as governed tombstone observations without a live fetch.
- State Application remains disabled. This release does not write `04_Webhook_Events`, `10_Snapshot_Records`, `11_Change_Records`, or `12_Change_Detail`.


## v1.5.70 — Controlled historical Webhook reconstruction

- Adds `108_QBO_WebhookHistoricalReconstruction.js` for one-time pre-cutover Webhook reconstruction.
- Historical Webhook events are event-level rows in `05_Forward_Ingestion_Control` with `SourceStatus=HISTORICAL_RECONSTRUCTION`; Webhooks still do not write to `01_Sources`.
- The live Webhook dispatcher is claim-isolated from historical rows.
- DELETE events become tombstones without fetch. Non-delete events are frozen in `Captured States` and only produce a historical Change Payload when QBO `MetaData.LastUpdatedTime` exactly matches the Webhook event `lastUpdated`; newer/older/indeterminate states are BLOCKED instead of fabricated.
- State Application and `04_Webhook_Events` remain disabled.

Validation: `testQboWebhookHistoricalReconstructionReadiness()`, `previewQboWebhookHistoricalReconstructionBackfill()`, then `startQboWebhookHistoricalReconstructionBackfill()` and monitor with `listQboWebhookHistoricalReconstructionStatus()`.

## v1.5.71 — Historical Webhook blocked-event diagnostics and exception classification

- Adds read-only `listQboWebhookHistoricalBlockedDiagnostics()` to enumerate blocked `WEBHOOK` / `HISTORICAL_RECONSTRUCTION` rows from `05_Forward_Ingestion_Control`, reopen the original receipt evidence, and report the exact event identity, source realm, configured realm, source change time, evidence hash, and normalized diagnostic category.
- The diagnostic never mutates `05`, source evidence, Captured States, Change Payloads, or the completed v1.5.70 historical run.
- Realm-mismatch blocking now records both `sourceRealmId` and `configuredRealmId` for future events rather than a generic mismatch token.
- Historical targeted-fetch failures are normalized into governed exception classes. QBO `code=610` / `Object Not Found` is classified as `WEBHOOK_HISTORICAL_ENTITY_UNAVAILABLE_AT_RECONSTRUCTION`; other fetch failures become `WEBHOOK_HISTORICAL_TARGETED_FETCH_FAILED`.
- Existing completed v1.5.70 ledger outcomes are intentionally preserved. This release does not requeue, rewrite, or reprocess any of the 28 historical Webhook events.
- State Application and `04_Webhook_Events` remain disabled.

Validation: run `testQboWebhookHistoricalReconstructionReadiness()` and then `listQboWebhookHistoricalBlockedDiagnostics()`. Confirm the existing eight blocked rows partition into expected temporal mismatches, genuine realm mismatches, and explicit entity-unavailable cases with no unexplained `OTHER_BLOCK` rows.


## v1.5.72 — Forward-Ingestion Maintenance Pause/Resume Controls
- Adds explicit, idempotent maintenance controls for all three recurring forward-ingestion dispatchers without writing additional Script Properties:
  - `pauseQboNativeCdcIngestion()` / `resumeQboNativeCdcIngestion()`
  - `pauseQboFullExportIngestion()` / `resumeQboFullExportIngestion()`
  - `pauseQboWebhookIngestion()` / `resumeQboWebhookIngestion()`
- Pause removes only the managed recurring dispatcher trigger for that pipeline. It does not mutate `05_Forward_Ingestion_Control`, source evidence, payload shards, cursors, or processing statuses.
- Resume reinstalls exactly one 5-minute dispatcher using the existing install/remove idempotency pattern.
- The controls intentionally avoid creating a separate pause-state Script Property so they remain usable during Script Properties storage-quota incidents.
- State Application remains disabled.

## v1.5.73 — Read-Only Script Properties Storage Diagnostic

- Adds `109_QBO_ScriptPropertiesStorageDiagnostic.js` with `diagnoseQboScriptPropertiesStorage()` for the Sep 14, 2026 Apps Script Properties Service quota incident.
- The diagnostic is strictly read-only: it calls `getProperties()` and never sets, deletes, rewrites, or cleans up any Script Property.
- Property values are never logged or returned. Output includes property keys, approximate UTF-8 key/value byte counts, aggregate category totals, growth classifications, the largest properties, and Native CDC entity-metadata cycle counts.
- Explicitly identifies the per-cycle `QBO_NATIVE_CDC_ENTITY_META_V2__*` family so accumulating Native CDC cycle metadata can be measured separately from singleton control state, cutovers, watermarks, cursors, and transient leases.
- Approximate byte counts are diagnostic estimates (`UTF-8 bytes(key) + UTF-8 bytes(value)`); Google remains authoritative for quota accounting.
- No cleanup or migration behavior is included in this release. Use the diagnostic output to design a controlled remediation before deleting or externalizing any property.
- Forward ingestion and Native CDC production should remain paused while collecting this diagnostic during the active quota incident.
- State Application remains disabled.

Validation: with the four production/ingestion pipelines paused, run `diagnoseQboScriptPropertiesStorage()` once and capture the `SUMMARY` execution-log object. Do not run any property cleanup before reviewing the result.

## v1.5.74 — Native CDC transient Script Properties retention and controlled cleanup
- Fixes the production quota incident where per-cycle `QBO_NATIVE_CDC_ENTITY_META_V2__*` properties accumulated indefinitely and consumed approximately 492 KB of the Script Properties store.
- Adds read-only `previewQboNativeCdcTransientPropertyCleanup()` and compact `verifyQboNativeCdcTransientPropertyCleanup()` diagnostics.
- Adds controlled `cleanupQboNativeCdcCommittedTransientProperties()`. Public cleanup requires Native CDC production to be paused and refuses to operate while an active RUNNING/INITIALIZING/FINALIZING cycle exists.
- Cleanup is authorized by durable committed `manifest.json` evidence, not by property age. A manifest must prove `SUCCESS`, `watermarkCommitted=true`, a committed watermark, and a complete exact governed entity-evidence set before the cycle's transient properties are eligible.
- Cleanup deletes only the completed cycle's `QBO_NATIVE_CDC_ENTITY_META_V2__<cycle>__*` and matching `ATTEMPTS__<cycle>__*` properties. Watermark, current cycle state, pause state, leases, pending ingestion handoff, forward-ingestion ledger, Drive evidence, manifests, and payloads are preserved.
- Production Native CDC finalization now performs best-effort automatic transient-property cleanup immediately after the final committed manifest is durably written. Cleanup failure is logged as a warning and cannot invalidate an already committed acquisition cycle.
- The one-time cleanup is idempotent: already-cleaned cycles simply have no remaining transient keys.


### v1.5.75 — Forward-ingestion control integrity audit + controlled-test source isolation
- Adds read-only `auditQboForwardIngestionControlIntegrity()` for lifecycle-integrity validation of `05_Forward_Ingestion_Control`.
- Validates `RegisteredAt` on every row and terminal timestamp/error invariants by `ProcessingStatus`; no historical timestamps are manufactured or repaired by this version.
- Correlates blank FULL_EXPORT `RegisteredAt` values to authoritative `01_Sources.RegisteredAt` where exact recovery evidence exists.
- Explicitly classifies `STATE_CAPTURE_AUTOREG_TEST_*` runs as controlled test evidence. Such rows may remain in `01_Sources` for provenance but are excluded from normal FULL_EXPORT forward-ingestion eligibility and from historical Change Payload backfill eligibility.
- Existing test-derived `05` rows / Change Payloads are preserved pending a separately controlled provenance decision; this version does not delete or rewrite evidence.
- State Application remains disabled.

### v1.5.76 — Comprehensive 01/05 ledger integrity audit
- Expands the v1.5.75 read-only integrity diagnostic into `auditQboStateCaptureLedgerIntegrity()` covering every governed column and every row in both `01_Sources` (19 columns) and `05_Forward_Ingestion_Control` (29 columns).
- Classifies checks as `VALID`, `VALID_BLANK`, `INVALID`, or `UNVERIFIABLE` and aggregates results by sheet, column, and rule code while returning bounded detail rows.
- Validates row identity, source type, run/unit identity, entity/export mappings, Drive-style evidence identifiers, SHA-256/hash-type contracts, source/request/window timestamps, source and processing statuses, counters, claim lifecycle, heartbeat/progress/processed chronology, error compatibility, and registration timestamps.
- Applies source-specific contracts for `NATIVE_CDC`, `WEBHOOK`, `FULL_EXPORT`, `FULL_EXPORT_LEGACY`, Preferences, and controlled `STATE_CAPTURE_AUTOREG_TEST_*` sources.
- Adds cross-sheet FULL_EXPORT invariants from `05` back to `01_Sources`, including run identity, Master Backup evidence identity/name, observation/request timestamps, source status, and exact `01_Sources.RegisteredAt` recovery evidence where `05.RegisteredAt` is blank.
- Keeps the original `auditQboForwardIngestionControlIntegrity()` entry point as a backward-compatible wrapper to the comprehensive audit.
- The audit is strictly read-only. It does not repair historical timestamps, delete controlled-test evidence, mutate source rows, change payloads, or resume any paused pipeline.
- State Application remains disabled.

Validation: keep all writer pipelines paused and run `auditQboStateCaptureLedgerIntegrity()`. Review the summary first, then the bounded findings list. Do not run any repair until invalid and unverifiable rules are classified as repairable, accepted historical exceptions, or source-data defects.

## v1.5.77 — Full QBO State Capture workbook integrity + sheet-role audit

Adds `112_QBO_StateCaptureWorkbookIntegrityAudit.js` and the public read-only entry point:

```javascript
auditQboStateCaptureWorkbookIntegrity()
```

Scope:
- audits every governed sheet in the `QBO State Capture` workbook, not only `01_Sources` and `05_Forward_Ingestion_Control`;
- validates exact governed headers and every populated data row using sheet-specific contracts;
- performs cross-sheet reference checks for FULL_EXPORT source IDs, snapshot references, change-detail references, and contract-audit run IDs;
- invokes the v1.5.76 all-column `01_Sources` / `05_Forward_Ingestion_Control` audit as a sub-audit;
- identifies unexpected sheets and missing governed sheets;
- classifies each sheet by current architectural role and a non-destructive disposition recommendation.

Role classification is intentionally conservative. It distinguishes active authorities from legacy frozen evidence, historical audit evidence, and currently un-wired/reserved source-event sheets. No sheet is deleted or renamed by this audit.

Current role candidates include:
- active: `00_Controls`, `01_Sources`, `05_Forward_Ingestion_Control`, `90_Ingestion_Log`;
- legacy/frozen evidence: `00_Control`, `10_State_Capture`, `90_Run_Log`;
- historical contract-audit evidence: `91_Contract_Audit_Paths`, `92_Contract_Audit_Sources`, `93_Contract_Audit_Runs`;
- reserved/un-wired pending explicit ownership/deprecation decision: `02_CDC_Run_Manifest`, `03_Native_CDC_Events`, `04_Webhook_Events`;
- preserved versioned state outputs/migration reference: `10_Snapshot_Records`, `11_Change_Records`, `12_Change_Detail`.

The audit is strictly read-only and applies no repairs, deletions, renames, trigger changes, Drive changes, or Script Properties changes.


## v1.5.78 — Durable full-workbook integrity reporting
- `auditQboStateCaptureWorkbookIntegrity()` remains read-only with respect to production/state data but now writes diagnostic output to `94_Integrity_Audit_Runs` and `95_Integrity_Audit_Findings`.
- Persists the complete workbook + 01/05 ledger finding set instead of relying on truncated Apps Script logs.
- `94_Integrity_Audit_Runs` is append-only run history; `95_Integrity_Audit_Findings` is append-only finding detail keyed by AuditRunId.
- Diagnostic report sheets are excluded from unknown-sheet findings and are never processing/state authority.
- No repair, deletion, rename, trigger, Drive evidence, or Script Properties mutations are performed by the audit.

## v1.5.79 — Integrity Repair Evidence Assessment

Adds `113_QBO_IntegrityRepairEvidenceAssessment.js` and the public read-only assessment entry point:

```javascript
assessQboStateCaptureIntegrityRepairEvidence()
```

The assessment consumes the latest durable `94_Integrity_Audit_Runs` / `95_Integrity_Audit_Findings` result and classifies each finding as one of:

- `EXACT_REPAIR_AVAILABLE`
- `CONTRACT_FALSE_POSITIVE`
- `HISTORICAL_EXCEPTION`
- `GOVERNANCE_DISPOSITION`
- `SOURCE_EVIDENCE_REVIEW_REQUIRED`

Results are appended to diagnostic-only sheet `96_Integrity_Repair_Assessment`. Production/state sheets are not modified. Exact repair eligibility is intentionally fail-closed: a timestamp is repairable only when an authoritative source contains the exact governed value. Correlated acquisition, observation, payload, or telemetry times are preserved as evidence but are not silently substituted for missing ledger lifecycle timestamps.

`112_QBO_StateCaptureWorkbookIntegrityAudit.js` now recognizes `96_Integrity_Repair_Assessment` as diagnostic output so subsequent full-workbook audits do not misclassify it as an unexpected production sheet.

## v1.5.80 — Exact FULL_EXPORT RegisteredAt repair + audit semantic correction

- Corrects the `01_Sources` ↔ `05_Forward_Ingestion_Control` audit contract: `01_Sources.ObservationStartedAt/ObservationCompletedAt` are not semantically identical to `05.RequestStartedAt/RequestCompletedAt`, so the audit no longer creates the 42 cross-sheet `*_UNVERIFIABLE` false-positive findings. Request timestamps continue to be validated within the source-specific `05` row contract.
- Adds `114_QBO_StateCaptureExactRepair.js` with public controlled repair entry point:

```javascript
repairQboStateCaptureExactRegisteredAt()
```

- The repair consumes only the latest `96_Integrity_Repair_Assessment` rows classified `EXACT_REPAIR_AVAILABLE`, `Confidence=EXACT`, `AutoRepairEligible=true`, targeting `05_Forward_Ingestion_Control.RegisteredAt` for `FULL_EXPORT` and backed by exact `01_Sources.RegisteredAt` evidence.
- It re-resolves each record by `IngestionSourceId`, revalidates the exact matching `01_Sources.SourceId` and timestamp, fails closed before any write if any candidate is inconsistent, never overwrites a different nonblank value, and is idempotent for already-applied exact values.
- Successful writes are immediately reread and verified, then append-only repair telemetry is written to `97_Integrity_Repair_Log`.
- No Native CDC/Webhook lifecycle timestamps are inferred or repaired. No state outputs, Change Payloads, Drive evidence, triggers, Script Properties, or pipeline pause state are changed.
- `112_QBO_StateCaptureWorkbookIntegrityAudit.js` recognizes `97_Integrity_Repair_Log` as diagnostic output.
- State Application remains disabled and writer pipelines remain paused pending post-repair audit validation.


## v1.5.82 — Resumable exact RegisteredAt repair
- Makes the v1.5.80 exact repair idempotent after partial failure.
- Re-resolves target row by IngestionSourceId before and after every write.
- Retries exact cell persistence up to 3 times with flush + bounded delay.
- Appends repair telemetry per candidate immediately, so partial runs remain fully evidenced.
- Existing exact values are preserved as already applied; conflicting nonblank values still fail closed.
- Scope remains limited to the 21 pre-assessed FULL_EXPORT 05.RegisteredAt repairs.

## v1.5.83 — RegisteredAt exact-recovery evidence assessment
- Adds `115_QBO_RegisteredAtEvidenceAssessment.js` with public `assessQboBlankRegisteredAtRecoveryEvidence()`.
- Production/state data are read-only. The diagnostic writes only `98_RegisteredAt_Evidence_Assessment`.
- Native CDC exact recovery is allowed only when a blank row has nonblank same-cycle sibling rows whose `RegisteredAt` values collapse to exactly one timestamp. This is grounded in both the current (`104`) and historical (`105`) Native CDC registration writers, which capture one `registeredAt` value before iterating all entities in a cycle.
- `RequestCompletedAt`, manifest timestamps, webhook receipt timestamps, and telemetry are never substituted for `RegisteredAt`.
- Webhook historical rows are not reconstructed from sibling events because `108` captures `new Date()` independently for each event registration.
- `112_QBO_StateCaptureWorkbookIntegrityAudit.js` recognizes `98_RegisteredAt_Evidence_Assessment` as diagnostic-only output so future workbook audits do not classify it as an unexpected production sheet.

## v1.5.84 — RegisteredAt artifact correlation assessment
- Expands `assessQboBlankRegisteredAtRecoveryEvidence()` before any repair decision.
- Confirms by code contract that Change Payload filenames are content identities (`qbo_change_payload_shard_<SHA256>.json`) and contain no timestamp.
- Reads the governed source evidence file creation time plus matching Change Payload shard envelope `createdAt` and Drive creation time for the blank-RegisteredAt population and known same-cycle calibration rows.
- Reports empirical millisecond deltas between surviving known `RegisteredAt` values and artifact timestamps.
- Artifact timestamps remain corroborating evidence only: source evidence is created during acquisition before registration, while payload envelope/Drive timestamps are independently captured downstream during persistence after registration. No artifact timestamp is promoted to an exact repair candidate merely because it is close or happens to match.
- Existing exact Native CDC same-cycle sibling evidence remains the only newly authorized exact-recovery channel in this assessment.
- Production/state data remain read-only; diagnostic output continues to `98_RegisteredAt_Evidence_Assessment`.

## v1.5.85 — Bounded/resumable RegisteredAt Change Payload artifact scan
- Replaces the unbounded v1.5.84 payload-folder scan path with a separate bounded diagnostic entry point: `scanQboRegisteredAtPayloadArtifactsResumable()`.
- Runtime budget is 165 seconds per invocation with progress logging approximately every 15 seconds.
- Uses Drive file-iterator continuation tokens and one compact temporary Script Property checkpoint; checkpoint is deleted automatically when the scan completes.
- Writes matched Change Payload artifact metadata incrementally to diagnostic-only `99_RegisteredAt_Artifact_Scan` so progress survives interruption.
- Records `PayloadFileName`, `PayloadFileId`, payload-envelope `createdAt`, Drive creation time, WorkUnitId, and IngestionRunId for each matched shard.
- Payload filenames remain non-authoritative metadata (`qbo_change_payload_shard_<SHA256>.json`); no production/state repair is performed.
- `112_QBO_StateCaptureWorkbookIntegrityAudit.js` recognizes sheet 99 as diagnostic output.

### v1.5.86 — RegisteredAt target artifact coverage diagnostic

Adds `diagnoseQboRegisteredAtArtifactCoverage()` to replace blind continuation of the expensive payload-content scan. The diagnostic is read-only and:

- counts the total number of files in the governed Change Payload folder without opening/parsing JSON;
- summarizes the 05 rows whose `RegisteredAt` is blank;
- reports `ObservationCount`, `PayloadCount`, and `ShardCount` evidence from 05;
- compares target source IDs with artifacts already found in `99_RegisteredAt_Artifact_Scan`;
- reports whether affected rows claim they actually produced payload shards.

Do not continue `scanQboRegisteredAtPayloadArtifactsResumable()` until this diagnostic is reviewed.


## v1.5.88 — Forward Ingestion Lifecycle Contract Audit

- Refines the read-only `05_Forward_Ingestion_Control` lifecycle audit to the actual shared control/writer contract.
- `RegisteredAt` is required for every legitimate ledger row.
- `PROCESSED` requires `LastHeartbeatAt`, `LastProgressAt`, and `ProcessedAt`, including zero-observation terminal processing because all current adapters checkpoint with `progress:true`.
- Initial `AVAILABLE` rows (`AttemptCount=0`) may have blank heartbeat/progress timestamps; resumed/partial `AVAILABLE` rows with prior attempts or committed progress require them.
- `PROCESSING` requires a heartbeat but may legitimately have blank `LastProgressAt` before its first checkpoint.
- Initially registered `BLOCKED` rows (`AttemptCount=0`) may have blank heartbeat/progress; worker-blocked rows require heartbeat, while progress is required only if committed work already exists.
- `ProcessedAt` remains required only for `PROCESSED`; `ProcessingError` remains required only for `BLOCKED` and blank for active/successful states.
- This version is audit-only and does not repair or mutate production/state data.


## v1.5.89 — Lifecycle audit correction
- Corrects the v1.5.88 diagnostic-only integrity audit regression.
- Removes duplicate validation of `05.RegisteredAt` (one governed required-date check remains).
- Restores the v1.5.80+ rule that `05.RequestStartedAt` / `05.RequestCompletedAt` are not exact-equality invariants against `01_Sources` observation timestamps.
- Retains the v1.5.88 lifecycle/state-machine checks, including heartbeat requirements after a worker claim and terminal timestamp requirements for `PROCESSED`.
- Read-only against production/state data; audit reporting behavior is unchanged.

## v1.5.90 — Native CDC exact RegisteredAt recovery assessment rebased on lifecycle audit

- Reintroduces the read-only Native CDC exact `RegisteredAt` recovery assessment on top of the validated v1.5.89 forward-ingestion lifecycle audit baseline.
- Adds `117_QBO_NativeCdcRegisteredAtRecoveryAssessment.js` with public entry point:

```javascript
assessQboNativeCdcRegisteredAtExactRecovery()
```

- Reads the latest durable workbook-integrity audit and targets only blank `05_Forward_Ingestion_Control.RegisteredAt` findings for `NATIVE_CDC`.
- Groups all Native CDC `05` rows by `SourceRunId` / cycle and classifies blank targets as `EXACT_RECOVERABLE`, `HISTORICAL_TIMESTAMP_NOT_RECOVERABLE`, or `CONFLICTING_SAME_CYCLE_REGISTERED_AT_VALUES`.
- Exact recovery is authorized only when all surviving nonblank `RegisteredAt` values within the same cycle collapse to one identical timestamp. This follows the governed Native CDC writer contract in which one registration timestamp is captured before iterating the entity rows for a cycle.
- Request-completion times, evidence-file times, payload-artifact times, manifest times, and telemetry are not substituted for `RegisteredAt`.
- Writes diagnostic-only output to `100_Native_CDC_RegAt_Assessment`; no production/state value is mutated and no repair is performed.
- Updates `112_QBO_StateCaptureWorkbookIntegrityAudit.js` so sheet `100_Native_CDC_RegAt_Assessment` is recognized as diagnostic-only output without altering the v1.5.89 lifecycle ledger rules.
- The v1.5.86 artifact-coverage result remains controlling for this question: the 106 affected Native CDC rows produced zero observations, zero payloads, and zero shards, so Change Payload artifacts are not an exact-recovery channel for those rows.


## v1.5.91 — Lifecycle Timestamp Exact-Recovery Assessment
- Adds read-only `assessQboLifecycleTimestampExactRecovery()`.
- Targets latest-audit invalid blanks in `05_Forward_Ingestion_Control` for `LastHeartbeatAt`, `LastProgressAt`, and `ProcessedAt`.
- Writes diagnostic-only `101_Lifecycle_Timestamp_Assessment`; does not repair production/state data.
- Exact recovery is authorized only where the writer contract preserves the exact same timestamp elsewhere: terminal PROCESSED checkpoint sibling timestamps; AVAILABLE partial-checkpoint heartbeat/progress siblings; or PROCESSING claim expiry minus the fixed 360000 ms timeout.
- BLOCKED heartbeat/progress timestamps are not reconstructed from proximate timestamps. Source timestamps, Change Payload `createdAt`, Drive timestamps, and generic ingestion telemetry are not exact substitutes.
- `112_QBO_StateCaptureWorkbookIntegrityAudit.js` recognizes sheet 101 as diagnostic output.

## v1.5.92 — Historical unrecoverable timestamp exception governance

- Adds `119_QBO_HistoricalTimestampExceptionGovernance.js`.
- Public establishment function: `establishQboHistoricalTimestampExceptionGovernance()`.
- Public control function: `auditQboHistoricalTimestampExceptionGovernance()`.
- Adds diagnostic/governance sheet `102_Historical_Timestamp_Exceptions`.
- The registry is exact-identity scoped by `IngestionSourceId + ColumnName`; it is not a date-range, source-type, or blanket exception.
- Establishment is fail-closed and expects the validated v1.5.89/v1.5.90/v1.5.91 baseline: 464 unrecoverable timestamp defects (`RegisteredAt` 107, `LastHeartbeatAt` 127, `LastProgressAt` 115, `ProcessedAt` 115).
- No historical timestamp is manufactured or backfilled. Registered blanks remain physically blank.
- `111_QBO_ForwardIngestionIntegrityAudit.js` recognizes only ACTIVE exact-identity registry entries as `HISTORICAL_UNRECOVERABLE_WRITER_DEFECT` / `VALID_BLANK`. Any new or unregistered equivalent blank remains `REQUIRED_DATE_BLANK` / `INVALID`.
- `112_QBO_StateCaptureWorkbookIntegrityAudit.js` recognizes sheet 102 as diagnostic/governance output.
- Production/state data remains read-only. The only write performed by establishment is the governance registry itself.

## v1.5.93 — Controlled Test Contamination Assessment

- Adds `120_QBO_ControlledTestContaminationAssessment.js`.
- Public diagnostic entry point: `assessQboControlledTestContamination()`.
- The assessment is resumable and production/state read-only. Re-run the same function until it returns `DIAGNOSTIC_COMPLETE`.
- Exact lineage traced:
  - controlled-test registration in `01_Sources`;
  - controlled-test forward-ingestion rows in `05_Forward_Ingestion_Control`;
  - Change Payload shards by exact `stableBody.sourceId == IngestionSourceId`;
  - `10_Snapshot_Records` and `11_Change_Records` by exact `SourceId`;
  - `12_Change_Detail` through exact test-derived `ChangeRecordId` lineage.
- Diagnostic output only:
  - `103_Controlled_Test_Assessment` — one summary row per exact controlled-test source;
  - `104_Controlled_Test_Payload_Artifacts` — one row per exact matching payload shard.
- No source row, 05 row, Change Payload shard, snapshot, change record, or change detail is changed or deleted.
- No governance disposition or deletion is authorized by the assessment itself.
- `112_QBO_StateCaptureWorkbookIntegrityAudit.js` is updated only to recognize sheets 103/104 as diagnostic output with governed header widths.

## v1.5.94 — Targeted Controlled-Test Payload Artifact Reconciliation

- Replaces the v1.5.93 blind/resumable full-folder Change Payload scan with a bounded targeted Drive search derived from the exact controlled-test row already present in `05_Forward_Ingestion_Control`.
- For the known FULL_EXPORT controlled-test source, derives the deterministic one-batch work unit from the governed writer contract (`RecordCursorStart=0`, `RecordCursorEndExclusive=55`) and validates exact `IngestionSourceId`, `SourceType`, `IngestionRunId`, `WorkUnitId`, cursor bounds, observation count, payload count, evidence file lineage, shard self-hash, and hash-derived filename.
- Candidate files are narrowed before JSON parsing using the target row's own durable lifecycle timestamps (`RegisteredAt`, request timestamps, heartbeat/progress timestamps, and `ProcessedAt`) plus a five-minute boundary pad and the governed shard filename prefix.
- Does **not** manufacture the original worker/continuation ID. That value is not retained in the completed `05` row and therefore the shard filename cannot be independently reconstructed from `05` alone.
- Retires/deletes only the v1.5.93 diagnostic Script Property checkpoint; production/state data and Change Payload artifacts remain read-only.
- `assessQboControlledTestContamination()` is now expected to complete in one targeted invocation for the known controlled-test source rather than requiring repeated full-folder scans.



## v1.5.95 — Controlled-Test Targeted Artifact Search Query Repair

- Repairs the v1.5.94 diagnostic failure `Exception: Invalid argument: q` from `DriveApp.Folder.searchFiles()`.
- Removes dependence on Drive query parsing for the targeted controlled-test artifact search.
- Enumerates only file metadata in the governed Change Payload folder, filters first by the governed shard filename prefix and the exact lifecycle-derived creation-time window, and opens/parses JSON only for the resulting small candidate set.
- Preserves all v1.5.94 exact-lineage validation: `IngestionSourceId`, `SourceType`, deterministic `IngestionRunId`, deterministic FULL_EXPORT `WorkUnitId`, cursor bounds, counts, evidence lineage, shard self-hash, and hash-derived filename.
- Production/state data and Change Payload artifacts remain read-only; no deletion or disposition is authorized.

## v1.5.96 — Governed Controlled-Test Evidence Disposition

- Adds `121_QBO_ControlledTestDisposition.js` with public entry point `disposeQboControlledTestEvidence()`.
- This is an exact-lineage cleanup for the two known `STATE_CAPTURE_AUTOREG_TEST_*` registrations reconciled by v1.5.95; it is not a generic test-data deletion utility.
- Fail-closed preflight requires the validated v1.5.95 evidence to remain exact: two controlled-test registrations in `01_Sources`, one corresponding `05_Forward_Ingestion_Control` row, one exact Change Payload shard with 55 observations / 55 payloads, exact shard self-hash / hash-derived filename / evidence lineage, and zero controlled-test rows in `10_Snapshot_Records`, `11_Change_Records`, and `12_Change_Detail`.
- On successful preflight, removes the two exact controlled-test registrations from active `01_Sources`, removes the one exact controlled-test row from active `05_Forward_Ingestion_Control`, and moves the one exactly reconciled Change Payload shard to Drive trash. The shard is not permanently deleted.
- Retains `103_Controlled_Test_Assessment` and `104_Controlled_Test_Payload_Artifacts` as durable evidence and marks the summary rows with governance disposition `CONTROLLED_TEST_EVIDENCE_DISPOSED_EXACT_LINEAGE` plus `ProductionDataMutationApplied=true`.
- The function is idempotent after successful completion and returns `ALREADY_DISPOSED` rather than mutating again.
- No State Application output is deleted because v1.5.95 proved controlled-test State Application contamination count is zero.
- Required next control after successful disposition: run `auditQboStateCaptureWorkbookIntegrity()` before implementing the payload-artifact ledger or resuming any paused ingestion cycles.

## v1.5.97 — Payload Artifact Ledger + Historical Reconstruction

- Adds `122_QBO_PayloadArtifactLedger.js` and governed `06_Payload_Artifacts` as the durable child provenance ledger for Change Payload shards.
- `05_Forward_Ingestion_Control` remains source-level aggregate authority; `06_Payload_Artifacts` stores one row per physical shard file.
- Minimum provenance includes `IngestionSourceId`, `SourceType`, `SourceRunId`, `IngestionRunId`, `WorkUnitId`, cursor bounds, observation/payload counts, file ID/name/hash, file creation time, and persistence time. Additional fields record `RegistrationMode`, `LineageStatus`, and `ContentVerifiedAt` so historical uncertainty is surfaced rather than guessed.
- `101_QBO_ChangePayloadPersistence.js` now registers every newly created or idempotently reconciled shard in `06_Payload_Artifacts` before the source-level `05` checkpoint advances. This makes retry recovery deterministic if execution ends between physical shard creation, artifact-ledger registration, and source checkpointing.
- Native CDC, FULL_EXPORT, and Webhook forward-ingestion writers now pass `SourceRunId` into shard persistence so future artifact provenance is complete at commit time.
- Adds `123_QBO_PayloadArtifactHistoricalBackfill.js` with `runQboPayloadArtifactHistoricalBackfill()`. Historical reconstruction reads existing Change Payload files and `05` in place, writes only `06` plus diagnostic sheets, verifies shard stable-body SHA-256 and hash-derived filename, and registers unmatched/mismatched historical lineage explicitly rather than fabricating it.
- Historical backfill is resumable by ledger state rather than by large Script Properties: subsequent invocations skip already registered physical file IDs and continue only with unledgered shards.
- Adds `auditQboPayloadArtifactReconciliation()` to reconcile physical shard inventory, `06` rows, and `05` source-level `ShardCount`/`PayloadCount` totals and to surface duplicate, missing, orphan, non-exact, or aggregate-mismatch conditions.
- No Native CDC, Webhook, FULL_EXPORT, or State Application cycles are resumed by this release.


## v1.5.98 — Historical Payload Artifact Source-Lineage Reconciliation
- Recognizes module 102 historical reconstruction shards (`HIST_PAYLOAD|...` / `HISTWU|...`) as exactly source-reconciled when their embedded `sourceId` matches authoritative `01_Sources`, even when no `05_Forward_Ingestion_Control` row exists.
- Adds `HISTORICAL_SOURCE_EXACT_NO_05` lineage status. This is an exact historical source relationship, not an orphan and not a synthetic 05 relationship.
- Adds `reconcileQboHistoricalPayloadArtifactSourceLineage()` to upgrade previously inventoried `ORPHAN_NO_05_SOURCE` rows only after re-reading the immutable shard, revalidating SHA-256/filename, exact embedded lineage, and exact 01 source identity.
- Does not mutate Change Payload files, `01_Sources`, or `05_Forward_Ingestion_Control`.
- Reconciliation audit accepts both forward `EXACT_RECONCILED` and historical `HISTORICAL_SOURCE_EXACT_NO_05` as exact lineage classes.

## v1.5.99 — Self-Continuing Payload Artifact Historical Backfill
- `runQboPayloadArtifactHistoricalBackfill()` now starts a single self-continuing bounded worker chain. When the 225-second worker budget is reached, exactly one one-time continuation trigger is scheduled after a short delay.
- `06_Payload_Artifacts` remains the durable resume authority; no per-file or per-cycle Script Properties checkpoint is introduced. Each continuation re-enumerates metadata and skips already-ledgered physical file IDs before opening unledgered shard content.
- Completion is now governed by actual Drive iterator exhaustion (EOF). A runtime-truncated pass can no longer report a misleading `remainingEstimate=1`; `remainingEstimate` is null until EOF is proven.
- Diagnostic summary now records `IteratorExhausted` and `ContinuationScheduled`. `FolderShardCount` is the number of governed shard files encountered by that attempt and is authoritative as the complete physical count only when `IteratorExhausted=true`.
- Continuation trigger management is short-lock scoped and deduplicated; long shard processing never holds the ScriptLock. On successful EOF completion, continuation triggers are removed.
- Adds `cancelQboPayloadArtifactHistoricalBackfillContinuation()` as an explicit stop control. Payload files and `05_Forward_Ingestion_Control` remain read-only throughout historical backfill.
- Paused Native CDC, Webhook, FULL_EXPORT ingestion and State Application are not resumed by this release.


## v1.5.100 — Backfill summary schema migration
- Repairs the v1.5.99 runtime schema mismatch on populated `106_Payload_Artifact_Backfill_Summary`.
- Performs a fail-closed, append-only migration only when the existing 12-column v1.5.98 summary header matches exactly.
- Appends `IteratorExhausted` and `ContinuationScheduled`; existing summary rows and evidence are preserved unchanged.
- Self-continuation behavior and EOF-only completion semantics from v1.5.99 are unchanged.
