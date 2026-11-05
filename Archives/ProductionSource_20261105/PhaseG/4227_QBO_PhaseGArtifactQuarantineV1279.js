
/**
 * V1279 — Controlled quarantine of one verified zero-byte
 * V1274 artifact. No checkpoint, journal, or trigger writes.
 */
function quarantineQboPhaseGEmptyArtifactV1279() {
  return qboPg276Lock_(() => {
    const EMPTY_ID = '19MAiCetH1ap71ekyVMLk92o2kA05W_uT';
    const VALID_ID = '1FFEoHmBmeWW0NRnJ_0e80gQft_JeCkk_';
    const NAME = 'chunk_000085.json';
    const QUARANTINE = 'V1279_Quarantine_Chunk_000085';

    const c = qboPg276Context_();

    if (
      c.phase !== 'PRECOMMIT' ||
      c.s.fileCursor !== 791 ||
      c.s.rows !== 354801 ||
      c.s.chunk !== 85 ||
      c.j.cursor !== 791 ||
      c.j.chunk !== 85 ||
      c.j.files !== 10 ||
      c.j.rows !== 2500
    ) {
      throw Error('V1279_CHECKPOINT_GATE_FAILED');
    }

    const r = qboPg276Reconstruct_(c);

    if (
      r.rows.reduce((n, x) => n + x.length, 0) !== 2500 ||
      r.rows[0].length !== 137
    ) {
      throw Error('V1279_SOURCE_RECONSTRUCTION_FAILED');
    }

    const bucket = qboPg274Folder_(c.s, 0);
    const matches = bucket.getFilesByName(NAME);
    const files = [];

    while (matches.hasNext()) files.push(matches.next());

    if (files.length !== 2) {
      throw Error('V1279_ARTIFACT_COUNT_CHANGED');
    }

    const empty = files.find(f => f.getId() === EMPTY_ID);
    const valid = files.find(f => f.getId() === VALID_ID);

    if (!empty || !valid || empty.getSize() !== 0 ||
        valid.getSize() !== 15555) {
      throw Error('V1279_ARTIFACT_ID_OR_SIZE_CHANGED');
    }

    if (empty.getBlob().getDataAsString().length !== 0) {
      throw Error('V1279_EMPTY_FILE_CHANGED');
    }

    const x = JSON.parse(valid.getBlob().getDataAsString());
    const expected = r.rows[0];
    const hash = qboPg274Hash_(expected);

    if (
      x.version !== QBO_PG274_.V ||
      x.bucket !== 0 ||
      x.chunk !== 85 ||
      x.rows !== 137 ||
      x.hash !== hash ||
      hash !==
        'dca3f5fa18760f46ad2c57fa0fea9fdb156aa0badb58cafab3c609169db85464' ||
      JSON.stringify(x.entries) !== JSON.stringify(expected)
    ) {
      throw Error('V1279_VALID_ARTIFACT_SOURCE_MISMATCH');
    }

    // Confirm the empty file currently belongs to bucket 0.
    const parents = empty.getParents();
    const parentIds = [];

    while (parents.hasNext()) {
      parentIds.push(parents.next().getId());
    }

    if (
      parentIds.length !== 1 ||
      parentIds[0] !== bucket.getId()
    ) {
      throw Error('V1279_UNEXPECTED_ORIGINAL_PARENT');
    }

    // All source and checkpoint guards must pass before writes.
    qboPg276CheckState_(c);

    const audit = DriveApp.getFolderById(c.s.auditFolderId);

    if (
      audit.getId() === bucket.getId() ||
      audit.getId() === c.s.indexFolderId
    ) {
      throw Error('V1279_UNSAFE_QUARANTINE_PARENT');
    }

    const existing = audit.getFoldersByName(QUARANTINE);
    let destination;

    if (existing.hasNext()) {
      destination = existing.next();

      if (existing.hasNext()) {
        throw Error('V1279_DUPLICATE_QUARANTINE_FOLDER');
      }

      if (destination.getId() === bucket.getId()) {
        throw Error('V1279_DESTINATION_EQUALS_SOURCE');
      }
    }

    const evidence = {
      version: '1.5.279',
      operation: 'QUARANTINE_ZERO_BYTE_DUPLICATE',
      authorizedFileId: EMPTY_ID,
      preservedFileId: VALID_ID,
      originalFolderId: bucket.getId(),
      auditFolderId: audit.getId(),
      journal: c.j,
      verifiedSourceRows: 2500,
      verifiedBucketRows: 137,
      verifiedSourceHash: hash,
      emptySize: 0,
      validSize: valid.getSize(),
      timestamp: new Date().toISOString()
    };

    console.log(
      '[PHASE G V1279] | PRE_MOVE_VERIFIED | ' +
      JSON.stringify(evidence)
    );

    // The only permitted Drive mutations.
    if (!destination) {
      destination = audit.createFolder(QUARANTINE);
    }

    empty.moveTo(destination);

    // Verify the empty file has left the active bucket.
    const remaining = bucket.getFilesByName(NAME);
    const remainingIds = [];

    while (remaining.hasNext()) {
      remainingIds.push(remaining.next().getId());
    }

    if (
      remainingIds.length !== 1 ||
      remainingIds[0] !== VALID_ID
    ) {
      throw Error('V1279_POST_MOVE_ACTIVE_BUCKET_MISMATCH');
    }

    const moved = DriveApp.getFileById(EMPTY_ID);
    const movedParents = moved.getParents();
    const movedParentIds = [];

    while (movedParents.hasNext()) {
      movedParentIds.push(movedParents.next().getId());
    }

    if (
      moved.getSize() !== 0 ||
      movedParentIds.length !== 1 ||
      movedParentIds[0] !== destination.getId()
    ) {
      throw Error('V1279_POST_MOVE_QUARANTINE_MISMATCH');
    }

    qboPg276CheckState_(c);

    const out = {
      status: 'QUARANTINE_VERIFIED',
      movedFileId: EMPTY_ID,
      preservedFileId: VALID_ID,
      originalFolderId: bucket.getId(),
      quarantineFolderId: destination.getId(),
      activeBucketArtifactCount: remainingIds.length,
      checkpointUnchanged: true,
      journalUnchanged: true,
      triggerCount: qboPg274Triggers_().length,
      permanentDeletionPerformed: false
    };

    console.log(
      '[PHASE G V1279] | COMPLETE | ' +
      JSON.stringify(out)
    );

    return out;
  });
}
