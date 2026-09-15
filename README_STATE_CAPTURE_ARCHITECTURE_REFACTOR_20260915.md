# App 50 Architecture Refactor & State Capture Contract Recovery

**Application:** 50 QBO Import Hub Standalone  
**Status date:** 2026-09-15  
**Status:** Architecture/refactor path locked; source/lifecycle audit in progress; production State Capture ingestion and State Application remain paused.  
**Purpose:** Durable handoff and implementation authority for bringing App 50 forward to the currently governed State Capture contracts without gaps, duplicate admission, or accidental reactivation of superseded code.

---

## 1. Why this refactor exists

App 50 evolved through multiple generations of QBO exports, State Capture, Native CDC, Webhook ingestion, historical reconstruction, diagnostics, and trigger orchestration. The current source contains overlapping generations of production and migration code.

The historical reconstruction work established stronger contracts than some current forward-ingestion code implements. The forward system must now be brought to the same contracts before production State Capture processing resumes.

This is a coordinated architecture migration, not a piecemeal cleanup.

Key problems being corrected:

- Forward FULL_EXPORT, Native CDC, and Webhook ingestion do not all pass through their governed source ledgers before State Capture ingestion.
- Current `05` processing code is an older contract.
- Existing Native CDC and Webhook paths can register directly into old 05.
- Webhook forward processing does not currently make 04 the durable source-event ledger.
- Multiple independent trigger/pause/resume/watchdog implementations exist.
- Historical/migration writers remain publicly callable.
- Existing cutover timestamp logic is insufficient to prove historical-to-forward continuity.
- Module numbering no longer communicates architecture and collisions/ambiguity have developed.
- Code that is dead, superseded, migration-only, or still production authority is not yet consistently marked or disabled.

---

## 2. Governing ingestion rule

Historical reconstruction, catch-up processing, and forward production use the **same governed contracts**.

They may differ only in:
- evidence acquisition method;
- `RegistrationMode`;
- bounded input population / recovery mode.

They do **not** get separate source-ledger, eligibility, identity, payload, or checkpoint semantics.

### FULL_EXPORT

```text
immutable FULL_EXPORT evidence
        ↓
01_Sources
        ↓
eligibility / population gate
        ↓
State Capture Ingestion / 05
        ↓
Change Payload
        ↓
06_Payload_Artifacts
```

### Native CDC

```text
attempt evidence
        ↓
02a_CDC_Run_Attempts_V2
        ↓
committed evidence
        ↓
02b_CDC_Committed_Runs_V2
        ↓
03_Native_CDC_Events_V2
        ↓
eligibility
        ↓
State Capture Ingestion / 05
        ↓
Change Payload
        ↓
06_Payload_Artifacts
```

### Webhooks

```text
immutable webhook receipt
        ↓
04_Webhook_Events_V2
        ↓
targeted capture when required
        ↓
eligibility
        ↓
State Capture Ingestion / 05
        ↓
Change Payload
        ↓
06_Payload_Artifacts
```

### Hard invariants

1. **05 may never be the first durable record of a source observation.**
2. 06 artifacts may only derive from observations admitted through the governed source-ledger → State Capture Ingestion/05 path.
3. Deterministic payload persistence and 06 registration/reconciliation occur before the corresponding 05 checkpoint is committed.
4. Retry/resume validates and reconciles deterministic existing output; it must not append duplicate logical observations.
5. Source operation is evidence, not automatically a State Application change.
6. Exact logical observation identity governs duplicate admission; repeated evidence with distinct valid observation identities may legitimately corroborate the same state.

---

## 3. Source-ledger count contracts

### 01_Sources — FULL_EXPORT

`ObservationCount` = complete number of entity observations in that specific immutable FULL_EXPORT snapshot/source at acquisition.

Gate:

```text
01.ObservationCount
=
actual observations in referenced immutable MasterBackup
→ eligible population
→ 05.ExpectedObservationCount
```

01 count is acquisition population, not necessarily admitted population.

01 ObservationCount backfill may be deferred while other source reconstruction proceeds, but it must be populated/reconciled before final FULL_EXPORT source Gate A / unified source certification / 05 certification.

### Native CDC

02a and 02b carry:

- `CompletedEntityCount`
- `ReturnedEntityCount`
- `LiveEntityCount`
- `DeletedEntityCount`

No generic ObservationCount is added to 02a/02b.

03 is one row per source observation and has no count column.

Required gates:

```text
02b.ReturnedEntityCount = COUNT(03 rows for CdcRunId)

02b.LiveEntityCount + 02b.DeletedEntityCount
= 02b.ReturnedEntityCount
```

For a governed Native CDC source unit:

```text
COUNT(eligible 03 observations)
= 05.ExpectedObservationCount
```

Committed zero-observation runs remain explicit:
- 02b proves returned 0;
- 03 rows = 0;
- 05 expected/processed/payload/shard counts = 0 and COMPLETE.

### Webhooks

04 is one row per webhook event.

`ReceiptEventCount` is receipt-level acquisition count and is repeated across rows belonging to the same receipt.

Gate:

```text
04.ReceiptEventCount
=
COUNT(04 rows for WebhookReceiptId)
```

Then:

```text
COUNT(eligible 04 events for governed receipt/source unit)
=
05.ExpectedObservationCount
```

### State Capture Ingestion / 05 to 06

Final processing reconciliation:

```text
05.ExpectedObservationCount
=
05.ProcessedObservationCount
=
Σ 06.ObservationCount
=
Σ 06.PayloadCount
```

This must also be proven by exact identity/lineage coverage, not aggregate equality alone.

---

## 4. Locked source-ledger contracts

### 02a_CDC_Run_Attempts_V2

One row per governed Native CDC attempt. Created when durable attempt evidence exists so a hard termination still leaves an attempt identity.

Fields:

```text
CdcAttemptId
CdcRunId
AttemptIdentityBasis
AcquisitionClassification
SourceAcquisitionType
RunStartedAt
RunCompletedAt
WindowStart
WindowEnd
InitialRun
InitialLookbackDays
OverlapMinutes
PriorSuccessfulWatermark
EntityTypesRequested
CompletedEntityCount
ReturnedEntityCount
LiveEntityCount
DeletedEntityCount
AcquisitionStatus
WatermarkCommitted
CommittedWatermark
ManifestFileId
ManifestFileName
ManifestHash
RunFolderId
RunFolderName
MinorVersion
CodeVersion
EvidenceCreatedAt
RegistrationMode
RegisteredAt
```

02a may contain failed/uncommitted attempts.

### 02b_CDC_Committed_Runs_V2

Only committed Native CDC runs.

Fields:

```text
CdcRunId
CdcAttemptId
AcquisitionClassification
SourceAcquisitionType
RunStartedAt
RunCompletedAt
WindowStart
WindowEnd
InitialRun
InitialLookbackDays
OverlapMinutes
PriorSuccessfulWatermark
CommittedWatermark
WatermarkCommitted
EntityTypesRequested
CompletedEntityCount
ReturnedEntityCount
LiveEntityCount
DeletedEntityCount
ManifestFileId
ManifestFileName
ManifestHash
RunFolderId
RunFolderName
MinorVersion
CodeVersion
EvidenceCreatedAt
RegistrationMode
RegisteredAt
```

Strict:
- exactly one 02a parent;
- `WatermarkCommitted=true`;
- parent 02a `AcquisitionStatus=SUCCESS`;
- hard termination after watermark commit but before 02b registration must be deterministically recoverable from committed evidence.

### 03_Native_CDC_Events_V2

One row per committed Native CDC observation.

Fields:

```text
NativeCdcEventId
CdcRunId
CdcAttemptId
SourceId
EntityRunId
EntityType
EvidenceIndex
EntityId
Operation
QboStatus
DeletedFlag
QboSyncToken
QboCreateTime
QboLastUpdatedTime
ObservedAt
SourceChangeTime
SparseFlag
EvidenceFileId
EvidenceFileName
EvidenceHash
EvidenceHashType
RequestStartedAt
RequestCompletedAt
QboResponseTime
RawEntityHash
EvidenceStatus
EligibilityStatus
EligibilityReason
AcquisitionClassification
EvidenceCreatedAt
RegistrationMode
RegisteredAt
```

`SourceId = NATIVE_CDC|CdcRunId|EntityType`.

`ObservedAt` is acquisition observation chronology, not QBO LastUpdatedTime.

### 04_Webhook_Events_V2

Fields:

```text
WebhookEventId
WebhookReceiptId
EventIndex
ReceivedAt
RealmId
EntityType
EntityId
EventOperation
QboLastUpdatedTime
SourceChangeTime
SignatureVerified
ReceiptEventCount
ReceiptFileId
ReceiptFileName
RawPayloadHash
RawPayloadHashType
ReceiptEvidenceStatus
DuplicateEvent
EligibilityStatus
EligibilityReason
TargetedCaptureRequired
TargetedCaptureFileId
TargetedCaptureFileName
TargetedCaptureAt
TargetedCaptureRawEntityHash
TargetedCaptureStatus
EvidenceCreatedAt
RegistrationMode
RegisteredAt
```

`WebhookEventId = WEBHOOK|<WebhookReceiptId>|EVENT|<EventIndex>`.

`EMAILED` is a first-class preserved `EventOperation`. It is never normalized to UPDATE or discarded.

DELETE tombstones do not require targeted capture.

Historical non-delete events lacking contemporaneous capture remain valid source evidence but cannot manufacture historical entity state from a current fetch. Use explicit historical missing-capture status.

### State Capture Ingestion / 05 V2

Fields:

```text
IngestionSourceId
SourceType
SourceLedger
SourceRunId
SourceUnitId
EntityType
EvidenceFileId
EvidenceFileName
EvidenceHash
EvidenceHashType
ExpectedObservationCount
ProcessingStatus
RecordCursor
ProcessedObservationCount
PayloadCount
ShardCount
AttemptCount
ClaimOwner
ClaimExpiresAt
LastHeartbeatAt
LastProgressAt
ProcessedAt
ProcessingError
RegisteredAt
```

Source ledger mapping:

```text
FULL_EXPORT → 01_Sources
NATIVE_CDC  → 03_Native_CDC_Events
WEBHOOK     → 04_Webhook_Events_V2
```

`ExpectedObservationCount` derives from eligible governed upstream evidence.

`ProcessedObservationCount` derives from durable processing/06 evidence.

05 does not own source chronology and does not carry the old ObservedAt role.

### 06_Payload_Artifacts

One row per physical immutable Change Payload shard.

Fields:

```text
IngestionSourceId
SourceType
SourceRunId
IngestionRunId
WorkUnitId
RecordCursorStart
RecordCursorEndExclusive
ObservationCount
PayloadCount
PayloadFileId
PayloadFileName
PayloadShardHash
PayloadCreatedAt
PersistedAt
RegistrationMode
LineageStatus
ContentVerifiedAt
```

06 is durable artifact/resume authority.

---

## 5. Change Payload evidence contract

`Change Payloads/` stores immutable normalized, source-independent entity observations prepared for State Application.

One logical Change Payload represents:

```text
EntityType + EntityId + Observation
```

A physical shard may contain multiple logical observations.

Raw/source evidence remains preserved in source-specific evidence locations.

Canonical State V2 derives from the governed flattened export contract plus governed child datasets. RawJSON is validation/controlled historical exception evidence, not the canonical definition.

---

## 6. State Application V2

State Application remains disabled until separately validated.

Chronology:

- `ObservedAt` is primary evidence chronology.
- QBO SyncToken / LastUpdatedTime are supporting evidence.
- PayloadCreatedAt, PersistedAt, ingestion order, and 06 row order do not establish business chronology.
- Same SyncToken with differing states at different ObservedAt can be legitimate.
- Equal ObservedAt + differing states requires evidence resolution or explicit ambiguity; never arbitrary source priority.

Controlled rebuild:

```text
complete eligible observation population
→ sort by ObservedAt
→ resolve equal-time cases
→ collapse identical canonical states
→ Snapshots / Snapshot Observations
→ Changes
→ Change Detail
```

13 `Snapshot_Observations` assigns every admitted eligible payload observation exactly once as ESTABLISHING or CORROBORATING.

10 contains authoritative distinct canonical state occurrences.

11 contains transitions only between consecutive distinct authoritative snapshots.

12 contains canonical field differences.

A Native CDC source operation of UPDATE/UPSERT does not itself prove an 11 transition. If no prior authoritative state exists, the observation establishes a snapshot; no prior state is fabricated.

---

## 7. Historical-to-forward continuity — zero-gap cutover

The completed historical 06 backfill is a **checkpoint, not the terminal population**.

Checkpoint established:

```text
3,455 physical artifacts
734,913 observations/payloads
```

Every eligible source observation from the beginning of retained source evidence through production cutover must eventually be represented in:

```text
governed source ledger
→ State Capture Ingestion / 05
→ Change Payload
→ 06
```

Anything arriving after the historical backfill input boundary is a **catch-up population**, not a special new backfill architecture.

Required model:

```text
Historical population
        ↓
same governed ingestion contract
        ↓
historical 06 checkpoint
        │
        ▼
Catch-up population accumulated while paused
        ↓
same governed ingestion contract
        │
        ▼
exact zero-gap handoff
        ↓
Forward production
        ↓
same governed ingestion contract continuously
```

Final continuity certification requires:

- every eligible source unit has governed 05 registration;
- every expected observation is processed exactly once logically;
- every completed 05 work unit reconciles to 06;
- every 06 artifact has valid upstream 05/source lineage;
- no source observation falls between historical and forward boundaries;
- no duplicate logical admission due to overlap between reconstruction/catch-up/live processing;
- committed zero-observation CDC runs remain accounted for;
- exact identity coverage, not merely aggregate count equality.

Existing timestamp-only cutover logic is not sufficient and must be replaced by evidence-derived exact source identity/high-water coverage.

A concrete continuity test already occurred: while Webhook 04 reconstruction was being prepared, immutable webhook evidence moved from:

```text
88 receipts / 91 events
```

to:

```text
89 receipts / 92 events
```

The new receipt/event must ultimately reach 04 → 05 → payload → 06 through the governed catch-up/forward path, not by manually expanding a historical constant.

---

## 8. Current implementation status

### Native CDC historical source reconstruction

Historical population:
- 41 attempts
- 32 committed
- 9 failed/uncommitted
- 955 observations
- 894 initial-lookback observations
- 61 modern observations

v1.5.118 successfully wrote/reconciled 03 only:
- before03 = 61
- after03 = 955
- exact candidate identity = 955
- findings = 0
- post-write source gate valid

This closes the historical Native CDC 03 reconstruction.

### Webhook 04 reconstruction

v1.5.119 preview initially proved:
- 88 receipts
- 91 events
- 91 eligible
- 0 invalid receipts
- 0 duplicates
- 15 EMAILED
- 2 DELETE
- 89 targeted captures required
- 0 findings

v1.5.120 targeted-capture reconciliation:
- 2 DELETE → NOT_REQUIRED
- 1 existing capture → PRESENT_VALID
- 88 non-delete → missing historical targeted capture
- 0 invalid captures
- 0 findings

v1.5.121 controlled 04 writer failed before write due to incorrect workbook helper.

v1.5.122 repaired that helper. On rerun, its frozen population safety gate correctly blocked the write because a new receipt had arrived:
- 89 receipts
- 92 events
- 92 eligible
- 90 capture-required
- 15 EMAILED
- 2 DELETE
- 0 findings

**No controlled 04 V2 write has been completed yet.**

The 04 write is intentionally paused while the forward-ingestion/continuity architecture is corrected.

### Production pause state

Keep paused/disabled until the refactor and continuity gates validate:

- Native CDC State Capture processing
- Webhook State Capture processing
- FULL_EXPORT State Capture ingestion
- State Application

The ordinary daily QBO export scheduler is separate unless dependency analysis proves it participates in the State Capture ingestion boundary.

---

## 9. Current forward-code contract gaps already identified

### Old State Capture Ingestion / 05

Current `103_QBO_ForwardIngestionControl.js` uses an older 05 schema including fields such as:
- ObservedAt
- SourceWindowStart
- SourceWindowEnd
- SourceStatus
- ObservationCount

It does not implement the locked V2 fields such as:
- SourceLedger
- ExpectedObservationCount
- ProcessedObservationCount

Disposition: **SUPERSEDED — REPLACE**.

### Native CDC forward path

Current `104_QBO_NativeCdcForwardIngestion.js` registers committed manifest entity units directly into old 05.

This bypasses forward:

```text
02a → 02b → 03
```

Disposition: **production path must be refactored/replaced**.

### FULL_EXPORT forward path

Current `106_QBO_FullExportForwardIngestion.js` begins from 01 registrations, which is directionally correct, but uses the old 05/count contract and timestamp-based cutover logic.

Disposition: **ACTIVE CONCEPT — REFACTOR to V2**.

### Webhook forward path

Current `107_QBO_WebhookForwardIngestion.js` has `webhookEventsSheetWritesEnabled:false` and registers receipt evidence directly into old 05.

Forward Webhook must become:

```text
receipt → 04 → targeted capture → eligibility → 05
```

Disposition: **production path must be refactored/replaced**.

### Historical Webhook direct path

`108_QBO_WebhookHistoricalReconstruction.js` uses an older event-level historical 05 source model and directly creates payloads.

Disposition: **SUPERSEDED — MUST NOT REMAIN AN ALTERNATE PRODUCTION PATH**.

### Payload / 06 path

`101_QBO_ChangePayloadPersistence.js` and `122_QBO_PayloadArtifactLedger.js` are much closer to target architecture. Preserve/refactor the validated behavior that deterministic payload persistence and 06 registration/reconciliation occur before 05 checkpoint.

---

## 10. Code lifecycle classifications

Every relevant module and public callable will be classified as one of:

### ACTIVE PRODUCTION AUTHORITY
Implements the final governed V2 production contract.

### CONTROLLED MIGRATION / AUDIT
Retained for explicit historical reconstruction, validation, diagnostics, replay, or governed repair. Not normal production authority.

### SUPERSEDED — DISABLED
Retained where useful for evidence/history/compatibility, but prohibited from executing as an alternate production path.

### DELETE CANDIDATE
No remaining production, diagnostic, migration, evidentiary, or compatibility purpose. Delete only after dependency and git-history review.

“Dead” does not automatically mean delete. Historical implementation code may be valuable audit evidence while still requiring hard-disable.

Removing a trigger is not sufficient to retire a path. Superseded public handlers may need explicit retired stubs/fail-closed behavior so manual execution cannot reactivate obsolete architecture.

Known lifecycle targets requiring final dependency review include:
- old 05 control/schema;
- direct-to-05 Native CDC path;
- direct-to-05 Webhook path;
- old Native CDC historical registration backfills;
- event-level historical Webhook 05/payload writer;
- older State Capture alternate processing paths;
- independent trigger/continuation/watchdog implementations;
- destructive controlled migration writers after their migration is closed.

---

## 11. Target module namespace

New governed production/refactor code uses architecture-oriented four-digit numbering.

```text
1000–1199  Foundation / shared App 50 infrastructure
1200–1699  FULL_EXPORT + QBO reporting
1700–1999  Native CDC
2000–2299  Webhooks
2300–2599  State Capture Ingestion
2600–2899  Change Payloads / artifact ledger
3000–3399  State Application
3400–3699  Orchestration / pipeline control
3700–3999  Integrity / audit / diagnostics
4000–4499  Controlled migration / backfill / replay
4500–4799  Tests / fixtures
9000–9499  Retired compatibility stubs
```

### FULL_EXPORT/reporting subranges

The 1200–1699 family intentionally has extra room because it is expected to grow faster than most domains.

Target subdivision:

```text
1200–1299  FULL_EXPORT framework / contracts / registry
1300–1499  QBO entity exports
1500–1549  child / dependent datasets
1550–1599  MasterBackup / source evidence / 01 registration
1600–1699  QBO report-derived exports
```

General Ledger and SalesByTaxName belong in the report-derived export family, for example:

```text
1600_QBO_Reports_Contract.js
1610_QBO_GeneralLedgerExport.js
1620_QBO_SalesByTaxNameExport.js
```

Report/export assets must separately declare whether they participate in entity State Capture. Being an App 50 export does not automatically make a report endpoint a 01→05→06 entity-state source.

### Naming rule

Number and filename communicate architecture, not implementation chronology.

Example:

```text
3410_QBO_Pipeline_Registry.js
3420_QBO_Pipeline_Control.js
3430_QBO_Pipeline_TriggerManager.js
3440_QBO_Pipeline_ContinuationManager.js
3450_QBO_Pipeline_Watchdog.js
3460_QBO_Pipeline_Status.js
3490_QBO_OperatorCommands.js
```

Leave spacing between major modules where useful.

Do not mass-renumber existing code before lifecycle/dependency classification. New V2 authority is created in the new namespace; old modules are then retired/migrated deliberately.

---

## 12. Application ownership boundaries

### App 50 — QBO Import Hub Standalone

Default owner of:
- QBO acquisition/export/reporting;
- Native CDC;
- Webhooks;
- State Capture source evidence/ledgers;
- State Capture ingestion;
- Change Payload production;
- State Application;
- QBO-specific orchestration and operational controls.

Do not move functionality out of App 50 merely because it is being reorganized.

### App 05 — Integration Hub

Separate Apps Script application. It is **not** the meaning of the State Capture `05` processing ledger.

Refactor its consumption of App 50 outputs separately where required. Do not move App 50 State Capture ingestion into App 05 merely because App 05 is named Integration Hub.

### App 40 — Data Platform Shared Library

Use only for genuinely application-independent platform capability with an affirmative cross-application reason.

Do not prematurely extract App 50-specific orchestration/evidence logic into App 40. A generic capability may be extracted later when there is a real shared consumer and stable abstraction.

---

## 13. Public functions and operator commands

### Domain/programmatic APIs

Legitimate programmatic APIs stay with their owning architectural range.

Example:

```text
17xx Native CDC API
20xx Webhook API
26xx Change Payload API
```

Do not create a giant generic `PublicFunctions.js`.

### Routine human/operator commands

Routine commands selected manually in Apps Script live predictably in:

```text
3490_QBO_OperatorCommands.js
```

Examples:

```text
listQboPipelineStatuses()
listAllQboPipelineTriggers()

pauseNativeCdcPipeline()
resumeNativeCdcPipeline()

pauseWebhookPipeline()
resumeWebhookPipeline()

pauseFullExportIngestionPipeline()
resumeFullExportIngestionPipeline()
```

These wrappers contain minimal/no business logic and delegate to governed internal services.

### Controlled migration / diagnostic entry points

Dangerous/non-routine functions remain with their owning 37xx or 40xx module. They are not placed in 3490 merely to make them easy to run.

Internal helpers should use the trailing `_` convention where practical.

---

## 14. Unified pipeline and trigger management

App 50 currently has multiple independent trigger/control implementations. These are migration targets.

One registry-driven pipeline-control contract will govern all pipelines/jobs.

Target services:

```text
3410_QBO_Pipeline_Registry.js
3420_QBO_Pipeline_Control.js
3430_QBO_Pipeline_TriggerManager.js
3440_QBO_Pipeline_ContinuationManager.js
3450_QBO_Pipeline_Watchdog.js
3460_QBO_Pipeline_Status.js
3490_QBO_OperatorCommands.js
```

Required common capabilities:

- list pipeline status;
- pause;
- resume;
- install triggers;
- remove triggers;
- reconcile expected vs actual triggers;
- list pipeline triggers;
- list all governed triggers;
- detect orphan/foreign project triggers;
- active-run/claim detection;
- heartbeat/progress;
- watchdog/stale recovery;
- last error and last success;
- backlog/pending-work reporting where applicable.

### Pipeline state and trigger state are separate

A pipeline's administrative pause state is authoritative.

A worker must check pause state itself. Manual invocation of a handler must not bypass a pause.

Resume should:

```text
validate configuration/contracts
→ reconcile trigger state
→ check active claims/runs
→ permit work
```

It must not blindly create overlapping workers.

### Job classes

Not every scheduled process has identical execution semantics. The registry should distinguish at least:

- production acquisition;
- production ingestion;
- State Application;
- scheduled export/report;
- migration/backfill;
- diagnostic/watchdog.

All still use a consistent administrative vocabulary.

Watchdogs are for stale recovery/reseeding, not normal orchestration.

---

## 15. Locking/execution doctrine retained

Prior production incidents proved project-wide long-held locks can starve unrelated pipelines.

Retain:
- separate lock domains;
- short lock hold times;
- per-sheet/workbook-write leases where required;
- bounded work units;
- conservative runtime budgets;
- resumable/idempotent workers;
- checkpoint after committed WorkUnit;
- one active worker chain per pipeline;
- overlap prevention;
- heartbeat/progress timestamps;
- watchdog only for stale recovery.

Native CDC authoritative watermark advances only after the governed batch is fully committed.

---

## 16. Current uncommitted source — DO NOT COMMIT YET

As of this handoff, these files are untracked and intentionally remain uncommitted pending lifecycle/renumbering classification:

```text
127_QBO_NativeCdcSourceLedgerV2Backfill.js
129_QBO_NativeCdcRecursiveEvidenceInventory.js
130_QBO_NativeCdcAttemptClassificationAudit.js
131_QBO_NativeCdcLegacyRunEvidenceAudit.js
132_QBO_NativeCdcLegacyObservationAudit.js
134_QBO_NativeCdcInitialLookbackReconciliationAudit.js
135_QBO_NativeCdcHistoricalReconstructionV2.js
136_QBO_NativeCdcHistoricalReconstructionWriteV2.js
137_QBO_NativeCdcIdentityReconciliationAudit.js
138_QBO_NativeCdcSingleIdentityDiagnostic.js
139_QBO_NativeCdcHistorical03WriteV2.js
140_QBO_WebhookSourceLedgerV2Preview.js
141_QBO_WebhookTargetedCaptureReconciliationV2.js
142_QBO_WebhookSourceLedgerV2Write.js
README_v1.5.105.md
README_v1.5.107.md
README_v1.5.108.md
README_v1.5.109.md
README_v1.5.110.md
README_v1.5.112.md
README_v1.5.113.md
README_v1.5.114.md
README_v1.5.115.md
README_v1.5.116.md
README_v1.5.117.md
README_v1.5.118.md
README_v1.5.119.md
README_v1.5.120.md
README_v1.5.121.md
README_v1.5.122.md
```

Current instruction:

```text
DO NOT git add
DO NOT git commit
DO NOT delete
DO NOT manually rename
```

These have maximum flexibility because Git has not yet assigned committed identities to them.

The lifecycle audit will determine which:
- move to 37xx permanent diagnostics;
- move to 40xx controlled migration/backfill;
- are superseded by final writers;
- should never become production authority;
- should be retained as evidence;
- are delete candidates.

---

## 17. Audit/refactor deliverables

The current audit must produce four connected outputs.

### Deliverable 1 — V2 ingestion contract map

For FULL_EXPORT, Native CDC, Webhooks, State Capture Ingestion, Change Payloads, and 06:
- current implementation;
- target contract;
- contract violations;
- replacement/refactor requirements;
- authoritative entry points;
- source and count gates.

### Deliverable 2 — Historical-to-forward continuity plan

Must establish:
- exact historical 06 coverage;
- evidence/source high-water boundary;
- every source accumulated after that boundary;
- catch-up mechanism using the same production contract;
- zero-gap handoff;
- zero duplicate logical admission;
- final identity and count reconciliation through 06.

### Deliverable 3 — Complete code lifecycle/module migration map

For every relevant module:
- current filename/number;
- responsibility;
- dependencies;
- public callable functions;
- trigger handlers;
- lifecycle classification;
- proposed 1000+ home;
- whether old entry point must be hard-disabled;
- whether module is a delete candidate.

This includes code already dead **and code that needs to be deliberately made dead**.

### Deliverable 4 — Unified pipeline/trigger-control architecture

Must inventory all existing trigger creators/managers and define:
- registry;
- job classes;
- pause/resume;
- trigger install/remove/reconcile/list;
- status;
- active-run detection;
- continuation;
- watchdog;
- orphan trigger detection;
- operator commands;
- cutover from old independent trigger managers.

---

## 18. Refactor implementation sequence

Do not implement this as random file-by-file cleanup.

### Phase A — Complete inventory / dependency map

1. Inventory current modules.
2. Inventory all public callable functions.
3. Inventory all trigger creators, trigger handlers, continuations, watchdogs, pause/resume controls.
4. Trace source-ledger → 05 → payload → 06 dependencies.
5. Classify lifecycle.
6. Assign target module range/home.
7. Identify code that must fail closed before cutover.

**Current phase: IN PROGRESS.**

### Phase B — Establish new foundation and orchestration authority

1. Create governed 10xx shared App 50 contracts/utilities as needed.
2. Create 34xx Pipeline Registry/Control/Trigger/Continuation/Watchdog/Status.
3. Create 3490 operator wrappers.
4. Register existing pipelines/jobs without yet resuming State Capture.
5. Validate trigger inventory and identify orphan/legacy triggers.

### Phase C — Build forward source-ledger authorities

1. FULL_EXPORT forward source authority in 12xx–15xx/01.
2. Native CDC forward authority in 17xx with 02a→02b→03.
3. Webhook forward authority in 20xx with receipt→04→targeted capture.
4. Ensure source-specific count and eligibility gates.
5. Prevent direct-to-05 bypass.

### Phase D — Replace State Capture Ingestion / 05

1. Implement 23xx–25xx V2 contract.
2. Admit only governed eligible source-ledger observations.
3. Implement exact expected/processed population controls.
4. Preserve resumable claims/cursors/work units.
5. Integrate with deterministic payload/06 authority.

### Phase E — Consolidate Change Payload / 06 authority

1. Move/refactor validated 101/122 behavior into 26xx.
2. Preserve deterministic shard identity.
3. Preserve create/reconcile 06 before 05 checkpoint.
4. Verify exact source/work-unit/artifact lineage.
5. Ensure retry cannot duplicate logical admission.

### Phase F — Historical/catch-up continuity

1. Determine exact 06 historical coverage by identity.
2. Reconcile current 01/03/04 source populations against 05/06.
3. Process all accumulated eligible sources not represented in 06 through the same governed forward contract.
4. Include source evidence that arrived after historical backfill completion.
5. Prove exact zero-gap/zero-duplicate coverage.
6. Complete Webhook 04 reconstruction/catch-up under the final contract rather than racing the live folder.

### Phase G — State Application V2 rebuild/replay

Only after source/ingestion/payload continuity is certified:
1. freeze governed eligible population/fingerprint;
2. replay observations by ObservedAt;
3. resolve equal-time cases;
4. build 10/13;
5. derive 11;
6. derive 12;
7. run final State Application integrity gates;
8. keep State Application disabled until validated.

### Phase H — Retire old architecture

1. Remove/reconcile old triggers.
2. Hard-disable superseded public handlers.
3. Retain controlled historical/audit modules where justified.
4. Delete only proven delete candidates.
5. Commit module migration deliberately.
6. Verify no alternate direct-to-05 or direct-to-State-Application path remains.

### Phase I — Controlled production resume

Resume separately and deliberately:
1. source acquisition;
2. source-ledger registration;
3. State Capture ingestion;
4. payload/06 processing;
5. State Application only after its own validation.

Each resume requires pipeline status, trigger reconciliation, active-run checks, and continuity gates.

---

## 19. Repository strategy during refactor

Do not mass-renumber the existing repository before lifecycle classification.

Preferred transition:

```text
current module
→ determine lifecycle
→ determine target authority
→ build/move/refactor into architecture-oriented range
→ validate replacement
→ retire/hard-disable old entry point
→ commit deliberate architecture transition
```

This avoids committing another intermediate generation merely to rename it again.

The currently untracked 127–142 series should be classified before its first commit.

---

## 20. Definition of “fixed to current contracts”

App 50 is not considered repaired merely because historical ledgers exist.

The recovery/refactor is complete only when:

- FULL_EXPORT forward ingestion obeys 01 and V2 count/eligibility contracts;
- Native CDC forward acquisition/ingestion obeys 02a→02b→03 before 05;
- Webhook forward ingestion obeys receipt→04→targeted capture before 05;
- no production path bypasses source ledgers;
- State Capture Ingestion uses the V2 05 contract;
- deterministic Change Payload/06 persistence is authoritative;
- historical + catch-up + forward source populations reconcile exactly through 06;
- no gaps exist after the historical 06 checkpoint;
- no duplicate logical observations are admitted;
- State Application V2 is rebuilt from the governed eligible population and separately validated;
- one registry-driven trigger/pipeline control architecture governs operational scheduling;
- superseded trigger handlers and public entry points cannot accidentally reactivate old architecture;
- module names/numbers communicate architecture;
- lifecycle classification is complete;
- repository and production triggers match the governed architecture.

---

## 21. Immediate next action

Continue **Phase A — current-source lifecycle/dependency/trigger inventory**.

Do not resume State Capture pipelines.

Do not continue the old 04 controlled writer yet.

Do not stage/commit/rename the current untracked 127–142 files.

The next architecture output should be the consolidated:

```text
current module
→ responsibility
→ dependencies
→ public functions
→ trigger handlers
→ lifecycle disposition
→ target 1000+ module/range
```

plus the exact forward-ingestion and historical-to-forward continuity impact map.

---

## 22. Authority of this README

This README records the architecture/refactor decisions and implementation state agreed through 2026-09-15. It is intended to survive chat/session loss and serve as the durable handoff for continuing the App 50 repair.

If later implementation evidence requires changing one of these contracts, change it deliberately, document the reason and migration impact, and version the decision. Do not silently revert to an older ingestion or orchestration path.
