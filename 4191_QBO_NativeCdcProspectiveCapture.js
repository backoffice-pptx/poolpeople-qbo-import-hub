/** v1.5.244. Isolated prospective evidence capture; no ingestion or historical watermark writes. */
const QBO_CDC_PROSPECTIVE_V1244_ = Object.freeze({
 KEY:'QBO_NATIVE_CDC_PROSPECTIVE_V1244_POINTER', CONTROL:'QBO_NATIVE_CDC_PROSPECTIVE_V1244_ADMIN_CONTROL_V1350', HALT:'QBO_NATIVE_CDC_PROSPECTIVE_V1244_HALT_V1350', HANDLER:'runQboNativeCdcProspectiveCaptureV1244',
 REVIEW:'1sMpUDxYwb7iMP4X0clBfk05-AQw-F1bT', HASH:'e9eceb169789465c7fa4d0242764851c744cef4044405090dff10ea469acb331',
 ANCHOR:'2026-10-09T16:47:05.794Z', HISTORICAL:'2026-09-14T10:38:54.152Z',
 ENTITIES:['Invoice','Payment','TaxCode','CreditMemo','Bill','BillPayment','Purchase','Deposit','JournalEntry','SalesReceipt','RefundReceipt','Customer','Vendor','Item','Account','Class','Department','Term','PaymentMethod','Estimate']
});
function qboCdcProspectiveGuardV1244_(){
 const c=QBO_CDC_PROSPECTIVE_V1244_,cfg=QBO_NATIVE_CDC_PRODUCTION,p=PropertiesService.getScriptProperties(),s=qboNativeCdcReadState_();
 if(!qboNativeCdcIsPaused_()||!qboNativeCdcV1233CaptureOnly_()||p.getProperty(cfg.WATERMARK_PROPERTY_KEY)!==c.HISTORICAL||!s||s.cycleId!=='20261009T1630Z|71b42ef0-3f3e-4648-a540-918a0c2d4668'||s.status!=='FAILED'||s.watermarkCommitted||s.manifestFileId!=='1aHjFuyh2cxNDpgJgyjHK3YMoAv7e1U_A')throw Error('V1244_HISTORICAL_BOUNDARY_CHANGED');
 if(JSON.stringify(cfg.ENTITIES)!==JSON.stringify(c.ENTITIES)||qboNativeCdcReadIngestionHandoffQueue_().length!==3)throw Error('V1244_SCOPE_OR_HANDOFF_CHANGED');
 const r=JSON.parse(p.getProperty('QBO_PHASE_G_V1215_REPLAY_STATE')||'null');
 if(!r||r.replayAuthorized!==false||r.replayWorkerEnabled!==false)throw Error('V1244_REPLAY_NOT_DISABLED');
 const lease=JSON.parse(p.getProperty(QBO_NATIVE_CDC_FORWARD_INGESTION_.PIPELINE_LEASE_PROPERTY_KEY)||'null');
 if(lease&&Number(lease.expiresAtMs||0)>Date.now())throw Error('V1244_INGESTION_LEASE_ACTIVE');
 if(ScriptApp.getProjectTriggers().some(t=>[cfg.TRIGGER_HANDLERS.START,cfg.TRIGGER_HANDLERS.NEXT].indexOf(t.getHandlerFunction())>=0||/dispatch.*Ingestion|runNext.*Ingestion|StateApplication|CanonicalV2Rebuild|watchQboCanonicalV2Rebuild/i.test(t.getHandlerFunction())))throw Error('V1244_UNSAFE_TRIGGER_ACTIVE');
 return s;
}
function qboCdcProspectiveFileV1244_(folder,name){const it=folder.getFilesByName(name);if(!it.hasNext())return null;const f=it.next();if(it.hasNext())throw Error('V1244_DUPLICATE_FILE '+name);return f;}
function qboCdcProspectiveReadV1244_(id){return JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8'));}
/** V1350: immutable checkpoint generations; original V1344 pointer remains authoritative. */
function qboCdcProspectiveAdminV1350_(requireRunning){
 const c=QBO_CDC_PROSPECTIVE_V1244_,p=PropertiesService.getScriptProperties();
 if(p.getProperty(c.HALT))throw Error('V1350_INDEPENDENT_HALT_REQUIRES_REVIEW');
 const raw=p.getProperty(c.CONTROL);
 if(raw!=='PAUSED'&&raw!=='RUNNING')throw Error('V1350_ADMIN_CONTROL_UNSET_OR_INVALID');
 if(requireRunning&&raw!=='RUNNING')throw Error('V1350_ADMIN_PAUSED');
 return raw;
}
function qboCdcProspectiveWriteV1244_(unusedFile,value){
 const c=QBO_CDC_PROSPECTIVE_V1244_,p=PropertiesService.getScriptProperties(),ptrRaw=p.getProperty(c.KEY);
 if(!ptrRaw)throw Error('V1350_POINTER_MISSING');
 const ptr=JSON.parse(ptrRaw),folder=DriveApp.getFolderById(ptr.folderId);
 const current=DriveApp.getFileById(ptr.stateFileId);
 if(unusedFile&&unusedFile.getId()!==current.getId())throw Error('V1350_STALE_CHECKPOINT_WRITER');
 const raw=JSON.stringify(value,null,2),name='checkpoint_v1350_'+Utilities.getUuid()+'.json';
 const fresh=folder.createFile(name,raw,'application/json');
 if(fresh.getBlob().getDataAsString('UTF-8')!==raw||JSON.stringify(JSON.parse(fresh.getBlob().getDataAsString('UTF-8')))!==JSON.stringify(value))throw Error('V1350_CHECKPOINT_READBACK_FAILED');
 if(p.getProperty(c.KEY)!==ptrRaw)throw Error('V1351_POINTER_RACE_ORPHAN_GENERATION');
 // Fencing check immediately before pointer publication. Script lock serializes workers,
 // while the administrative PAUSE property may be changed without taking that lock.
 if(p.getProperty(c.CONTROL)!=='RUNNING')throw Error('V1351_ADMIN_FENCE_BLOCKS_POINTER_COMMIT');
 if(p.getProperty(c.HALT))throw Error('V1351_HALT_FENCE_BLOCKS_POINTER_COMMIT');
 p.setProperty(c.KEY,JSON.stringify({folderId:ptr.folderId,stateFileId:fresh.getId()}));
 const verified=JSON.parse(p.getProperty(c.KEY));
 if(verified.stateFileId!==fresh.getId()||verified.folderId!==ptr.folderId)throw Error('V1350_POINTER_READBACK_FAILED');
 return fresh;
}
function qboCdcProspectiveHaltV1350_(reason){
 const c=QBO_CDC_PROSPECTIVE_V1244_;PropertiesService.getScriptProperties().setProperty(c.HALT,String(reason).slice(0,400));
 qboCdcProspectiveRemoveTriggerV1244_();
}
function qboCdcProspectiveRemoveTriggerV1244_(){ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()===QBO_CDC_PROSPECTIVE_V1244_.HANDLER).forEach(t=>ScriptApp.deleteTrigger(t));}
function qboCdcProspectiveStateV1244_(){
 const c=QBO_CDC_PROSPECTIVE_V1244_,ptr=JSON.parse(PropertiesService.getScriptProperties().getProperty(c.KEY)||'null');if(!ptr)throw Error('V1244_NOT_ACTIVATED');
 const file=DriveApp.getFileById(ptr.stateFileId),s=JSON.parse(file.getBlob().getDataAsString('UTF-8'));
 if(s.version!=='1.5.244'||s.reviewSha256!==c.HASH||s.initialAnchor!==c.ANCHOR||s.historicalWatermark!==c.HISTORICAL||s.ingestionAuthorized!==false||s.historicalDeletionCoverageCertified!==false||s.folderId!==ptr.folderId)throw Error('V1244_CHECKPOINT_IDENTITY_INVALID');
 return {file:file,state:s,folder:DriveApp.getFolderById(ptr.folderId)};
}
/** V1350 activation is a safe initialization/preflight only; it NEVER resumes capture. */
function activateQboNativeCdcProspectiveCaptureV1244(){
 const lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw Error('V1350_CONTROL_BUSY');
 try{
  const c=QBO_CDC_PROSPECTIVE_V1244_,p=PropertiesService.getScriptProperties();
  p.setProperty(c.CONTROL,'PAUSED');qboCdcProspectiveRemoveTriggerV1244_();
  qboCdcProspectiveGuardV1244_();
  if(!p.getProperty(c.KEY))throw Error('V1350_MISSING_RECOVERED_POINTER_USE_SEPARATE_REVIEWED_INITIALIZATION');
  const ctx=qboCdcProspectiveStateV1244_();
  return {action:'PAUSED_PREFLIGHT_ONLY',stateFileId:ctx.file.getId(),prospectiveWatermark:ctx.state.prospectiveWatermark};
 }finally{lock.releaseLock();}
}
/** Read-only preflight; never authorizes resumption. */
function previewQboNativeCdcProspectiveMigrationV1350(){
 const c=QBO_CDC_PROSPECTIVE_V1244_,p=PropertiesService.getScriptProperties(),ctx=qboCdcProspectiveStateV1244_();
 return {version:'1.5.350',mode:'READ_ONLY',control:p.getProperty(c.CONTROL)||'UNSET_FAIL_CLOSED',haltPresent:!!p.getProperty(c.HALT),stateFileId:ctx.file.getId(),prospectiveWatermark:ctx.state.prospectiveWatermark,active:!!ctx.state.active,enabled:ctx.state.enabled,triggers:ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()===c.HANDLER).length,ingestionAuthorized:false};
}
/** Explicitly gated cutover. Must not be invoked before separately approved Step 7B. */
function resumeQboNativeCdcProspectiveCaptureV1350(expectedProspectiveWatermark){
 if(!expectedProspectiveWatermark||!Number.isFinite(Date.parse(expectedProspectiveWatermark)))throw Error("CDC_EXPECTED_WATERMARK_REQUIRED");
 const lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw Error('V1350_CONTROL_BUSY');
 try{
  const c=QBO_CDC_PROSPECTIVE_V1244_,p=PropertiesService.getScriptProperties();
  if(p.getProperty(c.CONTROL)!=='PAUSED'||p.getProperty(c.HALT))throw Error('V1350_NOT_CLEANLY_PAUSED');
  qboCdcProspectiveGuardV1244_();const ctx=qboCdcProspectiveStateV1244_();
  if(ctx.state.active||ctx.state.enabled||ctx.state.prospectiveWatermark!==expectedProspectiveWatermark)throw Error('V1350_CUTOVER_STATE_NOT_VERIFIED');
  if(ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()===c.HANDLER))throw Error('V1350_EXISTING_WORKER_TRIGGER');
  const s=JSON.parse(JSON.stringify(ctx.state));s.enabled=true;s.status='READY';
  // V1352: under script lock, enable control before checkpoint publication;
  // fail closed on any incomplete restart, without creating a second worker.
  // V1353: create the worker trigger while the independent control remains PAUSED.
  // Even if the trigger fires immediately, the worker must reject PAUSED before writes.
  // Do not publish enabled=true until trigger creation has succeeded.
  try{
   ScriptApp.newTrigger(c.HANDLER).timeBased().everyMinutes(5).create();
   const matching=ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()===c.HANDLER);
   if(matching.length!==1)throw Error('V1353_TRIGGER_NOT_UNIQUE');
   p.setProperty(c.CONTROL,'RUNNING');
   qboCdcProspectiveWriteV1244_(ctx.file,s);
  }catch(e){
   p.setProperty(c.CONTROL,'PAUSED');
   p.setProperty(c.HALT,'V1353_RESUME_INCOMPLETE: '+String(e.message||e).slice(0,300));
   try{qboCdcProspectiveRemoveTriggerV1244_();}catch(cleanupError){console.log('[NATIVE CDC V1353] | TRIGGER_CLEANUP_FAILED | '+String(cleanupError));}
   throw e;
  }
  return {action:'RESUMED_FOR_CAPTURE_ONLY',prospectiveWatermark:s.prospectiveWatermark,ingestionAuthorized:false};
 }finally{lock.releaseLock();}
}
function qboCdcProspectiveValidateV1244_(e,a,entity){
 if(!e||e.version!=='1.5.244'||e.cycleId!==a.cycleId||e.entity!==entity||e.changedSince!==a.changedSince||Date.parse(e.requestStartedAt)<Date.parse(a.windowEnd)||!Number.isFinite(Date.parse(e.requestCompletedAt)))throw Error('V1244_EVIDENCE_IDENTITY_INVALID '+entity);
 qboNativeCdcV1233RequireResponse_(e.response,entity);
 const rows=qboNativeCdcProductionExtractEntities_(e.response,entity),ids={};
 rows.forEach(r=>{if(!r||typeof r!=='object'||!r.Id||ids[String(r.Id)])throw Error('V1244_INVALID_OR_DUPLICATE_ID '+entity);ids[String(r.Id)]=true;});
 return {entity:entity,returnedRows:rows.length,deletedRows:rows.filter(r=>String(r.status||'').toLowerCase()==='deleted').length};
}
function runQboNativeCdcProspectiveCaptureV1244(){
 const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {action:'BUSY_RETRY_NEXT_TICK'};let ctx;
 try{
  qboCdcProspectiveAdminV1350_(true);ctx=qboCdcProspectiveStateV1244_();const s=ctx.state,c=QBO_CDC_PROSPECTIVE_V1244_;if(!s.enabled)return {action:'PAUSED'};qboCdcProspectiveGuardV1244_();
  if(!s.active){
   if(s.lastCommitted&&Date.now()-Date.parse(s.lastCommitted.windowEnd)<1800000)return {action:'WAIT_NEXT_CYCLE'};
   const end=new Date().toISOString(),since=new Date(Date.parse(s.prospectiveWatermark)-900000).toISOString();qboNativeCdcV1233RequireWindow_(since);
   const id=Utilities.getUuid(),acquisitionStartedAt=end,parent=qboNativeCdcResolveRunParentFolder_(new Date(acquisitionStartedAt)),folder=parent.createFolder('QBO_Native_CDC_Cycle_'+acquisitionStartedAt.replace(/[:.]/g,'_')+'_'+id);
   s.active={cycleId:id,acquisitionStartedAt:acquisitionStartedAt,folderId:folder.getId(),priorProspectiveWatermark:s.prospectiveWatermark,changedSince:since,windowEnd:end,cursor:0,results:[]};s.status='CAPTURING';ctx.file=qboCdcProspectiveWriteV1244_(ctx.file,s);
  }
  const a=s.active;if(!Number.isInteger(a.cursor)||a.cursor!==a.results.length||a.cursor<0||a.cursor>20||a.priorProspectiveWatermark!==s.prospectiveWatermark)throw Error('V1244_INVALID_ACTIVE_CURSOR');
  const folder=DriveApp.getFolderById(a.folderId),started=Date.now();let n=0;
  while(a.cursor<20&&n<5&&Date.now()-started<150000){
   qboCdcProspectiveAdminV1350_(true);qboCdcProspectiveGuardV1244_();const entity=c.ENTITIES[a.cursor],name='cdc_'+entity+'.json';let f=qboCdcProspectiveFileV1244_(folder,name),e;
   if(f)e=JSON.parse(f.getBlob().getDataAsString('UTF-8'));
   else{
    qboNativeCdcV1233RequireWindow_(a.changedSince);const requestStartedAt=new Date().toISOString(),response=qboNativeCdcRequestEntity_(entity,new Date(a.changedSince),getConfig_().minorVersion);
    e={version:'1.5.244',purpose:'PROSPECTIVE_CAPTURE_ONLY_WITH_HISTORICAL_GAP',cycleId:a.cycleId,entity:entity,changedSince:a.changedSince,requestStartedAt:requestStartedAt,requestCompletedAt:new Date().toISOString(),response:response};
    const raw=JSON.stringify(e,null,2);f=folder.createFile(name,raw,'application/json');if(f.getBlob().getDataAsString('UTF-8')!==raw)throw Error('V1244_RAW_READBACK_FAILED');
   }
   const result=qboCdcProspectiveValidateV1244_(e,a,entity);result.fileId=f.getId();result.sha256=qboNativeCdcSha256_(f.getBlob().getDataAsString('UTF-8'));
   a.results.push(result);a.cursor++;ctx.file=qboCdcProspectiveWriteV1244_(ctx.file,s);n++;
   console.log('[NATIVE CDC PROSPECTIVE V1244] | ENTITY_SAVED | '+JSON.stringify(result));
  }
  if(a.cursor===20){
   qboCdcProspectiveAdminV1350_(true);qboCdcProspectiveGuardV1244_();a.results.forEach((r,i)=>{if(r.entity!==c.ENTITIES[i])throw Error('V1244_MANIFEST_SCOPE_INVALID');const raw=DriveApp.getFileById(r.fileId).getBlob().getDataAsString('UTF-8');if(qboNativeCdcSha256_(raw)!==r.sha256)throw Error('V1244_EVIDENCE_CHANGED');qboCdcProspectiveValidateV1244_(JSON.parse(raw),a,r.entity);});
   const manifest={version:'1.5.244',status:'PROSPECTIVE_CAPTURE_COMMITTED_WITH_HISTORICAL_GAP',cycleId:a.cycleId,changedSince:a.changedSince,windowEnd:a.windowEnd,priorProspectiveWatermark:a.priorProspectiveWatermark,entities:a.results,reviewFileId:c.REVIEW,reviewSha256:c.HASH,historicalWatermark:c.HISTORICAL,historicalDeletionCoverageCertified:false,ingestionAuthorized:false,limitations:['CDC preserves returned states and tombstones, not every intermediate revision.','Responses are acquired at different times; no common atomic snapshot is certified.','Historical Purchase deletion gap remains unresolved.']};
   let f=qboCdcProspectiveFileV1244_(folder,'manifest.json');const raw=JSON.stringify(manifest,null,2);if(!f)f=folder.createFile('manifest.json',raw,'application/json');if(f.getBlob().getDataAsString('UTF-8')!==raw)throw Error('V1244_MANIFEST_NOT_EXACT');
   s.lastCommitted={cycleId:a.cycleId,manifestFileId:f.getId(),manifestSha256:qboNativeCdcSha256_(raw),windowEnd:a.windowEnd};s.prospectiveWatermark=a.windowEnd;s.anchorIsCommittedCoverage=true;s.active=null;s.status='READY';ctx.file=qboCdcProspectiveWriteV1244_(ctx.file,s);
   console.log('[NATIVE CDC PROSPECTIVE V1244] | CYCLE_COMMITTED | '+JSON.stringify(s.lastCommitted));
  }
  const out={version:'1.5.244',status:s.status,entityCursor:s.active?s.active.cursor:20,prospectiveWatermark:s.prospectiveWatermark,historicalWatermark:c.HISTORICAL,historicalDeletionCoverageCertified:false,ingestionAuthorized:false};console.log('[NATIVE CDC PROSPECTIVE V1244] | PROGRESS | '+JSON.stringify(out));return out;
 }catch(error){
  try{qboCdcProspectiveHaltV1350_(String(error.message||error));}catch(haltError){console.log('[NATIVE CDC V1350] | HALT_CONTROL_ERROR | '+String(haltError));}
  // HALT is independent and authoritative. Preserve last good checkpoint pointer for review.
  // Do not write a checkpoint while HALT fence is active.
  qboCdcProspectiveRemoveTriggerV1244_();console.log('[NATIVE CDC PROSPECTIVE V1244] | HALTED | '+String(error.message||error));throw error;
 }finally{lock.releaseLock();}
}
/** V1355: pause completion is linearized against worker pointer publication by ScriptLock.
 * A busy lock is an incomplete pause, never a claim that quiescence was reached. */
function pauseQboNativeCdcProspectiveCaptureV1244(){
 const c=QBO_CDC_PROSPECTIVE_V1244_,p=PropertiesService.getScriptProperties();
 const lock=LockService.getScriptLock();
 if(!lock.tryLock(30000)){
  // Request fail-closed pause for the active worker's next fence. This is NOT
  // proof of quiescence: the worker may already be publishing its pointer.
  p.setProperty(c.CONTROL,'PAUSED');
  throw Error('V1355_PAUSE_PENDING_WORKER_LOCK_BUSY_NOT_QUIESCED');
 }
 try{
  p.setProperty(c.CONTROL,'PAUSED');
  if(p.getProperty(c.CONTROL)!=='PAUSED')throw Error('V1355_PAUSE_READBACK_FAILED');
  qboCdcProspectiveRemoveTriggerV1244_();
  const remaining=ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()===c.HANDLER);
  if(remaining.length)throw Error('V1355_PAUSE_TRIGGER_CLEANUP_INCOMPLETE');
  let checkpointReadable=true;
  try{qboCdcProspectiveStateV1244_();}
  catch(e){checkpointReadable=false;console.log('[NATIVE CDC V1355] | PAUSED_CHECKPOINT_UNAVAILABLE | '+String(e));}
  return {action:'PAUSED_QUIESCED',control:'PAUSED',captureDisabled:true,workerLockHeld:true,triggers:0,checkpointReadable:checkpointReadable};
 }finally{lock.releaseLock();}
}
function inspectQboNativeCdcProspectiveCaptureV1244(){const ctx=qboCdcProspectiveStateV1244_(),s=ctx.state,c=QBO_CDC_PROSPECTIVE_V1244_;const out={version:s.version,adminControl:PropertiesService.getScriptProperties().getProperty(c.CONTROL)||'UNSET_FAIL_CLOSED',haltPresent:!!PropertiesService.getScriptProperties().getProperty(c.HALT),status:s.status,enabled:s.enabled,prospectiveWatermark:s.prospectiveWatermark,anchorIsCommittedCoverage:s.anchorIsCommittedCoverage,historicalWatermark:PropertiesService.getScriptProperties().getProperty(QBO_NATIVE_CDC_PRODUCTION.WATERMARK_PROPERTY_KEY),legacyProductionPaused:qboNativeCdcIsPaused_(),activeCycle:s.active?{cycleId:s.active.cycleId,changedSince:s.active.changedSince,windowEnd:s.active.windowEnd,cursor:s.active.cursor}:null,lastCommitted:s.lastCommitted,error:s.error,historicalDeletionCoverageCertified:false,ingestionAuthorized:false,stateFileId:ctx.file.getId(),triggers:ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()===c.HANDLER).map(t=>t.getUniqueId())};console.log('[NATIVE CDC PROSPECTIVE V1244] | STATUS | '+JSON.stringify(out));return out;}
