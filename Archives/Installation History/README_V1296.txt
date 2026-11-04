V1296 — immutable worker-identity decision contract (DESIGN ONLY / ADDITIVE).
No replacement of exporter framework or scheduler. Does not enable automatic recovery.
Run testQboWorkerIdentityContractV1296 and previewQboWorkerIdentityContractV1296.

BLOCKERS FOR PRODUCTION IMPLEMENTATION:
1. Scheduler must pass immutable identity explicitly through invokeScheduledQboExporter_ to every exporter/write call. Global Script Properties are NOT execution-local identity.
2. V1295 validates lease tokens but does not compare against original scheduler claim at each write.
3. No-steal lease must remain until original execution termination is independently attested. Apps Script does not provide that attestation in this code.
4. No forced lease cleanup or automatic takeover is authorized.
5. Paused production preview cannot prove live write-path behavior.
Keep scheduler paused. Do not treat this contract as completed write fencing.
