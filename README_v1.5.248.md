# App 50 v1.5.248 — Verify and rebuild the private expected population

Add module 4194 to **50 QBO Import Hub Standalone**. Keep installed modules through v1.5.247, including the v1.5.246 replacement of module 4192 and the v1.5.245 replacement of module 4160.

Run **`startQboPhaseGVerifiedExpectedPopulationV1248` once**, then share its log. It requires the exact failed expected-row audit: 683 candidates, 329653 rows, COMPARE_PARTITIONS, partition cursor zero, V1245_EXPECTED_PARTITION_INVALID, and original private workbook `1QHT7B-X6OhKUKO3DBAZf7S0DvXrjNVVT8sStulpmekI`. It reuses the existing audit pointer and adds a recovery reference to the private audit checkpoint. **No new Script Properties are created.** It does not alter Phase G's global checkpoint or committed partitions.

The starter creates a new private workbook and a one-minute recovery trigger. Leave it running; this is a substantial staged source verification, not deletion of the 26 sampled duplicate occurrences. Check progress with **`inspectQboPhaseGVerifiedExpectedPopulationV1248`**. Do not run the original audit or Phase G worker during this recovery. Prospective CDC continues independently.

## Stages

1. COPY_ORIGINAL_ROWS: Copy all 329653 original expected rows in bounded chunks, verifying each written range by readback. The original workbook stays untouched.
2. PROVE_ORIGINAL_COPY: Save per-candidate/per-partition SHA-256 fingerprints of the copied rows before sorting.
3. SORT_ORIGINAL_COPY: Group the copy by candidate index. Each candidate is later checked against its pre-sort fingerprints, detecting a changed multiset even when row totals remain equal.
4. COMPARE_AND_REBUILD_CANDIDATES: Revalidate all 683 immutable source triplets and their original hashes/admission/partition counts. Compare each complete source candidate against its original expected rows, reporting missing and unexpected multiplicities. Independently write complete source-derived replacement rows at fixed offsets and verify exact readback before checkpoint advancement. Save source-derived per-candidate/per-partition proofs.
5. SORT_REBUILT_ROWS: Sort the replacement by partition and Observation ID for the existing membership audit.
6. VERIFY_SORTED_PARTITIONS: Check all 64 sorted partitions against the source-derived fingerprints and counts, including uniqueness and partition/index guards. This verifies sorting preserved the source-verified population.
7. READY_TO_ADOPT_VERIFIED_EXPECTED_ROWS: Save a durable certificate and remove the recovery trigger. Share the checkpoint and any CANDIDATE_DIFFERENCE logs before adoption.

At most three attempts are allowed at an unchanged recovery position. Recognized transient service errors can retry; structural errors stop the trigger. A caught failure preserves the durable cursor, so a retry overwrites only the current uncommitted private range. No old evidence, source file, or committed Phase G range is deleted. This module does not fix the underlying service or claim that the private duplicates' runtime cause has been established.

## After the certificate is reviewed

Run **`activateQboPhaseGVerifiedExpectedPopulationV1248`** when instructed. It verifies the certificate, switches only the existing private membership audit's workbook reference, records original-workbook provenance, and reinstalls that audit's trigger at partition zero.

This is **not** Phase G queue activation. The v1245 membership audit still must verify the committed prefix/suffix and journal tail and reach `READY_FOR_EXPLICIT_QUEUE_ACTIVATION`. The existing Phase G counters, iterator evidence, journal slot 19, and frozen boundary remain unchanged throughout this expected-row recovery. After adopting replacement rows, use `inspectQboPhaseGExplicitQueueAuditV1245` for the continuing membership audit; the v1248 inspector intentionally guards the pre-adoption boundary.

## Validation

Syntax and mocked checks passed for balanced duplicates/missing rows, order-independent fingerprints with multiplicity preserved, exact range readback failure, partition proof checks, changed sorted rows, duplicate refusal, bounded attempts, and retaining the source candidate's durable position after an interrupted private write. Full source and spreadsheet verification is performed by the staged on-platform workflow. Local tests do not certify the user's live workbook.
