/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3800_QBO_ObservationIndexFinalReconciliationPreflight.js
 * Version     : 1.5.189
 * Purpose     : Read-only preflight for final historical sharded 07 reconciliation.
 *
 * Safety:
 * - no Drive writes
 * - no workbook writes
 * - no Script Properties writes
 * - no trigger mutation
 * - does not retire legacy 07
 * - does not enable State Application
 */
function validateQboObservationIndexFinalReconciliationPreflightV189(){
  const findings=[];
  const expectedRun='OBS_INDEX_V170|f03b49ad-69bc-4300-bf11-c769dbe72a0b';
  const expectedPhysical=734913;
  const expectedExcluded=55;
  const expectedLogical=734858;
  const expectedLegacy=201614;

  const state=qboObservationIndexV170LoadState_();
  if(!state)findings.push('HISTORICAL_STATE_MISSING');
  if(state&&String(state.runId)!==expectedRun)findings.push('RUN_ID_CHANGED');
  if(state&&String(state.status)!=='COMPLETE_SHARDED_PENDING_RECONCILIATION')
    findings.push('STATUS_NOT_PENDING_RECONCILIATION '+String(state.status||''));
  if(state&&Number(state.artifactCursor)!==3455)findings.push('ARTIFACT_CURSOR '+state.artifactCursor);
  if(state&&Number(state.artifactCount)!==3455)findings.push('ARTIFACT_COUNT '+state.artifactCount);
  if(state&&Number(state.processedArtifactCount)!==3455)findings.push('PROCESSED_ARTIFACT_COUNT '+state.processedArtifactCount);
  if(state&&Number(state.expectedObservationCount)!==expectedPhysical)findings.push('EXPECTED_PHYSICAL '+state.expectedObservationCount);
  if(state&&Number(state.indexedObservationCount)!==expectedLogical)findings.push('INDEXED_LOGICAL '+state.indexedObservationCount);
  if(state&&Number(state.governedExcludedObservationCount||0)!==expectedExcluded)findings.push('GOVERNED_EXCLUDED '+state.governedExcludedObservationCount);
  if(state&&Number(state.indexedObservationCount||0)+Number(state.governedExcludedObservationCount||0)!==expectedPhysical)
    findings.push('PHYSICAL_ACCOUNTING_EQUATION_FAILED');
  if(state&&Number(state.admittedCount)!==734786)findings.push('ADMITTED_COUNT '+state.admittedCount);
  if(state&&Number(state.evidenceExceptionCount)!==52)findings.push('EVIDENCE_EXCEPTION_COUNT '+state.evidenceExceptionCount);
  if(state&&Number(state.blockedCount)!==20)findings.push('BLOCKED_COUNT '+state.blockedCount);
  if(state&&String(state.error||''))findings.push('TERMINAL_ERROR_PRESENT '+String(state.error));
  if(state&&Number(state.reconciledArtifactCount||0)!==1)findings.push('RECONCILED_ARTIFACT_COUNT '+state.reconciledArtifactCount);

  const folders=qboObsIndexV175ResolveFolders_();
  const inventory=qboObservationIndexV189Inventory_(folders);

  // Expected physical 07 files:
  // 101 legacy-sheet migration triplets + 2318 historical artifact triplets.
  if(inventory.legacyShardCount!==101)findings.push('LEGACY_SHARD_COUNT '+inventory.legacyShardCount);
  if(inventory.legacyManifestCount!==101)findings.push('LEGACY_MANIFEST_COUNT '+inventory.legacyManifestCount);
  if(inventory.legacyLookupCount!==101)findings.push('LEGACY_LOOKUP_COUNT '+inventory.legacyLookupCount);
  if(inventory.historicalShardCount!==2318)findings.push('HISTORICAL_SHARD_COUNT '+inventory.historicalShardCount);
  if(inventory.historicalManifestCount!==2318)findings.push('HISTORICAL_MANIFEST_COUNT '+inventory.historicalManifestCount);
  if(inventory.historicalLookupCount!==2318)findings.push('HISTORICAL_LOOKUP_COUNT '+inventory.historicalLookupCount);
  if(inventory.unknownShardCount)findings.push('UNKNOWN_SHARD_FILES '+inventory.unknownShardCount);
  if(inventory.unknownManifestCount)findings.push('UNKNOWN_MANIFEST_FILES '+inventory.unknownManifestCount);
  if(inventory.unknownLookupCount)findings.push('UNKNOWN_LOOKUP_FILES '+inventory.unknownLookupCount);

  const legacyState=qboObsIndexV175LoadState_();
  if(!legacyState)findings.push('LEGACY_MIGRATION_STATE_MISSING');
  if(legacyState&&String(legacyState.status)!=='COMPLETED')findings.push('LEGACY_MIGRATION_STATUS '+legacyState.status);
  if(legacyState&&Number(legacyState.migratedObservationCount)!==expectedLegacy)
    findings.push('LEGACY_MIGRATED_COUNT '+legacyState.migratedObservationCount);
  if(legacyState&&Number(legacyState.shardCount)!==101)findings.push('LEGACY_STATE_SHARD_COUNT '+legacyState.shardCount);

  let continuationIds=[],triggerServiceError='';
  try{
    continuationIds=ScriptApp.getProjectTriggers().filter(function(t){
      const h=t.getHandlerFunction();
      return h===QBO_OBSERVATION_INDEX_SHARD_DRAIN_V181_.CONTINUATION_HANDLER ||
             h===QBO_OBSERVATION_INDEX_BACKFILL_V170_.CONTINUATION_HANDLER ||
             h===QBO_OBS_INDEX_LEGACY_SHARD_MIGRATION_V175_.CONTINUATION_HANDLER;
    }).map(function(t){return {handler:t.getHandlerFunction(),id:String(t.getUniqueId()||'')};});
  }catch(e){
    triggerServiceError=String(e&&e.message?e.message:e);
    findings.push('TRIGGER_SERVICE_UNAVAILABLE '+triggerServiceError);
  }
  if(continuationIds.length)findings.push('OBS_INDEX_CONTINUATION_TRIGGER_PRESENT count='+continuationIds.length);

  const out={
    version:'1.5.189',
    operation:'OBSERVATION_INDEX_FINAL_RECONCILIATION_PREFLIGHT',
    historicalRun:{
      runId:state?String(state.runId||''):'',
      persistedVersion:state?String(state.version||''):'',
      status:state?String(state.status||''):'',
      artifactCursor:state?Number(state.artifactCursor):null,
      artifactCount:state?Number(state.artifactCount):null,
      processedArtifactCount:state?Number(state.processedArtifactCount):null,
      indexedObservationCount:state?Number(state.indexedObservationCount):null,
      admittedCount:state?Number(state.admittedCount):null,
      evidenceExceptionCount:state?Number(state.evidenceExceptionCount):null,
      blockedCount:state?Number(state.blockedCount):null,
      governedExcludedObservationCount:state?Number(state.governedExcludedObservationCount||0):0,
      reconciledArtifactCount:state?Number(state.reconciledArtifactCount||0):0,
      completedAt:state?String(state.completedAt||''):'',
      error:state?String(state.error||''):''
    },
    countEquation:{
      physical06ObservationCount:expectedPhysical,
      logical07IndexedObservationCount:state?Number(state.indexedObservationCount||0):0,
      governedExcludedObservationCount:state?Number(state.governedExcludedObservationCount||0):0,
      accountedObservationCount:state?Number(state.indexedObservationCount||0)+Number(state.governedExcludedObservationCount||0):0,
      expectedLogical07ObservationCount:expectedLogical,
      valid:!!state&&Number(state.indexedObservationCount||0)+Number(state.governedExcludedObservationCount||0)===expectedPhysical
    },
    physicalInventory:inventory,
    legacyMigration:{
      status:legacyState?String(legacyState.status||''):'',
      migratedObservationCount:legacyState?Number(legacyState.migratedObservationCount||0):null,
      shardCount:legacyState?Number(legacyState.shardCount||0):null,
      manifestCount:legacyState?Number(legacyState.manifestCount||0):null,
      lookupSegmentCount:legacyState?Number(legacyState.lookupSegmentCount||0):null
    },
    continuationTriggers:continuationIds,
    triggerServiceError:triggerServiceError,
    nextReconciliationContract:{
      verifyEveryManifestShardLookupTriplet:true,
      verifyCanonicalHashes:true,
      verifyPhysicalReferences:true,
      verifyObservationCounts:true,
      verifyDistinctObservationIds:true,
      verifyLegacyAndHistoricalPopulationsDisjoint:true,
      classifyAdmissionStatuses:true,
      expectedAdmittedCount:734786,
      expectedEvidenceExceptionCount:52,
      expectedBlockedCount:20,
      verifyPayloadPointersAndFullExportChronology:true,
      retireLegacyAuthority:false,
      enableStateApplication:false
    },
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
  console.log('[OBSERVATION INDEX V189] | FINAL_RECONCILIATION_PREFLIGHT | '+JSON.stringify(out));
  return out;
}

function qboObservationIndexV189Inventory_(folders){
  const r={
    legacyShardCount:0,historicalShardCount:0,unknownShardCount:0,
    legacyManifestCount:0,historicalManifestCount:0,unknownManifestCount:0,
    legacyLookupCount:0,historicalLookupCount:0,unknownLookupCount:0,
    totalShardFiles:0,totalManifestFiles:0,totalLookupFiles:0
  };
  qboObservationIndexV189CountFolder_(folders.shards,'shard',r);
  qboObservationIndexV189CountFolder_(folders.manifests,'manifest',r);
  qboObservationIndexV189CountFolder_(folders.lookup,'lookup',r);
  return r;
}

function qboObservationIndexV189CountFolder_(folder,kind,r){
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
