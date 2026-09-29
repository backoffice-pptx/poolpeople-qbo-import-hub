/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3801_QBO_ObservationIndexPhysicalInventoryDerivationGate.js
 * Version     : 1.5.190
 * Purpose     : Read-only proof of the expected historical physical-07 triplet count.
 *
 * This gate does not waive v1.5.189. It derives the expected post-legacy
 * historical triplet population from retained migration/drain state and proves
 * that the sole governed excluded artifact explains the 2317 inventory.
 */
function validateQboObservationIndexPhysicalInventoryDerivationV190(){
  const findings=[];
  const expectedRun='OBS_INDEX_V170|f03b49ad-69bc-4300-bf11-c769dbe72a0b';
  const controlledTestSource='FULL_EXPORT|STATE_CAPTURE_AUTOREG_TEST_3a46a5a7-62cb-4ff9-b8ed-df11de4ab16b|PAYMENT_METHODS';
  const controlledTestPayload='1WFWLNwEB4-UoKtMTP73FfX0K5lKRdY_Y';

  const state=qboObservationIndexV170LoadState_();
  const legacy=qboObsIndexV175LoadState_();
  if(!state)findings.push('HISTORICAL_STATE_MISSING');
  if(!legacy)findings.push('LEGACY_MIGRATION_STATE_MISSING');

  if(state&&String(state.runId)!==expectedRun)findings.push('RUN_ID_CHANGED');
  if(state&&String(state.status)!=='COMPLETE_SHARDED_PENDING_RECONCILIATION')
    findings.push('HISTORICAL_STATUS '+String(state.status||''));
  if(state&&Number(state.artifactCount)!==3455)findings.push('ARTIFACT_COUNT '+state.artifactCount);
  if(state&&Number(state.processedArtifactCount)!==3455)findings.push('PROCESSED_ARTIFACT_COUNT '+state.processedArtifactCount);

  // The first historical artifact written by the shard-drain writer was cursor
  // 1137 (the v180 canary). Therefore cursors 0..1136 are the 1137-artifact
  // population already represented by the legacy physical-07 migration.
  const canary=state&&state.shardWriterCanary?state.shardWriterCanary:null;
  const firstHistoricalCursor=canary?Number(canary.artifactCursor):NaN;
  if(firstHistoricalCursor!==1137)findings.push('FIRST_HISTORICAL_CURSOR '+firstHistoricalCursor);

  if(legacy&&String(legacy.status)!=='COMPLETED')findings.push('LEGACY_STATUS '+legacy.status);
  if(legacy&&Number(legacy.migratedObservationCount)!==201614)
    findings.push('LEGACY_MIGRATED_OBSERVATIONS '+legacy.migratedObservationCount);
  if(legacy&&Number(legacy.shardCount)!==101)findings.push('LEGACY_SHARD_COUNT '+legacy.shardCount);
  if(legacy&&Number(legacy.manifestCount)!==101)findings.push('LEGACY_MANIFEST_COUNT '+legacy.manifestCount);
  if(legacy&&Number(legacy.lookupSegmentCount)!==101)findings.push('LEGACY_LOOKUP_COUNT '+legacy.lookupSegmentCount);

  const excludedArtifactCount=state?Number(state.governedExcludedArtifactCount||0):0;
  const excludedObservationCount=state?Number(state.governedExcludedObservationCount||0):0;
  const excludedPayloadCount=state?Number(state.governedExcludedPayloadCount||0):0;
  if(excludedArtifactCount!==1)findings.push('EXCLUDED_ARTIFACT_COUNT '+excludedArtifactCount);
  if(excludedObservationCount!==55)findings.push('EXCLUDED_OBSERVATION_COUNT '+excludedObservationCount);
  if(excludedPayloadCount!==55)findings.push('EXCLUDED_PAYLOAD_COUNT '+excludedPayloadCount);

  const ex=state&&state.lastGovernedExclusion?state.lastGovernedExclusion:null;
  if(!ex)findings.push('LAST_GOVERNED_EXCLUSION_MISSING');
  if(ex&&String(ex.classification)!=='CONTROLLED_TEST_ORPHAN')
    findings.push('EXCLUSION_CLASSIFICATION '+String(ex.classification||''));
  if(ex&&Number(ex.artifactCursor)!==1300)findings.push('EXCLUSION_CURSOR '+ex.artifactCursor);
  if(ex&&String(ex.ingestionSourceId)!==controlledTestSource)
    findings.push('EXCLUSION_SOURCE_CHANGED '+String(ex.ingestionSourceId||''));
  if(ex&&String(ex.payloadFileId)!==controlledTestPayload)
    findings.push('EXCLUSION_PAYLOAD_CHANGED '+String(ex.payloadFileId||''));
  if(ex&&Number(ex.observationCount)!==55)findings.push('EXCLUSION_OBSERVATIONS '+ex.observationCount);

  const artifactCount=state?Number(state.artifactCount||0):0;
  const candidateHistoricalArtifacts=artifactCount-firstHistoricalCursor;
  const expectedHistoricalTriplets=candidateHistoricalArtifacts-excludedArtifactCount;
  if(candidateHistoricalArtifacts!==2318)
    findings.push('CANDIDATE_HISTORICAL_ARTIFACTS '+candidateHistoricalArtifacts);
  if(expectedHistoricalTriplets!==2317)
    findings.push('DERIVED_HISTORICAL_TRIPLETS '+expectedHistoricalTriplets);

  const folders=qboObsIndexV175ResolveFolders_();
  const inventory=qboObservationIndexV190Inventory_(folders);
  if(inventory.legacyShardCount!==101)findings.push('LEGACY_SHARDS_PHYSICAL '+inventory.legacyShardCount);
  if(inventory.legacyManifestCount!==101)findings.push('LEGACY_MANIFESTS_PHYSICAL '+inventory.legacyManifestCount);
  if(inventory.legacyLookupCount!==101)findings.push('LEGACY_LOOKUPS_PHYSICAL '+inventory.legacyLookupCount);
  if(inventory.historicalShardCount!==expectedHistoricalTriplets)
    findings.push('HISTORICAL_SHARDS_PHYSICAL '+inventory.historicalShardCount);
  if(inventory.historicalManifestCount!==expectedHistoricalTriplets)
    findings.push('HISTORICAL_MANIFESTS_PHYSICAL '+inventory.historicalManifestCount);
  if(inventory.historicalLookupCount!==expectedHistoricalTriplets)
    findings.push('HISTORICAL_LOOKUPS_PHYSICAL '+inventory.historicalLookupCount);
  if(inventory.unknownShardCount||inventory.unknownManifestCount||inventory.unknownLookupCount)
    findings.push('UNKNOWN_PHYSICAL_FILES');

  const expectedTotalTriplets=101+expectedHistoricalTriplets;
  if(inventory.totalShardFiles!==expectedTotalTriplets)findings.push('TOTAL_SHARDS '+inventory.totalShardFiles);
  if(inventory.totalManifestFiles!==expectedTotalTriplets)findings.push('TOTAL_MANIFESTS '+inventory.totalManifestFiles);
  if(inventory.totalLookupFiles!==expectedTotalTriplets)findings.push('TOTAL_LOOKUPS '+inventory.totalLookupFiles);

  const out={
    version:'1.5.190',
    operation:'OBSERVATION_INDEX_PHYSICAL_INVENTORY_DERIVATION_GATE',
    historicalRunId:state?String(state.runId||''):'',
    historicalStatus:state?String(state.status||''):'',
    persistedVersion:state?String(state.version||''):'',
    derivation:{
      total06Artifacts:artifactCount,
      firstHistoricalShardWriterCursor:firstHistoricalCursor,
      legacyRepresentedArtifactCount:firstHistoricalCursor,
      candidateHistoricalArtifactCount:candidateHistoricalArtifacts,
      governedExcludedArtifactCount:excludedArtifactCount,
      expectedHistoricalPhysicalTripletCount:expectedHistoricalTriplets,
      expectedLegacyPhysicalTripletCount:101,
      expectedTotalPhysicalTripletCount:expectedTotalTriplets,
      equation:String(artifactCount)+' - '+String(firstHistoricalCursor)+' - '+String(excludedArtifactCount)+' = '+String(expectedHistoricalTriplets)
    },
    governedExclusion:ex?{
      classification:String(ex.classification||''),
      artifactCursor:Number(ex.artifactCursor),
      ingestionSourceId:String(ex.ingestionSourceId||''),
      payloadFileId:String(ex.payloadFileId||''),
      observationCount:Number(ex.observationCount||0)
    }:null,
    physicalInventory:inventory,
    findingCount:findings.length,
    findings:findings,
    valid:findings.length===0,
    safety:{
      driveWritesPerformed:false,
      workbookWritesPerformed:false,
      scriptPropertiesMutationPerformed:false,
      triggerMutationPerformed:false,
      legacy07AuthorityRetired:false,
      stateApplicationEnabled:false
    }
  };
  console.log('[OBSERVATION INDEX V190] | PHYSICAL_INVENTORY_DERIVATION_GATE | '+JSON.stringify(out));
  return out;
}

function qboObservationIndexV190Inventory_(folders){
  const r={
    legacyShardCount:0,historicalShardCount:0,unknownShardCount:0,
    legacyManifestCount:0,historicalManifestCount:0,unknownManifestCount:0,
    legacyLookupCount:0,historicalLookupCount:0,unknownLookupCount:0,
    totalShardFiles:0,totalManifestFiles:0,totalLookupFiles:0
  };
  qboObservationIndexV190Count_(folders.shards,'shard',r);
  qboObservationIndexV190Count_(folders.manifests,'manifest',r);
  qboObservationIndexV190Count_(folders.lookup,'lookup',r);
  return r;
}

function qboObservationIndexV190Count_(folder,kind,r){
  const it=folder.getFiles();
  while(it.hasNext()){
    const n=String(it.next().getName()||'');
    if(kind==='shard'){
      r.totalShardFiles++;
      if(/^qbo_observation_index_shard_\d{9}_\d{9}\.json$/.test(n))r.legacyShardCount++;
      else if(/^qbo_observation_index_artifact_\d{9}_[0-9a-f]{16}\.json$/.test(n))r.historicalShardCount++;
      else r.unknownShardCount++;
    }else if(kind==='manifest'){
      r.totalManifestFiles++;
      if(/^qbo_observation_index_shard_\d{9}_\d{9}\.manifest\.json$/.test(n))r.legacyManifestCount++;
      else if(/^qbo_observation_index_artifact_\d{9}_[0-9a-f]{16}\.manifest\.json$/.test(n))r.historicalManifestCount++;
      else r.unknownManifestCount++;
    }else{
      r.totalLookupFiles++;
      if(/^qbo_observation_index_shard_\d{9}_\d{9}\.lookup\.json$/.test(n))r.legacyLookupCount++;
      else if(/^qbo_observation_index_artifact_\d{9}_[0-9a-f]{16}\.lookup\.json$/.test(n))r.historicalLookupCount++;
      else r.unknownLookupCount++;
    }
  }
}
