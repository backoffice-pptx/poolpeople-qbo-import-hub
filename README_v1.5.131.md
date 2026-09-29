# v1.5.131 — Daily FULL_EXPORT Administrative Authority Cutover

This is the first controlled Phase-B administrative authority transition.

## Scope

Only `DAILY_FULL_EXPORT`.

The cutover initializes the governed 3420 administrative state from the
freshly observed legacy state and records that administrative authority has
moved to `GOVERNED_34XX`.

Execution authority remains:

`24_TriggerManagement.js`

Therefore module 24 continues to own:
- `startDailyQboExportSchedule`
- `runNextScheduledQboExport`
- queue progression
- exporter isolation
- continuation scheduling
- recovery/resume/history/preflight semantics.

## Zero-trigger-churn rule

The cutover snapshots all project trigger handler+ID identities before and
after its Script Property writes. Any difference is a safety failure.

It does NOT:
- create triggers;
- delete triggers;
- start the daily queue;
- resume any State Capture pipeline;
- write State Capture workbooks or Drive evidence;
- enable generic 3480 trigger apply.

## Steps

First run only:

`previewQboDailyFullExportAdministrativeCutover()`

Expected:
- valid=true
- readinessValid=true
- currentAuthority=LEGACY / uninitialized
- proposed administrativeState=ENABLED
- proposed authority=GOVERNED_34XX
- executionAuthority=24_TriggerManagement.js
- preserveExistingTriggers=true

After validating that preview, run the controlled cutover separately with the
exact confirmation token:

`cutoverQboDailyFullExportAdministrativeAuthority('CUTOVER_DAILY_FULL_EXPORT_ADMIN_AUTHORITY')`

Then validate:

`validateQboDailyFullExportAdministrativeAuthority()`

Do not run the cutover until the preview has been reviewed.
