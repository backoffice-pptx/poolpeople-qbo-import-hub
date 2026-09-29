# v1.5.127 — Pipeline Registry Completeness Audit

Adds a read-only engineering diagnostic:

`auditQboPipelineRegistryCompleteness()`

## Why a frozen source inventory is used

Apps Script runtime does not provide an API that enumerates the project's own
source files. The diagnostic therefore freezes the trigger-creation handler
inventory reviewed from the authoritative Sep 15, 2026 App 50 source snapshot,
then reconciles that source inventory against:

1. the live 3410 governed registry, and
2. actual installed project triggers.

This avoids pretending runtime reflection can prove source completeness.

## Pass criteria

- every source-reviewed trigger handler is represented exactly once in 3410;
- 3410 contains no trigger handler absent from the reviewed source inventory;
- no handler has duplicate registry bindings;
- every currently installed trigger is known to both the source inventory and
  registry.

## Scope

The frozen inventory includes active production, active-concept/refactor,
superseded legacy dispatchers, controlled migrations/backfills, and controlled
audit/watchdog trigger handlers. Trigger deletion sites are governed by the same
handler identities and therefore do not create additional handler identities.

## Safety

Read only:
- no trigger creation/deletion,
- no property writes,
- no workbook/Drive writes,
- no pipeline resume,
- no State Application activation.

Run only:

`auditQboPipelineRegistryCompleteness()`
