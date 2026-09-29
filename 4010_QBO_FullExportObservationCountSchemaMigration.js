/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 4010_QBO_FullExportObservationCountSchemaMigration.js
 * Purpose     : Controlled Phase C schema migration and read-only validation
 *               for FULL_EXPORT ObservationCount acquisition authority.
 *
 * Public API:
 *   - previewQboFullExportObservationCountSchemaMigration()
 *   - applyQboFullExportObservationCountSchemaMigration()
 *   - auditQboFullExportEntitySheetContract()
 *
 * Architecture:
 *   - QBO_ExportRunHistory/QBO_ExportRunHistory is the durable acquisition
 *     authority for run-history-backed FULL_EXPORT sources.
 *   - ObservationCount is appended as column L on the Exports history sheet.
 *   - ObservationCount is appended as column T on 01_Sources.
 *   - This module does NOT backfill counts and does NOT change the forward
 *     exporter completion path. Existing rows remain blank after schema apply.
 *   - entitySheetName in QBO_EXPORT_MANIFEST is the governed entity dataset;
 *     sheetNames[0] is not the semantic authority.
 *   - Populated sheets are changed only when their existing header contract is
 *     an exact recognized predecessor. Unknown/conflicting schemas fail closed.
 *
 * Version     : 1.5.142
 * Date        : 2026-09-16
 * ============================================================================
 */

const QBO_FULL_EXPORT_OBS_COUNT_MIGRATION_ = Object.freeze({
  VERSION: '1.5.142',
  RUN_HISTORY_TARGET_HEADER: 'ObservationCount',
  SOURCE_TARGET_HEADER: 'ObservationCount',
  RUN_HISTORY_CURRENT_HEADERS: Object.freeze([
    'RunId','Position','ExportKey','ExportFunction','StartedAt','CompletedAt',
    'Status','DurationMs','Error','MasterBackupFileId','MasterBackupFileName'
  ]),
  SOURCE_CURRENT_HEADERS: Object.freeze([
    'SourceId','SourceAcquisitionType','SourceRunId','ExportKey','ExportFunction',
    'ObservationStartedAt','ObservationCompletedAt','MasterBackupFileId',
    'MasterBackupFileName','SourceLineageBasis','SourceScopeType','SourceScopeStart',
    'SourceScopeEnd','SourceScopeComplete','SourceStatus','RegisteredAt','ProcessedAt',
    'ProcessingStatus','ProcessingError'
  ])
});

/** Read-only. Validates both target sheets and reports whether schema apply is safe. */
function previewQboFullExportObservationCountSchemaMigration() {
  const runHistory = getQboRunHistorySpreadsheet_();
  const stateCapture = getQboStateCaptureSpreadsheet_();

  const result = {
    version: QBO_FULL_EXPORT_OBS_COUNT_MIGRATION_.VERSION,
    operation: 'PREVIEW_ONLY',
    manifest: qboFullExportObsAuditManifest_(),
    runHistory: qboFullExportObsInspectAppend_(
      runHistory.getSheetByName(QBO_RUN_HISTORY.EXPORTS_SHEET),
      QBO_FULL_EXPORT_OBS_COUNT_MIGRATION_.RUN_HISTORY_CURRENT_HEADERS,
      QBO_FULL_EXPORT_OBS_COUNT_MIGRATION_.RUN_HISTORY_TARGET_HEADER
    ),
    sources01: qboFullExportObsInspectAppend_(
      stateCapture.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES),
      QBO_FULL_EXPORT_OBS_COUNT_MIGRATION_.SOURCE_CURRENT_HEADERS,
      QBO_FULL_EXPORT_OBS_COUNT_MIGRATION_.SOURCE_TARGET_HEADER
    )
  };

  result.valid = result.manifest.valid && result.runHistory.safe && result.sources01.safe;
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) {
    throw new Error('FULL_EXPORT ObservationCount schema preview failed. No writes performed.');
  }
  return result;
}

/**
 * Controlled schema-only write. Appends the two headers when and only when the
 * recognized predecessor schema is exact. Does not populate historical rows.
 */
function applyQboFullExportObservationCountSchemaMigration() {
  const preview = previewQboFullExportObservationCountSchemaMigration();
  if (!preview.valid) {
    throw new Error('ObservationCount schema apply blocked by invalid preview.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(QBO_STATE_CAPTURE.EXECUTION_LOCK_TIMEOUT_MS);
  try {
    const runHistory = getQboRunHistorySpreadsheet_();
    const stateCapture = getQboStateCaptureSpreadsheet_();

    const runResult = qboFullExportObsApplyAppend_(
      runHistory.getSheetByName(QBO_RUN_HISTORY.EXPORTS_SHEET),
      QBO_FULL_EXPORT_OBS_COUNT_MIGRATION_.RUN_HISTORY_CURRENT_HEADERS,
      QBO_FULL_EXPORT_OBS_COUNT_MIGRATION_.RUN_HISTORY_TARGET_HEADER
    );
    const sourceResult = qboFullExportObsApplyAppend_(
      stateCapture.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES),
      QBO_FULL_EXPORT_OBS_COUNT_MIGRATION_.SOURCE_CURRENT_HEADERS,
      QBO_FULL_EXPORT_OBS_COUNT_MIGRATION_.SOURCE_TARGET_HEADER
    );

    const post = {
      version: QBO_FULL_EXPORT_OBS_COUNT_MIGRATION_.VERSION,
      operation: 'SCHEMA_APPLY',
      runHistory: runResult,
      sources01: sourceResult,
      valid: runResult.valid && sourceResult.valid
    };
    console.log(JSON.stringify(post, null, 2));
    if (!post.valid) {
      throw new Error('ObservationCount schema post-write validation failed.');
    }
    return post;
  } finally {
    lock.releaseLock();
  }
}

/** Read-only manifest/entity-sheet audit. */
function auditQboFullExportEntitySheetContract() {
  const result = qboFullExportObsAuditManifest_();
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) {
    throw new Error('FULL_EXPORT entitySheetName contract audit failed.');
  }
  return result;
}

function qboFullExportObsAuditManifest_() {
  const manifest = getQboExportManifest();
  const findings = [];
  const rows = manifest.map(function(entry) {
    const entitySheetName = String(entry.entitySheetName || '').trim();
    const owned = Array.isArray(entry.sheetNames) &&
      entry.sheetNames.indexOf(entitySheetName) !== -1;
    if (!entitySheetName) {
      findings.push(entry.key + ':MISSING_ENTITY_SHEET_NAME');
    } else if (!owned) {
      findings.push(entry.key + ':ENTITY_SHEET_NOT_OWNED:' + entitySheetName);
    }
    return {
      exportKey: entry.key,
      entityName: entry.entityName,
      entitySheetName: entitySheetName,
      sheetCount: entry.sheetNames.length,
      entitySheetOwned: owned
    };
  });
  return {
    valid: findings.length === 0,
    exportCount: rows.length,
    rows: rows,
    findings: findings
  };
}

function qboFullExportObsInspectAppend_(sheet, predecessorHeaders, targetHeader) {
  if (!sheet) {
    return {safe:false, valid:false, reason:'MISSING_SHEET'};
  }
  const width = predecessorHeaders.length;
  const actual = sheet.getRange(1, 1, 1, width + 1).getValues()[0];
  const findings = [];
  predecessorHeaders.forEach(function(expected, index) {
    if (actual[index] !== expected) {
      findings.push(
        'HEADER_MISMATCH_COL_' + (index + 1) + ':expected=' + expected +
        ':actual=' + String(actual[index] || '')
      );
    }
  });
  const next = String(actual[width] || '').trim();
  if (next && next !== targetHeader) {
    findings.push('TARGET_COLUMN_CONFLICT:actual=' + next);
  }
  return {
    safe: findings.length === 0,
    valid: findings.length === 0,
    sheetName: sheet.getName(),
    dataRowCount: Math.max(0, sheet.getLastRow() - 1),
    predecessorWidth: width,
    targetColumn: width + 1,
    targetHeader: targetHeader,
    targetAlreadyPresent: next === targetHeader,
    action: next === targetHeader ? 'NO_OP_ALREADY_MIGRATED' : 'APPEND_HEADER_ONLY',
    findings: findings
  };
}

function qboFullExportObsApplyAppend_(sheet, predecessorHeaders, targetHeader) {
  const before = qboFullExportObsInspectAppend_(sheet, predecessorHeaders, targetHeader);
  if (!before.safe) {
    throw new Error(
      'Refusing ObservationCount schema migration on ' +
      (sheet ? sheet.getName() : '(missing sheet)') + ': ' +
      before.findings.join('; ')
    );
  }
  if (!before.targetAlreadyPresent) {
    sheet.getRange(1, predecessorHeaders.length + 1).setValue(targetHeader);
    sheet.setFrozenRows(1);
  }
  const after = qboFullExportObsInspectAppend_(sheet, predecessorHeaders, targetHeader);
  return {
    valid: after.safe && after.targetAlreadyPresent,
    sheetName: after.sheetName,
    changed: !before.targetAlreadyPresent,
    targetColumn: after.targetColumn,
    targetHeader: after.targetHeader,
    dataRowCount: after.dataRowCount,
    findings: after.findings
  };
}
