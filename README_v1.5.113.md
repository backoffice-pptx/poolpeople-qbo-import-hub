# v1.5.113 — Native CDC Historical Reconstruction V2 Preview

This is the first implementation package after the 02a / 02b contracts were locked.

## Safety

**Preview only. No writes.**

It does not mutate:

- `02a_CDC_Run_Attempts_V2`
- `02b_CDC_Committed_Runs_V2`
- `03_Native_CDC_Events_V2`
- 05 / 06
- Change Payloads
- Script Properties
- triggers
- State Application

## Purpose

Build the exact candidate population from immutable Native CDC Drive evidence before
we permit the controlled historical write.

It models:

`02a all attempts -> 02b committed subset -> 03 committed-run observations`

and incorporates the three proven legacy cases:

- `106c71f8-042e-44e5-a6b1-30a746dd731f`
  - INITIAL_LOOKBACK
  - FAILED / uncommitted
  - zero admissible observations
- `a993402a-abb5-4fbd-b3c7-e67ea26c364e`
  - INITIAL_LOOKBACK
  - SUCCESS / committed
  - 894 source observations
- `a9ab03b8-0c9f-49a8-8780-92c58078d5e4`
  - INCREMENTAL
  - SUCCESS / committed
  - zero observations

The preview also validates uniqueness and verifies that every 03 candidate has a
02b parent.

## Run only

`previewQboNativeCdcHistoricalReconstructionV2()`

Expected high-level population from the evidence already established:

- 41 attempts
- 32 committed runs
- 894 initial-lookback observations plus observations from the later committed cycles

Do **not** run a write/backfill function after this preview. There is intentionally
no write function in v1.5.113.

Send the complete execution log back for review.
