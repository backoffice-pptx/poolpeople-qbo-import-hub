# v1.5.179 — Historical Observation Index shard-writer conversion gate

This release stages the immutable-shard writer candidate in module 4050 but deliberately does not wire it into the historical worker and does not enable recovery.

The no-argument validator `validateQboObservationIndexShardWriterConversionV179()` proves the retained failed run identity/cursor, completed 201,614-row migration, logical/physical/storage contracts, exact artifact-1137 payload/hash/ObservedAt evidence, candidate 21-field logical records, deterministic shard/manifest/lookup identities, and absence of candidate filename collisions.

`IndexedAt` for historical candidate records is deterministically frozen to the retained historical run `startedAt`; it remains non-chronology processing metadata.

No Drive files, workbook cells, Script Properties, or triggers are mutated by the validator.
