/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3797_QBO_ObservationIndexArtifact2540EvidenceDiagnostic.js
 * Version     : 1.5.186
 * Purpose     : Read-only diagnostic for the exact historical shard-drain
 *               INVALID_JSON failure at artifact cursor 2540.
 */

function diagnoseQboObservationIndexArtifact2540EvidenceV186(){
  const findings=[];
  const expectedRun='OBS_INDEX_V170|f03b49ad-69bc-4300-bf11-c769dbe72a0b';
  const expectedFileId='12EY1mLyXBeWti1fffyxTyO-6CefuoZnU';
  const state=qboObservationIndexV170LoadState_();

  if(!state) findings.push('STATE_MISSING');
  if(state&&String(state.runId)!==expectedRun) findings.push('RUN_ID_CHANGED');
  if(state&&String(state.status)!=='FAILED_SHARD_DRAIN') findings.push('STATUS_NOT_FAILED_SHARD_DRAIN '+state.status);
  if(state&&Number(state.artifactCursor)!==2540) findings.push('CURSOR_NOT_2540 '+state.artifactCursor);
  if(state&&Number(state.processedArtifactCount)!==2540) findings.push('PROCESSED_NOT_2540 '+state.processedArtifactCount);
  if(state&&Number(state.indexedObservationCount)!==517762) findings.push('INDEXED_NOT_517762 '+state.indexedObservationCount);
  if(state&&Number(state.admittedCount)!==517706) findings.push('ADMITTED_NOT_517706 '+state.admittedCount);
  if(state&&Number(state.evidenceExceptionCount)!==36) findings.push('EVIDENCE_EXCEPTION_NOT_36 '+state.evidenceExceptionCount);
  if(state&&Number(state.blockedCount)!==20) findings.push('BLOCKED_NOT_20 '+state.blockedCount);
  if(state&&Number(state.governedExcludedObservationCount||0)!==55) findings.push('EXCLUDED_NOT_55 '+state.governedExcludedObservationCount);
  if(state&&String(state.error||'')!=='OBS_INDEX_V179_INVALID_JSON fileId='+expectedFileId)
    findings.push('ERROR_CHANGED '+String(state.error||''));

  const artifacts=qboPayloadArtifactReadRows_();
  if(artifacts.length!==3455) findings.push('ARTIFACT_COUNT '+artifacts.length);
  const cursor=2540, artifact=artifacts[cursor];
  if(!artifact) findings.push('BOUNDARY_ARTIFACT_MISSING');
  if(artifact&&String(artifact.PayloadFileId||'')!==expectedFileId)
    findings.push('BOUNDARY_FILE_ID_CHANGED '+String(artifact.PayloadFileId||''));

  const fileInspection=artifact?qboObservationIndexV186InspectRawFile_(artifact,findings):null;
  const sourceLineage=artifact?qboObservationIndexV186InspectSourceLineage_(artifact,findings):null;

  let triggerIds=[],triggerServiceError='';
  try{
    triggerIds=ScriptApp.getProjectTriggers().filter(function(t){
      return t.getHandlerFunction()===QBO_OBSERVATION_INDEX_SHARD_DRAIN_V181_.CONTINUATION_HANDLER;
    }).map(function(t){return String(t.getUniqueId()||'');});
  }catch(e){
    triggerServiceError=String(e&&e.message?e.message:e);
    findings.push('TRIGGER_SERVICE_UNAVAILABLE '+triggerServiceError);
  }

  const out={
    version:'1.5.186',
    operation:'OBSERVATION_INDEX_ARTIFACT_2540_EVIDENCE_DIAGNOSTIC',
    runId:state?String(state.runId||''):'',
    status:state?String(state.status||''):'',
    artifactCursor:state?Number(state.artifactCursor):null,
    indexedObservationCount:state?Number(state.indexedObservationCount):null,
    admittedCount:state?Number(state.admittedCount):null,
    evidenceExceptionCount:state?Number(state.evidenceExceptionCount):null,
    blockedCount:state?Number(state.blockedCount):null,
    governedExcludedObservationCount:state?Number(state.governedExcludedObservationCount||0):0,
    artifact:artifact?{
      ingestionSourceId:String(artifact.IngestionSourceId||''),
      sourceType:String(artifact.SourceType||''),
      sourceRunId:String(artifact.SourceRunId||''),
      ingestionRunId:String(artifact.IngestionRunId||''),
      workUnitId:String(artifact.WorkUnitId||''),
      recordCursorStart:String(artifact.RecordCursorStart||''),
      recordCursorEndExclusive:String(artifact.RecordCursorEndExclusive||''),
      observationCount:Number(artifact.ObservationCount||0),
      payloadCount:Number(artifact.PayloadCount||0),
      payloadFileId:String(artifact.PayloadFileId||''),
      payloadFileName:String(artifact.PayloadFileName||''),
      registeredPayloadShardHash:String(artifact.PayloadShardHash||''),
      registrationMode:String(artifact.RegistrationMode||''),
      lineageStatus:String(artifact.LineageStatus||''),
      contentVerifiedAt:String(artifact.ContentVerifiedAt||'')
    }:null,
    rawFileInspection:fileInspection,
    sourceLineage:sourceLineage,
    continuationTriggerIds:triggerIds,
    continuationTriggerCount:triggerIds.length,
    triggerServiceError:triggerServiceError,
    findingCount:findings.length,
    findings:findings,
    diagnosticCompleted:!!artifact&&!!fileInspection,
    safety:{
      driveWritesPerformed:false,
      workbookWritesPerformed:false,
      scriptPropertiesMutationPerformed:false,
      triggerMutationPerformed:false
    }
  };
  console.log('[OBSERVATION INDEX SHARD DRAIN V186] | ARTIFACT_2540_EVIDENCE_DIAGNOSTIC | '+JSON.stringify(out));
  return out;
}

function qboObservationIndexV186InspectRawFile_(artifact,findings){
  const id=String(artifact.PayloadFileId||'');
  let file,blob,bytes,text;
  try{
    file=qboObsIndexV184DriveReadRetry_(function(){return DriveApp.getFileById(id);});
    blob=qboObsIndexV184DriveReadRetry_(function(){return file.getBlob();});
    bytes=blob.getBytes();
    text=blob.getDataAsString('UTF-8');
  }catch(e){
    findings.push('PAYLOAD_FILE_READ_FAILED '+String(e&&e.message||e));
    return {fileId:id,readable:false,error:String(e&&e.message||e)};
  }

  const trimmed=String(text||'').replace(/^\uFEFF/,'').trim();
  const rawHash=qboObservationIndexV186Sha256Bytes_(bytes);
  const registered=String(artifact.PayloadShardHash||'');
  let jsonValid=false,jsonError='',rootType='',rootKeys=[],stableBodyPresent=false,
      schema='',declaredObservationCount=null,declaredPayloadCount=null,
      stableBodyCanonicalHash='',registeredHashMatchesStableBody=null;

  try{
    const obj=JSON.parse(trimmed);
    jsonValid=true;
    rootType=Array.isArray(obj)?'array':(obj===null?'null':typeof obj);
    if(obj&&typeof obj==='object'&&!Array.isArray(obj)){
      rootKeys=Object.keys(obj).sort();
      stableBodyPresent=!!obj.stableBody;
      schema=String(obj.schema||obj.schemaVersion||'');
      if(obj.stableBody&&typeof obj.stableBody==='object'){
        declaredObservationCount=obj.stableBody.observationCount==null?null:Number(obj.stableBody.observationCount);
        declaredPayloadCount=obj.stableBody.payloadCount==null?null:Number(obj.stableBody.payloadCount);
        stableBodyCanonicalHash=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(obj.stableBody));
        registeredHashMatchesStableBody=(stableBodyCanonicalHash===registered);
      }
    }
  }catch(e){ jsonError=String(e&&e.message||e); }

  return {
    fileId:id,readable:true,
    fileName:qboObsIndexV184DriveReadRetry_(function(){return file.getName();}),
    mimeType:qboObsIndexV184DriveReadRetry_(function(){return file.getMimeType();}),
    byteCount:bytes.length,textLength:text.length,
    zeroByte:bytes.length===0,whitespaceOnly:trimmed.length===0,
    rawByteSha256:rawHash,
    registeredPayloadShardHash:registered,
    rawByteHashMatchesRegistered:rawHash===registered,
    jsonValid:jsonValid,jsonParseError:jsonError,
    rootType:rootType,rootKeys:rootKeys,stableBodyPresent:stableBodyPresent,
    schema:schema,
    declaredObservationCount:declaredObservationCount,
    declaredPayloadCount:declaredPayloadCount,
    stableBodyCanonicalHash:stableBodyCanonicalHash,
    registeredHashMatchesStableBody:registeredHashMatchesStableBody,
    expectedObservationCount:Number(artifact.ObservationCount||0),
    expectedPayloadCount:Number(artifact.PayloadCount||0),
    prefixEscaped:qboObservationIndexV186EscapeSample_(text.slice(0,200)),
    suffixEscaped:qboObservationIndexV186EscapeSample_(text.slice(Math.max(0,text.length-200)))
  };
}

function qboObservationIndexV186InspectSourceLineage_(artifact,findings){
  const sourceId=String(artifact.IngestionSourceId||'');
  const sourceType=String(artifact.SourceType||'');
  const result={ingestionSourceId:sourceId,sourceType:sourceType};
  if(sourceType==='FULL_EXPORT'){
    const map=qboObservationIndexV172FullExportObservedAtMap_();
    result.fullExportSourceRegistrationPresent=Object.prototype.hasOwnProperty.call(map,sourceId);
    result.observationCompletedAt=result.fullExportSourceRegistrationPresent?String(map[sourceId]||''):'';
    if(!result.fullExportSourceRegistrationPresent)
      findings.push('FULL_EXPORT_SOURCE_REGISTRATION_MISSING '+sourceId);
  }
  return result;
}

function qboObservationIndexV186Sha256Bytes_(bytes){
  const digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes);
  return digest.map(function(b){
    const v=(b<0?b+256:b).toString(16);
    return v.length===1?'0'+v:v;
  }).join('');
}

function qboObservationIndexV186EscapeSample_(s){
  return String(s||'').replace(/\\/g,'\\\\').replace(/\r/g,'\\r')
    .replace(/\n/g,'\\n').replace(/\t/g,'\\t');
}
