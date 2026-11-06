/**
 * Phase G V1274 CHECKING-phase rearm, specific to the observed Nov 5, 2026
 * halted checkpoint. Does not restart staging or modify bucket evidence.
 * One-time guarded operator action; never scheduled automatically.
 */
function rearmQboPhaseGCheckingV1277() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw Error('V1277_LOCK_BUSY');
  try {
    const p = qboPg274P_();
    const s = qboPg274S_();
    if (!s || s.version !== QBO_PG274_.V || s.status !== 'HALTED_REVIEW_REQUIRED' ||
        s.lease || p.getProperty(QBO_PG274_.KEY + '_JOURNAL') ||
        qboPg274Triggers_().length !== 0) throw Error('V1277_NOT_QUIESCENT_HALTED');
    if (s.fileCursor !== 2418 || s.rows !== 734858 || s.chunk !== 250 ||
        s.bucketCursor !== 14 || s.checkedRows !== 643511 || s.duplicates !== 0 ||
        !Array.isArray(s.bucketFolders) || s.bucketFolders.length !== 16 ||
        !s.auditFolderId || !s.indexFolderId) throw Error('V1277_CHECKPOINT_MISMATCH');
    // Revalidate upstream authority before restoring execution.
    const authority = qboPg274Gate_();
    if (authority.indexFolderId !== s.indexFolderId) throw Error('V1277_INDEX_CHANGED');
    // Verify the previously committed bucket 13 evidence is still readable.
    const root = DriveApp.getFolderById(s.auditFolderId);
    const prior = qboPg274File_(root, 'verified_bucket_13.json');
    if (!prior) throw Error('V1277_PRIOR_EVIDENCE_MISSING');
    const evidence = JSON.parse(prior.getBlob().getDataAsString());
    if (evidence.version !== QBO_PG274_.V || evidence.bucket !== 13 ||
        evidence.chunks !== s.chunk || !Number.isInteger(evidence.rows) ||
        evidence.rows < 0 || evidence.duplicates !== 0) throw Error('V1277_PRIOR_EVIDENCE_INVALID');
    // Re-read state before mutation; no change is permitted since validation.
    const current = qboPg274S_();
    if (!current || JSON.stringify(current) !== JSON.stringify(s) ||
        p.getProperty(QBO_PG274_.KEY + '_JOURNAL') || qboPg274Triggers_().length)
      throw Error('V1277_CONCURRENT_CHANGE');
    // Create trigger first; if creation fails, the halted checkpoint remains intact.
    const trigger = ScriptApp.newTrigger(QBO_PG274_.HANDLER)
      .timeBased().everyMinutes(5).create();
    try {
      if (qboPg274Triggers_().length !== 1) throw Error('V1277_TRIGGER_COUNT');
      const updated = Object.assign({}, s, {
        status: 'CHECKING',
        updatedAt: new Date().toISOString(),
        checkingRecoveryVersion: '1.5.277',
        checkingRecoveredAt: new Date().toISOString()
      });
      qboPg274Save_(updated);
    } catch (e) {
      ScriptApp.deleteTrigger(trigger);
      throw e;
    }
    const out = {
      status: 'CHECKING', bucketCursor: 14, checkedRows: 643511,
      fileCursor: 2418, rows: 734858, triggerCount: qboPg274Triggers_().length
    };
    console.log('[PHASE G CHECKING V1277] | REARMED | ' + JSON.stringify(out));
    return out;
  } finally {
    lock.releaseLock();
  }
}
