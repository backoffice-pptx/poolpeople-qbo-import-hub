/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 117_QBO_NativeCdcRegisteredAtRecoveryAssessment.js
 * Version     : 1.5.90
 * Purpose     : Read-only exact-evidence assessment for blank Native CDC
 *               05_Forward_Ingestion_Control.RegisteredAt values.
 *
 * Evidence doctrine:
 *   - Current Native CDC registration (104) captures one registeredAt = new Date()
 *     per cycle before iterating entityEvidence rows.
 *   - Historical Native CDC registration (105) likewise captures one
 *     registrationTime = new Date() per cycle before iterating entities.
 *   - Therefore a surviving nonblank RegisteredAt in the same SourceRunId/cycle
 *     is exact writer-contract evidence for blank siblings only when all
 *     surviving nonblank sibling values agree exactly.
 *   - RequestCompletedAt, evidence-file timestamps, payload timestamps,
 *     manifest times, and ingestion telemetry are NOT substituted.
 *
 * Safety:
 *   - Does NOT mutate 05 or any production/state data.
 *   - Writes only diagnostic output to 100_Native_CDC_RegAt_Assessment.
 *   - Does NOT repair values.
 * ============================================================================
 */

const QBO_NATIVE_CDC_REGISTERED_AT_ASSESSMENT_ = Object.freeze({
  VERSION: 'QBO_NATIVE_CDC_REGISTERED_AT_RECOVERY_ASSESSMENT_V1_5_90',
  SHEET_NAME: '100_Native_CDC_RegAt_Assessment',
  HEADERS: Object.freeze([
    'AssessmentRunId','AuditRunId','IngestionSourceId','SourceRunId','EntityType',
    'TargetRowNumber','ProcessingStatus','CurrentRegisteredAt','Assessment',
    'CandidateRegisteredAt','EvidenceBasis','CycleRowCount','BlankCycleRowCount',
    'NonblankCycleRowCount','DistinctNonblankRegisteredAtCount',
    'NonblankSiblingEvidence','ExactRepairEligible','Detail','AssessedAt'
  ]),
  EXACT: 'EXACT_RECOVERABLE',
  NOT_RECOVERABLE: 'HISTORICAL_TIMESTAMP_NOT_RECOVERABLE',
  CONFLICT: 'CONFLICTING_SAME_CYCLE_REGISTERED_AT_VALUES'
});

/**
 * Public v1.5.90 entry point.
 */
function assessQboNativeCdcRegisteredAtExactRecovery() {
  const startedAt = new Date();
  const assessmentRunId = 'NATIVE_CDC_REGISTERED_AT_ASSESSMENT|' + Utilities.getUuid();
  const ss = getQboStateCaptureSpreadsheet_();
  const auditRunId = qboNativeRegAtLatestAuditRunId_(ss);
  if (!auditRunId) throw new Error('NATIVE_CDC_REGISTERED_AT_NO_AUDIT_RUN');

  const ledger = qboNativeRegAtRead05_(ss);
  const targetIds = qboNativeRegAtReadBlankFindingIds_(ss, auditRunId);
  const targetMap = Object.create(null);
  targetIds.forEach(function(id) { targetMap[id] = true; });

  const nativeRows = ledger.rows.filter(function(r) { return r.SourceType === 'NATIVE_CDC'; });
  const targets = nativeRows.filter(function(r) {
    return !!targetMap[r.IngestionSourceId] && !qboNativeRegAtIso_(r.RegisteredAt);
  });

  const byCycle = Object.create(null);
  nativeRows.forEach(function(r) {
    const k = r.SourceRunId;
    if (!byCycle[k]) byCycle[k] = [];
    byCycle[k].push(r);
  });

  const assessedAt = new Date();
  const assessed = targets.map(function(target) {
    const cycleRows = byCycle[target.SourceRunId] || [];
    const distinct = Object.create(null);
    const evidence = [];
    let blankCount = 0;
    let nonblankCount = 0;

    cycleRows.forEach(function(r) {
      const iso = qboNativeRegAtIso_(r.RegisteredAt);
      if (!iso) {
        blankCount += 1;
        return;
      }
      nonblankCount += 1;
      distinct[iso] = true;
      evidence.push('row=' + r.rowNumber + '|entity=' + r.EntityType + '|registeredAt=' + iso);
    });

    const values = Object.keys(distinct).sort();
    let assessment = QBO_NATIVE_CDC_REGISTERED_AT_ASSESSMENT_.NOT_RECOVERABLE;
    let candidate = '';
    let basis = 'NO_DURABLE_SAME_CYCLE_REGISTERED_AT_SURVIVES';
    let eligible = false;
    let detail = 'Every Native CDC 05 row in this SourceRunId/cycle has blank RegisteredAt. No exact timestamp survives in the governed ledger. Proximate timestamps are not substitutes.';

    if (values.length === 1) {
      assessment = QBO_NATIVE_CDC_REGISTERED_AT_ASSESSMENT_.EXACT;
      candidate = values[0];
      basis = 'NATIVE_CDC_SAME_CYCLE_SHARED_REGISTERED_AT_WRITER_CONTRACT';
      eligible = true;
      detail = 'Exactly one nonblank RegisteredAt value survives in the cycle. Current and historical Native CDC registration writers capture one timestamp before iterating all entity rows, so this value is exact contract evidence for blank siblings in the same SourceRunId.';
    } else if (values.length > 1) {
      assessment = QBO_NATIVE_CDC_REGISTERED_AT_ASSESSMENT_.CONFLICT;
      basis = 'WRITER_CONTRACT_CONFLICT';
      detail = 'Multiple distinct nonblank RegisteredAt values survive inside one Native CDC SourceRunId/cycle, which conflicts with the shared-timestamp writer contract. No repair is authorized.';
    }

    return {
      target: target,
      assessment: assessment,
      candidate: candidate,
      basis: basis,
      cycleRowCount: cycleRows.length,
      blankCount: blankCount,
      nonblankCount: nonblankCount,
      distinctCount: values.length,
      evidence: evidence.join(';'),
      eligible: eligible,
      detail: detail,
      assessedAt: assessedAt
    };
  });

  qboNativeRegAtPersist_(ss, assessmentRunId, auditRunId, assessed);

  const assessmentCounts = Object.create(null);
  const cycleSummary = Object.create(null);
  let exactRepairEligibleCount = 0;
  assessed.forEach(function(a) {
    assessmentCounts[a.assessment] = Number(assessmentCounts[a.assessment] || 0) + 1;
    if (a.eligible) exactRepairEligibleCount += 1;
    if (!cycleSummary[a.target.SourceRunId]) {
      cycleSummary[a.target.SourceRunId] = {
        assessment: a.assessment,
        blankTargetCount: 0,
        cycleRowCount: a.cycleRowCount,
        blankCycleRowCount: a.blankCount,
        nonblankCycleRowCount: a.nonblankCount,
        distinctNonblankRegisteredAtCount: a.distinctCount,
        candidateRegisteredAt: a.candidate
      };
    }
    cycleSummary[a.target.SourceRunId].blankTargetCount += 1;
  });

  const cycleCounts = {EXACT_RECOVERABLE:0,HISTORICAL_TIMESTAMP_NOT_RECOVERABLE:0,CONFLICTING_SAME_CYCLE_REGISTERED_AT_VALUES:0};
  Object.keys(cycleSummary).forEach(function(k) {
    const a = cycleSummary[k].assessment;
    cycleCounts[a] = Number(cycleCounts[a] || 0) + 1;
  });

  const result = {
    version: QBO_NATIVE_CDC_REGISTERED_AT_ASSESSMENT_.VERSION,
    status: 'DIAGNOSTIC_COMPLETE',
    productionDataReadOnly: true,
    diagnosticOutputWritten: true,
    repairApplied: false,
    productionDataMutationApplied: false,
    assessmentRunId: assessmentRunId,
    auditRunId: auditRunId,
    latestAuditBlankRegisteredAtFindingCount: targetIds.length,
    nativeCdcBlankTargetCount: targets.length,
    exactRepairEligibleCount: exactRepairEligibleCount,
    assessmentCounts: assessmentCounts,
    nativeCdcTargetCycleCount: Object.keys(cycleSummary).length,
    nativeCdcCycleAssessmentCounts: cycleCounts,
    nativeCdcCycleSummary: cycleSummary,
    evidenceContract: 'ONE_REGISTERED_AT_PER_NATIVE_CDC_CYCLE_SHARED_ACROSS_ENTITY_REGISTRATIONS',
    proximateTimestampSubstitutionAuthorized: false,
    outputSheet: QBO_NATIVE_CDC_REGISTERED_AT_ASSESSMENT_.SHEET_NAME,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString()
  };

  console.log('[NATIVE CDC REGISTERED AT ASSESSMENT] | COMPLETE | ' + JSON.stringify(result, null, 2));
  return result;
}

function qboNativeRegAtRead05_(ss) {
  const sh = ss.getSheetByName('05_Forward_Ingestion_Control');
  if (!sh || sh.getLastRow() < 2) throw new Error('NATIVE_CDC_REGISTERED_AT_05_EMPTY');
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(function(v){ return String(v || '').trim(); });
  const idx = qboNativeRegAtIndex_(headers, ['IngestionSourceId','SourceType','SourceRunId','EntityType','ProcessingStatus','RegisteredAt']);
  const values = sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues();
  return {
    sheet: sh,
    headers: headers,
    idx: idx,
    rows: values.map(function(r, i) {
      return {
        rowNumber: i + 2,
        IngestionSourceId: String(r[idx.IngestionSourceId] || '').trim(),
        SourceType: String(r[idx.SourceType] || '').trim(),
        SourceRunId: String(r[idx.SourceRunId] || '').trim(),
        EntityType: String(r[idx.EntityType] || '').trim(),
        ProcessingStatus: String(r[idx.ProcessingStatus] || '').trim(),
        RegisteredAt: r[idx.RegisteredAt]
      };
    })
  };
}

function qboNativeRegAtReadBlankFindingIds_(ss, auditRunId) {
  const sh = ss.getSheetByName('95_Integrity_Audit_Findings');
  if (!sh || sh.getLastRow() < 2) throw new Error('NATIVE_CDC_REGISTERED_AT_FINDINGS_EMPTY');
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(function(v){ return String(v || '').trim(); });
  const idx = qboNativeRegAtIndex_(headers, ['AuditRunId','Result','SheetName','ColumnOrRule','FindingCode','RecordId']);
  const out = [];
  sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues().forEach(function(r) {
    if (String(r[idx.AuditRunId] || '').trim() !== auditRunId) return;
    if (String(r[idx.Result] || '').trim() !== 'INVALID') return;
    if (String(r[idx.SheetName] || '').trim() !== '05_Forward_Ingestion_Control') return;
    if (String(r[idx.ColumnOrRule] || '').trim() !== 'RegisteredAt') return;
    if (String(r[idx.FindingCode] || '').trim() !== 'REQUIRED_DATE_BLANK') return;
    const id = String(r[idx.RecordId] || '').trim();
    if (id) out.push(id);
  });
  return out;
}

function qboNativeRegAtLatestAuditRunId_(ss) {
  const sh = ss.getSheetByName('94_Integrity_Audit_Runs');
  if (!sh || sh.getLastRow() < 2) return '';
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(function(v){ return String(v || '').trim(); });
  const idx = qboNativeRegAtIndex_(headers, ['AuditRunId','CompletedAt']);
  let best = '';
  let bestMs = -1;
  sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues().forEach(function(r) {
    const id = String(r[idx.AuditRunId] || '').trim();
    const d = qboNativeRegAtDate_(r[idx.CompletedAt]);
    if (id && d && d.getTime() >= bestMs) {
      best = id;
      bestMs = d.getTime();
    }
  });
  return best;
}

function qboNativeRegAtPersist_(ss, assessmentRunId, auditRunId, assessed) {
  let sh = ss.getSheetByName(QBO_NATIVE_CDC_REGISTERED_AT_ASSESSMENT_.SHEET_NAME);
  const h = QBO_NATIVE_CDC_REGISTERED_AT_ASSESSMENT_.HEADERS;
  if (!sh) {
    sh = ss.insertSheet(QBO_NATIVE_CDC_REGISTERED_AT_ASSESSMENT_.SHEET_NAME);
    sh.getRange(1,1,1,h.length).setValues([h]);
    sh.setFrozenRows(1);
    sh.getRange(1,1,1,h.length).setFontWeight('bold');
    sh.getDataRange().setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  } else {
    if (sh.getLastColumn() < h.length) throw new Error('NATIVE_CDC_REGISTERED_AT_ASSESSMENT_HEADER_WIDTH_MISMATCH');
    const actual = sh.getRange(1,1,1,h.length).getValues()[0].map(function(v){ return String(v || '').trim(); });
    h.forEach(function(x,i){ if (actual[i] !== x) throw new Error('NATIVE_CDC_REGISTERED_AT_ASSESSMENT_HEADER_MISMATCH col=' + (i+1) + ' expected=' + x + ' actual=' + actual[i]); });
  }

  if (!assessed.length) return;
  const rows = assessed.map(function(a) {
    return [
      assessmentRunId,
      auditRunId,
      a.target.IngestionSourceId,
      a.target.SourceRunId,
      a.target.EntityType,
      a.target.rowNumber,
      a.target.ProcessingStatus,
      qboNativeRegAtIso_(a.target.RegisteredAt),
      a.assessment,
      a.candidate,
      a.basis,
      a.cycleRowCount,
      a.blankCount,
      a.nonblankCount,
      a.distinctCount,
      a.evidence,
      a.eligible,
      a.detail,
      a.assessedAt
    ];
  });
  sh.getRange(sh.getLastRow()+1,1,rows.length,h.length).setValues(rows);
  sh.getDataRange().setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
}

function qboNativeRegAtIndex_(headers, required) {
  const out = Object.create(null);
  required.forEach(function(name) {
    const i = headers.indexOf(name);
    if (i < 0) throw new Error('NATIVE_CDC_REGISTERED_AT_REQUIRED_COLUMN_MISSING ' + name);
    out[name] = i;
  });
  return out;
}

function qboNativeRegAtDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function qboNativeRegAtIso_(v) {
  const d = qboNativeRegAtDate_(v);
  return d ? d.toISOString() : '';
}
