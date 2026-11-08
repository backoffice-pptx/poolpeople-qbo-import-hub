/** One-time, explicitly authorized checkpoint storage migration. Capture MUST remain paused. */
const QBO_CDC_CHECKPOINT_MOVE_V1356_ = Object.freeze({
  ROOT_ID:'1wuIk1bYM2hu78M7KcsXhAlmP39O8wh99',
  EXPECTED_WATERMARK:'2026-11-07T22:28:28.748Z',
  EXPECTED_COMMITTED_CYCLE:'900af1b2-577f-43bd-93d9-7f0ccf27cf8c',
  EXPECTED_ORIGINAL_FILE:'1d2fIL6qwjZ7p8IlXGGOoMUAyDIKU7XPU'
});
function qboCdcV1356Child_(parent,name,create){
  const it=parent.getFoldersByName(name);
  if(it.hasNext()){const f=it.next();if(it.hasNext())throw Error('V1356_DUPLICATE_FOLDER_'+name);return f;}
  if(!create)return null;
  return parent.createFolder(name);
}
function qboCdcV1356Preflight_(){
  const c=QBO_CDC_PROSPECTIVE_V1244_,p=PropertiesService.getScriptProperties(),m=QBO_CDC_CHECKPOINT_MOVE_V1356_;
  if(p.getProperty(c.CONTROL)!=='PAUSED'||p.getProperty(c.HALT))throw Error('V1356_NOT_CLEANLY_PAUSED');
  if(ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()===c.HANDLER))throw Error('V1356_WORKER_TRIGGER_PRESENT');
  const ptrRaw=p.getProperty(c.KEY);if(!ptrRaw)throw Error('V1356_POINTER_MISSING');
  const ptr=JSON.parse(ptrRaw),ctx=qboCdcProspectiveStateV1244_(),s=ctx.state;
  if(s.active||s.status!=='READY'||s.prospectiveWatermark!==m.EXPECTED_WATERMARK||!s.lastCommitted||s.lastCommitted.cycleId!==m.EXPECTED_COMMITTED_CYCLE||s.ingestionAuthorized!==false)throw Error('V1356_STATE_CHANGED');
  if(!qboNativeCdcIsPaused_())throw Error('V1356_LEGACY_NOT_PAUSED');
  return {c,p,m,ptrRaw,ptr,ctx,s};
}
function previewQboNativeCdcCheckpointMigrationV1356(){
  const x=qboCdcV1356Preflight_(),root=DriveApp.getFolderById(x.m.ROOT_ID);
  if(root.getName()!=='Native CDC')throw Error('V1356_ROOT_NOT_NATIVE_CDC');
  const checkpoints=qboCdcV1356Child_(root,'Checkpoints',false);
  const destination=checkpoints&&qboCdcV1356Child_(checkpoints,'Prospective',false);
  const files=x.ctx.folder.getFiles();let count=0;
  while(files.hasNext()){const f=files.next();if(/^checkpoint(?:_v1350_[^/]+)?\.json$/.test(f.getName()))count++;}
  const out={mode:'READ_ONLY',control:'PAUSED',sourceFolderId:x.ptr.folderId,currentFileId:x.ptr.stateFileId,destinationFolderId:destination?destination.getId():null,checkpointFilesToMove:count,watermark:x.s.prospectiveWatermark,activeCycle:null,ingestionAuthorized:false};
  console.log('[NATIVE CDC V1356] | PREVIEW | '+JSON.stringify(out));return out;
}
function migrateQboNativeCdcCheckpointsV1356(){
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw Error('V1356_WORKER_LOCK_BUSY');
  try{
    const x=qboCdcV1356Preflight_(),root=DriveApp.getFolderById(x.m.ROOT_ID);
    if(root.getName()!=='Native CDC')throw Error('V1356_ROOT_NOT_NATIVE_CDC');
    const checkpoints=qboCdcV1356Child_(root,'Checkpoints',true),destination=qboCdcV1356Child_(checkpoints,'Prospective',true);
    if(x.ptr.folderId===destination.getId())return {action:'ALREADY_MIGRATED',stateFileId:x.ptr.stateFileId,folderId:destination.getId()};
    if(x.ptr.stateFileId!==x.m.EXPECTED_ORIGINAL_FILE)throw Error('V1356_CURRENT_CHECKPOINT_CHANGED');
    const src=x.ctx.folder,files=src.getFiles(),move=[];
    while(files.hasNext()){const f=files.next();if(/^checkpoint(?:_v1350_[^/]+)?\.json$/.test(f.getName()))move.push(f);}
    if(!move.some(f=>f.getId()===x.ptr.stateFileId))throw Error('V1356_CURRENT_CHECKPOINT_NOT_IN_SOURCE');
    // Move files without changing IDs or bytes. Until pointer publication, old pointer remains readable.
    move.forEach(f=>{f.moveTo(destination);if(f.getParents().next().getId()!==destination.getId())throw Error('V1356_MOVE_NOT_VERIFIED_'+f.getId());});
    const next=JSON.parse(JSON.stringify(x.s));next.folderId=destination.getId();
    const raw=JSON.stringify(next,null,2),fresh=destination.createFile('checkpoint_v1350_'+Utilities.getUuid()+'.json',raw,'application/json');
    if(fresh.getBlob().getDataAsString('UTF-8')!==raw)throw Error('V1356_NEW_CHECKPOINT_READBACK_FAILED');
    if(x.p.getProperty(x.c.KEY)!==x.ptrRaw||x.p.getProperty(x.c.CONTROL)!=='PAUSED'||x.p.getProperty(x.c.HALT))throw Error('V1356_COMMIT_FENCE_FAILED');
    x.p.setProperty(x.c.KEY,JSON.stringify({folderId:destination.getId(),stateFileId:fresh.getId()}));
    const verified=qboCdcProspectiveStateV1244_();
    if(verified.file.getId()!==fresh.getId()||verified.state.prospectiveWatermark!==x.m.EXPECTED_WATERMARK||verified.state.active||verified.state.lastCommitted.manifestFileId!==x.s.lastCommitted.manifestFileId)throw Error('V1356_POST_COMMIT_VERIFY_FAILED');
    const out={action:'MIGRATED_PAUSED',movedCheckpointFiles:move.length,sourceFolderId:src.getId(),destinationFolderId:destination.getId(),stateFileId:fresh.getId(),watermark:verified.state.prospectiveWatermark,ingestionAuthorized:false};
    console.log('[NATIVE CDC V1356] | MIGRATED | '+JSON.stringify(out));return out;
  }finally{lock.releaseLock();}
}
