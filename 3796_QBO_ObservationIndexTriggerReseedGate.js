/**
 * Version 1.5.185
 * Read-only gate for the exact trigger-service stranded boundary.
 */
function validateQboObservationIndexTriggerReseedV185(){
  const findings=[],s=qboObservationIndexV170LoadState_();
  if(!s)findings.push('STATE_MISSING');
  if(s&&String(s.runId)!=='OBS_INDEX_V170|f03b49ad-69bc-4300-bf11-c769dbe72a0b')findings.push('RUN_ID_CHANGED');
  if(s&&String(s.status)!=='RUNNING_SHARD_DRAIN')findings.push('STATUS_NOT_RUNNING '+s.status);
  if(s&&Number(s.artifactCursor)!==2062)findings.push('CURSOR_NOT_2062 '+s.artifactCursor);
  if(s&&Number(s.processedArtifactCount)!==2062)findings.push('PROCESSED_NOT_2062 '+s.processedArtifactCount);
  if(s&&Number(s.indexedObservationCount)!==408363)findings.push('INDEXED_NOT_408363 '+s.indexedObservationCount);
  if(s&&Number(s.admittedCount)!==408315)findings.push('ADMITTED_NOT_408315 '+s.admittedCount);
  if(s&&Number(s.evidenceExceptionCount)!==28)findings.push('EXCEPTIONS_NOT_28 '+s.evidenceExceptionCount);
  if(s&&Number(s.blockedCount)!==20)findings.push('BLOCKED_NOT_20 '+s.blockedCount);
  if(s&&Number(s.governedExcludedObservationCount||0)!==55)findings.push('EXCLUDED_NOT_55 '+s.governedExcludedObservationCount);
  if(s&&String(s.error||'')!=='')findings.push('STATE_ERROR_NOT_BLANK '+s.error);

  let triggers=[],triggerServiceError='';
  try{
    triggers=ScriptApp.getProjectTriggers().filter(function(t){
      return t.getHandlerFunction()===QBO_OBSERVATION_INDEX_SHARD_DRAIN_V181_.CONTINUATION_HANDLER;
    });
  }catch(e){triggerServiceError=String(e&&e.message?e.message:e);findings.push('TRIGGER_SERVICE_UNAVAILABLE '+triggerServiceError);}
  const ids=triggers.map(function(t){return String(t.getUniqueId()||'');});
  const governed=s?String(s.scheduledContinuationTriggerId||''):'';
  // Pre-v185 state has no governed trigger id. The UI-proven disabled trigger
  // may still be returned by Apps Script and is intentionally not treated as active.
  if(governed)findings.push('UNEXPECTED_GOVERNED_TRIGGER_ID '+governed);

  const out={version:'1.5.185',operation:'OBSERVATION_INDEX_TRIGGER_RESEED_GATE',
    runId:s?String(s.runId||''):'',status:s?String(s.status||''):'',
    artifactCursor:s?Number(s.artifactCursor):null,indexedObservationCount:s?Number(s.indexedObservationCount):null,
    matchingTriggerObjectCount:triggers.length,matchingTriggerObjectIds:ids,
    governedScheduledContinuationTriggerId:governed,triggerServiceError:triggerServiceError,
    repairContract:{createFutureTriggerBeforeCleanup:true,persistCreatedTriggerId:true,
      staleCleanupBestEffort:true,cleanupFailureCannotBlockWorker:true,
      firedContinuationDoesNotDeleteBeforeWorker:true},
    findingCount:findings.length,findings:findings,valid:findings.length===0,
    safety:{triggerMutationPerformed:false,scriptPropertiesMutationPerformed:false,driveWritesPerformed:false,workbookWritesPerformed:false}};
  console.log('[OBSERVATION INDEX SHARD DRAIN V185] | TRIGGER_RESEED_GATE | '+JSON.stringify(out));
  return out;
}
