# v1.5.114 — Native CDC Historical Reconstruction V2 Controlled Write

This package follows the clean v1.5.113 preview and the locked population:

- 41 acquisition attempts
- 32 committed runs
- 955 eligible Native CDC source observations
- 894 observations in the committed INITIAL_LOOKBACK run
- 61 observations across later committed runs
- 9 failed/uncommitted attempts
- first committed incremental run has zero observations

## Write scope

Only:

- `02a_CDC_Run_Attempts_V2`
- `02b_CDC_Committed_Runs_V2`
- `03_Native_CDC_Events_V2`

It does **not** write 05, 06, Change Payloads, Script Properties, triggers,
acquisition state, or State Application.

## Controlled-write safeguards

The function rebuilds the v1.5.113 candidate first and refuses to write unless
the exact locked population is reproduced with zero findings.

Existing V2 rows are accepted only if their keys are part of the validated
candidate population. Unexpected keys abort the operation.

After writing, an immediate Gate A validates:

- 41 unique 02a attempts
- 32 unique committed 02b runs
- every 02b row has a 02a parent
- every 02b row is watermark committed
- 955 unique 03 observations
- every 03 observation has a 02b parent
- 894 observations belong to the initial lookback
- all 955 03 rows are eligible

## Run only

`writeQboNativeCdcHistoricalReconstructionV2()`

Send the complete execution log back before any 05 reconstruction begins.
