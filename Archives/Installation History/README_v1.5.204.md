# v1.5.204 — Final Historical 07 continuation scheduling recovery

## Purpose
Repairs the v1.5.203 run stranded after its artifact-1104 checkpoint was durably committed but Apps Script returned a server error while creating the next continuation trigger.

## Recovery entry point
Run `resumeQboFinalHistorical07AfterSchedulingFailureV204` once.

Before resuming, the function requires the existing run id, the v197 prerequisite, and exact equality between every durable `P_0`…`P_f` sheet row count and the saved committed `prefixCounts`. It does not trim or reconstruct workbook rows.

## Forward scheduling behavior
Continuation creation is retried up to three times. If trigger creation still fails, committed certification work remains preserved and state becomes `CONTINUATION_REQUIRED` rather than `FAILED`. The same public recovery entry point may then be run after confirming no continuation trigger exists.
