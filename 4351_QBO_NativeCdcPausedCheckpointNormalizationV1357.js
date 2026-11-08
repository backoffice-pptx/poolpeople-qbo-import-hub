/** V1357: One-time paused checkpoint normalization after V1356 folder migration.
 * Does not restart capture. Do not run more than once.
 */
const QBO_CDC_V1357_ = Object.freeze({
  EXPECTED_FILE:'1gMUODNNqcGAB6MkeZBZNmJHd3ZezSLnU',
  EXPECTED_FOLDER:'17bx3bRly2sHQ27Oaq9AsrAXLDrIchEvi',
  EXPECTED_WATERMARK:'2026-11-07T22:28:28.748Z',
  EXPECTED_CYCLE:'900af1b2-577f-43bd-93d9-7f0ccf27cf8c',
  EXPECTED_MANIFEST:'1LrukH715L70nc-3wkG0G3JA6KxIY1EHi'
});
function qboCdcV1357Preflight_(){
  const c=QBO_CDC_PROSPECTIVE_V1244_,p=PropertiesService.getScriptProperties(),e=QBO_CDC_V1357_;
  if(p.getProperty(c.CONTROL)!=='PAUSED'||p.getProperty(c.HALT))throw Error('V1357_NOT_CLEANLY_PAUSED');
  if(ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()===c.HANDLER))throw Error('V1357_WORKER_TRIGGER_PRESENT');
  if(!qboNativeCdcIsPaused_())throw Error('V1357_LEGACY_CDC_NOT_PAUSED');
  const ptrRaw=p.getProperty(c.KEY),ptr=JSON.parse(ptrRaw||'null');
  if(!ptr||ptr.stateFileId!==e.EXPECTED_FILE||ptr.folderId!==e.EXPECTED_FOLDER)throw Error('V1357_POINTER_IDENTITY_CHANGED');
  const ctx=qboCdcProspectiveStateV1244_(),s=ctx.state;
  if(ctx.file.getId()!==e.EXPECTED_FILE||s.folderId!==e.EXPECTED_FOLDER||s.enabled!==true||
     s.active||s.status!=='READY'||s.prospectiveWatermark!==e.EXPECTED_WATERMARK||
     !s.lastCommitted||s.lastCommitted.cycleId!==e.EXPECTED_CYCLE||
     s.lastCommitted.manifestFileId!==e.EXPECTED_MANIFEST||
     s.ingestionAuthorized!==false||s.historicalDeletionCoverageCertified!==false)
    throw Error('V1357_STATE_IDENTITY_CHANGED');
  return {c,p,e,ptrRaw,ctx,s};
}
function previewQboNativeCdcPausedNormalizationV1357(){
  const x=qboCdcV1357Preflight_();
  const out={mode:'READ_ONLY',action:'NORMALIZE_ENABLED_FALSE_ONLY',control:'PAUSED',
    stateFileId:x.ctx.file.getId(),folderId:x.ctx.folder.getId(),
    enabledBefore:x.s.enabled,enabledAfter:false,watermark:x.s.prospectiveWatermark,
    activeCycle:null,workerTriggers:0,ingestionAuthorized:false};
  console.log('[NATIVE CDC V1357] | PREVIEW | '+JSON.stringify(out));return out;
}
function normalizeQboNativeCdcPausedCheckpointV1357(){
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(30000))throw Error('V1357_WORKER_LOCK_BUSY');
  try{
    const x=qboCdcV1357Preflight_(),next=JSON.parse(JSON.stringify(x.s));
    next.enabled=false; // Do not alter status, watermark, manifest, or any other state.
    const raw=JSON.stringify(next,null,2);
    const file=x.ctx.folder.createFile('checkpoint_v1350_'+Utilities.getUuid()+'.json',raw,'application/json');
    if(file.getBlob().getDataAsString('UTF-8')!==raw)throw Error('V1357_CHECKPOINT_READBACK_FAILED');
    // Check independent control and pointer again before publication.
    if(x.p.getProperty(x.c.KEY)!==x.ptrRaw||x.p.getProperty(x.c.CONTROL)!=='PAUSED'||
       x.p.getProperty(x.c.HALT)||
       ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()===x.c.HANDLER))
      throw Error('V1357_COMMIT_FENCE_FAILED');
    x.p.setProperty(x.c.KEY,JSON.stringify({folderId:x.e.EXPECTED_FOLDER,stateFileId:file.getId()}));
    const verified=qboCdcProspectiveStateV1244_();
    if(verified.file.getId()!==file.getId()||verified.state.enabled!==false||
       verified.state.prospectiveWatermark!==x.e.EXPECTED_WATERMARK||
       verified.state.lastCommitted.manifestFileId!==x.e.EXPECTED_MANIFEST||
       verified.state.active||verified.state.ingestionAuthorized!==false)
      throw Error('V1357_POST_COMMIT_VERIFY_FAILED');
    const out={action:'NORMALIZED_PAUSED',stateFileId:file.getId(),
      enabled:false,control:'PAUSED',watermark:verified.state.prospectiveWatermark,
      ingestionAuthorized:false};
    console.log('[NATIVE CDC V1357] | NORMALIZED | '+JSON.stringify(out));return out;
  }finally{lock.releaseLock();}
}
