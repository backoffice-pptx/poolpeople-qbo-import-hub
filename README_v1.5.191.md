# v1.5.191 — Final sharded 07 reconciliation engine

Bounded/resumable read-only evidence reconciliation for all 2,418 physical
shard/manifest/lookup triplets.

Evidence checks per triplet:
- canonical stable-body hashes for shard, lookup, manifest;
- cross-file physical IDs and hashes;
- observation vector/count integrity;
- local duplicate ObservationIds;
- AdmissionStatus classification;
- required entity / ObservedAt / payload-pointer lineage fields;
- valid ObservedAt timestamp;
- governed sourceKind lineage.

Expected final classifications:
- 734,858 logical observations
- 734,786 ADMITTED
- 52 EVIDENCE_EXCEPTION
- 20 BLOCKED

The audit writes only its own Script Properties checkpoint and manages only its
own continuation trigger. It does not mutate evidence, retire legacy 07, or
enable State Application.

Important: this stage intentionally finishes as
`COMPLETE_PENDING_GLOBAL_ID_RECONCILIATION`. Local duplicate checks cannot prove
global ObservationId uniqueness across 2,418 files without a separate bounded
global-ID pass. That is the next gate after this stage succeeds.

Run once:
`startQboObservationIndexFinalReconciliationV191()`

Then allow its continuation chain to run. Do not manually invoke the worker or
continuation. Use `statusQboObservationIndexFinalReconciliationV191()` only if
needed for status.
