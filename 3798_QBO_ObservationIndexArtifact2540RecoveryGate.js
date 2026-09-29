/**
 * Version 1.5.187
 * Read-only gate for exact cursor-2540 transient invalid-JSON recovery.
 */
function validateQboObservationIndexArtifact2540RecoveryV187(){
  const findings=[],s=qboObservationIndexV170LoadState_();
  const fileId='12EY1mLyXBeWti1fffyxTyO-6CefuoZnU';
  if(!s)findings.push('STATE_MISSING');
  if(s&&String(s.runId)!=='OBS_INDEX_V170|f03b49ad-69bc-4300-bf11-c769dbe72a0b')findings.push('RUN_ID_CHANGED');
  if(s&&String(s.status)!=='FAILED_SHARD_DRAIN')findings.push('STATUS_NOT_FAILED '+s.status);
  if(s&&Number(s.artifactCursor)!==2540)findings.push('CURSOR_NOT_2540 '+s.artifactCursor);
  if(s&&Number(s.processedArtifactCount)!==2540)findings.push('PROCESSED_NOT_2540 '+s.processedArtifactCount);
  if(s&&Number(s.indexedObservationCount)!==517762)findings.push('INDEXED_NOT_517762 '+s.indexedObservationCount);
  if(s&&Number(s.admittedCount)!==517706)findings.push('ADMITTED_NOT_517706 '+s.admittedCount);
  if(s&&Number(s.evidenceExceptionCount)!==36)findings.push('EXCEPTIONS_NOT_36 '+s.evidenceExceptionCount);
  if(s&&Number(s.blockedCount)!==20)findings.push('BLOCKED_NOT_20 '+s.blockedCount);
  if(s&&Number(s.governedExcludedObservationCount||0)!==55)findings.push('EXCLUDED_NOT_55 '+s.governedExcludedObservationCount);
  if(s&&String(s.error||'')!=='OBS_INDEX_V179_INVALID_JSON fileId='+fileId)findings.push('ERROR_CHANGED '+String(s.error||''));

  const artifacts=qboPayloadArtifactReadRows_(),a=artifacts[2540];
  if(artifacts.length!==3455)findings.push('ARTIFACT_COUNT '+artifacts.length);
  if(!a)findings.push('ARTIFACT_2540_MISSING');
  if(a&&String(a.PayloadFileId||'')!==fileId)findings.push('FILE_ID_CHANGED '+String(a.PayloadFileId||''));

  let evidence=null;
  try{
    const env=qboObservationIndexV187ReadPayloadEnvelope_(fileId);
    const body=env&&env.stableBody;
    const actual=body?qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(body)):'';
    evidence={
      jsonReadable:true,
      registeredHash:String(a.PayloadShardHash||''),
      canonicalStableBodyHash:actual,
      hashMatch:actual===String(a.PayloadShardHash||'')&&String(env.shardHash||'')===String(a.PayloadShardHash||''),
      observationCount:body?Number(body.observationCount||0):null,
      payloadVectorCount:body&&Array.isArray(body.payloads)?body.payloads.length:null,
      observationIdVectorCount:body&&Array.isArray(body.observationIds)?body.observationIds.length:null
    };
    if(!evidence.hashMatch)findings.push('CANONICAL_HASH_MISMATCH');
    if(evidence.observationCount!==250||evidence.payloadVectorCount!==250||evidence.observationIdVectorCount!==250)
      findings.push('COUNT_VECTOR_MISMATCH');
  }catch(e){findings.push('BOUNDED_READ_FAILED '+String(e&&e.message||e));}

  let triggerIds=[];
  try{triggerIds=ScriptApp.getProjectTriggers().filter(function(t){
    return t.getHandlerFunction()===QBO_OBSERVATION_INDEX_SHARD_DRAIN_V181_.CONTINUATION_HANDLER;
  }).map(function(t){return String(t.getUniqueId()||'');});}
  catch(e){findings.push('TRIGGER_SERVICE_UNAVAILABLE '+String(e&&e.message||e));}
  if(triggerIds.length)findings.push('CONTINUATION_PRESENT '+triggerIds.join(','));

  const out={version:'1.5.187',operation:'OBSERVATION_INDEX_ARTIFACT_2540_RECOVERY_GATE',
    runId:s?String(s.runId||''):'',status:s?String(s.status||''):'',
    artifactCursor:s?Number(s.artifactCursor):null,indexedObservationCount:s?Number(s.indexedObservationCount):null,
    evidence:evidence,continuationTriggerIds:triggerIds,
    readPolicy:{maxAttempts:QBO_OBSERVATION_INDEX_PAYLOAD_READ_V187_.MAX_ATTEMPTS,
      baseDelayMs:QBO_OBSERVATION_INDEX_PAYLOAD_READ_V187_.BASE_DELAY_MS,
      retryParseFailure:true,semanticEvidenceFailuresRetried:false},
    findingCount:findings.length,findings:findings,valid:findings.length===0,
    safety:{driveWritesPerformed:false,workbookWritesPerformed:false,scriptPropertiesMutationPerformed:false,triggerMutationPerformed:false}};
  console.log('[OBSERVATION INDEX SHARD DRAIN V187] | ARTIFACT_2540_RECOVERY_GATE | '+JSON.stringify(out));
  return out;
}
