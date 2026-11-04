V1275 controlled recovery — install 4223_QBO_PhaseGPartialChunkRecoveryV1275.js alongside V1274.
IMPORTANT: In browser Apps Script, remove or rename the temporary function inspectQboPhaseGGlobalIdentityJournalV1274 before installing this file to avoid duplicate declarations. Other temporary diagnostics may be removed after recovery.
1. Run previewQboPhaseGChunkRecoveryV1275; require PREVIEW_SOURCE_MATCHED, verifiedExisting=13, missingBuckets=[13,14,15], sourceRows=4000.
2. Only after review run recoverQboPhaseGChunkV1275 once. Expect cursor=40 rows=80000 chunk=6 and one trigger.
3. Inspect with inspectQboPhaseGGlobalIdentityV1274 and inspectQboPhaseGGlobalIdentityJournalV1274.
Do NOT run V1274 starter or worker manually. No Phase G/index/source/daily export writes.
The recovery is incident-specific and intentionally refuses a different checkpoint.
