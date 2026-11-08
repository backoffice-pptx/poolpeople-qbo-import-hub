/** v1.5.344 — Manifest-led checkpoint recovery. PREVIEW first; commit is explicit, fenced, and PAUSED. */
const QBO_CDC_V1344_=Object.freeze({
 cycle:'d40b2553-1128-4787-9736-9ddb22afca15',
 windowEnd:'2026-11-06T05:49:08.889Z',since:'2026-10-11T22:47:47.334Z',
 prior:'2026-10-11T23:02:47.334Z',
 folder:'1V08VaiAViWAjWfakxV1DvLn2pO6szslm',
 root:'1gWJDPdDrAExZWt472_YmPjpEdtFdTWR6',
 blank:'17ckU3zeHx02U3FSd8d2p9TnigjVWQDP1',
 manifest:'1YeSOTSv8rhMwS0EsS3iEn-46zftXgx5z',
 historical:'2026-09-14T10:38:54.152Z'
});
function qboCdcV1344Review_(doCommit){
 const k=QBO_CDC_V1344_,c=QBO_CDC_PROSPECTIVE_V1244_,p=PropertiesService.getScriptProperties();
 const report={version:'1.5.344',mode:doCommit?'CONTROLLED_COMMIT':'READ_ONLY',result:'BLOCKED',
  cycleId:k.cycle,entitiesValidated:0,errors:[],manifestSha256:null,reviewSha256:null,
  originalCheckpointPreserved:true,checkpointReplaced:false,watermarkAdvanced:false,
  automaticCaptureEnabled:false,ingestionAuthorized:false,historicalDeletionCoverageCertified:false};
 let lock=null;
 try{
  if(doCommit){lock=LockService.getScriptLock();if(!lock.tryLock(3000))throw Error('LOCK_BUSY');}
  const ptrRaw=p.getProperty(c.KEY),ptr=JSON.parse(ptrRaw||'null');
  if(!ptr||ptr.folderId!==k.root||ptr.stateFileId!==k.blank)throw Error('POINTER_IDENTITY_CHANGED');
  const original=DriveApp.getFileById(k.blank);
  const originalRaw=original.getBlob().getDataAsString('UTF-8');
  if(originalRaw.length!==0||qboNativeCdcSha256_(originalRaw)!=='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')throw Error('BLANK_CHECKPOINT_CHANGED');
  const handlers=ScriptApp.getProjectTriggers().map(t=>t.getHandlerFunction());
  report.triggerHandlers=handlers;
  if(handlers.indexOf(c.HANDLER)>=0)throw Error('PROSPECTIVE_TRIGGER_PRESENT');
  qboCdcProspectiveGuardV1244_();
  if(p.getProperty(QBO_NATIVE_CDC_PRODUCTION.WATERMARK_PROPERTY_KEY)!==k.historical)throw Error('HISTORICAL_WATERMARK_CHANGED');
  const folder=DriveApp.getFolderById(k.folder);
  if(folder.getName()!=='cycle_'+k.windowEnd.replace(/[:.]/g,'_')+'_'+k.cycle)throw Error('CYCLE_FOLDER_NAME_CHANGED');
  const files=folder.getFilesByName('manifest.json');
  if(!files.hasNext())throw Error('MANIFEST_MISSING');
  const mf=files.next();if(files.hasNext()||mf.getId()!==k.manifest)throw Error('MANIFEST_IDENTITY_CHANGED');
  const raw=mf.getBlob().getDataAsString('UTF-8'),m=JSON.parse(raw);
  report.manifestSha256=qboNativeCdcSha256_(raw);
  if(m.version!=='1.5.244'||m.status!=='PROSPECTIVE_CAPTURE_COMMITTED_WITH_HISTORICAL_GAP'||
    m.cycleId!==k.cycle||m.windowEnd!==k.windowEnd||m.changedSince!==k.since||
    m.priorProspectiveWatermark!==k.prior||m.historicalWatermark!==k.historical||
    m.reviewFileId!==c.REVIEW||m.reviewSha256!==c.HASH||
    m.historicalDeletionCoverageCertified!==false||m.ingestionAuthorized!==false||
    !Array.isArray(m.entities)||m.entities.length!==c.ENTITIES.length)throw Error('MANIFEST_CONTRACT_MISMATCH');
  const reviewRaw=DriveApp.getFileById(c.REVIEW).getBlob().getDataAsString('UTF-8');
  report.reviewSha256=qboNativeCdcSha256_(reviewRaw);
  if(report.reviewSha256!==c.HASH)throw Error('REVIEW_HASH_CHANGED');
  const review=JSON.parse(reviewRaw);
  if(review.entityCount!==20||review.validatedDirectCdcEntityCount!==19||
    !Array.isArray(review.issues)||review.issues.length||
    review.completenessCertified!==false||review.deletionCoverageCertified!==false)throw Error('REVIEW_CONTRACT_CHANGED');
  const a={cycleId:k.cycle,windowEnd:k.windowEnd,changedSince:k.since};
  m.entities.forEach(function(r,i){
    const entity=c.ENTITIES[i];if(r.entity!==entity)throw Error('ENTITY_ORDER_'+i);
    const f=DriveApp.getFileById(r.fileId);
    if(f.getName()!=='cdc_'+entity+'.json')throw Error('ENTITY_FILENAME_'+entity);
    const parents=f.getParents();if(!parents.hasNext()||parents.next().getId()!==k.folder)throw Error('ENTITY_FOLDER_'+entity);
    const content=f.getBlob().getDataAsString('UTF-8');
    if(qboNativeCdcSha256_(content)!==r.sha256)throw Error('ENTITY_HASH_'+entity);
    const counts=qboCdcProspectiveValidateV1244_(JSON.parse(content),a,entity);
    if(counts.returnedRows!==r.returnedRows||counts.deletedRows!==r.deletedRows)throw Error('ENTITY_COUNT_'+entity);
    report.entitiesValidated++;
  });
  report.result='READY_FOR_CONTROLLED_COMMIT';
  if(doCommit){
    // No overwrite of the zero-byte incident file. Create a new immutable state file, then swap pointer.
    const s={version:'1.5.244',folderId:k.root,enabled:false,initialAnchor:c.ANCHOR,
      prospectiveWatermark:k.windowEnd,anchorIsCommittedCoverage:true,historicalWatermark:k.historical,
      reviewFileId:c.REVIEW,reviewSha256:c.HASH,historicalDeletionCoverageCertified:false,
      ingestionAuthorized:false,status:'PAUSED_RECOVERED_MANIFEST',active:null,
      lastCommitted:{cycleId:k.cycle,manifestFileId:k.manifest,manifestSha256:report.manifestSha256,windowEnd:k.windowEnd},
      error:'V1344_MANIFEST_LED_RECOVERY_ORIGINAL_CHECKPOINT_EMPTY_CAPTURE_PAUSED',
      recovery:{version:'1.5.344',originalCheckpointFileId:k.blank,manifestFileId:k.manifest,
        priorProspectiveWatermark:k.prior,manifestReviewed:true,automaticCaptureEnabled:false},
      createdAt:new Date().toISOString()};
    const serialized=JSON.stringify(s,null,2),name='checkpoint_recovered_v1344_'+k.cycle+'.json';
    const root=DriveApp.getFolderById(k.root),existing=root.getFilesByName(name);
    if(existing.hasNext())throw Error('RECOVERY_CHECKPOINT_ALREADY_EXISTS_REVIEW');
    const fresh=root.createFile(name,serialized,'application/json');
    if(fresh.getBlob().getDataAsString('UTF-8')!==serialized)throw Error('NEW_CHECKPOINT_READBACK_FAILED_POINTER_UNCHANGED');
    // Recheck the pointer immediately before its single-property commit.
    if(p.getProperty(c.KEY)!==ptrRaw)throw Error('POINTER_RACE_NEW_FILE_ORPHANED');
    p.setProperty(c.KEY,JSON.stringify({folderId:k.root,stateFileId:fresh.getId()}));
    const readback=JSON.parse(p.getProperty(c.KEY));
    if(readback.stateFileId!==fresh.getId())throw Error('POINTER_SWAP_READBACK_FAILED');
    const confirmed=qboCdcProspectiveStateV1244_();
    if(confirmed.state.prospectiveWatermark!==k.windowEnd||confirmed.state.enabled!==false||confirmed.state.active!==null)throw Error('RECOVERED_STATE_VERIFY_FAILED');
    report.result='RECOVERED_PAUSED';report.checkpointReplaced=true;report.watermarkAdvanced=true;
    report.newCheckpointFileId=fresh.getId();
  }
 }catch(e){report.errors.push(String(e.message||e));}
 finally{if(lock)lock.releaseLock();}
 console.log('[NATIVE CDC V1344] | '+report.mode+' | '+JSON.stringify(report));
 return report;
}
function previewQboNativeCdcManifestCheckpointRecoveryV1344(){return qboCdcV1344Review_(false);}
function commitQboNativeCdcManifestCheckpointRecoveryV1344(){return qboCdcV1344Review_(true);}
