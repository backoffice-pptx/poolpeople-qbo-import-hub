# v1.5.132 — DAILY_FULL_EXPORT Operator Cutover Wrapper

This corrected changed-file package preserves the complete existing
`3490_QBO_OperatorCommands.js` from the Phase-B bootstrap and appends only the
operator-facing DAILY_FULL_EXPORT administrative-authority cutover wrapper.

Operator command:

`cutoverDailyFullExportAdminAuthority()`

The wrapper delegates to the controlled cutover implementation in
`3425_QBO_Pipeline_AdministrativeAuthorityCutover.js`.

No trigger-management, queue, worker, State Capture, or other operator-command
behavior is changed by this package.
