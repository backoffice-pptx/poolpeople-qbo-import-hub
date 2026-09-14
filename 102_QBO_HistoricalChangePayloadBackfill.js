/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 102_QBO_HistoricalChangePayloadBackfill.js
 * Version     : 1.5.55
 * Purpose     : Controlled historical FULL_EXPORT -> normalized Change Payload
 *               backfill with bounded within-source work units.
 *
 * Locked orchestration doctrine:
 *   - Small sources may share one worker execution.
 *   - Large sources are split into bounded record batches.
 *   - Checkpoint after every completed batch/source.
 *   - Never begin new work when remaining runtime is below safety threshold.
 *   - Resume exactly from SourceIndex + RecordCursor/WorkUnitIndex.
 *   - Watchdog uses durable LastHeartbeatAt/LastProgressAt, never lease expiry
 *     alone, to infer stale work.
 * ============================================================================
 */

const QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_ = Object.freeze({
  VERSION: 'QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_V1',
  STATE_PROPERTY: 'QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_STATE_V1',
  WORKER_RUNTIME_BUDGET_MS: 240000,
  MIN_SAFE_NEW_WORK_MS: 45000,
  RECORD_BATCH_SIZE: 250,
  WORKER_LEASE_MS: 360000,
  STALE_PROGRESS_MS: 12 * 60 * 1000,
  CONTINUATION_DELAY_MS: 60 * 1000,
  WATCHDOG_DELAY_MS: 5 * 60 * 1000,
  TRIGGER_HANDLERS: Object.freeze({NEXT:'runNextQboHistoricalChangePayloadWork', WATCHDOG:'watchdogQboHistoricalChangePayloadBackfill'})
});

function testQboHistoricalChangePayloadBackfillReadiness() {
  const ss = getQboStateCaptureSpreadsheet_();
  validateQboStateCaptureWorkbookStructure_(ss);
  const sourceSheet = ss.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
  const sources = loadQboStateCaptureWriteSources_(sourceSheet, '');
  const sourceAvailable = sources.filter(qboHistoricalPayloadSourceAvailable_);
  const eligible = sourceAvailable.filter(qboHistoricalPayloadSourceEligible_);
  const excludedUnsupported = sourceAvailable.filter(function(s){ return !qboHistoricalPayloadSourceSupported_(s); });
  const result = {
    ready: true,
    backfillVersion: QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.VERSION,
    sourceCount: sources.length,
    availableHistoricalFullExportSourceCount: sourceAvailable.length,
    eligibleHistoricalFullExportSourceCount: eligible.length,
    excludedUnsupportedSourceCount: excludedUnsupported.length,
    excludedUnsupportedExportKeys: Array.from(new Set(excludedUnsupported.map(function(s){return s.exportKey;}))).sort(),
    recordBatchSize: QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.RECORD_BATCH_SIZE,
    workerRuntimeBudgetMs: QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.WORKER_RUNTIME_BUDGET_MS,
    minSafeNewWorkMs: QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.MIN_SAFE_NEW_WORK_MS,
    exactResumeCursor: 'SourceIndex+RecordCursor+WorkUnitIndex',
    watchdogUsesDurableProgress: true,
    stateApplicationWritesEnabled: false
  };
  console.log('[HISTORICAL PAYLOAD BACKFILL] | READY | ' + JSON.stringify(result));
  return result;
}

function startQboHistoricalChangePayloadBackfill() {
  const now = new Date();
  const ss = getQboStateCaptureSpreadsheet_();
  const sourceSheet = ss.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
  const sources = loadQboStateCaptureWriteSources_(sourceSheet, '').filter(qboHistoricalPayloadSourceEligible_);
  if (!sources.length) throw new Error('HISTORICAL_PAYLOAD_BACKFILL_NO_ELIGIBLE_SOURCES');
  const runId = 'HIST_PAYLOAD|' + Utilities.getUuid();
  const state = {
    version: QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.VERSION,
    runId: runId, status:'RUNNING', startedAt:now.toISOString(), completedAt:'',
    sourceIds: sources.map(function(s){return s.sourceId;}), sourceIndex:0, recordCursor:0, workUnitIndex:0,
    lastHeartbeatAt:now.toISOString(), lastProgressAt:now.toISOString(), lastCompletedWorkUnit:'', activeWorkUnitId:'',
    workerLeaseOwner:'', workerLeaseExpiresAt:'', workerLeaseExpiresAtMs:0,
    payloadCount:0, shardCount:0, sourceCompleteCount:0, skippedSourceCount:0, evidenceExceptionCount:0, error:''
  };
  qboHistoricalPayloadWithLock_(function(){
    const prior=qboHistoricalPayloadLoadState_();
    if (prior && (prior.status==='RUNNING' || prior.status==='BLOCKED')) throw new Error('HISTORICAL_PAYLOAD_BACKFILL_ACTIVE runId='+prior.runId+' status='+prior.status);
    qboHistoricalPayloadSaveState_(state);
    qboHistoricalPayloadDeleteTriggerLocked_(QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.TRIGGER_HANDLERS.NEXT);
    qboHistoricalPayloadDeleteTriggerLocked_(QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.TRIGGER_HANDLERS.WATCHDOG);
    qboHistoricalPayloadScheduleTriggerLocked_(QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.TRIGGER_HANDLERS.NEXT, 1000);
    qboHistoricalPayloadScheduleTriggerLocked_(QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.TRIGGER_HANDLERS.WATCHDOG, QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.WATCHDOG_DELAY_MS);
  });
  console.log('[HISTORICAL PAYLOAD BACKFILL] | STARTED | runId='+runId+' | sources='+sources.length);
  return state;
}

function listQboHistoricalChangePayloadBackfillStatus() {
  const state=qboHistoricalPayloadLoadState_();
  if (!state) { console.log('[HISTORICAL PAYLOAD BACKFILL] | STATUS | none'); return null; }
  const currentIndex=Number(state.sourceIndex||0);
  const out={
    version:state.version, runId:state.runId, status:state.status, startedAt:state.startedAt, completedAt:state.completedAt,
    sourceCount:(state.sourceIds||[]).length, sourceIndex:currentIndex,
    currentSourceId:(state.sourceIds&&currentIndex<state.sourceIds.length)?state.sourceIds[currentIndex]:'',
    recordCursor:Number(state.recordCursor||0), workUnitIndex:Number(state.workUnitIndex||0),
    payloadCount:Number(state.payloadCount||0), shardCount:Number(state.shardCount||0),
    sourceCompleteCount:Number(state.sourceCompleteCount||0), skippedSourceCount:Number(state.skippedSourceCount||0),
    evidenceExceptionCount:Number(state.evidenceExceptionCount||0),
    lastHeartbeatAt:state.lastHeartbeatAt, lastProgressAt:state.lastProgressAt,
    lastCompletedWorkUnit:state.lastCompletedWorkUnit, activeWorkUnitId:state.activeWorkUnitId,
    workerLeaseExpiresAt:state.workerLeaseExpiresAt,
    workerLeaseActive:!!(state.workerLeaseOwner && Number(state.workerLeaseExpiresAtMs||0)>Date.now()),
    error:state.error||''
  };
  console.log('[HISTORICAL PAYLOAD BACKFILL] | STATUS | '+JSON.stringify(out));
  return out;
}

function pauseQboHistoricalChangePayloadBackfill() {
  qboHistoricalPayloadWithLock_(function(){
    qboHistoricalPayloadDeleteTriggerLocked_(QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.TRIGGER_HANDLERS.NEXT);
    qboHistoricalPayloadDeleteTriggerLocked_(QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.TRIGGER_HANDLERS.WATCHDOG);
  });
  console.log('[HISTORICAL PAYLOAD BACKFILL] | PAUSED TRIGGERS | durable run state preserved.');
}

function resumeQboHistoricalChangePayloadBackfill() {
  qboHistoricalPayloadWithLock_(function(){
    const s=qboHistoricalPayloadLoadState_();
    if (!s || (s.status!=='RUNNING' && s.status!=='BLOCKED')) throw new Error('HISTORICAL_PAYLOAD_BACKFILL_NOT_RESUMABLE');
    s.status='RUNNING'; s.error=''; s.activeWorkUnitId=''; qboHistoricalPayloadSaveState_(s);
    qboHistoricalPayloadDeleteTriggerLocked_(QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.TRIGGER_HANDLERS.NEXT);
    qboHistoricalPayloadDeleteTriggerLocked_(QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.TRIGGER_HANDLERS.WATCHDOG);
    qboHistoricalPayloadScheduleTriggerLocked_(QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.TRIGGER_HANDLERS.NEXT,1000);
    qboHistoricalPayloadScheduleTriggerLocked_(QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.TRIGGER_HANDLERS.WATCHDOG,QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.WATCHDOG_DELAY_MS);
  });
  console.log('[HISTORICAL PAYLOAD BACKFILL] | RESUMED | durable cursor preserved.');
}

function inspectCurrentQboHistoricalChangePayloadBlockedRow() {
  const state=qboHistoricalPayloadLoadState_();
  if (!state) throw new Error('HISTORICAL_PAYLOAD_BACKFILL_STATE_NOT_FOUND');
  if (state.sourceIndex >= state.sourceIds.length) return null;
  const source=qboHistoricalPayloadResolveSource_(state.sourceIds[state.sourceIndex]);
  const manifest=getQboExportManifestEntry_(source.exportKey);
  if (!manifest) throw new Error('HISTORICAL_PAYLOAD_CONTRACT_NOT_FOUND '+source.exportKey);
  const file=SpreadsheetApp.openById(source.masterBackupFileId), sh=file.getSheetByName(manifest.sheetNames[0]);
  const headers=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String), idx={}; headers.forEach(function(h,i){idx[h]=i;});
  const preservedError=String(state.error||'');
  const errorRowMatch=preservedError.match(/(?:^|\s)row=(\d+)(?:\s|$)/);
  const errorSourceMatch=preservedError.match(/source=([^\s]+)(?:\s|$)/);
  const errorTargetsCurrentSource=!errorSourceMatch || errorSourceMatch[1]===source.sourceId;
  const errorRowNumber=(errorRowMatch && errorTargetsCurrentSource) ? Number(errorRowMatch[1]) : 0;
  const rowNumber=Math.max(2,errorRowNumber||2+Number(state.recordCursor||0));
  const row=sh.getRange(rowNumber,1,1,sh.getLastColumn()).getValues()[0];
  const entityIdHeader=manifest.entityIdHeader||'Id', raw=String(row[idx.RawJSON]||'');
  const result={sourceId:source.sourceId,exportKey:source.exportKey,fileId:source.masterBackupFileId,fileName:source.masterBackupFileName,rowSelection:errorRowNumber?'PRESERVED_ERROR':'RECORD_CURSOR',preservedError:preservedError,rowNumber:rowNumber,entityId:String(row[idx[entityIdHeader]]||''),rawJsonLength:raw.length,rawJsonMissing:!raw,rawJsonTruncated:raw.indexOf(QBO_STATE_CAPTURE_RAW_TRUNCATION_MARKER_)>=0,rawJsonValidJson:false,truncationMarker:QBO_STATE_CAPTURE_RAW_TRUNCATION_MARKER_};
  if (raw && !result.rawJsonTruncated) { try { JSON.parse(raw); result.rawJsonValidJson=true; } catch(e) {} }
  console.log('[HISTORICAL PAYLOAD BACKFILL] | BLOCKED ROW INSPECT | '+JSON.stringify(result));
  return result;
}

function runNextQboHistoricalChangePayloadWork() {
  const workerId=Utilities.getUuid(), continuationId=Utilities.getUuid(), started=Date.now();
  let state=qboHistoricalPayloadClaimWorker_(workerId, continuationId);
  if (!state) return;
  try {
    while (true) {
      const elapsed=Date.now()-started;
      const remaining=QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.WORKER_RUNTIME_BUDGET_MS-elapsed;
      if (remaining < QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.MIN_SAFE_NEW_WORK_MS) break;
      state=qboHistoricalPayloadLoadState_();
      qboHistoricalPayloadAssertOwner_(state, workerId);
      if (state.sourceIndex >= state.sourceIds.length) { qboHistoricalPayloadFinalize_(workerId); return; }
      const source=qboHistoricalPayloadResolveSource_(state.sourceIds[state.sourceIndex]);
      if (!qboHistoricalPayloadSourceSupported_(source)) {
        qboHistoricalPayloadSkipUnsupportedSource_(workerId, source);
        console.log('[HISTORICAL PAYLOAD BACKFILL] | SOURCE SKIPPED | exportKey='+source.exportKey+' | sourceId='+source.sourceId+' | reason=OUTSIDE_CANONICAL_ENTITY_SCOPE');
        continue;
      }
      const result=qboHistoricalPayloadProcessBatch_(state, source, workerId, continuationId);
      qboHistoricalPayloadCheckpoint_(workerId, result);
      if (result.finishedSource) console.log('[HISTORICAL PAYLOAD BACKFILL] | SOURCE COMPLETE | sourceId='+source.sourceId+' | sourceIndex='+(state.sourceIndex+1)+'/'+state.sourceIds.length);
    }
  } catch (err) {
    qboHistoricalPayloadRecordError_(workerId, err);
    throw err;
  } finally {
    qboHistoricalPayloadReleaseWorker_(workerId);
    const latest=qboHistoricalPayloadLoadState_();
    if (latest && latest.status==='RUNNING') qboHistoricalPayloadEnsureContinuation_();
  }
}

function watchdogQboHistoricalChangePayloadBackfill() {
  const state=qboHistoricalPayloadLoadState_();
  if (!state || state.status!=='RUNNING') return;
  const now=Date.now();
  const heartbeatMs=new Date(state.lastHeartbeatAt||0).getTime()||0;
  const progressMs=new Date(state.lastProgressAt||0).getTime()||0;
  const durableActivityMs=Math.max(heartbeatMs, progressMs);
  const stale=(now-durableActivityMs) > QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.STALE_PROGRESS_MS;
  if (!stale) {
    console.log('[HISTORICAL PAYLOAD BACKFILL] | WATCHDOG | durable progress recent; no action.');
  } else {
    qboHistoricalPayloadWithLock_(function(){
      const current=qboHistoricalPayloadLoadState_();
      if (!current || current.status!=='RUNNING') return;
      const h=new Date(current.lastHeartbeatAt||0).getTime()||0, p=new Date(current.lastProgressAt||0).getTime()||0;
      if ((Date.now()-Math.max(h,p)) <= QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.STALE_PROGRESS_MS) return;
      current.workerLeaseOwner=''; current.workerLeaseExpiresAt=''; current.workerLeaseExpiresAtMs=0; current.activeWorkUnitId='';
      qboHistoricalPayloadSaveState_(current);
      qboHistoricalPayloadDeleteTriggerLocked_(QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.TRIGGER_HANDLERS.NEXT);
      qboHistoricalPayloadScheduleTriggerLocked_(QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.TRIGGER_HANDLERS.NEXT, 1000);
      console.log('[HISTORICAL PAYLOAD BACKFILL] | WATCHDOG | stale durable progress; continuation restored.');
    });
  }
  qboHistoricalPayloadWithLock_(function(){
    qboHistoricalPayloadDeleteTriggerLocked_(QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.TRIGGER_HANDLERS.WATCHDOG);
    const current=qboHistoricalPayloadLoadState_();
    if (current && current.status==='RUNNING') qboHistoricalPayloadScheduleTriggerLocked_(QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.TRIGGER_HANDLERS.WATCHDOG, QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.WATCHDOG_DELAY_MS);
  });
}

function qboHistoricalPayloadProcessBatch_(state, source, workerId, continuationId) {
  const manifest=getQboExportManifestEntry_(source.exportKey);
  if (!manifest) throw new Error('HISTORICAL_PAYLOAD_UNKNOWN_EXPORT '+source.exportKey);
  const sourceSs=SpreadsheetApp.openById(source.masterBackupFileId);
  const sheetName=manifest.sheetNames[0], sh=sourceSs.getSheetByName(sheetName);
  if (!sh) throw new Error('HISTORICAL_PAYLOAD_MISSING_PARENT_SHEET '+sheetName);
  const lastRow=sh.getLastRow(), lastCol=sh.getLastColumn();
  if (lastRow<1 || lastCol<1) throw new Error('HISTORICAL_PAYLOAD_EMPTY_PARENT_SHEET '+sheetName);
  const headers=sh.getRange(1,1,1,lastCol).getValues()[0].map(function(v){return String(v||'').trim();});
  const idx=qboObservationHeaderIndex_(headers), entityIdHeader=QBO_STATE_CAPTURE_ENTITY_ID_HEADERS_[source.exportKey]||'Id';
  if (idx.RawJSON===undefined || idx[entityIdHeader]===undefined) throw new Error('HISTORICAL_PAYLOAD_REQUIRED_COLUMNS_MISSING source='+source.sourceId);
  const dataRows=Math.max(0,lastRow-1), cursor=Number(state.recordCursor||0);
  if (cursor>=dataRows) return {finishedSource:true,nextRecordCursor:0,payloadCount:0,shardCount:0,workUnitId:'EMPTY|'+source.sourceId};
  const take=Math.min(QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.RECORD_BATCH_SIZE, dataRows-cursor);
  const rowStart=cursor+2, values=sh.getRange(rowStart,1,take,lastCol).getValues();
  const workUnitId='HISTWU|'+qboStateCaptureAuditSha256_(state.runId+'|'+source.sourceId+'|'+cursor+'|'+(cursor+take));
  qboHistoricalPayloadHeartbeat_(workerId, workUnitId);
  const sourceEvidenceHash=qboStateCaptureAuditSha256_(source.sourceId+'|'+source.masterBackupFileId+'|'+source.masterBackupFileName+'|'+source.observationCompletedAt+'|'+source.exportKey);
  const payloads=[];
  let evidenceExceptionCount=0;
  values.forEach(function(row, i){
    const sourceRowNumber=rowStart+i;
    const entityId=String(row[idx[entityIdHeader]]||'').trim(), raw=String(row[idx.RawJSON]||'');
    if (!entityId) throw new Error('HISTORICAL_PAYLOAD_MISSING_ENTITY_ID source='+source.sourceId+' row='+sourceRowNumber);
    const sourceType=source.sourceAcquisitionType===QBO_STATE_CAPTURE.LEGACY_SOURCE_ACQUISITION_TYPE?'FULL_EXPORT_LEGACY':'FULL_EXPORT';
    const observedAt=qboHistoricalPayloadIso_(source.observationCompletedAt);
    const sourceEvidenceBase={evidenceFileId:source.masterBackupFileId,evidenceFileName:source.masterBackupFileName,evidenceHash:sourceEvidenceHash,evidenceHashType:'SOURCE_LINEAGE_SHA256',evidenceReference:'GOOGLE_SHEETS_FILE_ID:'+source.masterBackupFileId,sourceOperation:'OBSERVE',sourceChangeTime:'',sourceReceivedAt:observedAt};
    let exceptionReason='';
    let entity=null;
    if (!raw) exceptionReason='SOURCE_RAWJSON_MISSING';
    else if (raw.indexOf(QBO_STATE_CAPTURE_RAW_TRUNCATION_MARKER_)>=0) exceptionReason='SOURCE_RAWJSON_TRUNCATED';
    else { try { entity=JSON.parse(raw); } catch(e) { exceptionReason='SOURCE_RAWJSON_INVALID'; } }
    if (exceptionReason) {
      const exceptionPayload=qboBuildChangePayload_({
        payloadKind:QBO_CHANGE_PAYLOAD_CONTRACT_.PAYLOAD_KINDS.EVIDENCE_EXCEPTION,
        sourceType:sourceType, sourceObservationId:source.sourceId+'|ROW|'+sourceRowNumber, entityType:manifest.entityName, entityId:entityId,
        observedAt:observedAt, sourceChangeTime:'', operation:'UPSERT', exportRunId:source.sourceRunId, sourceId:source.sourceId, sourceIndex:state.sourceIndex, sourceRowNumber:sourceRowNumber, workUnitId:workUnitId, continuationId:continuationId,
        sourceEvidence:sourceEvidenceBase,
        rawEntityEvidence:{acquisitionType:'FULL_EXPORT_RAWJSON',acquiredAt:observedAt,rawJson:raw,rawEntityHash:qboCanonicalRawPayloadHash_(raw),complete:false,completenessReason:exceptionReason,fetchedFromQbo:false},
        sourceReportedChange:false,historicalReconstruction:true,reconstructionStatus:'EVIDENCE_EXCEPTION_'+exceptionReason.replace(/^SOURCE_/, '')
      });
      payloads.push(exceptionPayload); evidenceExceptionCount+=1;
      console.log('[HISTORICAL PAYLOAD BACKFILL] | EVIDENCE EXCEPTION | sourceId='+source.sourceId+' | row='+sourceRowNumber+' | entityId='+entityId+' | reason='+exceptionReason);
      return;
    }
    sourceEvidenceBase.sourceChangeTime=(entity.MetaData&&entity.MetaData.LastUpdatedTime)||'';
    const payload=qboNormalizeAndBuildChangePayload_({
      sourceType:sourceType,
      sourceObservationId:source.sourceId+'|ROW|'+sourceRowNumber, exportKey:source.exportKey, entityType:manifest.entityName, rawEntity:entity,
      observedAt:observedAt, sourceChangeTime:(entity.MetaData&&entity.MetaData.LastUpdatedTime)||'', operation:'UPSERT',
      exportRunId:source.sourceRunId, sourceId:source.sourceId, sourceIndex:state.sourceIndex, sourceRowNumber:sourceRowNumber, workUnitId:workUnitId, continuationId:continuationId,
      sourceEvidence:sourceEvidenceBase,
      rawEntityEvidence:{acquisitionType:'FULL_EXPORT_RAWJSON',acquiredAt:observedAt,complete:true,completenessReason:'SOURCE_RAWJSON_PARSE_AND_GOVERNED_NORMALIZATION_SUCCEEDED',fetchedFromQbo:false},
      sourceReportedChange:false,historicalReconstruction:true,reconstructionStatus:'COMPLETE'
    });
    payloads.push(payload);
  });
  const persisted=qboPersistChangePayloadShard_(payloads,{ingestionRunId:state.runId,workUnitId:workUnitId,sourceId:source.sourceId,sourceType:source.sourceAcquisitionType,sourceIndex:state.sourceIndex,recordCursorStart:cursor,recordCursorEndExclusive:cursor+take});
  const next=cursor+take, finished=next>=dataRows;
  return {finishedSource:finished,nextRecordCursor:finished?0:next,payloadCount:payloads.length,shardCount:1,evidenceExceptionCount:evidenceExceptionCount,workUnitId:workUnitId,persisted:persisted};
}

function qboHistoricalPayloadCheckpoint_(workerId, result) {
  qboHistoricalPayloadWithLock_(function(){
    const s=qboHistoricalPayloadLoadState_(); qboHistoricalPayloadAssertOwner_(s,workerId);
    if (result.finishedSource) { s.sourceIndex+=1; s.recordCursor=0; s.sourceCompleteCount=Number(s.sourceCompleteCount||0)+1; }
    else s.recordCursor=result.nextRecordCursor;
    s.workUnitIndex=Number(s.workUnitIndex||0)+1; s.lastCompletedWorkUnit=result.workUnitId; s.activeWorkUnitId='';
    s.payloadCount=Number(s.payloadCount||0)+Number(result.payloadCount||0); s.shardCount=Number(s.shardCount||0)+Number(result.shardCount||0); s.evidenceExceptionCount=Number(s.evidenceExceptionCount||0)+Number(result.evidenceExceptionCount||0); s.error='';
    const now=new Date(); s.lastHeartbeatAt=now.toISOString(); s.lastProgressAt=now.toISOString(); s.workerLeaseExpiresAtMs=Date.now()+QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.WORKER_LEASE_MS; s.workerLeaseExpiresAt=new Date(s.workerLeaseExpiresAtMs).toISOString();
    qboHistoricalPayloadSaveState_(s);
  });
}
function qboHistoricalPayloadClaimWorker_(workerId, continuationId){return qboHistoricalPayloadWithLock_(function(){qboHistoricalPayloadDeleteTriggerLocked_(QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.TRIGGER_HANDLERS.NEXT);const s=qboHistoricalPayloadLoadState_();if(!s||s.status!=='RUNNING')return null;const now=Date.now();if(s.workerLeaseOwner&&Number(s.workerLeaseExpiresAtMs||0)>now&&s.workerLeaseOwner!==workerId)return null;s.workerLeaseOwner=workerId;s.workerLeaseExpiresAtMs=now+QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.WORKER_LEASE_MS;s.workerLeaseExpiresAt=new Date(s.workerLeaseExpiresAtMs).toISOString();s.lastHeartbeatAt=new Date(now).toISOString();s.continuationId=continuationId;qboHistoricalPayloadSaveState_(s);return s;});}
function qboHistoricalPayloadHeartbeat_(workerId, workUnitId){qboHistoricalPayloadWithLock_(function(){const s=qboHistoricalPayloadLoadState_();qboHistoricalPayloadAssertOwner_(s,workerId);const now=Date.now();s.lastHeartbeatAt=new Date(now).toISOString();s.activeWorkUnitId=workUnitId;s.workerLeaseExpiresAtMs=now+QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.WORKER_LEASE_MS;s.workerLeaseExpiresAt=new Date(s.workerLeaseExpiresAtMs).toISOString();qboHistoricalPayloadSaveState_(s);});}
function qboHistoricalPayloadFinalize_(workerId){qboHistoricalPayloadWithLock_(function(){const s=qboHistoricalPayloadLoadState_();qboHistoricalPayloadAssertOwner_(s,workerId);s.status='SUCCESS';s.completedAt=new Date().toISOString();s.workerLeaseOwner='';s.workerLeaseExpiresAt='';s.workerLeaseExpiresAtMs=0;s.activeWorkUnitId='';qboHistoricalPayloadSaveState_(s);qboHistoricalPayloadDeleteTriggerLocked_(QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.TRIGGER_HANDLERS.NEXT);qboHistoricalPayloadDeleteTriggerLocked_(QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.TRIGGER_HANDLERS.WATCHDOG);console.log('[HISTORICAL PAYLOAD BACKFILL] | COMPLETE | runId='+s.runId+' | payloads='+s.payloadCount+' | shards='+s.shardCount+' | sources='+s.sourceCompleteCount);});}
function qboHistoricalPayloadRecordError_(workerId,err){qboHistoricalPayloadWithLock_(function(){const s=qboHistoricalPayloadLoadState_();if(!s||s.workerLeaseOwner!==workerId)return;s.status='BLOCKED';s.error=err&&err.message?err.message:String(err);s.lastHeartbeatAt=new Date().toISOString();s.activeWorkUnitId='';qboHistoricalPayloadSaveState_(s);qboHistoricalPayloadDeleteTriggerLocked_(QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.TRIGGER_HANDLERS.NEXT);console.log('[HISTORICAL PAYLOAD BACKFILL] | BLOCKED | '+s.error);});}
function qboHistoricalPayloadReleaseWorker_(workerId){qboHistoricalPayloadWithLock_(function(){const s=qboHistoricalPayloadLoadState_();if(!s||s.workerLeaseOwner!==workerId)return;s.workerLeaseOwner='';s.workerLeaseExpiresAt='';s.workerLeaseExpiresAtMs=0;qboHistoricalPayloadSaveState_(s);});}
function qboHistoricalPayloadAssertOwner_(s,workerId){if(!s||s.status!=='RUNNING')throw new Error('HISTORICAL_PAYLOAD_WORKER_NOT_RUNNING');if(s.workerLeaseOwner!==workerId)throw new Error('HISTORICAL_PAYLOAD_WORKER_LEASE_MISMATCH');}
function qboHistoricalPayloadResolveSource_(sourceId){const ss=getQboStateCaptureSpreadsheet_(),sh=ss.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES),sources=loadQboStateCaptureWriteSources_(sh,'');for(let i=0;i<sources.length;i++)if(sources[i].sourceId===sourceId)return sources[i];throw new Error('HISTORICAL_PAYLOAD_SOURCE_NOT_FOUND '+sourceId);}
function qboHistoricalPayloadSourceAvailable_(s){return (s.sourceAcquisitionType===QBO_STATE_CAPTURE.SOURCE_ACQUISITION_TYPE||s.sourceAcquisitionType===QBO_STATE_CAPTURE.LEGACY_SOURCE_ACQUISITION_TYPE)&&s.sourceStatus===QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE&&!!s.masterBackupFileId;}
function qboHistoricalPayloadSourceSupported_(s){return QBO_STATE_CAPTURE.CANONICAL_MIGRATION_SCOPE.indexOf(String(s.exportKey||'').trim())>=0;}
function qboHistoricalPayloadSourceEligible_(s){return qboHistoricalPayloadSourceAvailable_(s)&&qboHistoricalPayloadSourceSupported_(s);}
function qboHistoricalPayloadSkipUnsupportedSource_(workerId,source){qboHistoricalPayloadWithLock_(function(){const s=qboHistoricalPayloadLoadState_();qboHistoricalPayloadAssertOwner_(s,workerId);s.sourceIndex+=1;s.recordCursor=0;s.workUnitIndex=Number(s.workUnitIndex||0)+1;s.skippedSourceCount=Number(s.skippedSourceCount||0)+1;s.lastCompletedWorkUnit='SKIP|'+source.sourceId;s.activeWorkUnitId='';const now=new Date();s.lastHeartbeatAt=now.toISOString();s.lastProgressAt=now.toISOString();s.workerLeaseExpiresAtMs=Date.now()+QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.WORKER_LEASE_MS;s.workerLeaseExpiresAt=new Date(s.workerLeaseExpiresAtMs).toISOString();s.error='';qboHistoricalPayloadSaveState_(s);});}
function qboHistoricalPayloadEnsureContinuation_(){qboHistoricalPayloadWithLock_(function(){const s=qboHistoricalPayloadLoadState_();if(!s||s.status!=='RUNNING')return;qboHistoricalPayloadDeleteTriggerLocked_(QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.TRIGGER_HANDLERS.NEXT);qboHistoricalPayloadScheduleTriggerLocked_(QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.TRIGGER_HANDLERS.NEXT,QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.CONTINUATION_DELAY_MS);});}
function qboHistoricalPayloadLoadState_(){const raw=PropertiesService.getScriptProperties().getProperty(QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.STATE_PROPERTY);if(!raw)return null;try{return JSON.parse(raw);}catch(e){throw new Error('HISTORICAL_PAYLOAD_STATE_INVALID_JSON');}}
function qboHistoricalPayloadSaveState_(s){PropertiesService.getScriptProperties().setProperty(QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_.STATE_PROPERTY,JSON.stringify(s));}
function qboHistoricalPayloadWithLock_(fn){const lock=LockService.getScriptLock();lock.waitLock(QBO_STATE_CAPTURE.EXECUTION_LOCK_TIMEOUT_MS);try{return fn();}finally{lock.releaseLock();}}
function qboHistoricalPayloadDeleteTriggerLocked_(handler){ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()===handler)ScriptApp.deleteTrigger(t);});}
function qboHistoricalPayloadScheduleTriggerLocked_(handler,delayMs){ScriptApp.newTrigger(handler).timeBased().after(Math.max(1000,delayMs)).create();}
function qboHistoricalPayloadIso_(v){if(!v)return new Date(0).toISOString();if(v instanceof Date)return v.toISOString();const d=new Date(v);if(isNaN(d.getTime()))throw new Error('HISTORICAL_PAYLOAD_INVALID_OBSERVED_AT '+v);return d.toISOString();}
