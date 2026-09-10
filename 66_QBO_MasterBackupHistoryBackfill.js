/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 66_QBO_MasterBackupHistoryBackfill.js
 * Purpose     : Backfill exact Master Backup file lineage into historical
 *               QBO_ExportRunHistory rows.
 *
 * Public API:
 *   - auditQboExportRunHistoryMasterBackupBackfill()
 *   - applyQboExportRunHistoryMasterBackupBackfill()
 *
 * Architecture Notes:
 *   - Existing full-workbook copies are Master Backups, not State Capture
 *     Snapshot Records.
 *   - This module does not create new backups and does not infer entity state.
 *   - A history row is linked only when exactly one Master Backup file matches
 *     the export's current-workbook name and acquisition time interval.
 *   - Ambiguous or unmatched rows remain unchanged and are reported for
 *     operator review. No nearest-file guessing is permitted.
 * ============================================================================
 */

const QBO_MASTER_BACKUP_BACKFILL_TOLERANCE_MS_ = 15 * 1000;

/**
 * Read-only preview of the historical Master Backup lineage backfill.
 *
 * @return {Object} Backfill audit summary.
 */
function auditQboExportRunHistoryMasterBackupBackfill() {
  return runQboExportRunHistoryMasterBackupBackfill_(false);
}

/**
 * Applies uniquely proven Master Backup file links to blank historical rows.
 * Existing populated links are preserved.
 *
 * @return {Object} Backfill result summary.
 */
function applyQboExportRunHistoryMasterBackupBackfill() {
  return runQboExportRunHistoryMasterBackupBackfill_(true);
}

function runQboExportRunHistoryMasterBackupBackfill_(applyChanges) {
  const spreadsheet = getQboRunHistorySpreadsheet_();
  ensureQboRunHistoryMasterBackupSchema_(spreadsheet);

  const sheet = spreadsheet.getSheetByName(QBO_RUN_HISTORY.EXPORTS_SHEET);
  if (!sheet || sheet.getLastRow() <= 1) {
    const emptyResult = {
      mode: applyChanges ? 'APPLY' : 'AUDIT',
      eligibleRows: 0,
      alreadyLinked: 0,
      uniquelyMatched: 0,
      updatedRows: 0,
      unmatched: 0,
      ambiguous: 0,
      details: []
    };
    console.log(JSON.stringify(emptyResult, null, 2));
    return emptyResult;
  }

  const manifestByKey = Object.create(null);
  getQboExportManifest().forEach(function(entry) {
    manifestByKey[entry.key] = entry;
  });

  const sourceWorkbookNameByKey = Object.create(null);
  Object.keys(manifestByKey).forEach(function(exportKey) {
    const entry = manifestByKey[exportKey];
    const spreadsheetId = getExportSpreadsheetId_(entry.sheetNames[0]);
    sourceWorkbookNameByKey[exportKey] = DriveApp.getFileById(spreadsheetId).getName();
  });

  const backupFolder = getQboExportSnapshotFolder_();
  const backupFiles = [];
  const files = backupFolder.getFiles();

  while (files.hasNext()) {
    const file = files.next();
    backupFiles.push({
      id: file.getId(),
      name: file.getName(),
      createdAt: file.getDateCreated()
    });
  }

  const width = QBO_RUN_HISTORY_HEADERS_.EXPORTS.length;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
  const updates = [];
  const details = [];

  let eligibleRows = 0;
  let alreadyLinked = 0;
  let uniquelyMatched = 0;
  let unmatched = 0;
  let ambiguous = 0;

  values.forEach(function(row, index) {
    const rowNumber = index + 2;
    const runId = String(row[0] || '').trim();
    const exportKey = String(row[2] || '').trim();
    const startedAt = row[4];
    const completedAt = row[5];
    const status = String(row[6] || '').trim();
    const existingId = String(row[9] || '').trim();
    const existingName = String(row[10] || '').trim();

    if (status !== 'COMPLETE') {
      return;
    }

    eligibleRows += 1;

    if (existingId || existingName) {
      alreadyLinked += 1;
      return;
    }

    const sourceWorkbookName = sourceWorkbookNameByKey[exportKey];
    const startedMs = getQboHistoryDateMs_(startedAt);
    const completedMs = getQboHistoryDateMs_(completedAt);

    if (
      !sourceWorkbookName ||
      !Number.isFinite(startedMs) ||
      !Number.isFinite(completedMs)
    ) {
      unmatched += 1;
      details.push({
        rowNumber: rowNumber,
        runId: runId,
        exportKey: exportKey,
        status: 'UNMATCHED_INVALID_HISTORY_METADATA'
      });
      return;
    }

    const expectedPrefix = sourceWorkbookName + '_';
    const lowerBound = startedMs - QBO_MASTER_BACKUP_BACKFILL_TOLERANCE_MS_;
    const upperBound = completedMs + QBO_MASTER_BACKUP_BACKFILL_TOLERANCE_MS_;

    const candidates = backupFiles.filter(function(file) {
      const createdMs = file.createdAt && file.createdAt.getTime();
      return (
        file.name.indexOf(expectedPrefix) === 0 &&
        /_\d{8}_\d{6}$/.test(file.name) &&
        Number.isFinite(createdMs) &&
        createdMs >= lowerBound &&
        createdMs <= upperBound
      );
    });

    if (candidates.length === 0) {
      unmatched += 1;
      details.push({
        rowNumber: rowNumber,
        runId: runId,
        exportKey: exportKey,
        status: 'UNMATCHED',
        sourceWorkbookName: sourceWorkbookName,
        startedAt: startedAt,
        completedAt: completedAt
      });
      return;
    }

    if (candidates.length > 1) {
      ambiguous += 1;
      details.push({
        rowNumber: rowNumber,
        runId: runId,
        exportKey: exportKey,
        status: 'AMBIGUOUS',
        candidateCount: candidates.length,
        candidates: candidates.map(function(file) {
          return {
            id: file.id,
            name: file.name,
            createdAt: file.createdAt
          };
        })
      });
      return;
    }

    const match = candidates[0];
    uniquelyMatched += 1;
    updates.push({
      rowNumber: rowNumber,
      fileId: match.id,
      fileName: match.name
    });

    details.push({
      rowNumber: rowNumber,
      runId: runId,
      exportKey: exportKey,
      status: 'UNIQUE_MATCH',
      masterBackupFileId: match.id,
      masterBackupFileName: match.name,
      masterBackupCreatedAt: match.createdAt
    });
  });

  if (applyChanges) {
    updates.forEach(function(update) {
      sheet.getRange(update.rowNumber, 10, 1, 2).setValues([[
        update.fileId,
        update.fileName
      ]]);
    });
  }

  const result = {
    mode: applyChanges ? 'APPLY' : 'AUDIT',
    backupFolderId: backupFolder.getId(),
    backupFolderName: backupFolder.getName(),
    backupFilesScanned: backupFiles.length,
    eligibleRows: eligibleRows,
    alreadyLinked: alreadyLinked,
    uniquelyMatched: uniquelyMatched,
    updatedRows: applyChanges ? updates.length : 0,
    unmatched: unmatched,
    ambiguous: ambiguous,
    actionRequired: unmatched > 0 || ambiguous > 0,
    details: details
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}
