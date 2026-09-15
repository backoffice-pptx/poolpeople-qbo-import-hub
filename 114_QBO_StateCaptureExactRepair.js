/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 114_QBO_StateCaptureExactRepair.js
 * Version     : 1.5.80
 * Purpose     : Controlled exact-value repair for State Capture integrity
 *               findings that have already been proven by durable assessment.
 *
 * Safety / scope:
 *   - Repairs ONLY 05_Forward_Ingestion_Control.RegisteredAt.
 *   - Repairs ONLY rows assessed EXACT_REPAIR_AVAILABLE with EXACT confidence,
 *     AutoRepairEligible=true, and authoritative source 01_Sources.RegisteredAt.
 *   - Re-resolves by IngestionSourceId; never trusts historical row number alone.
 *   - Re-validates the exact same SourceId and exact source timestamp before write.
 *   - Fails closed during preflight before any production-cell mutation.
 *   - Existing nonblank values are never overwritten. Exact already-applied values
 *     are treated idempotently as ALREADY_APPLIED.
 *   - Writes append-only repair telemetry to 97_Integrity_Repair_Log.
 *   - Does not mutate 01_Sources, state outputs, Drive evidence, triggers,
 *     Script Properties, Change Payloads, or pipeline pause state.
 * ============================================================================
 */

const QBO_STATE_CAPTURE_EXACT_REPAIR_ = Object.freeze({
  VERSION: 'QBO_STATE_CAPTURE_EXACT_REPAIR_V2_RESUMABLE_VERIFY',
  LOG_SHEET: '97_Integrity_Repair_Log',
  LOG_HEADERS: Object.freeze([
    'RepairRunId','AssessmentRunId','AuditRunId','RepairSequence','SheetName',
    'IngestionSourceId','EntityType','ColumnName','OldValue','NewValue',
    'AuthoritativeSource','EvidenceReference','Result','RepairAppliedAt'
  ]),
  TARGET_SHEET: '05_Forward_Ingestion_Control',
  TARGET_COLUMN: 'RegisteredAt',
  SOURCE_SHEET: '01_Sources',
  SOURCE_COLUMN: 'RegisteredAt'
});

/**
 * Public controlled repair entry point.
 * Applies only exact, pre-assessed FULL_EXPORT RegisteredAt repairs.
 */
function repairQboStateCaptureExactRegisteredAt() {
  const ss = getQboStateCaptureSpreadsheet_();
  const startedAt = new Date();
  const repairRunId = 'STATE_CAPTURE_EXACT_REPAIR|' + Utilities.getUuid();
  const assessmentRunId = qboExactRepairLatestAssessmentRunId_(ss);
  if (!assessmentRunId) throw new Error('EXACT_REPAIR_NO_ASSESSMENT_RUN');

  const assessed = qboExactRepairReadEligibleAssessmentRows_(ss, assessmentRunId);
  if (!assessed.length) {
    const empty = {
      version: QBO_STATE_CAPTURE_EXACT_REPAIR_.VERSION,
      repairRunId: repairRunId,
      assessmentRunId: assessmentRunId,
      eligibleFindingCount: 0,
      appliedCount: 0,
      alreadyAppliedCount: 0,
      productionDataMutationApplied: false,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString()
    };
    console.log('[STATE CAPTURE EXACT REPAIR] | COMPLETE | ' + JSON.stringify(empty));
    return empty;
  }

  const ctx = qboExactRepairBuildContext_(ss);
  const plan = assessed.map(function(a) {
    return qboExactRepairPlanOne_(a, ctx);
  });

  const blockers = plan.filter(function(p) { return p.result === 'BLOCKED'; });
  if (blockers.length) {
    throw new Error('EXACT_REPAIR_PREFLIGHT_BLOCKED ' + JSON.stringify(blockers.slice(0, 20)));
  }

  const target = ctx.targetSheet;
  const registeredCol = ctx.targetHeaders.indexOf(QBO_STATE_CAPTURE_EXACT_REPAIR_.TARGET_COLUMN) + 1;
  let appliedCount = 0;
  let alreadyAppliedCount = 0;
  const logRows = [];

  let failedCount = 0;
  plan.forEach(function(p, i) {
    let result = p.result;
    let appliedAt = '';
    if (p.result === 'READY') {
      const writeResult = qboExactRepairWriteVerifyWithRetry_(target, registeredCol, p);
      result = writeResult.result;
      if (writeResult.verified) {
        appliedAt = new Date();
        appliedCount++;
      } else {
        failedCount++;
      }
    } else if (p.result === 'ALREADY_APPLIED') {
      alreadyAppliedCount++;
    }

    const oneLogRow = [[
      repairRunId, assessmentRunId, p.auditRunId, i + 1,
      QBO_STATE_CAPTURE_EXACT_REPAIR_.TARGET_SHEET, p.recordId, p.entityType,
      QBO_STATE_CAPTURE_EXACT_REPAIR_.TARGET_COLUMN, p.oldIso, p.newIso,
      '01_Sources.RegisteredAt', p.evidenceReference, result, appliedAt
    ]];
    qboExactRepairAppendLog_(ss, oneLogRow);
  });

  const result = {
    version: QBO_STATE_CAPTURE_EXACT_REPAIR_.VERSION,
    repairRunId: repairRunId,
    assessmentRunId: assessmentRunId,
    eligibleFindingCount: assessed.length,
    appliedCount: appliedCount,
    alreadyAppliedCount: alreadyAppliedCount,
    blockedCount: 0,
    failedVerificationCount: failedCount,
    targetSheet: QBO_STATE_CAPTURE_EXACT_REPAIR_.TARGET_SHEET,
    targetColumn: QBO_STATE_CAPTURE_EXACT_REPAIR_.TARGET_COLUMN,
    authoritativeSource: '01_Sources.RegisteredAt',
    repairLogSheet: QBO_STATE_CAPTURE_EXACT_REPAIR_.LOG_SHEET,
    productionDataMutationApplied: appliedCount > 0,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    status: failedCount ? 'PARTIAL' : 'SUCCESS'
  };
  console.log('[STATE CAPTURE EXACT REPAIR] | COMPLETE | ' + JSON.stringify(result));
  return result;
}

function qboExactRepairWriteVerifyWithRetry_(target, registeredCol, p) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Re-resolve by identity before every attempt so row drift cannot misdirect a write.
    const idValues = target.getRange(2,1,Math.max(0,target.getLastRow()-1),1).getValues();
    let rowNumber = 0;
    for (let i = 0; i < idValues.length; i++) {
      if (String(idValues[i][0] || '').trim() === p.recordId) { rowNumber = i + 2; break; }
    }
    if (!rowNumber) return {verified:false, result:'FAILED_TARGET_ID_NOT_FOUND_DURING_WRITE'};

    const cell = target.getRange(rowNumber, registeredCol);
    const beforeIso = qboExactRepairIso_(cell.getValue());
    if (beforeIso === p.newIso) return {verified:true, result:'ALREADY_APPLIED_EXACT_DURING_RETRY'};
    if (beforeIso && beforeIso !== p.newIso) return {verified:false, result:'FAILED_TARGET_CHANGED_BEFORE_WRITE'};

    cell.setValue(p.newDate);
    SpreadsheetApp.flush();
    Utilities.sleep(250 * attempt);

    // Re-resolve again after the write and verify the exact persisted ISO value.
    const rereadIds = target.getRange(2,1,Math.max(0,target.getLastRow()-1),1).getValues();
    let rereadRow = 0;
    for (let j = 0; j < rereadIds.length; j++) {
      if (String(rereadIds[j][0] || '').trim() === p.recordId) { rereadRow = j + 2; break; }
    }
    if (!rereadRow) return {verified:false, result:'FAILED_TARGET_ID_NOT_FOUND_AFTER_WRITE'};
    const rereadIso = qboExactRepairIso_(target.getRange(rereadRow, registeredCol).getValue());
    if (rereadIso === p.newIso) return {verified:true, result:'APPLIED_VERIFIED_ATTEMPT_' + attempt};
  }
  return {verified:false, result:'FAILED_POSTWRITE_VERIFY_AFTER_3_ATTEMPTS'};
}

function qboExactRepairLatestAssessmentRunId_(ss) {
  const sh = ss.getSheetByName(QBO_INTEGRITY_REPAIR_ASSESSMENT_.SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) return '';
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();});
  const runIdx = headers.indexOf('AssessmentRunId');
  const atIdx = headers.indexOf('AssessedAt');
  if (runIdx < 0) return '';
  const values = sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues();
  let selected = '';
  let selectedMs = -1;
  values.forEach(function(r) {
    const runId = String(r[runIdx] || '').trim();
    if (!runId) return;
    const d = atIdx >= 0 ? qboExactRepairDate_(r[atIdx]) : null;
    const ms = d ? d.getTime() : 0;
    if (ms >= selectedMs) { selected = runId; selectedMs = ms; }
  });
  return selected;
}

function qboExactRepairReadEligibleAssessmentRows_(ss, assessmentRunId) {
  const sh = ss.getSheetByName(QBO_INTEGRITY_REPAIR_ASSESSMENT_.SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) throw new Error('EXACT_REPAIR_ASSESSMENT_SHEET_MISSING');
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();});
  const idx = Object.create(null);
  headers.forEach(function(h,i){idx[h]=i;});
  ['AssessmentRunId','AuditRunId','SheetName','ColumnOrRule','SourceType','EntityType','RecordId','Assessment','CandidateValue','CandidateSource','EvidenceReference','Confidence','AutoRepairEligible'].forEach(function(h){
    if (idx[h] === undefined) throw new Error('EXACT_REPAIR_ASSESSMENT_HEADER_MISSING ' + h);
  });
  return sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues().filter(function(r) {
    return String(r[idx.AssessmentRunId] || '').trim() === assessmentRunId &&
      String(r[idx.Assessment] || '').trim() === QBO_INTEGRITY_REPAIR_ASSESSMENT_.EXACT &&
      String(r[idx.SheetName] || '').trim() === QBO_STATE_CAPTURE_EXACT_REPAIR_.TARGET_SHEET &&
      String(r[idx.ColumnOrRule] || '').trim() === QBO_STATE_CAPTURE_EXACT_REPAIR_.TARGET_COLUMN &&
      String(r[idx.SourceType] || '').trim() === 'FULL_EXPORT' &&
      String(r[idx.CandidateSource] || '').trim() === '01_Sources.RegisteredAt' &&
      String(r[idx.Confidence] || '').trim() === 'EXACT' &&
      qboExactRepairBoolean_(r[idx.AutoRepairEligible]) === true;
  }).map(function(r) {
    return {
      auditRunId: String(r[idx.AuditRunId] || '').trim(),
      entityType: String(r[idx.EntityType] || '').trim(),
      recordId: String(r[idx.RecordId] || '').trim(),
      candidateValue: r[idx.CandidateValue],
      evidenceReference: String(r[idx.EvidenceReference] || '').trim()
    };
  });
}

function qboExactRepairBuildContext_(ss) {
  const targetSheet = ss.getSheetByName(QBO_STATE_CAPTURE_EXACT_REPAIR_.TARGET_SHEET);
  const sourceSheet = ss.getSheetByName(QBO_STATE_CAPTURE_EXACT_REPAIR_.SOURCE_SHEET);
  if (!targetSheet || !sourceSheet) throw new Error('EXACT_REPAIR_REQUIRED_SHEET_MISSING');
  const targetHeaders = targetSheet.getRange(1,1,1,targetSheet.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();});
  const sourceHeaders = sourceSheet.getRange(1,1,1,sourceSheet.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();});
  const targetKeyIdx = targetHeaders.indexOf('IngestionSourceId');
  const sourceKeyIdx = sourceHeaders.indexOf('SourceId');
  const sourceRegisteredIdx = sourceHeaders.indexOf('RegisteredAt');
  if (targetKeyIdx < 0 || targetHeaders.indexOf('RegisteredAt') < 0 || sourceKeyIdx < 0 || sourceRegisteredIdx < 0) throw new Error('EXACT_REPAIR_REQUIRED_HEADER_MISSING');

  const targetById = Object.create(null);
  if (targetSheet.getLastRow() > 1) {
    targetSheet.getRange(2,1,targetSheet.getLastRow()-1,targetSheet.getLastColumn()).getValues().forEach(function(r,i) {
      const id = String(r[targetKeyIdx] || '').trim();
      if (id) targetById[id] = {rowNumber:i+2, values:r};
    });
  }
  const sourceById = Object.create(null);
  if (sourceSheet.getLastRow() > 1) {
    sourceSheet.getRange(2,1,sourceSheet.getLastRow()-1,sourceSheet.getLastColumn()).getValues().forEach(function(r,i) {
      const id = String(r[sourceKeyIdx] || '').trim();
      if (id) sourceById[id] = {rowNumber:i+2, registeredAt:r[sourceRegisteredIdx]};
    });
  }
  return {targetSheet:targetSheet, sourceSheet:sourceSheet, targetHeaders:targetHeaders, sourceHeaders:sourceHeaders, targetById:targetById, sourceById:sourceById};
}

function qboExactRepairPlanOne_(a, ctx) {
  const target = ctx.targetById[a.recordId];
  const source = ctx.sourceById[a.recordId];
  if (!target) return qboExactRepairBlockedPlan_(a, 'TARGET_SOURCE_ID_NOT_FOUND');
  if (!source) return qboExactRepairBlockedPlan_(a, 'AUTHORITATIVE_SOURCE_ID_NOT_FOUND');
  const candidateDate = qboExactRepairDate_(a.candidateValue);
  const sourceDate = qboExactRepairDate_(source.registeredAt);
  if (!candidateDate || !sourceDate) return qboExactRepairBlockedPlan_(a, 'CANDIDATE_OR_SOURCE_DATE_INVALID');
  const candidateIso = candidateDate.toISOString();
  const sourceIso = sourceDate.toISOString();
  if (candidateIso !== sourceIso) return qboExactRepairBlockedPlan_(a, 'ASSESSMENT_SOURCE_VALUE_MISMATCH');

  const regIdx = ctx.targetHeaders.indexOf('RegisteredAt');
  const oldValue = target.values[regIdx];
  const oldIso = qboExactRepairIso_(oldValue);
  if (oldIso && oldIso !== candidateIso) return qboExactRepairBlockedPlan_(a, 'TARGET_NONBLANK_DIFFERENT_VALUE');

  return {
    result: oldIso === candidateIso ? 'ALREADY_APPLIED' : 'READY',
    auditRunId: a.auditRunId,
    entityType: a.entityType,
    recordId: a.recordId,
    targetRowNumber: target.rowNumber,
    oldIso: oldIso,
    newIso: candidateIso,
    newDate: candidateDate,
    evidenceReference: a.evidenceReference
  };
}

function qboExactRepairBlockedPlan_(a, reason) {
  return {result:'BLOCKED', reason:reason, auditRunId:a.auditRunId, entityType:a.entityType, recordId:a.recordId, evidenceReference:a.evidenceReference};
}

function qboExactRepairAppendLog_(ss, rows) {
  let sh = ss.getSheetByName(QBO_STATE_CAPTURE_EXACT_REPAIR_.LOG_SHEET);
  if (!sh) sh = ss.insertSheet(QBO_STATE_CAPTURE_EXACT_REPAIR_.LOG_SHEET);
  const headers = QBO_STATE_CAPTURE_EXACT_REPAIR_.LOG_HEADERS.slice();
  if (sh.getLastRow() === 0) {
    sh.getRange(1,1,1,headers.length).setValues([headers]);
  } else {
    const actual = sh.getRange(1,1,1,Math.max(sh.getLastColumn(),headers.length)).getValues()[0].slice(0,headers.length).map(function(v){return String(v||'').trim();});
    if (actual.join('\u001f') !== headers.join('\u001f')) throw new Error('EXACT_REPAIR_LOG_HEADER_MISMATCH');
  }
  if (rows.length) sh.getRange(sh.getLastRow()+1,1,rows.length,headers.length).setValues(rows);
  SpreadsheetApp.flush();
}

function qboExactRepairDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function qboExactRepairIso_(value) {
  const d = qboExactRepairDate_(value);
  return d ? d.toISOString() : '';
}

function qboExactRepairBoolean_(value) {
  if (value === true || value === false) return value;
  const s = String(value || '').trim().toLowerCase();
  if (s === 'true') return true;
  if (s === 'false') return false;
  return null;
}
