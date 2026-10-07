# v1.5.227 — Exact October 6 Phase G hard-termination recovery

Install this changed-files-only package using the usual App 50 workflow.
Run `recoverQboPhaseGGlobalEqualTimeHardTerminationV1227()` once. Send the recovery execution log, followed by the automatic continuation log.

Requires the V1226-observed exact checkpoint: same run/workbook, BUILDING_GLOBAL_PARTITIONS, cursor 1559/2418, observations 363554, admitted 363526, evidence exceptions 28, blocked 0; empty error/completed/in-flight fields and zero scan/tie counters. Requires an iterator token, existing authority gates, no continuation trigger visible to the executing user, and unchanged serialized checkpoint immediately before scheduling.

All guards precede mutations. Creates one delayed continuation and updates only the stored continuation trigger ID. Preserves counters, iterator token, status, checkpoint version and progress time. Does not access or modify workbooks, remove triggers, restart the run, enable replay, or run the worker synchronously. Existing module 4100 keeps its verified-manifest cleanup-before-append barrier for the next manifest.

Use the same Apps Script account that owns the prior continuation triggers. Trigger inventory is user-scoped. If any guard fails, stop and provide the log. Do not manually run the continuation or reuse V1221 recovery.

Local validation: JavaScript syntax and mocked success, checkpoint mismatch, existing trigger, changed serialized state and authority rejection. No runtime validation claimed until Apps Script executes it.
