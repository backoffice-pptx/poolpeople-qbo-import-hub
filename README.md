
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
