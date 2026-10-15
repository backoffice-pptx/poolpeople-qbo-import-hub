# App 50 v1.5.244 — Separate prospective CDC capture

Install the new 4191 module in the existing **50 QBO Import Hub Standalone** project. Keep installed modules through v1.5.243. No existing module is replaced.

Run `activateQboNativeCdcProspectiveCaptureV1244` once. It verifies the exact saved v1242 review, the paused failed-cycle boundary, disabled replay, three pending handoffs, and absence of legacy CDC/ingestion triggers. Activation saves an isolated Drive checkpoint, installs one five-minute trigger, and processes up to five entities immediately. Subsequent invocations process up to five entities each. After a cycle finishes, a new cycle can begin once 30 minutes have passed since its window end.

Run `inspectQboNativeCdcProspectiveCaptureV1244` for status. Run `pauseQboNativeCdcProspectiveCaptureV1244` to pause only this new stream. If the script lock is busy, retry later. Do not reactivate the old native worker or change its historical watermark.

## Boundaries

The initial anchor is **2026-10-09T16:47:05.794Z**, the failed cycle's window end. It is explicitly a starting point, not evidence of a completed historical window. The first request starts 15 minutes earlier: **2026-10-09T16:32:05.794Z**. This bridges later changes while retaining overlap with the already saved evidence. After all 20 entity responses are saved, validated, and rechecked, a separate manifest commits and only the prospective checkpoint advances to that cycle's window end.

The original native watermark remains **2026-09-14T10:38:54.152Z**. Original production remains paused. Historical Purchase deletion coverage remains uncertified. This module does not register sources, publish handoffs, ingest, replay, or modify Phase G. It preserves the three pending handoffs and failed-cycle properties.

## Storage and failures

Exactly one fixed Script Property, `QBO_NATIVE_CDC_PROSPECTIVE_V1244_POINTER`, holds two Drive IDs. It is reused, not multiplied per cycle. Checkpoints, raw entity responses, and manifests live in a new folder beneath the existing recovery folder. Evidence is retained; this module creates no per-entity transient properties requiring cleanup.

One script lock serializes each batch, so it may briefly contend with Phase G. A busy batch yields until the next five-minute tick. Each batch starts no more than five requests, with a 150-second budget for starting work; an individual network call may extend that time. An interruption after a raw file was saved can reuse that file without another API request. A completed manifest is verified before the prospective checkpoint advances.

A caught request error, invalid response, duplicate/missing ID, saturated response (1000 or more returned objects), or changed protected boundary halts this stream and removes its trigger. No automatic failed-cycle restart loop is installed. Inspect the status and share the log before recovery; there is deliberately no generic force-resume command. A hard runtime termination cannot execute its catch block, but the durable checkpoint and existing files allow the next tick to retry from the saved boundary.

The manifest is explicitly labeled `PROSPECTIVE_CAPTURE_COMMITTED_WITH_HISTORICAL_GAP`. These are returned states and tombstones, not every intermediate revision or a common atomic snapshot. The historical review hash and limitations remain attached to every manifest. Future ingestion requires a separate reviewed integration.

## Validation

Local syntax and mocked Apps Script integration checks passed: all 20 entities commit, original watermark stays unchanged, one fixed property, cycle cooldown, saturation halts and removes the trigger, interrupted checkpoint reuses raw evidence, concurrent worker yields, and protected-boundary changes halt. Live Apps Script/QBO execution has not been tested here; verify the activation and first completed cycle logs.
