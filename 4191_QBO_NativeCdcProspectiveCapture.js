/** v1.5.244. Isolated prospective evidence capture; no ingestion or historical watermark writes. */
const QBO_CDC_PROSPECTIVE_V1244_ = Object.freeze({
 KEY:'QBO_NATIVE_CDC_PROSPECTIVE_V1244_POINTER', HANDLER:'runQboNativeCdcProspectiveCaptureV1244',
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
function qboCdcProspectiveWriteV1244_(file,value){const raw=JSON.stringify(value,null,2);file.setContent(raw);if(file.getBlob().getDataAsString('UTF-8')!==raw)throw Error('V1244_CHECKPOINT_READBACK_FAILED');}
function qboCdcProspectiveRemoveTriggerV1244_(){ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()===QBO_CDC_PROSPECTIVE_V1244_.HANDLER).forEach(t=>ScriptApp.deleteTrigger(t));}
function qboCdcProspectiveStateV1244_(){
 const c=QBO_CDC_PROSPECTIVE_V1244_,ptr=JSON.parse(PropertiesService.getScriptProperties().getProperty(c.KEY)||'null');if(!ptr)throw Error('V1244_NOT_ACTIVATED');
 const file=DriveApp.getFileById(ptr.stateFileId),s=JSON.parse(file.getBlob().getDataAsString('UTF-8'));
 if(s.version!=='1.5.244'||s.reviewSha256!==c.HASH||s.initialAnchor!==c.ANCHOR||s.historicalWatermark!==c.HISTORICAL||s.ingestionAuthorized!==false||s.historicalDeletionCoverageCertified!==false||s.folderId!==ptr.folderId)throw Error('V1244_CHECKPOINT_IDENTITY_INVALID');
 return {file:file,state:s,folder:DriveApp.getFolderById(ptr.folderId)};
}
function activateQboNativeCdcProspectiveCaptureV1244(){
 const lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw Error('V1244_CONTROL_BUSY_RETRY');
 try{
  const c=QBO_CDC_PROSPECTIVE_V1244_,p=PropertiesService.getScriptProperties();qboCdcProspectiveGuardV1244_();
  const raw=DriveApp.getFileById(c.REVIEW).getBlob().getDataAsString('UTF-8'),review=JSON.parse(raw);
  if(qboNativeCdcSha256_(raw)!==c.HASH||review.entityCount!==20||review.validatedDirectCdcEntityCount!==19||review.issues.length||review.completenessCertified!==false||review.deletionCoverageCertified!==false)throw Error('V1244_REVIEW_CHANGED');
  qboNativeCdcV1233RequireWindow_(new Date(Date.parse(c.ANCHOR)-900000).toISOString());
  if(!p.getProperty(c.KEY)){
   const parent=DriveApp.getFolderById('1NO_yCJVNfSt_-LiyCqAQGYVoja9YWumW'),name='prospective_capture_v1244',it=parent.getFoldersByName(name);let folder;
   if(it.hasNext()){folder=it.next();if(it.hasNext())throw Error('V1244_DUPLICATE_ROOT');}else folder=parent.createFolder(name);
   let file=qboCdcProspectiveFileV1244_(folder,'checkpoint.json');
   if(!file){const s={version:'1.5.244',folderId:folder.getId(),enabled:true,initialAnchor:c.ANCHOR,prospectiveWatermark:c.ANCHOR,anchorIsCommittedCoverage:false,historicalWatermark:c.HISTORICAL,reviewFileId:c.REVIEW,reviewSha256:c.HASH,historicalDeletionCoverageCertified:false,ingestionAuthorized:false,status:'READY',active:null,lastCommitted:null,error:'',createdAt:new Date().toISOString()};file=folder.createFile('checkpoint.json',JSON.stringify(s,null,2),'application/json');qboCdcProspectiveWriteV1244_(file,s);}
   p.setProperty(c.KEY,JSON.stringify({folderId:folder.getId(),stateFileId:file.getId()}));
  }
  const ctx=qboCdcProspectiveStateV1244_();if(!ctx.state.enabled)throw Error('V1244_PAUSED_INSPECT_BEFORE_RESUME');
  qboCdcProspectiveRemoveTriggerV1244_();ScriptApp.newTrigger(c.HANDLER).timeBased().everyMinutes(5).create();
  console.log('[NATIVE CDC PROSPECTIVE V1244] | ACTIVATED | '+JSON.stringify({version:'1.5.244',initialAnchor:c.ANCHOR,firstChangedSince:new Date(Date.parse(c.ANCHOR)-900000).toISOString(),historicalWatermark:c.HISTORICAL,historicalDeletionCoverageCertified:false,ingestionAuthorized:false,stateFileId:ctx.file.getId(),legacyProductionPaused:true,automaticTickMinutes:5,newScriptProperties:1}));
 }finally{lock.releaseLock();}
 return runQboNativeCdcProspectiveCaptureV1244();
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
  ctx=qboCdcProspectiveStateV1244_();const s=ctx.state,c=QBO_CDC_PROSPECTIVE_V1244_;if(!s.enabled)return {action:'PAUSED'};qboCdcProspectiveGuardV1244_();
  if(!s.active){
   if(s.lastCommitted&&Date.now()-Date.parse(s.lastCommitted.windowEnd)<1800000)return {action:'WAIT_NEXT_CYCLE'};
   const end=new Date().toISOString(),since=new Date(Date.parse(s.prospectiveWatermark)-900000).toISOString();qboNativeCdcV1233RequireWindow_(since);
   const id=Utilities.getUuid(),folder=ctx.folder.createFolder('cycle_'+end.replace(/[:.]/g,'_')+'_'+id);
   s.active={cycleId:id,folderId:folder.getId(),priorProspectiveWatermark:s.prospectiveWatermark,changedSince:since,windowEnd:end,cursor:0,results:[]};s.status='CAPTURING';qboCdcProspectiveWriteV1244_(ctx.file,s);
  }
  const a=s.active;if(!Number.isInteger(a.cursor)||a.cursor!==a.results.length||a.cursor<0||a.cursor>20||a.priorProspectiveWatermark!==s.prospectiveWatermark)throw Error('V1244_INVALID_ACTIVE_CURSOR');
  const folder=DriveApp.getFolderById(a.folderId),started=Date.now();let n=0;
  while(a.cursor<20&&n<5&&Date.now()-started<150000){
   qboCdcProspectiveGuardV1244_();const entity=c.ENTITIES[a.cursor],name='cdc_'+entity+'.json';let f=qboCdcProspectiveFileV1244_(folder,name),e;
   if(f)e=JSON.parse(f.getBlob().getDataAsString('UTF-8'));
   else{
    qboNativeCdcV1233RequireWindow_(a.changedSince);const requestStartedAt=new Date().toISOString(),response=qboNativeCdcRequestEntity_(entity,new Date(a.changedSince),getConfig_().minorVersion);
    e={version:'1.5.244',purpose:'PROSPECTIVE_CAPTURE_ONLY_WITH_HISTORICAL_GAP',cycleId:a.cycleId,entity:entity,changedSince:a.changedSince,requestStartedAt:requestStartedAt,requestCompletedAt:new Date().toISOString(),response:response};
    const raw=JSON.stringify(e,null,2);f=folder.createFile(name,raw,'application/json');if(f.getBlob().getDataAsString('UTF-8')!==raw)throw Error('V1244_RAW_READBACK_FAILED');
   }
   const result=qboCdcProspectiveValidateV1244_(e,a,entity);result.fileId=f.getId();result.sha256=qboNativeCdcSha256_(f.getBlob().getDataAsString('UTF-8'));
   a.results.push(result);a.cursor++;qboCdcProspectiveWriteV1244_(ctx.file,s);n++;
   console.log('[NATIVE CDC PROSPECTIVE V1244] | ENTITY_SAVED | '+JSON.stringify(result));
  }
  if(a.cursor===20){
   qboCdcProspectiveGuardV1244_();a.results.forEach((r,i)=>{if(r.entity!==c.ENTITIES[i])throw Error('V1244_MANIFEST_SCOPE_INVALID');const raw=DriveApp.getFileById(r.fileId).getBlob().getDataAsString('UTF-8');if(qboNativeCdcSha256_(raw)!==r.sha256)throw Error('V1244_EVIDENCE_CHANGED');qboCdcProspectiveValidateV1244_(JSON.parse(raw),a,r.entity);});
   const manifest={version:'1.5.244',status:'PROSPECTIVE_CAPTURE_COMMITTED_WITH_HISTORICAL_GAP',cycleId:a.cycleId,changedSince:a.changedSince,windowEnd:a.windowEnd,priorProspectiveWatermark:a.priorProspectiveWatermark,entities:a.results,reviewFileId:c.REVIEW,reviewSha256:c.HASH,historicalWatermark:c.HISTORICAL,historicalDeletionCoverageCertified:false,ingestionAuthorized:false,limitations:['CDC preserves returned states and tombstones, not every intermediate revision.','Responses are acquired at different times; no common atomic snapshot is certified.','Historical Purchase deletion gap remains unresolved.']};
   let f=qboCdcProspectiveFileV1244_(folder,'manifest.json');const raw=JSON.stringify(manifest,null,2);if(!f)f=folder.createFile('manifest.json',raw,'application/json');if(f.getBlob().getDataAsString('UTF-8')!==raw)throw Error('V1244_MANIFEST_NOT_EXACT');
   s.lastCommitted={cycleId:a.cycleId,manifestFileId:f.getId(),manifestSha256:qboNativeCdcSha256_(raw),windowEnd:a.windowEnd};s.prospectiveWatermark=a.windowEnd;s.anchorIsCommittedCoverage=true;s.active=null;s.status='READY';qboCdcProspectiveWriteV1244_(ctx.file,s);
   console.log('[NATIVE CDC PROSPECTIVE V1244] | CYCLE_COMMITTED | '+JSON.stringify(s.lastCommitted));
  }
  const out={version:'1.5.244',status:s.status,entityCursor:s.active?s.active.cursor:20,prospectiveWatermark:s.prospectiveWatermark,historicalWatermark:c.HISTORICAL,historicalDeletionCoverageCertified:false,ingestionAuthorized:false};console.log('[NATIVE CDC PROSPECTIVE V1244] | PROGRESS | '+JSON.stringify(out));return out;
 }catch(error){
  if(ctx){try{const durable=qboCdcProspectiveStateV1244_();durable.state.enabled=false;durable.state.status='HALTED_REQUIRES_REVIEW';durable.state.error=String(error.message||error);qboCdcProspectiveWriteV1244_(durable.file,durable.state);}catch(saveError){console.log('[NATIVE CDC PROSPECTIVE V1244] | HALT_CHECKPOINT_ERROR | '+String(saveError));}}
  qboCdcProspectiveRemoveTriggerV1244_();console.log('[NATIVE CDC PROSPECTIVE V1244] | HALTED | '+String(error.message||error));throw error;
 }finally{lock.releaseLock();}
}
function pauseQboNativeCdcProspectiveCaptureV1244(){const lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw Error('V1244_CONTROL_BUSY_RETRY');try{const ctx=qboCdcProspectiveStateV1244_();ctx.state.enabled=false;ctx.state.status='PAUSED';qboCdcProspectiveWriteV1244_(ctx.file,ctx.state);qboCdcProspectiveRemoveTriggerV1244_();}finally{lock.releaseLock();}return inspectQboNativeCdcProspectiveCaptureV1244();}
function inspectQboNativeCdcProspectiveCaptureV1244(){const ctx=qboCdcProspectiveStateV1244_(),s=ctx.state,c=QBO_CDC_PROSPECTIVE_V1244_;const out={version:s.version,status:s.status,enabled:s.enabled,prospectiveWatermark:s.prospectiveWatermark,anchorIsCommittedCoverage:s.anchorIsCommittedCoverage,historicalWatermark:PropertiesService.getScriptProperties().getProperty(QBO_NATIVE_CDC_PRODUCTION.WATERMARK_PROPERTY_KEY),legacyProductionPaused:qboNativeCdcIsPaused_(),activeCycle:s.active?{cycleId:s.active.cycleId,changedSince:s.active.changedSince,windowEnd:s.active.windowEnd,cursor:s.active.cursor}:null,lastCommitted:s.lastCommitted,error:s.error,historicalDeletionCoverageCertified:false,ingestionAuthorized:false,stateFileId:ctx.file.getId(),triggers:ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()===c.HANDLER).map(t=>t.getUniqueId())};console.log('[NATIVE CDC PROSPECTIVE V1244] | STATUS | '+JSON.stringify(out));return out;}
