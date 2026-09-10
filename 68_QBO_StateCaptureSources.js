/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 68_QBO_StateCaptureSources.js
 * Purpose     : Provision the canonical QBO State Capture workbook and
 *               idempotently register eligible FULL_EXPORT acquisitions from
 *               QBO_ExportRunHistory plus controlled pre-run-history Master
 *               Backup evidence.
 *
 * Public API:
 *   - provisionQboStateCaptureWorkbook()
 *   - testQboStateCaptureConfiguration()
 *   - auditQboFullExportSourceRegistration()
 *   - registerQboFullExportSources()
 *   - auditQboLegacyFullExportSourceRegistration()
 *   - registerQboLegacyFullExportSources()
 *
 * Internal production integration:
 *   - registerQboCompletedFullExportSource_(runId, exportKey)
 *     registers only the just-completed scheduled FULL_EXPORT after durable
 *     QBO_ExportRunHistory completion has been recorded.
 *
 * Architecture:
 *   - QBO_ExportRunHistory remains authoritative acquisition history.
 *   - 01_Sources is a State Capture processing/control ledger only.
 *   - Run-history SourceId: FULL_EXPORT|<RunId>|<ExportKey>.
 *   - Legacy SourceId: FULL_EXPORT_LEGACY|<MasterBackupFileId>|<ExportKey>.
 *   - Legacy registration is limited to Master Backups created before the
 *     earliest QBO_ExportRunHistory StartedAt and never manufactures RunIds.
 *   - Registration never changes the underlying export/run-history records.
 *   - A State Capture processing failure never implies the QBO export failed.
 * ============================================================================
 */

function provisionQboStateCaptureWorkbook() {
  const lock = LockService.getScriptLock();
  lock.waitLock(QBO_STATE_CAPTURE.EXECUTION_LOCK_TIMEOUT_MS);

  try {
    const props = PropertiesService.getScriptProperties();
    let spreadsheetId = String(
      props.getProperty(SCRIPT_PROPERTY_KEYS.STATE_CAPTURE_SPREADSHEET_ID) || ''
    ).trim();
    let spreadsheet;
    let created = false;

    if (spreadsheetId) {
      spreadsheet = SpreadsheetApp.openById(spreadsheetId);
      validateQboStateCaptureWorkbookLocation_(spreadsheet);
    } else {
      const folder = resolveQboCapturedStatesFolder_();
      spreadsheet = SpreadsheetApp.create(QBO_STATE_CAPTURE.WORKBOOK_TITLE);
      spreadsheetId = spreadsheet.getId();
      DriveApp.getFileById(spreadsheetId).moveTo(folder);
      props.setProperty(
        SCRIPT_PROPERTY_KEYS.STATE_CAPTURE_SPREADSHEET_ID,
        spreadsheetId
      );
      created = true;
    }

    initializeQboStateCaptureWorkbook_(spreadsheet);
    validateQboStateCaptureWorkbookLocation_(spreadsheet);

    console.log(
      '[STATE CAPTURE] | PROVISIONED | created=' + created +
      ' | workbook=' + spreadsheet.getName() +
      ' | spreadsheetId=' + spreadsheetId
    );

    return spreadsheetId;
  } finally {
    lock.releaseLock();
  }
}

function testQboStateCaptureConfiguration() {
  const spreadsheet = getQboStateCaptureSpreadsheet_();
  validateQboStateCaptureWorkbookStructure_(spreadsheet);
  validateQboStateCaptureWorkbookLocation_(spreadsheet);

  console.log(
    '[STATE CAPTURE] | CONFIG OK | workbook=' + spreadsheet.getName() +
    ' | spreadsheetId=' + spreadsheet.getId() +
    ' | version=' + QBO_STATE_CAPTURE.VERSION
  );
}



/**
 * Registers exactly one completed, run-history-backed FULL_EXPORT source.
 *
 * This is the production handoff used by the scheduled export controller after
 * recordQboScheduledExportResult_() has durably marked the exact exporter row
 * COMPLETE and linked its Master Backup. It deliberately re-reads
 * QBO_ExportRunHistory instead of trusting in-memory exporter metadata, so
 * State Capture cannot get ahead of the authoritative acquisition history.
 *
 * Idempotent: an already-registered SourceId is treated as success/no-op.
 * State Capture failure is intentionally separate from QBO export success; the
 * scheduler calls this through a non-throwing wrapper.
 *
 * @param {string} runId Scheduled FULL_EXPORT RunId.
 * @param {string} exportKey Stable manifest ExportKey.
 * @return {Object} Registration result.
 */
function registerQboCompletedFullExportSource_(runId, exportKey) {
  const normalizedRunId = String(runId || '').trim();
  const normalizedExportKey = String(exportKey || '').trim();

  if (!normalizedRunId || !normalizedExportKey) {
    throw new Error(
      'Automatic State Capture registration requires runId and exportKey.'
    );
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(QBO_STATE_CAPTURE.EXECUTION_LOCK_TIMEOUT_MS);

  try {
    const stateSpreadsheet = getQboStateCaptureSpreadsheet_();
    validateQboStateCaptureWorkbookStructure_(stateSpreadsheet);
    validateQboStateCaptureWorkbookLocation_(stateSpreadsheet);

    const runHistory = getQboRunHistorySpreadsheet_();
    validateQboRunHistoryWorkbookStructure_(runHistory);

    const exportSheet = runHistory.getSheetByName(QBO_RUN_HISTORY.EXPORTS_SHEET);
    const sourceSheet = stateSpreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
    const rowNumber = findQboExportRunRow_(
      exportSheet,
      normalizedRunId,
      normalizedExportKey
    );

    if (!rowNumber) {
      throw new Error(
        'Automatic State Capture registration cannot locate QBO_ExportRunHistory row' +
        ' for runId=' + normalizedRunId + ', export=' + normalizedExportKey + '.'
      );
    }

    const row = exportSheet.getRange(
      rowNumber,
      1,
      1,
      QBO_RUN_HISTORY_HEADERS_.EXPORTS.length
    ).getValues()[0];

    const status = String(row[6] || '').trim();
    const historyExportFunction = String(row[3] || '').trim();
    const masterBackupFileId = String(row[9] || '').trim();
    const masterBackupFileName = String(row[10] || '').trim();

    if (status !== 'COMPLETE') {
      throw new Error(
        'Automatic State Capture registration requires COMPLETE run history; found ' +
        (status || '(blank)') + ' for runId=' + normalizedRunId +
        ', export=' + normalizedExportKey + '.'
      );
    }

    if (!masterBackupFileId || !masterBackupFileName) {
      throw new Error(
        'Automatic State Capture registration requires exact Master Backup lineage' +
        ' for runId=' + normalizedRunId + ', export=' + normalizedExportKey + '.'
      );
    }

    const manifestEntry = getQboExportManifestEntry_(normalizedExportKey);
    if (!manifestEntry) {
      throw new Error(
        'Automatic State Capture registration found unknown export key: ' +
        normalizedExportKey + '.'
      );
    }

    if (manifestEntry.exportFunctionName !== historyExportFunction) {
      throw new Error(
        'Automatic State Capture registration export-function mismatch for ' +
        normalizedExportKey + '. Expected ' + manifestEntry.exportFunctionName +
        ', found ' + historyExportFunction + '.'
      );
    }

    const backupValidation = validateQboMasterBackupReference_(
      masterBackupFileId,
      masterBackupFileName
    );
    if (!backupValidation.valid) {
      throw new Error(
        'Automatic State Capture registration rejected Master Backup for ' +
        normalizedExportKey + ': ' + backupValidation.reason + '.'
      );
    }

    const sourceId = buildQboFullExportSourceId_(
      normalizedRunId,
      normalizedExportKey
    );
    const existingSourceIds = loadQboExistingStateCaptureSourceIds_(sourceSheet);

    if (existingSourceIds[sourceId]) {
      console.log(
        '[STATE CAPTURE SOURCES] | AUTO REGISTER | status=ALREADY_REGISTERED' +
        ' | runId=' + normalizedRunId +
        ' | export=' + normalizedExportKey +
        ' | sourceId=' + sourceId
      );
      return {
        sourceId: sourceId,
        registered: false,
        alreadyRegistered: true
      };
    }

    const scope = getQboStateCaptureFullExportScope_(normalizedExportKey);
    sourceSheet.getRange(
      sourceSheet.getLastRow() + 1,
      1,
      1,
      QBO_STATE_CAPTURE_HEADERS.SOURCES.length
    ).setValues([[
      sourceId,
      QBO_STATE_CAPTURE.SOURCE_ACQUISITION_TYPE,
      normalizedRunId,
      normalizedExportKey,
      historyExportFunction,
      row[4] || '',
      row[5] || '',
      masterBackupFileId,
      masterBackupFileName,
      QBO_STATE_CAPTURE.LINEAGE_BASIS_RUN_HISTORY,
      scope.sourceScopeType,
      scope.sourceScopeStart,
      scope.sourceScopeEnd,
      scope.sourceScopeComplete,
      QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE,
      new Date(),
      '',
      QBO_STATE_CAPTURE.PROCESSING_STATUS_UNPROCESSED,
      ''
    ]]);
    applyQboStateCaptureSheetLayout_(sourceSheet);

    console.log(
      '[STATE CAPTURE SOURCES] | AUTO REGISTER | status=REGISTERED' +
      ' | runId=' + normalizedRunId +
      ' | export=' + normalizedExportKey +
      ' | sourceId=' + sourceId +
      ' | masterBackup=' + masterBackupFileName
    );

    return {
      sourceId: sourceId,
      registered: true,
      alreadyRegistered: false
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Non-throwing production wrapper. A State Capture registration failure must
 * remain visible in logs but must never retroactively turn a successful QBO
 * export into an exporter failure.
 */
function safeRegisterQboCompletedFullExportSource_(runId, exportKey) {
  try {
    return registerQboCompletedFullExportSource_(runId, exportKey);
  } catch (error) {
    console.error(
      '[STATE CAPTURE SOURCES] | AUTO REGISTER ERROR' +
      ' | runId=' + (runId || '') +
      ' | export=' + (exportKey || '') +
      ' | error=' + (error && error.message ? error.message : String(error))
    );
    return null;
  }
}

function auditQboFullExportSourceRegistration() {
  return processQboFullExportSourceRegistration_(false);
}

function registerQboFullExportSources() {
  return processQboFullExportSourceRegistration_(true);
}

function processQboFullExportSourceRegistration_(applyChanges) {
  const lock = LockService.getScriptLock();
  lock.waitLock(QBO_STATE_CAPTURE.EXECUTION_LOCK_TIMEOUT_MS);

  const startedAt = new Date();
  const captureRunId = Utilities.getUuid();
  const operation = applyChanges ? 'REGISTER_FULL_EXPORT_SOURCES' : 'AUDIT_FULL_EXPORT_SOURCES';
  let summary = null;

  try {
    const stateSpreadsheet = getQboStateCaptureSpreadsheet_();
    validateQboStateCaptureWorkbookStructure_(stateSpreadsheet);
    validateQboStateCaptureWorkbookLocation_(stateSpreadsheet);

    const runHistory = getQboRunHistorySpreadsheet_();
    validateQboRunHistoryWorkbookStructure_(runHistory);

    const exportSheet = runHistory.getSheetByName(QBO_RUN_HISTORY.EXPORTS_SHEET);
    const sourceSheet = stateSpreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);

    const existingSourceIds = loadQboExistingStateCaptureSourceIds_(sourceSheet);
    const manifestByKey = Object.create(null);
    getQboExportManifest().forEach(function(entry) {
      manifestByKey[entry.key] = entry;
    });

    const lastRow = exportSheet.getLastRow();
    const values = lastRow > 1
      ? exportSheet.getRange(
          2,
          1,
          lastRow - 1,
          QBO_RUN_HISTORY_HEADERS_.EXPORTS.length
        ).getValues()
      : [];

    const sourceRowsToAppend = [];
    const skippedDetails = [];
    let eligibleSources = 0;
    let alreadyRegistered = 0;

    values.forEach(function(row, index) {
      const sourceRowNumber = index + 2;
      const runId = String(row[0] || '').trim();
      const exportKey = String(row[2] || '').trim();
      const exportFunction = String(row[3] || '').trim();
      const status = String(row[6] || '').trim();
      const masterBackupFileId = String(row[9] || '').trim();
      const masterBackupFileName = String(row[10] || '').trim();

      if (status !== 'COMPLETE' || !masterBackupFileId || !masterBackupFileName) {
        return;
      }

      const manifestEntry = manifestByKey[exportKey];
      if (!manifestEntry) {
        skippedDetails.push({
          row: sourceRowNumber,
          runId: runId,
          exportKey: exportKey,
          reason: 'UNKNOWN_EXPORT_KEY'
        });
        return;
      }

      if (manifestEntry.exportFunctionName !== exportFunction) {
        skippedDetails.push({
          row: sourceRowNumber,
          runId: runId,
          exportKey: exportKey,
          reason: 'EXPORT_FUNCTION_MISMATCH',
          actual: exportFunction,
          expected: manifestEntry.exportFunctionName
        });
        return;
      }

      const backupValidation = validateQboMasterBackupReference_(
        masterBackupFileId,
        masterBackupFileName
      );
      if (!backupValidation.valid) {
        skippedDetails.push({
          row: sourceRowNumber,
          runId: runId,
          exportKey: exportKey,
          reason: backupValidation.reason
        });
        return;
      }

      eligibleSources += 1;
      const sourceId = buildQboFullExportSourceId_(runId, exportKey);
      if (existingSourceIds[sourceId]) {
        alreadyRegistered += 1;
        return;
      }

      const scope = getQboStateCaptureFullExportScope_(exportKey);
      sourceRowsToAppend.push([
        sourceId,
        QBO_STATE_CAPTURE.SOURCE_ACQUISITION_TYPE,
        runId,
        exportKey,
        exportFunction,
        row[4] || '',
        row[5] || '',
        masterBackupFileId,
        masterBackupFileName,
        QBO_STATE_CAPTURE.LINEAGE_BASIS_RUN_HISTORY,
        scope.sourceScopeType,
        scope.sourceScopeStart,
        scope.sourceScopeEnd,
        scope.sourceScopeComplete,
        QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE,
        applyChanges ? new Date() : '',
        '',
        QBO_STATE_CAPTURE.PROCESSING_STATUS_UNPROCESSED,
        ''
      ]);
    });

    if (applyChanges && sourceRowsToAppend.length > 0) {
      sourceSheet.getRange(
        sourceSheet.getLastRow() + 1,
        1,
        sourceRowsToAppend.length,
        QBO_STATE_CAPTURE_HEADERS.SOURCES.length
      ).setValues(sourceRowsToAppend);
      applyQboStateCaptureSheetLayout_(sourceSheet);
    }

    summary = {
      version: QBO_STATE_CAPTURE.VERSION,
      mode: applyChanges ? 'APPLY' : 'AUDIT',
      sourceRowsScanned: values.length,
      eligibleSources: eligibleSources,
      alreadyRegistered: alreadyRegistered,
      registeredSources: applyChanges ? sourceRowsToAppend.length : 0,
      wouldRegister: applyChanges ? 0 : sourceRowsToAppend.length,
      skippedSources: skippedDetails.length,
      actionRequired: skippedDetails.length > 0,
      skippedDetails: skippedDetails
    };

    appendQboStateCaptureRunLog_(stateSpreadsheet, [
      captureRunId,
      startedAt,
      new Date(),
      operation,
      skippedDetails.length > 0 ? 'COMPLETE_WITH_SKIPS' : 'COMPLETE',
      values.length,
      eligibleSources,
      alreadyRegistered,
      applyChanges ? sourceRowsToAppend.length : 0,
      skippedDetails.length,
      skippedDetails.length > 0 ? JSON.stringify(skippedDetails) : ''
    ]);

    console.log('[STATE CAPTURE SOURCES] | ' + summary.mode + ' | ' + JSON.stringify(summary, null, 2));
    return summary;
  } catch (error) {
    try {
      const spreadsheet = getQboStateCaptureSpreadsheet_();
      appendQboStateCaptureRunLog_(spreadsheet, [
        captureRunId,
        startedAt,
        new Date(),
        operation,
        'FAILED',
        '', '', '', '', '',
        error && error.message ? error.message : String(error)
      ]);
    } catch (ignored) {
      // Preserve the original failure. Logging failure is secondary.
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}


function auditQboLegacyFullExportSourceRegistration() {
  return processQboLegacyFullExportSourceRegistration_(false);
}

function registerQboLegacyFullExportSources() {
  return processQboLegacyFullExportSourceRegistration_(true);
}

function processQboLegacyFullExportSourceRegistration_(applyChanges) {
  const lock = LockService.getScriptLock();
  lock.waitLock(QBO_STATE_CAPTURE.EXECUTION_LOCK_TIMEOUT_MS);

  const startedAt = new Date();
  const captureRunId = Utilities.getUuid();
  const operation = applyChanges
    ? 'REGISTER_LEGACY_FULL_EXPORT_SOURCES'
    : 'AUDIT_LEGACY_FULL_EXPORT_SOURCES';

  try {
    const stateSpreadsheet = getQboStateCaptureSpreadsheet_();
    validateQboStateCaptureWorkbookStructure_(stateSpreadsheet);
    validateQboStateCaptureWorkbookLocation_(stateSpreadsheet);

    const runHistory = getQboRunHistorySpreadsheet_();
    validateQboRunHistoryWorkbookStructure_(runHistory);

    const exportSheet = runHistory.getSheetByName(QBO_RUN_HISTORY.EXPORTS_SHEET);
    const sourceSheet = stateSpreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
    const existingSourceIds = loadQboExistingStateCaptureSourceIds_(sourceSheet);

    const historyWidth = QBO_RUN_HISTORY_HEADERS_.EXPORTS.length;
    const historyValues = exportSheet.getLastRow() > 1
      ? exportSheet.getRange(
          2,
          1,
          exportSheet.getLastRow() - 1,
          historyWidth
        ).getValues()
      : [];

    const cutoff = getQboLegacyFullExportCutoff_(historyValues);
    const linkedBackupIds = Object.create(null);
    historyValues.forEach(function(row) {
      const backupId = String(row[9] || '').trim();
      if (backupId) {
        linkedBackupIds[backupId] = true;
      }
    });

    const manifest = getQboExportManifest();
    const sourceWorkbookNameByKey = Object.create(null);
    manifest.forEach(function(entry) {
      const spreadsheetId = getExportSpreadsheetId_(entry.sheetNames[0]);
      sourceWorkbookNameByKey[entry.key] =
        DriveApp.getFileById(spreadsheetId).getName();
    });

    const backupFolder = getQboExportSnapshotFolder_();
    const files = backupFolder.getFiles();
    const candidates = [];
    let backupFilesScanned = 0;

    while (files.hasNext()) {
      const file = files.next();
      backupFilesScanned += 1;

      const createdAt = file.getDateCreated();
      const createdMs = createdAt && createdAt.getTime();
      if (!Number.isFinite(createdMs) || createdMs >= cutoff.getTime()) {
        continue;
      }

      const fileId = file.getId();
      if (linkedBackupIds[fileId]) {
        continue;
      }

      candidates.push({
        fileId: fileId,
        fileName: file.getName(),
        createdAt: createdAt
      });
    }

    candidates.sort(function(a, b) {
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    const sourceRowsToAppend = [];
    const skippedDetails = [];
    let eligibleSources = 0;
    let alreadyRegistered = 0;

    candidates.forEach(function(candidate) {
      const matches = manifest.filter(function(entry) {
        const workbookName = sourceWorkbookNameByKey[entry.key];
        return qboLegacyMasterBackupNameMatches_(
          candidate.fileName,
          workbookName
        );
      });

      if (matches.length === 0) {
        skippedDetails.push({
          masterBackupFileId: candidate.fileId,
          masterBackupFileName: candidate.fileName,
          masterBackupCreatedAt: candidate.createdAt,
          reason: 'UNRECOGNIZED_LEGACY_MASTER_BACKUP_NAME'
        });
        return;
      }

      if (matches.length > 1) {
        skippedDetails.push({
          masterBackupFileId: candidate.fileId,
          masterBackupFileName: candidate.fileName,
          masterBackupCreatedAt: candidate.createdAt,
          reason: 'AMBIGUOUS_LEGACY_MASTER_BACKUP_NAME',
          matchingExportKeys: matches.map(function(entry) {
            return entry.key;
          })
        });
        return;
      }

      const entry = matches[0];
      const backupValidation = validateQboMasterBackupReference_(
        candidate.fileId,
        candidate.fileName
      );
      if (!backupValidation.valid) {
        skippedDetails.push({
          masterBackupFileId: candidate.fileId,
          masterBackupFileName: candidate.fileName,
          masterBackupCreatedAt: candidate.createdAt,
          exportKey: entry.key,
          reason: backupValidation.reason
        });
        return;
      }

      eligibleSources += 1;
      const sourceId = buildQboLegacyFullExportSourceId_(
        candidate.fileId,
        entry.key
      );

      if (existingSourceIds[sourceId]) {
        alreadyRegistered += 1;
        return;
      }

      const scope = getQboStateCaptureFullExportScope_(entry.key);
      sourceRowsToAppend.push([
        sourceId,
        QBO_STATE_CAPTURE.LEGACY_SOURCE_ACQUISITION_TYPE,
        '',
        entry.key,
        entry.exportFunctionName,
        '',
        candidate.createdAt,
        candidate.fileId,
        candidate.fileName,
        QBO_STATE_CAPTURE.LINEAGE_BASIS_PRE_RUN_HISTORY,
        scope.sourceScopeType,
        scope.sourceScopeStart,
        scope.sourceScopeEnd,
        scope.sourceScopeComplete,
        QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE,
        applyChanges ? new Date() : '',
        '',
        QBO_STATE_CAPTURE.PROCESSING_STATUS_UNPROCESSED,
        ''
      ]);
    });

    if (applyChanges && sourceRowsToAppend.length > 0) {
      sourceSheet.getRange(
        sourceSheet.getLastRow() + 1,
        1,
        sourceRowsToAppend.length,
        QBO_STATE_CAPTURE_HEADERS.SOURCES.length
      ).setValues(sourceRowsToAppend);
      applyQboStateCaptureSheetLayout_(sourceSheet);
    }

    const summary = {
      version: QBO_STATE_CAPTURE.VERSION,
      mode: applyChanges ? 'APPLY' : 'AUDIT',
      sourceAcquisitionType: QBO_STATE_CAPTURE.LEGACY_SOURCE_ACQUISITION_TYPE,
      lineageBasis: QBO_STATE_CAPTURE.LINEAGE_BASIS_PRE_RUN_HISTORY,
      legacyCutoff: cutoff,
      backupFolderId: backupFolder.getId(),
      backupFolderName: backupFolder.getName(),
      backupFilesScanned: backupFilesScanned,
      legacyCandidateFiles: candidates.length,
      eligibleSources: eligibleSources,
      alreadyRegistered: alreadyRegistered,
      registeredSources: applyChanges ? sourceRowsToAppend.length : 0,
      wouldRegister: applyChanges ? 0 : sourceRowsToAppend.length,
      skippedSources: skippedDetails.length,
      actionRequired: skippedDetails.length > 0,
      skippedDetails: skippedDetails
    };

    appendQboStateCaptureRunLog_(stateSpreadsheet, [
      captureRunId,
      startedAt,
      new Date(),
      operation,
      skippedDetails.length > 0 ? 'COMPLETE_WITH_SKIPS' : 'COMPLETE',
      backupFilesScanned,
      eligibleSources,
      alreadyRegistered,
      applyChanges ? sourceRowsToAppend.length : 0,
      skippedDetails.length,
      skippedDetails.length > 0 ? JSON.stringify(skippedDetails) : ''
    ]);

    console.log(
      '[STATE CAPTURE LEGACY SOURCES] | ' + summary.mode + ' | ' +
      JSON.stringify(summary, null, 2)
    );
    return summary;
  } catch (error) {
    try {
      const spreadsheet = getQboStateCaptureSpreadsheet_();
      appendQboStateCaptureRunLog_(spreadsheet, [
        captureRunId,
        startedAt,
        new Date(),
        operation,
        'FAILED',
        '', '', '', '', '',
        error && error.message ? error.message : String(error)
      ]);
    } catch (ignored) {
      // Preserve the original failure. Logging failure is secondary.
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function getQboLegacyFullExportCutoff_(historyValues) {
  let earliestMs = null;

  historyValues.forEach(function(row) {
    const startedAt = row[4];
    let ms = NaN;

    if (startedAt instanceof Date) {
      ms = startedAt.getTime();
    } else if (startedAt) {
      ms = new Date(startedAt).getTime();
    }

    if (Number.isFinite(ms) && (earliestMs === null || ms < earliestMs)) {
      earliestMs = ms;
    }
  });

  if (earliestMs === null) {
    throw new Error(
      'Cannot establish legacy FULL_EXPORT cutoff because ' +
      QBO_RUN_HISTORY.EXPORTS_SHEET + ' contains no valid StartedAt values.'
    );
  }

  return new Date(earliestMs);
}

function qboLegacyMasterBackupNameMatches_(fileName, sourceWorkbookName) {
  const normalizedFileName = String(fileName || '').trim();
  const normalizedWorkbookName = String(sourceWorkbookName || '').trim();

  if (!normalizedFileName || !normalizedWorkbookName) {
    return false;
  }

  const escaped = normalizedWorkbookName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + escaped + '_\\d{8}_\\d{6}$').test(normalizedFileName);
}

function buildQboLegacyFullExportSourceId_(masterBackupFileId, exportKey) {
  const normalizedFileId = String(masterBackupFileId || '').trim();
  const normalizedExportKey = String(exportKey || '').trim();

  if (!normalizedFileId || !normalizedExportKey) {
    throw new Error(
      'Cannot build legacy FULL_EXPORT SourceId without MasterBackupFileId and ExportKey.'
    );
  }

  return QBO_STATE_CAPTURE.LEGACY_SOURCE_ACQUISITION_TYPE +
    '|' + normalizedFileId + '|' + normalizedExportKey;
}

function buildQboFullExportSourceId_(runId, exportKey) {
  const normalizedRunId = String(runId || '').trim();
  const normalizedExportKey = String(exportKey || '').trim();
  if (!normalizedRunId || !normalizedExportKey) {
    throw new Error('Cannot build FULL_EXPORT SourceId without RunId and ExportKey.');
  }
  return 'FULL_EXPORT|' + normalizedRunId + '|' + normalizedExportKey;
}

function loadQboExistingStateCaptureSourceIds_(sourceSheet) {
  const result = Object.create(null);
  if (sourceSheet.getLastRow() <= 1) {
    return result;
  }

  sourceSheet.getRange(2, 1, sourceSheet.getLastRow() - 1, 1)
    .getValues()
    .forEach(function(row) {
      const sourceId = String(row[0] || '').trim();
      if (sourceId) {
        result[sourceId] = true;
      }
    });
  return result;
}

function validateQboMasterBackupReference_(fileId, expectedFileName) {
  try {
    const file = DriveApp.getFileById(fileId);
    if (file.getName() !== expectedFileName) {
      return { valid: false, reason: 'MASTER_BACKUP_NAME_MISMATCH' };
    }
    if (file.isTrashed()) {
      return { valid: false, reason: 'MASTER_BACKUP_TRASHED' };
    }
    return { valid: true, reason: '' };
  } catch (error) {
    return { valid: false, reason: 'MASTER_BACKUP_INACCESSIBLE' };
  }
}

function getQboStateCaptureSpreadsheet_() {
  const spreadsheetId = String(
    PropertiesService.getScriptProperties().getProperty(
      SCRIPT_PROPERTY_KEYS.STATE_CAPTURE_SPREADSHEET_ID
    ) || ''
  ).trim();

  if (!spreadsheetId) {
    throw new Error(
      'Missing ' + SCRIPT_PROPERTY_KEYS.STATE_CAPTURE_SPREADSHEET_ID +
      '. Run provisionQboStateCaptureWorkbook() first.'
    );
  }

  try {
    return SpreadsheetApp.openById(spreadsheetId);
  } catch (error) {
    throw new Error(
      'Unable to open QBO State Capture workbook ' + spreadsheetId +
      '. Original error: ' +
      (error && error.message ? error.message : String(error))
    );
  }
}

function initializeQboStateCaptureWorkbook_(spreadsheet) {
  const controlSheet = ensureQboStateCaptureSheet_(
    spreadsheet,
    QBO_STATE_CAPTURE.SHEETS.CONTROL,
    QBO_STATE_CAPTURE_HEADERS.CONTROL
  );
  ensureQboStateCaptureSheet_(
    spreadsheet,
    QBO_STATE_CAPTURE.SHEETS.SOURCES,
    QBO_STATE_CAPTURE_HEADERS.SOURCES
  );
  ensureQboStateCaptureSheet_(
    spreadsheet,
    QBO_STATE_CAPTURE.SHEETS.STATES,
    QBO_STATE_CAPTURE_HEADERS.STATES
  );
  ensureQboStateCaptureSheet_(
    spreadsheet,
    QBO_STATE_CAPTURE.SHEETS.RUN_LOG,
    QBO_STATE_CAPTURE_HEADERS.RUN_LOG
  );

  const controlValues = [
    ['SchemaVersion', QBO_STATE_CAPTURE.VERSION],
    ['WorkbookRole', 'CANONICAL_QBO_STATE_CAPTURE'],
    ['AuthoritativeFullExportAcquisitionHistory', QBO_RUN_HISTORY.EXPORTS_SHEET],
    ['FullExportSourceIdContract', 'FULL_EXPORT|<RunId>|<ExportKey>'],
    ['LegacyFullExportSourceIdContract', 'FULL_EXPORT_LEGACY|<MasterBackupFileId>|<ExportKey>'],
    ['LegacyFullExportLineageBasis', QBO_STATE_CAPTURE.LINEAGE_BASIS_PRE_RUN_HISTORY],
    ['LegacyObservationStartedAt', 'UNAVAILABLE'],
    ['LegacyObservationCompletedAtBasis', 'MASTER_BACKUP_DRIVE_CREATED_AT'],
    ['FullExportDefaultScope', QBO_STATE_CAPTURE.RAW_SCOPE_ALL_RETRIEVABLE],
    ['PreferencesScope', QBO_STATE_CAPTURE.PREFERENCES_SCOPE]
  ];

  upsertQboStateCaptureControlValues_(controlSheet, controlValues);

  spreadsheet.getSheets().forEach(function(sheet) {
    applyQboStateCaptureSheetLayout_(sheet);
  });
}

function ensureQboStateCaptureSheet_(spreadsheet, sheetName, headers) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    const sheets = spreadsheet.getSheets();
    if (
      sheets.length === 1 &&
      sheets[0].getLastRow() === 0 &&
      sheets[0].getLastColumn() === 0
    ) {
      sheet = sheets[0];
      sheet.setName(sheetName);
    } else {
      sheet = spreadsheet.insertSheet(sheetName);
    }
  }

  const existingWidth = Math.max(sheet.getLastColumn(), headers.length);
  const existing = sheet.getRange(1, 1, 1, existingWidth).getValues()[0];
  const matches = headers.every(function(header, index) {
    return existing[index] === header;
  });

  if (!matches) {
    const onlyHeaderRow = sheet.getLastRow() <= 1;
    const knownUpgrade =
      sheetName === QBO_STATE_CAPTURE.SHEETS.SOURCES &&
      onlyHeaderRow &&
      isQboStateCaptureV100SourcesHeader_(existing);

    const trulyBlank = onlyHeaderRow && !existing.some(function(value) {
      return String(value || '').trim() !== '';
    });

    if (!knownUpgrade && !trulyBlank) {
      throw new Error(
        'State Capture schema mismatch on ' + sheetName +
        '. Refusing to overwrite populated or unknown-schema content.'
      );
    }

    sheet.clearContents();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers.slice()]);
  }

  return sheet;
}

function isQboStateCaptureV100SourcesHeader_(existing) {
  const prior = [
    'SourceId',
    'SourceAcquisitionType',
    'SourceRunId',
    'ExportKey',
    'ExportFunction',
    'ObservationStartedAt',
    'ObservationCompletedAt',
    'MasterBackupFileId',
    'MasterBackupFileName',
    'SourceScopeType',
    'SourceScopeStart',
    'SourceScopeEnd',
    'SourceScopeComplete',
    'SourceStatus',
    'RegisteredAt',
    'ProcessedAt',
    'ProcessingStatus',
    'ProcessingError'
  ];

  return prior.every(function(header, index) {
    return existing[index] === header;
  }) && existing.slice(prior.length).every(function(value) {
    return String(value || '').trim() === '';
  });
}

function upsertQboStateCaptureControlValues_(sheet, controlValues) {
  const existing = Object.create(null);

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 2)
      .getValues()
      .forEach(function(row, index) {
        const key = String(row[0] || '').trim();
        if (key) {
          existing[key] = index + 2;
        }
      });
  }

  const rowsToAppend = [];
  controlValues.forEach(function(pair) {
    const key = pair[0];
    const value = pair[1];

    if (existing[key]) {
      sheet.getRange(existing[key], 2).setValue(value);
    } else {
      rowsToAppend.push([key, value]);
    }
  });

  if (rowsToAppend.length > 0) {
    sheet.getRange(
      sheet.getLastRow() + 1,
      1,
      rowsToAppend.length,
      2
    ).setValues(rowsToAppend);
  }
}

function validateQboStateCaptureWorkbookStructure_(spreadsheet) {
  const definitions = [
    [QBO_STATE_CAPTURE.SHEETS.CONTROL, QBO_STATE_CAPTURE_HEADERS.CONTROL],
    [QBO_STATE_CAPTURE.SHEETS.SOURCES, QBO_STATE_CAPTURE_HEADERS.SOURCES],
    [QBO_STATE_CAPTURE.SHEETS.STATES, QBO_STATE_CAPTURE_HEADERS.STATES],
    [QBO_STATE_CAPTURE.SHEETS.RUN_LOG, QBO_STATE_CAPTURE_HEADERS.RUN_LOG]
  ];

  definitions.forEach(function(definition) {
    const sheet = spreadsheet.getSheetByName(definition[0]);
    if (!sheet) {
      throw new Error('Missing State Capture sheet: ' + definition[0] + '.');
    }
    const actual = sheet.getRange(1, 1, 1, definition[1].length).getValues()[0];
    definition[1].forEach(function(expected, index) {
      if (actual[index] !== expected) {
        throw new Error(
          'State Capture header mismatch on ' + definition[0] +
          ' column ' + (index + 1) + '. Expected ' + expected +
          ', found ' + actual[index] + '.'
        );
      }
    });
  });
}

function applyQboStateCaptureSheetLayout_(sheet) {
  sheet.setFrozenRows(1);
  const lastRow = Math.max(sheet.getLastRow(), 1);
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  sheet.getRange(1, 1, lastRow, lastColumn)
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  if (lastRow > 1) {
    sheet.setRowHeights(2, lastRow - 1, EXPORT_LAYOUT.DATA_ROW_HEIGHT);
  }
}

function appendQboStateCaptureRunLog_(spreadsheet, row) {
  const sheet = spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.RUN_LOG);
  if (!sheet) {
    return;
  }
  sheet.appendRow(row);
  applyQboStateCaptureSheetLayout_(sheet);
}

function resolveQboCapturedStatesFolder_() {
  if (typeof DataPlatform05 === 'undefined' ||
      typeof DataPlatform05.getConfiguredAssetReference !== 'function') {
    throw new Error(
      'State Capture provisioning refused: Application 05 library DataPlatform05 ' +
      'is unavailable. Cannot resolve governed asset ' +
      QBO_STATE_CAPTURE.CAPTURED_STATES_FOLDER_ASSET_KEY + '.'
    );
  }

  let asset;
  try {
    asset = DataPlatform05.getConfiguredAssetReference(
      QBO_STATE_CAPTURE.CAPTURED_STATES_FOLDER_ASSET_KEY,
      'Folder',
      QBO_STATE_CAPTURE.ENVIRONMENT
    );
  } catch (error) {
    throw new Error(
      'State Capture provisioning refused: unable to resolve governed asset ' +
      QBO_STATE_CAPTURE.CAPTURED_STATES_FOLDER_ASSET_KEY + ': ' +
      (error && error.message ? error.message : String(error))
    );
  }

  const folderId = asset && String(asset.ResourceIdentifier || '').trim();
  if (!folderId) {
    throw new Error(
      'State Capture provisioning refused: governed asset returned no ResourceIdentifier.'
    );
  }

  const folder = DriveApp.getFolderById(folderId);
  validateQboCapturedStatesFolderHierarchy_(folder);
  return folder;
}

function validateQboStateCaptureWorkbookLocation_(spreadsheet) {
  const expectedFolder = resolveQboCapturedStatesFolder_();
  const file = DriveApp.getFileById(spreadsheet.getId());
  const parents = file.getParents();
  let matchingParent = false;
  let parentCount = 0;

  while (parents.hasNext()) {
    const parent = parents.next();
    parentCount += 1;
    if (parent.getId() === expectedFolder.getId()) {
      matchingParent = true;
    }
  }

  if (!matchingParent || parentCount !== 1) {
    throw new Error(
      'QBO State Capture workbook location invalid. Expected exactly one parent: ' +
      expectedFolder.getName() + ' (' + expectedFolder.getId() + ').'
    );
  }
}

function validateQboCapturedStatesFolderHierarchy_(folder) {
  if (folder.getName() !== QBO_STATE_CAPTURE.EXPECTED_FOLDER_NAME) {
    throw new Error(
      'Governed State Capture folder name mismatch. Expected ' +
      QBO_STATE_CAPTURE.EXPECTED_FOLDER_NAME + ', found ' + folder.getName() + '.'
    );
  }

  const parents = folder.getParents();
  if (!parents.hasNext()) {
    throw new Error('Captured States folder has no accessible parent.');
  }
  const parent = parents.next();
  if (parents.hasNext()) {
    throw new Error('Captured States folder has multiple accessible parents.');
  }
  if (parent.getName() !== QBO_STATE_CAPTURE.EXPECTED_PARENT_FOLDER_NAME) {
    throw new Error(
      'Captured States parent mismatch. Expected ' +
      QBO_STATE_CAPTURE.EXPECTED_PARENT_FOLDER_NAME + ', found ' + parent.getName() + '.'
    );
  }

  const grandparents = parent.getParents();
  if (!grandparents.hasNext()) {
    throw new Error('Change Evidence folder has no accessible parent.');
  }
  const grandparent = grandparents.next();
  if (grandparents.hasNext()) {
    throw new Error('Change Evidence folder has multiple accessible parents.');
  }
  if (grandparent.getName() !== QBO_STATE_CAPTURE.EXPECTED_GRANDPARENT_FOLDER_NAME) {
    throw new Error(
      'Change Evidence parent mismatch. Expected ' +
      QBO_STATE_CAPTURE.EXPECTED_GRANDPARENT_FOLDER_NAME + ', found ' +
      grandparent.getName() + '.'
    );
  }
}
