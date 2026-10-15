# v1.5.228 — Exact stalled Phase G trigger replacement

Run `recoverQboPhaseGGlobalEqualTimeStalledTriggerV1228()` once using the account that owns trigger 3267357027457826816. Confirm no Phase G continuation execution is currently running before invoking it.

Requires the exact V1226-observed checkpoint: cursor 1677 / 2418, observations 391927, admitted 391899, exceptions 28, blocked 0; same run/workbook; empty error and in-flight fields; zero scan/tie counters; iterator token present; lastProgressAt 2026-10-07T03:50:25.136Z. Requires at least 90 minutes without checkpoint progress, existing authority gates, exact one-trigger inventory, and unchanged serialized state before mutation.

All guards precede mutation. Deletes only exact stalled trigger 3267357027457826816, creates one replacement delayed continuation, and changes only the checkpoint continuationTriggerId. No workbook access, counter rollback, iterator replacement, replay enablement or synchronous worker invocation. Existing worker retains its verified-manifest cleanup-before-append barrier.

Trigger presence alone does not explain the 0-second failure. The package restores scheduling without claiming to fix its unknown cause. If deletion succeeds but creation or property persistence fails, stop and rerun the read-only V1226 inspector; do not rerun recovery blindly. If failure recurs, inspect state and platform failure notifications before additional recovery.

Local verification: syntax; success preserves all checkpoint fields except trigger ID; changed checkpoint, wrong trigger ID, multiple triggers, recent checkpoint, changed serialized state and authority failure reject before mutations. Runtime pending.
