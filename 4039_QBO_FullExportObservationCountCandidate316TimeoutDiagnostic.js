/**
 * Module  : 4039_QBO_FullExportObservationCountCandidate316TimeoutDiagnostic.js
 * Version : 1.5.160
 * Purpose : Read-only diagnostic for the v1.5.159 Spreadsheet service timeout
 *           at frozen candidate 316.
 *
 * Operator:
 *   diagnoseQboFullExportObservationCountCandidate316TimeoutV160()
 *
 * SAFETY: No target writes, no checkpoint mutation, no trigger mutation.
 */
function diagnoseQboFullExportObservationCountCandidate316TimeoutV160() {
  const C = QBO_FE_OBS_HIST_APPLY_;
  const p = PropertiesService.getScriptProperties();
  const st = JSON.parse(p.getProperty(C.APPLY_STATE_KEY) || 'null');
  if (!st) throw new Error('Apply state missing.');

  const EXPECTED_RUN = 'FE_OBS_HIST_APPLY_6051dd21-ae18-4bf5-827f-3588e04b761d';
  const EXPECTED_ERROR_PREFIX = 'Service Spreadsheets timed out while accessing document with id ';

  if (st.applyRunId !== EXPECTED_RUN ||
      st.status !== 'FAILED' ||
      Number(st.cursor) !== 316 ||
      String(st.error || '').indexOf(EXPECTED_ERROR_PREFIX) !== 0) {
    throw new Error('Persisted apply state is not the exact candidate-316 timeout state.');
  }

  qboFeObsApplyRequireDailyPaused_();

  const rr = p.getProperty(C.PREVIEW_RESULT_PREFIX + st.previewRunId + '_316');
  if (!rr) throw new Error('Frozen candidate 316 missing.');
  const r = JSON.parse(rr);
  const frozenRun = qboFeObsApplyFrozenRunId_(r);

  const hs = qboFeObsApplyOpenRunHistory_().getSheetByName(C.HISTORY_SHEET);
  const ss = qboFeObsApplyOpenStateCapture_().getSheetByName(C.SOURCE_SHEET);
  if (!hs || !ss) throw new Error('Required target sheet missing.');

  const hm = qboFeObsApplyHeaderMap_(hs);
  const sm = qboFeObsApplyHeaderMap_(ss);
  qboFeObsApplyRequire_(hm, ['RunId','ExportKey','Status','MasterBackupFileId','MasterBackupFileName','ObservationCount'], C.HISTORY_SHEET);
  qboFeObsApplyRequire_(sm, ['SourceId','SourceRunId','ExportKey','MasterBackupFileId','MasterBackupFileName','ObservationCount'], C.SOURCE_SHEET);

  let history = null;
  if (r.kind === 'RUN_HISTORY') {
    const hr = qboFeObsApplyReadRow_(hs, Number(r.historyRow), hm);
    history = {
      rowNumber: Number(r.historyRow),
      RunId: String(hr.RunId || '').trim(),
      ExportKey: String(hr.ExportKey || '').trim(),
      Status: String(hr.Status || '').trim(),
      MasterBackupFileId: String(hr.MasterBackupFileId || '').trim(),
      MasterBackupFileName: String(hr.MasterBackupFileName || '').trim(),
      ObservationCount: qboFeObsApplyNullable_(hr.ObservationCount),
      identityMatchesFrozen:
        String(hr.RunId || '').trim() === frozenRun &&
        String(hr.ExportKey || '').trim() === String(r.exportKey || '') &&
        String(hr.Status || '').trim().toUpperCase() === 'COMPLETE' &&
        String(hr.MasterBackupFileId || '').trim() === String(r.masterBackupFileId || '') &&
        String(hr.MasterBackupFileName || '').trim() === String(r.masterBackupFileName || '')
    };
  }

  const rows = qboFeObsApplyFindSourceRows_(ss, sm, r.sourceId);
  const source = rows.map(function(sr) {
    return {
      rowNumber: sr.rowNumber,
      SourceRunId: sr.SourceRunId,
      ExportKey: sr.ExportKey,
      MasterBackupFileId: sr.MasterBackupFileId,
      MasterBackupFileName: sr.MasterBackupFileName,
      ObservationCount: qboFeObsApplyNullable_(sr.ObservationCount),
      coreIdentityMatchesFrozen:
        sr.rowNumber === Number(r.sourceRow) &&
        sr.SourceRunId === frozenRun &&
        sr.ExportKey === String(r.exportKey || ''),
      lineageMatchesFrozen:
        sr.MasterBackupFileId === String(r.masterBackupFileId || '') &&
        sr.MasterBackupFileName === String(r.masterBackupFileName || '')
    };
  });

  const out = {
    version: '1.5.160',
    operation: 'READ_ONLY_CANDIDATE_316_TIMEOUT_DIAGNOSTIC',
    applyState: {
      version: st.version,
      applyRunId: st.applyRunId,
      previewRunId: st.previewRunId,
      cursor: st.cursor,
      status: st.status,
      historyWrites: st.historyWrites,
      sourceWrites: st.sourceWrites,
      historyAlreadyMatches: st.historyAlreadyMatches,
      sourceAlreadyMatches: st.sourceAlreadyMatches,
      controlledTestMissingSourceExclusions: st.controlledTestMissingSourceExclusions,
      strandedRunMissingSourceExclusions: st.strandedRunMissingSourceExclusions,
      strandedRunLineageConflictExclusions: st.strandedRunLineageConflictExclusions,
      error: st.error,
      failedAt: st.failedAt
    },
    frozenCandidate316: {
      kind: r.kind,
      runId: frozenRun,
      exportKey: String(r.exportKey || ''),
      sourceId: String(r.sourceId || ''),
      historyRow: r.historyRow,
      sourceRow: r.sourceRow,
      historyDisposition: r.historyDisposition,
      sourceDisposition: r.sourceDisposition,
      masterBackupFileId: String(r.masterBackupFileId || ''),
      masterBackupFileName: String(r.masterBackupFileName || ''),
      derivedObservationCount: Number(r.derivedObservationCount)
    },
    physicalHistory: history,
    physicalSourceCardinality: source.length,
    physicalSource: source,
    interpretation: {
      historyExpectedCount: Number(r.derivedObservationCount),
      sourceExpectedCount: Number(r.derivedObservationCount),
      sourceWriteMayHaveCommittedBeforeTimeout:
        source.length === 1 &&
        source[0].coreIdentityMatchesFrozen &&
        source[0].lineageMatchesFrozen &&
        source[0].ObservationCount === Number(r.derivedObservationCount),
      sourceStillBlank:
        source.length === 1 && source[0].ObservationCount === null
    },
    safety: {
      productionTargetWrites: false,
      checkpointMutation: false,
      triggerMutation: false
    }
  };

  console.log(JSON.stringify(out, null, 2));
  return out;
}
