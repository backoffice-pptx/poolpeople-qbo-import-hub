# v1.5.218 — Phase G Replay Authority Drive Recovery

Repairs the v1.5.217 read-only replay-authority diagnostic after the transient Drive service failure at durable manifest cursor 2141.

## Recovery
Run:

`recoverQboStateApplicationV2PhaseGReplayAuthorityDiagnosticV1218`

The recovery is intentionally bound to the existing run `PHASE_G_REPLAY_AUTH_V1217|1a90b039-5363-483f-a145-435aeb56cfcd` and exact durable checkpoint: cursor 2141, 497187 observations, 497131 admitted, 36 evidence exceptions, 20 blocked.

The v1.5.217 worker persisted state after every successfully processed manifest, including the refreshed Drive iterator continuation token. Therefore cursor 2141 is retained; the scan is not restarted.

## Transient Drive behavior
Recognized transient Drive service failures no longer terminally poison the diagnostic. The last per-manifest checkpoint is retained and continuation is rescheduled. If trigger creation itself fails, state becomes `CONTINUATION_REQUIRED` rather than losing the checkpoint.

## Equal-time limitation discovered
The existing v1.5.217 equal-ObservedAt analysis groups records within a shard only. It cannot prove absence of equal-time groups that cross shard boundaries. The terminal diagnostic now explicitly reports:

- `equalObservedAtAnalysisScope: WITHIN_SHARD_ONLY`
- `globalEqualObservedAtCertification: false`
- next action `RUN_GLOBAL_EQUAL_TIME_ORDER_DIAGNOSTIC`

No replay authorization or State Application writes are enabled by this increment.
