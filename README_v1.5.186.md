# v1.5.186 — Artifact 2540 evidence diagnostic

Read-only diagnostic for the exact `OBS_INDEX_V179_INVALID_JSON` failure at
artifact cursor 2540 / payload file `12EY1mLyXBeWti1fffyxTyO-6CefuoZnU`.

It inspects the authoritative 06 registration and the Drive file without
requiring successful JSON parsing: file metadata, byte/text length, raw-byte
SHA-256, registered shard hash, escaped prefix/suffix samples, parse result,
stableBody/hash if parseable, FULL_EXPORT chronology registration, and
continuation trigger objects.

No Drive writes, workbook writes, Script Properties mutation, or trigger
mutation.

Run only:
`diagnoseQboObservationIndexArtifact2540EvidenceV186()`

Do not recover/reseed until the result is reviewed.
