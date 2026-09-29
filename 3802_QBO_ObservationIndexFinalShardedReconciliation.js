/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3802_QBO_ObservationIndexFinalShardedReconciliation.js
 * Version     : 1.5.191
 * Purpose     : Bounded/resumable final reconciliation of immutable physical 07.
 *
 * Evidence is read-only. The only mutations are this audit's Script Properties
 * checkpoint and its own time-driven continuation trigger.
 */
const QBO_OBS_INDEX_FINAL_RECON_V191_=Object.freeze({
  VERSION:'1.5.191',
  STATE_KEY:'QBO_OBS_INDEX_FINAL_RECON_V191_STATE',
  CONTINUATION_HANDLER:'qboObservationIndexFinalReconciliationV191Continuation_',
  RUNTIME_BUDGET_MS:180000,
  MAX_TRIPLETS_PER_INVOCATION:12,
  CONTINUATION_DELAY_MS:60000,
  EXPECTED_TRIPLETS:2418,
  EXPECTED_OBSERVATIONS:734858,
  EXPECTED_ADMITTED:734786,
  EXPECTED_EVIDENCE_EXCEPTION:52,
  EXPECTED_BLOCKED:20
});

function startQboObservationIndexFinalReconciliationV191(){
  const prior=qboObsIndexV191LoadState_();
  if(prior&&prior.status==='RUNNING')throw new Error('OBS_INDEX_V191_ALREADY_RUNNING');
  qboObsIndexV191DeleteOwnTriggers_();

  const historical=qboObservationIndexV170LoadState_();
  if(!historical||String(historical.status)!=='COMPLETE_SHARDED_PENDING_RECONCILIATION')
    throw new Error('OBS_INDEX_V191_HISTORICAL_BOUNDARY_NOT_READY');
  if(Number(historical.indexedObservationCount)!==734858||
     Number(historical.governedExcludedObservationCount||0)!==55)
    throw new Error('OBS_INDEX_V191_HISTORICAL_COUNT_BOUNDARY_CHANGED');

  const inventory=qboObsIndexV191BuildInventory_();
  if(inventory.length!==QBO_OBS_INDEX_FINAL_RECON_V191_.EXPECTED_TRIPLETS)
    throw new Error('OBS_INDEX_V191_TRIPLET_INVENTORY_COUNT '+inventory.length);

  const state={
    version:'1.5.191',
    status:'RUNNING',
    runId:'OBS_INDEX_FINAL_RECON_V191|'+Utilities.getUuid(),
    tripletCursor:0,
    tripletCount:inventory.length,
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
  qboObsIndexV191SaveState_(state);
  console.log('[OBSERVATION INDEX V191] | STARTED | '+JSON.stringify(state));
  qboObservationIndexFinalReconciliationV191Worker_();
}

function qboObservationIndexFinalReconciliationV191Continuation_(){
  qboObsIndexV191DeleteOwnTriggers_();
  qboObservationIndexFinalReconciliationV191Worker_();
}

function qboObservationIndexFinalReconciliationV191Worker_(){
  const state=qboObsIndexV191LoadState_();
  if(!state||state.status!=='RUNNING')throw new Error('OBS_INDEX_V191_NOT_RUNNING');
  const started=Date.now();
  try{
    const inventory=qboObsIndexV191BuildInventory_();
    if(inventory.length!==Number(state.tripletCount))
      throw new Error('OBS_INDEX_V191_INVENTORY_CHANGED');

    let processed=0, invocationObs=0;
    while(state.tripletCursor<inventory.length &&
          processed<QBO_OBS_INDEX_FINAL_RECON_V191_.MAX_TRIPLETS_PER_INVOCATION &&
          Date.now()-started<QBO_OBS_INDEX_FINAL_RECON_V191_.RUNTIME_BUDGET_MS){
      const item=inventory[state.tripletCursor];
      const r=qboObsIndexV191VerifyTriplet_(item);

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

      if(r.hashFailureCount||r.referenceFailureCount||r.countFailureCount||
         r.chronologyFailureCount||r.lineageFailureCount||r.duplicateObservationIdCount)
        throw new Error('OBS_INDEX_V191_TRIPLET_FAILED name='+item.baseName+' result='+JSON.stringify(r));

      state.tripletCursor++;
      processed++;
      invocationObs+=r.observationCount;
      state.lastProgressAt=new Date().toISOString();
      qboObsIndexV191SaveState_(state);
    }

    if(state.tripletCursor>=inventory.length){
      qboObsIndexV191Complete_(state);
      return;
    }
    qboObsIndexV191Schedule_(state);
    console.log('[OBSERVATION INDEX V191] | PROGRESS | '+JSON.stringify({
      version:state.version,status:state.status,runId:state.runId,
      tripletCursor:state.tripletCursor,tripletCount:state.tripletCount,
      observationCount:state.observationCount,admittedCount:state.admittedCount,
      evidenceExceptionCount:state.evidenceExceptionCount,blockedCount:state.blockedCount,
      invocationTriplets:processed,invocationObservations:invocationObs,
      lastProgressAt:state.lastProgressAt
    }));
  }catch(e){
    state.status='FAILED';
    state.error=String(e&&e.message?e.message:e);
    state.lastProgressAt=new Date().toISOString();
    qboObsIndexV191SaveState_(state);
    qboObsIndexV191DeleteOwnTriggers_();
    console.log('[OBSERVATION INDEX V191] | FAILED | '+JSON.stringify(state));
    throw e;
  }
}

function qboObsIndexV191VerifyTriplet_(item){
  const shard=qboObsIndexV191ReadJson_(item.shardId);
  const lookup=qboObsIndexV191ReadJson_(item.lookupId);
  const manifest=qboObsIndexV191ReadJson_(item.manifestId);
  const r={observationCount:0,admittedCount:0,evidenceExceptionCount:0,blockedCount:0,
    duplicateObservationIdCount:0,hashFailureCount:0,referenceFailureCount:0,
    countFailureCount:0,chronologyFailureCount:0,lineageFailureCount:0};

  if(!shard||!shard.stableBody||!lookup||!lookup.stableBody||!manifest||!manifest.stableBody){
    r.countFailureCount++; return r;
  }

  const shardHash=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(shard.stableBody));
  const lookupHash=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(lookup.stableBody));
  const manifestHash=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(manifest.stableBody));
  if(String(shard.shardHash||'')!==shardHash)r.hashFailureCount++;
  if(String(lookup.lookupHash||'')!==lookupHash)r.hashFailureCount++;
  if(String(manifest.manifestHash||'')!==manifestHash)r.hashFailureCount++;

  if(String(lookup.stableBody.shardFileId||'')!==item.shardId ||
     String(manifest.stableBody.shardFileId||'')!==item.shardId ||
     String(manifest.stableBody.lookupFileId||'')!==item.lookupId)
    r.referenceFailureCount++;
  if(String(lookup.stableBody.shardHash||'')!==shardHash ||
     String(manifest.stableBody.shardHash||'')!==shardHash ||
     String(manifest.stableBody.lookupHash||'')!==lookupHash)
    r.referenceFailureCount++;

  const records=Array.isArray(shard.stableBody.records)?shard.stableBody.records:[];
  const ids=Array.isArray(shard.stableBody.observationIds)?shard.stableBody.observationIds:[];
  r.observationCount=records.length;
  if(Number(shard.stableBody.observationCount||0)!==records.length ||
     Number(manifest.stableBody.observationCount||0)!==records.length ||
     ids.length!==records.length) r.countFailureCount++;

  const localIds={};
  records.forEach(function(rec,i){
    const id=String(rec&&rec.ObservationId||'');
    if(!id||id!==String(ids[i]||''))r.countFailureCount++;
    if(localIds[id])r.duplicateObservationIdCount++; else localIds[id]=true;

    const admission=String(rec&&rec.AdmissionStatus||'');
    if(admission===QBO_OBSERVATION_INDEX_CONTRACT_.ADMISSION_STATUS.ADMITTED)r.admittedCount++;
    else if(admission===QBO_OBSERVATION_INDEX_CONTRACT_.ADMISSION_STATUS.EVIDENCE_EXCEPTION)r.evidenceExceptionCount++;
    else if(admission===QBO_OBSERVATION_INDEX_CONTRACT_.ADMISSION_STATUS.BLOCKED)r.blockedCount++;
    else r.countFailureCount++;

    if(!String(rec&&rec.EntityType||'')||!String(rec&&rec.EntityId||'')||
       !String(rec&&rec.ObservedAt||'')||!String(rec&&rec.PayloadFileId||''))
      r.lineageFailureCount++;
    const d=new Date(String(rec&&rec.ObservedAt||''));
    if(isNaN(d.getTime()))r.chronologyFailureCount++;
  });

  if(String(shard.stableBody.sourceKind||'')==='HISTORICAL_06_PAYLOAD_ARTIFACT'){
    if(!String(shard.stableBody.sourcePayloadFileId||'')||
       !String(shard.stableBody.sourcePayloadShardHash||'')||
       !String(shard.stableBody.ingestionSourceId||''))r.lineageFailureCount++;
  }else if(String(shard.stableBody.sourceKind||'')!=='LEGACY_07_SHEET_VALIDATED_CHECKPOINT'){
    r.lineageFailureCount++;
  }
  return r;
}

function qboObsIndexV191BuildInventory_(){
  const folders=qboObsIndexV175ResolveFolders_();
  const shards=qboObsIndexV191MapFiles_(folders.shards,'.json',function(n){
    return !/\.manifest\.json$/.test(n)&&!/\.lookup\.json$/.test(n);
  });
  const manifests=qboObsIndexV191MapFiles_(folders.manifests,'.manifest.json',function(){return true;});
  const lookups=qboObsIndexV191MapFiles_(folders.lookup,'.lookup.json',function(){return true;});
  const names=Object.keys(shards).sort();
  const out=[];
  names.forEach(function(shardName){
    const base=shardName.replace(/\.json$/,'');
    const mn=base+'.manifest.json', ln=base+'.lookup.json';
    if(!manifests[mn]||!lookups[ln])
      throw new Error('OBS_INDEX_V191_INCOMPLETE_TRIPLET '+base);
    out.push({baseName:base,shardId:shards[shardName],manifestId:manifests[mn],lookupId:lookups[ln]});
  });
  if(Object.keys(manifests).length!==out.length||Object.keys(lookups).length!==out.length)
    throw new Error('OBS_INDEX_V191_ORPHAN_MANIFEST_OR_LOOKUP');
  return out;
}

function qboObsIndexV191MapFiles_(folder,suffix,predicate){
  const m={},it=folder.getFiles();
  while(it.hasNext()){
    const f=it.next(),n=String(f.getName()||'');
    if(n.slice(-suffix.length)===suffix&&predicate(n)){
      if(m[n])throw new Error('OBS_INDEX_V191_DUPLICATE_FILENAME '+n);
      m[n]=f.getId();
    }
  }
  return m;
}

function qboObsIndexV191ReadJson_(fileId){
  let last=null;
  for(let a=1;a<=4;a++){
    try{return JSON.parse(DriveApp.getFileById(String(fileId)).getBlob().getDataAsString('UTF-8'));}
    catch(e){
      const msg=String(e&&e.message?e.message:e); last=e;
      const transient=/Service error:\s*Drive/i.test(msg) ||
        e instanceof SyntaxError || /Unexpected (?:token|end)|JSON/i.test(msg);
      if(!transient||a===4)throw e;
      Utilities.sleep(1000*Math.pow(2,a-1));
    }
  }
  throw last;
}

function qboObsIndexV191Complete_(state){
  const failures=state.duplicateObservationIdCount+state.hashFailureCount+
    state.referenceFailureCount+state.countFailureCount+
    state.chronologyFailureCount+state.lineageFailureCount;
  if(Number(state.observationCount)!==QBO_OBS_INDEX_FINAL_RECON_V191_.EXPECTED_OBSERVATIONS)
    throw new Error('OBS_INDEX_V191_FINAL_OBSERVATION_COUNT '+state.observationCount);
  if(Number(state.admittedCount)!==QBO_OBS_INDEX_FINAL_RECON_V191_.EXPECTED_ADMITTED)
    throw new Error('OBS_INDEX_V191_FINAL_ADMITTED_COUNT '+state.admittedCount);
  if(Number(state.evidenceExceptionCount)!==QBO_OBS_INDEX_FINAL_RECON_V191_.EXPECTED_EVIDENCE_EXCEPTION)
    throw new Error('OBS_INDEX_V191_FINAL_EVIDENCE_EXCEPTION_COUNT '+state.evidenceExceptionCount);
  if(Number(state.blockedCount)!==QBO_OBS_INDEX_FINAL_RECON_V191_.EXPECTED_BLOCKED)
    throw new Error('OBS_INDEX_V191_FINAL_BLOCKED_COUNT '+state.blockedCount);
  if(failures)throw new Error('OBS_INDEX_V191_FINAL_FAILURE_COUNT '+failures);
  state.status='COMPLETE_PENDING_GLOBAL_ID_RECONCILIATION';
  state.completedAt=new Date().toISOString();
  state.error='';
  state.continuationTriggerId='';
  qboObsIndexV191SaveState_(state);
  qboObsIndexV191DeleteOwnTriggers_();
  console.log('[OBSERVATION INDEX V191] | RECONCILIATION_COMPLETE | '+JSON.stringify(state));
}

function qboObsIndexV191Schedule_(state){
  qboObsIndexV191DeleteOwnTriggers_();
  const t=ScriptApp.newTrigger(QBO_OBS_INDEX_FINAL_RECON_V191_.CONTINUATION_HANDLER)
    .timeBased().after(QBO_OBS_INDEX_FINAL_RECON_V191_.CONTINUATION_DELAY_MS).create();
  state.continuationTriggerId=String(t.getUniqueId()||'');
  qboObsIndexV191SaveState_(state);
}

function qboObsIndexV191DeleteOwnTriggers_(){
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction()===QBO_OBS_INDEX_FINAL_RECON_V191_.CONTINUATION_HANDLER)
      ScriptApp.deleteTrigger(t);
  });
}

function qboObsIndexV191LoadState_(){
  const raw=PropertiesService.getScriptProperties().getProperty(QBO_OBS_INDEX_FINAL_RECON_V191_.STATE_KEY);
  return raw?JSON.parse(raw):null;
}
function qboObsIndexV191SaveState_(s){
  PropertiesService.getScriptProperties().setProperty(QBO_OBS_INDEX_FINAL_RECON_V191_.STATE_KEY,JSON.stringify(s));
}
function statusQboObservationIndexFinalReconciliationV191(){
  const s=qboObsIndexV191LoadState_();
  console.log('[OBSERVATION INDEX V191] | STATUS | '+JSON.stringify(s||{}));
  return s;
}
