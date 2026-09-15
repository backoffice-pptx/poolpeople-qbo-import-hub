/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 116_QBO_RegisteredAtArtifactCorrelationResumable.js
 * Version     : 1.5.86
 * Purpose     : Bounded/resumable Change Payload artifact correlation for
 *               blank 05.RegisteredAt recovery evidence.
 *
 * Safety:
 *   - READ ONLY against production/state data and payload files.
 *   - Writes diagnostic-only sheet 99_RegisteredAt_Artifact_Scan.
 *   - Uses ONE compact Script Property as a temporary continuation checkpoint.
 *   - Never treats payload timestamps as exact RegisteredAt unless separately
 *     proven by contract; this scanner only collects correlation evidence.
 * ============================================================================
 */

const QBO_REGISTERED_AT_ARTIFACT_SCAN_ = Object.freeze({
  VERSION:'QBO_REGISTERED_AT_ARTIFACT_CORRELATION_V1_5_86_TARGET_COVERAGE_DIAGNOSTIC',
  SHEET_NAME:'99_RegisteredAt_Artifact_Scan',
  PROPERTY_KEY:'QBO_REGISTERED_AT_ARTIFACT_SCAN_V1',
  MAX_RUNTIME_MS:165000,
  LOG_INTERVAL_MS:15000,
  CHECKPOINT_EVERY_FILES:25,
  HEADERS:Object.freeze([
    'AssessmentRunId','AuditRunId','IngestionSourceId','PayloadFileId','PayloadFileName',
    'PayloadEnvelopeCreatedAt','PayloadDriveCreatedAt','WorkUnitId','IngestionRunId',
    'ScannedAt'
  ])
});

/**
 * Run repeatedly until status=SCAN_COMPLETE.
 * Each invocation resumes from the Drive iterator continuation token.
 */
function scanQboRegisteredAtPayloadArtifactsResumable() {
  const started = Date.now();
  const props = PropertiesService.getScriptProperties();
  const ss = getQboStateCaptureSpreadsheet_();
  let state = qboRegArtifactLoadState_(props);

  if (!state) {
    state = qboRegArtifactInitializeState_(ss);
    qboRegArtifactResetOutputForRun_(ss, state.assessmentRunId);
    qboRegArtifactSaveState_(props, state);
    console.log('[REGISTERED AT ARTIFACT SCAN] | START | assessmentRunId=' + state.assessmentRunId + ' | auditRunId=' + state.auditRunId + ' | wantedSourceIds=' + state.wantedSourceIds.length);
  } else {
    console.log('[REGISTERED AT ARTIFACT SCAN] | RESUME | assessmentRunId=' + state.assessmentRunId + ' | scanned=' + state.scannedFileCount + ' | matched=' + state.matchedShardCount);
  }

  const wanted = Object.create(null);
  state.wantedSourceIds.forEach(function(id){ wanted[id]=true; });
  const folder = qboResolveGovernedFolderAsset_(
    QBO_CHANGE_PAYLOAD_PERSISTENCE_.FOLDER_ASSET_KEY,
    QBO_CHANGE_PAYLOAD_PERSISTENCE_.FOLDER_EXPECTED_TYPE,
    QBO_CHANGE_PAYLOAD_PERSISTENCE_.ENVIRONMENT
  );
  let it;
  if (state.continuationToken) {
    try { it = DriveApp.continueFileIterator(state.continuationToken); }
    catch (e) {
      throw new Error('REGISTERED_AT_ARTIFACT_CONTINUATION_INVALID: ' + (e && e.message ? e.message : e));
    }
  } else {
    it = folder.getFiles();
  }

  const out=[];
  let lastLog=Date.now();
  let sinceCheckpoint=0;
  while (it.hasNext()) {
    if (Date.now()-started >= QBO_REGISTERED_AT_ARTIFACT_SCAN_.MAX_RUNTIME_MS) break;
    const file=it.next();
    state.scannedFileCount += 1;
    sinceCheckpoint += 1;
    const name=file.getName();
    if (name.indexOf(QBO_CHANGE_PAYLOAD_PERSISTENCE_.FILE_PREFIX)===0) {
      try {
        const envelope=JSON.parse(file.getBlob().getDataAsString('UTF-8'));
        const body=(envelope && envelope.stableBody)||{};
        const sourceId=String(body.sourceId||'').trim();
        if (sourceId && wanted[sourceId]) {
          const dc=file.getDateCreated();
          out.push([
            state.assessmentRunId,state.auditRunId,sourceId,file.getId(),name,
            String(envelope.createdAt||''),dc?dc.toISOString():'',String(body.workUnitId||''),
            String(body.ingestionRunId||''),new Date()
          ]);
          state.matchedShardCount += 1;
        }
      } catch (e) { state.invalidJsonFileCount += 1; }
    }

    if (sinceCheckpoint >= QBO_REGISTERED_AT_ARTIFACT_SCAN_.CHECKPOINT_EVERY_FILES) {
      if (out.length) { qboRegArtifactAppendRows_(ss,out.splice(0,out.length)); }
      state.continuationToken = it.getContinuationToken();
      qboRegArtifactSaveState_(props,state);
      sinceCheckpoint=0;
    }
    if (Date.now()-lastLog >= QBO_REGISTERED_AT_ARTIFACT_SCAN_.LOG_INTERVAL_MS) {
      console.log('[REGISTERED AT ARTIFACT SCAN] | PROGRESS | scanned=' + state.scannedFileCount + ' | matched=' + state.matchedShardCount + ' | invalidJson=' + state.invalidJsonFileCount + ' | elapsedSec=' + Math.round((Date.now()-started)/1000));
      lastLog=Date.now();
    }
  }

  if (out.length) qboRegArtifactAppendRows_(ss,out);

  if (it.hasNext()) {
    state.continuationToken = it.getContinuationToken();
    qboRegArtifactSaveState_(props,state);
    const partial={version:QBO_REGISTERED_AT_ARTIFACT_SCAN_.VERSION,status:'PARTIAL_RESUME_REQUIRED',assessmentRunId:state.assessmentRunId,auditRunId:state.auditRunId,scannedFileCount:state.scannedFileCount,matchedShardCount:state.matchedShardCount,invalidJsonFileCount:state.invalidJsonFileCount,elapsedMs:Date.now()-started,productionDataReadOnly:true};
    console.log('[REGISTERED AT ARTIFACT SCAN] | PARTIAL | ' + JSON.stringify(partial));
    return partial;
  }

  state.continuationToken='';
  state.completedAt=new Date().toISOString();
  props.deleteProperty(QBO_REGISTERED_AT_ARTIFACT_SCAN_.PROPERTY_KEY);
  const result={version:QBO_REGISTERED_AT_ARTIFACT_SCAN_.VERSION,status:'SCAN_COMPLETE',assessmentRunId:state.assessmentRunId,auditRunId:state.auditRunId,wantedSourceIdCount:state.wantedSourceIds.length,scannedFileCount:state.scannedFileCount,matchedShardCount:state.matchedShardCount,invalidJsonFileCount:state.invalidJsonFileCount,outputSheet:QBO_REGISTERED_AT_ARTIFACT_SCAN_.SHEET_NAME,productionDataReadOnly:true,completedAt:state.completedAt};
  console.log('[REGISTERED AT ARTIFACT SCAN] | COMPLETE | ' + JSON.stringify(result));
  return result;
}

function resetQboRegisteredAtPayloadArtifactScanDiagnostic() {
  PropertiesService.getScriptProperties().deleteProperty(QBO_REGISTERED_AT_ARTIFACT_SCAN_.PROPERTY_KEY);
  console.log('[REGISTERED AT ARTIFACT SCAN] | CHECKPOINT RESET ONLY');
}

function qboRegArtifactInitializeState_(ss) {
  const auditRunId=qboRegArtifactLatestAuditRunId_(ss);
  if(!auditRunId) throw new Error('REGISTERED_AT_ARTIFACT_NO_AUDIT_RUN');
  const blankIds=qboRegArtifactBlankRegisteredAtIds_(ss,auditRunId);
  const ledger=ss.getSheetByName(QBO_FORWARD_INGESTION_CONTROL_.SHEET_NAME);
  const h=ledger.getRange(1,1,1,ledger.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();});
  const ix={}; h.forEach(function(x,i){ix[x]=i;});
  ['IngestionSourceId','SourceType','SourceRunId'].forEach(function(x){if(ix[x]===undefined)throw new Error('REGISTERED_AT_ARTIFACT_HEADER_MISSING '+x);});
  const vals=ledger.getRange(2,1,ledger.getLastRow()-1,ledger.getLastColumn()).getValues();
  const rows=vals.map(function(r){return {id:String(r[ix.IngestionSourceId]||'').trim(),type:String(r[ix.SourceType]||'').trim(),run:String(r[ix.SourceRunId]||'').trim()};});
  const blankSet=Object.create(null); blankIds.forEach(function(id){blankSet[id]=true;});
  const cycles=Object.create(null);
  rows.forEach(function(r){if(blankSet[r.id]&&r.type==='NATIVE_CDC')cycles[r.run]=true;});
  const wanted=Object.create(null);
  rows.forEach(function(r){if(blankSet[r.id] || (r.type==='NATIVE_CDC'&&cycles[r.run])) wanted[r.id]=true;});
  return {assessmentRunId:'REGISTERED_AT_ARTIFACT_SCAN|'+Utilities.getUuid(),auditRunId:auditRunId,wantedSourceIds:Object.keys(wanted),continuationToken:'',scannedFileCount:0,matchedShardCount:0,invalidJsonFileCount:0,startedAt:new Date().toISOString()};
}

function qboRegArtifactBlankRegisteredAtIds_(ss,auditRunId){
  const sh=ss.getSheetByName(QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.FINDING_SHEET);
  const h=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();});
  const ix={}; h.forEach(function(x,i){ix[x]=i;});
  return sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues().filter(function(r){return String(r[ix.AuditRunId]||'').trim()===auditRunId&&String(r[ix.Result]||'').trim()==='INVALID'&&String(r[ix.SheetName]||'').trim()===QBO_FORWARD_INGESTION_CONTROL_.SHEET_NAME&&String(r[ix.ColumnOrRule]||'').trim()==='RegisteredAt'&&String(r[ix.FindingCode]||'').trim()==='REQUIRED_DATE_BLANK';}).map(function(r){return String(r[ix.RecordId]||'').trim();});
}

function qboRegArtifactLatestAuditRunId_(ss){
  const sh=ss.getSheetByName(QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.RUN_SHEET); if(!sh||sh.getLastRow()<2)return '';
  const h=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();}); const ix={};h.forEach(function(x,i){ix[x]=i;});
  let best='',bestMs=-1; sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues().forEach(function(r){const id=String(r[ix.AuditRunId]||'').trim();const d=new Date(r[ix.CompletedAt]);if(id&&!isNaN(d.getTime())&&d.getTime()>=bestMs){best=id;bestMs=d.getTime();}}); return best;
}

function qboRegArtifactResetOutputForRun_(ss,assessmentRunId){
  let sh=ss.getSheetByName(QBO_REGISTERED_AT_ARTIFACT_SCAN_.SHEET_NAME); const h=QBO_REGISTERED_AT_ARTIFACT_SCAN_.HEADERS;
  if(!sh){sh=ss.insertSheet(QBO_REGISTERED_AT_ARTIFACT_SCAN_.SHEET_NAME);sh.getRange(1,1,1,h.length).setValues([h]);sh.setFrozenRows(1);sh.getRange(1,1,1,h.length).setFontWeight('bold');}
  else {const actual=sh.getRange(1,1,1,Math.max(h.length,sh.getLastColumn())).getValues()[0].slice(0,h.length).map(function(v){return String(v||'').trim();});if(actual.join('|')!==h.join('|')){sh.clear();sh.getRange(1,1,1,h.length).setValues([h]);sh.setFrozenRows(1);sh.getRange(1,1,1,h.length).setFontWeight('bold');}}
  sh.getDataRange().setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
}
function qboRegArtifactAppendRows_(ss,rows){if(!rows.length)return;const sh=ss.getSheetByName(QBO_REGISTERED_AT_ARTIFACT_SCAN_.SHEET_NAME);sh.getRange(sh.getLastRow()+1,1,rows.length,QBO_REGISTERED_AT_ARTIFACT_SCAN_.HEADERS.length).setValues(rows);sh.getDataRange().setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);SpreadsheetApp.flush();}
function qboRegArtifactLoadState_(props){const raw=props.getProperty(QBO_REGISTERED_AT_ARTIFACT_SCAN_.PROPERTY_KEY);if(!raw)return null;try{return JSON.parse(raw);}catch(e){throw new Error('REGISTERED_AT_ARTIFACT_CHECKPOINT_CORRUPT');}}
function qboRegArtifactSaveState_(props,state){props.setProperty(QBO_REGISTERED_AT_ARTIFACT_SCAN_.PROPERTY_KEY,JSON.stringify(state));}


/**
 * Fast read-only diagnostic added in v1.5.86.
 *
 * Purpose:
 *   1) Count how many files are actually present in the governed Change Payload
 *      folder WITHOUT opening/parsing their JSON bodies.
 *   2) Inspect the 05 rows whose RegisteredAt is blank and report whether those
 *      rows say payload shards were actually produced (ShardCount / PayloadCount).
 *   3) Compare those target rows with any artifacts already discovered in sheet 99.
 *
 * This avoids continuing the expensive full-content Drive scan blindly.
 */
function diagnoseQboRegisteredAtArtifactCoverage() {
  const started = Date.now();
  const ss = getQboStateCaptureSpreadsheet_();
  const auditRunId = qboRegArtifactLatestAuditRunId_(ss);
  if (!auditRunId) throw new Error('REGISTERED_AT_TARGET_COVERAGE_NO_AUDIT_RUN');

  const blankIds = qboRegArtifactBlankRegisteredAtIds_(ss, auditRunId);
  const blankSet = Object.create(null);
  blankIds.forEach(function(id){ blankSet[id] = true; });

  const ledger = ss.getSheetByName(QBO_FORWARD_INGESTION_CONTROL_.SHEET_NAME);
  if (!ledger || ledger.getLastRow() < 2) throw new Error('REGISTERED_AT_TARGET_COVERAGE_05_EMPTY');
  const headers = ledger.getRange(1,1,1,ledger.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();});
  const ix = Object.create(null);
  headers.forEach(function(h,i){ ix[h] = i; });
  ['IngestionSourceId','SourceType','SourceRunId','ProcessingStatus'].forEach(function(h){
    if (ix[h] === undefined) throw new Error('REGISTERED_AT_TARGET_COVERAGE_HEADER_MISSING ' + h);
  });

  const vals = ledger.getRange(2,1,ledger.getLastRow()-1,ledger.getLastColumn()).getValues();
  const targets = [];
  vals.forEach(function(r){
    const id = String(r[ix.IngestionSourceId]||'').trim();
    if (!blankSet[id]) return;
    targets.push({
      id:id,
      sourceType:String(r[ix.SourceType]||'').trim(),
      sourceRunId:String(r[ix.SourceRunId]||'').trim(),
      entityType:ix.EntityType===undefined?'':String(r[ix.EntityType]||'').trim(),
      processingStatus:String(r[ix.ProcessingStatus]||'').trim(),
      recordCursor:qboRegArtifactDiagNum_(r,ix,'RecordCursor'),
      observationCount:qboRegArtifactDiagNum_(r,ix,'ObservationCount'),
      payloadCount:qboRegArtifactDiagNum_(r,ix,'PayloadCount'),
      shardCount:qboRegArtifactDiagNum_(r,ix,'ShardCount'),
      attemptCount:qboRegArtifactDiagNum_(r,ix,'AttemptCount'),
      registeredAt:qboRegArtifactDiagText_(r,ix,'RegisteredAt'),
      processedAt:qboRegArtifactDiagText_(r,ix,'ProcessedAt'),
      lastHeartbeatAt:qboRegArtifactDiagText_(r,ix,'LastHeartbeatAt'),
      lastProgressAt:qboRegArtifactDiagText_(r,ix,'LastProgressAt'),
      lastCompletedWorkUnit:qboRegArtifactDiagText_(r,ix,'LastCompletedWorkUnit') || qboRegArtifactDiagText_(r,ix,'LastCompletedWorkUnitId')
    });
  });

  const matchedBySource = Object.create(null);
  const artifactSheet = ss.getSheetByName(QBO_REGISTERED_AT_ARTIFACT_SCAN_.SHEET_NAME);
  if (artifactSheet && artifactSheet.getLastRow() >= 2) {
    const ah = artifactSheet.getRange(1,1,1,artifactSheet.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();});
    const aix = Object.create(null); ah.forEach(function(h,i){aix[h]=i;});
    if (aix.IngestionSourceId !== undefined) {
      artifactSheet.getRange(2,1,artifactSheet.getLastRow()-1,artifactSheet.getLastColumn()).getValues().forEach(function(r){
        const id=String(r[aix.IngestionSourceId]||'').trim();
        if (id && blankSet[id]) matchedBySource[id]=(matchedBySource[id]||0)+1;
      });
    }
  }

  const byType = Object.create(null);
  const byStatus = Object.create(null);
  let expectedShardTotal = 0;
  let expectedPayloadTotal = 0;
  let observationTotal = 0;
  let rowsWithShardCount = 0;
  let rowsWithZeroShardCount = 0;
  let rowsShardCountBlank = 0;
  let targetIdsAlreadyMatched = 0;
  const rowsExpectingShardButNoKnownArtifact = [];
  const rowsZeroShard = [];

  targets.forEach(function(t){
    byType[t.sourceType]=(byType[t.sourceType]||0)+1;
    byStatus[t.processingStatus]=(byStatus[t.processingStatus]||0)+1;
    if (t.observationCount !== null) observationTotal += t.observationCount;
    if (t.payloadCount !== null) expectedPayloadTotal += t.payloadCount;
    if (t.shardCount === null) rowsShardCountBlank += 1;
    else if (t.shardCount > 0) {
      rowsWithShardCount += 1;
      expectedShardTotal += t.shardCount;
      if (!matchedBySource[t.id]) rowsExpectingShardButNoKnownArtifact.push({id:t.id,type:t.sourceType,run:t.sourceRunId,entity:t.entityType,status:t.processingStatus,shardCount:t.shardCount,payloadCount:t.payloadCount,observationCount:t.observationCount});
    } else {
      rowsWithZeroShardCount += 1;
      rowsZeroShard.push({id:t.id,type:t.sourceType,run:t.sourceRunId,entity:t.entityType,status:t.processingStatus,payloadCount:t.payloadCount,observationCount:t.observationCount});
    }
    if (matchedBySource[t.id]) targetIdsAlreadyMatched += 1;
  });

  // Count files only. Do not call getBlob(), parse JSON, or inspect file contents.
  const folder = qboResolveGovernedFolderAsset_(
    QBO_CHANGE_PAYLOAD_PERSISTENCE_.FOLDER_ASSET_KEY,
    QBO_CHANGE_PAYLOAD_PERSISTENCE_.FOLDER_EXPECTED_TYPE,
    QBO_CHANGE_PAYLOAD_PERSISTENCE_.ENVIRONMENT
  );
  const fit = folder.getFiles();
  let totalFolderFileCount = 0;
  while (fit.hasNext()) { fit.next(); totalFolderFileCount += 1; }

  const result = {
    version:'QBO_REGISTERED_AT_TARGET_ARTIFACT_COVERAGE_V1_5_86',
    status:'DIAGNOSTIC_COMPLETE',
    readOnly:true,
    auditRunId:auditRunId,
    targetBlankRegisteredAtCount:blankIds.length,
    targetRowsFoundIn05:targets.length,
    targetBySourceType:byType,
    targetByProcessingStatus:byStatus,
    targetLedgerEvidence:{
      observationTotal:observationTotal,
      payloadTotal:expectedPayloadTotal,
      shardTotal:expectedShardTotal,
      rowsWithShardCountGreaterThanZero:rowsWithShardCount,
      rowsWithShardCountZero:rowsWithZeroShardCount,
      rowsWithShardCountBlank:rowsShardCountBlank
    },
    existingArtifactScanEvidence:{
      matchedTargetSourceIdCount:targetIdsAlreadyMatched,
      matchedShardRowCount:Object.keys(matchedBySource).reduce(function(n,k){return n+Number(matchedBySource[k]||0);},0),
      currentScannerCheckpoint:qboRegArtifactDiagCurrentCheckpoint_()
    },
    payloadFolder:{
      totalFileCount:totalFolderFileCount,
      contentParsed:false
    },
    rowsExpectingShardButNoKnownArtifactCount:rowsExpectingShardButNoKnownArtifact.length,
    rowsExpectingShardButNoKnownArtifactSample:rowsExpectingShardButNoKnownArtifact.slice(0,25),
    zeroShardTargetCount:rowsZeroShard.length,
    zeroShardTargetSample:rowsZeroShard.slice(0,25),
    elapsedMs:Date.now()-started
  };
  console.log('[REGISTERED AT TARGET COVERAGE] | COMPLETE | ' + JSON.stringify(result, null, 2));
  return result;
}

function qboRegArtifactDiagNum_(row,ix,name){
  if(ix[name]===undefined) return null;
  const v=row[ix[name]];
  if(v==='' || v===null || v===undefined) return null;
  const n=Number(v); return isFinite(n)?n:null;
}
function qboRegArtifactDiagText_(row,ix,name){return ix[name]===undefined?'':String(row[ix[name]]||'').trim();}
function qboRegArtifactDiagCurrentCheckpoint_(){
  const raw=PropertiesService.getScriptProperties().getProperty(QBO_REGISTERED_AT_ARTIFACT_SCAN_.PROPERTY_KEY);
  if(!raw) return null;
  try {
    const s=JSON.parse(raw);
    return {assessmentRunId:s.assessmentRunId||'',scannedFileCount:Number(s.scannedFileCount||0),matchedShardCount:Number(s.matchedShardCount||0),invalidJsonFileCount:Number(s.invalidJsonFileCount||0),hasContinuationToken:!!s.continuationToken};
  } catch(e) { return {corrupt:true}; }
}
