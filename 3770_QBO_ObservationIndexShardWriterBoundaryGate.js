/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3770_QBO_ObservationIndexShardWriterBoundaryGate.js
 * Version     : 1.5.178
 * Purpose     : Read-only handoff gate from migrated legacy 07 shards to the
 *               first unprocessed historical 06 artifact.
 *
 * Repair from v1.5.177:
 *   Uses the actual historical backfill ledger reader qboPayloadArtifactReadRows_()
 *   and performs boundary artifact verification locally using the same governed
 *   stableBody/hash/count/vector rules as 4050 v1.5.172.
 *
 * SAFETY: no Drive/workbook/property/trigger mutation.
 */
function validateQboObservationIndexShardWriterBoundaryV178() {
  const findings=[], migration=qboObsIndexV175LoadState_(),
        historical=qboObservationIndexV170LoadState_(),
        folders=qboObsIndexV175ResolveFolders_();

  if(!migration) findings.push('V175_MIGRATION_STATE_MISSING');
  if(!historical) findings.push('V170_HISTORICAL_STATE_MISSING');
  if(migration && String(migration.status)!=='COMPLETED') findings.push('V175_NOT_COMPLETED '+migration.status);
  if(migration && Number(migration.migratedObservationCount)!==201614) findings.push('V175_COUNT_UNEXPECTED '+migration.migratedObservationCount);
  if(historical && String(historical.status)!=='FAILED') findings.push('HISTORICAL_STATUS_UNEXPECTED '+historical.status);
  if(historical && Number(historical.artifactCursor)!==1137) findings.push('HISTORICAL_CURSOR_UNEXPECTED '+historical.artifactCursor);
  if(historical && Number(historical.indexedObservationCount)!==201614) findings.push('HISTORICAL_COUNT_UNEXPECTED '+historical.indexedObservationCount);

  const manifests=qboObsIndexV175ListJsonFiles_(folders.manifests,'.manifest.json');
  const lookups=qboObsIndexV175ListJsonFiles_(folders.lookup,'.lookup.json');
  const shards=qboObsIndexV175ListJsonFiles_(folders.shards,'.json');
  if(manifests.length!==101) findings.push('MANIFEST_COUNT_UNEXPECTED '+manifests.length);
  if(lookups.length!==101) findings.push('LOOKUP_COUNT_UNEXPECTED '+lookups.length);
  if(shards.length!==101) findings.push('SHARD_COUNT_UNEXPECTED '+shards.length);

  let migratedCount=0,maxEnd=0; const migratedIds={};
  manifests.forEach(function(file){
    const m=JSON.parse(file.getBlob().getDataAsString('UTF-8')), b=m.stableBody||{};
    const sf=DriveApp.getFileById(String(b.shardFileId||'')),
          s=JSON.parse(sf.getBlob().getDataAsString('UTF-8')),
          sh=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(s.stableBody));
    if(sh!==String(b.shardHash||'')) findings.push('SHARD_HASH_MISMATCH '+file.getName());
    migratedCount+=Number(b.observationCount||0);
    maxEnd=Math.max(maxEnd,Number(b.recordCursorEndExclusive||0));
    (s.stableBody.observationIds||[]).forEach(function(id){
      id=String(id||''); if(migratedIds[id]) findings.push('DUPLICATE_MIGRATED_ID '+id); migratedIds[id]=true;
    });
    const lf=DriveApp.getFileById(String(b.lookupFileId||'')),
          l=JSON.parse(lf.getBlob().getDataAsString('UTF-8')),
          lh=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(l.stableBody));
    if(lh!==String(b.lookupHash||'')) findings.push('LOOKUP_HASH_MISMATCH '+file.getName());
    if(String(l.stableBody.shardHash||'')!==String(b.shardHash||'')) findings.push('LOOKUP_SHARD_MISMATCH '+file.getName());
  });
  if(migratedCount!==201614) findings.push('MIGRATED_COUNT_MISMATCH '+migratedCount);
  if(Object.keys(migratedIds).length!==201614) findings.push('DISTINCT_ID_COUNT_MISMATCH '+Object.keys(migratedIds).length);
  if(maxEnd!==201614) findings.push('MIGRATED_CURSOR_END_MISMATCH '+maxEnd);

  // Actual 4050 v1.5.172 historical ledger reader.
  const artifacts=qboPayloadArtifactReadRows_();
  const cursor=historical?Number(historical.artifactCursor||0):1137;
  if(historical && artifacts.length!==Number(historical.artifactCount||0))
    findings.push('ARTIFACT_COUNT_MISMATCH actual='+artifacts.length+' state='+historical.artifactCount);

  let boundary=null,boundaryIds=[],overlap=0,boundaryVerified=false;
  if(cursor<0||cursor>=artifacts.length) findings.push('BOUNDARY_CURSOR_OUT_OF_RANGE '+cursor);
  else {
    boundary=artifacts[cursor];
    const verified=qboObsIndexV178LoadAndVerify06Artifact_(boundary);
    boundaryIds=verified.observationIds;
    boundaryVerified=true;
    boundaryIds.forEach(function(id){if(migratedIds[id]) overlap++;});
    if(overlap) findings.push('BOUNDARY_ID_OVERLAP '+overlap);
  }

  const out={
    version:'1.5.178',operation:'OBSERVATION_INDEX_SHARD_WRITER_BOUNDARY_VALIDATION',
    migrationRunId:migration?String(migration.runId||''):'',migrationStatus:migration?String(migration.status||''):'',
    migratedObservationCount:migratedCount,migratedDistinctObservationIdCount:Object.keys(migratedIds).length,
    migratedShardCount:shards.length,migratedManifestCount:manifests.length,migratedLookupSegmentCount:lookups.length,
    historicalRunId:historical?String(historical.runId||''):'',historicalStatus:historical?String(historical.status||''):'',
    historicalArtifactCursor:cursor,historicalArtifactCount:artifacts.length,
    historicalIndexedObservationCount:historical?Number(historical.indexedObservationCount||0):0,
    boundaryArtifact:boundary?{ingestionSourceId:String(boundary.IngestionSourceId||''),payloadFileId:String(boundary.PayloadFileId||''),
      payloadFileName:String(boundary.PayloadFileName||''),payloadShardHash:String(boundary.PayloadShardHash||''),
      observationCount:Number(boundary.ObservationCount||0),payloadCount:Number(boundary.PayloadCount||0)}:null,
    boundaryArtifactVerified:boundaryVerified,boundaryPayloadObservationIdCount:boundaryIds.length,
    boundaryObservationIdOverlapWithMigratedPopulation:overlap,
    writerIntegrationContract:{nextArtifactCursor:cursor,legacySheetWriterAllowed:false,immutableShardWriterRequired:true,
      checkpointOnlyAfterShardManifestLookupCommit:true,preserveHistoricalRunIdentity:true,preserveLegacy07Rows:true,
      shardOrderIsChronology:false,chronologyField:'ObservedAt'},
    findingCount:findings.length,findings:findings,valid:findings.length===0,
    safety:{driveWritesPerformed:false,workbookWritesPerformed:false,scriptPropertiesMutationPerformed:false,triggerMutationPerformed:false}
  };
  console.log('[OBSERVATION INDEX WRITER BOUNDARY V178] | '+JSON.stringify(out)); return out;
}

function qboObsIndexV178LoadAndVerify06Artifact_(artifact){
  const fileId=String(artifact.PayloadFileId||'').trim(),
        expectedHash=String(artifact.PayloadShardHash||'').trim(),
        expectedObs=Number(artifact.ObservationCount||0),
        expectedPayload=Number(artifact.PayloadCount||0);
  if(!fileId||!expectedHash) throw new Error('OBS_INDEX_V178_INVALID_06_IDENTITY row='+artifact.rowNumber);
  if(expectedObs!==expectedPayload) throw new Error('OBS_INDEX_V178_06_COUNT_MISMATCH fileId='+fileId);

  const file=DriveApp.getFileById(fileId);
  let envelope;
  try{envelope=JSON.parse(file.getBlob().getDataAsString('UTF-8'));}
  catch(e){throw new Error('OBS_INDEX_V178_INVALID_JSON fileId='+fileId);}

  const stableBody=envelope&&envelope.stableBody;
  if(!stableBody||typeof stableBody!=='object') throw new Error('OBS_INDEX_V178_STABLE_BODY_MISSING fileId='+fileId);
  const actualHash=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(stableBody));
  if(actualHash!==expectedHash||String(envelope.shardHash||'')!==expectedHash)
    throw new Error('OBS_INDEX_V178_SHARD_HASH_MISMATCH fileId='+fileId);

  const payloads=Array.isArray(stableBody.payloads)?stableBody.payloads:[],
        observationIds=Array.isArray(stableBody.observationIds)?stableBody.observationIds.map(function(x){return String(x||'');}):[];
  if(payloads.length!==expectedPayload||observationIds.length!==expectedObs)
    throw new Error('OBS_INDEX_V178_PAYLOAD_COUNT_MISMATCH fileId='+fileId+
      ' payloads='+payloads.length+' ids='+observationIds.length+' expected='+expectedObs);
  payloads.forEach(function(p,i){
    if(String(p&&p.observationId||'')!==observationIds[i])
      throw new Error('OBS_INDEX_V178_OBSERVATION_VECTOR_MISMATCH fileId='+fileId+' ordinal='+i);
  });
  return {observationIds:observationIds,payloads:payloads,stableBody:stableBody};
}
