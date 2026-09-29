# v1.5.135 — Authority-Aware Unified Status Integration

Integrates the already runtime-validated v1.5.134 authority overlay into the
normal `qboPipelineStatus_()` / `qboPipelineStatuses_()` surface.

Changes:
- 3460 status version advances V4 → V5.
- Normal status is passed through the read-only persisted administrative
  authority overlay from 3465.
- `OperationalStateAuthority` remains the authority for runtime/execution
  evidence. It is intentionally not renamed to GOVERNED_34XX.
- Administrative authority is separately reported by
  `AdministrativeStateAuthority`.
- 3490 now durably includes the manually added v1.5.134 validation wrapper and
  adds `validateDailyFullExportUnifiedStatus()`.

No trigger, property, worker, workbook, Drive, pause/resume, or State Capture
mutation is introduced.

Run:
`validateDailyFullExportUnifiedStatus()`

Expected DAILY_FULL_EXPORT:
- GovernedAdministrativeState = ENABLED
- GovernedStateAuthoritative = true
- AdministrativeStateAuthority = GOVERNED_34XX
- OperationalStateAuthority = LEGACY_DAILY_EXPORT_STATE
- ExecutionAuthority = 24_TriggerManagement.js
- TriggerCount = 1
- OperationalStatus = SCHEDULED_IDLE while idle
- Version = QBO_PIPELINE_STATUS_V5
