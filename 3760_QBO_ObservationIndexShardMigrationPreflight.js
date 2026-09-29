/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3760_QBO_ObservationIndexShardMigrationPreflight.js
 * Version     : 1.5.173
 * Purpose     : Read-only preflight after the 10M-cell failure. Proves the
 *               existing v1.5.172 checkpoint/legacy 07 population and computes
 *               the required controlled migration boundary.
 *
 * SAFETY: no writes, no Drive creation, no trigger/property mutation.
 */
function preflightQboObservationIndexShardMigrationV173() {
  const ss = getQboStateCaptureSpreadsheet_();
  const sh07 = ss.getSheetByName(QBO_OBSERVATION_INDEX_CONTRACT_.SHEET_NAME);
  if (!sh07) throw new Error('OBSERVATION_INDEX_V173_LEGACY_07_MISSING');

  const headers = QBO_OBSERVATION_INDEX_CONTRACT_.HEADERS.slice();
  const schema = validateQboObservationIndexPhysicalSchemaV169_(sh07, headers);
  const findings = (schema.findings || []).slice();

  const state = qboObservationIndexV170LoadState_();
  if (!state) findings.push('BACKFILL_STATE_MISSING');

  const dataRows = Math.max(0, sh07.getLastRow() - 1);
  const checkpointRows = state ? Number(state.indexedObservationCount || 0) : -1;
  if (state && dataRows !== checkpointRows) {
    findings.push('LEGACY_07_ROW_COUNT_CHECKPOINT_MISMATCH physical=' + dataRows + ' checkpoint=' + checkpointRows);
  }

  const expectedObs = state ? Number(state.expectedObservationCount || 0) : 0;
  const logicalColumns = headers.length;
  const logical07CellsAtCompletion = expectedObs * logicalColumns;
  const impossibleInSingleSheetWorkbook = logical07CellsAtCompletion > 10000000;

  if (state && String(state.status || '') !== 'FAILED') {
    findings.push('EXPECTED_FAILED_BACKFILL_STATE actual=' + String(state.status || ''));
  }
  if (state && String(state.error || '').indexOf('10000000 cells') < 0) {
    findings.push('EXPECTED_10M_CELL_FAILURE_NOT_PRESENT');
  }
  if (!impossibleInSingleSheetWorkbook) {
    findings.push('CAPACITY_PROOF_NOT_ESTABLISHED');
  }

  const out = {
    version:'1.5.173',
    operation:'OBSERVATION_INDEX_SHARD_MIGRATION_PREFLIGHT',
    backfillRunId:state ? String(state.runId || '') : '',
    backfillStatus:state ? String(state.status || '') : '',
    artifactCursor:state ? Number(state.artifactCursor || 0) : 0,
    artifactCount:state ? Number(state.artifactCount || 0) : 0,
    legacy07DataRowCount:dataRows,
    checkpointIndexedObservationCount:checkpointRows,
    expectedObservationCount:expectedObs,
    logical07ColumnCount:logicalColumns,
    logical07CellsAtHistoricalCompletion:logical07CellsAtCompletion,
    googleSheetsWorkbookCellLimit:10000000,
    singleWorkbookPhysicalModelViable:!impossibleInSingleSheetWorkbook,
    migrationBoundary:{
      alreadyValidatedObservationCount:checkpointRows,
      resumeArtifactCursor:state ? Number(state.artifactCursor || 0) : 0,
      preserveExistingRowsUntilShardMigrationVerified:true,
      restartFromArtifactZero:false
    },
    proposedPhysicalAuthority:{
      logical07ContractPreserved:true,
      storageKind:QBO_OBSERVATION_INDEX_PHYSICAL_V173_.STORAGE_KIND,
      immutableShards:true,
      deterministicHashIdentity:true,
      entityLookupRequired:true,
      stateApplicationReadsRelevantShards:true,
      stateApplicationOrdersByObservedAt:true
    },
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
  console.log(JSON.stringify(out,null,2));
  return out;
}
