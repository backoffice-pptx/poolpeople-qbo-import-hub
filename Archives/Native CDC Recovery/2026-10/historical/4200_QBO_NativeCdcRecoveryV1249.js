/** v1.5.250 — MANUAL, MUTATING recovery of one missing entity per invocation.
 * No triggers, no Phase G writes, no watermark advancement, no ingestion.
 * Run inspect... first, then explicitly run recover... after review.
 */
const QBO_CDC_RECOVERY_V1249_=Object.freeze({
 LEASE:'QBO_NATIVE_CDC_V1249_RECOVERY_LEASE',
 CYCLE:'9c9276b1-70cb-4fb5-930f-bb5e388c5312',
 WATERMARK:'2026-10-11T22:27:37.687Z',
 ENTITIES:['Term','PaymentMethod','Estimate'],
 MAX_LEASE_MS:600000
});
function qboCdcRecoveryV1249Context_(){
 const c=QBO_CDC_RECOVERY_V1249_,p=PropertiesService.getScriptProperties();
 const ptr=JSON.parse(p.getProperty(QBO_CDC_PROSPECTIVE_V1244_.KEY)||'null');
 if(!ptr||ptr.stateFileId!=='17ckU3zeHx02U3FSd8d2p9TnigjVWQDP1')throw Error('V1249_POINTER_CHANGED');
 const ctx=qboCdcProspectiveStateV1244_(),s=ctx.state,a=s.active;
 if(s.enabled!==false||s.status!=='HALTED_REQUIRES_REVIEW'||s.prospectiveWatermark!==c.WATERMARK||
 !a||a.cycleId!==c.CYCLE||a.folderId!=='1LOu-1Tpsb7i7HFWx8JGVBBxmi1N0PiDF'||
 a.cursor!==a.results.length||a.cursor<17||a.cursor>20||a.priorProspectiveWatermark!==s.prospectiveWatermark||
 s.ingestionAuthorized!==false||s.historicalDeletionCoverageCertified!==false)throw Error('V1249_CHECKPOINT_CHANGED');
 if(!qboNativeCdcIsPaused_()||!qboNativeCdcV1233CaptureOnly_())throw Error('V1249_LEGACY_NOT_PAUSED');
 qboCdcProspectiveGuardV1244_();
 const ts=ScriptApp.getProjectTriggers();
 if(ts.some(t=>t.getHandlerFunction()===QBO_CDC_PROSPECTIVE_V1244_.HANDLER))throw Error('V1249_V1244_TRIGGER_ACTIVE');
 const phase=JSON.parse(p.getProperty('QBO_PHASE_G_GLOBAL_TIE_V1219_STATE')||'null');
 if(!phase||phase.status!=='BUILDING_GLOBAL_PARTITIONS'||ts.filter(t=>t.getHandlerFunction()==='qboPhaseGJournaledV1231Continuation_').length!==1)throw Error('V1249_PHASE_G_ISOLATION_CHANGED');
 qboNativeCdcV1233RequireWindow_(a.changedSince);
 for(let i=0;i<a.cursor;i++){
  const r=a.results[i],entity=QBO_CDC_PROSPECTIVE_V1244_.ENTITIES[i];
  if(r.entity!==entity)throw Error('V1249_RESULT_SCOPE_CHANGED');
  const f=DriveApp.getFileById(r.fileId),raw=f.getBlob().getDataAsString('UTF-8');
  const expectedName=i<17?'cdc_'+entity+'.json':'recovery_v1249_cdc_'+entity+'.json';
  if(f.getName()!==expectedName||qboNativeCdcSha256_(raw)!==r.sha256)throw Error('V1249_PRIOR_EVIDENCE_CHANGED '+entity);
  qboCdcProspectiveValidateV1244_(JSON.parse(raw),a,entity);
 }
 const term=qboCdcProspectiveFileV1244_(DriveApp.getFolderById(a.folderId),'cdc_Term.json');
 if(!term||term.getId()!=='1NNSUBGPz02Z2q5L4dXNmI1T8Ee_Jtj_v'||term.getSize()!==0)throw Error('V1249_TERM_ARTIFACT_CHANGED');
 return ctx;
}
function inspectQboNativeCdcRecoveryV1249(){
 const ctx=qboCdcRecoveryV1249Context_(),a=ctx.state.active;
 const out={version:'1.5.250',mode:'READ_ONLY',status:ctx.state.status,cursor:a.cursor,
 nextEntity:a.cursor<20?QBO_CDC_PROSPECTIVE_V1244_.ENTITIES[a.cursor]:null,
 watermark:ctx.state.prospectiveWatermark,phaseGUntouched:true,mutatingFunction:'recoverOneQboNativeCdcEntityV1249',
 limitations:['Original October 11 evidence retained','Recovery queries executed at current time, not an atomic October 11 snapshot',
 'No cycle commit or watermark advancement in V1249']};
 console.log('[NATIVE CDC RECOVERY V1249] | READ_ONLY | '+JSON.stringify(out));return out;
}
function qboCdcRecoveryV1249Lease_(acquire){
 const lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw Error('V1249_SHORT_CONTROL_LOCK_BUSY');
 try{
  const p=PropertiesService.getScriptProperties(),key=QBO_CDC_RECOVERY_V1249_.LEASE;
  if(acquire){
   const old=JSON.parse(p.getProperty(key)||'null');
   if(old&&old.expiresAt>Date.now())throw Error('V1249_RECOVERY_LEASE_BUSY');
   const token=Utilities.getUuid();p.setProperty(key,JSON.stringify({token:token,expiresAt:Date.now()+QBO_CDC_RECOVERY_V1249_.MAX_LEASE_MS}));return token;
  }
 }finally{lock.releaseLock();}
}
function qboCdcRecoveryV1249Release_(token){
 const lock=LockService.getScriptLock();if(!lock.tryLock(1000)){console.log('[V1249] LEASE_RELEASE_DEFERRED');return;}
 try{const p=PropertiesService.getScriptProperties(),key=QBO_CDC_RECOVERY_V1249_.LEASE;
 const v=JSON.parse(p.getProperty(key)||'null');if(v&&v.token===token)p.deleteProperty(key);
 }finally{lock.releaseLock();}
}
function qboCdcRecoveryV1249VerifiedFile_(folder,name,raw){
 const existing=qboCdcProspectiveFileV1244_(folder,name);
 if(existing){
  const data=existing.getBlob().getDataAsString('UTF-8');
  if(data!==raw)throw Error('V1249_EXISTING_RECOVERY_FILE_CONFLICT '+name);
  return existing;
 }
 let lastError='';
 for(let attempt=1;attempt<=3;attempt++){
  let f=qboCdcProspectiveFileV1244_(folder,name);
  if(!f)f=folder.createFile(name,raw,'application/json');
  for(let read=1;read<=3;read++){
   try{if(f.getBlob().getDataAsString('UTF-8')===raw)return f;}catch(err){lastError=String(err);}
   Utilities.sleep(500*read);
  }
  // Do not overwrite or delete a failed evidence file. Halt for inspection.
  throw Error('V1249_RAW_READBACK_FAILED_PRESERVED fileId='+f.getId()+' attempt='+attempt+' '+lastError);
 }
 throw Error('V1249_UNREACHABLE');
}
function recoverOneQboNativeCdcEntityV1249(){
 const token=qboCdcRecoveryV1249Lease_(true);
 try{
  const ctx=qboCdcRecoveryV1249Context_(),s=ctx.state,a=s.active;
  if(a.cursor===20)throw Error('V1249_ALL_ENTITIES_COMPLETE_USE_SEPARATE_COMMIT_REVIEW');
  const entity=QBO_CDC_PROSPECTIVE_V1244_.ENTITIES[a.cursor];
  if(QBO_CDC_RECOVERY_V1249_.ENTITIES.indexOf(entity)<0)throw Error('V1249_ENTITY_NOT_IN_RECOVERY_SCOPE');
  const folder=DriveApp.getFolderById(a.folderId),name='recovery_v1249_cdc_'+entity+'.json';
  let f=qboCdcProspectiveFileV1244_(folder,name),e,raw;
  if(f){raw=f.getBlob().getDataAsString('UTF-8');if(!raw)throw Error('V1249_RECOVERY_ARTIFACT_EMPTY fileId='+f.getId());e=JSON.parse(raw);}
  else{
   const requestStartedAt=new Date().toISOString(),response=qboNativeCdcRequestEntity_(entity,new Date(a.changedSince),getConfig_().minorVersion);
   e={version:'1.5.244',purpose:'PROSPECTIVE_CAPTURE_ONLY_WITH_HISTORICAL_GAP',cycleId:a.cycleId,
      entity:entity,changedSince:a.changedSince,requestStartedAt:requestStartedAt,
      requestCompletedAt:new Date().toISOString(),response:response,
      recovery:{version:'1.5.250',reason:'V1244_RAW_READBACK_FAILED',originalCycleWindowEnd:a.windowEnd,
       lateAcquisition:true,originalFailedTermFileId:'1NNSUBGPz02Z2q5L4dXNmI1T8Ee_Jtj_v'}};
   raw=JSON.stringify(e,null,2);
   f=qboCdcRecoveryV1249VerifiedFile_(folder,name,raw);
  }
  const r=qboCdcProspectiveValidateV1244_(e,a,entity);r.fileId=f.getId();r.sha256=qboNativeCdcSha256_(raw);
  // Recheck checkpoint immediately before appending; never write if another worker advanced it.
  const fresh=qboCdcRecoveryV1249Context_();
  if(fresh.state.active.cursor!==a.cursor)throw Error('V1249_CONCURRENT_CURSOR_CHANGED');
  fresh.state.active.results.push(r);fresh.state.active.cursor++;
  fresh.state.error='V1249_RECOVERY_IN_PROGRESS_REVIEW_REQUIRED';
  qboCdcProspectiveWriteV1244_(fresh.file,fresh.state);
  const result={version:'1.5.250',action:'ENTITY_RECOVERED_CHECKPOINTED',entity:entity,cursor:fresh.state.active.cursor,
   fileId:f.getId(),sha256:r.sha256,watermarkUnchanged:fresh.state.prospectiveWatermark,
   phaseGUntouched:true,cycleNotCommitted:true,ingestionAuthorized:false};
  console.log('[NATIVE CDC RECOVERY V1249] | '+JSON.stringify(result));return result;
 }finally{qboCdcRecoveryV1249Release_(token);}
}
