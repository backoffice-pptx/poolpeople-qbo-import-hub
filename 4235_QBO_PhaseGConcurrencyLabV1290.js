/** V1290 — ISOLATED, manual two-execution concurrency experiment.
 * Do not run concurrently with unrelated App 50 operations: ScriptLock is global.
 * Only synthetic Drive files and QBO_PG1290_LAB_ properties are used.
 * No triggers are installed. Lab evidence is intentionally retained.
 */
const QBO_PG1290_ = Object.freeze({V:'1.5.290', K:'QBO_PG1290_LAB_ACTIVE', HOLD_MS:20000});
function qboPg1290Assert_(ok,msg){if(!ok)throw Error('V1290_'+msg);}
function qboPg1290Read_(p){const raw=p.getProperty(QBO_PG1290_.K);qboPg1290Assert_(!!raw,'NOT_INITIALIZED');return JSON.parse(raw);}
function qboPg1290Files_(dir,name){const a=[],it=dir.getFilesByName(name);while(it.hasNext())a.push(it.next());return a;}
function qboPg1290Lock_(timeout,fn){const l=LockService.getScriptLock();if(!l.tryLock(timeout))return {acquired:false};try{return {acquired:true,result:fn()};}finally{l.releaseLock();}}
function qboPg1290Digest_(str){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,str,Utilities.Charset.UTF_8).map(x=>('0'+((x+256)%256).toString(16)).slice(-2)).join('');}
function qboPg1290Validate_(f,s){qboPg1290Assert_(f.getBlob().getDataAsString()===s.payload,'PAYLOAD_MISMATCH');}
/** Run ONCE, before starting either worker. */
function setupQboPhaseGConcurrencyLabV1290(){
 const r=qboPg1290Lock_(1000,()=>{
  const p=PropertiesService.getScriptProperties();qboPg1290Assert_(!p.getProperty(QBO_PG1290_.K),'ALREADY_INITIALIZED');
  const id=Utilities.getUuid(),dir=DriveApp.createFolder('QBO_PG_V1290_ISOLATED_'+id);
  const payload=JSON.stringify({version:QBO_PG1290_.V,entries:[['synthetic-id','synthetic-index',1]]});
  const s={version:QBO_PG1290_.V,runId:id,folderId:dir.getId(),finalName:'chunk_000001.json',payload,payloadHash:qboPg1290Digest_(payload),epoch:0,owner:null,phase:'READY',finalId:null,events:[]};
  p.setProperty(QBO_PG1290_.K,JSON.stringify(s));
  return {runId:id,folderId:dir.getId(),status:'READY'};
 });qboPg1290Assert_(r.acquired,'SETUP_LOCK_BUSY');console.log('[PHASE G V1290] | SETUP | '+JSON.stringify(r.result));return r.result;
}
/** Start A first; while A is sleeping, start B from a second editor session. */
function runQboPhaseGConcurrencyWorkerAV1290(){
 const p=PropertiesService.getScriptProperties(),run=Utilities.getUuid();
 const outcome=qboPg1290Lock_(1000,()=>{
  const s=qboPg1290Read_(p);qboPg1290Assert_(s.phase==='READY','NOT_READY');
  s.epoch++;s.owner=run;s.phase='OWNED';s.events.push({type:'A_ACQUIRED',epoch:s.epoch,at:new Date().toISOString()});
  p.setProperty(QBO_PG1290_.K,JSON.stringify(s));
  console.log('[PHASE G V1290] | A_LOCK_HELD | '+JSON.stringify({runId:s.runId,epoch:s.epoch,holdMs:QBO_PG1290_.HOLD_MS}));
  Utilities.sleep(QBO_PG1290_.HOLD_MS);
  const fresh=qboPg1290Read_(p);
  qboPg1290Assert_(fresh.owner===run&&fresh.epoch===s.epoch,'FENCING_CHANGED');
  const dir=DriveApp.getFolderById(s.folderId);qboPg1290Assert_(qboPg1290Files_(dir,s.finalName).length===0,'FINAL_ALREADY_EXISTS');
  const f=dir.createFile('stage_'+s.runId+'.json',s.payload,MimeType.PLAIN_TEXT);
  qboPg1290Validate_(f,s);qboPg1290Assert_(qboPg1290Files_(dir,s.finalName).length===0,'FINAL_APPEARED');
  f.setName(s.finalName);const files=qboPg1290Files_(dir,s.finalName);
  qboPg1290Assert_(files.length===1&&files[0].getId()===f.getId(),'PUBLICATION_AMBIGUOUS');qboPg1290Validate_(f,s);
  fresh.phase='PUBLISHED';fresh.finalId=f.getId();fresh.owner=null;fresh.events.push({type:'A_PUBLISHED',epoch:s.epoch,at:new Date().toISOString()});
  p.setProperty(QBO_PG1290_.K,JSON.stringify(fresh));
  return {status:'PUBLISHED',epoch:s.epoch,finalId:f.getId()};
 });
 const out={version:QBO_PG1290_.V,worker:'A',lockAcquired:outcome.acquired,result:outcome.result||null};
 console.log('[PHASE G V1290] | WORKER_A | '+JSON.stringify(out));return out;
}
/** Run B during A's 20-second hold, NOT after it completes. */
function runQboPhaseGConcurrencyWorkerBV1290(){
 const attempt=qboPg1290Lock_(1000,()=>{
  const p=PropertiesService.getScriptProperties(),s=qboPg1290Read_(p);
  // B deliberately never publishes: this tests lock exclusion, not takeover.
  return {phase:s.phase,epoch:s.epoch,finalId:s.finalId};
 });
 const out={version:QBO_PG1290_.V,worker:'B',lockAcquired:attempt.acquired,status:attempt.acquired?'NOT_OVERLAPPED_OR_UNEXPECTED_LOCK':'CONTENTION_REJECTED',result:attempt.result||null};
 console.log('[PHASE G V1290] | WORKER_B | '+JSON.stringify(out));return out;
}
/** Read-only final check. Run after A and B have finished. */
function inspectQboPhaseGConcurrencyLabV1290(){
 const p=PropertiesService.getScriptProperties(),s=qboPg1290Read_(p),dir=DriveApp.getFolderById(s.folderId);
 const files=qboPg1290Files_(dir,s.finalName);
 const valid=files.length===1&&files[0].getId()===s.finalId&&files[0].getBlob().getDataAsString()===s.payload;
 const out={version:QBO_PG1290_.V,readOnly:true,status:valid&&s.phase==='PUBLISHED'?'SINGLE_PUBLICATION_VERIFIED':'BLOCKED',runId:s.runId,epoch:s.epoch,phase:s.phase,finalCount:files.length,valid,events:s.events,productionCheckpointWrites:0,productionTriggerChanges:0};
 console.log('[PHASE G V1290] | INSPECT | '+JSON.stringify(out));return out;
}
/** Isolated stale-owner rejection test; does not change the registry. */
function inspectQboPhaseGStaleEpochV1290(){
 const s=qboPg1290Read_(PropertiesService.getScriptProperties());qboPg1290Assert_(s.phase==='PUBLISHED','NOT_PUBLISHED');
 const staleEpoch=s.epoch-1,allowed=staleEpoch===s.epoch&&s.owner!==null;
 const out={version:QBO_PG1290_.V,readOnly:true,currentEpoch:s.epoch,staleEpoch,staleOwnerMayPublish:allowed,status:!allowed?'STALE_EPOCH_REJECTED':'BLOCKED'};
 console.log('[PHASE G V1290] | STALE_EPOCH | '+JSON.stringify(out));return out;
}
