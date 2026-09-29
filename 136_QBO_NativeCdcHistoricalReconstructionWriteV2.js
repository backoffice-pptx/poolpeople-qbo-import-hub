/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 136_QBO_NativeCdcHistoricalReconstructionWriteV2.js
 * Version     : 1.5.114
 *
 * CONTROLLED WRITE for the v1.5.113 validated Native CDC reconstruction.
 *
 * Scope ONLY:
 *   02a_CDC_Run_Attempts_V2
 *   02b_CDC_Committed_Runs_V2
 *   03_Native_CDC_Events_V2
 *
 * Does NOT touch 05, 06, Change Payloads, Script Properties, triggers,
 * acquisition scheduling, or State Application.
 *
 * Safety model:
 * - rebuild candidate by calling the v1.5.113 preview builder
 * - refuse write unless exact locked population and zero findings
 * - create/use V2 sheets only
 * - refuse unexpected pre-existing keys
 * - idempotent exact-row reconciliation
 * - post-write Gate A reconciliation before success
 */

const QBO_NCDC_HIST_WRITE_1_5_114 = Object.freeze({
  VERSION:'QBO_NATIVE_CDC_HISTORICAL_RECONSTRUCTION_WRITE_V1_5_114',
  STATE_CAPTURE_SPREADSHEET_ID:'1JQ3s7fbOvSySmXVx5LuZhDogN2eMFekNAlU5Q6Tx4x0',
  SHEET02A:'02a_CDC_Run_Attempts_V2',
  SHEET02B:'02b_CDC_Committed_Runs_V2',
  SHEET03:'03_Native_CDC_Events_V2',
  EXPECTED_ATTEMPTS:41,
  EXPECTED_COMMITTED:32,
  EXPECTED_OBSERVATIONS:955,
  EXPECTED_INITIAL:894
});

const QBO_NCDC_02A_HEADERS_1_5_114 = [
'CdcAttemptId','CdcRunId','AttemptIdentityBasis','AcquisitionClassification',
'SourceAcquisitionType','RunStartedAt','RunCompletedAt','WindowStart','WindowEnd',
'InitialRun','InitialLookbackDays','OverlapMinutes','PriorSuccessfulWatermark',
'EntityTypesRequested','CompletedEntityCount','ReturnedEntityCount','LiveEntityCount',
'DeletedEntityCount','AcquisitionStatus','WatermarkCommitted','CommittedWatermark',
'ManifestFileId','ManifestFileName','ManifestHash','RunFolderId','RunFolderName',
'MinorVersion','CodeVersion','EvidenceCreatedAt','RegistrationMode','RegisteredAt'
];

const QBO_NCDC_02B_HEADERS_1_5_114 = [
'CdcRunId','CdcAttemptId','AcquisitionClassification','SourceAcquisitionType',
'RunStartedAt','RunCompletedAt','WindowStart','WindowEnd','InitialRun',
'InitialLookbackDays','OverlapMinutes','PriorSuccessfulWatermark','CommittedWatermark',
'WatermarkCommitted','EntityTypesRequested','CompletedEntityCount','ReturnedEntityCount',
'LiveEntityCount','DeletedEntityCount','ManifestFileId','ManifestFileName','ManifestHash',
'RunFolderId','RunFolderName','MinorVersion','CodeVersion','EvidenceCreatedAt',
'RegistrationMode','RegisteredAt'
];

const QBO_NCDC_03_HEADERS_1_5_114 = [
'NativeCdcEventId','CdcRunId','CdcAttemptId','SourceId','EntityRunId','EntityType',
'EvidenceIndex','EntityId','Operation','QboStatus','DeletedFlag','QboSyncToken',
'QboCreateTime','QboLastUpdatedTime','ObservedAt','SourceChangeTime','SparseFlag',
'EvidenceFileId','EvidenceFileName','EvidenceHash','EvidenceHashType','RequestStartedAt',
'RequestCompletedAt','QboResponseTime','RawEntityHash','EvidenceStatus','EligibilityStatus',
'EligibilityReason','AcquisitionClassification','EvidenceCreatedAt','RegistrationMode',
'RegisteredAt'
];

function writeQboNativeCdcHistoricalReconstructionV2() {
  const C=QBO_NCDC_HIST_WRITE_1_5_114;
  const candidate=previewQboNativeCdcHistoricalReconstructionV2();

  qboNcdc114AssertCandidate_(candidate);

  const ss=SpreadsheetApp.openById(C.STATE_CAPTURE_SPREADSHEET_ID);
  const lock=LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const r02a=qboNcdc114WriteExact_(ss,C.SHEET02A,QBO_NCDC_02A_HEADERS_1_5_114,
      'CdcAttemptId',candidate.attempts);
    const r02b=qboNcdc114WriteExact_(ss,C.SHEET02B,QBO_NCDC_02B_HEADERS_1_5_114,
      'CdcRunId',candidate.committed);
    const r03=qboNcdc114WriteExact_(ss,C.SHEET03,QBO_NCDC_03_HEADERS_1_5_114,
      'NativeCdcEventId',candidate.observations);

    SpreadsheetApp.flush();
    const gate=auditQboNativeCdcHistoricalReconstructionV2GateA_();
    if (!gate.valid) throw new Error('POST_WRITE_GATE_A_FAILED: '+JSON.stringify(gate));

    const summary={
      version:C.VERSION,status:'SUCCESS',writeScope:'02A_02B_03_ONLY',
      sheet02a:r02a,sheet02b:r02b,sheet03:r03,postWriteGateA:gate,
      controls:{writes05:false,writes06:false,writesPayloads:false,
        writesProperties:false,writesTriggers:false,writesStateApplication:false}
    };
    console.log('[NCDC HIST WRITE 1.5.114] | SUMMARY | '+JSON.stringify(summary));
    return summary;
  } finally {
    lock.releaseLock();
  }
}

function auditQboNativeCdcHistoricalReconstructionV2GateA_() {
  const C=QBO_NCDC_HIST_WRITE_1_5_114;
  const ss=SpreadsheetApp.openById(C.STATE_CAPTURE_SPREADSHEET_ID);
  const a=qboNcdc114Read_(ss,C.SHEET02A);
  const b=qboNcdc114Read_(ss,C.SHEET02B);
  const e=qboNcdc114Read_(ss,C.SHEET03);
  const findings=[];

  qboNcdc114Unique_(a,'CdcAttemptId',findings,C.SHEET02A);
  qboNcdc114Unique_(b,'CdcRunId',findings,C.SHEET02B);
  qboNcdc114Unique_(e,'NativeCdcEventId',findings,C.SHEET03);

  const aIds={}; a.forEach(r=>aIds[String(r.CdcAttemptId)]=true);
  const bIds={}; b.forEach(r=>{
    bIds[String(r.CdcRunId)]=true;
    if(!aIds[String(r.CdcAttemptId)]) findings.push({code:'02B_WITHOUT_02A',id:r.CdcRunId});
    if(String(r.WatermarkCommitted).toLowerCase()!=='true')
      findings.push({code:'02B_NOT_COMMITTED',id:r.CdcRunId});
  });
  e.forEach(r=>{
    if(!bIds[String(r.CdcRunId)])
      findings.push({code:'03_WITHOUT_02B',id:r.NativeCdcEventId,run:r.CdcRunId});
  });

  const initial=e.filter(r=>String(r.CdcRunId)===
    QBO_NCDC_HIST_RECON_1_5_113.INITIAL_COMMITTED_RUN_ID).length;
  if(a.length!==C.EXPECTED_ATTEMPTS) findings.push({code:'02A_COUNT',actual:a.length});
  if(b.length!==C.EXPECTED_COMMITTED) findings.push({code:'02B_COUNT',actual:b.length});
  if(e.length!==C.EXPECTED_OBSERVATIONS) findings.push({code:'03_COUNT',actual:e.length});
  if(initial!==C.EXPECTED_INITIAL) findings.push({code:'INITIAL_COUNT',actual:initial});

  return {
    valid:findings.length===0,
    sheet02aRowCount:a.length,sheet02bRowCount:b.length,sheet03RowCount:e.length,
    initialLookbackObservationCount:initial,
    eligible03Count:e.filter(r=>String(r.EligibilityStatus)==='ELIGIBLE').length,
    findings:findings
  };
}

function qboNcdc114AssertCandidate_(x) {
  const C=QBO_NCDC_HIST_WRITE_1_5_114;
  if(!x || !x.summary) throw new Error('Missing v1.5.113 candidate.');
  const s=x.summary;
  if(s.status!=='READY_FOR_CONTROLLED_WRITE' || s.findingCount!==0)
    throw new Error('Candidate not approved: '+JSON.stringify(s));
  if(s.candidate02aAttemptCount!==C.EXPECTED_ATTEMPTS ||
     s.candidate02bCommittedRunCount!==C.EXPECTED_COMMITTED ||
     s.candidate03ObservationCount!==C.EXPECTED_OBSERVATIONS ||
     s.initialLookbackObservationCount!==C.EXPECTED_INITIAL ||
     s.candidate03EligibleCount!==C.EXPECTED_OBSERVATIONS ||
     !s.failedInitialAttemptPresent)
    throw new Error('Locked population mismatch: '+JSON.stringify(s));
}

function qboNcdc114WriteExact_(ss,name,headers,keyCol,rows) {
  let sh=ss.getSheetByName(name);
  if(!sh) sh=ss.insertSheet(name);

  const existing=qboNcdc114Read_(ss,name);
  const candidateByKey={};
  rows.forEach(r=>{
    const k=String(r[keyCol]||'');
    if(!k) throw new Error(name+' candidate missing '+keyCol);
    if(candidateByKey[k]) throw new Error(name+' duplicate candidate key '+k);
    candidateByKey[k]=r;
  });

  // Existing rows are permitted only when every key belongs to the validated candidate.
  existing.forEach(r=>{
    const k=String(r[keyCol]||'');
    if(!candidateByKey[k]) throw new Error(name+' unexpected existing key '+k);
  });

  // Controlled rebuild of only these V2 sheets.
  sh.clearContents();
  sh.getRange(1,1,1,headers.length).setValues([headers]);
  if(rows.length){
    const vals=rows.map(r=>headers.map(h=>{
      if(h==='RegisteredAt') return new Date().toISOString();
      const v=r[h];
      return v===undefined || v===null ? '' : v;
    }));
    sh.getRange(2,1,vals.length,headers.length).setValues(vals);
  }
  sh.getDataRange().setWrap(false);
  sh.setFrozenRows(1);
  return {sheet:name,rowCount:rows.length,rebuildMode:'CONTROLLED_EXACT_REBUILD'};
}

function qboNcdc114Read_(ss,name) {
  const sh=ss.getSheetByName(name);
  if(!sh || sh.getLastRow()<2) return [];
  const vals=sh.getRange(1,1,sh.getLastRow(),sh.getLastColumn()).getValues();
  const h=vals[0].map(v=>String(v||'').trim());
  return vals.slice(1).filter(r=>r.some(v=>String(v==null?'':v).trim()!=='')).map(r=>{
    const o={}; h.forEach((k,i)=>{if(k)o[k]=r[i];}); return o;
  });
}

function qboNcdc114Unique_(rows,col,findings,sheet) {
  const seen={};
  rows.forEach(r=>{
    const k=String(r[col]||'');
    if(!k) findings.push({code:'MISSING_KEY',sheet:sheet,column:col});
    else if(seen[k]) findings.push({code:'DUPLICATE_KEY',sheet:sheet,key:k});
    else seen[k]=true;
  });
}
