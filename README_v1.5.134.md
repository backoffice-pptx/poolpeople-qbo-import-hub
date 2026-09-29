# v1.5.134 — Post-Cutover Authority-Aware Status

Adds a read-only authority-aware status overlay after the validated
DAILY_FULL_EXPORT administrative-authority cutover.

This package deliberately does not reconstruct or overwrite the existing
3460 status module. It adds a narrow 3465 module that:

- reads the governed administrative state;
- reads the persisted administrative-authority marker;
- reports `GovernedStateAuthoritative=true` only when the persisted authority
  is `GOVERNED_34XX`;
- preserves the existing legacy operational/runtime status adapter;
- exposes the execution authority and cutover metadata.

No trigger, property, worker, workbook, Drive, State Capture, pause, or resume
mutation occurs.

Validation command:

`validateQboPipelineAuthorityAwareStatus(QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT)`

Expected DAILY_FULL_EXPORT result after the v1.5.133 validated cutover:
- GovernedAdministrativeState = ENABLED
- GovernedStateAuthoritative = true
- AdministrativeStateAuthority = GOVERNED_34XX
- ExecutionAuthority = 24_TriggerManagement.js
- OperationalStatus remains SCHEDULED_IDLE while idle
- TriggerCount remains 1
