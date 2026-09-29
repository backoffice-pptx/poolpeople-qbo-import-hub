/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3795_QBO_ObservationIndexShardCommitDiagnostic.js
 * Version     : 1.5.184
 * Purpose     : Read-only diagnostic of the exact v1.5.182 Drive failure at
 *               historical artifact cursor 1864. No writes/properties/triggers.
 */

function diagnoseQboObservationIndexShardCommitBoundaryV183(){
  const findings=[];
  const state=qboObservationIndexV170LoadState_();
  const expectedRun='OBS_INDEX_V170|f03b49ad-69bc-4300-bf11-c769dbe72a0b';

  if(!state) findings.push('STATE_MISSING');
  if(state&&String(state.runId)!==expectedRun) findings.push('RUN_ID_CHANGED');
  if(state&&String(state.status)!=='FAILED_SHARD_DRAIN') findings.push('STATUS_NOT_FAILED_SHARD_DRAIN '+state.status);
  if(state&&Number(state.artifactCursor)!==1864) findings.push('CURSOR_NOT_1864 '+state.artifactCursor);
  if(state&&Number(state.processedArtifactCount)!==1864) findings.push('PROCESSED_NOT_1864 '+state.processedArtifactCount);
  if(state&&Number(state.indexedObservationCount)!==363554) findings.push('INDEXED_NOT_363554 '+state.indexedObservationCount);
  if(state&&String(state.error||'')!=='Service error: Drive') findings.push('ERROR_NOT_DRIVE_SERVICE '+String(state.error||''));

  const artifacts=qboPayloadArtifactReadRows_();
  if(artifacts.length!==3455) findings.push('ARTIFACT_COUNT '+artifacts.length);
  const cursor=1864, artifact=artifacts[cursor];
  if(!artifact) findings.push('BOUNDARY_ARTIFACT_MISSING');

  let prepared=null, expected=null, physical=null;
  if(artifact){
    try{
      const map=qboObservationIndexV172FullExportObservedAtMap_();
      prepared=qboObservationIndexV179PrepareArtifact_(artifact,cursor,state,map);
      expected=qboObservationIndexV183ExpectedPhysical_(prepared);
      physical=qboObservationIndexV183InspectPhysical_(expected);
      (physical.findings||[]).forEach(function(x){findings.push(x);});
    }catch(e){
      findings.push('BOUNDARY_RECONSTRUCTION_FAILED '+String(e&&e.message||e));
    }
  }

  const oldTriggers=ScriptApp.getProjectTriggers().filter(function(t){
    return t.getHandlerFunction()===QBO_OBSERVATION_INDEX_BACKFILL_V170_.CONTINUATION_HANDLER;
  }).length;
  const drainTriggers=ScriptApp.getProjectTriggers().filter(function(t){
    return t.getHandlerFunction()===QBO_OBSERVATION_INDEX_SHARD_DRAIN_V181_.CONTINUATION_HANDLER;
  }).length;
  if(oldTriggers) findings.push('LEGACY_CONTINUATION_PRESENT '+oldTriggers);
  if(drainTriggers) findings.push('DRAIN_CONTINUATION_PRESENT_AFTER_FAILURE '+drainTriggers);

  const out={
    version:'1.5.183',
    operation:'OBSERVATION_INDEX_SHARD_COMMIT_BOUNDARY_DIAGNOSTIC',
    runId:state?String(state.runId||''):'',
    status:state?String(state.status||''):'',
    artifactCursor:state?Number(state.artifactCursor):null,
    processedArtifactCount:state?Number(state.processedArtifactCount):null,
    indexedObservationCount:state?Number(state.indexedObservationCount):null,
    admittedCount:state?Number(state.admittedCount):null,
    evidenceExceptionCount:state?Number(state.evidenceExceptionCount):null,
    blockedCount:state?Number(state.blockedCount):null,
    governedExcludedObservationCount:state?Number(state.governedExcludedObservationCount||0):0,
    boundaryArtifact:artifact?{
      ingestionSourceId:String(artifact.IngestionSourceId||''),
      payloadFileId:String(artifact.PayloadFileId||''),
      payloadShardHash:String(artifact.PayloadShardHash||''),
      observationCount:Number(artifact.ObservationCount||0),
      payloadCount:Number(artifact.PayloadCount||0)
    }:null,
    expectedPhysical:expected,
    physicalCommitState:physical,
    legacyContinuationTriggerCount:oldTriggers,
    drainContinuationTriggerCount:drainTriggers,
    findingCount:findings.length,
    findings:findings,
    valid:findings.length===0,
    safety:{
      driveWritesPerformed:false,
      workbookWritesPerformed:false,
      scriptPropertiesMutationPerformed:false,
      triggerMutationPerformed:false
    }
  };
  console.log('[OBSERVATION INDEX SHARD DRAIN V183] | COMMIT_BOUNDARY_DIAGNOSTIC | '+JSON.stringify(out));
  return out;
}

function qboObservationIndexV183ExpectedPhysical_(prepared){
  // The shard hash/name are fully deterministic before any physical file ID.
  return {
    shardFileName:prepared.shardName,
    shardHash:prepared.shardHash,
    lookupFileName:prepared.lookupName,
    manifestFileName:prepared.manifestName,
    observationCount:prepared.observationIds.length
  };
}

function qboObservationIndexV183InspectPhysical_(expected){
  const folders=qboObsIndexV175ResolveFolders_(), findings=[];
  const shard=qboObservationIndexV183FindSingle_(folders.shards,expected.shardFileName,'SHARD',findings);
  const lookup=qboObservationIndexV183FindSingle_(folders.lookup,expected.lookupFileName,'LOOKUP',findings);
  const manifest=qboObservationIndexV183FindSingle_(folders.manifests,expected.manifestFileName,'MANIFEST',findings);

  let shardObj=null,lookupObj=null,manifestObj=null;
  if(shard){
    shardObj=qboObservationIndexV183ReadJson_(shard,'SHARD',findings);
    if(shardObj){
      const actual=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(shardObj.stableBody));
      if(String(shardObj.shardHash||'')!==expected.shardHash||actual!==expected.shardHash)
        findings.push('SHARD_HASH_CONFLICT');
      if(Number((shardObj.stableBody||{}).observationCount||0)!==Number(expected.observationCount))
        findings.push('SHARD_COUNT_CONFLICT');
    }
  }
  if(lookup){
    lookupObj=qboObservationIndexV183ReadJson_(lookup,'LOOKUP',findings);
    if(lookupObj){
      const actual=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(lookupObj.stableBody));
      if(String(lookupObj.lookupHash||'')!==actual) findings.push('LOOKUP_SELF_HASH_CONFLICT');
      if(shard&&String((lookupObj.stableBody||{}).shardFileId||'')!==shard.getId())
        findings.push('LOOKUP_SHARD_FILE_ID_CONFLICT');
      if(String((lookupObj.stableBody||{}).shardHash||'')!==expected.shardHash)
        findings.push('LOOKUP_SHARD_HASH_CONFLICT');
    }
  }
  if(manifest){
    manifestObj=qboObservationIndexV183ReadJson_(manifest,'MANIFEST',findings);
    if(manifestObj){
      const actual=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(manifestObj.stableBody));
      if(String(manifestObj.manifestHash||'')!==actual) findings.push('MANIFEST_SELF_HASH_CONFLICT');
      if(shard&&String((manifestObj.stableBody||{}).shardFileId||'')!==shard.getId())
        findings.push('MANIFEST_SHARD_FILE_ID_CONFLICT');
      if(lookup&&String((manifestObj.stableBody||{}).lookupFileId||'')!==lookup.getId())
        findings.push('MANIFEST_LOOKUP_FILE_ID_CONFLICT');
      if(String((manifestObj.stableBody||{}).shardHash||'')!==expected.shardHash)
        findings.push('MANIFEST_SHARD_HASH_CONFLICT');
      if(lookupObj&&String((manifestObj.stableBody||{}).lookupHash||'')!==String(lookupObj.lookupHash||''))
        findings.push('MANIFEST_LOOKUP_HASH_CONFLICT');
      if(Number((manifestObj.stableBody||{}).observationCount||0)!==Number(expected.observationCount))
        findings.push('MANIFEST_COUNT_CONFLICT');
    }
  }

  let classification='NO_FILES';
  if(shard&&!lookup&&!manifest) classification='SHARD_ONLY_PARTIAL';
  else if(shard&&lookup&&!manifest) classification='SHARD_LOOKUP_PARTIAL';
  else if(shard&&lookup&&manifest) classification=findings.length?'FULL_SET_CONFLICT':'FULL_COMMIT_PRESENT_UNCHECKPOINTED';
  else if(!shard&&lookup&&!manifest) classification='LOOKUP_WITHOUT_SHARD_CONFLICT';
  else if(!shard&&!lookup&&manifest) classification='MANIFEST_WITHOUT_DEPENDENCIES_CONFLICT';
  else if(!shard&&lookup&&manifest) classification='LOOKUP_MANIFEST_WITHOUT_SHARD_CONFLICT';
  else if(shard&&!lookup&&manifest) classification='SHARD_MANIFEST_WITHOUT_LOOKUP_CONFLICT';

  return {
    classification:classification,
    shard:{exists:!!shard,fileId:shard?shard.getId():'',fileName:expected.shardFileName},
    lookup:{exists:!!lookup,fileId:lookup?lookup.getId():'',fileName:expected.lookupFileName,
            lookupHash:lookupObj?String(lookupObj.lookupHash||''):''},
    manifest:{exists:!!manifest,fileId:manifest?manifest.getId():'',fileName:expected.manifestFileName,
              manifestHash:manifestObj?String(manifestObj.manifestHash||''):''},
    manifestCommitMarkerPresent:!!manifest,
    durableCommitVerified:!!(shard&&lookup&&manifest&&findings.length===0),
    safeCreateOrVerifyRetryCandidate:findings.length===0,
    findings:findings
  };
}

function qboObservationIndexV183FindSingle_(folder,name,label,findings){
  let it;
  try{ it=qboObservationIndexV183DriveRetry_(function(){return folder.getFilesByName(name);}); }
  catch(e){ findings.push(label+'_LIST_FAILED '+String(e&&e.message||e)); return null; }
  let first=null,count=0;
  try{
    while(qboObservationIndexV183DriveRetry_(function(){return it.hasNext();})){
      const f=qboObservationIndexV183DriveRetry_(function(){return it.next();});
      count++; if(!first) first=f;
      if(count>1) break;
    }
  }catch(e){findings.push(label+'_ITERATION_FAILED '+String(e&&e.message||e));return first;}
  if(count>1) findings.push(label+'_DUPLICATE_FILE name='+name);
  return first;
}

function qboObservationIndexV183ReadJson_(file,label,findings){
  try{
    const text=qboObservationIndexV183DriveRetry_(function(){return file.getBlob().getDataAsString('UTF-8');});
    return JSON.parse(text);
  }catch(e){findings.push(label+'_READ_FAILED '+String(e&&e.message||e));return null;}
}

function qboObservationIndexV183DriveRetry_(fn){
  let last=null;
  for(let i=0;i<3;i++){
    try{return fn();}
    catch(e){last=e;if(i<2)Utilities.sleep(1000*(i+1));}
  }
  throw last;
}


function validateQboObservationIndexDrivePartialRecoveryV184(){
  const findings=[],state=qboObservationIndexV170LoadState_();
  const expectedRun='OBS_INDEX_V170|f03b49ad-69bc-4300-bf11-c769dbe72a0b';
  if(!state)findings.push('STATE_MISSING');
  if(state&&String(state.runId)!==expectedRun)findings.push('RUN_ID_CHANGED');
  if(state&&String(state.status)!=='FAILED_SHARD_DRAIN')findings.push('STATUS_NOT_FAILED_SHARD_DRAIN '+state.status);
  if(state&&Number(state.artifactCursor)!==1864)findings.push('CURSOR_NOT_1864 '+state.artifactCursor);
  if(state&&Number(state.processedArtifactCount)!==1864)findings.push('PROCESSED_NOT_1864 '+state.processedArtifactCount);
  if(state&&Number(state.indexedObservationCount)!==363554)findings.push('INDEXED_NOT_363554 '+state.indexedObservationCount);
  if(state&&Number(state.admittedCount)!==363510)findings.push('ADMITTED_NOT_363510 '+state.admittedCount);
  if(state&&Number(state.evidenceExceptionCount)!==24)findings.push('EVIDENCE_EXCEPTION_NOT_24 '+state.evidenceExceptionCount);
  if(state&&Number(state.blockedCount)!==20)findings.push('BLOCKED_NOT_20 '+state.blockedCount);
  if(state&&Number(state.governedExcludedObservationCount||0)!==55)findings.push('EXCLUDED_NOT_55 '+state.governedExcludedObservationCount);
  if(state&&String(state.error||'')!=='Service error: Drive')findings.push('ERROR_NOT_DRIVE_SERVICE');

  const artifacts=qboPayloadArtifactReadRows_(),cursor=1864,artifact=artifacts[cursor];
  if(artifacts.length!==3455)findings.push('ARTIFACT_COUNT '+artifacts.length);
  let expected=null,physical=null;
  try{
    const map=qboObservationIndexV172FullExportObservedAtMap_();
    const prepared=qboObservationIndexV179PrepareArtifact_(artifact,cursor,state,map);
    expected=qboObservationIndexV183ExpectedPhysical_(prepared);
    physical=qboObservationIndexV183InspectPhysical_(expected);
    if(physical.classification!=='SHARD_LOOKUP_PARTIAL')findings.push('PHYSICAL_STATE_NOT_SHARD_LOOKUP_PARTIAL '+physical.classification);
    if(!physical.safeCreateOrVerifyRetryCandidate)findings.push('NOT_SAFE_CREATE_OR_VERIFY_RETRY');
    if((physical.findings||[]).length)physical.findings.forEach(function(x){findings.push(x);});
  }catch(e){findings.push('BOUNDARY_RECONSTRUCTION_FAILED '+String(e&&e.message||e));}

  const drainTriggers=ScriptApp.getProjectTriggers().filter(function(t){
    return t.getHandlerFunction()===QBO_OBSERVATION_INDEX_SHARD_DRAIN_V181_.CONTINUATION_HANDLER;
  }).length;
  if(drainTriggers)findings.push('DRAIN_CONTINUATION_PRESENT '+drainTriggers);

  const out={version:'1.5.184',operation:'OBSERVATION_INDEX_DRIVE_PARTIAL_RECOVERY_GATE',
    runId:state?String(state.runId||''):'',status:state?String(state.status||''):'',
    artifactCursor:state?Number(state.artifactCursor):null,indexedObservationCount:state?Number(state.indexedObservationCount):null,
    expectedPhysical:expected,physicalCommitState:physical,drainContinuationTriggerCount:drainTriggers,
    retryPolicy:{transientDriveOnly:true,maxAttempts:QBO_OBS_INDEX_DRIVE_RETRY_V184_.MAX_ATTEMPTS,
      baseDelayMs:QBO_OBS_INDEX_DRIVE_RETRY_V184_.BASE_DELAY_MS,
      semanticConflictsRetried:false,ambiguousCreateRelistedBeforeRetry:true},
    findingCount:findings.length,findings:findings,valid:findings.length===0,
    safety:{driveWritesPerformed:false,workbookWritesPerformed:false,scriptPropertiesMutationPerformed:false,triggerMutationPerformed:false}};
  console.log('[OBSERVATION INDEX SHARD DRAIN V184] | DRIVE_PARTIAL_RECOVERY_GATE | '+JSON.stringify(out));
  return out;
}
