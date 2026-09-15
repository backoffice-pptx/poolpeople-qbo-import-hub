/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 118_QBO_LifecycleTimestampRecoveryAssessment.js
 * Version     : 1.5.91
 * Purpose     : Read-only exact-recovery assessment for invalid blank
 *               LastHeartbeatAt, LastProgressAt, and ProcessedAt values in
 *               05_Forward_Ingestion_Control.
 *
 * Exact-evidence doctrine:
 *   - qboForwardIngestionCheckpoint_ captures one `now` and writes that same
 *     timestamp to LastHeartbeatAt, LastProgressAt (when progress=true), and
 *     ProcessedAt (when processed=true).
 *   - All current terminal PROCESSED adapter paths checkpoint with
 *     progress=true + processed=true, so those three timestamps are identical
 *     at the terminal checkpoint. A surviving sibling timestamp is therefore
 *     exact writer-contract evidence for a blank sibling on the same row.
 *   - An AVAILABLE row after a completed partial checkpoint has its latest
 *     LastHeartbeatAt and LastProgressAt written from the same checkpoint
 *     `now`; if one survives and the other is blank, it is exact evidence.
 *   - A PROCESSING claim writes ClaimExpiresAt = claim heartbeat + 360000 ms.
 *     A surviving ClaimExpiresAt is exact evidence for a blank claim heartbeat.
 *   - BLOCKED worker paths write a new LastHeartbeatAt at block time but do not
 *     preserve another exact copy of that block timestamp. Earlier progress,
 *     source timestamps, payload timestamps, Drive timestamps, and generic
 *     ingestion telemetry are not substitutes.
 *
 * Safety:
 *   - Does NOT mutate 05 or any production/state data.
 *   - Writes only diagnostic output to 101_Lifecycle_Timestamp_Assessment.
 *   - Does NOT repair values.
 * ============================================================================
 */

const QBO_LIFECYCLE_TIMESTAMP_ASSESSMENT_ = Object.freeze({
  VERSION: 'QBO_LIFECYCLE_TIMESTAMP_RECOVERY_ASSESSMENT_V1_5_91',
  SHEET_NAME: '101_Lifecycle_Timestamp_Assessment',
  CLAIM_TIMEOUT_MS: 360000,
  TARGET_COLUMNS: Object.freeze(['LastHeartbeatAt','LastProgressAt','ProcessedAt']),
  HEADERS: Object.freeze([
    'AssessmentRunId','AuditRunId','IngestionSourceId','SourceType','SourceRunId','EntityType',
    'TargetRowNumber','ProcessingStatus','TargetColumn','CurrentValue','Assessment',
    'CandidateTimestamp','EvidenceBasis','ExactRepairEligible','AttemptCount','RecordCursor',
    'ObservationCount','PayloadCount','ShardCount','CurrentLastHeartbeatAt',
    'CurrentLastProgressAt','CurrentProcessedAt','ClaimExpiresAt','ProcessingError',
    'Detail','AssessedAt'
  ]),
  EXACT: 'EXACT_RECOVERABLE',
  NOT_RECOVERABLE: 'HISTORICAL_TIMESTAMP_NOT_RECOVERABLE',
  VALID_BLANK: 'CONTRACTUALLY_VALID_BLANK',
  CONFLICT: 'SOURCE_EVIDENCE_REVIEW_REQUIRED'
});

function assessQboLifecycleTimestampExactRecovery() {
  const startedAt = new Date();
  const assessmentRunId = 'LIFECYCLE_TIMESTAMP_ASSESSMENT|' + Utilities.getUuid();
  const ss = getQboStateCaptureSpreadsheet_();
  const auditRunId = qboLifecycleLatestAuditRunId_(ss);
  if (!auditRunId) throw new Error('LIFECYCLE_TIMESTAMP_NO_AUDIT_RUN');

  const ledger = qboLifecycleRead05_(ss);
  const byId = Object.create(null);
  ledger.forEach(function(r){ byId[r.IngestionSourceId] = r; });
  const targets = qboLifecycleReadTargets_(ss, auditRunId);
  const assessedAt = new Date();
  const assessed = targets.map(function(t) {
    const row = byId[t.recordId];
    if (!row) {
      return qboLifecycleAssessmentResult_(t, null, QBO_LIFECYCLE_TIMESTAMP_ASSESSMENT_.CONFLICT, '', 'TARGET_ROW_NOT_FOUND', false,
        'Latest audit finding references an IngestionSourceId that is not present in 05.', assessedAt);
    }
    return qboLifecycleAssessTarget_(t, row, assessedAt);
  });

  qboLifecyclePersist_(ss, assessmentRunId, auditRunId, assessed);

  const assessmentCounts = Object.create(null);
  const byColumn = Object.create(null);
  const bySourceType = Object.create(null);
  const byStatus = Object.create(null);
  let exact = 0;
  assessed.forEach(function(a){
    assessmentCounts[a.assessment] = Number(assessmentCounts[a.assessment] || 0) + 1;
    byColumn[a.target.column] = byColumn[a.target.column] || Object.create(null);
    byColumn[a.target.column][a.assessment] = Number(byColumn[a.target.column][a.assessment] || 0) + 1;
    const st = a.row ? a.row.SourceType : '(missing)';
    const ps = a.row ? a.row.ProcessingStatus : '(missing)';
    bySourceType[st] = bySourceType[st] || Object.create(null);
    bySourceType[st][a.assessment] = Number(bySourceType[st][a.assessment] || 0) + 1;
    byStatus[ps] = byStatus[ps] || Object.create(null);
    byStatus[ps][a.assessment] = Number(byStatus[ps][a.assessment] || 0) + 1;
    if (a.eligible) exact += 1;
  });

  const result = {
    version: QBO_LIFECYCLE_TIMESTAMP_ASSESSMENT_.VERSION,
    status: 'DIAGNOSTIC_COMPLETE',
    productionDataReadOnly: true,
    diagnosticOutputWritten: true,
    repairApplied: false,
    productionDataMutationApplied: false,
    assessmentRunId: assessmentRunId,
    auditRunId: auditRunId,
    targetFindingCount: targets.length,
    assessedTargetCount: assessed.length,
    exactRepairEligibleCount: exact,
    assessmentCounts: assessmentCounts,
    assessmentByColumn: byColumn,
    assessmentBySourceType: bySourceType,
    assessmentByProcessingStatus: byStatus,
    exactEvidenceChannels: [
      'PROCESSED_TERMINAL_CHECKPOINT_SHARED_NOW',
      'AVAILABLE_PARTIAL_CHECKPOINT_SHARED_NOW',
      'PROCESSING_CLAIM_EXPIRY_MINUS_CLAIM_TIMEOUT'
    ],
    proximateTimestampSubstitutionAuthorized: false,
    ingestionTelemetryExactRecoveryAuthorized: false,
    payloadArtifactTimestampExactRecoveryAuthorized: false,
    outputSheet: QBO_LIFECYCLE_TIMESTAMP_ASSESSMENT_.SHEET_NAME,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString()
  };
  console.log('[LIFECYCLE TIMESTAMP ASSESSMENT] | COMPLETE | ' + JSON.stringify(result, null, 2));
  return result;
}

function qboLifecycleAssessTarget_(target, row, assessedAt) {
  const col = target.column;
  const current = qboLifecycleIso_(row[col]);
  if (current) {
    return qboLifecycleAssessmentResult_(target,row,QBO_LIFECYCLE_TIMESTAMP_ASSESSMENT_.CONFLICT,'','TARGET_NO_LONGER_BLANK',false,
      'The latest audit identified a blank target, but the current 05 value is now populated. Re-audit before repair.',assessedAt);
  }

  const status = String(row.ProcessingStatus || '').trim();
  const hb = qboLifecycleIso_(row.LastHeartbeatAt);
  const pg = qboLifecycleIso_(row.LastProgressAt);
  const pr = qboLifecycleIso_(row.ProcessedAt);

  if (status === 'PROCESSED') {
    const candidates = qboLifecycleDistinct_([hb, pg, pr]);
    if (candidates.length === 1) {
      return qboLifecycleAssessmentResult_(target,row,QBO_LIFECYCLE_TIMESTAMP_ASSESSMENT_.EXACT,candidates[0],
        'PROCESSED_TERMINAL_CHECKPOINT_SHARED_NOW',true,
        'Terminal processing uses one checkpoint `now` for LastHeartbeatAt, LastProgressAt, and ProcessedAt. One exact sibling timestamp survives on this row.',assessedAt);
    }
    if (candidates.length > 1) {
      return qboLifecycleAssessmentResult_(target,row,QBO_LIFECYCLE_TIMESTAMP_ASSESSMENT_.CONFLICT,'',
        'PROCESSED_TERMINAL_TIMESTAMP_CONFLICT',false,
        'Multiple distinct terminal lifecycle timestamps survive on a PROCESSED row although the writer contract sets all three from one `now`. No repair is authorized.',assessedAt);
    }
    return qboLifecycleAssessmentResult_(target,row,QBO_LIFECYCLE_TIMESTAMP_ASSESSMENT_.NOT_RECOVERABLE,'',
      'NO_TERMINAL_CHECKPOINT_TIMESTAMP_SURVIVES',false,
      'All terminal checkpoint timestamp copies needed for exact same-row recovery are blank. Proximate source/payload/log timestamps are not substitutes.',assessedAt);
  }

  if (status === 'AVAILABLE') {
    if (col === 'ProcessedAt') {
      return qboLifecycleAssessmentResult_(target,row,QBO_LIFECYCLE_TIMESTAMP_ASSESSMENT_.VALID_BLANK,'',
        'AVAILABLE_PROCESSED_AT_MUST_BE_BLANK',false,
        'ProcessedAt is contractually blank while ProcessingStatus is AVAILABLE.',assessedAt);
    }
    const counterpart = col === 'LastHeartbeatAt' ? pg : (col === 'LastProgressAt' ? hb : '');
    if (counterpart) {
      return qboLifecycleAssessmentResult_(target,row,QBO_LIFECYCLE_TIMESTAMP_ASSESSMENT_.EXACT,counterpart,
        'AVAILABLE_PARTIAL_CHECKPOINT_SHARED_NOW',true,
        'An AVAILABLE row with committed/attempted work is produced by a nonterminal checkpoint that writes LastHeartbeatAt and LastProgressAt from the same `now` and releases the claim.',assessedAt);
    }
    return qboLifecycleAssessmentResult_(target,row,QBO_LIFECYCLE_TIMESTAMP_ASSESSMENT_.NOT_RECOVERABLE,'',
      'NO_PARTIAL_CHECKPOINT_TIMESTAMP_SURVIVES',false,
      'No exact sibling checkpoint timestamp survives on this AVAILABLE row.',assessedAt);
  }

  if (status === 'PROCESSING') {
    if (col === 'ProcessedAt') {
      return qboLifecycleAssessmentResult_(target,row,QBO_LIFECYCLE_TIMESTAMP_ASSESSMENT_.VALID_BLANK,'',
        'PROCESSING_PROCESSED_AT_MUST_BE_BLANK',false,
        'ProcessedAt is contractually blank while ProcessingStatus is PROCESSING.',assessedAt);
    }
    if (col === 'LastHeartbeatAt') {
      const expiry = qboLifecycleDate_(row.ClaimExpiresAt);
      if (expiry) {
        const candidate = new Date(expiry.getTime() - QBO_LIFECYCLE_TIMESTAMP_ASSESSMENT_.CLAIM_TIMEOUT_MS).toISOString();
        return qboLifecycleAssessmentResult_(target,row,QBO_LIFECYCLE_TIMESTAMP_ASSESSMENT_.EXACT,candidate,
          'PROCESSING_CLAIM_EXPIRY_MINUS_CLAIM_TIMEOUT',true,
          'ClaimNext writes ClaimExpiresAt from the same claim instant as LastHeartbeatAt plus the fixed 360000 ms claim timeout.',assessedAt);
      }
    }
    return qboLifecycleAssessmentResult_(target,row,QBO_LIFECYCLE_TIMESTAMP_ASSESSMENT_.NOT_RECOVERABLE,'',
      'NO_EXACT_PROCESSING_TIMESTAMP_EVIDENCE',false,
      'The surviving PROCESSING fields do not preserve an exact copy of the missing lifecycle timestamp.',assessedAt);
  }

  if (status === 'BLOCKED') {
    if (col === 'ProcessedAt') {
      return qboLifecycleAssessmentResult_(target,row,QBO_LIFECYCLE_TIMESTAMP_ASSESSMENT_.VALID_BLANK,'',
        'BLOCKED_PROCESSED_AT_MUST_BE_BLANK',false,
        'ProcessedAt is contractually blank while ProcessingStatus is BLOCKED.',assessedAt);
    }
    return qboLifecycleAssessmentResult_(target,row,QBO_LIFECYCLE_TIMESTAMP_ASSESSMENT_.NOT_RECOVERABLE,'',
      'BLOCK_EVENT_TIMESTAMP_NOT_DUPLICATED',false,
      'Worker blocking writes a fresh LastHeartbeatAt but does not persist another exact copy of the block timestamp; prior progress/source/payload timestamps are not exact substitutes.',assessedAt);
  }

  return qboLifecycleAssessmentResult_(target,row,QBO_LIFECYCLE_TIMESTAMP_ASSESSMENT_.CONFLICT,'',
    'UNKNOWN_PROCESSING_STATUS',false,'ProcessingStatus is outside the governed lifecycle state set.',assessedAt);
}

function qboLifecycleAssessmentResult_(target,row,assessment,candidate,basis,eligible,detail,assessedAt) {
  return {target:target,row:row,assessment:assessment,candidate:candidate,basis:basis,eligible:eligible,detail:detail,assessedAt:assessedAt};
}

function qboLifecycleRead05_(ss) {
  const sh = ss.getSheetByName('05_Forward_Ingestion_Control');
  if (!sh || sh.getLastRow() < 2) throw new Error('LIFECYCLE_TIMESTAMP_05_EMPTY');
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();});
  const required = ['IngestionSourceId','SourceType','SourceRunId','EntityType','ProcessingStatus','RecordCursor','ObservationCount','PayloadCount','ShardCount','AttemptCount','ClaimExpiresAt','LastHeartbeatAt','LastProgressAt','ProcessedAt','ProcessingError'];
  const idx = qboLifecycleIndex_(headers, required);
  return sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues().map(function(r,i){
    const o={rowNumber:i+2}; required.forEach(function(h){o[h]=r[idx[h]];});
    o.IngestionSourceId=String(o.IngestionSourceId||'').trim(); o.SourceType=String(o.SourceType||'').trim();
    o.SourceRunId=String(o.SourceRunId||'').trim(); o.EntityType=String(o.EntityType||'').trim();
    o.ProcessingStatus=String(o.ProcessingStatus||'').trim();
    return o;
  });
}

function qboLifecycleReadTargets_(ss,auditRunId) {
  const sh=ss.getSheetByName('95_Integrity_Audit_Findings');
  if(!sh||sh.getLastRow()<2) throw new Error('LIFECYCLE_TIMESTAMP_FINDINGS_EMPTY');
  const headers=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();});
  const idx=qboLifecycleIndex_(headers,['AuditRunId','Result','SheetName','ColumnOrRule','RecordId','FindingCode']);
  const targetCols=Object.create(null); QBO_LIFECYCLE_TIMESTAMP_ASSESSMENT_.TARGET_COLUMNS.forEach(function(c){targetCols[c]=true;});
  const seen=Object.create(null),out=[];
  sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues().forEach(function(r){
    if(String(r[idx.AuditRunId]||'').trim()!==auditRunId) return;
    if(String(r[idx.Result]||'').trim()!=='INVALID') return;
    if(String(r[idx.SheetName]||'').trim()!=='05_Forward_Ingestion_Control') return;
    const col=String(r[idx.ColumnOrRule]||'').trim(); if(!targetCols[col]) return;
    const id=String(r[idx.RecordId]||'').trim(); if(!id) return;
    const key=col+'|'+id; if(seen[key]) return; seen[key]=true;
    out.push({column:col,recordId:id,findingCode:String(r[idx.FindingCode]||'').trim()});
  });
  return out;
}

function qboLifecycleLatestAuditRunId_(ss) {
  const sh=ss.getSheetByName('94_Integrity_Audit_Runs'); if(!sh||sh.getLastRow()<2) return '';
  const headers=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();});
  const idx=qboLifecycleIndex_(headers,['AuditRunId','CompletedAt']); let best='',bestMs=-1;
  sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues().forEach(function(r){
    const d=qboLifecycleDate_(r[idx.CompletedAt]),id=String(r[idx.AuditRunId]||'').trim();
    if(id&&d&&d.getTime()>=bestMs){best=id;bestMs=d.getTime();}
  }); return best;
}

function qboLifecyclePersist_(ss,assessmentRunId,auditRunId,assessed) {
  let sh=ss.getSheetByName(QBO_LIFECYCLE_TIMESTAMP_ASSESSMENT_.SHEET_NAME); const h=QBO_LIFECYCLE_TIMESTAMP_ASSESSMENT_.HEADERS;
  if(!sh){sh=ss.insertSheet(QBO_LIFECYCLE_TIMESTAMP_ASSESSMENT_.SHEET_NAME); sh.getRange(1,1,1,h.length).setValues([h]); sh.setFrozenRows(1); sh.getRange(1,1,1,h.length).setFontWeight('bold');}
  else {const actual=sh.getRange(1,1,1,h.length).getValues()[0].map(function(v){return String(v||'').trim();}); h.forEach(function(x,i){if(actual[i]!==x) throw new Error('LIFECYCLE_TIMESTAMP_ASSESSMENT_HEADER_MISMATCH col='+(i+1));});}
  if(assessed.length){
    const rows=assessed.map(function(a){const r=a.row||{}; return [assessmentRunId,auditRunId,a.target.recordId,r.SourceType||'',r.SourceRunId||'',r.EntityType||'',r.rowNumber||'',r.ProcessingStatus||'',a.target.column,qboLifecycleIso_(r[a.target.column]),a.assessment,a.candidate,a.basis,a.eligible,r.AttemptCount||0,r.RecordCursor||0,r.ObservationCount===''?'':r.ObservationCount,r.PayloadCount||0,r.ShardCount||0,qboLifecycleIso_(r.LastHeartbeatAt),qboLifecycleIso_(r.LastProgressAt),qboLifecycleIso_(r.ProcessedAt),qboLifecycleIso_(r.ClaimExpiresAt),String(r.ProcessingError||''),a.detail,a.assessedAt];});
    sh.getRange(sh.getLastRow()+1,1,rows.length,h.length).setValues(rows);
  }
  sh.getDataRange().setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
}

function qboLifecycleIndex_(headers,required){const idx=Object.create(null);headers.forEach(function(h,i){idx[h]=i;});required.forEach(function(h){if(idx[h]===undefined) throw new Error('LIFECYCLE_TIMESTAMP_MISSING_HEADER '+h);});return idx;}
function qboLifecycleDate_(v){if(v instanceof Date&&!isNaN(v.getTime())) return v;if(!v) return null;const d=new Date(v);return isNaN(d.getTime())?null:d;}
function qboLifecycleIso_(v){const d=qboLifecycleDate_(v);return d?d.toISOString():'';}
function qboLifecycleDistinct_(values){const m=Object.create(null);values.forEach(function(v){if(v)m[v]=true;});return Object.keys(m).sort();}
