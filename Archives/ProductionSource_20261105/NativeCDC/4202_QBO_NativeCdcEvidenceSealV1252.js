/** v1.5.252 — Controlled, evidence-only recovery seal. Manual operation only.
 * Never commits cycle, advances watermark, enables ingestion, or modifies Phase G.
 * Inspect before invoking sealQboNativeCdcRecoveryEvidenceV1252.
 */
const QBO_CDC_EVIDENCE_SEAL_V1252_=Object.freeze({
 cycle:'9c9276b1-70cb-4fb5-930f-bb5e388c5312',
 folder:'1LOu-1Tpsb7i7HFWx8JGVBBxmi1N0PiDF',
 watermark:'2026-10-11T22:27:37.687Z',
 name:'recovery_evidence_seal_v1252_9c9276b1-70cb-4fb5-930f-bb5e388c5312.json'
});
function qboCdcEvidenceSealV1252Context_(){
 const k=QBO_CDC_EVIDENCE_SEAL_V1252_,audit=inspectQboNativeCdcRecoveredCycleV1251();
 if(audit.verdict!=='PASS_EVIDENCE_ONLY_NOT_COVERAGE_CERTIFIED'||audit.cursor!==20||audit.originalEntitiesVerified!==17||audit.recoveredEntitiesVerified!==3||audit.findings.length)throw Error('V1252_AUDIT_NOT_PASS');
 const ctx=qboCdcProspectiveStateV1244_(),s=ctx.state,a=s.active;
 if(s.status!=='HALTED_REQUIRES_REVIEW'||s.enabled!==false||s.prospectiveWatermark!==k.watermark||s.ingestionAuthorized!==false||s.historicalDeletionCoverageCertified!==false||!a||a.cycleId!==k.cycle||a.folderId!==k.folder||a.cursor!==20||a.results.length!==20)throw Error('V1252_CHECKPOINT_CHANGED');
 const evidence=DriveApp.getFolderById(k.folder),parentIt=evidence.getParents();
 if(!parentIt.hasNext())throw Error('V1252_EVIDENCE_PARENT_MISSING');
 const parent=parentIt.next();if(parentIt.hasNext())throw Error('V1252_MULTIPLE_EVIDENCE_PARENTS');
 return {audit:audit,state:s,active:a,parent:parent};
}
function qboCdcEvidenceSealV1252Existing_(parent){
 const it=parent.getFilesByName(QBO_CDC_EVIDENCE_SEAL_V1252_.name);let found=null;
 while(it.hasNext()){const f=it.next();if(found)throw Error('V1252_DUPLICATE_SEAL_FILES');found=f;}
 return found;
}
function qboCdcEvidenceSealV1252Payload_(c){
 const entries=[];
 for(let i=0;i<20;i++){
  const r=c.active.results[i],entity=QBO_CDC_PROSPECTIVE_V1244_.ENTITIES[i],f=DriveApp.getFileById(r.fileId),raw=f.getBlob().getDataAsString('UTF-8'),e=JSON.parse(raw);
  const name=(i<17?'cdc_':'recovery_v1249_cdc_')+entity+'.json';
  if(r.entity!==entity||f.getName()!==name||qboNativeCdcSha256_(raw)!==r.sha256)throw Error('V1252_EVIDENCE_CHANGED '+entity);
  entries.push({index:i,entity:entity,fileId:r.fileId,fileName:name,sha256:r.sha256,returnedRows:r.returnedRows,deletedRows:r.deletedRows,requestStartedAt:e.requestStartedAt,requestCompletedAt:e.requestCompletedAt,lateAcquisition:i>=17});
 }
 return {schema:'QBO_NATIVE_CDC_RECOVERY_EVIDENCE_SEAL_V1',version:'1.5.252',purpose:'EVIDENCE_ONLY_NOT_COVERAGE_CERTIFICATION',cycleId:c.active.cycleId,
  evidenceFolderId:c.active.folderId,stateFileId:'17ckU3zeHx02U3FSd8d2p9TnigjVWQDP1',changedSince:c.active.changedSince,originalWindowEnd:c.active.windowEnd,
  preservedProspectiveWatermark:c.state.prospectiveWatermark,originalFailedTermFileId:'1NNSUBGPz02Z2q5L4dXNmI1T8Ee_Jtj_v',
  entities:entries,originalCount:17,recoveredCount:3,cycleCommitted:false,watermarkAdvanced:false,ingestionAuthorized:false,historicalDeletionCoverageCertified:false,
  limitations:['Mixed acquisition dates: October 11 and October 23, 2026; not an atomic historical snapshot.',
   'CDC cannot reconstruct intermediate entity revisions or certify historical deletion coverage.',
   'This seal records evidence integrity only; no cycle commit or watermark advancement.']};
}
function inspectQboNativeCdcEvidenceSealV1252(){
 const c=qboCdcEvidenceSealV1252Context_(),f=qboCdcEvidenceSealV1252Existing_(c.parent),payload=qboCdcEvidenceSealV1252Payload_(c),expected=JSON.stringify(payload,null,2);
 let status='READY_TO_SEAL',fileId=null;
 if(f){fileId=f.getId();if(f.getBlob().getDataAsString('UTF-8')!==expected)throw Error('V1252_EXISTING_SEAL_CONFLICT');status='ALREADY_SEALED_VERIFIED';}
 const out={version:'1.5.252',mode:'READ_ONLY',verdict:status,cycleId:payload.cycleId,entityCount:payload.entities.length,sealFileId:fileId,sealParentFolderId:c.parent.getId(),watermark:payload.preservedProspectiveWatermark,cycleCommitted:false,ingestionAuthorized:false,phaseGNotModified:true};
 console.log('[NATIVE CDC EVIDENCE SEAL V1252] | READ_ONLY | '+JSON.stringify(out));return out;
}
function sealQboNativeCdcRecoveryEvidenceV1252(){
 // Short control lock only. No QBO calls. Phase G uses a different lock domain.
 const lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw Error('V1252_CONTROL_LOCK_BUSY');
 try{
  const c=qboCdcEvidenceSealV1252Context_(),payload=qboCdcEvidenceSealV1252Payload_(c),raw=JSON.stringify(payload,null,2);
  let f=qboCdcEvidenceSealV1252Existing_(c.parent),action='EXISTING_SEAL_VERIFIED';
  if(!f){f=c.parent.createFile(QBO_CDC_EVIDENCE_SEAL_V1252_.name,raw,'application/json');action='EVIDENCE_SEAL_WRITTEN';}
  let actual='';for(let i=0;i<3;i++){try{actual=f.getBlob().getDataAsString('UTF-8');if(actual===raw)break;}catch(err){}Utilities.sleep(500*(i+1));}
  if(actual!==raw)throw Error('V1252_SEAL_READBACK_FAILED_PRESERVED fileId='+f.getId());
  // Recheck critical state after durable write; never mutate state on mismatch.
  const post=qboCdcProspectiveStateV1244_().state;
  if(post.status!=='HALTED_REQUIRES_REVIEW'||post.enabled!==false||post.prospectiveWatermark!==payload.preservedProspectiveWatermark||post.ingestionAuthorized!==false||post.historicalDeletionCoverageCertified!==false||!post.active||post.active.cursor!==20||post.active.cycleId!==payload.cycleId)throw Error('V1252_POST_SEAL_STATE_CHANGED_REVIEW_REQUIRED fileId='+f.getId());
  const out={version:'1.5.252',action:action,fileId:f.getId(),sha256:qboNativeCdcSha256_(raw),entityCount:20,watermarkUnchanged:post.prospectiveWatermark,cycleNotCommitted:true,ingestionAuthorized:false,phaseGUntouched:true,coverageCertified:false};
  console.log('[NATIVE CDC EVIDENCE SEAL V1252] | '+JSON.stringify(out));return out;
 }finally{lock.releaseLock();}
}
