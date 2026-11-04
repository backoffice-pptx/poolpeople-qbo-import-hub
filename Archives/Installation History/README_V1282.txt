V1282 READ-ONLY DECISION CONTRACT — no scheduler replacement, no production mutation.
Install new JS file only; requires V1278 and V1279 existing functions.
Run testQboDailyRecoveryDecisionV1282, then previewQboDailyRecoveryContractV1282.
This does NOT implement autonomous recovery. It intentionally blocks if active worker liveness cannot be verified.
Do not unpause the scheduler until durable work-unit/checkpoint/ownership protocol is implemented and tested.
ZIP structure matches user Downloads unzip/cp workflow.
