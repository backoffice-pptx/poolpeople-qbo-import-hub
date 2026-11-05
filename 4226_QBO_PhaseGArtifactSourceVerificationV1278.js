
/**
 * V1278 — Read-only verification of V1274 chunk 85, bucket 0.
 * No checkpoint, journal, artifact, or trigger mutations.
 */
function verifyQboPhaseGDuplicateSourceV1278() {
  return qboPg276Lock_(() => {
    const c = qboPg276Context_();

    if (
      c.phase !== 'PRECOMMIT' ||
      c.j.cursor !== 791 ||
      c.j.chunk !== 85 ||
      c.j.files !== 10 ||
      c.j.rows !== 2500 ||
      c.s.rows !== 354801
    ) {
      throw Error('V1278_UNEXPECTED_CHECKPOINT_OR_JOURNAL');
    }

    // Reconstruct pending chunk from immutable V1271 index.
    const r = qboPg276Reconstruct_(c);
    const expectedRows = r.rows[0];
    const expectedHash = qboPg274Hash_(expectedRows);

    const dir = qboPg274Folder_(c.s, 0);
    const name = 'chunk_000085.json';
    const it = dir.getFilesByName(name);

    const results = [];

    while (it.hasNext()) {
      const f = it.next();
      const result = {
        fileId: f.getId(),
        size: f.getSize(),
        valid: false,
        exactSourceMatch: false
      };

      const raw = f.getBlob().getDataAsString();

      if (raw.length === 0) {
        result.classification = 'EMPTY_ARTIFACT';
      } else {
        try {
          const x = JSON.parse(raw);

          const metadataMatch =
            x.version === QBO_PG274_.V &&
            x.bucket === 0 &&
            x.chunk === 85 &&
            x.rows === expectedRows.length &&
            Array.isArray(x.entries) &&
            x.entries.length === expectedRows.length &&
            x.hash === expectedHash;

          const payloadMatch =
            Array.isArray(x.entries) &&
            JSON.stringify(x.entries) ===
              JSON.stringify(expectedRows);

          result.valid = metadataMatch && payloadMatch;
          result.exactSourceMatch = payloadMatch;
          result.classification = result.valid
            ? 'SOURCE_VERIFIED'
            : 'SOURCE_MISMATCH';
        } catch (e) {
          result.classification = 'INVALID_JSON';
          result.error = String(e);
        }
      }

      results.push(result);
    }

    // Recheck durable state before reporting a verdict.
    qboPg276CheckState_(c);

    const sourceRows = r.rows.reduce(
      (sum, rows) => sum + rows.length, 0
    );

    const valid = results.filter(
      x => x.classification === 'SOURCE_VERIFIED'
    );

    const empty = results.filter(
      x => x.classification === 'EMPTY_ARTIFACT'
    );

    const passed =
      sourceRows === 2500 &&
      results.length === 2 &&
      valid.length === 1 &&
      empty.length === 1 &&
      expectedRows.length === 137 &&
      results.every(x =>
        x.classification === 'SOURCE_VERIFIED' ||
        x.classification === 'EMPTY_ARTIFACT'
      );

    const out = {
      version: '1.5.278',
      readOnly: true,
      status: passed
        ? 'SOURCE_VERIFIED_QUARANTINE_CANDIDATE'
        : 'BLOCKED_REVIEW_REQUIRED',
      committedCursor: c.s.fileCursor,
      pendingChunk: c.j.chunk,
      reconstructedRows: sourceRows,
      bucket0ExpectedRows: expectedRows.length,
      bucket0ExpectedHash: expectedHash,
      artifactCount: results.length,
      artifacts: results,
      mutationPerformed: false
    };

    console.log(
      '[PHASE G V1278] | READ_ONLY | ' +
      JSON.stringify(out)
    );

    return out;
  });
}
