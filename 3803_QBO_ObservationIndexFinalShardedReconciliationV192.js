/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3803_QBO_ObservationIndexFinalShardedReconciliationV192.js
 * Version     : 1.5.193 (checkpoint-preserving trigger lifecycle repair)
 *
 * Timeout repair for v1.5.191.
 *
 * v1.5.191 repeatedly enumerated all 2,418 physical triplets before each
 * bounded work unit. v1.5.192 starts a new reconciliation run from zero and
 * persists a Drive manifest FileIterator continuation token so each invocation
 * resumes enumeration instead of rebuilding the complete inventory.
 *
 * Evidence is read-only. Mutations are limited to this audit's Script
 * Properties checkpoint and its continuation triggers. The v1.5.191 audit
 * state is preserved.
 */
const QBO_OBS_INDEX_FINAL_RECON_V192_=Object.freeze({
  VERSION:'1.5.192',
  STATE_KEY:'QBO_OBS_INDEX_FINAL_RECON_V192_STATE',
  CONTINUATION_HANDLER:'qboObservationIndexFinalReconciliationV192Continuation_',
  MAX_TRIPLETS_PER_INVOCATION:6,
  RUNTIME_BUDGET_MS:120000,
  CONTINUATION_DELAY_MS:60000,
  EXPECTED_TRIPLETS:2418,
  EXPECTED_OBSERVATIONS:734858,
  EXPECTED_ADMITTED:734786,
  EXPECTED_EVIDENCE_EXCEPTION:52,
  EXPECTED_BLOCKED:20
});

function startQboObservationIndexFinalReconciliationV192(){
  const prior=qboObsIndexV192LoadState_();
  if(prior&&prior.status==='RUNNING')
    throw new Error('OBS_INDEX_V192_ALREADY_RUNNING');

  // Stop any surviving v191 continuation without altering v191 audit state.
  qboObsIndexV192DeleteHandlerTriggers_('qboObservationIndexFinalReconciliationV191Continuation_');
  qboObsIndexV192DeleteHandlerTriggers_(QBO_OBS_INDEX_FINAL_RECON_V192_.CONTINUATION_HANDLER);

  const h=qboObservationIndexV170LoadState_();
  if(!h||String(h.status)!=='COMPLETE_SHARDED_PENDING_RECONCILIATION')
    throw new Error('OBS_INDEX_V192_HISTORICAL_BOUNDARY_NOT_READY');
  if(Number(h.indexedObservationCount)!==734858||
     Number(h.governedExcludedObservationCount||0)!==55)
    throw new Error('OBS_INDEX_V192_HISTORICAL_COUNT_BOUNDARY_CHANGED');

  const folders=qboObsIndexV175ResolveFolders_();
  const it=folders.manifests.getFiles();

  const state={
    version:'1.5.192',
    status:'RUNNING',
    runId:'OBS_INDEX_FINAL_RECON_V192|'+Utilities.getUuid(),
    tripletCursor:0,
    tripletCount:QBO_OBS_INDEX_FINAL_RECON_V192_.EXPECTED_TRIPLETS,
    manifestIteratorToken:it.getContinuationToken(),
    observationCount:0,
    admittedCount:0,
    evidenceExceptionCount:0,
    blockedCount:0,
    duplicateObservationIdCount:0,
    hashFailureCount:0,
    referenceFailureCount:0,
    countFailureCount:0,
    chronologyFailureCount:0,
    lineageFailureCount:0,
    startedAt:new Date().toISOString(),
    lastProgressAt:'',
    completedAt:'',
    error:'',
    continuationTriggerId:''
  };
  qboObsIndexV192SaveState_(state);
  console.log('[OBSERVATION INDEX V192] | STARTED | '+JSON.stringify(qboObsIndexV192PublicState_(state)));
  qboObservationIndexFinalReconciliationV192Worker_();
}

function qboObservationIndexFinalReconciliationV192Continuation_(){
  // Delete consumed/stale v192 one-time triggers before work. The currently
  // executing trigger may be deleted safely; this execution continues.
  qboObsIndexV192DeleteHandlerTriggers_(
    QBO_OBS_INDEX_FINAL_RECON_V192_.CONTINUATION_HANDLER
  );
  qboObservationIndexFinalReconciliationV192Worker_();
}

function qboObservationIndexFinalReconciliationV192Worker_(){
  const state=qboObsIndexV192LoadState_();
  if(!state||state.status!=='RUNNING')
    throw new Error('OBS_INDEX_V192_NOT_RUNNING');

  const started=Date.now();
  try{
    const folders=qboObsIndexV175ResolveFolders_();
    const it=DriveApp.continueFileIterator(String(state.manifestIteratorToken||''));
    let processed=0, invocationObs=0;

    while(it.hasNext() &&
          processed<QBO_OBS_INDEX_FINAL_RECON_V192_.MAX_TRIPLETS_PER_INVOCATION &&
          Date.now()-started<QBO_OBS_INDEX_FINAL_RECON_V192_.RUNTIME_BUDGET_MS){

      const manifestFile=it.next();
      const manifestName=String(manifestFile.getName()||'');
      if(!/\.manifest\.json$/.test(manifestName))
        throw new Error('OBS_INDEX_V192_UNKNOWN_MANIFEST '+manifestName);

      const base=manifestName.replace(/\.manifest\.json$/,'');
      const shardFile=qboObsIndexV192RequireSingleByName_(folders.shards,base+'.json');
      const lookupFile=qboObsIndexV192RequireSingleByName_(folders.lookup,base+'.lookup.json');
      const r=qboObsIndexV192VerifyTriplet_(shardFile,lookupFile,manifestFile);

      if(r.hashFailureCount||r.referenceFailureCount||r.countFailureCount||
         r.chronologyFailureCount||r.lineageFailureCount||
         r.duplicateObservationIdCount)
        throw new Error('OBS_INDEX_V192_TRIPLET_FAILED name='+base+' result='+JSON.stringify(r));

      state.observationCount+=r.observationCount;
      state.admittedCount+=r.admittedCount;
      state.evidenceExceptionCount+=r.evidenceExceptionCount;
      state.blockedCount+=r.blockedCount;
      state.duplicateObservationIdCount+=r.duplicateObservationIdCount;
      state.hashFailureCount+=r.hashFailureCount;
      state.referenceFailureCount+=r.referenceFailureCount;
      state.countFailureCount+=r.countFailureCount;
      state.chronologyFailureCount+=r.chronologyFailureCount;
      state.lineageFailureCount+=r.lineageFailureCount;
      state.tripletCursor++;
      processed++;
      invocationObs+=r.observationCount;

      // Durable resume position advances only after the complete triplet passes.
      state.manifestIteratorToken=it.getContinuationToken();
      state.lastProgressAt=new Date().toISOString();
      qboObsIndexV192SaveState_(state);
    }

    if(!it.hasNext()){
      qboObsIndexV192Complete_(state);
      return;
    }

    state.manifestIteratorToken=it.getContinuationToken();
    qboObsIndexV192ScheduleNext_(state);

    console.log('[OBSERVATION INDEX V192] | PROGRESS | '+JSON.stringify(
      Object.assign(qboObsIndexV192PublicState_(state),{
        invocationTriplets:processed,
        invocationObservations:invocationObs
      })
    ));
  }catch(e){
    state.status='FAILED';
    state.error=String(e&&e.message?e.message:e);
    state.lastProgressAt=new Date().toISOString();
    qboObsIndexV192SaveState_(state);
    console.log('[OBSERVATION INDEX V192] | FAILED | '+JSON.stringify(qboObsIndexV192PublicState_(state)));
    throw e;
  }
}

function qboObsIndexV192RequireSingleByName_(folder,name){
  let last=null;
  for(let attempt=1;attempt<=4;attempt++){
    try{
      const it=folder.getFilesByName(name);
      if(!it.hasNext())throw new Error('OBS_INDEX_V192_FILE_MISSING '+name);
      const f=it.next();
      if(it.hasNext())throw new Error('OBS_INDEX_V192_DUPLICATE_FILENAME '+name);
      return f;
    }catch(e){
      last=e;
      const msg=String(e&&e.message?e.message:e);
      if(!/Service error:\s*Drive/i.test(msg)||attempt===4)throw e;
      Utilities.sleep(1000*Math.pow(2,attempt-1));
    }
  }
  throw last;
}

function qboObsIndexV192ReadJson_(fileId){
  let last=null;
  for(let attempt=1;attempt<=4;attempt++){
    try{
      return JSON.parse(
        DriveApp.getFileById(String(fileId)).getBlob().getDataAsString('UTF-8')
      );
    }catch(e){
      last=e;
      const msg=String(e&&e.message?e.message:e);
      const transient=/Service error:\s*Drive/i.test(msg) ||
        e instanceof SyntaxError ||
        /Unexpected (?:token|end)|JSON/i.test(msg);
      if(!transient||attempt===4)throw e;
      Utilities.sleep(1000*Math.pow(2,attempt-1));
    }
  }
  throw last;
}

function qboObsIndexV192VerifyTriplet_(shardFile,lookupFile,manifestFile){
  const shard=qboObsIndexV192ReadJson_(shardFile.getId());
  const lookup=qboObsIndexV192ReadJson_(lookupFile.getId());
  const manifest=qboObsIndexV192ReadJson_(manifestFile.getId());

  const r={
    observationCount:0,
    admittedCount:0,
    evidenceExceptionCount:0,
    blockedCount:0,
    duplicateObservationIdCount:0,
    hashFailureCount:0,
    referenceFailureCount:0,
    countFailureCount:0,
    chronologyFailureCount:0,
    lineageFailureCount:0
  };

  if(!shard||!shard.stableBody||!lookup||!lookup.stableBody||
     !manifest||!manifest.stableBody){
    r.countFailureCount++;
    return r;
  }

  const shardHash=qboStateCaptureAuditSha256_(
    qboCanonicalStableStringify_(shard.stableBody));
  const lookupHash=qboStateCaptureAuditSha256_(
    qboCanonicalStableStringify_(lookup.stableBody));
  const manifestHash=qboStateCaptureAuditSha256_(
    qboCanonicalStableStringify_(manifest.stableBody));

  if(String(shard.shardHash||'')!==shardHash)r.hashFailureCount++;
  if(String(lookup.lookupHash||'')!==lookupHash)r.hashFailureCount++;
  if(String(manifest.manifestHash||'')!==manifestHash)r.hashFailureCount++;

  if(String(lookup.stableBody.shardFileId||'')!==shardFile.getId()||
     String(manifest.stableBody.shardFileId||'')!==shardFile.getId()||
     String(manifest.stableBody.lookupFileId||'')!==lookupFile.getId())
    r.referenceFailureCount++;

  if(String(lookup.stableBody.shardHash||'')!==shardHash||
     String(manifest.stableBody.shardHash||'')!==shardHash||
     String(manifest.stableBody.lookupHash||'')!==lookupHash)
    r.referenceFailureCount++;

  const records=Array.isArray(shard.stableBody.records)?
    shard.stableBody.records:[];
  const ids=Array.isArray(shard.stableBody.observationIds)?
    shard.stableBody.observationIds:[];

  r.observationCount=records.length;

  if(Number(shard.stableBody.observationCount||0)!==records.length||
     Number(manifest.stableBody.observationCount||0)!==records.length||
     ids.length!==records.length)
    r.countFailureCount++;

  const localIds={};
  records.forEach(function(rec,i){
    const id=String(rec&&rec.ObservationId||'');
    if(!id||id!==String(ids[i]||''))r.countFailureCount++;
    if(localIds[id])r.duplicateObservationIdCount++;
    else localIds[id]=true;

    const admission=String(rec&&rec.AdmissionStatus||'');
    if(admission===QBO_OBSERVATION_INDEX_CONTRACT_.ADMISSION_STATUS.ADMITTED)
      r.admittedCount++;
    else if(admission===QBO_OBSERVATION_INDEX_CONTRACT_.ADMISSION_STATUS.EVIDENCE_EXCEPTION)
      r.evidenceExceptionCount++;
    else if(admission===QBO_OBSERVATION_INDEX_CONTRACT_.ADMISSION_STATUS.BLOCKED)
      r.blockedCount++;
    else
      r.countFailureCount++;

    if(!String(rec&&rec.EntityType||'')||
       !String(rec&&rec.EntityId||'')||
       !String(rec&&rec.ObservedAt||'')||
       !String(rec&&rec.PayloadFileId||''))
      r.lineageFailureCount++;

    if(isNaN(new Date(String(rec&&rec.ObservedAt||'')).getTime()))
      r.chronologyFailureCount++;
  });

  const sourceKind=String(shard.stableBody.sourceKind||'');
  if(sourceKind==='HISTORICAL_06_PAYLOAD_ARTIFACT'){
    if(!String(shard.stableBody.sourcePayloadFileId||'')||
       !String(shard.stableBody.sourcePayloadShardHash||'')||
       !String(shard.stableBody.ingestionSourceId||''))
      r.lineageFailureCount++;
  }else if(sourceKind!=='LEGACY_07_SHEET_VALIDATED_CHECKPOINT'){
    r.lineageFailureCount++;
  }

  return r;
}

function qboObsIndexV192Complete_(state){
  if(Number(state.tripletCursor)!==
     QBO_OBS_INDEX_FINAL_RECON_V192_.EXPECTED_TRIPLETS)
    throw new Error('OBS_INDEX_V192_FINAL_TRIPLET_COUNT '+state.tripletCursor);

  if(Number(state.observationCount)!==
     QBO_OBS_INDEX_FINAL_RECON_V192_.EXPECTED_OBSERVATIONS)
    throw new Error('OBS_INDEX_V192_FINAL_OBSERVATION_COUNT '+state.observationCount);

  if(Number(state.admittedCount)!==
     QBO_OBS_INDEX_FINAL_RECON_V192_.EXPECTED_ADMITTED)
    throw new Error('OBS_INDEX_V192_FINAL_ADMITTED_COUNT '+state.admittedCount);

  if(Number(state.evidenceExceptionCount)!==
     QBO_OBS_INDEX_FINAL_RECON_V192_.EXPECTED_EVIDENCE_EXCEPTION)
    throw new Error('OBS_INDEX_V192_FINAL_EVIDENCE_EXCEPTION_COUNT '+
      state.evidenceExceptionCount);

  if(Number(state.blockedCount)!==
     QBO_OBS_INDEX_FINAL_RECON_V192_.EXPECTED_BLOCKED)
    throw new Error('OBS_INDEX_V192_FINAL_BLOCKED_COUNT '+state.blockedCount);

  const failures=
    Number(state.duplicateObservationIdCount)+
    Number(state.hashFailureCount)+
    Number(state.referenceFailureCount)+
    Number(state.countFailureCount)+
    Number(state.chronologyFailureCount)+
    Number(state.lineageFailureCount);

  if(failures)
    throw new Error('OBS_INDEX_V192_FINAL_FAILURE_COUNT '+failures);

  state.status='COMPLETE_PENDING_GLOBAL_ID_RECONCILIATION';
  state.completedAt=new Date().toISOString();
  state.error='';
  state.continuationTriggerId='';
  state.manifestIteratorToken='';
  qboObsIndexV192SaveState_(state);

  console.log('[OBSERVATION INDEX V192] | RECONCILIATION_COMPLETE | '+
    JSON.stringify(qboObsIndexV192PublicState_(state)));
}

function qboObsIndexV192ScheduleNext_(state){
  const trigger=ScriptApp
    .newTrigger(QBO_OBS_INDEX_FINAL_RECON_V192_.CONTINUATION_HANDLER)
    .timeBased()
    .after(QBO_OBS_INDEX_FINAL_RECON_V192_.CONTINUATION_DELAY_MS)
    .create();

  state.continuationTriggerId=String(trigger.getUniqueId()||'');
  qboObsIndexV192SaveState_(state);
}

function qboObsIndexV192DeleteHandlerTriggers_(handler){
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction()===handler)ScriptApp.deleteTrigger(t);
  });
}

function qboObsIndexV192LoadState_(){
  const raw=PropertiesService.getScriptProperties()
    .getProperty(QBO_OBS_INDEX_FINAL_RECON_V192_.STATE_KEY);
  return raw?JSON.parse(raw):null;
}

function qboObsIndexV192SaveState_(state){
  PropertiesService.getScriptProperties()
    .setProperty(
      QBO_OBS_INDEX_FINAL_RECON_V192_.STATE_KEY,
      JSON.stringify(state)
    );
}

function qboObsIndexV192PublicState_(state){
  const out=Object.assign({},state);
  delete out.manifestIteratorToken;
  return out;
}

/**
 * Exact recovery for the 2026-09-28 v192 trigger-quota failure.
 * Resumes the durable iterator checkpoint; it does not reset the run.
 */
function recoverQboObservationIndexFinalReconciliationTriggerQuotaV193(){
  const state=qboObsIndexV192LoadState_();
  const expectedRun='OBS_INDEX_FINAL_RECON_V192|6a9e8043-c161-485d-935b-9b1ca0796d2f';

  if(!state)throw new Error('OBS_INDEX_V193_RECOVERY_STATE_MISSING');
  if(String(state.runId)!==expectedRun)
    throw new Error('OBS_INDEX_V193_RECOVERY_RUN_MISMATCH '+String(state.runId));
  if(String(state.status)!=='FAILED')
    throw new Error('OBS_INDEX_V193_RECOVERY_STATUS_NOT_FAILED '+String(state.status));
  if(Number(state.tripletCursor)!==120 ||
     Number(state.observationCount)!==28359 ||
     Number(state.admittedCount)!==28359)
    throw new Error('OBS_INDEX_V193_RECOVERY_CHECKPOINT_CHANGED');
  if(!/too many triggers/i.test(String(state.error||'')))
    throw new Error('OBS_INDEX_V193_RECOVERY_ERROR_MISMATCH '+String(state.error||''));
  if(!String(state.manifestIteratorToken||''))
    throw new Error('OBS_INDEX_V193_RECOVERY_ITERATOR_TOKEN_MISSING');

  qboObsIndexV192DeleteHandlerTriggers_(
    QBO_OBS_INDEX_FINAL_RECON_V192_.CONTINUATION_HANDLER
  );
  qboObsIndexV192DeleteHandlerTriggers_(
    'qboObservationIndexFinalReconciliationV191Continuation_'
  );

  state.status='RUNNING';
  state.error='';
  state.continuationTriggerId='';
  state.lastProgressAt=new Date().toISOString();
  qboObsIndexV192SaveState_(state);

  console.log('[OBSERVATION INDEX V193] | TRIGGER_QUOTA_RECOVERY | '+
    JSON.stringify(qboObsIndexV192PublicState_(state)));

  qboObservationIndexFinalReconciliationV192Worker_();
}

function statusQboObservationIndexFinalReconciliationV192(){
  const state=qboObsIndexV192LoadState_();
  console.log('[OBSERVATION INDEX V192] | STATUS | '+
    JSON.stringify(qboObsIndexV192PublicState_(state||{})));
  return state;
}
