# v1.5.178 — Boundary gate symbol repair

v1.5.177 failed read-only because it referenced two helper names that do not exist in current 4050 source. v1.5.178 uses the actual `qboPayloadArtifactReadRows_()` ledger reader and performs boundary artifact verification locally using the same stableBody SHA-256, envelope shardHash, count, and observationIds/payload vector rules used by 4050 v1.5.172.

No migration/backfill state or evidence is mutated.
