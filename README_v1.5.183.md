# v1.5.183 — Artifact 1864 partial-commit diagnostic

Read-only diagnostic for the exact historical shard-drain failure at artifact cursor 1864 (`Service error: Drive`).

It reconstructs artifact 1864 using the deployed v179/v180 preparation contract, then inspects the deterministic shard, lookup, and manifest names. Existing files are re-read and checked for self-hash, expected shard hash/count, and physical cross-references. The manifest is treated as the commit marker.

The diagnostic performs no Drive writes, workbook writes, Script Properties mutation, or trigger mutation. It also checks that no historical drain continuation remains installed.

Run only:

`diagnoseQboObservationIndexShardCommitBoundaryV183()`

Do not resume the drain until the diagnostic result is reviewed.
