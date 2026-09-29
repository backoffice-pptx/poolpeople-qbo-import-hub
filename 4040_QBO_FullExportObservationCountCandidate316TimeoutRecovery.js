/**
 * Module  : 4040_QBO_FullExportObservationCountCandidate316TimeoutRecovery.js
 * Version : 1.5.161
 * Purpose : Controlled checkpoint recovery for the v1.5.159 Spreadsheet
 *           timeout at candidate 316 after the source write committed.
 *
 * Operator:
 *   recoverQboFullExportObservationCountCandidate316TimeoutV161()
 *
 * SAFETY:
 *   - no production target cell write;
 *   - no source lineage rewrite;
 *   - no trigger mutation;
 *   - advances only the persisted apply checkpoint after exact re-verification.
 */
function recoverQboFullExportObservationCountCandidate316TimeoutV161() {
  const C = QBO_FE_OBS_HIST_APPLY_;
  const p = PropertiesService.getScriptProperties();
  let st = JSON.parse(p.getProperty(C.APPLY_STATE_KEY) || 'null');
  if (!st) throw new Error('Apply state missing.');

  const EXPECTED_RUN = 'FE_OBS_HIST_APPLY_6051dd21-ae18-4bf5-827f-3588e04b761d';
  const EXPECTED_ERROR_PREFIX = 'Service Spreadsheets timed out while accessing document with id ';

  if (st.applyRunId !== EXPECTED_RUN ||
      st.status !== 'FAILED' ||
      Number(st.cursor) !== 316 ||
      Number(st.historyWrites) !== 314 ||
      Number(st.sourceWrites) !== 308 ||
      Number(st.historyAlreadyMatches) !== 1 ||
      Number(st.sourceAlreadyMatches) !== 1 ||
      Number(st.controlledTestMissingSourceExclusions) !== 2 ||
      Number(st.strandedRunMissingSourceExclusions) !== 2 ||
      Number(st.strandedRunLineageConflictExclusions) !== 3 ||
      String(st.error || '').indexOf(EXPECTED_ERROR_PREFIX) !== 0) {
    throw new Error('Persisted apply state does not match the exact governed candidate-316 timeout recovery precondition.');
  }

  qboFeObsApplyRequireDailyPaused_();

  const rr = p.getProperty(C.PREVIEW_RESULT_PREFIX + st.previewRunId + '_316');
  if (!rr) throw new Error('Frozen candidate 316 missing.');
  const r = JSON.parse(rr);
  const frozenRun = qboFeObsApplyFrozenRunId_(r);

  if (String(r.kind || '') !== 'FULL_EXPORT_LEGACY' ||
      String(r.exportKey || '') !== 'PAYMENT_METHODS' ||
      String(r.sourceDisposition || '') !== 'PROPOSE_WRITE' ||
      Number(r.sourceRow) !== 3 ||
      Number(r.derivedObservationCount) !== 55) {
    throw new Error('Candidate 316 frozen identity/disposition no longer matches the diagnosed timeout candidate.');
  }

  const ss = qboFeObsApplyOpenStateCapture_().getSheetByName(C.SOURCE_SHEET);
  if (!ss) throw new Error('01_Sources missing.');
  const sm = qboFeObsApplyHeaderMap_(ss);
  qboFeObsApplyRequire_(sm, ['SourceId','SourceRunId','ExportKey','MasterBackupFileId','MasterBackupFileName','ObservationCount'], C.SOURCE_SHEET);

  const rows = qboFeObsApplyFindSourceRows_(ss, sm, r.sourceId);
  if (rows.length !== 1) throw new Error('Candidate 316 source cardinality changed.');
  const sr = rows[0];

  if (sr.rowNumber !== Number(r.sourceRow) ||
      sr.SourceRunId !== frozenRun ||
      sr.ExportKey !== String(r.exportKey || '')) {
    throw new Error('Candidate 316 source core identity changed.');
  }
  if (sr.MasterBackupFileId !== String(r.masterBackupFileId || '') ||
      sr.MasterBackupFileName !== String(r.masterBackupFileName || '')) {
    throw new Error('Candidate 316 source lineage changed.');
  }
  if (qboFeObsApplyNullable_(sr.ObservationCount) !== Number(r.derivedObservationCount)) {
    throw new Error('Candidate 316 committed ObservationCount is not intact.');
  }

  // The v1.5.159 worker timed out after the cell write committed but before
  // sourceWrites++ and cursor checkpoint. Account for that one committed write
  // exactly once, then move to the next candidate. No target cell is rewritten.
  st.version = '1.5.161';
  st.status = 'RUNNING';
  st.cursor = 317;
  st.sourceWrites = 309;
  st.error = null;
  st.failedAt = null;
  st.lastProgressAt = new Date().toISOString();

  const priorRecovery = st.recoveredFrom || null;
  st.timeoutRecovery = {
    version: '1.5.161',
    recoveredAt: new Date().toISOString(),
    failedCursor: 316,
    candidate: 316,
    exportKey: 'PAYMENT_METHODS',
    sourceRow: 3,
    committedObservationCount: 55,
    productionTargetWritePerformedByRecovery: false,
    sourceWriteCounterReconciled: true,
    checkpointAdvancedTo: 317
  };
  if (priorRecovery) st.recoveredFrom = priorRecovery;

  p.setProperty(C.APPLY_STATE_KEY, JSON.stringify(st));
  console.log(JSON.stringify(st, null, 2));
  return st;
}
