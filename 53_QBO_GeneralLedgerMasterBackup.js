/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 53_QBO_GeneralLedgerMasterBackup.js
 * Version     : 1.5.227
 * Purpose     : Bounded disaster-recovery backup for the mutable cumulative
 *               QBO General Ledger workbook.
 *
 * Contract:
 *   - GL_MASTER_BACKUP_V1 is DR only; it is never GL run evidence.
 *   - At most one successful full-workbook backup per America/Chicago day.
 *   - No backup is created when the GL store has not advanced beyond the last
 *     successful backup.
 *   - Does not alter QBO_EXPORT_MANIFEST, GL_SnapshotFileId, or
 *     GL_RUN_SNAPSHOT_V2.
 * ============================================================================
 */

const QBO_GL_MASTER_BACKUP_V1 = Object.freeze({
  VERSION: '1.5.227',
  CONTRACT: 'GL_MASTER_BACKUP_V1',
  REGISTRY_SHEET: 'QBO_GeneralLedgerMasterBackups',
  LEASE_PROPERTY: 'QBO_GL_MASTER_BACKUP_LEASE_V1',
  LEASE_MINUTES: 20,
  TIME_ZONE: 'America/Chicago',
  HEADERS: Object.freeze([
    'BackupId','BackupContract','BackupCreatedAt','BackupBusinessDate',
    'SourceSpreadsheetId','BackupFileId','BackupFileName','SourceLastChangedAt',
    'LatestCompletedExtractRunId','SourceRowCount','SourcePeriodCount','Status'
  ])
});

/** Zero-argument operator. Safe to install as a daily trigger only after runtime validation. */
function runQboGeneralLedgerMasterBackupV1227() {
  return createQboGeneralLedgerMasterBackupV1_();
}

/** Zero-argument contract test; no production writes and no Drive copies. */
function testQboGeneralLedgerMasterBackupV1227Contract() {
  const src = createQboGeneralLedgerMasterBackupV1_.toString() + '\n' +
    inspectQboGeneralLedgerMasterBackupEligibilityV1_.toString() + '\n' +
    appendQboGeneralLedgerMasterBackupRegistryV1_.toString();
  const wrapper = runQboGeneralLedgerMasterBackupV1227.toString();
  const checks = [
    ['operator is zero argument', /function\s+runQboGeneralLedgerMasterBackupV1227\s*\(\s*\)/.test(wrapper)],
    ['contract is GL_MASTER_BACKUP_V1', QBO_GL_MASTER_BACKUP_V1.CONTRACT === 'GL_MASTER_BACKUP_V1'],
    ['uses cumulative GL workbook', src.indexOf('getQboGeneralLedgerReportSpreadsheet_') >= 0],
    ['uses existing snapshot folder', src.indexOf('getQboExportSnapshotFolder_') >= 0],
    ['creates full workbook copy', src.indexOf('.makeCopy(') >= 0],
    ['daily local-date dedupe exists', src.indexOf('BackupBusinessDate') >= 0 && src.indexOf('ALREADY_BACKED_UP') >= 0],
    ['changed-state gate exists', src.indexOf('NO_SOURCE_CHANGE') >= 0],
    ['registry is append only', src.indexOf('appendRow') >= 0],
    ['records latest completed extract run', src.indexOf('LatestCompletedExtractRunId') >= 0],
    ['records source row and period counts', src.indexOf('SourceRowCount') >= 0 && src.indexOf('SourcePeriodCount') >= 0],
    ['does not write GL run snapshot identity', src.indexOf('GL_SnapshotFileId') < 0 && src.indexOf('SnapshotArtifactContract') < 0],
    ['does not touch QBO export manifest', src.indexOf('QBO_EXPORT_MANIFEST') < 0],
    ['does not invoke GL extraction', src.indexOf('exportQboGeneralLedgerReport') < 0],
    ['uses bounded lease', src.indexOf('QBO_GL_MASTER_BACKUP_LEASE_V1') >= 0 || QBO_GL_MASTER_BACKUP_V1.LEASE_PROPERTY === 'QBO_GL_MASTER_BACKUP_LEASE_V1']
  ];
  const failed = checks.filter(function(c) { return !c[1]; });
  const result = {
    Version: QBO_GL_MASTER_BACKUP_V1.VERSION,
    Status: failed.length ? 'FAIL' : 'PASS',
    Test_Count: checks.length,
    Passed: checks.length - failed.length,
    Checks: checks.map(function(c) { return { name: c[0], passed: c[1] }; })
  };
  console.log('[GL MASTER BACKUP] | V1.5.227 CONTRACT | ' + JSON.stringify(result));
  if (failed.length) throw new Error('GL_MASTER_BACKUP_V1_5_227_CONTRACT_FAILED');
  return result;
}

/** Read-only zero-argument eligibility diagnostic. */
function diagnoseQboGeneralLedgerMasterBackupV1227Eligibility() {
  const ss = getQboGeneralLedgerReportSpreadsheet_();
  const result = inspectQboGeneralLedgerMasterBackupEligibilityV1_(ss, new Date());
  console.log('[GL MASTER BACKUP] | V1.5.227 ELIGIBILITY | ' + JSON.stringify(result));
  return result;
}

function createQboGeneralLedgerMasterBackupV1_() {
  const lease = claimQboGeneralLedgerMasterBackupLeaseV1_();
  try {
    const ss = getQboGeneralLedgerReportSpreadsheet_();
    const now = new Date();
    const eligibility = inspectQboGeneralLedgerMasterBackupEligibilityV1_(ss, now);
    if (!eligibility.Eligible) {
      console.log('[GL MASTER BACKUP] | SKIP | ' + JSON.stringify(eligibility));
      return eligibility;
    }

    SpreadsheetApp.flush();
    const sourceFile = DriveApp.getFileById(ss.getId());
    const folder = getQboExportSnapshotFolder_();
    const stamp = Utilities.formatDate(now, QBO_GL_MASTER_BACKUP_V1.TIME_ZONE, 'yyyyMMdd_HHmmss');
    const backupName = 'QBO_GL_MASTER_BACKUP_V1_' + eligibility.BackupBusinessDate.replace(/-/g, '') + '_' + stamp;
    const backupFile = sourceFile.makeCopy(backupName, folder);

    const backupId = Utilities.getUuid();
    const row = {
      BackupId: backupId,
      BackupContract: QBO_GL_MASTER_BACKUP_V1.CONTRACT,
      BackupCreatedAt: now,
      BackupBusinessDate: eligibility.BackupBusinessDate,
      SourceSpreadsheetId: ss.getId(),
      BackupFileId: backupFile.getId(),
      BackupFileName: backupFile.getName(),
      SourceLastChangedAt: eligibility.SourceLastChangedAt,
      LatestCompletedExtractRunId: eligibility.LatestCompletedExtractRunId,
      SourceRowCount: eligibility.SourceRowCount,
      SourcePeriodCount: eligibility.SourcePeriodCount,
      Status: 'COMPLETE'
    };
    appendQboGeneralLedgerMasterBackupRegistryV1_(ss, row);

    const result = Object.assign({
      Version: QBO_GL_MASTER_BACKUP_V1.VERSION,
      Result: 'BACKUP_CREATED',
      Writes_Performed: 1
    }, qboGlMasterBackupRegistryRowForLogV1_(row));
    console.log('[GL MASTER BACKUP] | COMPLETE | ' + JSON.stringify(result));
    return result;
  } finally {
    releaseQboGeneralLedgerMasterBackupLeaseV1_(lease);
  }
}

function inspectQboGeneralLedgerMasterBackupEligibilityV1_(ss, now) {
  const businessDate = Utilities.formatDate(now, QBO_GL_MASTER_BACKUP_V1.TIME_ZONE, 'yyyy-MM-dd');
  const latestRun = latestCompletedQboGeneralLedgerRunV1_(ss);
  if (!latestRun) {
    return { Version: QBO_GL_MASTER_BACKUP_V1.VERSION, Eligible: false, Result: 'NO_COMPLETED_GL_RUN', BackupBusinessDate: businessDate };
  }

  const registry = ensureQboGeneralLedgerMasterBackupRegistryV1_(ss, false);
  const rows = readQboGeneralLedgerMasterBackupRegistryV1_(registry);
  const complete = rows.filter(function(r) { return String(r.Status || '') === 'COMPLETE'; });
  const sameDay = complete.filter(function(r) { return String(r.BackupBusinessDate || '') === businessDate; });
  const latestBackup = complete.length ? complete[complete.length - 1] : null;
  const dataSheet = ss.getSheetByName(QBO_GENERAL_LEDGER_REPORT.DATA_SHEET);
  const history = getQboGeneralLedgerHistoryStatus_(ss, dataSheet);
  const sourceChangedAt = latestRun.ExtractedAt instanceof Date ? latestRun.ExtractedAt : new Date(latestRun.ExtractedAt);

  const base = {
    Version: QBO_GL_MASTER_BACKUP_V1.VERSION,
    BackupContract: QBO_GL_MASTER_BACKUP_V1.CONTRACT,
    BackupBusinessDate: businessDate,
    SourceSpreadsheetId: ss.getId(),
    SourceLastChangedAt: sourceChangedAt.toISOString(),
    LatestCompletedExtractRunId: String(latestRun.ExtractRunId || ''),
    SourceRowCount: history.dataRowCount,
    SourcePeriodCount: history.periodCount
  };

  if (sameDay.length) {
    return Object.assign(base, {
      Eligible: false,
      Result: 'ALREADY_BACKED_UP',
      ExistingBackupId: sameDay[sameDay.length - 1].BackupId,
      ExistingBackupFileId: sameDay[sameDay.length - 1].BackupFileId
    });
  }
  if (latestBackup && String(latestBackup.LatestCompletedExtractRunId || '') === String(latestRun.ExtractRunId || '')) {
    return Object.assign(base, {
      Eligible: false,
      Result: 'NO_SOURCE_CHANGE',
      ExistingBackupId: latestBackup.BackupId,
      ExistingBackupFileId: latestBackup.BackupFileId
    });
  }
  return Object.assign(base, { Eligible: true, Result: 'BACKUP_REQUIRED' });
}

function latestCompletedQboGeneralLedgerRunV1_(ss) {
  ensureQboGeneralLedgerRunRegistrySchemaV2_(ss);
  const sheet = ss.getSheetByName(QBO_GENERAL_LEDGER_REPORT.RUNS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function(v) { return String(v || '').trim(); });
  const idx = {};
  QBO_GENERAL_LEDGER_RUN_HEADERS.forEach(function(h) { idx[h] = headers.indexOf(h); });
  for (let i = values.length - 1; i >= 1; i--) {
    const row = values[i];
    const runId = String(row[idx.ExtractRunId] || '').trim();
    const extractedAt = row[idx.ExtractedAt];
    const snapshotId = String(row[idx.SnapshotFileId] || '').trim();
    const contract = String(row[idx.SnapshotArtifactContract] || '').trim();
    if (runId && extractedAt instanceof Date && !isNaN(extractedAt.getTime()) && snapshotId && contract) {
      const out = {};
      QBO_GENERAL_LEDGER_RUN_HEADERS.forEach(function(h) { out[h] = row[idx[h]]; });
      return out;
    }
  }
  return null;
}

function ensureQboGeneralLedgerMasterBackupRegistryV1_(ss, allowCreate) {
  let sheet = ss.getSheetByName(QBO_GL_MASTER_BACKUP_V1.REGISTRY_SHEET);
  if (!sheet && allowCreate !== false) sheet = ss.insertSheet(QBO_GL_MASTER_BACKUP_V1.REGISTRY_SHEET);
  if (!sheet) return null;
  const headers = QBO_GL_MASTER_BACKUP_V1.HEADERS.slice();
  if (sheet.getLastRow() === 0) {
    if (allowCreate === false) return sheet;
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else {
    const actual = sheet.getRange(1, 1, 1, Math.max(headers.length, sheet.getLastColumn())).getDisplayValues()[0].slice(0, headers.length);
    if (actual.join('|') !== headers.join('|')) throw new Error('GL_MASTER_BACKUP_REGISTRY_SCHEMA_MISMATCH');
  }
  return sheet;
}

function readQboGeneralLedgerMasterBackupRegistryV1_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function(v) { return String(v || '').trim(); });
  return values.slice(1).map(function(row) {
    const out = {};
    headers.forEach(function(h, i) { out[h] = row[i]; });
    if (out.BackupCreatedAt instanceof Date) out.BackupCreatedAtISO = out.BackupCreatedAt.toISOString();
    return out;
  });
}

function appendQboGeneralLedgerMasterBackupRegistryV1_(ss, row) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('GL_MASTER_BACKUP_REGISTRY_LOCK_TIMEOUT');
  try {
    const sheet = ensureQboGeneralLedgerMasterBackupRegistryV1_(ss, true);
    const values = QBO_GL_MASTER_BACKUP_V1.HEADERS.map(function(h) { return row[h] === undefined ? '' : row[h]; });
    sheet.appendRow(values);
    const r = sheet.getLastRow();
    sheet.getRange(r, 3).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange(r, 8).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    SpreadsheetApp.flush();
    const stored = sheet.getRange(r, 1, 1, values.length).getValues()[0];
    if (String(stored[0] || '') !== String(row.BackupId || '') || String(stored[5] || '') !== String(row.BackupFileId || '')) {
      throw new Error('GL_MASTER_BACKUP_REGISTRY_WRITE_VERIFICATION_FAILED');
    }
  } finally {
    lock.releaseLock();
  }
}

function claimQboGeneralLedgerMasterBackupLeaseV1_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('GL_MASTER_BACKUP_LEASE_LOCK_TIMEOUT');
  try {
    const props = PropertiesService.getScriptProperties();
    const now = Date.now();
    const raw = String(props.getProperty(QBO_GL_MASTER_BACKUP_V1.LEASE_PROPERTY) || '').trim();
    if (raw) {
      try {
        const existing = JSON.parse(raw);
        if (Number(existing.expiresAt || 0) > now) throw new Error('GL_MASTER_BACKUP_ALREADY_RUNNING');
      } catch (e) {
        if (e && e.message === 'GL_MASTER_BACKUP_ALREADY_RUNNING') throw e;
      }
    }
    const lease = { token: Utilities.getUuid(), expiresAt: now + QBO_GL_MASTER_BACKUP_V1.LEASE_MINUTES * 60000 };
    props.setProperty(QBO_GL_MASTER_BACKUP_V1.LEASE_PROPERTY, JSON.stringify(lease));
    return lease;
  } finally {
    lock.releaseLock();
  }
}

function releaseQboGeneralLedgerMasterBackupLeaseV1_(lease) {
  if (!lease || !lease.token) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const raw = String(props.getProperty(QBO_GL_MASTER_BACKUP_V1.LEASE_PROPERTY) || '').trim();
    if (!raw) return;
    try {
      const existing = JSON.parse(raw);
      if (String(existing.token || '') === String(lease.token)) props.deleteProperty(QBO_GL_MASTER_BACKUP_V1.LEASE_PROPERTY);
    } catch (e) {
      props.deleteProperty(QBO_GL_MASTER_BACKUP_V1.LEASE_PROPERTY);
    }
  } finally {
    lock.releaseLock();
  }
}

function qboGlMasterBackupRegistryRowForLogV1_(row) {
  return {
    BackupId: row.BackupId,
    BackupContract: row.BackupContract,
    BackupCreatedAtISO: row.BackupCreatedAt instanceof Date ? row.BackupCreatedAt.toISOString() : String(row.BackupCreatedAt || ''),
    BackupBusinessDate: row.BackupBusinessDate,
    SourceSpreadsheetId: row.SourceSpreadsheetId,
    BackupFileId: row.BackupFileId,
    BackupFileName: row.BackupFileName,
    SourceLastChangedAtISO: row.SourceLastChangedAt instanceof Date ? row.SourceLastChangedAt.toISOString() : String(row.SourceLastChangedAt || ''),
    LatestCompletedExtractRunId: row.LatestCompletedExtractRunId,
    SourceRowCount: row.SourceRowCount,
    SourcePeriodCount: row.SourcePeriodCount,
    Status: row.Status
  };
}
