
/**
 * V1281 — Read-only iterator-boundary verification.
 *
 * Compares the committed continuation token with a newly
 * generated continuation token after replaying the 10
 * source files recorded by V1276.
 *
 * No checkpoint, journal, file, or trigger mutations.
 */
function inspectQboPhaseGIteratorBoundaryV1281() {
  return qboPg276Lock_(() => {
    const c = qboPg276Context_();

    if (
      c.phase !== 'POSTCOMMIT' ||
      c.s.status !== 'HALTED_REVIEW_REQUIRED' ||
      c.s.fileCursor !== 801 ||
      c.s.rows !== 357301 ||
      c.s.chunk !== 86 ||
      c.s.recoveryVersion !== '1.5.276' ||
      c.j.phase !== 'STAGING' ||
      c.j.cursor !== 791 ||
      c.j.chunk !== 85 ||
      c.j.files !== 10 ||
      c.j.rows !== 2500 ||
      !c.s.recoveryIteratorTokenBefore ||
      !c.s.iteratorToken ||
      !Array.isArray(c.s.recoverySourceFileIds) ||
      c.s.recoverySourceFileIds.length !== 10
    ) {
      throw Error('V1281_UNEXPECTED_RECOVERY_STATE');
    }

    const validate = f => {
      const x = JSON.parse(f.getBlob().getDataAsString());

      if (
        x.version !== '1.5.271' ||
        !Array.isArray(x.entries) ||
        x.rows !== x.entries.length ||
        qboPg271Hash_(JSON.stringify(x.entries)) !==
          x.payloadHash
      ) {
        throw Error('V1281_INVALID_INDEX ' + f.getId());
      }

      return {
        fileId: f.getId(),
        rows: x.rows,
        payloadHash: x.payloadHash
      };
    };

    // Reconstruct the committed 10-file source sequence.
    const replay = DriveApp.continueFileIterator(
      c.s.recoveryIteratorTokenBefore
    );

    const historical = [];

    for (let i = 0; i < 10; i++) {
      if (!replay.hasNext()) {
        throw Error('V1281_HISTORICAL_ITERATOR_EXHAUSTED');
      }

      historical.push(validate(replay.next()));
    }

    const historicalIds = historical.map(x => x.fileId);

    const historicalIdsMatch =
      JSON.stringify(historicalIds) ===
      JSON.stringify(c.s.recoverySourceFileIds);

    if (!historicalIdsMatch) {
      throw Error('V1281_HISTORICAL_SOURCE_SEQUENCE_CHANGED');
    }

    const regeneratedToken = replay.getContinuationToken();

    // Both iterators should now represent the boundary
    // immediately after the 10 committed source files.
    const committed = DriveApp.continueFileIterator(
      c.s.iteratorToken
    );

    const regenerated = DriveApp.continueFileIterator(
      regeneratedToken
    );

    const committedNext = [];
    const regeneratedNext = [];

    const SAMPLE = 3;

    for (let i = 0; i < SAMPLE; i++) {
      const committedHasNext = committed.hasNext();
      const regeneratedHasNext = regenerated.hasNext();

      if (committedHasNext !== regeneratedHasNext) {
        throw Error('V1281_ITERATOR_AVAILABILITY_DIVERGED');
      }

      if (!committedHasNext) break;

      committedNext.push(validate(committed.next()));
      regeneratedNext.push(validate(regenerated.next()));
    }

    const committedIds = committedNext.map(x => x.fileId);
    const regeneratedIds = regeneratedNext.map(x => x.fileId);

    const nextFileIdsMatch =
      JSON.stringify(committedIds) ===
      JSON.stringify(regeneratedIds);

    const nextPayloadsMatch =
      JSON.stringify(committedNext) ===
      JSON.stringify(regeneratedNext);

    const historicalSet = new Set(historicalIds);

    const historicalFilesRepeated =
      committedIds.some(id => historicalSet.has(id)) ||
      regeneratedIds.some(id => historicalSet.has(id));

    const expectedSampleCount = Math.min(
      SAMPLE,
      QBO_PG274_.N - c.s.fileCursor
    );

    // Ensure the durable state did not change while reading.
    qboPg276CheckState_(c);

    const sourceSequenceVerified =
      historicalIdsMatch &&
      committedNext.length === expectedSampleCount &&
      regeneratedNext.length === expectedSampleCount &&
      nextFileIdsMatch &&
      nextPayloadsMatch &&
      !historicalFilesRepeated;

    const out = {
      version: '1.5.281',
      readOnly: true,
      status: sourceSequenceVerified
        ? 'ITERATOR_BOUNDARY_SEQUENCE_VERIFIED'
        : 'BLOCKED_ITERATOR_BOUNDARY_REVIEW',
      checkpoint: {
        status: c.s.status,
        cursor: c.s.fileCursor,
        rows: c.s.rows,
        chunk: c.s.chunk
      },
      historical: {
        fileCount: historical.length,
        fileIdsMatch: historicalIdsMatch,
        fileIds: historicalIds
      },
      boundary: {
        continuationTokenStringsMatch:
          regeneratedToken === c.s.iteratorToken,
        sampleCount: SAMPLE,
        expectedSampleCount,
        committedNext,
        regeneratedNext,
        nextFileIdsMatch,
        nextPayloadsMatch,
        historicalFilesRepeated
      },
      authority: {
        source: 'V1271_INDEX',
        independentManifestOrderVerified: false
      },
      journalPresent: !!c.raw,
      leasePresent: !!c.s.lease,
      triggerCount: qboPg274Triggers_().length,
      mutationPerformed: false
    };

    console.log(
      '[PHASE G V1281] | READ_ONLY | ' +
      JSON.stringify(out)
    );

    return out;
  });
}
