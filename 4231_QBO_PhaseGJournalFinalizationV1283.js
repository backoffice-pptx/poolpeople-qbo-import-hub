
/**
 * V1283 — One-time, journal-only recovery finalization.
 *
 * Authorized mutation:
 *   Delete QBO_PG274_.KEY + '_JOURNAL' only.
 *
 * No checkpoint writes, artifact writes, trigger changes,
 * status changes, or worker restart.
 */
function finalizeQboPhaseGJournalV1283() {
  return qboPg276Lock_(() => {
    const c = qboPg276Context_();
    const s = c.s;
    const j = c.j;
    const journalKey = QBO_PG274_.KEY + '_JOURNAL';

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
      JSON.stringify(s.recoveryJournal) !==
        JSON.stringify(j) ||
      !s.recoveryIteratorTokenBefore ||
      !s.iteratorToken ||
      !Array.isArray(s.recoverySourceFileIds) ||
      s.recoverySourceFileIds.length !== 10 ||
      s.lease ||
      qboPg274Triggers_().length !== 0
    ) {
      throw Error('V1283_STATE_GATE_FAILED');
    }

    const sourceIt = DriveApp.continueFileIterator(
      s.recoveryIteratorTokenBefore
    );

    const rows = Array.from({ length: 16 }, () => []);
    const ids = [];

    function readIndex(f) {
      const x = JSON.parse(f.getBlob().getDataAsString());

      if (
        x.version !== '1.5.271' ||
        !Array.isArray(x.entries) ||
        x.rows !== x.entries.length ||
        qboPg271Hash_(JSON.stringify(x.entries)) !==
          x.payloadHash
      ) {
        throw Error('V1283_SOURCE_INVALID ' + f.getId());
      }

      return x;
    }

    for (let i = 0; i < j.files; i++) {
      if (!sourceIt.hasNext()) {
        throw Error('V1283_SOURCE_EXHAUSTED');
      }

      const f = sourceIt.next();
      const x = readIndex(f);

      ids.push(f.getId());

      for (const e of x.entries) {
        if (
          !Array.isArray(e) ||
          e.length !== 3 ||
          typeof e[0] !== 'string' ||
          !e[0]
        ) {
          throw Error('V1283_SOURCE_ENTRY_INVALID');
        }

        rows[qboPg274Bucket_(e[0])].push([
          e[0],
          f.getId(),
          e[2]
        ]);
      }
    }

    const sourceRows = rows.reduce(
      (n, x) => n + x.length, 0
    );

    if (
      sourceRows !== 2500 ||
      JSON.stringify(ids) !==
        JSON.stringify(s.recoverySourceFileIds)
    ) {
      throw Error('V1283_SOURCE_SEQUENCE_MISMATCH');
    }

    // Independently verify all 16 committed artifacts.
    let verifiedRows = 0;

    for (let b = 0; b < 16; b++) {
      const dir = qboPg274Folder_(s, b);
      const it = dir.getFilesByName('chunk_000085.json');

      if (!it.hasNext()) {
        throw Error('V1283_ARTIFACT_MISSING ' + b);
      }

      const f = it.next();

      if (it.hasNext()) {
        throw Error('V1283_ARTIFACT_DUPLICATE ' + b);
      }

      const expected = {
        version: QBO_PG274_.V,
        bucket: b,
        chunk: 85,
        rows: rows[b].length,
        hash: qboPg274Hash_(rows[b]),
        entries: rows[b]
      };

      qboPg274Check_(f, expected);

      const actual = JSON.parse(
        f.getBlob().getDataAsString()
      );

      if (
        JSON.stringify(actual.entries) !==
        JSON.stringify(expected.entries)
      ) {
        throw Error('V1283_ARTIFACT_PAYLOAD_MISMATCH ' + b);
      }

      verifiedRows += expected.rows;
    }

    if (verifiedRows !== 2500) {
      throw Error('V1283_ARTIFACT_ROW_TOTAL_MISMATCH');
    }

    // Verify the committed continuation token against a
    // regenerated token using the next three source files.
    const regeneratedToken =
      sourceIt.getContinuationToken();

    const committedIt = DriveApp.continueFileIterator(
      s.iteratorToken
    );

    const regeneratedIt = DriveApp.continueFileIterator(
      regeneratedToken
    );

    const historicalIds = new Set(ids);
    const nextIds = [];

    for (let i = 0; i < 3; i++) {
      if (
        !committedIt.hasNext() ||
        !regeneratedIt.hasNext()
      ) {
        throw Error('V1283_BOUNDARY_EXHAUSTED');
      }

      const a = committedIt.next();
      const b = regeneratedIt.next();
      const xa = readIndex(a);
      const xb = readIndex(b);

      if (
        a.getId() !== b.getId() ||
        xa.rows !== xb.rows ||
        xa.payloadHash !== xb.payloadHash ||
        historicalIds.has(a.getId()) ||
        nextIds.includes(a.getId())
      ) {
        throw Error('V1283_ITERATOR_BOUNDARY_MISMATCH');
      }

      nextIds.push(a.getId());
    }

    if (
      s.fileCursor !== j.cursor + j.files ||
      s.chunk !== j.chunk + 1 ||
      s.rows - j.rows !== 354801
    ) {
      throw Error('V1283_CHECKPOINT_MATH_FAILED');
    }

    // Verify that checkpoint and journal have not changed.
    qboPg276CheckState_(c);

    const fresh = qboPg274S_();

    if (
      JSON.stringify(fresh) !== JSON.stringify(s) ||
      c.p.getProperty(journalKey) !== c.raw
    ) {
      throw Error('V1283_DURABLE_STATE_CHANGED');
    }

    // Preserve the exact journal and recovery evidence in
    // the execution log BEFORE the authorized deletion.
    const evidence = {
      version: '1.5.283',
      operation: 'JOURNAL_ONLY_FINALIZATION',
      checkpointCursor: s.fileCursor,
      checkpointRows: s.rows,
      checkpointChunk: s.chunk,
      journalKey,
      journalRaw: c.raw,
      recoveryVersion: s.recoveryVersion,
      recoverySourceFileIds: ids,
      verifiedArtifacts: 16,
      verifiedRows,
      nextSourceFileIds: nextIds,
      independentManifestOrderVerified: false,
      checkpointMutationAuthorized: false,
      triggerMutationAuthorized: false,
      workerResumeAuthorized: false
    };

    console.log(
      '[PHASE G V1283] | PRE_DELETE_VERIFIED | ' +
      JSON.stringify(evidence)
    );

    // The single authorized production mutation.
    c.p.deleteProperty(journalKey);

    if (c.p.getProperty(journalKey) !== null) {
      throw Error('V1283_JOURNAL_DELETE_READBACK_FAILED');
    }

    const after = qboPg274S_();

    if (
      JSON.stringify(after) !== JSON.stringify(s) ||
      qboPg274Triggers_().length !== 0
    ) {
      throw Error('V1283_POST_DELETE_STATE_MISMATCH');
    }

    const out = {
      version: '1.5.283',
      status: 'JOURNAL_FINALIZATION_VERIFIED',
      journalRemoved: true,
      checkpointUnchanged: true,
      cursor: after.fileCursor,
      rows: after.rows,
      chunk: after.chunk,
      operationalStatus: after.status,
      verifiedArtifacts: 16,
      verifiedRows: 2500,
      leasePresent: !!after.lease,
      triggerCount: 0,
      workerResumed: false,
      artifactMutations: 0,
      checkpointMutations: 0
    };

    console.log(
      '[PHASE G V1283] | COMPLETE | ' +
      JSON.stringify(out)
    );

    return out;
  });
}

