# v1.5.126 — Phase B Expanded Job/Trigger Registry

## Purpose

Expand the 34xx governed trigger inventory beyond the six initial production
surfaces so "orphan/foreign" means a trigger handler not known to the App 50
architecture, rather than merely a trigger outside the first bootstrap set.

Added governed job identities for:

- General Ledger historical backfill
- Payload Artifact historical backfill
- Recursive Contract Coverage Audit worker/watchdog
- legacy Canonical V2 rebuild worker/watchdog
- legacy Native CDC historical registration continuation
- legacy Webhook historical reconstruction continuation

These are job-classified as controlled migration/backfill or diagnostic/watchdog
surfaces. They are NOT promoted to production authority.

## Trigger expectations

All newly added handlers are `TRANSIENT_CONTINUATION`.

Their absence while the job is idle is valid and informational. If one is
present, the inventory recognizes it as governed rather than foreign.

The recursive-audit watchdog is also treated as transient at the registry level:
it is valid only as part of that controlled audit lifecycle and is not a
permanent production watchdog.

## Status

A generic read-only `TRANSIENT_JOB` adapter reports:

- `IDLE / NO_TRIGGER_IDLE` when no governed trigger is present
- `ACTIVE / TRANSIENT_TRIGGER_PRESENT` when one is present

It does not read or mutate migration/audit workbook state in this Phase-B pass.

## Safety

No trigger is installed or removed. No pipeline is resumed. No legacy property,
source ledger, 05, 06, payload, or State Application data is modified. The
untracked 127–142 family remains untouched.

## Validation

After push run only:

`listAllQboPipelineTriggers()`

Expected current result remains one actual trigger:
`startDailyQboExportSchedule`, with `valid=true`, zero orphan/foreign triggers,
and the newly registered controlled-job handlers listed only as absent transient
continuations.
