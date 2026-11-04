/** v1.5.254 — Manual capture-only catch-up, one entity per invocation.
 * No automatic triggers, ingestion, watermark or Phase G writes.
 * Operator must review inspect... before first acquisition.
 */
const QBO_CDC_CATCHUP_V1254_=Object.freeze({KEY:'QBO_NATIVE_CDC_CATCHUP_V1254_POINTER',LEASE:'QBO_NATIVE_CDC_CATCHUP_V1254_LEASE',SEAL:'1AoBTgniGs-lF8NDHpY4O_YB5OdfIIVtc',HASH:'e073932947e328c1ec02693515045734b5a3a8e5c9a513055c0a32e3aaa01f52',SINCE:'2026-10-11T22:12:37.687Z',WATERMARK:'2026-10-11T22:27:37.687Z',MAX_LEASE_MS:600000});
function qboCdcCatchupV1254Guard_(){
 const k=QBO_CDC_CATCHUP_V1254_,p=PropertiesService.getScriptProperties(),ctx=qboCdcProspectiveStateV1244_(),s=ctx.state,a=s.active;
 if(s.status!=='HALTED_REQUIRES_REVIEW'||s.enabled!==false||s.prospectiveWatermark!==k.WATERMARK||s.ingestionAuthorized!==false||s.historicalDeletionCoverageCertified!==false||!a||a.cursor!==20||a.results.length!==20||a.changedSince!==k.SINCE)throw Error('V1254_RECOVERY_STATE_CHANGED');
 if(!qboNativeCdcIsPaused_()||!qboNativeCdcV1233CaptureOnly_())throw Error('V1254_CAPTURE_GUARDS_CHANGED');
 qboCdcProspectiveGuardV1244_();
 if(ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()===QBO_CDC_PROSPECTIVE_V1244_.HANDLER))throw Error('V1254_OLD_CAPTURE_TRIGGER');
 const sealRaw=DriveApp.getFileById(k.SEAL).getBlob().getDataAsString('UTF-8');if(qboNativeCdcSha256_(sealRaw)!==k.HASH)throw Error('V1254_SEAL_CHANGED');
 const seal=JSON.parse(sealRaw);if(seal.changedSince!==k.SINCE||seal.entities.length!==20||seal.cycleCommitted!==false||seal.ingestionAuthorized!==false)throw Error('V1254_SEAL_CONTRACT_CHANGED');
 qboNativeCdcV1233RequireWindow_(k.SINCE);
 const phase=JSON.parse(p.getProperty('QBO_PHASE_G_GLOBAL_TIE_V1219_STATE')||'null');if(!phase||!['BUILDING_GLOBAL_PARTITIONS','COMPLETE','COMPLETED'].includes(phase.status))throw Error('V1254_PHASE_G_UNEXPECTED');
 const root=qboNativeCdcResolveEvidenceFolder_();if(root.getId()!=='1wuIk1bYM2hu78M7KcsXhAlmP39O8wh99'||QBO_NATIVE_CDC_PRODUCTION.DATE_PARTITION_NEW_EVIDENCE!==true)throw Error('V1254_GOVERNED_ROOT_CHANGED');
 return {phase:phase,root:root};
}
function qboCdcCatchupV1254State_(){
 const raw=PropertiesService.getScriptProperties().getProperty(QBO_CDC_CATCHUP_V1254_.KEY);if(!raw)return null;
 const ptr=JSON.parse(raw),file=DriveApp.getFileById(ptr.fileId),s=JSON.parse(file.getBlob().getDataAsString('UTF-8'));
 if(s.version!=='1.5.254'||s.changedSince!==QBO_CDC_CATCHUP_V1254_.SINCE||s.sealFileId!==QBO_CDC_CATCHUP_V1254_.SEAL||s.cursor!==s.results.length||s.cursor<0||s.cursor>20||ptr.folderId!==s.folderId||ptr.fileId!==file.getId()||s.ingestionAuthorized!==false||s.coverageCertified!==false||s.watermarkCommitted!==false)throw Error('V1254_CATCHUP_STATE_CHANGED');
 return {file:file,state:s};
}
function inspectQboNativeCdcCatchupV1254(){
 const guard=qboCdcCatchupV1254Guard_(),ctx=qboCdcCatchupV1254State_(),s=ctx&&ctx.state;
 const out={version:'1.5.254',mode:'READ_ONLY',verdict:'READY_FOR_MANUAL_ONE_ENTITY_ACQUISITION',cursor:s?s.cursor:0,nextEntity:s&&s.cursor===20?null:QBO_CDC_PROSPECTIVE_V1244_.ENTITIES[s?s.cursor:0],changedSince:QBO_CDC_CATCHUP_V1254_.SINCE,folderId:s&&s.folderId,phaseG:{status:guard.phase.status,manifestCursor:guard.phase.manifestCursor},watermarkUnchanged:QBO_CDC_CATCHUP_V1254_.WATERMARK,ingestionAuthorized:false,coverageCertified:false,limitations:['No QBO request in inspection','Manual one-entity capture only','Not an atomic snapshot or intermediate-revision/deletion certification']};
 console.log('[NATIVE CDC CATCHUP V1254] | READ_ONLY | '+JSON.stringify(out));return out;
}
function qboCdcCatchupV1254Lease_(release,token){
 const lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw Error('V1254_CONTROL_LOCK_BUSY');
 try{const p=PropertiesService.getScriptProperties(),k=QBO_CDC_CATCHUP_V1254_,old=JSON.parse(p.getProperty(k.LEASE)||'null');
  if(release){if(old&&old.token===token)p.deleteProperty(k.LEASE);return;}
  if(old&&old.expiresAt>Date.now())throw Error('V1254_LEASE_BUSY');
  const id=Utilities.getUuid();p.setProperty(k.LEASE,JSON.stringify({token:id,expiresAt:Date.now()+k.MAX_LEASE_MS}));return id;
 }finally{lock.releaseLock();}
}
function qboCdcCatchupV1254Write_(file,s){const raw=JSON.stringify(s,null,2);file.setContent(raw);if(file.getBlob().getDataAsString('UTF-8')!==raw)throw Error('V1254_CHECKPOINT_READBACK_FAILED');}
function qboCdcCatchupV1254Init_(){
 const existing=qboCdcCatchupV1254State_();if(existing)return existing;
 const p=PropertiesService.getScriptProperties(),k=QBO_CDC_CATCHUP_V1254_,start=new Date(),parent=qboNativeCdcResolveRunParentFolder_(start),name='native_cdc_catchup_v1254_'+Utilities.formatDate(start,'UTC','yyyyMMdd_HHmmss')+'_'+Utilities.getUuid(),folder=parent.createFolder(name);
 const s={version:'1.5.254',status:'CAPTURING_EVIDENCE_ONLY',folderId:folder.getId(),sealFileId:k.SEAL,changedSince:k.SINCE,requestWindowEnd:start.toISOString(),startedAt:start.toISOString(),cursor:0,results:[],watermarkCommitted:false,ingestionAuthorized:false,coverageCertified:false};
 const f=folder.createFile('checkpoint.json',JSON.stringify(s,null,2),'application/json');if(f.getBlob().getDataAsString('UTF-8')!==JSON.stringify(s,null,2))throw Error('V1254_INITIAL_CHECKPOINT_READBACK_FAILED fileId='+f.getId());
 // Recoverable if pointer write fails: folder is preserved; never delete evidence.
 p.setProperty(k.KEY,JSON.stringify({fileId:f.getId(),folderId:folder.getId()}));return {file:f,state:s};
}
function acquireOneQboNativeCdcCatchupEntityV1254(){
 const token=qboCdcCatchupV1254Lease_(false);
 try{
  qboCdcCatchupV1254Guard_();const ctx=qboCdcCatchupV1254Init_(),s=ctx.state;
  if(s.cursor===20)throw Error('V1254_ALL_ENTITIES_CAPTURED_SEPARATE_AUDIT_REQUIRED');
  const entity=QBO_CDC_PROSPECTIVE_V1244_.ENTITIES[s.cursor],folder=DriveApp.getFolderById(s.folderId),name='cdc_'+entity+'.json';
  let f=qboCdcProspectiveFileV1244_(folder,name),raw,e;
  if(f){raw=f.getBlob().getDataAsString('UTF-8');if(!raw)throw Error('V1254_EXISTING_FILE_EMPTY_PRESERVED fileId='+f.getId());e=JSON.parse(raw);}
  else{
   qboCdcCatchupV1254Guard_();const requestStartedAt=new Date().toISOString(),response=qboNativeCdcRequestEntity_(entity,new Date(s.changedSince),getConfig_().minorVersion);
   e={version:'1.5.244',purpose:'CATCHUP_CAPTURE_ONLY_WITH_HISTORICAL_GAP',cycleId:'V1254|'+s.folderId,entity:entity,changedSince:s.changedSince,requestStartedAt:requestStartedAt,requestCompletedAt:new Date().toISOString(),response:response,catchup:{version:'1.5.254',sealedRecoveryFileId:QBO_CDC_CATCHUP_V1254_.SEAL,windowEnd:s.requestWindowEnd,lateAcquisition:true}};
   raw=JSON.stringify(e,null,2);f=folder.createFile(name,raw,'application/json');
  }
  let verified=false;for(let i=0;i<3;i++){try{if(f.getBlob().getDataAsString('UTF-8')===raw){verified=true;break;}}catch(err){}Utilities.sleep(500*(i+1));}
  if(!verified)throw Error('V1254_EVIDENCE_READBACK_FAILED_PRESERVED fileId='+f.getId());
  const identity={cycleId:'V1254|'+s.folderId,changedSince:s.changedSince,windowEnd:s.requestWindowEnd};
  const r=qboCdcProspectiveValidateV1244_(e,identity,entity);r.fileId=f.getId();r.sha256=qboNativeCdcSha256_(raw);r.requestStartedAt=e.requestStartedAt;r.requestCompletedAt=e.requestCompletedAt;
  qboCdcCatchupV1254Guard_();const fresh=qboCdcCatchupV1254State_();if(!fresh||fresh.state.cursor!==s.cursor||fresh.state.folderId!==s.folderId)throw Error('V1254_CONCURRENT_CHECKPOINT_CHANGED');
  fresh.state.results.push(r);fresh.state.cursor++;if(fresh.state.cursor===20)fresh.state.status='EVIDENCE_CAPTURE_COMPLETE_AUDIT_REQUIRED';
  qboCdcCatchupV1254Write_(fresh.file,fresh.state);
  const out={version:'1.5.254',action:'ENTITY_CAPTURED_CHECKPOINTED',entity:entity,cursor:fresh.state.cursor,fileId:f.getId(),sha256:r.sha256,folderId:s.folderId,watermarkUnchanged:QBO_CDC_CATCHUP_V1254_.WATERMARK,cycleNotCommitted:true,ingestionAuthorized:false,coverageCertified:false,phaseGUntouched:true};
  console.log('[NATIVE CDC CATCHUP V1254] | '+JSON.stringify(out));return out;
 }finally{try{qboCdcCatchupV1254Lease_(true,token);}catch(err){console.log('[V1254] LEASE_RELEASE_DEFERRED '+String(err));}}
}
