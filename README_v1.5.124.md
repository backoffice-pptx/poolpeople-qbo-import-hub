# v1.5.124 — Phase B Trigger Expectation Semantics

## Reason

The first v1.5.123 runtime inventory was operationally clean but classified every
absent governed handler as "missing." That incorrectly mixed:

1. a required recurring trigger,
2. a transient continuation that should exist only while work is active, and
3. a handler whose trigger is intentionally absent because its pipeline is paused
   or superseded.

## Change

The registry now gives each governed trigger handler one of three expectations:

- `REQUIRED_RECURRING`
- `TRANSIENT_CONTINUATION`
- `INTENTIONALLY_ABSENT`

The read-only trigger inventory reports those conditions separately.

`valid=true` requires:

- no missing REQUIRED_RECURRING trigger,
- no present INTENTIONALLY_ABSENT trigger,
- no duplicate governed handler trigger,
- no orphan/foreign project trigger.

An absent TRANSIENT_CONTINUATION is informational and does not invalidate the
inventory.

## Expected current result

With the known Sep. 15/16 paused state:

- `startDailyQboExportSchedule` should be the sole project trigger.
- `runNextScheduledQboExport` should be reported as an absent transient
  continuation when no daily export worker is active.
- Native CDC acquisition and the three legacy ingestion dispatcher handlers
  should be confirmed intentionally absent.
- orphan/foreign count should remain zero.
- overall `valid` should be true.

## Safety

Still no cutover:
- no trigger mutation,
- no resume,
- no legacy pause-property mutation,
- no changes to 127–142,
- no State Application activation.

After push run only:

`listAllQboPipelineTriggers()`
