/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 112_QBO_StateCaptureWorkbookIntegrityAudit.js
 * Version     : 1.5.93
 * Purpose     : Full, read-only integrity and role audit of every worksheet in
 *               the governed QBO State Capture workbook.
 *
 * Safety:
 *   - READ ONLY. No workbook, Drive, trigger, or property mutations.
 *   - Audits every expected sheet and flags unexpected sheets.
 *   - Classifies sheet role/disposition without deleting or renaming anything.
 *   - Reuses the v1.5.76 all-column 01_Sources / 05 ledger audit.
 * ============================================================================
 */

const QBO_STATE_CAPTURE_WORKBOOK_AUDIT_ = Object.freeze({
  VERSION: 'QBO_STATE_CAPTURE_WORKBOOK_INTEGRITY_V2_DURABLE_REPORT',
  MAX_FINDINGS: 400,
  RUN_SHEET: '94_Integrity_Audit_Runs',
  FINDING_SHEET: '95_Integrity_Audit_Findings',
  REPAIR_ASSESSMENT_SHEET: '96_Integrity_Repair_Assessment',
  REPAIR_LOG_SHEET: '97_Integrity_Repair_Log',
  REGISTERED_AT_EVIDENCE_SHEET: '98_RegisteredAt_Evidence_Assessment',
  REGISTERED_AT_ARTIFACT_SCAN_SHEET: '99_RegisteredAt_Artifact_Scan',
  NATIVE_CDC_REGISTERED_AT_ASSESSMENT_SHEET: '100_Native_CDC_RegAt_Assessment',
  LIFECYCLE_TIMESTAMP_ASSESSMENT_SHEET: '101_Lifecycle_Timestamp_Assessment',
  HISTORICAL_TIMESTAMP_EXCEPTION_SHEET: '102_Historical_Timestamp_Exceptions',
  CONTROLLED_TEST_ASSESSMENT_SHEET: '103_Controlled_Test_Assessment',
  CONTROLLED_TEST_ARTIFACT_SHEET: '104_Controlled_Test_Payload_Artifacts',
  RUN_HEADERS: Object.freeze(['AuditRunId','AuditVersion','StartedAt','CompletedAt','WorkbookName','Scope','WorkbookSheetCount','WorkbookInvalidFindings','WorkbookUnverifiableFindings','LedgerCheckCount','LedgerInvalidCount','LedgerUnverifiableCount','PersistedFindingCount','Status','ProductionDataMutated','AuditOutputWritten']),
  FINDING_HEADERS: Object.freeze(['AuditRunId','FindingSequence','SourceAudit','Result','Severity','SheetName','RowNumber','ColumnOrRule','FindingCode','Detail','SourceType','EntityType','RecordId','Repairability','RecordedAt']),
  RESULT_VALID: 'VALID',
  RESULT_VALID_BLANK: 'VALID_BLANK',
  RESULT_INVALID: 'INVALID',
  RESULT_UNVERIFIABLE: 'UNVERIFIABLE',
  SHA256_RE: /^[a-f0-9]{64}$/i,
  DRIVE_ID_RE: /^[A-Za-z0-9_-]{20,}$/,
  SHEET_ROLES: Object.freeze({
    '00_Control': Object.freeze({
      role: 'LEGACY_COMPATIBILITY_CONTROL',
      disposition: 'RETAIN_FROZEN_OR_COMPATIBILITY',
      activeWriteExpected: false,
      note: 'Legacy State Capture control surface retained for compatibility/evidence; canonical control authority is 00_Controls.'
    }),
    '00_Controls': Object.freeze({
      role: 'ACTIVE_CANONICAL_CONTROL',
      disposition: 'ACTIVE_KEEP',
      activeWriteExpected: true,
      note: 'Canonical control/contract metadata.'
    }),
    '01_Sources': Object.freeze({
      role: 'ACTIVE_FULL_EXPORT_SOURCE_INVENTORY',
      disposition: 'ACTIVE_KEEP',
      activeWriteExpected: true,
      note: 'FULL_EXPORT/FULL_EXPORT_LEGACY inventory and registration authority only.'
    }),
    '02_CDC_Run_Manifest': Object.freeze({
      role: 'RESERVED_UNWIRED_CDC_SHEET',
      disposition: 'REVIEW_DEPRECATION_AFTER_ROLE_DECISION',
      activeWriteExpected: false,
      note: 'Header-only in current workbook; durable Native CDC manifests are Drive evidence in the current architecture.'
    }),
    '03_Native_CDC_Events': Object.freeze({
      role: 'RESERVED_UNWIRED_SOURCE_EVENT_SHEET',
      disposition: 'REVIEW_DEPRECATION_AFTER_ROLE_DECISION',
      activeWriteExpected: false,
      note: 'Current forward ingestion does not write this sheet; source-event-sheet ownership remains intentionally unresolved.'
    }),
    '04_Webhook_Events': Object.freeze({
      role: 'RESERVED_UNWIRED_SOURCE_EVENT_SHEET',
      disposition: 'REVIEW_DEPRECATION_AFTER_ROLE_DECISION',
      activeWriteExpected: false,
      note: 'Current Webhook forward/historical ingestion does not write this sheet.'
    }),
    '05_Forward_Ingestion_Control': Object.freeze({
      role: 'ACTIVE_CROSS_SOURCE_FORWARD_INGESTION_LEDGER',
      disposition: 'ACTIVE_KEEP',
      activeWriteExpected: true,
      note: 'Authoritative resume/checkpoint ledger for Native CDC, Webhook, and FULL_EXPORT forward ingestion.'
    }),
    '10_Snapshot_Records': Object.freeze({
      role: 'VERSIONED_STATE_APPLICATION_OUTPUT_AND_MIGRATION_REFERENCE',
      disposition: 'ACTIVE_KEEP',
      activeWriteExpected: false,
      note: 'Contains preserved V1/partial V2 migration/reference history; future authoritative writes belong to State Application.'
    }),
    '10_State_Capture': Object.freeze({
      role: 'LEGACY_FROZEN_STATE_EVIDENCE',
      disposition: 'RETAIN_FROZEN_HISTORICAL',
      activeWriteExpected: false,
      note: 'STATE_ROW_V1 legacy table; LEGACY_STATE_WRITE_ENABLED is false.'
    }),
    '11_Change_Records': Object.freeze({
      role: 'VERSIONED_STATE_APPLICATION_OUTPUT_AND_MIGRATION_REFERENCE',
      disposition: 'ACTIVE_KEEP',
      activeWriteExpected: false,
      note: 'State Application output only; never an ingestion source.'
    }),
    '12_Change_Detail': Object.freeze({
      role: 'VERSIONED_STATE_APPLICATION_OUTPUT_AND_MIGRATION_REFERENCE',
      disposition: 'ACTIVE_KEEP',
      activeWriteExpected: false,
      note: 'State Application output only; never an ingestion source.'
    }),
    '90_Ingestion_Log': Object.freeze({
      role: 'ACTIVE_TELEMETRY_AUDIT_LOG',
      disposition: 'ACTIVE_KEEP',
      activeWriteExpected: true,
      note: 'Operational/audit telemetry; not processing state authority.'
    }),
    '90_Run_Log': Object.freeze({
      role: 'LEGACY_RUN_LOG_EVIDENCE',
      disposition: 'RETAIN_FROZEN_HISTORICAL',
      activeWriteExpected: false,
      note: 'Legacy State Capture source-registration/audit run log.'
    }),
    '91_Contract_Audit_Paths': Object.freeze({
      role: 'HISTORICAL_CONTRACT_AUDIT_EVIDENCE',
      disposition: 'RETAIN_HISTORICAL_EVIDENCE',
      activeWriteExpected: false,
      note: 'One-time recursive historical contract audit output; not production processing state.'
    }),
    '92_Contract_Audit_Sources': Object.freeze({
      role: 'HISTORICAL_CONTRACT_AUDIT_EVIDENCE',
      disposition: 'RETAIN_HISTORICAL_EVIDENCE',
      activeWriteExpected: false,
      note: 'One-time recursive historical contract audit source summary.'
    }),
    '93_Contract_Audit_Runs': Object.freeze({
      role: 'HISTORICAL_CONTRACT_AUDIT_EVIDENCE',
      disposition: 'RETAIN_HISTORICAL_EVIDENCE',
      activeWriteExpected: false,
      note: 'One-time recursive historical contract audit run summary.'
    })
  })
});

/**
 * Primary full-workbook audit entry point.
 * Runs the v1.5.76 01/05 ledger audit, then audits every workbook sheet.
 */
function auditQboStateCaptureWorkbookIntegrity() {
  const startedAt = new Date();
  const auditRunId = 'STATE_CAPTURE_INTEGRITY|' + Utilities.getUuid();
  const ss = getQboStateCaptureSpreadsheet_();
  const findings = [];
  const sheetResults = [];
  const expected = qboWbAuditExpectedSheets_();
  const actualSheets = ss.getSheets();
  const actualByName = Object.create(null);
  actualSheets.forEach(function(s) { actualByName[s.getName()] = s; });

  Object.keys(expected).forEach(function(name) {
    const sheet = actualByName[name];
    if (!sheet) {
      qboWbAuditFinding_(findings, name, 0, '', 'EXPECTED_SHEET_MISSING', 'INVALID', 'Expected governed sheet is absent.');
      sheetResults.push(qboWbAuditSheetResult_(name, expected[name], null, 'MISSING'));
      return;
    }
    sheetResults.push(qboWbAuditSheet_(sheet, expected[name], findings));
  });

  actualSheets.forEach(function(sheet) {
    const name = sheet.getName();
    if (expected[name]) return;
    if (qboWbAuditIsDiagnosticOutputSheet_(name)) {
      sheetResults.push({
        sheetName: name,
        role: 'INTEGRITY_AUDIT_OUTPUT',
        disposition: 'ACTIVE_DIAGNOSTIC_KEEP',
        activeWriteExpected: true,
        roleNote: 'Durable diagnostic output only; never production/state authority.',
        rowCount: Math.max(0, sheet.getLastRow() - 1),
        columnCount: sheet.getLastColumn(),
        expectedColumnCount: qboWbAuditDiagnosticExpectedColumnCount_(name),
        status: 'VALID'
      });
      return;
    }
    qboWbAuditFinding_(findings, name, 0, '', 'UNEXPECTED_SHEET', 'UNVERIFIABLE', 'Sheet is not in the governed QBO State Capture sheet registry.');
    sheetResults.push({
      sheetName: name,
      role: 'UNREGISTERED_UNKNOWN',
      disposition: 'REVIEW_REQUIRED',
      activeWriteExpected: false,
      rowCount: Math.max(0, sheet.getLastRow() - 1),
      columnCount: sheet.getLastColumn(),
      status: 'UNVERIFIABLE'
    });
  });

  qboWbAuditCrossReferences_(ss, findings);

  let ledgerAudit = null;
  try {
    ledgerAudit = qboBuildStateCaptureLedgerIntegrityAudit_({log: false, includeAllFindings: true});
  } catch (e) {
    qboWbAuditFinding_(findings, 'WORKBOOK', 0, '', 'LEDGER_SUBAUDIT_FAILED', 'INVALID', e && e.message ? e.message : String(e));
  }

  const summary = qboWbAuditSummarize_(sheetResults, findings);
  const durableFindings = qboWbAuditBuildDurableFindings_(ss, findings, ledgerAudit ? ledgerAudit.findings : []);
  const completedAt = new Date();
  const status = qboWbAuditOverallStatus_(summary, ledgerAudit);

  qboWbAuditPersistReport_(ss, {
    auditRunId: auditRunId,
    startedAt: startedAt,
    completedAt: completedAt,
    summary: summary,
    ledgerAudit: ledgerAudit,
    findings: durableFindings,
    status: status
  });

  const result = {
    version: QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.VERSION,
    productionDataReadOnly: true,
    auditOutputWritten: true,
    auditRunId: auditRunId,
    workbookName: ss.getName(),
    scope: 'ALL_SHEETS_ALL_GOVERNED_COLUMNS_ALL_DATA_ROWS_PLUS_CROSS_SHEET_REFERENCES',
    status: status,
    summary: summary,
    ledgerSubAuditSummary: ledgerAudit ? ledgerAudit.summary : null,
    persistedFindingCount: durableFindings.length,
    reportSheets: [QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.RUN_SHEET, QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.FINDING_SHEET],
    repairApplied: false,
    productionDataMutationApplied: false,
    deletionOrRenameApplied: false
  };

  console.log('[QBO STATE CAPTURE WORKBOOK AUDIT] | COMPLETE | ' + JSON.stringify(result, null, 2));
  return result;
}


function qboWbAuditIsDiagnosticOutputSheet_(name) {
  return name === QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.RUN_SHEET ||
    name === QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.FINDING_SHEET ||
    name === QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.REPAIR_ASSESSMENT_SHEET ||
    name === QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.REPAIR_LOG_SHEET ||
    name === QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.REGISTERED_AT_EVIDENCE_SHEET ||
    name === QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.REGISTERED_AT_ARTIFACT_SCAN_SHEET ||
    name === QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.NATIVE_CDC_REGISTERED_AT_ASSESSMENT_SHEET ||
    name === QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.LIFECYCLE_TIMESTAMP_ASSESSMENT_SHEET ||
    name === QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.HISTORICAL_TIMESTAMP_EXCEPTION_SHEET ||
    name === QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.CONTROLLED_TEST_ASSESSMENT_SHEET ||
    name === QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.CONTROLLED_TEST_ARTIFACT_SHEET;
}

function qboWbAuditDiagnosticExpectedColumnCount_(name) {
  if (name === QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.RUN_SHEET) return QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.RUN_HEADERS.length;
  if (name === QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.FINDING_SHEET) return QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.FINDING_HEADERS.length;
  if (name === QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.REPAIR_ASSESSMENT_SHEET && typeof QBO_INTEGRITY_REPAIR_ASSESSMENT_ !== 'undefined') return QBO_INTEGRITY_REPAIR_ASSESSMENT_.HEADERS.length;
  if (name === QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.REPAIR_LOG_SHEET && typeof QBO_STATE_CAPTURE_EXACT_REPAIR_ !== 'undefined') return QBO_STATE_CAPTURE_EXACT_REPAIR_.LOG_HEADERS.length;
  if (name === QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.REGISTERED_AT_EVIDENCE_SHEET && typeof QBO_REGISTERED_AT_EVIDENCE_ASSESSMENT_ !== 'undefined') return QBO_REGISTERED_AT_EVIDENCE_ASSESSMENT_.HEADERS.length;
  if (name === QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.REGISTERED_AT_ARTIFACT_SCAN_SHEET && typeof QBO_REGISTERED_AT_ARTIFACT_SCAN_ !== 'undefined') return QBO_REGISTERED_AT_ARTIFACT_SCAN_.HEADERS.length;
  if (name === QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.NATIVE_CDC_REGISTERED_AT_ASSESSMENT_SHEET && typeof QBO_NATIVE_CDC_REGISTERED_AT_ASSESSMENT_ !== 'undefined') return QBO_NATIVE_CDC_REGISTERED_AT_ASSESSMENT_.HEADERS.length;
  if (name === QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.LIFECYCLE_TIMESTAMP_ASSESSMENT_SHEET && typeof QBO_LIFECYCLE_TIMESTAMP_ASSESSMENT_ !== 'undefined') return QBO_LIFECYCLE_TIMESTAMP_ASSESSMENT_.HEADERS.length;
  if (name === QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.HISTORICAL_TIMESTAMP_EXCEPTION_SHEET && typeof QBO_HISTORICAL_TIMESTAMP_EXCEPTION_GOVERNANCE_ !== 'undefined') return QBO_HISTORICAL_TIMESTAMP_EXCEPTION_GOVERNANCE_.HEADERS.length;
  if (name === QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.CONTROLLED_TEST_ASSESSMENT_SHEET && typeof QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_ !== 'undefined') return QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.SUMMARY_HEADERS.length;
  if (name === QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.CONTROLLED_TEST_ARTIFACT_SHEET && typeof QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_ !== 'undefined') return QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.ARTIFACT_HEADERS.length;
  return 0;
}


function qboWbAuditOverallStatus_(summary, ledgerAudit) {
  const wbInvalid = Number(summary && summary.findingResultCounts && summary.findingResultCounts.INVALID || 0);
  const wbUnverifiable = Number(summary && summary.findingResultCounts && summary.findingResultCounts.UNVERIFIABLE || 0);
  const ledgerInvalid = Number(ledgerAudit && ledgerAudit.summary && ledgerAudit.summary.invalidCount || 0);
  const ledgerUnverifiable = Number(ledgerAudit && ledgerAudit.summary && ledgerAudit.summary.unverifiableCount || 0);
  if (wbInvalid + ledgerInvalid > 0) return 'INVALID';
  if (wbUnverifiable + ledgerUnverifiable > 0) return 'UNVERIFIABLE';
  return 'VALID';
}

function qboWbAuditBuildDurableFindings_(ss, workbookFindings, ledgerFindings) {
  const out = [];
  const context = qboWbAuditBuildRowContext_(ss);
  (workbookFindings || []).forEach(function(f) {
    out.push(qboWbAuditNormalizeDurableFinding_(f, 'WORKBOOK_AUDIT', context));
  });
  (ledgerFindings || []).forEach(function(f) {
    out.push(qboWbAuditNormalizeDurableFinding_(f, 'LEDGER_AUDIT', context));
  });
  return out;
}

function qboWbAuditNormalizeDurableFinding_(f, sourceAudit, context) {
  const sheetName = String(f.sheetName || f.sheet || '');
  const rowNumber = Number(f.rowNumber || f.row || 0) || 0;
  const c = context[sheetName + '|' + rowNumber] || {};
  const result = String(f.result || 'UNVERIFIABLE');
  return {
    sourceAudit: sourceAudit,
    result: result,
    severity: result === 'INVALID' ? 'ERROR' : (result === 'UNVERIFIABLE' ? 'WARNING' : 'INFO'),
    sheetName: sheetName,
    rowNumber: rowNumber,
    columnOrRule: String(f.column || f.columnName || f.rule || ''),
    findingCode: String(f.code || f.findingCode || 'UNSPECIFIED'),
    detail: qboWbAuditLimitCellText_(f.detail || f.message || ''),
    sourceType: String(c.sourceType || ''),
    entityType: String(c.entityType || ''),
    recordId: String(c.recordId || ''),
    repairability: qboWbAuditRepairability_(f, c)
  };
}

function qboWbAuditBuildRowContext_(ss) {
  const out = Object.create(null);
  const specs = [
    {name:'05_Forward_Ingestion_Control', headers:QBO_FORWARD_INGESTION_HEADERS_, id:'IngestionSourceId', sourceType:'SourceType', entityType:'EntityType'},
    {name:'01_Sources', headers:QBO_STATE_CAPTURE_HEADERS.SOURCES, id:'SourceId', sourceType:'SourceAcquisitionType', entityType:'ExportKey'},
    {name:'10_Snapshot_Records', headers:QBO_STATE_CAPTURE_HEADERS.SNAPSHOTS, id:'SnapshotRecordId', sourceType:'SourceAcquisitionType', entityType:'EntityType'},
    {name:'11_Change_Records', headers:QBO_STATE_CAPTURE_HEADERS.CHANGES, id:'ChangeRecordId', sourceType:'SourceAcquisitionType', entityType:'EntityType'},
    {name:'12_Change_Detail', headers:QBO_STATE_CAPTURE_HEADERS.CHANGE_DETAIL, id:'ChangeDetailId', sourceType:'', entityType:'EntityType'}
  ];
  specs.forEach(function(spec) {
    const sh = ss.getSheetByName(spec.name);
    if (!sh || sh.getLastRow() < 2) return;
    const values = sh.getRange(2,1,sh.getLastRow()-1,spec.headers.length).getValues();
    const idx = Object.create(null);
    spec.headers.forEach(function(h,i){idx[h]=i;});
    values.forEach(function(r,i) {
      out[spec.name + '|' + (i+2)] = {
        recordId: spec.id && idx[spec.id] !== undefined ? r[idx[spec.id]] : '',
        sourceType: spec.sourceType && idx[spec.sourceType] !== undefined ? r[idx[spec.sourceType]] : '',
        entityType: spec.entityType && idx[spec.entityType] !== undefined ? r[idx[spec.entityType]] : ''
      };
    });
  });
  return out;
}

function qboWbAuditRepairability_(f, context) {
  const code = String(f.code || f.findingCode || '');
  if (code === 'REGISTERED_AT_REQUIRED' || code === 'REQUIRED_TIMESTAMP_BLANK' || code.indexOf('REGISTERED_AT') >= 0) return 'EVIDENCE_RECONSTRUCTION_REQUIRED';
  if (code.indexOf('HEARTBEAT') >= 0 || code.indexOf('PROGRESS') >= 0 || code.indexOf('PROCESSED_AT') >= 0) return 'EVIDENCE_RECONSTRUCTION_REQUIRED';
  if (code.indexOf('CONTROLLED_TEST') >= 0 || String(context.recordId || '').indexOf('STATE_CAPTURE_AUTOREG_TEST_') >= 0) return 'GOVERNANCE_DISPOSITION_REQUIRED';
  if (code.indexOf('HEADER_') === 0) return 'CODE_CONTRACT_REVIEW_REQUIRED';
  if (String(f.result || '') === 'UNVERIFIABLE') return 'MANUAL_OR_SOURCE_REVIEW_REQUIRED';
  return 'UNASSESSED';
}

function qboWbAuditLimitCellText_(value) {
  const s = String(value === null || value === undefined ? '' : value);
  return s.length > 5000 ? s.slice(0, 5000) + '...[TRUNCATED]' : s;
}

function qboWbAuditPersistReport_(ss, data) {
  const runSheet = qboWbAuditEnsureReportSheet_(ss, QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.RUN_SHEET, QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.RUN_HEADERS);
  const findingSheet = qboWbAuditEnsureReportSheet_(ss, QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.FINDING_SHEET, QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.FINDING_HEADERS);
  const ledgerSummary = data.ledgerAudit && data.ledgerAudit.summary ? data.ledgerAudit.summary : {};
  const wbCounts = data.summary && data.summary.findingResultCounts ? data.summary.findingResultCounts : {};
  runSheet.appendRow([
    data.auditRunId,
    QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.VERSION,
    data.startedAt,
    data.completedAt,
    ss.getName(),
    'ALL_SHEETS_ALL_GOVERNED_COLUMNS_ALL_DATA_ROWS_PLUS_CROSS_SHEET_REFERENCES',
    ss.getSheets().filter(function(s){return !qboWbAuditIsDiagnosticOutputSheet_(s.getName());}).length,
    Number(wbCounts.INVALID || 0),
    Number(wbCounts.UNVERIFIABLE || 0),
    Number(ledgerSummary.checkCount || 0),
    Number(ledgerSummary.invalidCount || 0),
    Number(ledgerSummary.unverifiableCount || 0),
    data.findings.length,
    data.status,
    false,
    true
  ]);

  if (data.findings.length) {
    const recordedAt = new Date();
    const rows = data.findings.map(function(f, i) {
      return [data.auditRunId,i+1,f.sourceAudit,f.result,f.severity,f.sheetName,f.rowNumber,f.columnOrRule,f.findingCode,f.detail,f.sourceType,f.entityType,f.recordId,f.repairability,recordedAt];
    });
    findingSheet.getRange(findingSheet.getLastRow()+1,1,rows.length,QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.FINDING_HEADERS.length).setValues(rows);
  }
}

function qboWbAuditEnsureReportSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1,1,1,headers.length).setFontWeight('bold');
    sh.getDataRange().setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    return sh;
  }
  const lastCol = sh.getLastColumn();
  if (lastCol < headers.length) throw new Error('INTEGRITY_REPORT_HEADER_WIDTH_MISMATCH sheet=' + name);
  const actual = sh.getRange(1,1,1,headers.length).getValues()[0].map(function(v){return String(v || '');});
  for (let i=0;i<headers.length;i++) {
    if (actual[i] !== headers[i]) throw new Error('INTEGRITY_REPORT_HEADER_MISMATCH sheet=' + name + ' col=' + (i+1) + ' expected=' + headers[i] + ' actual=' + actual[i]);
  }
  return sh;
}

function qboWbAuditExpectedSheets_() {
  const map = Object.create(null);
  map[QBO_STATE_CAPTURE.SHEETS.CONTROL] = {headers: QBO_STATE_CAPTURE_HEADERS.CONTROL, kind: 'CONTROL'};
  map[QBO_STATE_CAPTURE.SHEETS.CANONICAL_CONTROL] = {headers: QBO_STATE_CAPTURE_HEADERS.CONTROL, kind: 'CANONICAL_CONTROL'};
  map[QBO_STATE_CAPTURE.SHEETS.SOURCES] = {headers: QBO_STATE_CAPTURE_HEADERS.SOURCES, kind: 'SOURCES'};
  map[QBO_STATE_CAPTURE.SHEETS.CDC_RUN_MANIFEST] = {headers: QBO_STATE_CAPTURE_HEADERS.CDC_RUN_MANIFEST, kind: 'CDC_RUN_MANIFEST'};
  map[QBO_STATE_CAPTURE.SHEETS.NATIVE_CDC_EVENTS] = {headers: QBO_STATE_CAPTURE_HEADERS.NATIVE_CDC_EVENTS, kind: 'NATIVE_CDC_EVENTS'};
  map[QBO_STATE_CAPTURE.SHEETS.WEBHOOK_EVENTS] = {headers: QBO_STATE_CAPTURE_HEADERS.WEBHOOK_EVENTS, kind: 'WEBHOOK_EVENTS'};
  map[QBO_FORWARD_INGESTION_CONTROL_.SHEET_NAME] = {headers: QBO_FORWARD_INGESTION_HEADERS_, kind: 'FORWARD_INGESTION'};
  map[QBO_STATE_CAPTURE.SHEETS.SNAPSHOTS] = {headers: QBO_STATE_CAPTURE_HEADERS.SNAPSHOTS, kind: 'SNAPSHOTS'};
  map[QBO_STATE_CAPTURE.SHEETS.STATES] = {headers: QBO_STATE_CAPTURE_HEADERS.STATES, kind: 'LEGACY_STATES'};
  map[QBO_STATE_CAPTURE.SHEETS.CHANGES] = {headers: QBO_STATE_CAPTURE_HEADERS.CHANGES, kind: 'CHANGES'};
  map[QBO_STATE_CAPTURE.SHEETS.CHANGE_DETAIL] = {headers: QBO_STATE_CAPTURE_HEADERS.CHANGE_DETAIL, kind: 'CHANGE_DETAIL'};
  map[QBO_STATE_CAPTURE.SHEETS.INGESTION_LOG] = {headers: QBO_STATE_CAPTURE_HEADERS.INGESTION_LOG, kind: 'INGESTION_LOG'};
  map[QBO_STATE_CAPTURE.SHEETS.RUN_LOG] = {headers: QBO_STATE_CAPTURE_HEADERS.RUN_LOG, kind: 'RUN_LOG'};
  map[QBO_STATE_CAPTURE.SHEETS.CONTRACT_AUDIT_PATHS] = {headers: QBO_STATE_CAPTURE_HEADERS.CONTRACT_AUDIT_PATHS, kind: 'CONTRACT_PATHS'};
  map[QBO_STATE_CAPTURE.SHEETS.CONTRACT_AUDIT_SOURCES] = {headers: QBO_STATE_CAPTURE_HEADERS.CONTRACT_AUDIT_SOURCES, kind: 'CONTRACT_SOURCES'};
  map[QBO_STATE_CAPTURE.SHEETS.CONTRACT_AUDIT_RUNS] = {headers: QBO_STATE_CAPTURE_HEADERS.CONTRACT_AUDIT_RUNS, kind: 'CONTRACT_RUNS'};
  return map;
}

function qboWbAuditSheet_(sheet, spec, findings) {
  const name = sheet.getName();
  const role = QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.SHEET_ROLES[name] || {
    role: 'GOVERNED_UNCLASSIFIED', disposition: 'REVIEW_REQUIRED', activeWriteExpected: false, note: ''
  };
  const headerResult = qboWbAuditHeaders_(sheet, spec.headers, findings);
  const lastRow = sheet.getLastRow();
  const rowCount = Math.max(0, lastRow - 1);
  let rowAudit = {checkedRows: 0, invalidRows: 0, unverifiableRows: 0};

  if (rowCount > 0) {
    rowAudit = qboWbAuditRows_(sheet, spec, findings);
  } else if (role.activeWriteExpected && ['01_Sources','05_Forward_Ingestion_Control'].indexOf(name) >= 0) {
    qboWbAuditFinding_(findings, name, 0, '', 'ACTIVE_LEDGER_EMPTY', 'UNVERIFIABLE', 'Active production ledger has no data rows.');
  }

  // Reserved/unwired source-event sheets are expected to be header-only today.
  if (['02_CDC_Run_Manifest','03_Native_CDC_Events','04_Webhook_Events'].indexOf(name) >= 0 && rowCount > 0) {
    qboWbAuditFinding_(findings, name, 0, '', 'UNWIRED_SHEET_HAS_DATA', 'UNVERIFIABLE', 'Sheet is classified un-wired in the current architecture but contains data; ownership must be reviewed before deprecation.');
  }

  return {
    sheetName: name,
    role: role.role,
    disposition: role.disposition,
    activeWriteExpected: role.activeWriteExpected,
    roleNote: role.note,
    rowCount: rowCount,
    columnCount: sheet.getLastColumn(),
    expectedColumnCount: spec.headers.length,
    headerStatus: headerResult.status,
    rowsChecked: rowAudit.checkedRows,
    invalidRows: rowAudit.invalidRows,
    unverifiableRows: rowAudit.unverifiableRows,
    status: headerResult.status === 'INVALID' || rowAudit.invalidRows > 0 ? 'INVALID' : (rowAudit.unverifiableRows > 0 ? 'UNVERIFIABLE' : 'VALID')
  };
}

function qboWbAuditSheetResult_(name, spec, sheet, status) {
  const role = QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.SHEET_ROLES[name] || {};
  return {
    sheetName: name,
    role: role.role || 'GOVERNED_UNCLASSIFIED',
    disposition: role.disposition || 'REVIEW_REQUIRED',
    activeWriteExpected: Boolean(role.activeWriteExpected),
    roleNote: role.note || '',
    rowCount: sheet ? Math.max(0, sheet.getLastRow() - 1) : 0,
    columnCount: sheet ? sheet.getLastColumn() : 0,
    expectedColumnCount: spec.headers.length,
    status: status
  };
}

function qboWbAuditHeaders_(sheet, expected, findings) {
  const name = sheet.getName();
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) {
    qboWbAuditFinding_(findings, name, 1, '', 'HEADER_ROW_MISSING', 'INVALID', 'Sheet has no header columns.');
    return {status:'INVALID'};
  }
  const actual = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(v){return String(v || '').trim();});
  let invalid = false;
  if (actual.length !== expected.length) {
    invalid = true;
    qboWbAuditFinding_(findings, name, 1, '', 'HEADER_COLUMN_COUNT_MISMATCH', 'INVALID', 'expected=' + expected.length + ' actual=' + actual.length);
  }
  const n = Math.max(actual.length, expected.length);
  for (let i = 0; i < n; i++) {
    if (String(actual[i] || '') !== String(expected[i] || '')) {
      invalid = true;
      qboWbAuditFinding_(findings, name, 1, expected[i] || actual[i] || ('COL_' + (i + 1)), 'HEADER_MISMATCH', 'INVALID', 'position=' + (i + 1) + ' expected=' + String(expected[i] || '') + ' actual=' + String(actual[i] || ''));
    }
  }
  return {status: invalid ? 'INVALID' : 'VALID'};
}

function qboWbAuditRows_(sheet, spec, findings) {
  const name = sheet.getName();
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, spec.headers.length).getValues();
  let invalidRows = 0;
  let unverifiableRows = 0;
  rows.forEach(function(values, idx) {
    const rowNumber = idx + 2;
    const row = Object.create(null);
    spec.headers.forEach(function(h, i){ row[h] = values[i]; });
    const before = findings.length;
    qboWbAuditRowByKind_(name, spec.kind, rowNumber, row, findings);
    let invalid = false;
    let unverifiable = false;
    for (let i = before; i < findings.length; i++) {
      if (findings[i].rowNumber !== rowNumber || findings[i].sheetName !== name) continue;
      if (findings[i].result === 'INVALID') invalid = true;
      if (findings[i].result === 'UNVERIFIABLE') unverifiable = true;
    }
    if (invalid) invalidRows++;
    else if (unverifiable) unverifiableRows++;
  });
  return {checkedRows: rows.length, invalidRows: invalidRows, unverifiableRows: unverifiableRows};
}

function qboWbAuditRowByKind_(sheetName, kind, rowNumber, row, findings) {
  switch (kind) {
    case 'CONTROL':
    case 'CANONICAL_CONTROL':
      qboWbAuditRequired_(sheetName,rowNumber,'Key',row.Key,findings);
      qboWbAuditRequired_(sheetName,rowNumber,'Value',row.Value,findings);
      break;
    case 'SOURCES':
    case 'FORWARD_INGESTION':
      // Fully audited by v1.5.76 ledger sub-audit; structural presence only here.
      break;
    case 'CDC_RUN_MANIFEST':
      qboWbAuditRequired_(sheetName,rowNumber,'CdcRunId',row.CdcRunId,findings);
      qboWbAuditDate_(sheetName,rowNumber,'RunStartedAt',row.RunStartedAt,false,findings);
      qboWbAuditDate_(sheetName,rowNumber,'RunCompletedAt',row.RunCompletedAt,true,findings);
      qboWbAuditNonnegative_(sheetName,rowNumber,'ReturnedEntityCount',row.ReturnedEntityCount,true,findings);
      break;
    case 'NATIVE_CDC_EVENTS':
      ['NativeCdcEventId','CdcRunId','SourceId','EntityType','EntityId','IngestionStatus'].forEach(function(c){qboWbAuditRequired_(sheetName,rowNumber,c,row[c],findings);});
      qboWbAuditHash_(sheetName,rowNumber,'RawPayloadHash',row.RawPayloadHash,true,findings);
      break;
    case 'WEBHOOK_EVENTS':
      ['WebhookEventId','WebhookDeliveryId','EntityType','EntityId','EventOperation','IngestionStatus'].forEach(function(c){qboWbAuditRequired_(sheetName,rowNumber,c,row[c],findings);});
      qboWbAuditDate_(sheetName,rowNumber,'ReceivedAt',row.ReceivedAt,false,findings);
      qboWbAuditHash_(sheetName,rowNumber,'RawPayloadHash',row.RawPayloadHash,true,findings);
      break;
    case 'SNAPSHOTS':
      ['SnapshotRecordId','SnapshotRecordVersion','SourceId','SourceAcquisitionType','EntityType','EntityId','CanonicalizationVersion','CanonicalStateHash','SnapshotReason','CapturedAt'].forEach(function(c){qboWbAuditRequired_(sheetName,rowNumber,c,row[c],findings);});
      qboWbAuditPrefix_(sheetName,rowNumber,'SnapshotRecordId',row.SnapshotRecordId,'SNAPSHOT|',findings);
      qboWbAuditHash_(sheetName,rowNumber,'CanonicalStateHash',row.CanonicalStateHash,false,findings);
      qboWbAuditHash_(sheetName,rowNumber,'RawPayloadHash',row.RawPayloadHash,true,findings);
      qboWbAuditDate_(sheetName,rowNumber,'CapturedAt',row.CapturedAt,false,findings);
      break;
    case 'LEGACY_STATES':
      ['CaptureId','CaptureVersion','SourceAcquisitionType','ExportKey','EntityType','EntityId','StateHash','CaptureReason','CapturedAt'].forEach(function(c){qboWbAuditRequired_(sheetName,rowNumber,c,row[c],findings);});
      qboWbAuditPrefix_(sheetName,rowNumber,'CaptureId',row.CaptureId,'CAPTURE|',findings);
      if (String(row.CaptureVersion || '') !== 'STATE_ROW_V1') qboWbAuditFinding_(findings,sheetName,rowNumber,'CaptureVersion','LEGACY_CAPTURE_VERSION_UNEXPECTED','INVALID','Expected STATE_ROW_V1.');
      qboWbAuditHash_(sheetName,rowNumber,'StateHash',row.StateHash,false,findings);
      qboWbAuditHash_(sheetName,rowNumber,'RawPayloadHash',row.RawPayloadHash,true,findings);
      qboWbAuditDate_(sheetName,rowNumber,'CapturedAt',row.CapturedAt,false,findings);
      break;
    case 'CHANGES':
      ['ChangeRecordId','ChangeRecordVersion','EntityType','EntityId','ChangeType','DetectedAt','SourceId','AfterSnapshotRecordId','AfterCanonicalHash','CreatedAt'].forEach(function(c){qboWbAuditRequired_(sheetName,rowNumber,c,row[c],findings);});
      qboWbAuditPrefix_(sheetName,rowNumber,'ChangeRecordId',row.ChangeRecordId,'CHANGE|',findings);
      qboWbAuditHash_(sheetName,rowNumber,'AfterCanonicalHash',row.AfterCanonicalHash,false,findings);
      qboWbAuditHash_(sheetName,rowNumber,'BeforeCanonicalHash',row.BeforeCanonicalHash,true,findings);
      qboWbAuditNonnegative_(sheetName,rowNumber,'ChangedFieldCount',row.ChangedFieldCount,false,findings);
      qboWbAuditDate_(sheetName,rowNumber,'DetectedAt',row.DetectedAt,false,findings);
      qboWbAuditDate_(sheetName,rowNumber,'CreatedAt',row.CreatedAt,false,findings);
      break;
    case 'CHANGE_DETAIL':
      ['ChangeDetailId','ChangeDetailVersion','ChangeRecordId','Sequence','EntityType','EntityId','Path','Operation','Classification','CreatedAt'].forEach(function(c){qboWbAuditRequired_(sheetName,rowNumber,c,row[c],findings);});
      qboWbAuditPrefix_(sheetName,rowNumber,'ChangeDetailId',row.ChangeDetailId,'DETAIL|',findings);
      qboWbAuditNonnegative_(sheetName,rowNumber,'Sequence',row.Sequence,false,findings);
      qboWbAuditHash_(sheetName,rowNumber,'BeforeValueHash',row.BeforeValueHash,true,findings);
      qboWbAuditHash_(sheetName,rowNumber,'AfterValueHash',row.AfterValueHash,true,findings);
      qboWbAuditDate_(sheetName,rowNumber,'CreatedAt',row.CreatedAt,false,findings);
      break;
    case 'INGESTION_LOG':
      ['IngestionRunId','StartedAt','Operation','ProcessingPhase','Status','CodeVersion','CreatedAt'].forEach(function(c){qboWbAuditRequired_(sheetName,rowNumber,c,row[c],findings);});
      qboWbAuditDate_(sheetName,rowNumber,'StartedAt',row.StartedAt,false,findings);
      qboWbAuditDate_(sheetName,rowNumber,'CompletedAt',row.CompletedAt,true,findings);
      qboWbAuditDate_(sheetName,rowNumber,'CreatedAt',row.CreatedAt,false,findings);
      ['SourceRowsScanned','EntitiesEvaluated','EligibleSources','AlreadyRegistered','RegisteredSources','SkippedSources','SnapshotsCreated','ChangesCreated','ChangeDetailsCreated','UnchangedEntities','ErrorCount'].forEach(function(c){qboWbAuditNonnegative_(sheetName,rowNumber,c,row[c],true,findings);});
      break;
    case 'RUN_LOG':
      ['CaptureRunId','StartedAt','Operation','Status'].forEach(function(c){qboWbAuditRequired_(sheetName,rowNumber,c,row[c],findings);});
      qboWbAuditDate_(sheetName,rowNumber,'StartedAt',row.StartedAt,false,findings);
      qboWbAuditDate_(sheetName,rowNumber,'CompletedAt',row.CompletedAt,true,findings);
      break;
    case 'CONTRACT_PATHS':
      ['RunId','ExportKey','SourceId','ContractLevel','SheetName','CanonicalPath','CoverageStatus','AuditedAt'].forEach(function(c){qboWbAuditRequired_(sheetName,rowNumber,c,row[c],findings);});
      qboWbAuditNonnegative_(sheetName,rowNumber,'ObservedCount',row.ObservedCount,false,findings);
      qboWbAuditNonnegative_(sheetName,rowNumber,'NonBlankObservedCount',row.NonBlankObservedCount,false,findings);
      qboWbAuditDate_(sheetName,rowNumber,'AuditedAt',row.AuditedAt,false,findings);
      break;
    case 'CONTRACT_SOURCES':
      ['RunId','ExportKey','SourceId','Status','StartedAt','CompletedAt'].forEach(function(c){qboWbAuditRequired_(sheetName,rowNumber,c,row[c],findings);});
      ['ParentRows','CompleteParentRawRows','TruncatedParentRawRows','InvalidParentRawRows','ChildRows','CompleteChildEvidenceRows','TruncatedChildEvidenceRows','InvalidChildEvidenceRows','PathsObserved','CoveredPaths','ReviewPaths','UncoveredPaths'].forEach(function(c){qboWbAuditNonnegative_(sheetName,rowNumber,c,row[c],false,findings);});
      qboWbAuditDate_(sheetName,rowNumber,'StartedAt',row.StartedAt,false,findings);
      qboWbAuditDate_(sheetName,rowNumber,'CompletedAt',row.CompletedAt,false,findings);
      break;
    case 'CONTRACT_RUNS':
      ['RunId','Version','CanonicalizationVersion','Status','StartedAt'].forEach(function(c){qboWbAuditRequired_(sheetName,rowNumber,c,row[c],findings);});
      ['ExportCount','SourceCountProcessed','PathRowsWritten','CoveredPaths','ReviewPaths','UncoveredPaths','ErrorCount','CursorExportIndex','CursorSourceIndex'].forEach(function(c){qboWbAuditNonnegative_(sheetName,rowNumber,c,row[c],true,findings);});
      qboWbAuditDate_(sheetName,rowNumber,'StartedAt',row.StartedAt,false,findings);
      qboWbAuditDate_(sheetName,rowNumber,'CompletedAt',row.CompletedAt,true,findings);
      break;
  }
}

function qboWbAuditCrossReferences_(ss, findings) {
  const sourceIds = qboWbAuditIdSet_(ss, QBO_STATE_CAPTURE.SHEETS.SOURCES, 1);
  const snapshotIds = qboWbAuditIdSet_(ss, QBO_STATE_CAPTURE.SHEETS.SNAPSHOTS, 1);
  const changeIds = qboWbAuditIdSet_(ss, QBO_STATE_CAPTURE.SHEETS.CHANGES, 1);
  const contractRunIds = qboWbAuditIdSet_(ss, QBO_STATE_CAPTURE.SHEETS.CONTRACT_AUDIT_RUNS, 1);

  qboWbAuditReferenceColumn_(ss, QBO_STATE_CAPTURE.SHEETS.SNAPSHOTS, 'SourceId', sourceIds, findings, function(v){return /^FULL_EXPORT(?:_LEGACY)?\|/.test(v);});
  qboWbAuditReferenceColumn_(ss, QBO_STATE_CAPTURE.SHEETS.CHANGES, 'BeforeSnapshotRecordId', snapshotIds, findings, function(v){return Boolean(v);});
  qboWbAuditReferenceColumn_(ss, QBO_STATE_CAPTURE.SHEETS.CHANGES, 'AfterSnapshotRecordId', snapshotIds, findings, function(v){return Boolean(v);});
  qboWbAuditReferenceColumn_(ss, QBO_STATE_CAPTURE.SHEETS.CHANGE_DETAIL, 'ChangeRecordId', changeIds, findings, function(v){return Boolean(v);});
  qboWbAuditReferenceColumn_(ss, QBO_STATE_CAPTURE.SHEETS.CONTRACT_AUDIT_PATHS, 'RunId', contractRunIds, findings, function(v){return Boolean(v);});
  qboWbAuditReferenceColumn_(ss, QBO_STATE_CAPTURE.SHEETS.CONTRACT_AUDIT_SOURCES, 'RunId', contractRunIds, findings, function(v){return Boolean(v);});
}

function qboWbAuditIdSet_(ss, sheetName, columnNumber) {
  const sheet = ss.getSheetByName(sheetName);
  const set = Object.create(null);
  if (!sheet || sheet.getLastRow() < 2) return set;
  sheet.getRange(2, columnNumber, sheet.getLastRow() - 1, 1).getValues().forEach(function(r){
    const v = String(r[0] || '').trim();
    if (v) set[v] = true;
  });
  return set;
}

function qboWbAuditReferenceColumn_(ss, sheetName, header, targetSet, findings, applies) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return;
  const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();});
  const idx = headers.indexOf(header);
  if (idx < 0) return;
  const vals = sheet.getRange(2, idx + 1, sheet.getLastRow() - 1, 1).getValues();
  vals.forEach(function(r,i){
    const v = String(r[0] || '').trim();
    if (!applies(v)) return;
    if (!targetSet[v]) qboWbAuditFinding_(findings, sheetName, i + 2, header, 'CROSS_SHEET_REFERENCE_NOT_FOUND', 'INVALID', 'reference=' + v);
  });
}

function qboWbAuditRequired_(sheet,row,col,value,findings) {
  if (value === null || value === undefined || String(value).trim() === '') qboWbAuditFinding_(findings,sheet,row,col,'REQUIRED_VALUE_BLANK','INVALID','Required governed value is blank.');
}

function qboWbAuditPrefix_(sheet,row,col,value,prefix,findings) {
  const v = String(value || '').trim();
  if (v && v.indexOf(prefix) !== 0) qboWbAuditFinding_(findings,sheet,row,col,'IDENTITY_PREFIX_MISMATCH','INVALID','expectedPrefix=' + prefix + ' actual=' + v);
}

function qboWbAuditHash_(sheet,row,col,value,allowBlank,findings) {
  const v = String(value || '').trim();
  if (!v) {
    if (!allowBlank) qboWbAuditFinding_(findings,sheet,row,col,'HASH_REQUIRED_BLANK','INVALID','Expected SHA-256 value.');
    return;
  }
  if (!QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.SHA256_RE.test(v)) qboWbAuditFinding_(findings,sheet,row,col,'HASH_FORMAT_INVALID','INVALID','Expected 64 hexadecimal SHA-256 characters.');
}

function qboWbAuditDate_(sheet,row,col,value,allowBlank,findings) {
  if (value === null || value === undefined || String(value).trim() === '') {
    if (!allowBlank) qboWbAuditFinding_(findings,sheet,row,col,'TIMESTAMP_REQUIRED_BLANK','INVALID','Required timestamp is blank.');
    return;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) qboWbAuditFinding_(findings,sheet,row,col,'TIMESTAMP_INVALID','INVALID','Value is not a valid date/time.');
}

function qboWbAuditNonnegative_(sheet,row,col,value,allowBlank,findings) {
  if (value === null || value === undefined || String(value).trim() === '') {
    if (!allowBlank) qboWbAuditFinding_(findings,sheet,row,col,'NUMBER_REQUIRED_BLANK','INVALID','Required nonnegative numeric value is blank.');
    return;
  }
  const n = Number(value);
  if (!isFinite(n) || n < 0) qboWbAuditFinding_(findings,sheet,row,col,'NONNEGATIVE_NUMBER_INVALID','INVALID','value=' + String(value));
}

function qboWbAuditFinding_(findings,sheet,row,col,code,result,detail) {
  findings.push({sheetName:sheet,rowNumber:row,column:col,code:code,result:result,detail:detail});
}

function qboWbAuditSummarize_(sheetResults, findings) {
  const resultCounts = {VALID:0,UNVERIFIABLE:0,INVALID:0,MISSING:0};
  const dispositionCounts = Object.create(null);
  sheetResults.forEach(function(s){
    resultCounts[s.status] = (resultCounts[s.status] || 0) + 1;
    dispositionCounts[s.disposition] = (dispositionCounts[s.disposition] || 0) + 1;
  });
  const findingCounts = {INVALID:0,UNVERIFIABLE:0,VALID:0,VALID_BLANK:0};
  const byCode = Object.create(null);
  findings.forEach(function(f){
    findingCounts[f.result] = (findingCounts[f.result] || 0) + 1;
    byCode[f.code] = (byCode[f.code] || 0) + 1;
  });
  return {
    sheetStatusCounts: resultCounts,
    dispositionCounts: dispositionCounts,
    findingResultCounts: findingCounts,
    findingCodeCounts: byCode,
    totalFindings: findings.length
  };
}
