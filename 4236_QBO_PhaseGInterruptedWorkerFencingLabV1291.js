/** V1291 — isolated manual multi-execution lease-expiry / fencing lab.
 * Synthetic folder and QBO_PG1291_LAB_ACTIVE Script Property only.
 * No triggers, no production Phase G writes. Keep evidence; do not run with other App50 jobs.
 * Manual sequence: setup -> A claim/stage -> wait >= 20 seconds -> B takeover/publish -> A stale resume -> inspect.
 * This proves fencing at guarded write boundaries, not atomic Drive rename or hard-kill recovery.
 */
const QBO_PG1291_ = Object.freeze({V:'1.5.291',K:'QBO_PG1291_LAB_ACTIVE',TTL_MS:15000});
function qboPg1291Assert_(ok,msg){if(!ok)throw Error('V1291_'+msg);}
function qboPg1291Lock_(fn){const l=LockService.getScriptLock();qboPg1291Assert_(l.tryLock(1500),'LOCK_BUSY');try{return fn();}finally{l.releaseLock();}}
function qboPg1291Get_(){const x=PropertiesService.getScriptProperties().getProperty(QBO_PG1291_.K);qboPg1291Assert_(!!x,'NOT_SETUP');return JSON.parse(x);}
function qboPg1291Put_(s){PropertiesService.getScriptProperties().setProperty(QBO_PG1291_.K,JSON.stringify(s));}
function qboPg1291Files_(d,n){const a=[],it=d.getFilesByName(n);while(it.hasNext())a.push(it.next());return a;}
function qboPg1291Guard_(s,owner,epoch){qboPg1291Assert_(s.owner===owner&&s.epoch===epoch,'STALE_OWNER');qboPg1291Assert_(s.phase==='OWNED'||s.phase==='STAGED','INVALID_PHASE');qboPg1291Assert_(Date.now()<s.expiresAt,'LEASE_EXPIRED');}
function qboPg1291Log_(name,obj){console.log('[PHASE G V1291] | '+name+' | '+JSON.stringify(obj));return obj;}
function setupQboPhaseGFencingLabV1291(){return qboPg1291Lock_(()=>{
 const p=PropertiesService.getScriptProperties();qboPg1291Assert_(!p.getProperty(QBO_PG1291_.K),'ALREADY_SETUP');
 const runId=Utilities.getUuid(),dir=DriveApp.createFolder('QBO_PG_V1291_ISOLATED_'+runId);
 const s={version:QBO_PG1291_.V,runId,folderId:dir.getId(),payload:JSON.stringify({version:QBO_PG1291_.V,entries:[['synthetic',1]]}),finalName:'chunk_000001.json',stageName:'stage_'+runId+'.json',epoch:0,owner:null,expiresAt:0,phase:'READY',stageId:null,finalId:null,aOwner:null,aEpoch:null,events:[]};
 qboPg1291Put_(s);return qboPg1291Log_('SETUP',{runId,folderId:s.folderId,status:'READY',ttlMs:QBO_PG1291_.TTL_MS});
});}
function runQboPhaseGFencingWorkerAStageV1291(){return qboPg1291Lock_(()=>{
 const s=qboPg1291Get_();qboPg1291Assert_(s.phase==='READY','NOT_READY');
 const owner='A:'+Utilities.getUuid();s.epoch++;s.owner=owner;s.aOwner=owner;s.aEpoch=s.epoch;s.expiresAt=Date.now()+QBO_PG1291_.TTL_MS;s.phase='OWNED';
 qboPg1291Put_(s); // persist ownership before creating staging artifact
 const dir=DriveApp.getFolderById(s.folderId);qboPg1291Assert_(qboPg1291Files_(dir,s.stageName).length===0,'STAGE_EXISTS');
 const f=dir.createFile(s.stageName,s.payload,MimeType.PLAIN_TEXT);
 qboPg1291Assert_(f.getBlob().getDataAsString()===s.payload,'STAGE_READBACK');
 s.stageId=f.getId();s.phase='STAGED';s.events.push({type:'A_STAGED',epoch:s.epoch,stageId:s.stageId});qboPg1291Put_(s);
 return qboPg1291Log_('A_STAGED',{status:'STAGED',epoch:s.epoch,stageId:s.stageId,expiresAt:s.expiresAt,waitAtLeastSeconds:20});
});}
function runQboPhaseGFencingWorkerBTakeoverV1291(){return qboPg1291Lock_(()=>{
 const s=qboPg1291Get_();qboPg1291Assert_(s.phase==='STAGED','NOT_STAGED');qboPg1291Assert_(Date.now()>=s.expiresAt,'LEASE_NOT_EXPIRED_WAIT');
 const dir=DriveApp.getFolderById(s.folderId),stages=qboPg1291Files_(dir,s.stageName),finals=qboPg1291Files_(dir,s.finalName);
 qboPg1291Assert_(stages.length===1&&stages[0].getId()===s.stageId,'STAGE_AMBIGUOUS');
 qboPg1291Assert_(stages[0].getBlob().getDataAsString()===s.payload,'STAGE_MISMATCH');
 qboPg1291Assert_(finals.length===0,'FINAL_EXISTS');
 const oldEpoch=s.epoch;s.epoch++;s.owner='B:'+Utilities.getUuid();s.expiresAt=Date.now()+QBO_PG1291_.TTL_MS;s.events.push({type:'B_TAKEOVER',oldEpoch,newEpoch:s.epoch});qboPg1291Put_(s);
 // All subsequent mutations must remain under ScriptLock AND pass owner/epoch/lease guard.
 const fresh=qboPg1291Get_();qboPg1291Guard_(fresh,s.owner,s.epoch);
 stages[0].setName(s.finalName);
 const published=qboPg1291Files_(dir,s.finalName);qboPg1291Assert_(published.length===1&&published[0].getId()===s.stageId,'FINAL_AMBIGUOUS');
 qboPg1291Assert_(published[0].getBlob().getDataAsString()===s.payload,'FINAL_MISMATCH');
 fresh.phase='PUBLISHED';fresh.finalId=published[0].getId();fresh.owner=null;fresh.expiresAt=0;fresh.events.push({type:'B_PUBLISHED',epoch:fresh.epoch,finalId:fresh.finalId});qboPg1291Put_(fresh);
 return qboPg1291Log_('B_TAKEOVER',{status:'PUBLISHED',oldEpoch,newEpoch:fresh.epoch,finalId:fresh.finalId});
});}
function runQboPhaseGFencingWorkerAStaleResumeV1291(){return qboPg1291Lock_(()=>{
 const s=qboPg1291Get_();qboPg1291Assert_(!!s.aOwner&&!!s.aEpoch,'A_NOT_STAGED');
 let rejected=false,reason='';try{qboPg1291Guard_(s,s.aOwner,s.aEpoch);}catch(e){rejected=true;reason=String(e.message||e);}
 qboPg1291Assert_(rejected&&reason.indexOf('V1291_STALE_OWNER')>=0,'STALE_NOT_REJECTED');
 return qboPg1291Log_('A_STALE_RESUME',{status:'STALE_OWNER_REJECTED',attemptedEpoch:s.aEpoch,currentEpoch:s.epoch,productionWrites:0});
});}
function inspectQboPhaseGFencingLabV1291(){const s=qboPg1291Get_(),dir=DriveApp.getFolderById(s.folderId);
 const finals=qboPg1291Files_(dir,s.finalName),stages=qboPg1291Files_(dir,s.stageName);
 const valid=s.phase==='PUBLISHED'&&s.epoch===2&&s.owner===null&&finals.length===1&&stages.length===0&&finals[0].getId()===s.finalId&&finals[0].getBlob().getDataAsString()===s.payload;
 return qboPg1291Log_('INSPECT',{version:QBO_PG1291_.V,readOnly:true,status:valid?'FENCED_SINGLE_PUBLICATION_VERIFIED':'BLOCKED',runId:s.runId,epoch:s.epoch,phase:s.phase,finalCount:finals.length,stageCount:stages.length,valid,events:s.events,productionCheckpointWrites:0,productionTriggerChanges:0,cleanupPerformed:false});
}
