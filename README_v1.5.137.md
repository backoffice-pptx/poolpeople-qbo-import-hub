# v1.5.137 — Administrative-State-Aware Trigger Expectations

Makes DAILY_FULL_EXPORT's durable starter expectation depend on the governed
administrative state after the validated GOVERNED_34XX authority cutover.

- ENABLED: `startDailyQboExportSchedule` = REQUIRED_RECURRING
- PAUSED: `startDailyQboExportSchedule` = INTENTIONALLY_ABSENT
- `runNextScheduledQboExport` remains TRANSIENT_CONTINUATION.
- Other pipelines retain their existing registry expectations.
- Generic trigger mutation remains blocked.

This is a read-only reconciliation change. It does not pause/resume pipelines
or create/delete triggers.

Because DAILY_FULL_EXPORT is currently ENABLED after the successful v1.5.136
round trip, first validate the enabled state with:

`listAllQboPipelineTriggers()`

Expected:
- version QBO_PIPELINE_TRIGGER_MANAGER_V3
- valid true
- one durable starter
- starter expectation basis GOVERNED_ADMINISTRATIVE_STATE_ENABLED
- no required recurring missing
- no intentionally absent violations

A later controlled pause can validate the PAUSED branch without treating the
intentionally absent starter as a fault.
