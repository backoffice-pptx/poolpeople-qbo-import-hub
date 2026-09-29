# v1.5.140 — DAILY_FULL_EXPORT Watchdog Operator Wrapper

Adds one no-argument operator wrapper for Apps Script editor use:

    watchDailyFullExport()

The wrapper delegates to:

    runQboPipelineWatchdog('DAILY_FULL_EXPORT')

No business logic is added to 3490. No triggers, properties, workbooks, Drive
artifacts, pipeline state, or State Capture state are mutated.

IMPORTANT
---------
This package contains an append fragment, not a replacement for the existing
3490_QBO_OperatorCommands.js. Append the function to the existing 3490 file;
do not replace the full 3490 module with the fragment.

After pushing, run only:

    watchDailyFullExport()

Expected:
- version = QBO_PIPELINE_WATCHDOG_V2
- diagnosticStatus = HEALTHY_NO_STALE_SIGNAL
- recoveryEligible = false
- recoveryAttempted = false
- mutationPerformed = false
