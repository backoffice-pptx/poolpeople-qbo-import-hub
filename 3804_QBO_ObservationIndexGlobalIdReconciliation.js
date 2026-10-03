/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3804_QBO_ObservationIndexGlobalIdReconciliation.js
 * Version     : 1.5.197
 *
 * Read-only evidence audit proving global ObservationId uniqueness across the
 * reconciled physical Observation Index. Source shard evidence is never
 * mutated. The audit creates a dedicated working spreadsheet containing only
 * ObservationIds partitioned by the first SHA-256 hex nibble, plus a bounded
 * Script Properties checkpoint and one-time continuation trigger.
 *
 * Prerequisite: exact completed v192 reconciliation run.
 */
const QBO_OBS_INDEX_GLOBAL_ID_V197_=Object.freeze({
  VERSION:'1.5.197',
  STATE_KEY:'QBO_OBS_INDEX_GLOBAL_ID_V197_STATE',
  CONTINUATION_HANDLER:'qboObservationIndexGlobalIdV197Continuation_',
  EXPECTED_V192_RUN_ID:'OBS_INDEX_FINAL_RECON_V192|6a9e8043-c161-485d-935b-9b1ca0796d2f',
  EXPECTED_OBSERVATIONS:734858,
  EXPECTED_TRIPLETS:2418,
  EXPECTED_ADMITTED:734786,
  EXPECTED_EVIDENCE_EXCEPTION:52,
  EXPECTED_BLOCKED:20,
  PREFIXES:'0123456789abcdef'.split(''),
  MAX_TRIPLETS_PER_INVOCATION:20,
  RUNTIME_BUDGET_MS:150000,
  CONTINUATION_DELAY_MS:60000,
  WORKBOOK_NAME_PREFIX:'QBO Observation Index Global ID Reconciliation V197 '
});

function startQboObservationIndexGlobalIdReconciliationV197(){
  const c=QBO_OBS_INDEX_GLOBAL_ID_V197_;
  const prior=qboObsIndexGlobalIdV197LoadState_();
  if(prior&&prior.status==='RUNNING')throw new Error('OBS_INDEX_GLOBAL_ID_V197_ALREADY_RUNNING');
  qboObsIndexGlobalIdV197DeleteHandlerTriggers_();
  qboObsIndexGlobalIdV197RequireV192_();

  const folders=qboObsIndexV175ResolveFolders_();
  const manifests=folders.manifests.getFiles();
  const runId='OBS_INDEX_GLOBAL_ID_V197|'+Utilities.getUuid();
  const ss=SpreadsheetApp.create(c.WORKBOOK_NAME_PREFIX+runId.replace(/[^A-Za-z0-9_-]/g,'_'));
  const file=DriveApp.getFileById(ss.getId());
  const parentIt=folders.manifests.getParents();
  if(!parentIt.hasNext())throw new Error('OBS_INDEX_GLOBAL_ID_V197_PARENT_FOLDER_MISSING');
  file.moveTo(parentIt.next());

  const first=ss.getSheets()[0];
  first.setName('P_0');
  first.getRange(1,1).setValue('ObservationId');
  for(let i=1;i<c.PREFIXES.length;i++){
    const sh=ss.insertSheet('P_'+c.PREFIXES[i]);
    sh.getRange(1,1).setValue('ObservationId');
  }

  const state={
    version:c.VERSION,status:'COLLECTING',runId:runId,
    prerequisiteV192RunId:c.EXPECTED_V192_RUN_ID,
    tripletCursor:0,tripletCount:c.EXPECTED_TRIPLETS,
    manifestIteratorToken:manifests.getContinuationToken(),
    scannedObservationCount:0,
    prefixCounts:qboObsIndexGlobalIdV197ZeroPrefixMap_(),
    workbookId:ss.getId(),workbookName:ss.getName(),
    evaluationPrefixIndex:0,distinctObservationCount:0,duplicateObservationIdCount:0,
    duplicateSamples:[],startedAt:new Date().toISOString(),lastProgressAt:'',completedAt:'',error:'',continuationTriggerId:''
  };
  qboObsIndexGlobalIdV197SaveState_(state);
  console.log('[OBSERVATION INDEX GLOBAL ID V197] | STARTED | '+JSON.stringify(qboObsIndexGlobalIdV197PublicState_(state)));
  qboObservationIndexGlobalIdV197Worker_();
}

function qboObservationIndexGlobalIdV197Continuation_(){
  qboObsIndexGlobalIdV197DeleteHandlerTriggers_();
  qboObservationIndexGlobalIdV197Worker_();
}

function qboObservationIndexGlobalIdV197Worker_(){
  const state=qboObsIndexGlobalIdV197LoadState_();
  if(!state||!['COLLECTING','EVALUATING'].includes(state.status))throw new Error('OBS_INDEX_GLOBAL_ID_V197_NOT_RUNNING');
  try{
    if(state.status==='COLLECTING')qboObsIndexGlobalIdV197Collect_(state);
    else qboObsIndexGlobalIdV197Evaluate_(state);
  }catch(e){
    state.status='FAILED';
    state.error=String(e&&e.message?e.message:e);
    state.lastProgressAt=new Date().toISOString();
    qboObsIndexGlobalIdV197SaveState_(state);
    console.log('[OBSERVATION INDEX GLOBAL ID V197] | FAILED | '+JSON.stringify(qboObsIndexGlobalIdV197PublicState_(state)));
    throw e;
  }
}

function qboObsIndexGlobalIdV197Collect_(state){
  const c=QBO_OBS_INDEX_GLOBAL_ID_V197_;
  qboObsIndexGlobalIdV197RequireV192_();
  const folders=qboObsIndexV175ResolveFolders_();
  const it=DriveApp.continueFileIterator(String(state.manifestIteratorToken||''));
  const ss=SpreadsheetApp.openById(String(state.workbookId));
  const batches={}; c.PREFIXES.forEach(p=>batches[p]=[]);
  const started=Date.now(); let processed=0,invocationObs=0;

  while(it.hasNext()&&processed<c.MAX_TRIPLETS_PER_INVOCATION&&Date.now()-started<c.RUNTIME_BUDGET_MS){
    const manifestFile=it.next();
    const name=String(manifestFile.getName()||'');
    if(!/\.manifest\.json$/.test(name))throw new Error('OBS_INDEX_GLOBAL_ID_V197_UNKNOWN_MANIFEST '+name);
    const base=name.replace(/\.manifest\.json$/,'');
    const shardFile=qboObsIndexV192RequireSingleByName_(folders.shards,base+'.json');
    const shard=qboObsIndexV192ReadJson_(shardFile.getId());
    const ids=shard&&shard.stableBody&&Array.isArray(shard.stableBody.observationIds)?shard.stableBody.observationIds:null;
    const records=shard&&shard.stableBody&&Array.isArray(shard.stableBody.records)?shard.stableBody.records:null;
    if(!ids||!records||ids.length!==records.length||Number(shard.stableBody.observationCount||0)!==ids.length)
      throw new Error('OBS_INDEX_GLOBAL_ID_V197_SHARD_COUNT_CONTRACT '+base);
    const stableHash=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(shard.stableBody));
    if(String(shard.shardHash||'')!==stableHash)throw new Error('OBS_INDEX_GLOBAL_ID_V197_SHARD_HASH '+base);

    ids.forEach(function(rawId,i){
      const id=String(rawId||'');
      if(id!==String(records[i]&&records[i].ObservationId||''))throw new Error('OBS_INDEX_GLOBAL_ID_V197_ID_VECTOR_MISMATCH '+base+' ordinal='+i);
      const m=/^OBS\|([0-9a-f]{64})$/i.exec(id);
      if(!m)throw new Error('OBS_INDEX_GLOBAL_ID_V197_ID_FORMAT '+base+' ordinal='+i);
      const p=m[1].charAt(0).toLowerCase();
      batches[p].push([id]);
      state.prefixCounts[p]=Number(state.prefixCounts[p]||0)+1;
      state.scannedObservationCount++;
      invocationObs++;
    });
    state.tripletCursor++;
    processed++;
    state.manifestIteratorToken=it.getContinuationToken();
  }

  c.PREFIXES.forEach(function(p){
    const rows=batches[p]; if(!rows.length)return;
    const sh=ss.getSheetByName('P_'+p); if(!sh)throw new Error('OBS_INDEX_GLOBAL_ID_V197_BUCKET_SHEET_MISSING '+p);
    sh.getRange(sh.getLastRow()+1,1,rows.length,1).setValues(rows);
  });
  SpreadsheetApp.flush();
  state.lastProgressAt=new Date().toISOString();

  if(!it.hasNext()){
    const sum=qboObsIndexGlobalIdV197PrefixSum_(state.prefixCounts);
    if(state.tripletCursor!==c.EXPECTED_TRIPLETS||state.scannedObservationCount!==c.EXPECTED_OBSERVATIONS||sum!==c.EXPECTED_OBSERVATIONS)
      throw new Error('OBS_INDEX_GLOBAL_ID_V197_COLLECTION_INVARIANT '+JSON.stringify({triplets:state.tripletCursor,scanned:state.scannedObservationCount,prefixSum:sum}));
    state.status='EVALUATING'; state.manifestIteratorToken=''; state.evaluationPrefixIndex=0;
  }
  qboObsIndexGlobalIdV197SaveState_(state);
  qboObsIndexGlobalIdV197ScheduleNext_(state);
  console.log('[OBSERVATION INDEX GLOBAL ID V197] | COLLECTION_PROGRESS | '+JSON.stringify(Object.assign(qboObsIndexGlobalIdV197PublicState_(state),{invocationTriplets:processed,invocationObservations:invocationObs})));
}

function qboObsIndexGlobalIdV197Evaluate_(state){
  const c=QBO_OBS_INDEX_GLOBAL_ID_V197_;
  qboObsIndexGlobalIdV197RequireV192_();
  const ss=SpreadsheetApp.openById(String(state.workbookId));
  const started=Date.now(); let evaluated=0;
  while(state.evaluationPrefixIndex<c.PREFIXES.length&&Date.now()-started<c.RUNTIME_BUDGET_MS){
    const p=c.PREFIXES[state.evaluationPrefixIndex];
    const sh=ss.getSheetByName('P_'+p); if(!sh)throw new Error('OBS_INDEX_GLOBAL_ID_V197_BUCKET_SHEET_MISSING '+p);
    const n=Math.max(0,sh.getLastRow()-1);
    if(n!==Number(state.prefixCounts[p]||0))throw new Error('OBS_INDEX_GLOBAL_ID_V197_BUCKET_COUNT_MISMATCH prefix='+p+' sheet='+n+' expected='+state.prefixCounts[p]);
    const values=n?sh.getRange(2,1,n,1).getValues():[];
    const seen=Object.create(null); let distinct=0,dups=0;
    values.forEach(function(row){
      const id=String(row[0]||'');
      if(seen[id]){
        dups++;
        if(state.duplicateSamples.length<25)state.duplicateSamples.push({prefix:p,observationId:id});
      }else{seen[id]=true;distinct++;}
    });
    state.distinctObservationCount+=distinct;
    state.duplicateObservationIdCount+=dups;
    state.evaluationPrefixIndex++; evaluated++;
    state.lastProgressAt=new Date().toISOString();
    qboObsIndexGlobalIdV197SaveState_(state);
  }

  if(state.evaluationPrefixIndex===c.PREFIXES.length){
    const prefixSum=qboObsIndexGlobalIdV197PrefixSum_(state.prefixCounts);
    if(prefixSum!==c.EXPECTED_OBSERVATIONS||state.scannedObservationCount!==c.EXPECTED_OBSERVATIONS)
      throw new Error('OBS_INDEX_GLOBAL_ID_V197_FINAL_POPULATION_INVARIANT');
    if(state.distinctObservationCount+state.duplicateObservationIdCount!==c.EXPECTED_OBSERVATIONS)
      throw new Error('OBS_INDEX_GLOBAL_ID_V197_DISTINCT_PARTITION_INVARIANT');
    if(state.duplicateObservationIdCount!==0||state.distinctObservationCount!==c.EXPECTED_OBSERVATIONS)
      throw new Error('OBS_INDEX_GLOBAL_ID_V197_GLOBAL_DUPLICATES '+JSON.stringify({distinct:state.distinctObservationCount,duplicates:state.duplicateObservationIdCount,samples:state.duplicateSamples}));
    state.status='COMPLETE_PENDING_DEEP_LINEAGE_CHRONOLOGY_RECONCILIATION';
    state.completedAt=new Date().toISOString(); state.continuationTriggerId=''; state.error='';
    qboObsIndexGlobalIdV197SaveState_(state); qboObsIndexGlobalIdV197DeleteHandlerTriggers_();
    console.log('[OBSERVATION INDEX GLOBAL ID V197] | RECONCILIATION_COMPLETE | '+JSON.stringify(qboObsIndexGlobalIdV197PublicState_(state)));
    return;
  }
  qboObsIndexGlobalIdV197ScheduleNext_(state);
  console.log('[OBSERVATION INDEX GLOBAL ID V197] | EVALUATION_PROGRESS | '+JSON.stringify(Object.assign(qboObsIndexGlobalIdV197PublicState_(state),{invocationPrefixes:evaluated})));
}

function qboObsIndexGlobalIdV197RequireV192_(){
  const c=QBO_OBS_INDEX_GLOBAL_ID_V197_,s=qboObsIndexV192LoadState_();
  if(!s||String(s.runId)!==c.EXPECTED_V192_RUN_ID||String(s.status)!=='COMPLETE_PENDING_GLOBAL_ID_RECONCILIATION')throw new Error('OBS_INDEX_GLOBAL_ID_V197_V192_PREREQUISITE');
  const checks=[['tripletCursor',c.EXPECTED_TRIPLETS],['tripletCount',c.EXPECTED_TRIPLETS],['observationCount',c.EXPECTED_OBSERVATIONS],['admittedCount',c.EXPECTED_ADMITTED],['evidenceExceptionCount',c.EXPECTED_EVIDENCE_EXCEPTION],['blockedCount',c.EXPECTED_BLOCKED]];
  checks.forEach(x=>{if(Number(s[x[0]])!==x[1])throw new Error('OBS_INDEX_GLOBAL_ID_V197_V192_COUNT '+x[0]);});
  ['duplicateObservationIdCount','hashFailureCount','referenceFailureCount','countFailureCount','chronologyFailureCount','lineageFailureCount'].forEach(k=>{if(Number(s[k]||0)!==0)throw new Error('OBS_INDEX_GLOBAL_ID_V197_V192_FAILURE '+k);});
  return true;
}
function testQboObservationIndexGlobalIdReconciliationPrerequisitesV197(){
  qboObsIndexGlobalIdV197RequireV192_();
  const folders=qboObsIndexV175ResolveFolders_();
  const result={version:'1.5.197',readOnly:true,ready:true,prerequisiteV192RunId:QBO_OBS_INDEX_GLOBAL_ID_V197_.EXPECTED_V192_RUN_ID,expectedTriplets:2418,expectedObservations:734858,sourceEvidenceMutated:false,workingArtifactType:'DEDICATED_AUDIT_SPREADSHEET',prefixPartitionCount:16};
  console.log('[OBSERVATION INDEX GLOBAL ID V197] | PREREQUISITE | '+JSON.stringify(result)); return result;
}
function statusQboObservationIndexGlobalIdReconciliationV197(){
  const s=qboObsIndexGlobalIdV197LoadState_(); const out=s?qboObsIndexGlobalIdV197PublicState_(s):{version:'1.5.197',status:'NOT_STARTED'};
  console.log('[OBSERVATION INDEX GLOBAL ID V197] | STATUS | '+JSON.stringify(out)); return out;
}
function qboObsIndexGlobalIdV197ZeroPrefixMap_(){const o={};QBO_OBS_INDEX_GLOBAL_ID_V197_.PREFIXES.forEach(p=>o[p]=0);return o;}
function qboObsIndexGlobalIdV197PrefixSum_(m){return QBO_OBS_INDEX_GLOBAL_ID_V197_.PREFIXES.reduce((n,p)=>n+Number(m[p]||0),0);}
function qboObsIndexGlobalIdV197LoadState_(){const v=PropertiesService.getScriptProperties().getProperty(QBO_OBS_INDEX_GLOBAL_ID_V197_.STATE_KEY);return v?JSON.parse(v):null;}
function qboObsIndexGlobalIdV197SaveState_(s){PropertiesService.getScriptProperties().setProperty(QBO_OBS_INDEX_GLOBAL_ID_V197_.STATE_KEY,JSON.stringify(s));}
function qboObsIndexGlobalIdV197PublicState_(s){return {version:s.version,status:s.status,runId:s.runId,prerequisiteV192RunId:s.prerequisiteV192RunId,tripletCursor:s.tripletCursor,tripletCount:s.tripletCount,scannedObservationCount:s.scannedObservationCount,prefixPopulationSum:qboObsIndexGlobalIdV197PrefixSum_(s.prefixCounts||{}),evaluationPrefixIndex:s.evaluationPrefixIndex,distinctObservationCount:s.distinctObservationCount,duplicateObservationIdCount:s.duplicateObservationIdCount,duplicateSamples:s.duplicateSamples,workbookId:s.workbookId,workbookName:s.workbookName,startedAt:s.startedAt,lastProgressAt:s.lastProgressAt,completedAt:s.completedAt,error:s.error,continuationTriggerId:s.continuationTriggerId};}
function qboObsIndexGlobalIdV197ScheduleNext_(state){
  qboObsIndexGlobalIdV197DeleteHandlerTriggers_();
  const t=ScriptApp.newTrigger(QBO_OBS_INDEX_GLOBAL_ID_V197_.CONTINUATION_HANDLER).timeBased().after(QBO_OBS_INDEX_GLOBAL_ID_V197_.CONTINUATION_DELAY_MS).create();
  state.continuationTriggerId=String(t.getUniqueId()||''); qboObsIndexGlobalIdV197SaveState_(state);
}
function qboObsIndexGlobalIdV197DeleteHandlerTriggers_(){
  ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()===QBO_OBS_INDEX_GLOBAL_ID_V197_.CONTINUATION_HANDLER){try{ScriptApp.deleteTrigger(t);}catch(e){console.warn('[OBSERVATION INDEX GLOBAL ID V197] | TRIGGER_DELETE_WARNING | '+String(e&&e.message?e.message:e));}}});
}
