/**
 * Module  : 4020_QBO_FullExportObservationCountHistoricalPreview.js
 * Version : 1.5.149
 * Purpose : Bounded/resumable, strictly read-only historical FULL_EXPORT
 *           ObservationCount reconstruction preview.
 *
 * Operator functions:
 *   startQboFullExportObservationCountHistoricalPreview()
 *   continueQboFullExportObservationCountHistoricalPreview()
 *   statusQboFullExportObservationCountHistoricalPreview()
 *   resetQboFullExportObservationCountHistoricalPreview()
 *
 * Production safety:
 *   - Never writes QBO_ExportRunHistory or 01_Sources.
 *   - Never acquires the workbook write lease or ScriptLock.
 *   - Never mutates production triggers.
 *   - Persists only diagnostic run state/results in Script Properties.
 *   - Freezes exact candidate identities at START.
 *   - Processes bounded work units and checkpoints after each candidate.
 *   - Operator reruns CONTINUE until COMPLETE; no continuation trigger is created.
 */
const QBO_FE_OBS_HIST_PREVIEW_ = Object.freeze({
  VERSION: '1.5.149',
  STATE_KEY: 'QBO_FE_OBS_HIST_PREVIEW_V148_STATE',
  RESULT_PREFIX: 'QBO_FE_OBS_HIST_PREVIEW_V148_RESULT_',
  HISTORY_SHEET: 'QBO_ExportRunHistory',
  SOURCE_SHEET: '01_Sources',
  MAX_CANDIDATES_PER_EXECUTION: 50,
  MAX_RUNTIME_MS: 240000
});

function startQboFullExportObservationCountHistoricalPreview() {
  const C = QBO_FE_OBS_HIST_PREVIEW_;
  const existing = qboFeObsHistLoadState_();
  if (existing && existing.status === 'RUNNING') {
    throw new Error('Historical preview already RUNNING. Use continue/status, or reset explicitly.');
  }

  const frozen = qboFeObsHistFreezeCandidates_();
  const state = {
    version:C.VERSION,
    operation:'READ_ONLY_HISTORICAL_RECONSTRUCTION_PREVIEW',
    previewRunId:'FE_OBS_HIST_PREVIEW_' + Utilities.getUuid(),
    status:'RUNNING',
    frozenAt:new Date().toISOString(),
    candidateCount:frozen.length,
    cursor:0,
    processedCount:0,
    findingCount:0,
    startedAt:new Date().toISOString(),
    lastHeartbeatAt:new Date().toISOString(),
    lastProgressAt:'',
    completedAt:'',
    candidates:frozen
  };
  qboFeObsHistSaveState_(state);
  console.log('[FULL EXPORT OBS HIST PREVIEW] | START | version=' + C.VERSION +
    ' | runId=' + state.previewRunId + ' | frozenCandidates=' + frozen.length +
    ' | writesPerformed=false | locksAcquired=false');
  return qboFeObsHistProcessBatch_();
}

function continueQboFullExportObservationCountHistoricalPreview() {
  const state = qboFeObsHistLoadState_();
  if (!state) throw new Error('No historical preview state. Run startQboFullExportObservationCountHistoricalPreview first.');
  if (state.status === 'COMPLETE') return statusQboFullExportObservationCountHistoricalPreview();
  if (state.status !== 'RUNNING') throw new Error('Historical preview status=' + state.status + '.');
  return qboFeObsHistProcessBatch_();
}

function statusQboFullExportObservationCountHistoricalPreview() {
  const state = qboFeObsHistLoadState_();
  if (!state) {
    const out = {version:QBO_FE_OBS_HIST_PREVIEW_.VERSION, status:'NOT_STARTED'};
    console.log(JSON.stringify(out, null, 2)); return out;
  }
  const results = qboFeObsHistLoadResults_(state.previewRunId, state.processedCount);
  const summary = qboFeObsHistSummarize_(state, results);
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

function resetQboFullExportObservationCountHistoricalPreview() {
  const props = PropertiesService.getScriptProperties();
  const state = qboFeObsHistLoadState_();
  if (state && state.previewRunId) {
    for (let i=0;i<Number(state.processedCount||0);i++) {
      props.deleteProperty(QBO_FE_OBS_HIST_PREVIEW_.RESULT_PREFIX + state.previewRunId + '_' + i);
    }
  }
  props.deleteProperty(QBO_FE_OBS_HIST_PREVIEW_.STATE_KEY);
  const out = {version:QBO_FE_OBS_HIST_PREVIEW_.VERSION, reset:true, productionWritesPerformed:false};
  console.log(JSON.stringify(out, null, 2)); return out;
}

function qboFeObsHistProcessBatch_() {
  const C = QBO_FE_OBS_HIST_PREVIEW_;
  const started = Date.now();
  const state = qboFeObsHistLoadState_();
  if (!state || state.status !== 'RUNNING') throw new Error('Preview is not RUNNING.');

  let units = 0;
  while (state.cursor < state.candidates.length &&
         units < C.MAX_CANDIDATES_PER_EXECUTION &&
         Date.now() - started < C.MAX_RUNTIME_MS) {
    const candidate = state.candidates[state.cursor];
    const result = qboFeObsHistEvaluateCandidate_(candidate);
    qboFeObsHistSaveResult_(state.previewRunId, state.cursor, result);

    state.cursor++;
    state.processedCount = state.cursor;
    state.findingCount += result.findings.length;
    state.lastHeartbeatAt = new Date().toISOString();
    state.lastProgressAt = state.lastHeartbeatAt;
    qboFeObsHistSaveState_(state); // checkpoint after each completed WorkUnit
    units++;
  }

  if (state.cursor >= state.candidates.length) {
    state.status = 'COMPLETE';
    state.completedAt = new Date().toISOString();
    state.lastHeartbeatAt = state.completedAt;
    qboFeObsHistSaveState_(state);
  }

  const out = {
    version:C.VERSION, previewRunId:state.previewRunId, status:state.status,
    frozenCandidateCount:state.candidateCount, processedCount:state.processedCount,
    remainingCount:state.candidateCount-state.processedCount,
    processedThisExecution:units, findingCount:state.findingCount,
    frozenAt:state.frozenAt, lastProgressAt:state.lastProgressAt,
    completedAt:state.completedAt || '',
    productionWritesPerformed:false, locksAcquired:false,
    nextAction:state.status === 'COMPLETE'
      ? 'Run statusQboFullExportObservationCountHistoricalPreview'
      : 'Run continueQboFullExportObservationCountHistoricalPreview'
  };
  console.log(JSON.stringify(out, null, 2));
  return out;
}

function qboFeObsHistFreezeCandidates_() {
  const history = qboFeObsHistRead_(qboFeObsHistOpenRunHistory_().getSheetByName(QBO_FE_OBS_HIST_PREVIEW_.HISTORY_SHEET));
  const sources = qboFeObsHistRead_(qboFeObsHistOpenStateCapture_().getSheetByName(QBO_FE_OBS_HIST_PREVIEW_.SOURCE_SHEET));
  qboFeObsHistRequire_(history.map,['RunId','ExportKey','Status','MasterBackupFileId','MasterBackupFileName','ObservationCount'],'history');
  qboFeObsHistRequire_(sources.map,['SourceId','SourceAcquisitionType','SourceRunId','ExportKey','MasterBackupFileId','MasterBackupFileName','ObservationCount'],'sources');

  const sourceById = {};
  sources.rows.forEach(function(r){
    const id=String(r.values[sources.map.SourceId]||'').trim();
    if(id) sourceById[id]={rowNumber:r.rowNumber, values:r.values};
  });

  const out=[];
  history.rows.forEach(function(r){
    if(String(r.values[history.map.Status]||'').trim().toUpperCase()!=='COMPLETE') return;
    const runId=String(r.values[history.map.RunId]||'').trim();
    const exportKey=String(r.values[history.map.ExportKey]||'').trim();
    if(!runId||!exportKey) return;
    const sid='FULL_EXPORT|'+runId+'|'+exportKey;
    const sr=sourceById[sid]||null;
    out.push({
      kind:'RUN_HISTORY',
      historyRow:r.rowNumber, runId:runId, exportKey:exportKey,
      masterBackupFileId:String(r.values[history.map.MasterBackupFileId]||'').trim(),
      masterBackupFileName:String(r.values[history.map.MasterBackupFileName]||'').trim(),
      frozenHistoryObservationCount:qboFeObsHistNullable_(r.values[history.map.ObservationCount]),
      sourceId:sid, sourceRow:sr?sr.rowNumber:null,
      frozenSourceObservationCount:sr?qboFeObsHistNullable_(sr.values[sources.map.ObservationCount]):null,
      sourcePresent:!!sr
    });
  });

  sources.rows.forEach(function(r){
    if(String(r.values[sources.map.SourceAcquisitionType]||'').trim().toUpperCase()!=='FULL_EXPORT_LEGACY') return;
    out.push({
      kind:'FULL_EXPORT_LEGACY',
      sourceRow:r.rowNumber,
      sourceId:String(r.values[sources.map.SourceId]||'').trim(),
      exportKey:String(r.values[sources.map.ExportKey]||'').trim(),
      masterBackupFileId:String(r.values[sources.map.MasterBackupFileId]||'').trim(),
      masterBackupFileName:String(r.values[sources.map.MasterBackupFileName]||'').trim(),
      frozenSourceObservationCount:qboFeObsHistNullable_(r.values[sources.map.ObservationCount])
    });
  });
  return out;
}

function qboFeObsHistEvaluateCandidate_(c) {
  const findings=[];
  const d=qboFeObsHistDerive_(c.exportKey,c.masterBackupFileId,c.masterBackupFileName);
  if(!d.valid) findings.push({type:d.category+'_FAILURE',detail:d.detail});
  let historyDisposition='NOT_APPLICABLE', sourceDisposition='NOT_APPLICABLE';
  if(c.kind==='RUN_HISTORY') {
    historyDisposition=!d.valid?'BLOCKED':
      c.frozenHistoryObservationCount===null?'PROPOSE_WRITE':
      Number(c.frozenHistoryObservationCount)===d.observationCount?'ALREADY_MATCHES':'EXISTING_MISMATCH';
    if(!c.sourcePresent) {
      sourceDisposition='SOURCE_MISSING';
      findings.push({type:'SOURCE_MISSING',detail:c.sourceId});
    } else {
      sourceDisposition=!d.valid?'BLOCKED':
        c.frozenSourceObservationCount===null?'PROPOSE_WRITE':
        Number(c.frozenSourceObservationCount)===d.observationCount?'ALREADY_MATCHES':'EXISTING_MISMATCH';
    }
  } else {
    sourceDisposition=!d.valid?'BLOCKED':
      c.frozenSourceObservationCount===null?'PROPOSE_WRITE':
      Number(c.frozenSourceObservationCount)===d.observationCount?'ALREADY_MATCHES':'EXISTING_MISMATCH';
  }
  if(historyDisposition==='EXISTING_MISMATCH') findings.push({type:'HISTORY_EXISTING_COUNT_MISMATCH'});
  if(sourceDisposition==='EXISTING_MISMATCH') findings.push({type:'SOURCE_EXISTING_COUNT_MISMATCH'});
  return {
    kind:c.kind, runId:c.runId||'', exportKey:c.exportKey, historyRow:c.historyRow||null,
    sourceId:c.sourceId||'', sourceRow:c.sourceRow||null,
    masterBackupFileId:c.masterBackupFileId, masterBackupFileName:c.masterBackupFileName,
    entitySheetName:d.entitySheetName||'', derivedObservationCount:d.valid?d.observationCount:null,
    frozenHistoryObservationCount:c.frozenHistoryObservationCount===undefined?null:c.frozenHistoryObservationCount,
    frozenSourceObservationCount:c.frozenSourceObservationCount===undefined?null:c.frozenSourceObservationCount,
    historyDisposition:historyDisposition, sourceDisposition:sourceDisposition,
    runHistoryIdentityFabricated:false, findings:findings
  };
}

function qboFeObsHistSummarize_(state, results) {
  const counts={};
  results.forEach(function(r){
    [r.historyDisposition,r.sourceDisposition].forEach(function(x){if(x&&x!=='NOT_APPLICABLE') counts[x]=(counts[x]||0)+1;});
  });
  const findings=[];
  results.forEach(function(r){r.findings.forEach(function(f){findings.push({kind:r.kind,runId:r.runId,exportKey:r.exportKey,sourceId:r.sourceId,type:f.type,detail:f.detail||''});});});
  return {
    version:state.version, operation:state.operation, previewRunId:state.previewRunId,
    status:state.status, frozenAt:state.frozenAt, frozenCandidateCount:state.candidateCount,
    processedCount:state.processedCount, remainingCount:state.candidateCount-state.processedCount,
    dispositionCounts:counts, findingCount:findings.length, findings:findings,
    safety:{productionWritesPerformed:false,locksAcquired:false,workbookWriteLeaseAcquired:false,triggerMutationPerformed:false},
    valid:state.status==='COMPLETE' && findings.length===0
  };
}

function qboFeObsHistDerive_(exportKey,fileId,fileName) {
  let entry=null;
  try {
    if(typeof getQboExportManifestEntry_==='function') entry=getQboExportManifestEntry_(exportKey);
    if(!entry && typeof getQboExportManifest_==='function'){
      const m=getQboExportManifest_();
      if(Array.isArray(m)) entry=m.filter(function(x){return x&&x.key===exportKey;})[0]||null;
      else if(m) entry=m[exportKey]||null;
    }
    if(!entry && typeof QBO_EXPORT_MANIFEST!=='undefined'){
      if(Array.isArray(QBO_EXPORT_MANIFEST)) entry=QBO_EXPORT_MANIFEST.filter(function(x){return x&&x.key===exportKey;})[0]||null;
      else entry=QBO_EXPORT_MANIFEST[exportKey]||null;
    }
  } catch(e){return {valid:false,category:'MANIFEST',detail:String(e&&e.message||e)};}
  if(!entry||!String(entry.entitySheetName||'').trim()) return {valid:false,category:'MANIFEST',detail:'Missing manifest.entitySheetName'};
  if(!fileId) return {valid:false,category:'MASTER_BACKUP',detail:'Missing MasterBackupFileId'};
  try{
    const f=DriveApp.getFileById(fileId);
    if(fileName && f.getName()!==fileName) return {valid:false,category:'MASTER_BACKUP',detail:'MasterBackup name mismatch'};
    const wb=SpreadsheetApp.openById(fileId);
    const name=String(entry.entitySheetName).trim();
    const sh=wb.getSheetByName(name);
    if(!sh) return {valid:false,category:'DERIVATION',detail:'Missing entity sheet '+name};
    const n=Math.max(0,sh.getLastRow()-1);
    if(!Number.isFinite(n)||n<0||Math.floor(n)!==n) return {valid:false,category:'DERIVATION',detail:'Invalid count '+n};
    return {valid:true,entitySheetName:name,observationCount:n};
  }catch(e){return {valid:false,category:'MASTER_BACKUP',detail:String(e&&e.message||e)};}
}

function qboFeObsHistRead_(sheet){
  if(!sheet) throw new Error('Required sheet not found.');
  const v=sheet.getDataRange().getValues(), headers=v.length?v[0].map(function(x){return String(x||'').trim();}):[], map={};
  headers.forEach(function(h,i){if(h)map[h]=i;});
  const rows=[]; for(let i=1;i<v.length;i++) rows.push({rowNumber:i+1,values:v[i]});
  return {map:map,rows:rows};
}
function qboFeObsHistRequire_(m,a,n){a.forEach(function(h){if(m[h]===undefined)throw new Error(n+' missing '+h);});}
function qboFeObsHistNullable_(v){return v===''||v===null||v===undefined?null:Number(v);}
function qboFeObsHistLoadState_(){const s=PropertiesService.getScriptProperties().getProperty(QBO_FE_OBS_HIST_PREVIEW_.STATE_KEY);return s?JSON.parse(s):null;}
function qboFeObsHistSaveState_(s){PropertiesService.getScriptProperties().setProperty(QBO_FE_OBS_HIST_PREVIEW_.STATE_KEY,JSON.stringify(s));}
function qboFeObsHistSaveResult_(id,i,r){PropertiesService.getScriptProperties().setProperty(QBO_FE_OBS_HIST_PREVIEW_.RESULT_PREFIX+id+'_'+i,JSON.stringify(r));}
function qboFeObsHistLoadResults_(id,n){const p=PropertiesService.getScriptProperties(),out=[];for(let i=0;i<n;i++){const s=p.getProperty(QBO_FE_OBS_HIST_PREVIEW_.RESULT_PREFIX+id+'_'+i);if(s)out.push(JSON.parse(s));}return out;}

function qboFeObsHistOpenRunHistory_(){
  if(typeof getQboRunHistorySpreadsheet_==='function')return getQboRunHistorySpreadsheet_();
  if(typeof openQboRunHistorySpreadsheet_==='function')return openQboRunHistorySpreadsheet_();
  if(typeof QBO_RUN_HISTORY_CONFIG!=='undefined'&&QBO_RUN_HISTORY_CONFIG.SPREADSHEET_ID)return SpreadsheetApp.openById(QBO_RUN_HISTORY_CONFIG.SPREADSHEET_ID);
  if(typeof QBO_RUN_HISTORY!=='undefined'&&QBO_RUN_HISTORY.SPREADSHEET_ID)return SpreadsheetApp.openById(QBO_RUN_HISTORY.SPREADSHEET_ID);
  throw new Error('Unable to resolve run-history workbook.');
}
function qboFeObsHistOpenStateCapture_(){
  if(typeof getQboStateCaptureSpreadsheet_==='function')return getQboStateCaptureSpreadsheet_();
  if(typeof openQboStateCaptureSpreadsheet_==='function')return openQboStateCaptureSpreadsheet_();
  if(typeof QBO_STATE_CAPTURE_CONFIG!=='undefined'&&QBO_STATE_CAPTURE_CONFIG.SPREADSHEET_ID)return SpreadsheetApp.openById(QBO_STATE_CAPTURE_CONFIG.SPREADSHEET_ID);
  if(typeof QBO_STATE_CAPTURE!=='undefined'&&QBO_STATE_CAPTURE.SPREADSHEET_ID)return SpreadsheetApp.openById(QBO_STATE_CAPTURE.SPREADSHEET_ID);
  throw new Error('Unable to resolve State Capture workbook.');
}
