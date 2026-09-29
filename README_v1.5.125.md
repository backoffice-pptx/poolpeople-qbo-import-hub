# v1.5.125 — Phase B Legacy Operational Status Reconciliation

## Purpose

Make the new unified pipeline status surface report the current operational
state from the still-authoritative legacy controls while Phase B remains
non-cutover.

## Read-only sources

- Daily FULL_EXPORT:
  - existing daily queue Script Properties,
  - existing active-worker state helper,
  - actual governed trigger inventory.
- Native CDC acquisition:
  - existing production pause property,
  - existing cycle-state reader,
  - existing watermark property.
- Legacy Native CDC/FULL_EXPORT/Webhook ingestion:
  - actual dispatcher-trigger presence/absence.
  - This is authoritative for maintenance pause because v1.5.72 intentionally
    implemented those pauses by trigger removal without adding pause properties.
- State Application:
  - governed architecture status remains disabled.

The status layer deliberately does not call the old FULL_EXPORT/Webhook status
functions because those functions enter the old forward-ingestion workbook
surface and are unnecessary for proving pause/trigger state.

## Migration semantics

The output distinguishes:

- `OperationalStateAuthority`: where current runtime truth came from.
- `EnabledPaused` / `OperationalStatus`: actual current legacy operational state.
- `GovernedAdministrativeState`: new 34xx state, visible separately.
- `GovernedStateAuthoritative=false`: the new property is not yet allowed to
  override legacy workers.

No legacy state is copied or mutated.

## Safety

- no trigger creation/deletion,
- no resume,
- no legacy pause-property mutation,
- no 05/06/source-ledger writes,
- no State Application activation,
- no changes to untracked 127–142.

## Validation

After push run only:

`listQboPipelineStatuses()`

Expected current high-level state:

- DAILY_FULL_EXPORT: ENABLED / SCHEDULED_IDLE (unless the daily queue happens to
  be active at validation time).
- NATIVE_CDC_ACQUISITION: PAUSED.
- all three legacy ingestion pipelines: PAUSED_NO_DISPATCH_TRIGGER.
- STATE_APPLICATION: DISABLED.
