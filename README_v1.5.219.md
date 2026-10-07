# App 50 v1.5.219 — Phase G Global Equal-Time Diagnostic

## Purpose
Establish exact global equal-`ObservedAt` evidence across the certified 734,858-observation Historical 07 population before Phase G replay authorization.

## Safety
- Reads immutable Observation Index shard/lookup/manifest authority.
- Keeps State Application target sheets 10/11/12 read-only and requires them to remain empty of V2 replay rows.
- Does not authorize or enable replay.
- Writes only a private diagnostic workbook, its Script Property checkpoint, and its continuation trigger.

## Method
Phase 1 hashes `(EntityType, EntityId)` into 64 diagnostic partitions. Every observation for an entity therefore lands in one partition even when source observations originated in different immutable shards. Phase 2 sorts each complete partition by `EntityType, EntityId, ObservedAt, ObservationId` and detects exact global equal-time groups.

## Required prior authority
Requires completed v1.5.218/v1.5.217 diagnostic run `PHASE_G_REPLAY_AUTH_V1217|1a90b039-5363-483f-a145-435aeb56cfcd` with exact certified counts 734,858 / 734,786 / 52 / 20 and the Phase G replay state still disabled at cursor zero.

## Operator
Run once:
`startQboStateApplicationV2PhaseGGlobalEqualTimeDiagnosticV1219`

Then allow `qboPhaseGGlobalEqualTimeV1219Continuation_` to continue automatically. Do not manually overlap workers.

Terminal log:
`[PHASE G GLOBAL TIE V1219] | COMPLETE | ...`

A zero global tie count permits the next step to lock unique global `ObservedAt` order and construct the frozen replay-order authority. A nonzero result requires semantic classification/precedence governance before replay.
