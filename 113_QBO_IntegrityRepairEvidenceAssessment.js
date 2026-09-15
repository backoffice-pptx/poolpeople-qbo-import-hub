/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 113_QBO_IntegrityRepairEvidenceAssessment.js
 * Version     : 1.5.79
 * Purpose     : Read-only assessment of durable State Capture integrity-audit
 *               findings to determine whether exact repair evidence exists.
 *
 * Safety:
 *   - Does NOT modify production/state data.
 *   - Does NOT repair 01_Sources or 05_Forward_Ingestion_Control.
 *   - Does NOT alter Drive evidence, triggers, or Script Properties.
 *   - Writes only append-only diagnostic assessment rows to
 *     96_Integrity_Repair_Assessment.
 *
 * Doctrine:
 *   - Never manufacture historical lifecycle timestamps.
 *   - EXACT_REPAIR_AVAILABLE requires an authoritative source containing the
 *     exact governed value, not a merely nearby/correlated timestamp.
 *   - Corroborating timestamps are retained as evidence but are not promoted
 *     to exact repair values unless the source contract proves equivalence.
 * ============================================================================
 */

const QBO_INTEGRITY_REPAIR_ASSESSMENT_ = Object.freeze({
  VERSION: 'QBO_INTEGRITY_REPAIR_EVIDENCE_ASSESSMENT_V1',
  SHEET_NAME: '96_Integrity_Repair_Assessment',
  HEADERS: Object.freeze([
    'AssessmentRunId','AuditRunId','FindingSequence','FindingCode','FindingResult',
    'SheetName','RowNumber','ColumnOrRule','SourceType','EntityType','RecordId',
    'Assessment','CandidateValue','CandidateSource','EvidenceType','EvidenceReference',
    'Confidence','AutoRepairEligible','AssessmentDetail','AssessedAt'
  ]),
  EXACT: 'EXACT_REPAIR_AVAILABLE',
  FALSE_POSITIVE: 'CONTRACT_FALSE_POSITIVE',
  HISTORICAL_EXCEPTION: 'HISTORICAL_EXCEPTION',
  GOVERNANCE: 'GOVERNANCE_DISPOSITION',
  REVIEW: 'SOURCE_EVIDENCE_REVIEW_REQUIRED'
});

/**
 * Public entry point. Assesses the most recent durable workbook integrity run.
 */
function assessQboStateCaptureIntegrityRepairEvidence() {
  const ss = getQboStateCaptureSpreadsheet_();
  const auditRunId = qboIntegrityRepairLatestAuditRunId_(ss);
  if (!auditRunId) throw new Error('INTEGRITY_REPAIR_ASSESSMENT_NO_AUDIT_RUN');

  const startedAt = new Date();
  const assessmentRunId = 'STATE_CAPTURE_REPAIR_ASSESSMENT|' + Utilities.getUuid();
  const findingRows = qboIntegrityRepairReadAuditFindings_(ss, auditRunId);
  const ctx = qboIntegrityRepairBuildContext_(ss);
  const assessments = findingRows.map(function(f) {
    return qboIntegrityRepairAssessFinding_(f, ctx);
  });

  qboIntegrityRepairPersist_(ss, assessmentRunId, auditRunId, assessments);

  const counts = Object.create(null);
  const exactByColumn = Object.create(null);
  assessments.forEach(function(a) {
    counts[a.assessment] = (counts[a.assessment] || 0) + 1;
    if (a.assessment === QBO_INTEGRITY_REPAIR_ASSESSMENT_.EXACT) {
      exactByColumn[a.columnOrRule] = (exactByColumn[a.columnOrRule] || 0) + 1;
    }
  });

  const result = {
    version: QBO_INTEGRITY_REPAIR_ASSESSMENT_.VERSION,
    productionDataReadOnly: true,
    auditRunId: auditRunId,
    assessmentRunId: assessmentRunId,
    findingCount: findingRows.length,
    assessmentCounts: counts,
    exactRepairByColumn: exactByColumn,
    outputSheet: QBO_INTEGRITY_REPAIR_ASSESSMENT_.SHEET_NAME,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    repairApplied: false,
    productionDataMutationApplied: false
  };
  console.log('[STATE CAPTURE REPAIR EVIDENCE] | COMPLETE | ' + JSON.stringify(result));
  return result;
}

function qboIntegrityRepairLatestAuditRunId_(ss) {
  const sh = ss.getSheetByName(QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.RUN_SHEET);
  if (!sh || sh.getLastRow() < 2) return '';
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();});
  const auditIdx = headers.indexOf('AuditRunId');
  const completedIdx = headers.indexOf('CompletedAt');
  if (auditIdx < 0) return '';
  const values = sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues();
  let selected = '';
  let selectedMs = -1;
  values.forEach(function(row) {
    const id = String(row[auditIdx] || '').trim();
    if (!id) return;
    const d = completedIdx >= 0 ? qboIntegrityRepairDate_(row[completedIdx]) : null;
    const ms = d ? d.getTime() : 0;
    if (ms >= selectedMs) { selected = id; selectedMs = ms; }
  });
  return selected;
}

function qboIntegrityRepairReadAuditFindings_(ss, auditRunId) {
  const sh = ss.getSheetByName(QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.FINDING_SHEET);
  if (!sh || sh.getLastRow() < 2) throw new Error('INTEGRITY_REPAIR_ASSESSMENT_FINDINGS_MISSING');
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();});
  const idx = Object.create(null);
  headers.forEach(function(h,i){idx[h]=i;});
  const required = ['AuditRunId','FindingSequence','Result','SheetName','RowNumber','ColumnOrRule','FindingCode','Detail','SourceType','EntityType','RecordId'];
  required.forEach(function(h){if(idx[h]===undefined) throw new Error('INTEGRITY_REPAIR_ASSESSMENT_FINDING_HEADER_MISSING ' + h);});
  const values = sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues();
  return values.filter(function(r){return String(r[idx.AuditRunId]||'')===auditRunId;}).map(function(r){
    return {
      auditRunId: auditRunId,
      findingSequence: Number(r[idx.FindingSequence] || 0),
      result: String(r[idx.Result] || ''),
      sheetName: String(r[idx.SheetName] || ''),
      rowNumber: Number(r[idx.RowNumber] || 0),
      columnOrRule: String(r[idx.ColumnOrRule] || ''),
      findingCode: String(r[idx.FindingCode] || ''),
      detail: String(r[idx.Detail] || ''),
      sourceType: String(r[idx.SourceType] || ''),
      entityType: String(r[idx.EntityType] || ''),
      recordId: String(r[idx.RecordId] || '')
    };
  });
}

function qboIntegrityRepairBuildContext_(ss) {
  return {
    source01: qboIntegrityRepairReadRowsByKey_(ss, QBO_STATE_CAPTURE.SHEETS.SOURCES, 'SourceId'),
    ledger05: qboIntegrityRepairReadRowsByKey_(ss, QBO_FORWARD_INGESTION_CONTROL_.SHEET_NAME, 'IngestionSourceId'),
    ingestion90: qboIntegrityRepairReadRowsMulti_(ss, QBO_STATE_CAPTURE.SHEETS.INGESTION_LOG, 'SourceId')
  };
}

function qboIntegrityRepairReadRowsByKey_(ss, sheetName, keyHeader) {
  const sh = ss.getSheetByName(sheetName);
  const out = Object.create(null);
  if (!sh || sh.getLastRow() < 2) return out;
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();});
  const keyIdx = headers.indexOf(keyHeader);
  if (keyIdx < 0) return out;
  sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues().forEach(function(r,i){
    const key = String(r[keyIdx] || '').trim();
    if (!key) return;
    const obj = {rowNumber:i+2};
    headers.forEach(function(h,j){obj[h]=r[j];});
    out[key] = obj;
  });
  return out;
}

function qboIntegrityRepairReadRowsMulti_(ss, sheetName, keyHeader) {
  const sh = ss.getSheetByName(sheetName);
  const out = Object.create(null);
  if (!sh || sh.getLastRow() < 2) return out;
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();});
  const keyIdx = headers.indexOf(keyHeader);
  if (keyIdx < 0) return out;
  sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues().forEach(function(r,i){
    const key = String(r[keyIdx] || '').trim();
    if (!key) return;
    const obj = {rowNumber:i+2};
    headers.forEach(function(h,j){obj[h]=r[j];});
    if (!out[key]) out[key] = [];
    out[key].push(obj);
  });
  return out;
}

function qboIntegrityRepairAssessFinding_(f, ctx) {
  const base = {
    findingSequence: f.findingSequence,
    findingCode: f.findingCode,
    findingResult: f.result,
    sheetName: f.sheetName,
    rowNumber: f.rowNumber,
    columnOrRule: f.columnOrRule,
    sourceType: f.sourceType,
    entityType: f.entityType,
    recordId: f.recordId,
    assessment: QBO_INTEGRITY_REPAIR_ASSESSMENT_.REVIEW,
    candidateValue: '', candidateSource: '', evidenceType: '', evidenceReference: '',
    confidence: 'NONE', autoRepairEligible: false, detail: ''
  };

  if (f.findingCode === '05_REGISTERED_AT_EXACT_RECOVERY_EVIDENCE') {
    return qboIntegrityRepairExact01RegisteredAt_(base, f, ctx);
  }

  if (f.findingCode === '05_vs_01_RequestStartedAt_UNVERIFIABLE' ||
      f.findingCode === '05_vs_01_RequestCompletedAt_UNVERIFIABLE') {
    base.assessment = QBO_INTEGRITY_REPAIR_ASSESSMENT_.FALSE_POSITIVE;
    base.confidence = 'HIGH';
    base.evidenceType = 'CONTRACT_SEMANTICS';
    base.evidenceReference = '01_Sources ObservationStartedAt/ObservationCompletedAt vs 05 request timestamps';
    base.detail = 'The compared columns have different governed semantics. 01_Sources records export observation timing; 05 request timestamps are source-adapter/request evidence and are not required to equal 01 observation timestamps unless a source-specific contract explicitly declares equivalence.';
    return base;
  }

  if (f.findingCode === 'CONTROLLED_TEST_SOURCE_NON_PRODUCTION' ||
      f.findingCode === 'CONTROLLED_TEST_PRESENT_IN_05') {
    base.assessment = QBO_INTEGRITY_REPAIR_ASSESSMENT_.GOVERNANCE;
    base.confidence = 'HIGH';
    base.evidenceType = 'CONTROLLED_TEST_IDENTITY';
    base.evidenceReference = f.recordId;
    base.detail = 'Controlled test evidence should be retained but explicitly excluded from production discovery/reconstruction. Existing downstream payload lineage requires controlled governance disposition rather than deletion.';
    return base;
  }

  if (f.findingCode === 'REQUIRED_DATE_BLANK' && f.sheetName === QBO_FORWARD_INGESTION_CONTROL_.SHEET_NAME) {
    if (f.columnOrRule === 'RegisteredAt' && f.sourceType === 'FULL_EXPORT') {
      return qboIntegrityRepairExact01RegisteredAt_(base, f, ctx);
    }
    return qboIntegrityRepairAssessLifecycleTimestamp_(base, f, ctx);
  }

  base.detail = 'No rule-specific exact recovery contract is currently defined for this finding. Preserve as review-required until an authoritative source proves the exact governed value.';
  return base;
}

function qboIntegrityRepairExact01RegisteredAt_(base, f, ctx) {
  const source = ctx.source01[f.recordId];
  if (source && source.RegisteredAt) {
    const d = qboIntegrityRepairDate_(source.RegisteredAt);
    if (d) {
      base.assessment = QBO_INTEGRITY_REPAIR_ASSESSMENT_.EXACT;
      base.candidateValue = d.toISOString();
      base.candidateSource = '01_Sources.RegisteredAt';
      base.evidenceType = 'AUTHORITATIVE_CROSS_SHEET_EXACT_VALUE';
      base.evidenceReference = '01_Sources!row=' + source.rowNumber + '|SourceId=' + f.recordId;
      base.confidence = 'EXACT';
      base.autoRepairEligible = true;
      base.detail = '05 RegisteredAt is blank and the exact same FULL_EXPORT SourceId has a governed RegisteredAt value in authoritative 01_Sources.';
      return base;
    }
  }
  base.assessment = QBO_INTEGRITY_REPAIR_ASSESSMENT_.REVIEW;
  base.detail = 'Expected exact FULL_EXPORT RegisteredAt recovery evidence was not available at assessment time.';
  return base;
}

function qboIntegrityRepairAssessLifecycleTimestamp_(base, f, ctx) {
  const ledger = ctx.ledger05[f.recordId] || null;
  const telemetry = ctx.ingestion90[f.recordId] || [];
  const telemetryEvidence = qboIntegrityRepairTelemetryEvidence_(telemetry);

  base.evidenceType = telemetryEvidence ? 'CORROBORATING_TELEMETRY_NOT_EXACT' : 'NO_EXACT_DURABLE_TIMESTAMP_FOUND';
  base.evidenceReference = telemetryEvidence ? telemetryEvidence.reference : f.recordId;
  base.candidateValue = telemetryEvidence ? telemetryEvidence.value : '';
  base.candidateSource = telemetryEvidence ? telemetryEvidence.source : '';
  base.confidence = telemetryEvidence ? 'CORROBORATING_ONLY' : 'NONE';
  base.autoRepairEligible = false;

  if (f.sourceType === 'NATIVE_CDC') {
    base.assessment = QBO_INTEGRITY_REPAIR_ASSESSMENT_.REVIEW;
    base.detail = 'Native CDC durable manifests prove acquisition/run/request timing and committed evidence, but they do not govern the exact 05 registration/checkpoint write instant. Do not substitute manifest request/run timestamps for ' + f.columnOrRule + '. ' + qboIntegrityRepairLedgerContext_(ledger);
    return base;
  }
  if (f.sourceType === 'WEBHOOK') {
    base.assessment = QBO_INTEGRITY_REPAIR_ASSESSMENT_.REVIEW;
    base.detail = 'Webhook receipt receivedAt, targeted-fetch capture time, and historical reconstruction evidence are source/observation timestamps, not the exact 05 ledger lifecycle write instant. Do not substitute them for ' + f.columnOrRule + '. ' + qboIntegrityRepairLedgerContext_(ledger);
    return base;
  }
  if (f.sourceType === 'FULL_EXPORT') {
    base.assessment = QBO_INTEGRITY_REPAIR_ASSESSMENT_.REVIEW;
    base.detail = '01_Sources observation timestamps and immutable payload-shard creation times bound processing activity but are not contractually identical to the exact 05 ' + f.columnOrRule + ' write instant. No exact value should be manufactured. ' + qboIntegrityRepairLedgerContext_(ledger);
    return base;
  }

  base.assessment = QBO_INTEGRITY_REPAIR_ASSESSMENT_.REVIEW;
  base.detail = 'No exact governed recovery source has been established for the missing lifecycle timestamp. ' + qboIntegrityRepairLedgerContext_(ledger);
  return base;
}

function qboIntegrityRepairTelemetryEvidence_(rows) {
  if (!rows || !rows.length) return null;
  const completed = rows.filter(function(r){return r.CompletedAt;});
  if (completed.length !== 1) return null;
  const d = qboIntegrityRepairDate_(completed[0].CompletedAt);
  if (!d) return null;
  return {
    value: d.toISOString(),
    source: '90_Ingestion_Log.CompletedAt',
    reference: '90_Ingestion_Log!row=' + completed[0].rowNumber + '|IngestionRunId=' + String(completed[0].IngestionRunId || '')
  };
}

function qboIntegrityRepairLedgerContext_(ledger) {
  if (!ledger) return 'Ledger row was not found by IngestionSourceId at assessment time.';
  return 'Ledger status=' + String(ledger.ProcessingStatus || '') +
    ', cursor=' + String(ledger.RecordCursor === undefined ? '' : ledger.RecordCursor) +
    ', observations=' + String(ledger.ObservationCount === undefined ? '' : ledger.ObservationCount) +
    ', payloads=' + String(ledger.PayloadCount === undefined ? '' : ledger.PayloadCount) + '.';
}

function qboIntegrityRepairDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return new Date(value.getTime());
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function qboIntegrityRepairPersist_(ss, assessmentRunId, auditRunId, assessments) {
  const headers = QBO_INTEGRITY_REPAIR_ASSESSMENT_.HEADERS;
  let sh = ss.getSheetByName(QBO_INTEGRITY_REPAIR_ASSESSMENT_.SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(QBO_INTEGRITY_REPAIR_ASSESSMENT_.SHEET_NAME);
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1,1,1,headers.length).setFontWeight('bold');
    sh.getDataRange().setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  } else {
    if (sh.getLastColumn() < headers.length) throw new Error('INTEGRITY_REPAIR_ASSESSMENT_HEADER_WIDTH_MISMATCH');
    const actual = sh.getRange(1,1,1,headers.length).getValues()[0].map(function(v){return String(v||'');});
    for (let i=0;i<headers.length;i++) {
      if (actual[i] !== headers[i]) throw new Error('INTEGRITY_REPAIR_ASSESSMENT_HEADER_MISMATCH col=' + (i+1));
    }
  }
  if (!assessments.length) return;
  const assessedAt = new Date();
  const rows = assessments.map(function(a){
    return [assessmentRunId,auditRunId,a.findingSequence,a.findingCode,a.findingResult,a.sheetName,a.rowNumber,a.columnOrRule,a.sourceType,a.entityType,a.recordId,a.assessment,a.candidateValue,a.candidateSource,a.evidenceType,a.evidenceReference,a.confidence,a.autoRepairEligible,a.detail,assessedAt];
  });
  sh.getRange(sh.getLastRow()+1,1,rows.length,headers.length).setValues(rows);
}
