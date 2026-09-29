function validateQboObservationIndexFolderResolutionRecoveryV188(){
  const findings=[],s=qboObservationIndexV170LoadState_();
  const expectedRun='OBS_INDEX_V170|f03b49ad-69bc-4300-bf11-c769dbe72a0b';
  if(!s)findings.push('STATE_MISSING');
  if(s&&String(s.runId)!==expectedRun)findings.push('RUN_ID_CHANGED');
  if(s&&String(s.status)!=='FAILED_SHARD_DRAIN')findings.push('STATUS_NOT_FAILED '+s.status);
  if(s&&Number(s.artifactCursor)!==3132)findings.push('CURSOR_NOT_3132 '+s.artifactCursor);
  if(s&&Number(s.processedArtifactCount)!==3132)findings.push('PROCESSED_NOT_3132 '+s.processedArtifactCount);
  if(s&&Number(s.indexedObservationCount)!==658432)findings.push('INDEXED_NOT_658432 '+s.indexedObservationCount);
  if(s&&Number(s.admittedCount)!==658364)findings.push('ADMITTED_NOT_658364 '+s.admittedCount);
  if(s&&Number(s.evidenceExceptionCount)!==48)findings.push('EXCEPTIONS_NOT_48 '+s.evidenceExceptionCount);
  if(s&&Number(s.blockedCount)!==20)findings.push('BLOCKED_NOT_20 '+s.blockedCount);
  if(s&&Number(s.reconciledArtifactCount||0)!==1)findings.push('RECONCILED_NOT_1 '+s.reconciledArtifactCount);
  if(s&&Number(s.governedExcludedObservationCount||0)!==55)findings.push('EXCLUDED_NOT_55 '+s.governedExcludedObservationCount);
  if(s&&String(s.error||'')!=='Service error: Drive')findings.push('ERROR_CHANGED '+String(s.error||''));

  let folders=null;
  try{
    const f=qboObservationIndexV188ResolveFolders_();
    folders={resolved:true,shardFolderId:String(f.shards.getId()),
      manifestFolderId:String(f.manifests.getId()),lookupFolderId:String(f.lookup.getId())};
  }catch(e){
    folders={resolved:false,error:String(e&&e.message||e)};
    findings.push('FOLDER_RESOLUTION_FAILED '+folders.error);
  }

  let ids=[];
  try{
    ids=ScriptApp.getProjectTriggers().filter(function(t){
      return t.getHandlerFunction()===QBO_OBSERVATION_INDEX_SHARD_DRAIN_V181_.CONTINUATION_HANDLER;
    }).map(function(t){return String(t.getUniqueId()||'');});
  }catch(e){findings.push('TRIGGER_SERVICE_UNAVAILABLE '+String(e&&e.message||e));}
  if(ids.length)findings.push('CONTINUATION_PRESENT '+ids.join(','));

  const out={version:'1.5.188',operation:'OBSERVATION_INDEX_FOLDER_RESOLUTION_RECOVERY_GATE',
    persistedVersion:s?String(s.version||''):'',runId:s?String(s.runId||''):'',
    status:s?String(s.status||''):'',artifactCursor:s?Number(s.artifactCursor):null,
    indexedObservationCount:s?Number(s.indexedObservationCount):null,
    admittedCount:s?Number(s.admittedCount):null,evidenceExceptionCount:s?Number(s.evidenceExceptionCount):null,
    blockedCount:s?Number(s.blockedCount):null,reconciledArtifactCount:s?Number(s.reconciledArtifactCount||0):0,
    governedExcludedObservationCount:s?Number(s.governedExcludedObservationCount||0):0,
    folderResolution:folders,
    retryPolicy:{maxAttempts:4,baseDelayMs:1000,transientDriveOnly:true,
      semanticFolderFailuresRetried:false,resolveOncePerWorkerInvocation:true},
    continuationTriggerIds:ids,continuationTriggerCount:ids.length,
    findingCount:findings.length,findings:findings,valid:findings.length===0,
    safety:{driveWritesPerformed:false,workbookWritesPerformed:false,
      scriptPropertiesMutationPerformed:false,triggerMutationPerformed:false}};
  console.log('[OBSERVATION INDEX SHARD DRAIN V188] | FOLDER_RESOLUTION_RECOVERY_GATE | '+JSON.stringify(out));
  return out;
}
