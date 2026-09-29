# v1.5.190 — Physical 07 inventory derivation gate

Read-only correction/diagnostic following v1.5.189.

This gate proves rather than assumes the expected historical physical-triplet count:

- total 06 artifacts = 3,455
- first shard-drain artifact cursor = 1,137
- candidate post-legacy artifacts = 3,455 - 1,137 = 2,318
- governed excluded controlled-test artifact = 1
- expected historical physical triplets = 2,318 - 1 = 2,317
- legacy migration physical triplets = 101
- expected total physical triplets = 2,418

It also verifies the exact controlled-test exclusion identity and inventories all
three governed physical-07 folders.

Run only:
`validateQboObservationIndexPhysicalInventoryDerivationV190()`

No production state is mutated.
