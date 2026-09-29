# v1.5.185 — Historical shard-drain continuation hardening

Repairs the Sep 18 trigger-service stranding at the frozen healthy boundary:
cursor 2062, indexed 408363, admitted 408315, evidence exceptions 28,
blocked 20, governed exclusions 55.

Key contract changes:
- a fired continuation no longer deletes trigger objects before running the worker;
- next continuation is created first and its unique trigger ID is persisted;
- stale-trigger cleanup happens only after scheduling continuity exists;
- stale cleanup is best-effort and cannot fail the drain;
- status reports matching trigger object IDs separately from the governed scheduled trigger ID;
- one governed no-argument reseed function is provided for the exact stranded boundary.

Run `validateQboObservationIndexTriggerReseedV185()` first.
Do not reseed until that gate is reviewed.
