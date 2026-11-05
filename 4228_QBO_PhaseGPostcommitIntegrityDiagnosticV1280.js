
/**
 * V1280 — Read-only post-commit integrity diagnostic.
 * Reconstructs from the saved pre-commit iterator token.
 * Does not save state, delete journals, or create triggers.
 */
function inspectQboPhaseGPostcommitIntegrityV1280() {
  return qboPg276Lock_(() => {
    const c = qboPg276Context_();

    if (
      c.phase !== 'POSTCOMMIT' ||
      c.s.fileCursor !== 801 ||
      c.s.rows !== 357301 ||
      c.s.chunk !== 86 ||
      c.j.phase !== 'STAGING' ||
      c.j.cursor !== 791 ||
      c.j.chunk !== 85 ||
      c.j.files !== 10 ||
      c.j.rows !== 2500 ||
      c.s.recoveryVersion !== '1.5.276'
    ) {
      throw Error('V1280_UNEXPECTED_RECOVERY_STATE');
    }

    const tokenBefore = c.s.recoveryIteratorTokenBefore;
    const it = DriveApp.continueFileIterator(tokenBefore);
    const rows = Array.from({ length: 16 }, () => []);
    const ids = [];

    for (let i = 0; i < c.j.files; i++) {
      if (!it.hasNext()) {
        throw Error('V1280_SOURCE_ITERATOR_EXHAUSTED');
      }

      const f = it.next();
      const x = JSON.parse(f.getBlob().getDataAsString());

      if (
        x.version !== '1.5.271' ||
        !Array.isArray(x.entries) ||
        x.rows !== x.entries.length ||
        qboPg271Hash_(JSON.stringify(x.entries)) !==
          x.payloadHash
      ) {
        throw Error('V1280_SOURCE_INDEX_INVALID ' + f.getId());
      }

      for (const e of x.entries) {
        if (
          !Array.isArray(e) ||
          typeof e[0] !== 'string' ||
          !e[0]
        ) {
          throw Error('V1280_SOURCE_ENTRY_INVALID');
        }

        rows[qboPg274Bucket_(e[0])].push([
          e[0],
          f.getId(),
          e[2]
        ]);
      }

      ids.push(f.getId());
    }

    const regeneratedToken = it.getContinuationToken();
    const sourceRows = rows.reduce(
      (sum, bucketRows) => sum + bucketRows.length, 0
    );

    const fileIdsMatch =
      JSON.stringify(ids) ===
      JSON.stringify(c.s.recoverySourceFileIds);

    const continuationTokenMatches =
      regeneratedToken === c.s.iteratorToken;

    const artifacts = [];

    for (let b = 0; b < 16; b++) {
      const dir = qboPg274Folder_(c.s, b);
      const name = 'chunk_000085.json';
      const matches = dir.getFilesByName(name);
      const files = [];

      while (matches.hasNext()) {
        files.push(matches.next());
      }

      const expected = {
        version: QBO_PG274_.V,
        bucket: b,
        chunk: 85,
        rows: rows[b].length,
        hash: qboPg274Hash_(rows[b]),
        entries: rows[b]
      };

      const result = {
        bucket: b,
        fileCount: files.length,
        expectedRows: expected.rows,
        verified: false
      };

      if (files.length === 1) {
        const f = files[0];
        result.fileId = f.getId();
        result.size = f.getSize();

        try {
          const actual = JSON.parse(
            f.getBlob().getDataAsString()
          );

          result.verified =
            actual.version === expected.version &&
            actual.bucket === expected.bucket &&
            actual.chunk === expected.chunk &&
            actual.rows === expected.rows &&
            actual.hash === expected.hash &&
            Array.isArray(actual.entries) &&
            qboPg274Hash_(actual.entries) === expected.hash &&
            JSON.stringify(actual.entries) ===
              JSON.stringify(expected.entries);

          if (!result.verified) {
            result.error = 'SOURCE_PAYLOAD_MISMATCH';
          }
        } catch (e) {
          result.error = String(e);
        }
      } else {
        result.error = files.length === 0
          ? 'MISSING'
          : 'DUPLICATE_ARTIFACT';
      }

      artifacts.push(result);
    }

    // Verify durable checkpoint and journal did not change.
    qboPg276CheckState_(c);

    const verifiedCount = artifacts.filter(
      x => x.verified
    ).length;

    const verifiedRows = artifacts.reduce(
      (sum, x) => sum + (x.verified ? x.expectedRows : 0),
      0
    );

    const sourceAndArtifactsVerified =
      sourceRows === 2500 &&
      fileIdsMatch &&
      verifiedCount === 16 &&
      verifiedRows === 2500;

    const out = {
      version: '1.5.280',
      readOnly: true,
      status: sourceAndArtifactsVerified
        ? 'SOURCE_AND_ARTIFACTS_VERIFIED'
        : 'BLOCKED_INTEGRITY_REVIEW',
      checkpoint: {
        status: c.s.status,
        cursor: c.s.fileCursor,
        rows: c.s.rows,
        chunk: c.s.chunk
      },
      journal: c.j,
      source: {
        fileCount: ids.length,
        rows: sourceRows,
        fileIdsMatch,
        continuationTokenMatches,
        regeneratedTokenPresent: !!regeneratedToken,
        committedTokenPresent: !!c.s.iteratorToken
      },
      artifacts: {
        verifiedCount,
        verifiedRows,
        failedBuckets: artifacts
          .filter(x => !x.verified)
          .map(x => x.bucket),
        details: artifacts
      },
      journalPresent: true,
      leasePresent: !!c.s.lease,
      triggerCount: qboPg274Triggers_().length,
      mutationPerformed: false
    };

    console.log(
      '[PHASE G V1280] | READ_ONLY | ' +
      JSON.stringify(out)
    );

    return out;
  });
}
