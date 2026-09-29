# v1.5.195 — Controlled Script Properties retirement for closed historical ObservationCount working state

Adds a narrow governed retirement path for the single family classified `RETIRE_ELIGIBLE` by v1.5.194:
`FULL_EXPORT_HISTORICAL_OBSERVATIONCOUNT_WORKING_STATE`.

Public operators:
- `previewQboHistoricalObservationCountPropertyRetirement()` — read-only exact preflight.
- `retireQboHistoricalObservationCountWorkingProperties()` — deletes only the exact governed family after all gates pass.
- `verifyQboHistoricalObservationCountPropertyRetirement()` — read-only post-check.

Exact production precondition frozen from the Sep 29 v1.5.194 audit:
- total Script Properties before retirement: 440
- target family properties: 344
- target approximate bytes: 381372
- historical ObservationCount lifecycle closed: true
- Native CDC production paused: true

Safety:
- Depends on v1.5.194 lifecycle evidence and fails closed if the store/target set changed.
- Does not call the older broad V148 reset routine.
- Does not delete Native CDC, unknown, blocked, configuration, credential, Observation Index, or other State Capture properties.
- Fingerprints all non-target key/value pairs before and after deletion and fails if any non-target property changes.
