/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3790_QBO_ObservationIndexShardWriterConversionGate.js
 * Version     : 1.5.182
 * Purpose     : Read-only governed controlled-test exclusion recovery gate.
 */
function validateQboObservationIndexControlledTestExclusionRecoveryV182(){
  const findings=[],s=qboObservationIndexV170LoadState_();
  const expectedRun='OBS_INDEX_V170|f03b49ad-69bc-4300-bf11-c769dbe72a0b';
  if(!s)findings.push('STATE_MISSING');
  if(s&&String(s.runId)!==expectedRun)findings.push('RUN_ID_CHANGED');
  if(s&&String(s.status)!=='FAILED_SHARD_DRAIN')findings.push('STATUS_NOT_FAILED_SHARD_DRAIN '+s.status);
  if(s&&Number(s.artifactCursor)!==1300)findings.push('CURSOR_NOT_1300 '+s.artifactCursor);
  if(s&&Number(s.processedArtifactCount)!==1300)findings.push('PROCESSED_NOT_1300 '+s.processedArtifactCount);
  if(s&&Number(s.indexedObservationCount)!==235106)findings.push('INDEXED_NOT_235106 '+s.indexedObservationCount);
  if(s&&Number(s.admittedCount)!==235090)findings.push('ADMITTED_NOT_235090 '+s.admittedCount);
  if(s&&Number(s.evidenceExceptionCount)!==16)findings.push('EVIDENCE_EXCEPTION_NOT_16 '+s.evidenceExceptionCount);
  if(s&&Number(s.blockedCount)!==0)findings.push('BLOCKED_NOT_ZERO '+s.blockedCount);

  const artifacts=qboPayloadArtifactReadRows_();
  if(artifacts.length!==3455)findings.push('ARTIFACT_COUNT '+artifacts.length);
  const a=artifacts[1300];
  const map=qboObservationIndexV172FullExportObservedAtMap_();
  const controlled=!!a&&qboObservationIndexV182IsGovernedControlledTestOrphan_(a,map);
  if(!controlled)findings.push('BOUNDARY_NOT_GOVERNED_CONTROLLED_TEST_ORPHAN');
  let verified=null;
  if(controlled){
    try{verified=qboObservationIndexV182VerifyControlledTestOrphan_(a,1300);}
    catch(e){findings.push('BOUNDARY_EXCLUSION_VERIFY_FAILED '+String(e&&e.message||e));}
  }
  if(verified&&verified.observationCount!==55)findings.push('CONTROLLED_TEST_OBSERVATION_COUNT_NOT_55 '+verified.observationCount);

  const legacyTriggers=ScriptApp.getProjectTriggers().filter(function(t){
    return t.getHandlerFunction()===QBO_OBSERVATION_INDEX_BACKFILL_V170_.CONTINUATION_HANDLER;
  }).length;
  const v181Triggers=ScriptApp.getProjectTriggers().filter(function(t){
    return t.getHandlerFunction()===QBO_OBSERVATION_INDEX_SHARD_DRAIN_V181_.CONTINUATION_HANDLER;
  }).length;
  if(legacyTriggers)findings.push('LEGACY_CONTINUATION_PRESENT '+legacyTriggers);
  if(v181Triggers)findings.push('V181_CONTINUATION_PRESENT_AFTER_FAILURE '+v181Triggers);

  const out={
    version:'1.5.182',operation:'OBSERVATION_INDEX_CONTROLLED_TEST_EXCLUSION_RECOVERY_GATE',
    runId:s?String(s.runId||''):'',status:s?String(s.status||''):'',
    artifactCursor:s?Number(s.artifactCursor):null,indexedObservationCount:s?Number(s.indexedObservationCount):null,
    boundaryArtifact:a?{
      ingestionSourceId:String(a.IngestionSourceId||''),payloadFileId:String(a.PayloadFileId||''),
      payloadShardHash:String(a.PayloadShardHash||''),observationCount:Number(a.ObservationCount||0),
      payloadCount:Number(a.PayloadCount||0),controlledTestOrphan:controlled,sourceChronologyPresent:Object.prototype.hasOwnProperty.call(map,String(a.IngestionSourceId||''))
    }:null,
    verifiedExcludedObservationCount:verified?verified.observationCount:null,
    governedFinalEquation:{physical06ObservationCount:734913,governedControlledTestExclusionCount:55,expectedLogical07ObservationCount:734858},
    legacyContinuationTriggerCount:legacyTriggers,v181ContinuationTriggerCount:v181Triggers,
    findingCount:findings.length,findings:findings,valid:findings.length===0,
    safety:{driveWritesPerformed:false,workbookWritesPerformed:false,scriptPropertiesMutationPerformed:false,triggerMutationPerformed:false}
  };
  console.log('[OBSERVATION INDEX SHARD DRAIN V182] | EXCLUSION_RECOVERY_GATE | '+JSON.stringify(out));
  return out;
}
