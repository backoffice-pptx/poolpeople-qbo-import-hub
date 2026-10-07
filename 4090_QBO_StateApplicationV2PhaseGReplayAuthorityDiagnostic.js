/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 4090_QBO_StateApplicationV2PhaseGReplayAuthorityDiagnostic.js
 * Version     : 1.5.217
 * Purpose     : Read-only Phase G replay-authority diagnostic. Verifies the
 *               post-disposition empty V2 target and inventories the certified
 *               logical 07 shard population for chronology/tie-resolution design.
 *
 * Source evidence and State Application are read-only. Mutations are limited
 * to this diagnostic's Script Property checkpoint and one-time continuation.
 */
const QBO_PHASE_G_REPLAY_AUTH_V1217_=Object.freeze({
  VERSION:'1.5.218', STATE_KEY:'QBO_PHASE_G_REPLAY_AUTH_V1217_STATE',
  HANDLER:'qboPhaseGReplayAuthorityV1217Continuation_', DELAY_MS:60000,
  RUNTIME_MS:150000, MAX_MANIFESTS:24, EXPECTED_MANIFESTS:2418,
  EXPECTED_LOGICAL:734858, EXPECTED_ADMITTED:734786, EXPECTED_EXCEPTION:52, EXPECTED_BLOCKED:20,
  REPLAY_KEY:'QBO_PHASE_G_V1215_REPLAY_STATE',
  REPLAY_RUN:'PHASE_G_V2_REPLAY|3d2f9b33-9d22-45f4-8074-fa5c9d947c66',
  HIST_RUN:'FINAL_HIST07_V202|2a2db396-f66b-4d89-a902-22f4c9149d36'
});
function startQboStateApplicationV2PhaseGReplayAuthorityDiagnosticV1217(){
  const C=QBO_PHASE_G_REPLAY_AUTH_V1217_; qboPhaseG1217DeleteTriggers_(); qboPhaseG1217RequireTarget_();
  const folders=qboObsIndexV175ResolveFolders_(),it=folders.manifests.getFiles();
  const s={version:C.VERSION,status:'RUNNING',runId:'PHASE_G_REPLAY_AUTH_V1217|'+Utilities.getUuid(),manifestCursor:0,manifestCount:C.EXPECTED_MANIFESTS,iteratorToken:it.getContinuationToken(),observationCount:0,admittedCount:0,evidenceExceptionCount:0,blockedCount:0,missingObservedAtCount:0,invalidObservedAtCount:0,duplicateObservationIdWithinShardCount:0,entityCountApprox:0,equalObservedAtPairCount:0,equalObservedAtGroupCount:0,maxEqualObservedAtGroupSize:0,tieCandidateDistinctCount:{ObservationId:0,SourceType_SourceRunId_SourceUnitId_PayloadOrdinal_ObservationId:0},tieCandidateFailureCount:{ObservationId:0,SourceType_SourceRunId_SourceUnitId_PayloadOrdinal_ObservationId:0},sampleEqualObservedAtGroups:[],startedAt:new Date().toISOString(),lastProgressAt:'',completedAt:'',error:'',continuationTriggerId:''};
  PropertiesService.getScriptProperties().setProperty(C.STATE_KEY,JSON.stringify(s));
  console.log('[PHASE G REPLAY AUTH V1217] | STARTED | '+JSON.stringify(qboPhaseG1217Public_(s))); return qboPhaseG1217Worker_();
}
function qboPhaseGReplayAuthorityV1217Continuation_(){qboPhaseG1217DeleteTriggers_();return qboPhaseG1217Worker_();}
function recoverQboStateApplicationV2PhaseGReplayAuthorityDiagnosticV1218(){
  const C=QBO_PHASE_G_REPLAY_AUTH_V1217_,p=PropertiesService.getScriptProperties(),s=qboPhaseG1217Json_(p.getProperty(C.STATE_KEY));
  if(!s||s.runId!=='PHASE_G_REPLAY_AUTH_V1217|1a90b039-5363-483f-a145-435aeb56cfcd')throw new Error('PHASE_G_V1218_RUN_NOT_EXACT');
  if(s.status!=='FAILED'||String(s.error||'').indexOf('Service error: Drive')<0)throw new Error('PHASE_G_V1218_NOT_RECOVERABLE_DRIVE_FAILURE');
  if(Number(s.manifestCursor)!==2141||Number(s.observationCount)!==497187||Number(s.admittedCount)!==497131||Number(s.evidenceExceptionCount)!==36||Number(s.blockedCount)!==20)throw new Error('PHASE_G_V1218_CHECKPOINT_NOT_EXACT');
  if(!s.iteratorToken)throw new Error('PHASE_G_V1218_ITERATOR_TOKEN_MISSING'); qboPhaseG1217RequireTarget_();
  qboPhaseG1217DeleteTriggers_(); s.version=C.VERSION;s.status='RUNNING';s.error='';s.completedAt='';s.continuationTriggerId='';s.recoveredAt=new Date().toISOString();p.setProperty(C.STATE_KEY,JSON.stringify(s));
  console.log('[PHASE G REPLAY AUTH V1218] | RECOVERED | '+JSON.stringify(qboPhaseG1217Public_(s))); return qboPhaseG1217Worker_();
}
function qboPhaseG1217Worker_(){
  const C=QBO_PHASE_G_REPLAY_AUTH_V1217_,p=PropertiesService.getScriptProperties(),s=qboPhaseG1217Json_(p.getProperty(C.STATE_KEY));
  if(!s||s.status!=='RUNNING')throw new Error('PHASE_G_V1217_NOT_RUNNING'); qboPhaseG1217RequireTarget_();
  const started=Date.now(),folders=qboObsIndexV175ResolveFolders_(),it=DriveApp.continueFileIterator(String(s.iteratorToken||'')); let n=0;
  try{
    while(it.hasNext()&&n<C.MAX_MANIFESTS&&Date.now()-started<C.RUNTIME_MS){
      const mf=it.next(),name=String(mf.getName()||''); if(!/\.manifest\.json$/.test(name))throw new Error('PHASE_G_V1217_UNKNOWN_MANIFEST '+name);
      const base=name.replace(/\.manifest\.json$/,''),sf=qboPhaseG1217Single_(folders.shards,base+'.json'),lf=qboPhaseG1217Single_(folders.lookup,base+'.lookup.json');
      const m=qboObsIndexV192ReadJson_(mf.getId()),sh=qboObsIndexV192ReadJson_(sf.getId()),lk=qboObsIndexV192ReadJson_(lf.getId()); qboPhaseG1217VerifyTriplet_(m,sh,lk,mf,sf,lf);
      const rec=sh.stableBody.records||[], localIds=Object.create(null), groups=Object.create(null), entities=Object.create(null);
      rec.forEach(function(r){
        s.observationCount++; const id=String(r.ObservationId||''),oa=String(r.ObservedAt||''),ek=String(r.EntityType||'')+'|'+String(r.EntityId||''); entities[ek]=true;
        if(localIds[id])s.duplicateObservationIdWithinShardCount++; localIds[id]=true;
        if(!oa)s.missingObservedAtCount++; else if(isNaN(new Date(oa).getTime()))s.invalidObservedAtCount++;
        const a=String(r.AdmissionStatus||''); if(a==='ADMITTED')s.admittedCount++; else if(a==='EVIDENCE_EXCEPTION')s.evidenceExceptionCount++; else if(a==='BLOCKED')s.blockedCount++; else throw new Error('PHASE_G_V1217_ADMISSION '+a);
        const gk=ek+'|'+oa; (groups[gk]||(groups[gk]=[])).push(r);
      });
      s.entityCountApprox+=Object.keys(entities).length;
      Object.keys(groups).forEach(function(k){const g=groups[k];if(g.length<2)return;s.equalObservedAtGroupCount++;s.equalObservedAtPairCount+=g.length;s.maxEqualObservedAtGroupSize=Math.max(s.maxEqualObservedAtGroupSize,g.length);
        const ids={},compound={};g.forEach(function(r){ids[String(r.ObservationId||'')]=true;compound[[r.SourceType,r.SourceRunId,r.SourceUnitId,r.PayloadOrdinal,r.ObservationId].map(String).join('|')]=true;});
        if(Object.keys(ids).length===g.length)s.tieCandidateDistinctCount.ObservationId+=g.length;else s.tieCandidateFailureCount.ObservationId++;
        if(Object.keys(compound).length===g.length)s.tieCandidateDistinctCount.SourceType_SourceRunId_SourceUnitId_PayloadOrdinal_ObservationId+=g.length;else s.tieCandidateFailureCount.SourceType_SourceRunId_SourceUnitId_PayloadOrdinal_ObservationId++;
        if(s.sampleEqualObservedAtGroups.length<20)s.sampleEqualObservedAtGroups.push({entityType:String(g[0].EntityType||''),entityId:String(g[0].EntityId||''),observedAt:String(g[0].ObservedAt||''),size:g.length,sourceTypes:g.map(x=>String(x.SourceType||'')),observationIds:g.slice(0,5).map(x=>String(x.ObservationId||''))});
      });
      s.manifestCursor++;n++;s.iteratorToken=it.getContinuationToken();s.lastProgressAt=new Date().toISOString();p.setProperty(C.STATE_KEY,JSON.stringify(s));
    }
    if(!it.hasNext())return qboPhaseG1217Complete_(s,p);
    s.iteratorToken=it.getContinuationToken();qboPhaseG1217Schedule_(s,p);console.log('[PHASE G REPLAY AUTH V1217] | PROGRESS | '+JSON.stringify(Object.assign(qboPhaseG1217Public_(s),{invocationManifests:n})));return qboPhaseG1217Public_(s);
  }catch(e){const msg=String(e&&e.message?e.message:e);s.lastProgressAt=new Date().toISOString();if(qboPhaseG1218IsTransientDrive_(msg)){s.status='RUNNING';s.error='TRANSIENT_DRIVE_RETRY: '+msg;p.setProperty(C.STATE_KEY,JSON.stringify(s));try{qboPhaseG1217Schedule_(s,p);console.log('[PHASE G REPLAY AUTH V1218] | TRANSIENT_DRIVE_RETRY_SCHEDULED | '+JSON.stringify(qboPhaseG1217Public_(s)));return qboPhaseG1217Public_(s);}catch(se){s.status='CONTINUATION_REQUIRED';s.error='TRANSIENT_DRIVE_RETRY_SCHEDULE_FAILED: '+String(se&&se.message?se.message:se);p.setProperty(C.STATE_KEY,JSON.stringify(s));console.log('[PHASE G REPLAY AUTH V1218] | CONTINUATION_REQUIRED | '+JSON.stringify(qboPhaseG1217Public_(s)));return qboPhaseG1217Public_(s);}}s.status='FAILED';s.error=msg;p.setProperty(C.STATE_KEY,JSON.stringify(s));console.log('[PHASE G REPLAY AUTH V1218] | FAILED | '+JSON.stringify(qboPhaseG1217Public_(s)));throw e;}
}
function qboPhaseG1217Complete_(s,p){const C=QBO_PHASE_G_REPLAY_AUTH_V1217_;qboPhaseG1217DeleteTriggers_();const fail=[];
  [['manifestCursor',C.EXPECTED_MANIFESTS],['observationCount',C.EXPECTED_LOGICAL],['admittedCount',C.EXPECTED_ADMITTED],['evidenceExceptionCount',C.EXPECTED_EXCEPTION],['blockedCount',C.EXPECTED_BLOCKED]].forEach(x=>{if(Number(s[x[0]])!==x[1])fail.push(x[0]+'='+s[x[0]]+' expected='+x[1]);});
  if(s.missingObservedAtCount||s.invalidObservedAtCount||s.duplicateObservationIdWithinShardCount)fail.push('chronology_or_identity_failure');
  s.status=fail.length?'FAILED':'COMPLETE_REPLAY_AUTHORITY_DIAGNOSTIC';s.completedAt=new Date().toISOString();s.error=fail.join(';');s.continuationTriggerId='';p.setProperty(C.STATE_KEY,JSON.stringify(s));
  const out=Object.assign(qboPhaseG1217Public_(s),{logicalSchema:QBO_OBSERVATION_INDEX_CONTRACT_.HEADERS.slice(),chronologyPartition:QBO_OBSERVATION_INDEX_CONTRACT_.CHRONOLOGY_PARTITION.slice(),primaryChronologyField:QBO_OBSERVATION_INDEX_CONTRACT_.PRIMARY_CHRONOLOGY_FIELD,equalObservedAtRequiresGovernedResolution:true,physicalAuthority:'IMMUTABLE_OBSERVATION_INDEX_SHARDS_LOOKUP_MANIFESTS',stateApplicationTargetSheets:['10_Snapshot_Records','11_Change_Records','12_Change_Detail'],governedSheet13Present:false,equalObservedAtAnalysisScope:'WITHIN_SHARD_ONLY',globalEqualObservedAtCertification:false,replayAuthorized:false,replayWorkerEnabled:false,nextAction:fail.length?'REPAIR_DIAGNOSTIC_FAILURE':'RUN_GLOBAL_EQUAL_TIME_ORDER_DIAGNOSTIC' });
  console.log('[PHASE G REPLAY AUTH V1217] | '+(fail.length?'FAILED':'COMPLETE')+' | '+JSON.stringify(out));if(fail.length)throw new Error('PHASE_G_V1217_FINAL '+s.error);return out;}
function qboPhaseG1217RequireTarget_(){const C=QBO_PHASE_G_REPLAY_AUTH_V1217_,p=PropertiesService.getScriptProperties(),r=qboPhaseG1217Json_(p.getProperty(C.REPLAY_KEY));if(!r||r.status!=='INITIALIZED_REPLAY_DISABLED'||r.runId!==C.REPLAY_RUN||r.historical07RunId!==C.HIST_RUN||Number(r.expectedLogicalObservationCount)!==C.EXPECTED_LOGICAL||r.replayAuthorized!==false||r.replayWorkerEnabled!==false||Number(r.observationCursor)!==0||Number(r.processedObservationCount)!==0)throw new Error('PHASE_G_V1217_REPLAY_STATE_NOT_EXACT');const ss=getQboStateCaptureSpreadsheet_();['10_Snapshot_Records','11_Change_Records','12_Change_Detail'].forEach(function(n){const sh=ss.getSheetByName(n);if(!sh)throw new Error('PHASE_G_V1217_TARGET_MISSING '+n);});qboPhaseG1215VerifyAllCleared_(ss);}
function qboPhaseG1217VerifyTriplet_(m,s,l,mf,sf,lf){if(!m||!m.stableBody||!s||!s.stableBody||!l||!l.stableBody)throw new Error('PHASE_G_V1217_TRIPLET_BODY');const sh=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(s.stableBody)),lh=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(l.stableBody)),mh=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(m.stableBody));if(String(s.shardHash||'')!==sh||String(l.lookupHash||'')!==lh||String(m.manifestHash||'')!==mh)throw new Error('PHASE_G_V1217_HASH');if(String(l.stableBody.shardFileId||'')!==sf.getId()||String(m.stableBody.shardFileId||'')!==sf.getId()||String(m.stableBody.lookupFileId||'')!==lf.getId())throw new Error('PHASE_G_V1217_REFERENCE');}
function qboPhaseG1217Single_(folder,name){const it=folder.getFilesByName(name);if(!it.hasNext())throw new Error('PHASE_G_V1217_MISSING '+name);const f=it.next();if(it.hasNext())throw new Error('PHASE_G_V1217_DUPLICATE '+name);return f;}
function qboPhaseG1217Schedule_(s,p){qboPhaseG1217DeleteTriggers_();const t=ScriptApp.newTrigger(QBO_PHASE_G_REPLAY_AUTH_V1217_.HANDLER).timeBased().after(QBO_PHASE_G_REPLAY_AUTH_V1217_.DELAY_MS).create();s.continuationTriggerId=t.getUniqueId();p.setProperty(QBO_PHASE_G_REPLAY_AUTH_V1217_.STATE_KEY,JSON.stringify(s));}
function qboPhaseG1217DeleteTriggers_(){ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()===QBO_PHASE_G_REPLAY_AUTH_V1217_.HANDLER){try{ScriptApp.deleteTrigger(t);}catch(e){}}});}
function qboPhaseG1217Json_(v){try{return JSON.parse(v||'null');}catch(e){return null;}}
function qboPhaseG1217Public_(s){return{version:s.version,status:s.status,runId:s.runId,manifestCursor:s.manifestCursor,manifestCount:s.manifestCount,observationCount:s.observationCount,admittedCount:s.admittedCount,evidenceExceptionCount:s.evidenceExceptionCount,blockedCount:s.blockedCount,missingObservedAtCount:s.missingObservedAtCount,invalidObservedAtCount:s.invalidObservedAtCount,duplicateObservationIdWithinShardCount:s.duplicateObservationIdWithinShardCount,equalObservedAtGroupCount:s.equalObservedAtGroupCount,equalObservedAtPairCount:s.equalObservedAtPairCount,maxEqualObservedAtGroupSize:s.maxEqualObservedAtGroupSize,tieCandidateFailureCount:s.tieCandidateFailureCount,sampleEqualObservedAtGroups:s.sampleEqualObservedAtGroups,startedAt:s.startedAt,lastProgressAt:s.lastProgressAt,completedAt:s.completedAt,error:s.error,continuationTriggerId:s.continuationTriggerId};}

function qboPhaseG1218IsTransientDrive_(msg){return /Service error:\s*Drive|Internal error.*Drive|Drive.*temporar|Service invoked too many times.*Drive/i.test(String(msg||''));}
