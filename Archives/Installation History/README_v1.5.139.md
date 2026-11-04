# v1.5.139 — Common Continuation / Watchdog / Status Contract

Changed:
- 3440_QBO_Pipeline_ContinuationManager.js
- 3450_QBO_Pipeline_Watchdog.js
- 3460_QBO_Pipeline_Status.js

Purpose
-------
Finish the Phase-B read-only common visibility contract before any additional
pipeline authority cutover.

Continuation:
- owning domain remains scheduling authority;
- common layer never infers that new continuation work is needed;
- exposes continuation handlers, trigger count, duplicate detection, validity;
- schedule/remove mutations remain fail-closed.

Watchdog:
- diagnostic only;
- classifies trigger/continuation validity and existing ActiveWorkerStale evidence;
- never reseeds work;
- governed administrative PAUSED blocks automatic recovery;
- recovery authority remains with the owning domain.

Unified status:
- advances to QBO_PIPELINE_STATUS_V6;
- exposes continuation validity, handlers, duplicates, scheduling authority;
- exposes watchdog diagnostic state from already-available runtime evidence;
- no recursive watchdog/status calls.

Safety:
- no trigger/property/workbook/Drive/State Capture mutation;
- no pipeline resume;
- generic trigger apply remains disabled.

Initial validation while DAILY_FULL_EXPORT remains ENABLED:
run `validateDailyFullExportUnifiedStatus()`.

Expected:
- Version QBO_PIPELINE_STATUS_V6
- EnabledPaused ENABLED
- OperationalStatus SCHEDULED_IDLE
- TriggerStateValid true
- ContinuationStateValid true
- ContinuationTriggerCount 0
- ContinuationSchedulingAuthority OWNING_DOMAIN
- WatchdogStatus HEALTHY_NO_STALE_SIGNAL
