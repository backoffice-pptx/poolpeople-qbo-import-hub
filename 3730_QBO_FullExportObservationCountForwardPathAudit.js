/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3730_QBO_FullExportObservationCountForwardPathAudit.js
 * Purpose     : Read-only Phase C validation of the proposed FULL_EXPORT
 *               ObservationCount forward acquisition handoff.
 *
 * Public API:
 *   - auditQboFullExportObservationCountForwardPath()
 *
 * Architecture:
 *   - Uses the latest COMPLETE run-history-backed FULL_EXPORT for each manifest
 *     export key that has exact MasterBackup lineage.
 *   - Resolves entitySheetName from QBO_EXPORT_MANIFEST.
 *   - Derives candidate ObservationCount only from the exact immutable
 *     MasterBackup entity sheet (header excluded).
 *   - Reconciles the exact FULL_EXPORT source registration in 01_Sources when
 *     present, without writing either workbook.
 *   - Existing ObservationCount cells are expected to be blank at v1.5.143;
 *     any populated value is checked against the independently derived count.
 *   - No exporter, run-history, 01, trigger, Script Property, payload, or State
 *     Application writes are performed.
 *
 * Version     : 1.5.143
 * Date        : 2026-09-16
 * ============================================================================
 */

const QBO_FULL_EXPORT_OBS_FORWARD_AUDIT_ = Object.freeze({
  VERSION: '1.5.143',
  RUN_HISTORY_OBSERVATION_HEADER: 'ObservationCount',
  SOURCE_OBSERVATION_HEADER: 'ObservationCount'
});

function auditQboFullExportObservationCountForwardPath() {
  const runHistory = getQboRunHistorySpreadsheet_();
  const stateCapture = getQboStateCaptureSpreadsheet_();
  const exportSheet = runHistory.getSheetByName(QBO_RUN_HISTORY.EXPORTS_SHEET);
  const sourceSheet = stateCapture.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);

  if (!exportSheet) throw new Error('Missing run-history Exports sheet.');
  if (!sourceSheet) throw new Error('Missing 01_Sources sheet.');

  const history = qboFullExportObsAuditReadTable_(exportSheet);
  const sources = qboFullExportObsAuditReadTable_(sourceSheet);
  const requiredHistory = [
    'RunId','ExportKey','ExportFunction','CompletedAt','Status',
    'MasterBackupFileId','MasterBackupFileName','ObservationCount'
  ];
  const requiredSources = [
    'SourceId','SourceRunId','ExportKey','ExportFunction',
    'MasterBackupFileId','MasterBackupFileName','ObservationCount'
  ];
  qboFullExportObsAuditRequireHeaders_(history.headerMap, requiredHistory, exportSheet.getName());
  qboFullExportObsAuditRequireHeaders_(sources.headerMap, requiredSources, sourceSheet.getName());

  const sourceById = Object.create(null);
  sources.rows.forEach(function(row) {
    const id = String(row[sources.headerMap.SourceId] || '').trim();
    if (id) sourceById[id] = row;
  });

  const manifest = getQboExportManifest();
  const rows = [];
  const findings = [];
  let totalDerivedObservationCount = 0;
  let sourcePresentCount = 0;
  let sourceMissingCount = 0;

  manifest.forEach(function(entry) {
    const candidate = qboFullExportObsAuditLatestComplete_(history, entry.key);
    if (!candidate) {
      findings.push(entry.key + ':NO_COMPLETE_HISTORY_WITH_MASTER_BACKUP');
      rows.push({exportKey:entry.key, valid:false, reason:'NO_COMPLETE_HISTORY_WITH_MASTER_BACKUP'});
      return;
    }

    const runId = String(candidate[history.headerMap.RunId] || '').trim();
    const historyFunction = String(candidate[history.headerMap.ExportFunction] || '').trim();
    const fileId = String(candidate[history.headerMap.MasterBackupFileId] || '').trim();
    const fileName = String(candidate[history.headerMap.MasterBackupFileName] || '').trim();
    const sourceId = buildQboFullExportSourceId_(runId, entry.key);
    const localFindings = [];

    if (historyFunction !== entry.exportFunctionName) {
      localFindings.push('EXPORT_FUNCTION_MISMATCH');
    }
    if (!entry.entitySheetName || entry.sheetNames.indexOf(entry.entitySheetName) < 0) {
      localFindings.push('INVALID_ENTITY_SHEET_CONTRACT');
    }

    let derivedCount = null;
    let actualFileName = '';
    try {
      const file = DriveApp.getFileById(fileId);
      actualFileName = file.getName();
      if (actualFileName !== fileName) localFindings.push('MASTER_BACKUP_NAME_MISMATCH');
      const backup = SpreadsheetApp.openById(fileId);
      const entitySheet = backup.getSheetByName(entry.entitySheetName);
      if (!entitySheet) {
        localFindings.push('ENTITY_SHEET_MISSING_FROM_MASTER_BACKUP');
      } else {
        derivedCount = Math.max(0, entitySheet.getLastRow() - 1);
        if (!Number.isFinite(derivedCount) || derivedCount < 0 || Math.floor(derivedCount) !== derivedCount) {
          localFindings.push('INVALID_DERIVED_OBSERVATION_COUNT');
        }
      }
    } catch (err) {
      localFindings.push('MASTER_BACKUP_READ_FAILED:' + String(err && err.message ? err.message : err));
    }

    const historyCountRaw = candidate[history.headerMap.ObservationCount];
    const historyCountPresent = historyCountRaw !== '' && historyCountRaw !== null;
    if (historyCountPresent && derivedCount !== null && Number(historyCountRaw) !== derivedCount) {
      localFindings.push('HISTORY_OBSERVATION_COUNT_MISMATCH');
    }

    const sourceRow = sourceById[sourceId] || null;
    let sourceCountPresent = false;
    let sourceCountRaw = '';
    if (sourceRow) {
      sourcePresentCount += 1;
      const sourceRunId = String(sourceRow[sources.headerMap.SourceRunId] || '').trim();
      const sourceExportKey = String(sourceRow[sources.headerMap.ExportKey] || '').trim();
      const sourceFunction = String(sourceRow[sources.headerMap.ExportFunction] || '').trim();
      const sourceFileId = String(sourceRow[sources.headerMap.MasterBackupFileId] || '').trim();
      const sourceFileName = String(sourceRow[sources.headerMap.MasterBackupFileName] || '').trim();
      if (sourceRunId !== runId) localFindings.push('SOURCE_RUN_ID_MISMATCH');
      if (sourceExportKey !== entry.key) localFindings.push('SOURCE_EXPORT_KEY_MISMATCH');
      if (sourceFunction !== historyFunction) localFindings.push('SOURCE_EXPORT_FUNCTION_MISMATCH');
      if (sourceFileId !== fileId) localFindings.push('SOURCE_MASTER_BACKUP_ID_MISMATCH');
      if (sourceFileName !== fileName) localFindings.push('SOURCE_MASTER_BACKUP_NAME_MISMATCH');
      sourceCountRaw = sourceRow[sources.headerMap.ObservationCount];
      sourceCountPresent = sourceCountRaw !== '' && sourceCountRaw !== null;
      if (sourceCountPresent && derivedCount !== null && Number(sourceCountRaw) !== derivedCount) {
        localFindings.push('SOURCE_OBSERVATION_COUNT_MISMATCH');
      }
    } else {
      sourceMissingCount += 1;
    }

    if (derivedCount !== null) totalDerivedObservationCount += derivedCount;
    localFindings.forEach(function(f) { findings.push(entry.key + ':' + f); });
    rows.push({
      exportKey: entry.key,
      runId: runId,
      entitySheetName: entry.entitySheetName,
      masterBackupFileId: fileId,
      masterBackupFileName: fileName,
      derivedObservationCount: derivedCount,
      historyObservationCountPresent: historyCountPresent,
      historyObservationCount: historyCountPresent ? Number(historyCountRaw) : null,
      sourceId: sourceId,
      sourcePresent: !!sourceRow,
      sourceObservationCountPresent: sourceCountPresent,
      sourceObservationCount: sourceCountPresent ? Number(sourceCountRaw) : null,
      valid: localFindings.length === 0,
      findings: localFindings
    });
  });

  const result = {
    version: QBO_FULL_EXPORT_OBS_FORWARD_AUDIT_.VERSION,
    operation: 'READ_ONLY_FORWARD_PATH_AUDIT',
    exportCount: manifest.length,
    validatedExportCount: rows.filter(function(r){ return r.valid; }).length,
    sourcePresentCount: sourcePresentCount,
    sourceMissingCount: sourceMissingCount,
    totalDerivedObservationCount: totalDerivedObservationCount,
    historyPopulatedObservationCountRows: rows.filter(function(r){ return r.historyObservationCountPresent; }).length,
    sourcePopulatedObservationCountRows: rows.filter(function(r){ return r.sourceObservationCountPresent; }).length,
    rows: rows,
    findings: findings,
    valid: findings.length === 0 && rows.length === manifest.length
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) {
    throw new Error('FULL_EXPORT ObservationCount forward-path audit failed. No writes performed.');
  }
  return result;
}

function qboFullExportObsAuditReadTable_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  const values = lastRow > 0 && lastColumn > 0
    ? sheet.getRange(1, 1, lastRow, lastColumn).getValues()
    : [];
  const headers = values.length ? values[0].map(function(v){ return String(v || '').trim(); }) : [];
  const headerMap = Object.create(null);
  headers.forEach(function(h, i){ if (h) headerMap[h] = i; });
  return {headers:headers, headerMap:headerMap, rows:values.slice(1)};
}

function qboFullExportObsAuditRequireHeaders_(headerMap, required, sheetName) {
  const missing = required.filter(function(h){ return headerMap[h] === undefined; });
  if (missing.length) {
    throw new Error(sheetName + ' missing required headers: ' + missing.join(', '));
  }
}

function qboFullExportObsAuditLatestComplete_(history, exportKey) {
  const m = history.headerMap;
  let best = null;
  let bestTime = -1;
  history.rows.forEach(function(row) {
    if (String(row[m.ExportKey] || '').trim() !== exportKey) return;
    if (String(row[m.Status] || '').trim() !== 'COMPLETE') return;
    if (!String(row[m.MasterBackupFileId] || '').trim()) return;
    if (!String(row[m.MasterBackupFileName] || '').trim()) return;
    const raw = row[m.CompletedAt];
    const t = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
    const normalized = Number.isFinite(t) ? t : 0;
    if (!best || normalized >= bestTime) {
      best = row;
      bestTime = normalized;
    }
  });
  return best;
}
