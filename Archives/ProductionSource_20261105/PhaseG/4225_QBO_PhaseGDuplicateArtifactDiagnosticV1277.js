
function inspectQboPhaseGDuplicateArtifactsV1277() {
  const s = qboPg274S_();
  const p = qboPg274P_();
  const raw = p.getProperty(QBO_PG274_.KEY + '_JOURNAL');
  const j = raw ? JSON.parse(raw) : null;

  if (!s || s.status !== 'HALTED_REVIEW_REQUIRED' ||
      !j || j.phase !== 'STAGING' ||
      j.cursor !== s.fileCursor ||
      j.chunk !== s.chunk ||
      s.lease || qboPg274Triggers_().length !== 0) {
    throw Error('V1277_UNSAFE_OR_CHANGED_STATE');
  }

  const bucket = 0;
  const name = 'chunk_' + ('000000' + j.chunk).slice(-6) + '.json';
  const dir = qboPg274Folder_(s, bucket);
  const it = dir.getFilesByName(name);
  const files = [];

  while (it.hasNext()) {
    const f = it.next();
    const result = {
      id: f.getId(),
      name: f.getName(),
      size: f.getSize(),
      createdAt: f.getDateCreated().toISOString(),
      updatedAt: f.getLastUpdated().toISOString()
    };

    try {
      const rawContent = f.getBlob().getDataAsString();
      result.readLength = rawContent.length;

      const x = JSON.parse(rawContent);
      result.jsonValid = true;
      result.version = x.version;
      result.bucket = x.bucket;
      result.chunk = x.chunk;
      result.rows = x.rows;
      result.entriesCount = Array.isArray(x.entries)
        ? x.entries.length : null;
      result.hashValid = Array.isArray(x.entries) &&
        qboPg274Hash_(x.entries) === x.hash;
    } catch (e) {
      result.jsonValid = false;
      result.error = String(e);
    }

    files.push(result);
  }

  const out = {
    status: s.status,
    committedCursor: s.fileCursor,
    pendingChunk: j.chunk,
    journalRows: j.rows,
    bucket,
    matchingFileCount: files.length,
    files
  };

  console.log('[PHASE G V1277] | READ_ONLY | ' +
              JSON.stringify(out));
  return out;
}
