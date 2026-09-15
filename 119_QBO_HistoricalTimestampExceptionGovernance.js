/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 119_QBO_HistoricalTimestampExceptionGovernance.js
 * Version     : 1.5.92
 * Purpose     : Establish and audit an exact-identity governance registry for
 *               historical forward-ingestion timestamps that are known to be
 *               contract-required but whose exact historical value is no
 *               longer recoverable.
 *
 * Governance doctrine:
 *   - Historical blanks are NOT repaired and no timestamp is fabricated.
 *   - Only the exact IngestionSourceId + ColumnName pairs proven unrecoverable
 *     by the completed recovery assessments may be registered.
 *   - The exception is identity-scoped, not date-scoped and not source-type-
 *     scoped. A future equivalent blank on any other source remains INVALID.
 *   - Production/state data is never mutated by this module. The only write is
 *     the diagnostic/governance registry 102_Historical_Timestamp_Exceptions.
 * ============================================================================
 */

const QBO_HISTORICAL_TIMESTAMP_EXCEPTION_GOVERNANCE_ = Object.freeze({
  VERSION: 'QBO_HISTORICAL_TIMESTAMP_EXCEPTION_GOVERNANCE_V1_5_92',
  SHEET_NAME: '102_Historical_Timestamp_Exceptions',
  EXCEPTION_CODE: 'HISTORICAL_UNRECOVERABLE_WRITER_DEFECT',
  STATUS_ACTIVE: 'ACTIVE',
  TARGET_COLUMNS: Object.freeze(['RegisteredAt','LastHeartbeatAt','LastProgressAt','ProcessedAt']),
  EXPECTED_COUNTS: Object.freeze({
    RegisteredAt: 107,
    LastHeartbeatAt: 127,
    LastProgressAt: 115,
    ProcessedAt: 115,
    TOTAL: 464,
    NATIVE_CDC_REGISTERED_AT: 106,
    WEBHOOK_REGISTERED_AT: 1,
    LIFECYCLE_TOTAL: 357
  }),
  HEADERS: Object.freeze([
    'ExceptionId','IngestionSourceId','SourceType','SourceRunId','EntityType','ProcessingStatus',
    'ColumnName','ExceptionCode','Status','SourceAuditRunId','RecoveryAssessmentRunId',
    'RecoveryAssessment','EvidenceBasis','CutoverRule','ForwardControl','GovernanceVersion',
    'GovernedAt','Detail'
  ])
});

/**
 * Public establishment function.
 * Writes only the governed exception registry. No production/state mutation.
 * Idempotent: an already-established identical registry is retained.
 */
function establishQboHistoricalTimestampExceptionGovernance() {
  const startedAt = new Date();
  const ss = getQboStateCaptureSpreadsheet_();
  const auditRunId = qboHistExcLatestAuditRunId_(ss);
  if (!auditRunId) throw new Error('HIST_EXC_NO_AUDIT_RUN');

  const auditTargets = qboHistExcReadAuditTargets_(ss, auditRunId);
  qboHistExcAssertExpectedAuditTargetCounts_(auditTargets);

  const ledgerById = qboHistExcRead05ById_(ss);
  const nativeAssessment = qboHistExcReadLatestAssessmentMap_(
    ss,
    '100_Native_CDC_RegAt_Assessment',
    'IngestionSourceId',
    'AssessmentRunId',
    'Assessment',
    auditRunId
  );
  const lifecycleAssessment = qboHistExcReadLatestAssessmentMap_(
    ss,
    '101_Lifecycle_Timestamp_Assessment',
    'IngestionSourceId',
    'AssessmentRunId',
    'Assessment',
    auditRunId,
    'TargetColumn'
  );

  const governedAt = new Date();
  const rows = auditTargets.map(function(t) {
    const ledger = ledgerById[t.recordId];
    if (!ledger) throw new Error('HIST_EXC_05_ROW_NOT_FOUND ' + t.recordId);
    if (qboHistExcIso_(ledger[t.column])) throw new Error('HIST_EXC_TARGET_NO_LONGER_BLANK ' + t.recordId + '|' + t.column);

    let assessmentRunId = '';
    let assessment = 'HISTORICAL_TIMESTAMP_NOT_RECOVERABLE';
    let evidenceBasis = '';
    let detail = '';

    if (t.column === 'RegisteredAt' && ledger.SourceType === 'NATIVE_CDC') {
      const a = nativeAssessment[t.recordId];
      if (!a || a.assessment !== 'HISTORICAL_TIMESTAMP_NOT_RECOVERABLE') {
        throw new Error('HIST_EXC_NATIVE_CDC_REGISTERED_AT_NOT_PROVEN ' + t.recordId);
      }
      assessmentRunId = a.assessmentRunId;
      evidenceBasis = 'NATIVE_CDC_SAME_CYCLE_EXACT_RECOVERY_ASSESSMENT';
      detail = 'Registration event occurred, but every surviving row in the affected Native CDC cycle has blank RegisteredAt; no exact sibling registration timestamp survives.';
    } else if (t.column === 'RegisteredAt' && ledger.SourceType === 'WEBHOOK') {
      assessmentRunId = 'WRITER_CONTRACT_REVIEW_V1_5_90';
      evidenceBasis = 'WEBHOOK_PER_EVENT_REGISTERED_AT_NOT_DUPLICATED';
      detail = 'Webhook historical registration captures RegisteredAt independently per event. No exact duplicate of the missing registration instant survives; proximate timestamps are not authorized substitutes.';
    } else if (['LastHeartbeatAt','LastProgressAt','ProcessedAt'].indexOf(t.column) >= 0) {
      const key = t.recordId + '|' + t.column;
      const a = lifecycleAssessment[key];
      if (!a || a.assessment !== 'HISTORICAL_TIMESTAMP_NOT_RECOVERABLE') {
        throw new Error('HIST_EXC_LIFECYCLE_NOT_PROVEN ' + key);
      }
      assessmentRunId = a.assessmentRunId;
      evidenceBasis = 'LIFECYCLE_EXACT_RECOVERY_ASSESSMENT';
      detail = 'The writer contract requires this lifecycle timestamp for the row state, but no exact surviving timestamp channel exists. No proximate timestamp substitution is authorized.';
    } else {
      throw new Error('HIST_EXC_UNSUPPORTED_TARGET ' + t.recordId + '|' + t.column + '|sourceType=' + ledger.SourceType);
    }

    return {
      ExceptionId: qboHistExcSha256_(t.recordId + '|' + t.column + '|' + QBO_HISTORICAL_TIMESTAMP_EXCEPTION_GOVERNANCE_.EXCEPTION_CODE),
      IngestionSourceId: t.recordId,
      SourceType: ledger.SourceType,
      SourceRunId: ledger.SourceRunId,
      EntityType: ledger.EntityType,
      ProcessingStatus: ledger.ProcessingStatus,
      ColumnName: t.column,
      ExceptionCode: QBO_HISTORICAL_TIMESTAMP_EXCEPTION_GOVERNANCE_.EXCEPTION_CODE,
      Status: QBO_HISTORICAL_TIMESTAMP_EXCEPTION_GOVERNANCE_.STATUS_ACTIVE,
      SourceAuditRunId: auditRunId,
      RecoveryAssessmentRunId: assessmentRunId,
      RecoveryAssessment: assessment,
      EvidenceBasis: evidenceBasis,
      CutoverRule: 'EXACT_INGESTION_SOURCE_ID_PLUS_COLUMN_ONLY',
      ForwardControl: 'UNREGISTERED_EQUIVALENT_DEFECT_REMAINS_INVALID',
      GovernanceVersion: QBO_HISTORICAL_TIMESTAMP_EXCEPTION_GOVERNANCE_.VERSION,
      GovernedAt: governedAt,
      Detail: detail
    };
  });

  qboHistExcAssertRowSet_(rows);
  const persist = qboHistExcPersistExactRegistry_(ss, rows);
  const result = {
    version: QBO_HISTORICAL_TIMESTAMP_EXCEPTION_GOVERNANCE_.VERSION,
    status: 'GOVERNANCE_ESTABLISHED',
    productionDataReadOnly: true,
    governanceRegistryWritten: persist.written,
    productionDataMutationApplied: false,
    auditRunId: auditRunId,
    governedExceptionCount: rows.length,
    byColumn: qboHistExcCountBy_(rows, 'ColumnName'),
    bySourceType: qboHistExcCountBy_(rows, 'SourceType'),
    identityScopedOnly: true,
    dateRangeExceptionAuthorized: false,
    proximateTimestampSubstitutionAuthorized: false,
    futureEquivalentDefectsAutoExcepted: false,
    outputSheet: QBO_HISTORICAL_TIMESTAMP_EXCEPTION_GOVERNANCE_.SHEET_NAME,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString()
  };
  console.log('[HISTORICAL TIMESTAMP EXCEPTION GOVERNANCE] | ESTABLISHED | ' + JSON.stringify(result, null, 2));
  return result;
}

/**
 * Public control/audit function. No writes.
 * Confirms the registry is exact-identity scoped and that any equivalent defect
 * outside the registry remains an INVALID audit finding.
 */
function auditQboHistoricalTimestampExceptionGovernance() {
  const startedAt = new Date();
  const ss = getQboStateCaptureSpreadsheet_();
  const registry = qboHistExcReadRegistry_(ss);
  qboHistExcAssertRowSet_(registry);
  const ledgerById = qboHistExcRead05ById_(ss);

  let missingSourceCount = 0;
  let unexpectedlyPopulatedCount = 0;
  registry.forEach(function(r) {
    const row = ledgerById[r.IngestionSourceId];
    if (!row) { missingSourceCount += 1; return; }
    if (qboHistExcIso_(row[r.ColumnName])) unexpectedlyPopulatedCount += 1;
  });

  const ledgerAudit = qboBuildStateCaptureLedgerIntegrityAudit_({log:false, includeAllFindings:true});
  const unregisteredTimestampDefects = ledgerAudit.findings.filter(function(f) {
    return f.sheet === '05_Forward_Ingestion_Control' &&
      QBO_HISTORICAL_TIMESTAMP_EXCEPTION_GOVERNANCE_.TARGET_COLUMNS.indexOf(f.column) >= 0 &&
      f.code === 'REQUIRED_DATE_BLANK' && f.result === 'INVALID';
  });
  const governedFindingCount = Number(ledgerAudit.summary && ledgerAudit.summary.byCode &&
    ledgerAudit.summary.byCode[QBO_HISTORICAL_TIMESTAMP_EXCEPTION_GOVERNANCE_.EXCEPTION_CODE] || 0);

  const first = registry[0];
  const identityScopePass = !!first &&
    qboIntegrityIsGovernedHistoricalTimestampException_('05_Forward_Ingestion_Control', {IngestionSourceId:first.IngestionSourceId}, first.ColumnName) === true &&
    qboIntegrityIsGovernedHistoricalTimestampException_('05_Forward_Ingestion_Control', {IngestionSourceId:'SYNTHETIC_FUTURE_SOURCE_NOT_REGISTERED'}, first.ColumnName) === false;

  const valid = registry.length === QBO_HISTORICAL_TIMESTAMP_EXCEPTION_GOVERNANCE_.EXPECTED_COUNTS.TOTAL &&
    missingSourceCount === 0 && unexpectedlyPopulatedCount === 0 &&
    governedFindingCount === QBO_HISTORICAL_TIMESTAMP_EXCEPTION_GOVERNANCE_.EXPECTED_COUNTS.TOTAL &&
    unregisteredTimestampDefects.length === 0 && identityScopePass;

  const result = {
    version: QBO_HISTORICAL_TIMESTAMP_EXCEPTION_GOVERNANCE_.VERSION,
    status: valid ? 'VALID' : 'INVALID',
    productionDataReadOnly: true,
    auditOutputWritten: false,
    productionDataMutationApplied: false,
    registryCount: registry.length,
    governedHistoricalExceptionFindingCount: governedFindingCount,
    unregisteredEquivalentTimestampDefectCount: unregisteredTimestampDefects.length,
    missingRegisteredSourceCount: missingSourceCount,
    unexpectedlyPopulatedExceptionTargetCount: unexpectedlyPopulatedCount,
    identityScopedExceptionControlPassed: identityScopePass,
    futureEquivalentDefectsRemainInvalid: identityScopePass && unregisteredTimestampDefects.length === 0,
    ledgerInvalidCountAfterHistoricalExceptions: Number(ledgerAudit.summary && ledgerAudit.summary.invalidCount || 0),
    ledgerUnverifiableCountAfterHistoricalExceptions: Number(ledgerAudit.summary && ledgerAudit.summary.unverifiableCount || 0),
    remainingInvalidFindingCodes: qboHistExcCountFindingCodes_(ledgerAudit.findings.filter(function(f){return f.result === 'INVALID';})),
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString()
  };
  console.log('[HISTORICAL TIMESTAMP EXCEPTION GOVERNANCE] | AUDIT | ' + JSON.stringify(result, null, 2));
  return result;
}

function qboHistExcLatestAuditRunId_(ss) {
  const sh = ss.getSheetByName('94_Integrity_Audit_Runs');
  if (!sh || sh.getLastRow() < 2) return '';
  const h = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();});
  const idx = qboHistExcIndex_(h, ['AuditRunId']);
  const values = sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues();
  for (let i=values.length-1;i>=0;i--) { const id=String(values[i][idx.AuditRunId]||'').trim(); if(id) return id; }
  return '';
}

function qboHistExcReadAuditTargets_(ss, auditRunId) {
  const sh = ss.getSheetByName('95_Integrity_Audit_Findings');
  if (!sh || sh.getLastRow() < 2) throw new Error('HIST_EXC_FINDINGS_EMPTY');
  const h=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();});
  const idx=qboHistExcIndex_(h,['AuditRunId','Result','SheetName','ColumnOrRule','FindingCode','RecordId']);
  const out=[];
  sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues().forEach(function(r){
    if(String(r[idx.AuditRunId]||'').trim()!==auditRunId) return;
    if(String(r[idx.Result]||'').trim()!=='INVALID') return;
    if(String(r[idx.SheetName]||'').trim()!=='05_Forward_Ingestion_Control') return;
    if(String(r[idx.FindingCode]||'').trim()!=='REQUIRED_DATE_BLANK') return;
    const col=String(r[idx.ColumnOrRule]||'').trim();
    if(QBO_HISTORICAL_TIMESTAMP_EXCEPTION_GOVERNANCE_.TARGET_COLUMNS.indexOf(col)<0) return;
    out.push({recordId:String(r[idx.RecordId]||'').trim(),column:col});
  });
  return out;
}

function qboHistExcRead05ById_(ss) {
  const sh=ss.getSheetByName('05_Forward_Ingestion_Control');
  if(!sh||sh.getLastRow()<2) throw new Error('HIST_EXC_05_EMPTY');
  const h=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();});
  const req=['IngestionSourceId','SourceType','SourceRunId','EntityType','ProcessingStatus','RegisteredAt','LastHeartbeatAt','LastProgressAt','ProcessedAt'];
  const idx=qboHistExcIndex_(h,req); const out=Object.create(null);
  sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues().forEach(function(r){
    const o={}; req.forEach(function(x){o[x]=r[idx[x]];}); o.IngestionSourceId=String(o.IngestionSourceId||'').trim();
    if(o.IngestionSourceId) out[o.IngestionSourceId]=o;
  }); return out;
}

function qboHistExcReadLatestAssessmentMap_(ss, sheetName, idHeader, runHeader, assessmentHeader, auditRunId, secondaryHeader) {
  const sh=ss.getSheetByName(sheetName); if(!sh||sh.getLastRow()<2) throw new Error('HIST_EXC_ASSESSMENT_EMPTY '+sheetName);
  const h=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();});
  const required=[idHeader,runHeader,assessmentHeader,'AuditRunId']; if(secondaryHeader) required.push(secondaryHeader);
  const idx=qboHistExcIndex_(h,required); const values=sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues();
  let latestRun='';
  for(let i=values.length-1;i>=0;i--){ if(String(values[i][idx.AuditRunId]||'').trim()===auditRunId){latestRun=String(values[i][idx[runHeader]]||'').trim(); if(latestRun) break;} }
  if(!latestRun) throw new Error('HIST_EXC_ASSESSMENT_RUN_NOT_FOUND '+sheetName+' audit='+auditRunId);
  const out=Object.create(null);
  values.forEach(function(r){
    if(String(r[idx.AuditRunId]||'').trim()!==auditRunId) return;
    if(String(r[idx[runHeader]]||'').trim()!==latestRun) return;
    const id=String(r[idx[idHeader]]||'').trim(); if(!id) return;
    const key=secondaryHeader?id+'|'+String(r[idx[secondaryHeader]]||'').trim():id;
    out[key]={assessmentRunId:latestRun,assessment:String(r[idx[assessmentHeader]]||'').trim()};
  });
  return out;
}

function qboHistExcPersistExactRegistry_(ss, rows) {
  const name=QBO_HISTORICAL_TIMESTAMP_EXCEPTION_GOVERNANCE_.SHEET_NAME, h=QBO_HISTORICAL_TIMESTAMP_EXCEPTION_GOVERNANCE_.HEADERS;
  let sh=ss.getSheetByName(name);
  if(sh && sh.getLastRow()>=2){
    const existing=qboHistExcReadRegistry_(ss);
    const a=existing.map(function(r){return r.IngestionSourceId+'|'+r.ColumnName+'|'+r.ExceptionCode+'|'+r.Status;}).sort();
    const b=rows.map(function(r){return r.IngestionSourceId+'|'+r.ColumnName+'|'+r.ExceptionCode+'|'+r.Status;}).sort();
    if(JSON.stringify(a)!==JSON.stringify(b)) throw new Error('HIST_EXC_EXISTING_REGISTRY_MISMATCH');
    return {written:false};
  }
  if(!sh){sh=ss.insertSheet(name); sh.getRange(1,1,1,h.length).setValues([h]); sh.setFrozenRows(1); sh.getRange(1,1,1,h.length).setFontWeight('bold');}
  else {
    const actual=sh.getRange(1,1,1,h.length).getValues()[0].map(function(v){return String(v||'').trim();});
    h.forEach(function(x,i){if(actual[i]!==x) throw new Error('HIST_EXC_HEADER_MISMATCH col='+(i+1));});
  }
  const out=rows.map(function(r){return h.map(function(x){return r[x];});});
  sh.getRange(2,1,out.length,h.length).setValues(out); sh.getDataRange().setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  return {written:true};
}

function qboHistExcReadRegistry_(ss) {
  const sh=ss.getSheetByName(QBO_HISTORICAL_TIMESTAMP_EXCEPTION_GOVERNANCE_.SHEET_NAME);
  if(!sh||sh.getLastRow()<2) throw new Error('HIST_EXC_REGISTRY_NOT_ESTABLISHED');
  const h=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();});
  const idx=qboHistExcIndex_(h,QBO_HISTORICAL_TIMESTAMP_EXCEPTION_GOVERNANCE_.HEADERS);
  return sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues().map(function(r){const o={};QBO_HISTORICAL_TIMESTAMP_EXCEPTION_GOVERNANCE_.HEADERS.forEach(function(x){o[x]=r[idx[x]];});return o;}).filter(function(r){return String(r.Status||'').trim()==='ACTIVE';});
}

function qboHistExcAssertExpectedAuditTargetCounts_(targets) {
  const c=Object.create(null); targets.forEach(function(t){c[t.column]=Number(c[t.column]||0)+1;});
  const e=QBO_HISTORICAL_TIMESTAMP_EXCEPTION_GOVERNANCE_.EXPECTED_COUNTS;
  if(targets.length!==e.TOTAL || Number(c.RegisteredAt||0)!==e.RegisteredAt || Number(c.LastHeartbeatAt||0)!==e.LastHeartbeatAt || Number(c.LastProgressAt||0)!==e.LastProgressAt || Number(c.ProcessedAt||0)!==e.ProcessedAt){
    throw new Error('HIST_EXC_AUDIT_TARGET_COUNT_MISMATCH actual='+JSON.stringify(c)+' total='+targets.length);
  }
}

function qboHistExcAssertRowSet_(rows) {
  const e=QBO_HISTORICAL_TIMESTAMP_EXCEPTION_GOVERNANCE_.EXPECTED_COUNTS;
  if(rows.length!==e.TOTAL) throw new Error('HIST_EXC_REGISTRY_COUNT_MISMATCH '+rows.length);
  const byCol=qboHistExcCountBy_(rows,'ColumnName');
  if(Number(byCol.RegisteredAt||0)!==e.RegisteredAt || Number(byCol.LastHeartbeatAt||0)!==e.LastHeartbeatAt || Number(byCol.LastProgressAt||0)!==e.LastProgressAt || Number(byCol.ProcessedAt||0)!==e.ProcessedAt) throw new Error('HIST_EXC_REGISTRY_COLUMN_COUNT_MISMATCH '+JSON.stringify(byCol));
  const seen=Object.create(null); rows.forEach(function(r){const k=r.IngestionSourceId+'|'+r.ColumnName;if(seen[k]) throw new Error('HIST_EXC_DUPLICATE_KEY '+k);seen[k]=true;});
}

function qboHistExcCountBy_(rows, field) { const out=Object.create(null); rows.forEach(function(r){const k=String(r[field]||'').trim();out[k]=Number(out[k]||0)+1;}); return out; }
function qboHistExcCountFindingCodes_(rows){const out=Object.create(null);rows.forEach(function(r){out[r.code]=Number(out[r.code]||0)+1;});return out;}
function qboHistExcIndex_(headers,required){const idx=Object.create(null);headers.forEach(function(h,i){idx[h]=i;});required.forEach(function(h){if(idx[h]===undefined) throw new Error('HIST_EXC_HEADER_MISSING '+h);});return idx;}
function qboHistExcDate_(v){if(v instanceof Date&&!isNaN(v.getTime()))return v;if(!v)return null;const d=new Date(v);return isNaN(d.getTime())?null:d;}
function qboHistExcIso_(v){const d=qboHistExcDate_(v);return d?d.toISOString():'';}
function qboHistExcSha256_(s){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(s),Utilities.Charset.UTF_8).map(function(b){const n=(b+256)%256;return ('0'+n.toString(16)).slice(-2);}).join('');}
