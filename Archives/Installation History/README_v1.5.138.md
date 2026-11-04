# v1.5.138 — Authority-Aware Status and Reconciliation

Changed files:
- 3465_QBO_Pipeline_AuthorityAwareStatus.js
- 3470_QBO_Pipeline_TriggerReconciliationPlan.js

Changes:
1. Governed administrative authority now controls the user-facing EnabledPaused
   value after explicit GOVERNED_34XX cutover.
2. An idle governed PAUSED DAILY_FULL_EXPORT is reported as
   ADMINISTRATIVELY_PAUSED_IDLE rather than SCHEDULER_TRIGGER_MISSING.
   Active/queued execution evidence is preserved if a pause occurs while work
   is still draining.
3. The reconciliation planner consumes the effective trigger specifications
   from 3430. Therefore DAILY_FULL_EXPORT desires START=1 when governed ENABLED
   and START=0 when governed PAUSED.
4. Planner rows now report the actual administrative authority instead of
   hard-coding governedStateAuthoritative=false.

Safety:
- Read-only changes only.
- No triggers, properties, queue state, workbook, Drive, or State Capture writes.
- Generic trigger apply remains disabled.
- No State Capture pipeline is resumed.

Initial validation while DAILY_FULL_EXPORT is ENABLED:
- run planQboPipelineTriggerReconciliation()
- run validateDailyFullExportUnifiedStatus()

Expected planner: V2, valid=true, creates=0, deletes=0, DAILY START desired=1,
GOVERNED_34XX authoritative.
Expected status: ENABLED / SCHEDULED_IDLE / TriggerStateValid=true.
