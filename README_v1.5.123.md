# v1.5.123 — Phase B Pipeline Control Bootstrap

## Purpose

Establish the new 34xx App 50 pipeline-control namespace without cutting over,
resuming, deleting, renaming, or modifying any existing production/migration
worker.

New modules:

- `3410_QBO_Pipeline_Registry.js`
- `3420_QBO_Pipeline_Control.js`
- `3430_QBO_Pipeline_TriggerManager.js`
- `3440_QBO_Pipeline_ContinuationManager.js`
- `3450_QBO_Pipeline_Watchdog.js`
- `3460_QBO_Pipeline_Status.js`
- `3490_QBO_OperatorCommands.js`

## Safety boundary

This package is deliberately non-cutover.

- It does not modify legacy source modules.
- It does not install or remove triggers.
- It cannot resume Native CDC, State Capture ingestion, Webhook ingestion, or
  State Application.
- Trigger installation/removal functions fail closed.
- Resume functions fail closed.
- Watchdog is diagnostic-only.
- Existing daily FULL_EXPORT scheduling remains untouched.
- Existing domain workers remain authoritative until a later controlled cutover.
- Existing untracked 127–142 files are not included or modified.

`pauseQboPipeline()` writes only the new governed Phase-B administrative-state
property. It does **not** mutate a legacy pipeline's existing pause property or
remove its triggers. Until cutover, this is a control-plane state bootstrap,
not a replacement for legacy pause commands.

## First validation

After `clasp push`, run only:

`listAllQboPipelineTriggers()`

Review the returned inventory before running any other new operator command.

The expected first validation is read-only and is specifically intended to
identify governed, missing, duplicate, and orphan/foreign Apps Script triggers.
