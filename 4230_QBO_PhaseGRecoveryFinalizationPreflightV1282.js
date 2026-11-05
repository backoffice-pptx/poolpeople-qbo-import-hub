
/**
 * V1282 — Read-only finalization preflight.
 *
 * Validates the committed V1276 recovery without invoking
 * the defective postcommit token-string equality check.
 *
 * NO writes, trigger changes, or journal deletion.
 */
function inspectQboPhaseGFinalizationPreflightV1282() {
  return qboPg276Lock_(() => {
    const c = qboPg276Context_();
    const s = c.s;
    const j = c.j;

    if (
      c.phase !== 'POSTCOMMIT' ||
      s.status !== 'HALTED_REVIEW_REQUIRED' ||
      s.fileCursor !== 801 ||
      s.rows !== 357301 ||
      s.chunk !== 86 ||
      s.recoveryVersion !== '1.5.276' ||
      j.phase !== 'STAGING' ||
      j.cursor !== 791 ||
      j.chunk !== 85 ||
      j.files !== 10 ||
      j.rows !== 2500 ||
      !s.recoveryIteratorTokenBefore ||
      !s.iteratorToken ||
      !Array.isArray(s.recoverySourceFileIds) ||
      s.recoverySourceFileIds.length !== 10 ||
      s.lease ||
      qboPg274Triggers_().length !== 0
    ) {
      throw Error('V1282_STATE_GATE_FAILED');
    }

    const sourceIt = DriveApp.continueFileIterator(
      s.recoveryIteratorTokenBefore
    );

    const rows = Array.from({ length: 16 }, () => []);
    const sourceIds = [];

    function validateIndex(f) {
      const x = JSON.parse(f.getBlob().getDataAsString());

      if (
        x.version !== '1.5.271' ||
        !Array.isArray(x.entries) ||
        x.rows !== x.entries.length ||
        qboPg271Hash_(JSON.stringify(x.entries)) !==
          x.payloadHash
      ) {
        throw Error('V1282_INDEX_INVALID ' + f.getId());
      }

      return x;
    }

    for (let i = 0; i < j.files; i++) {
      if (!sourceIt.hasNext()) {
        throw Error('V1282_SOURCE_EXHAUSTED');
      }

      const f = sourceIt.next();
      const x = validateIndex(f);

      sourceIds.push(f.getId());

      for (const e of x.entries) {
        if (
          !Array.isArray(e) ||
          typeof e[0] !== 'string' ||
          !e[0]
        ) {
          throw Error('V1282_SOURCE_ENTRY_INVALID');
        }

        rows[qboPg274Bucket_(e[0])].push([
          e[0],
          f.getId(),
          e[2]
        ]);
      }
    }

    const sourceIdsMatch =
      JSON.stringify(sourceIds) ===
      JSON.stringify(s.recoverySourceFileIds);

    const reconstructedRows = rows.reduce(
      (n, bucketRows) => n + bucketRows.length, 0
    );

    const artifacts = [];

    for (let b = 0; b < 16; b++) {
      const dir = qboPg274Folder_(s, b);
      const it = dir.getFilesByName('chunk_000085.json');
      const files = [];

      while (it.hasNext()) files.push(it.next());

      const expected = {
        version: QBO_PG274_.V,
        bucket: b,
        chunk: 85,
        rows: rows[b].length,
        hash: qboPg274Hash_(rows[b]),
        entries: rows[b]
      };

      let verified = false;
      let error = null;

      if (files.length === 1) {
        try {
          const actual = JSON.parse(
            files[0].getBlob().getDataAsString()
          );

          verified =
            actual.version === expected.version &&
            actual.bucket === expected.bucket &&
            actual.chunk === expected.chunk &&
            actual.rows === expected.rows &&
            actual.hash === expected.hash &&
            Array.isArray(actual.entries) &&
            qboPg274Hash_(actual.entries) === expected.hash &&
            JSON.stringify(actual.entries) ===
              JSON.stringify(expected.entries);

          if (!verified) error = 'PAYLOAD_MISMATCH';
        } catch (e) {
          error = String(e);
        }
      } else {
        error = files.length === 0
          ? 'MISSING'
          : 'DUPLICATE';
      }

      artifacts.push({
        bucket: b,
        count: files.length,
        rows: expected.rows,
        verified,
        error
      });
    }

    const regeneratedToken =
      sourceIt.getContinuationToken();

    const committedIt = DriveApp.continueFileIterator(
      s.iteratorToken
    );

    const regeneratedIt = DriveApp.continueFileIterator(
      regeneratedToken
    );

    const nextCommitted = [];
    const nextRegenerated = [];

    for (let i = 0; i < 3; i++) {
      const a = committedIt.hasNext();
      const b = regeneratedIt.hasNext();

      if (a !== b) {
        throw Error('V1282_BOUNDARY_AVAILABILITY_MISMATCH');
      }

      if (!a) break;

      const f1 = committedIt.next();
      const f2 = regeneratedIt.next();
      const x1 = validateIndex(f1);
      const x2 = validateIndex(f2);

      nextCommitted.push({
        id: f1.getId(),
        rows: x1.rows,
        hash: x1.payloadHash
      });

      nextRegenerated.push({
        id: f2.getId(),
        rows: x2.rows,
        hash: x2.payloadHash
      });
    }

    const boundaryMatch =
      JSON.stringify(nextCommitted) ===
      JSON.stringify(nextRegenerated);

    const noReplay = nextCommitted.every(
      x => !sourceIds.includes(x.id)
    );

    const verifiedCount = artifacts.filter(
      x => x.verified
    ).length;

    const verifiedRows = artifacts.reduce(
      (n, x) => n + (x.verified ? x.rows : 0),
      0
    );

    const checkpointMathValid =
      s.fileCursor === j.cursor + j.files &&
      s.chunk === j.chunk + 1 &&
      s.rows - j.rows === 354801;

    // Final durable-state check.
    qboPg276CheckState_(c);

    const passed =
      checkpointMathValid &&
      sourceIdsMatch &&
      reconstructedRows === 2500 &&
      verifiedCount === 16 &&
      verifiedRows === 2500 &&
      boundaryMatch &&
      noReplay &&
      nextCommitted.length === 3;

    const out = {
      version: '1.5.282',
      readOnly: true,
      status: passed
        ? 'FINALIZATION_PREFLIGHT_PASSED'
        : 'BLOCKED_FINALIZATION_REVIEW',
      checkpoint: {
        status: s.status,
        cursor: s.fileCursor,
        rows: s.rows,
        chunk: s.chunk,
        checkpointMathValid
      },
      source: {
        fileCount: sourceIds.length,
        rows: reconstructedRows,
        sourceIdsMatch
      },
      artifacts: {
        verified: verifiedCount,
        expected: 16,
        verifiedRows,
        failures: artifacts.filter(x => !x.verified)
      },
      iterator: {
        tokenStringsMatch:
          regeneratedToken === s.iteratorToken,
        boundaryMatch,
        noReplay,
        committedNext: nextCommitted,
        regeneratedNext: nextRegenerated,
        independentManifestOrderVerified: false
      },
      controls: {
        journalPresent: !!c.raw,
        leasePresent: !!s.lease,
        triggerCount: qboPg274Triggers_().length
      },
      proposedFinalization: {
        deletePendingJournal: true,
        preserveCheckpointCursor: 801,
        preserveCheckpointRows: 357301,
        preserveCheckpointChunk: 86,
        createWorkerTrigger: false,
        resumeWorker: false
      },
      mutationPerformed: false
    };

    console.log(
      '[PHASE G V1282] | READ_ONLY | ' +
      JSON.stringify(out)
    );

    return out;
  });
}
