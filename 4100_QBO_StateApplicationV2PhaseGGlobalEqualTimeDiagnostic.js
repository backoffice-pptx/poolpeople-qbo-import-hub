/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 4100_QBO_StateApplicationV2PhaseGGlobalEqualTimeDiagnostic.js
 * Version     : 1.5.221
 * Purpose     : Exact global equal-ObservedAt diagnostic across immutable
 *               Observation Index shards. Hash-partitions by EntityType+EntityId,
 *               then sorts each complete entity partition to detect cross-shard ties.
 *
 * Source evidence and State Application are read-only. Writes are limited to this
 * diagnostic's private workbook, Script Property checkpoint, and continuation trigger.
 */
const QBO_PHASE_G_GLOBAL_TIE_V1219_=Object.freeze({
  VERSION:'1.5.221',STATE_KEY:'QBO_PHASE_G_GLOBAL_TIE_V1219_STATE',HANDLER:'qboPhaseGGlobalEqualTimeV1219Continuation_',
  DELAY_MS:60000,RUNTIME_MS:150000,MAX_MANIFESTS:16,PARTITIONS:64,
  EXPECTED_MANIFESTS:2418,EXPECTED_LOGICAL:734858,EXPECTED_ADMITTED:734786,EXPECTED_EXCEPTION:52,EXPECTED_BLOCKED:20,
  PRIOR_KEY:'QBO_PHASE_G_REPLAY_AUTH_V1217_STATE',PRIOR_RUN:'PHASE_G_REPLAY_AUTH_V1217|1a90b039-5363-483f-a145-435aeb56cfcd',
  REPLAY_KEY:'QBO_PHASE_G_V1215_REPLAY_STATE',REPLAY_RUN:'PHASE_G_V2_REPLAY|3d2f9b33-9d22-45f4-8074-fa5c9d947c66',
  HIST_RUN:'FINAL_HIST07_V202|2a2db396-f66b-4d89-a902-22f4c9149d36'
});
function startQboStateApplicationV2PhaseGGlobalEqualTimeDiagnosticV1219(){
  const C=QBO_PHASE_G_GLOBAL_TIE_V1219_;qboPhaseG1219DeleteTriggers_();qboPhaseG1219RequireAuthority_();
  const wb=SpreadsheetApp.create('QBO Phase G Global Equal-Time Diagnostic v1.5.219 '+new Date().toISOString());
  const first=wb.getSheets()[0];first.setName(qboPhaseG1219PartName_(0));qboPhaseG1219InitPart_(first);
  for(let i=1;i<C.PARTITIONS;i++){const sh=wb.insertSheet(qboPhaseG1219PartName_(i));qboPhaseG1219InitPart_(sh);}
  const folders=qboObsIndexV175ResolveFolders_(),it=folders.manifests.getFiles();
  const s={version:C.VERSION,status:'BUILDING_GLOBAL_PARTITIONS',runId:'PHASE_G_GLOBAL_TIE_V1219|'+Utilities.getUuid(),workbookId:wb.getId(),manifestCursor:0,manifestCount:C.EXPECTED_MANIFESTS,iteratorToken:it.getContinuationToken(),observationCount:0,admittedCount:0,evidenceExceptionCount:0,blockedCount:0,partitionCursor:0,equalObservedAtGroupCount:0,equalObservedAtObservationCount:0,maxEqualObservedAtGroupSize:0,crossSourceEqualObservedAtGroupCount:0,deleteConflictGroupCount:0,tieCandidateFailureCount:{ObservationId:0,SourceType_SourceRunId_SourceUnitId_PayloadOrdinal_ObservationId:0},sampleEqualObservedAtGroups:[],startedAt:new Date().toISOString(),lastProgressAt:'',completedAt:'',error:'',continuationTriggerId:''};
  PropertiesService.getScriptProperties().setProperty(C.STATE_KEY,JSON.stringify(s));console.log('[PHASE G GLOBAL TIE V1219] | STARTED | '+JSON.stringify(qboPhaseG1219Public_(s)));return qboPhaseG1219Worker_();
}
function recoverQboStateApplicationV2PhaseGGlobalEqualTimeDiagnosticV1221(){
  const C=QBO_PHASE_G_GLOBAL_TIE_V1219_,p=PropertiesService.getScriptProperties(),s=qboPhaseG1219Json_(p.getProperty(C.STATE_KEY));
  if(!s)throw new Error('PHASE_G_V1221_STATE_MISSING');qboPhaseG1219DeleteTriggers_();qboPhaseG1219RequireAuthority_();
  if(s.runId!=='PHASE_G_GLOBAL_TIE_V1219|f8717a54-3a18-476a-8fa0-4f27a8c03f92')throw new Error('PHASE_G_V1221_RUN_ID_NOT_EXACT '+s.runId);
  if(s.status!=='FAILED'||Number(s.manifestCursor)!==1117||Number(s.observationCount)!==264892||Number(s.admittedCount)!==264872||Number(s.evidenceExceptionCount)!==20||Number(s.blockedCount)!==0)throw new Error('PHASE_G_V1221_FAILED_CHECKPOINT_NOT_EXACT');
  const folders=qboObsIndexV175ResolveFolders_(),it=DriveApp.continueFileIterator(String(s.iteratorToken||''));if(!it.hasNext())throw new Error('PHASE_G_V1221_NO_UNCOMMITTED_MANIFEST');
  const mf=it.next(),name=String(mf.getName()||'');if(!/\.manifest\.json$/.test(name))throw new Error('PHASE_G_V1221_UNKNOWN_MANIFEST '+name);
  const base=name.replace(/\.manifest\.json$/,''),sf=qboPhaseG1217Single_(folders.shards,base+'.json'),lf=qboPhaseG1217Single_(folders.lookup,base+'.lookup.json');
  const m=qboObsIndexV192ReadJson_(mf.getId()),body=qboObsIndexV192ReadJson_(sf.getId()),lk=qboObsIndexV192ReadJson_(lf.getId());qboPhaseG1217VerifyTriplet_(m,body,lk,mf,sf,lf);
  const delta=qboPhaseG1220AdmissionCounts_(body.stableBody.records||[]);
  // Cursor 1117 and its counters are already the durable committed state. The iterator token
  // points to manifest 1118. Only rows from that single uncommitted manifest can be torn.
  // Clean those rows idempotently; do NOT alter committed counters.
  const removed=qboPhaseG1220RemoveManifestRows_(s.workbookId,body.stableBody.records||[]);
  s.version=C.VERSION;s.status='BUILDING_GLOBAL_PARTITIONS';s.error='';s.continuationTriggerId='';s.inFlightManifestBase='';s.inFlightObservationCount=0;s.lastProgressAt=new Date().toISOString();
  p.setProperty(C.STATE_KEY,JSON.stringify(s));console.log('[PHASE G GLOBAL TIE V1221] | RECOVERED | '+JSON.stringify(Object.assign(qboPhaseG1219Public_(s),{recoveredUncommittedManifest:base,uncommittedManifestObservationCount:delta.total,removedPartialRows:removed,committedCountersPreserved:true})));return qboPhaseG1219Worker_();
}
function qboPhaseGGlobalEqualTimeV1219Continuation_(){qboPhaseG1219DeleteTriggers_();return qboPhaseG1219Worker_();}
function qboPhaseG1219Worker_(){
  const C=QBO_PHASE_G_GLOBAL_TIE_V1219_,p=PropertiesService.getScriptProperties(),s=qboPhaseG1219Json_(p.getProperty(C.STATE_KEY));if(!s)throw new Error('PHASE_G_V1219_STATE_MISSING');qboPhaseG1219RequireAuthority_();
  try{
    if(s.status==='BUILDING_GLOBAL_PARTITIONS')return qboPhaseG1219Build_(s,p);
    if(s.status==='SCANNING_GLOBAL_PARTITIONS')return qboPhaseG1219Scan_(s,p);
    throw new Error('PHASE_G_V1219_NOT_RUNNING '+s.status);
  }catch(e){s.status='FAILED';s.error=String(e&&e.message?e.message:e);s.lastProgressAt=new Date().toISOString();p.setProperty(C.STATE_KEY,JSON.stringify(s));console.log('[PHASE G GLOBAL TIE V1220] | FAILED | '+JSON.stringify(qboPhaseG1219Public_(s)));throw e;}
}
function qboPhaseG1219Build_(s,p){
  const C=QBO_PHASE_G_GLOBAL_TIE_V1219_,started=Date.now(),folders=qboObsIndexV175ResolveFolders_(),it=DriveApp.continueFileIterator(String(s.iteratorToken||'')),wb=SpreadsheetApp.openById(s.workbookId);let n=0;
  while(it.hasNext()&&n<C.MAX_MANIFESTS&&Date.now()-started<C.RUNTIME_MS){
    const mf=it.next(),name=String(mf.getName()||'');if(!/\.manifest\.json$/.test(name))throw new Error('PHASE_G_V1220_UNKNOWN_MANIFEST '+name);
    const base=name.replace(/\.manifest\.json$/,''),sf=qboPhaseG1217Single_(folders.shards,base+'.json'),lf=qboPhaseG1217Single_(folders.lookup,base+'.lookup.json');
    const m=qboObsIndexV192ReadJson_(mf.getId()),body=qboObsIndexV192ReadJson_(sf.getId()),lk=qboObsIndexV192ReadJson_(lf.getId());qboPhaseG1217VerifyTriplet_(m,body,lk,mf,sf,lf);
    const records=body.stableBody.records||[],delta=qboPhaseG1220AdmissionCounts_(records),buckets={};records.forEach(function(r){
      const ek=String(r.EntityType||'')+'\u001f'+String(r.EntityId||''),b=qboPhaseG1219Hash_(ek)%C.PARTITIONS;(buckets[b]||(buckets[b]=[])).push([String(r.EntityType||''),String(r.EntityId||''),String(r.ObservedAt||''),String(r.ObservationId||''),String(r.SourceType||''),String(r.SourceRunId||''),String(r.SourceUnitId||''),String(r.PayloadOrdinal||''),String(r.SourceOperation||''),String(r.AdmissionStatus||'')]);
    });
    s.inFlightManifestBase=base;s.inFlightObservationCount=delta.total;p.setProperty(C.STATE_KEY,JSON.stringify(s));
    try{
      // Idempotence barrier: if a prior attempt tore after writing only some partition sheets,
      // remove this manifest's ObservationIds before appending the complete manifest again.
      qboPhaseG1220RemoveManifestRows_(s.workbookId,records,wb);
      Object.keys(buckets).forEach(function(k){const shx=wb.getSheetByName(qboPhaseG1219PartName_(Number(k))),rows=buckets[k];shx.getRange(shx.getLastRow()+1,1,rows.length,10).setValues(rows);});SpreadsheetApp.flush();
    }catch(e){
      s.inFlightManifestBase=base;s.error='TRANSIENT_OR_WRITE_FAILURE '+String(e&&e.message?e.message:e);s.lastProgressAt=new Date().toISOString();p.setProperty(C.STATE_KEY,JSON.stringify(s));
      if(qboPhaseG1220IsTransientServiceError_(e)){qboPhaseG1219Schedule_(s,p);console.log('[PHASE G GLOBAL TIE V1220] | RETRY_SCHEDULED | '+JSON.stringify(Object.assign(qboPhaseG1219Public_(s),{uncommittedManifest:base})));return qboPhaseG1219Public_(s);}throw e;
    }
    s.observationCount+=delta.total;s.admittedCount+=delta.admitted;s.evidenceExceptionCount+=delta.exception;s.blockedCount+=delta.blocked;s.manifestCursor++;n++;s.iteratorToken=it.getContinuationToken();s.inFlightManifestBase='';s.inFlightObservationCount=0;s.error='';s.lastProgressAt=new Date().toISOString();p.setProperty(C.STATE_KEY,JSON.stringify(s));
  }
  if(!it.hasNext()){
    if(s.manifestCursor!==C.EXPECTED_MANIFESTS||s.observationCount!==C.EXPECTED_LOGICAL||s.admittedCount!==C.EXPECTED_ADMITTED||s.evidenceExceptionCount!==C.EXPECTED_EXCEPTION||s.blockedCount!==C.EXPECTED_BLOCKED)throw new Error('PHASE_G_V1220_BUILD_RECONCILIATION');
    s.status='SCANNING_GLOBAL_PARTITIONS';s.partitionCursor=0;s.iteratorToken='';s.lastProgressAt=new Date().toISOString();p.setProperty(C.STATE_KEY,JSON.stringify(s));qboPhaseG1219Schedule_(s,p);console.log('[PHASE G GLOBAL TIE V1220] | PARTITIONS_BUILT | '+JSON.stringify(qboPhaseG1219Public_(s)));return qboPhaseG1219Public_(s);
  }
  qboPhaseG1219Schedule_(s,p);console.log('[PHASE G GLOBAL TIE V1220] | BUILD_PROGRESS | '+JSON.stringify(Object.assign(qboPhaseG1219Public_(s),{invocationManifests:n})));return qboPhaseG1219Public_(s);
}
function qboPhaseG1220AdmissionCounts_(records){const d={total:0,admitted:0,exception:0,blocked:0};(records||[]).forEach(function(r){d.total++;const a=String(r.AdmissionStatus||'');if(a==='ADMITTED')d.admitted++;else if(a==='EVIDENCE_EXCEPTION')d.exception++;else if(a==='BLOCKED')d.blocked++;else throw new Error('PHASE_G_V1220_ADMISSION '+a);});return d;}
function qboPhaseG1220RemoveManifestRows_(workbookId,records,wbOpt){
  const C=QBO_PHASE_G_GLOBAL_TIE_V1219_,byPart={};(records||[]).forEach(function(r){const ek=String(r.EntityType||'')+'\u001f'+String(r.EntityId||''),b=qboPhaseG1219Hash_(ek)%C.PARTITIONS;(byPart[b]||(byPart[b]={}))[String(r.ObservationId||'')]=true;});
  const wb=wbOpt||SpreadsheetApp.openById(workbookId);let removed=0;
  Object.keys(byPart).forEach(function(k){const sh=wb.getSheetByName(qboPhaseG1219PartName_(Number(k))),lr=sh.getLastRow();if(lr<=1)return;const vals=sh.getRange(2,1,lr-1,10).getValues(),ids=byPart[k],keep=[];vals.forEach(function(row){if(ids[String(row[3]||'')])removed++;else keep.push(row);});if(keep.length!==vals.length){sh.getRange(2,1,lr-1,10).clearContent();if(keep.length)sh.getRange(2,1,keep.length,10).setValues(keep);}});SpreadsheetApp.flush();return removed;
}
function qboPhaseG1220IsTransientServiceError_(e){const m=String(e&&e.message?e.message:e);return /Service (?:Spreadsheets|error: Drive)|Service error: Drive|Spreadsheet service|Service invoked too many times|Internal error|timed out|Timeout/i.test(m);}
function qboPhaseG1219Scan_(s,p){
  const C=QBO_PHASE_G_GLOBAL_TIE_V1219_,started=Date.now(),wb=SpreadsheetApp.openById(s.workbookId);let n=0;
  while(s.partitionCursor<C.PARTITIONS&&Date.now()-started<C.RUNTIME_MS){
    const sh=wb.getSheetByName(qboPhaseG1219PartName_(s.partitionCursor)),lr=sh.getLastRow(),rows=lr>1?sh.getRange(2,1,lr-1,10).getValues():[];
    rows.sort(function(a,b){for(const i of [0,1,2,3]){const x=String(a[i]),y=String(b[i]);if(x<y)return -1;if(x>y)return 1;}return 0;});
    let i=0;while(i<rows.length){let j=i+1;while(j<rows.length&&String(rows[j][0])===String(rows[i][0])&&String(rows[j][1])===String(rows[i][1])&&String(rows[j][2])===String(rows[i][2]))j++;if(j-i>1)qboPhaseG1219Tie_(s,rows.slice(i,j));i=j;}
    s.partitionCursor++;n++;s.lastProgressAt=new Date().toISOString();p.setProperty(C.STATE_KEY,JSON.stringify(s));
  }
  if(s.partitionCursor>=C.PARTITIONS)return qboPhaseG1219Complete_(s,p);
  qboPhaseG1219Schedule_(s,p);console.log('[PHASE G GLOBAL TIE V1219] | SCAN_PROGRESS | '+JSON.stringify(Object.assign(qboPhaseG1219Public_(s),{invocationPartitions:n})));return qboPhaseG1219Public_(s);
}
function qboPhaseG1219Tie_(s,g){
  s.equalObservedAtGroupCount++;s.equalObservedAtObservationCount+=g.length;s.maxEqualObservedAtGroupSize=Math.max(s.maxEqualObservedAtGroupSize,g.length);
  const ids={},compound={},sources={},ops={};g.forEach(function(r){ids[String(r[3])]=true;compound[[r[4],r[5],r[6],r[7],r[3]].map(String).join('|')]=true;sources[String(r[4])]=true;ops[String(r[8])]=true;});
  if(Object.keys(ids).length!==g.length)s.tieCandidateFailureCount.ObservationId++;if(Object.keys(compound).length!==g.length)s.tieCandidateFailureCount.SourceType_SourceRunId_SourceUnitId_PayloadOrdinal_ObservationId++;
  if(Object.keys(sources).length>1)s.crossSourceEqualObservedAtGroupCount++;if(Object.keys(ops).some(x=>/delete/i.test(x))&&Object.keys(ops).some(x=>!/delete/i.test(x)))s.deleteConflictGroupCount++;
  if(s.sampleEqualObservedAtGroups.length<30)s.sampleEqualObservedAtGroups.push({entityType:String(g[0][0]),entityId:String(g[0][1]),observedAt:String(g[0][2]),size:g.length,sourceTypes:g.map(r=>String(r[4])),sourceOperations:g.map(r=>String(r[8])),admissionStatuses:g.map(r=>String(r[9])),observationIds:g.slice(0,8).map(r=>String(r[3]))});
}
function qboPhaseG1219Complete_(s,p){qboPhaseG1219DeleteTriggers_();s.status='COMPLETE_GLOBAL_EQUAL_TIME_DIAGNOSTIC';s.completedAt=new Date().toISOString();s.continuationTriggerId='';p.setProperty(QBO_PHASE_G_GLOBAL_TIE_V1219_.STATE_KEY,JSON.stringify(s));const out=Object.assign(qboPhaseG1219Public_(s),{analysisScope:'GLOBAL_ACROSS_ALL_CERTIFIED_OBSERVATION_INDEX_SHARDS',partitionKey:['EntityType','EntityId'],primaryChronologyField:'ObservedAt',globalEqualObservedAtCertification:true,replayAuthorized:false,replayWorkerEnabled:false,nextAction:s.equalObservedAtGroupCount?'CLASSIFY_GLOBAL_EQUAL_TIME_GROUPS_AND_LOCK_PRECEDENCE':'LOCK_UNIQUE_GLOBAL_OBSERVED_AT_ORDER_AND_BUILD_FROZEN_REPLAY_ORDER'});console.log('[PHASE G GLOBAL TIE V1219] | COMPLETE | '+JSON.stringify(out));return out;}
function qboPhaseG1219RequireAuthority_(){
  const C=QBO_PHASE_G_GLOBAL_TIE_V1219_,p=PropertiesService.getScriptProperties(),prior=qboPhaseG1219Json_(p.getProperty(C.PRIOR_KEY)),r=qboPhaseG1219Json_(p.getProperty(C.REPLAY_KEY));
  if(!prior||prior.status!=='COMPLETE_REPLAY_AUTHORITY_DIAGNOSTIC'||prior.runId!==C.PRIOR_RUN||Number(prior.manifestCursor)!==C.EXPECTED_MANIFESTS||Number(prior.observationCount)!==C.EXPECTED_LOGICAL||Number(prior.admittedCount)!==C.EXPECTED_ADMITTED||Number(prior.evidenceExceptionCount)!==C.EXPECTED_EXCEPTION||Number(prior.blockedCount)!==C.EXPECTED_BLOCKED)throw new Error('PHASE_G_V1219_PRIOR_AUTHORITY_NOT_EXACT');
  if(!r||r.status!=='INITIALIZED_REPLAY_DISABLED'||r.runId!==C.REPLAY_RUN||r.historical07RunId!==C.HIST_RUN||r.replayAuthorized!==false||r.replayWorkerEnabled!==false||Number(r.observationCursor)!==0||Number(r.processedObservationCount)!==0)throw new Error('PHASE_G_V1219_REPLAY_STATE_NOT_EXACT');qboPhaseG1217RequireTarget_();
}
function qboPhaseG1219Hash_(v){const d=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(v),Utilities.Charset.UTF_8);return ((d[0]&255)<<24>>>0)+((d[1]&255)<<16)+((d[2]&255)<<8)+(d[3]&255);}
function qboPhaseG1219PartName_(i){return 'P_'+String(i).padStart(2,'0');}
function qboPhaseG1219InitPart_(sh){sh.getRange(1,1,1,10).setValues([['EntityType','EntityId','ObservedAt','ObservationId','SourceType','SourceRunId','SourceUnitId','PayloadOrdinal','SourceOperation','AdmissionStatus']]);sh.setFrozenRows(1);}
function qboPhaseG1219Schedule_(s,p){qboPhaseG1219DeleteTriggers_();const t=ScriptApp.newTrigger(QBO_PHASE_G_GLOBAL_TIE_V1219_.HANDLER).timeBased().after(QBO_PHASE_G_GLOBAL_TIE_V1219_.DELAY_MS).create();s.continuationTriggerId=t.getUniqueId();p.setProperty(QBO_PHASE_G_GLOBAL_TIE_V1219_.STATE_KEY,JSON.stringify(s));}
function qboPhaseG1219DeleteTriggers_(){ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()===QBO_PHASE_G_GLOBAL_TIE_V1219_.HANDLER){try{ScriptApp.deleteTrigger(t);}catch(e){}}});}
function qboPhaseG1219Json_(v){try{return JSON.parse(v||'null');}catch(e){return null;}}
function qboPhaseG1219Public_(s){return{version:s.version,status:s.status,runId:s.runId,workbookId:s.workbookId,manifestCursor:s.manifestCursor,manifestCount:s.manifestCount,observationCount:s.observationCount,admittedCount:s.admittedCount,evidenceExceptionCount:s.evidenceExceptionCount,blockedCount:s.blockedCount,partitionCursor:s.partitionCursor,equalObservedAtGroupCount:s.equalObservedAtGroupCount,equalObservedAtObservationCount:s.equalObservedAtObservationCount,maxEqualObservedAtGroupSize:s.maxEqualObservedAtGroupSize,crossSourceEqualObservedAtGroupCount:s.crossSourceEqualObservedAtGroupCount,deleteConflictGroupCount:s.deleteConflictGroupCount,tieCandidateFailureCount:s.tieCandidateFailureCount,sampleEqualObservedAtGroups:s.sampleEqualObservedAtGroups,startedAt:s.startedAt,lastProgressAt:s.lastProgressAt,completedAt:s.completedAt,error:s.error,continuationTriggerId:s.continuationTriggerId,inFlightManifestBase:s.inFlightManifestBase||'',inFlightObservationCount:Number(s.inFlightObservationCount||0)};}
