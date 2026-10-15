# App 50 v1.5.250 — Verified partition files without another shared-sheet sort

Replace module **4192** with the included copy and add module **4196**. Retain all other installed modules, including 4160 and 4194. Package contents stay under `50 QBO Import Hub Standalone/`.

Run **`startQboPhaseGVerifiedPartitionFilesV1250` once**, then share its startup log. This requires the precise stopped v1248 rebuild: all 683 candidates, 329653 replacement rows, one completed partition verification, and `V1248_REBUILT_PARTITION_INDEX_OR_DUPLICATE`. The existing membership audit remains frozen at manifest 1955 and journal slot 19. Both old audit/rebuild triggers must be absent.

The new process reuses the existing private audit pointer; **no new Script Properties** are created. It registers a private Drive checkpoint and installs one one-minute trigger. It performs no Spreadsheet writes or sort operations. The original and rebuilt workbooks remain evidence and are not repaired in place. Prospective CDC continues unchanged.

## Verification and recovery

1. Scan the rebuilt sheet's partition column in bounded batches to establish actual partition boundaries. Do not assume source counts equal current sheet counts. Invalid or nonmonotonic partition values stop the process.
2. Read one partition at a time and compare all 683 candidate groups with their saved pre-sort source fingerprints and counts.
3. Keep a group only when it exactly matches its source fingerprint/count. For every mismatched group, reread and reverify its immutable manifest/shard/lookup triplet, require the original shard hash and admission counts, and reconstruct that candidate's partition rows. The fresh source must reproduce the saved pre-sort proof. An invalid index or unreproducible proof stops recovery. More than eight source reconstructions in one partition also stops for review instead of attempting an unbounded invocation.
4. Check all corrected groups again against their source proofs. Verify Observation IDs, JSON structure, entity hash partition, uniqueness, and total population. Arrange each small candidate group in deterministic local JavaScript order; no spreadsheet range is sorted.
5. Save a separate JSON partition file and findings file, checking exact readback. Already saved files are reused only if their entire content matches. This is application-level immutability backed by hashes, not a Drive permission restriction.
6. Independently reread and hash all 64 completed files, one per invocation. Save a certificate only after all files and all 329653 rows reconcile.

These checks use the source-derived proofs generated during the verified v1248 writes. Mismatched groups require fresh source verification; apparently intact groups are protected by full row-content SHA-256 proofs, not merely counts. The first diagnostic established that the source proofs for candidates 274, 310, and 472 still reproduce from their immutable sources. It did not establish the platform/runtime cause of later sheet changes.

Inspect progress with **`inspectQboPhaseGVerifiedPartitionFilesV1250`**. Automatic retries remain bounded to three attempts at an unchanged position for recognized transient service errors. Structural errors stop the trigger. The final status is **`READY_TO_ADOPT_VERIFIED_PARTITION_FILES`**; the trigger removes itself. Share that checkpoint and any PARTITION_VERIFIED findings with reconstructed candidates.

## Adoption, after the certificate is reviewed

Run **`activateQboPhaseGVerifiedPartitionFilesV1250`** when instructed. It verifies the certificate and patched audit implementation, switches only the existing private membership audit's expected-data input to the certified partition files, and reinstalls its trigger at partition zero. The audit checks each file's certificate reference, hash, identity, and count when reading it. The workbooks remain untouched.

This adoption does **not** resume Phase G. The original v1245 audit still checks the audited prefix, later committed suffix, and in-flight journal tail, and must reach `READY_FOR_EXPLICIT_QUEUE_ACTIVATION`. Queue activation remains a later step. No Phase G counters, committed ranges, native watermark, pending handoffs, replay authorization, or ingestion permission change in this package. The eventual queue report includes the partition-file certificate reference as provenance.

## Local validation

Syntax and mocked checks passed for reconstructing the reported balanced duplicates/missing rows; keeping source-proved groups without source reads; deterministic local ordering; refusing changed sources/proofs and invalid indices; certificate and per-file hash protection; the existing membership, journal-tail, explicit-queue, and Drive-retry guards; and the new audit branch's refusal to read the old shared expected sheet. Live verification still occurs in Apps Script before adoption.
