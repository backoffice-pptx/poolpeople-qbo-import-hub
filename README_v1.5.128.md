# v1.5.128 — Phase B Trigger Reconciliation Dry-Run Plan

Adds:

`planQboPipelineTriggerReconciliation()`

This is the first trigger-authority transition artifact, but it is deliberately
**planning only**.

## Rules

- REQUIRED_RECURRING → desired count 1.
- INTENTIONALLY_ABSENT → desired count 0.
- TRANSIENT_CONTINUATION:
  - preserve one if it already exists;
  - remain absent if none exists.
  - The common control plane does not invent worker continuation need.
- unregistered actual triggers → `REVIEW_FOREIGN`, never auto-delete.

## Critical migration rule

`GovernedAdministrativeState` remains visible but
`governedStateAuthoritative=false`.

An uninitialized Phase-B control property therefore cannot pause/resume or
otherwise alter current legacy trigger truth.

## Output actions

- KEEP
- CREATE
- DELETE_EXCESS
- REVIEW_FOREIGN

Every row has `mutationPermitted=false`.

## Expected current result

With the validated v1.5.127 state:
- actualTriggerCount = 1
- proposedCreateCount = 0
- proposedDeleteExcessCount = 0
- foreignReviewCount = 0
- valid = true
- `startDailyQboExportSchedule` KEEP
- all intentionally absent handlers KEEP at desired count 0
- all absent transient handlers KEEP at desired count 0.

## Safety

No trigger mutation, no property mutation, no workbook/Drive write, no resume,
no State Application activation.

Run only:

`planQboPipelineTriggerReconciliation()`
