V1281 — LIMITED FAIL-CLOSED WATCHDOG HARDENING (NOT FULL AUTOMATIC RECOVERY)

Baseline: V1280 24_TriggerManagement.js (Nov 3). Compare against current deployed source before replacement.

Change: an occupied worker claim no longer creates another watchdog continuation each time a watchdog fires. Claim and evidence are retained. This prevents infinite watchdog rearming; it does not recover terminated workers automatically.

New function: previewQboDailyRecoveryV1281 (read only).

SAFETY: Do not install while a daily export is active. Keep paused=true. Do not unpause until a controlled recovery protocol is implemented/tested or manual recovery coverage is explicitly accepted.

Why not automatic takeover? Apps Script properties and heartbeat timestamps cannot prove an execution has terminated. Heartbeat gaps during a 20-minute blocking Sheets write are expected. Automatic takeover without a liveness oracle would reproduce the Nov 3 overlap.

For complete V1282: use bounded, lease-aware work units with resumable checkpoints and atomic owner fencing at each mutation; reconcile durable export evidence before retry. No assumption that ScriptLock or timestamp proves termination.
