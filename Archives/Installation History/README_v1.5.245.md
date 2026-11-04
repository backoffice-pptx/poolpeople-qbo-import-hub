# App 50 v1.5.245 — Phase G explicit manifest queue recovery

## Install and start

Install this changed-file package in **50 QBO Import Hub Standalone**. Replace module 4160 with the included version and add module 4192. Keep the existing modules through v1.5.244. The durable Phase G checkpoint deliberately retains version 1.5.231; the original journal/counter guards continue to apply.

Run **`startQboPhaseGExplicitQueueAuditV1245` once**, then share its execution log. It verifies the exact interrupted boundary at manifest cursor 1955, 457008 observations, 456976 admitted, 32 exceptions, zero blocked, and the current manifest at journal slot 19 of 64. If that boundary differs, it refuses to start. Do not run an old Phase G worker during this audit.

The starter removes only the stranded journaled Phase G continuation trigger. It saves the checkpoint and source inventory privately, creates a separate audit workbook, and installs its own one-minute audit trigger. Prospective CDC capture keeps running. Audit batches process up to 12 source manifests with a 90-second budget for starting work, then compare one partition per invocation. Expect many invocations; this audit is substantial and is not an immediate token reset.

Run **`inspectQboPhaseGExplicitQueueAuditV1245`** for status. `candidateCursor` progresses to 683, then `partitionCursor` progresses to 64. The audit removes its trigger when it reaches **`READY_FOR_EXPLICIT_QUEUE_ACTIVATION`**. Share that result before running the activation step below.

## What is established

The v1230 audit froze the original 1735 committed manifest IDs and certified 405205 rows. The current checkpoint has committed another 220 manifests and 51803 observations. The expired/invalid Drive iterator can no longer be trusted to identify the remainder.

This audit inventories the 2418 source manifests and excludes the original certified 1735 by exact IDs and names. It verifies all 683 candidate source triplets and their total 329653 observations, including admission totals. It builds expected rows in a new workbook; it never writes Phase G partition data.

For each of the 64 original partitions it:

- Compares the original audited prefix against the prior audit's expected rows.
- Matches the later committed suffix against the candidate source rows, including full row contents and multiplicity.
- Verifies previously checkpointed journal slots are present and exact.
- Allows only blank or exact rows at the current uncheckpointed slot, and rejects unexpected writes beyond that slot.

It requires exactly 220 fully committed later manifests, the known partial in-flight manifest, and 462 wholly absent manifests. An unexplained partial manifest, changed source, duplicate/unknown observation, changed protected checkpoint, or zero-row manifest with ambiguous membership stops certification. No filename order or fresh iterator order is treated as proof of prior membership.

## Activation — only after the audit passes

Run **`activateQboPhaseGExplicitQueueRecoveryV1245`** when instructed after reviewing the completed audit. It verifies the certified queue hash and frozen checkpoint, adds the immutable queue reference to the original checkpoint, and schedules the existing journaled worker.

The explicit queue starts with the exact current in-flight manifest, then contains the certified absent manifests in stable ID order. The diagnostic does not require the prior Drive enumeration order after exact membership has been established. The existing source verification, partition tail checks, journal writes, atomic manifest/counter commits, final population reconciliation, and 64-partition tie scan remain in place. Each queued source must match its audited manifest ID, base, shard hash, and admission counts.

The old iterator token is preserved as evidence; it is bypassed only after queue activation. A journal commit may write a token marker, but queue selection derives from the committed manifest cursor and certified list, not that marker. The current journal's stale `nextToken` does not govern the explicit queue.

## Failures and storage

Exactly one new fixed Script Property, `QBO_PHASE_G_EXPLICIT_QUEUE_V1245_POINTER`, holds the private folder/checkpoint IDs. Inventory, audit checkpoint, partition comparison reports, queue certificate, and workbook are durable private audit artifacts. There are no new per-manifest Script Properties. No existing failed-cycle properties are removed.

Audit invocations use the same UserLock as the Phase G worker. Overlapping audit ticks yield when the lock is busy. Recognized transient service errors may retry, with at most three attempts at an unchanged audit position. A hard termination leaves the recurring audit trigger available; three unsuccessful attempts at that position also stop it. Structural errors stop the audit trigger immediately. Successful checkpoint progress resets the attempt count at the next position. Share any STOPPED log; do not bypass a failed certification.

The existing Phase G worker's post-activation one-time scheduling remains unchanged. This package repairs expired-iterator dependence; it does not promise automatic recovery of every later server failure. Prospective CDC, native historical watermark, pending handoffs, replay authorization, ingestion, and historical deletion-gap disposition are unchanged.

## Validation

Syntax checks and local mocked integration tests passed for membership totals; global checkpoint preservation before activation; counter and slot preservation on activation; queue selection without expired tokens; next/final cursor behavior; source/hash changes; partially committed and ambiguous zero-row membership; frozen boundary and retry limits; audited-prefix and committed-suffix corruption; missing completed journal slots; unexpected future writes; and an empty current slot. The tests simulate Apps Script services and do not constitute live Drive/Spreadsheet validation. The on-platform audit is the required evidence gate.
