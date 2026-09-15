/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 121_QBO_ControlledTestDisposition.js
 * Version     : 1.5.96
 * Purpose     : Governed, exact-lineage disposition of the known controlled
 *               State Capture auto-registration test evidence reconciled by
 *               v1.5.95.
 *
 * Safety / doctrine:
 *   - This is NOT a generic test-data deletion utility.
 *   - Mutation is authorized only when the exact v1.5.95 diagnostic evidence
 *     is still present and all governed lineage/count/hash preconditions pass.
 *   - Requires exactly two controlled-test registrations in 01_Sources,
 *     exactly one corresponding 05 row, exactly one reconciled payload shard,
 *     and zero controlled-test State Application rows in 10/11/12.
 *   - The reconciled Change Payload shard is moved to Drive trash (reversible),
 *     not permanently deleted.
 *   - The two 01 rows and one 05 row are removed from active production/state
 *     ledgers only after exact preflight succeeds.
 *   - Diagnostic sheets 103/104 remain as durable evidence and are marked with
 *     the completed governance disposition after successful mutation.
 * ============================================================================
 */

const QBO_CONTROLLED_TEST_DISPOSITION_ = Object.freeze({
  VERSION: 'QBO_CONTROLLED_TEST_DISPOSITION_V1_5_96',
  REQUIRED_ASSESSMENT_VERSION: 'QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_V1_5_95',
  REQUIRED_TARGET_COUNT: 2,
  REQUIRED_PRESENT_IN_01_COUNT: 2,
  REQUIRED_PRESENT_IN_05_COUNT: 1,
  REQUIRED_EXPECTED_SHARD_COUNT: 1,
  REQUIRED_EXPECTED_PAYLOAD_COUNT: 55,
  COMPLETED_DISPOSITION: 'CONTROLLED_TEST_EVIDENCE_DISPOSED_EXACT_LINEAGE',
  LOCK_TIMEOUT_MS: 30000
});

/**
 * Public governed cleanup entry point.
 *
 * Exact successful mutation set:
 *   - delete 2 exact controlled-test rows from 01_Sources;
 *   - delete 1 exact controlled-test row from 05_Forward_Ingestion_Control;
 *   - move the 1 exact v1.5.95-reconciled Change Payload shard to Drive trash;
 *   - retain 103/104 diagnostic evidence and mark completed disposition.
 */
function disposeQboControlledTestEvidence() {
  const startedAt = new Date();
  const lock = LockService.getScriptLock();
  lock.waitLock(QBO_CONTROLLED_TEST_DISPOSITION_.LOCK_TIMEOUT_MS);
  try {
    const ss = getQboStateCaptureSpreadsheet_();

    // Idempotent completed-state recognition is based on retained diagnostic
    // evidence, because active 01/05 rows are intentionally absent after success.
    const completed = qboCtlDispReadCompletedEvidence_(ss);
    if (completed.alreadyDisposed) {
      const result = {
        version: QBO_CONTROLLED_TEST_DISPOSITION_.VERSION,
        status: 'ALREADY_DISPOSED',
        productionDataMutationApplied: false,
        activeLedgerRowsRemoved: 0,
        payloadShardsMovedToTrash: 0,
        retainedDiagnosticEvidence: true,
        detail: 'Exact controlled-test evidence was previously disposed under this governed disposition.',
        completedAt: new Date().toISOString()
      };
      console.log('[CONTROLLED TEST DISPOSITION] | ALREADY_DISPOSED | ' + JSON.stringify(result, null, 2));
      return result;
    }

    const pre = qboCtlDispBuildPreflight_(ss);
    qboCtlDispAssertPreflight_(pre);

    console.log('[CONTROLLED TEST DISPOSITION] | PREFLIGHT PASSED | ' + JSON.stringify({
      sourceIds: pre.sourceIds,
      rows01: pre.rows01.map(function(r){ return r.rowNumber; }),
      row05: pre.row05.rowNumber,
      payloadFileId: pre.payloadFile.getId(),
      payloadFileName: pre.payloadFile.getName(),
      payloadShardHash: pre.artifactEvidence.PayloadShardHash,
      stateApplicationRows: 0
    }));

    // Remove active ledger rows only after every source/artifact/state-output
    // precondition has passed. Row deletions are done bottom-up.
    pre.sheet05.deleteRow(pre.row05.rowNumber);
    pre.rows01.map(function(r){ return r.rowNumber; }).sort(function(a,b){ return b-a; })
      .forEach(function(rowNumber){ pre.sheet01.deleteRow(rowNumber); });
    SpreadsheetApp.flush();

    // Move the exact reconciled shard to trash rather than permanently delete.
    pre.payloadFile.setTrashed(true);

    // Preserve the diagnostic record as the durable governance/audit evidence.
    qboCtlDispMarkDiagnosticsCompleted_(ss, pre.sourceIds);
    SpreadsheetApp.flush();

    const post = qboCtlDispVerifyPostconditions_(ss, pre);
    if (!post.passed) {
      throw new Error('CONTROLLED_TEST_DISPOSITION_POSTCONDITION_FAILED ' + JSON.stringify(post));
    }

    const result = {
      version: QBO_CONTROLLED_TEST_DISPOSITION_.VERSION,
      status: 'DISPOSITION_COMPLETE',
      productionDataMutationApplied: true,
      sourceRegistrationsRemovedFrom01: pre.rows01.length,
      forwardIngestionRowsRemovedFrom05: 1,
      payloadShardsMovedToTrash: 1,
      stateApplicationRowsRemoved: 0,
      retainedDiagnosticEvidence: true,
      disposedSourceIds: pre.sourceIds,
      payloadFileId: pre.payloadFile.getId(),
      payloadFileName: pre.payloadFile.getName(),
      payloadShardHash: String(pre.artifactEvidence.PayloadShardHash || ''),
      governanceDisposition: QBO_CONTROLLED_TEST_DISPOSITION_.COMPLETED_DISPOSITION,
      nextRequiredControl: 'RUN auditQboStateCaptureWorkbookIntegrity()',
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString()
    };
    console.log('[CONTROLLED TEST DISPOSITION] | DISPOSITION_COMPLETE | ' + JSON.stringify(result, null, 2));
    return result;
  } finally {
    lock.releaseLock();
  }
}

function qboCtlDispBuildPreflight_(ss) {
  const model = qboCtlTestBuildTargetModel_(ss);
  const sourceIds = model.targets.map(function(t){ return t.ingestionSourceId; }).sort();
  const present01 = model.targets.filter(function(t){ return t.presentIn01; });
  const present05 = model.targets.filter(function(t){ return t.presentIn05; });
  const downstream = model.targets.reduce(function(n,t){
    return n + Number(t.snapshotRecordCount || 0) + Number(t.changeRecordCount || 0) + Number(t.changeDetailCount || 0);
  }, 0);

  const summaryRows = qboCtlTestReadSheetObjects_(ss, QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.SUMMARY_SHEET);
  const artifactRows = qboCtlTestReadSheetObjects_(ss, QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.ARTIFACT_SHEET);
  const relevantSummary = summaryRows.filter(function(r){ return sourceIds.indexOf(String(r.IngestionSourceId || '')) >= 0; });
  const assessmentRunIds = {};
  relevantSummary.forEach(function(r){ assessmentRunIds[String(r.AssessmentRunId || '')] = true; });
  const assessmentVersions = {};
  relevantSummary.forEach(function(r){ assessmentVersions[String(r.AssessmentVersion || '')] = true; });

  const ingested = present05.length === 1 ? present05[0] : null;
  const expected = ingested ? qboCtlTestExpectedFullExportArtifact_(ingested) : null;
  const matchingArtifacts = ingested ? artifactRows.filter(function(r){
    return String(r.IngestionSourceId || '') === ingested.ingestionSourceId;
  }) : [];
  const artifactEvidence = matchingArtifacts.length === 1 ? matchingArtifacts[0] : null;

  let payloadFile = null;
  let payloadValidation = null;
  if (artifactEvidence) {
    payloadFile = DriveApp.getFileById(String(artifactEvidence.PayloadFileId || ''));
    const parsed = JSON.parse(payloadFile.getBlob().getDataAsString('UTF-8'));
    payloadValidation = qboCtlTestValidateExpectedFullExportShard_(ingested, expected, payloadFile, parsed);
  }

  const sheet01 = ss.getSheetByName('01_Sources');
  const sheet05 = ss.getSheetByName('05_Forward_Ingestion_Control');
  const rows01 = qboCtlDispFindRowsByExactIds_(sheet01, 'SourceId', sourceIds);
  const rows05 = qboCtlDispFindRowsByExactIds_(sheet05, 'IngestionSourceId', sourceIds);

  return {
    model:model,
    sourceIds:sourceIds,
    present01:present01,
    present05:present05,
    downstream:downstream,
    relevantSummary:relevantSummary,
    assessmentRunIds:Object.keys(assessmentRunIds).filter(Boolean),
    assessmentVersions:Object.keys(assessmentVersions).filter(Boolean),
    artifactRows:artifactRows,
    matchingArtifacts:matchingArtifacts,
    artifactEvidence:artifactEvidence,
    payloadFile:payloadFile,
    payloadValidation:payloadValidation,
    expected:expected,
    sheet01:sheet01,
    sheet05:sheet05,
    rows01:rows01,
    rows05:rows05,
    row05:rows05.length === 1 ? rows05[0] : null
  };
}

function qboCtlDispAssertPreflight_(pre) {
  if (pre.model.targets.length !== QBO_CONTROLLED_TEST_DISPOSITION_.REQUIRED_TARGET_COUNT) {
    throw new Error('CONTROLLED_TEST_DISPOSITION_TARGET_COUNT_MISMATCH expected=2 actual=' + pre.model.targets.length);
  }
  if (pre.present01.length !== QBO_CONTROLLED_TEST_DISPOSITION_.REQUIRED_PRESENT_IN_01_COUNT) {
    throw new Error('CONTROLLED_TEST_DISPOSITION_01_COUNT_MISMATCH expected=2 actual=' + pre.present01.length);
  }
  if (pre.present05.length !== QBO_CONTROLLED_TEST_DISPOSITION_.REQUIRED_PRESENT_IN_05_COUNT) {
    throw new Error('CONTROLLED_TEST_DISPOSITION_05_COUNT_MISMATCH expected=1 actual=' + pre.present05.length);
  }
  if (pre.downstream !== 0) {
    throw new Error('CONTROLLED_TEST_DISPOSITION_STATE_APPLICATION_CONTAMINATION_FOUND count=' + pre.downstream);
  }
  if (pre.relevantSummary.length !== QBO_CONTROLLED_TEST_DISPOSITION_.REQUIRED_TARGET_COUNT) {
    throw new Error('CONTROLLED_TEST_DISPOSITION_SUMMARY_EVIDENCE_COUNT_MISMATCH expected=2 actual=' + pre.relevantSummary.length);
  }
  if (pre.assessmentRunIds.length !== 1) {
    throw new Error('CONTROLLED_TEST_DISPOSITION_ASSESSMENT_RUN_ID_NOT_UNIQUE count=' + pre.assessmentRunIds.length);
  }
  if (pre.assessmentVersions.length !== 1 || pre.assessmentVersions[0] !== QBO_CONTROLLED_TEST_DISPOSITION_.REQUIRED_ASSESSMENT_VERSION) {
    throw new Error('CONTROLLED_TEST_DISPOSITION_REQUIRES_V1_5_95_ASSESSMENT actual=' + pre.assessmentVersions.join(','));
  }
  pre.relevantSummary.forEach(function(r) {
    if (String(r.AssessmentRunId || '') !== pre.assessmentRunIds[0]) {
      throw new Error('CONTROLLED_TEST_DISPOSITION_SUMMARY_RUN_ID_MISMATCH sourceId=' + r.IngestionSourceId);
    }
    if (String(r.ProductionDataMutationApplied || '').toLowerCase() === 'true') {
      throw new Error('CONTROLLED_TEST_DISPOSITION_ASSESSMENT_ALREADY_MUTATED sourceId=' + r.IngestionSourceId);
    }
    if (Number(r.SnapshotRecordCount || 0) + Number(r.ChangeRecordCount || 0) + Number(r.ChangeDetailCount || 0) !== 0) {
      throw new Error('CONTROLLED_TEST_DISPOSITION_SUMMARY_STATE_OUTPUT_NONZERO sourceId=' + r.IngestionSourceId);
    }
  });

  const ingested = pre.present05[0];
  if (Number(ingested.shardCount || 0) !== QBO_CONTROLLED_TEST_DISPOSITION_.REQUIRED_EXPECTED_SHARD_COUNT ||
      Number(ingested.payloadCount || 0) !== QBO_CONTROLLED_TEST_DISPOSITION_.REQUIRED_EXPECTED_PAYLOAD_COUNT ||
      Number(ingested.observationCount || 0) !== QBO_CONTROLLED_TEST_DISPOSITION_.REQUIRED_EXPECTED_PAYLOAD_COUNT ||
      Number(ingested.recordCursor || 0) !== QBO_CONTROLLED_TEST_DISPOSITION_.REQUIRED_EXPECTED_PAYLOAD_COUNT) {
    throw new Error('CONTROLLED_TEST_DISPOSITION_05_COUNTS_MISMATCH sourceId=' + ingested.ingestionSourceId);
  }
  if (pre.matchingArtifacts.length !== 1 || !pre.artifactEvidence || !pre.payloadFile || !pre.payloadValidation || pre.payloadValidation.exactMatch !== true) {
    throw new Error('CONTROLLED_TEST_DISPOSITION_EXACT_ARTIFACT_RECONCILIATION_REQUIRED');
  }
  if (String(pre.artifactEvidence.AssessmentRunId || '') !== pre.assessmentRunIds[0]) {
    throw new Error('CONTROLLED_TEST_DISPOSITION_ARTIFACT_ASSESSMENT_RUN_MISMATCH');
  }
  if (String(pre.artifactEvidence.PayloadFileId || '') !== pre.payloadFile.getId()) {
    throw new Error('CONTROLLED_TEST_DISPOSITION_ARTIFACT_FILE_ID_MISMATCH');
  }
  if (String(pre.artifactEvidence.PayloadFileName || '') !== pre.payloadFile.getName()) {
    throw new Error('CONTROLLED_TEST_DISPOSITION_ARTIFACT_FILE_NAME_MISMATCH');
  }
  if (String(pre.artifactEvidence.PayloadShardHash || '') !== String(pre.payloadValidation.shardHash || '')) {
    throw new Error('CONTROLLED_TEST_DISPOSITION_ARTIFACT_HASH_MISMATCH');
  }
  if (pre.rows01.length !== 2) {
    throw new Error('CONTROLLED_TEST_DISPOSITION_PHYSICAL_01_ROWS_MISMATCH expected=2 actual=' + pre.rows01.length);
  }
  if (pre.rows05.length !== 1 || !pre.row05) {
    throw new Error('CONTROLLED_TEST_DISPOSITION_PHYSICAL_05_ROWS_MISMATCH expected=1 actual=' + pre.rows05.length);
  }
  if (String(pre.row05.IngestionSourceId || '') !== ingested.ingestionSourceId) {
    throw new Error('CONTROLLED_TEST_DISPOSITION_05_ROW_SOURCE_MISMATCH');
  }
}

function qboCtlDispFindRowsByExactIds_(sheet, idHeader, ids) {
  if (!sheet) throw new Error('CONTROLLED_TEST_DISPOSITION_SHEET_MISSING ' + idHeader);
  const width = sheet.getLastColumn();
  const headers = sheet.getRange(1,1,1,width).getValues()[0].map(function(v){ return String(v || '').trim(); });
  const idIndex = headers.indexOf(idHeader);
  if (idIndex < 0) throw new Error('CONTROLLED_TEST_DISPOSITION_HEADER_MISSING sheet=' + sheet.getName() + ' header=' + idHeader);
  if (sheet.getLastRow() < 2) return [];
  const target = {};
  ids.forEach(function(id){ target[id] = true; });
  return sheet.getRange(2,1,sheet.getLastRow()-1,width).getValues().map(function(values, offset){
    const o = {rowNumber:offset+2};
    headers.forEach(function(h,i){ if(h) o[h]=values[i]; });
    return o;
  }).filter(function(r){ return !!target[String(r[idHeader] || '')]; });
}

function qboCtlDispMarkDiagnosticsCompleted_(ss, sourceIds) {
  const sh = ss.getSheetByName(QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.SUMMARY_SHEET);
  if (!sh || sh.getLastRow() < 2) throw new Error('CONTROLLED_TEST_DISPOSITION_SUMMARY_SHEET_MISSING');
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(function(v){ return String(v || '').trim(); });
  const idxSource = headers.indexOf('IngestionSourceId');
  const idxDisposition = headers.indexOf('GovernanceDisposition');
  const idxMutated = headers.indexOf('ProductionDataMutationApplied');
  const idxDetail = headers.indexOf('Detail');
  if ([idxSource,idxDisposition,idxMutated,idxDetail].some(function(i){return i<0;})) throw new Error('CONTROLLED_TEST_DISPOSITION_SUMMARY_HEADERS_MISSING');
  const idSet = {};
  sourceIds.forEach(function(id){ idSet[id]=true; });
  const values = sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues();
  values.forEach(function(row, i){
    if (!idSet[String(row[idxSource] || '')]) return;
    row[idxDisposition] = QBO_CONTROLLED_TEST_DISPOSITION_.COMPLETED_DISPOSITION;
    row[idxMutated] = true;
    row[idxDetail] = String(row[idxDetail] || '') + ' Governed v1.5.96 disposition removed exact controlled-test rows from active 01/05 ledgers and moved the exactly reconciled Change Payload shard to Drive trash; 103/104 retained as evidence.';
    sh.getRange(i+2,1,1,row.length).setValues([row]);
  });
}

function qboCtlDispVerifyPostconditions_(ss, pre) {
  const rows01 = qboCtlDispFindRowsByExactIds_(ss.getSheetByName('01_Sources'), 'SourceId', pre.sourceIds);
  const rows05 = qboCtlDispFindRowsByExactIds_(ss.getSheetByName('05_Forward_Ingestion_Control'), 'IngestionSourceId', pre.sourceIds);
  const outputs = qboCtlDispCountStateOutputs_(ss, pre.sourceIds);
  let trashed = false;
  try { trashed = pre.payloadFile.isTrashed(); } catch (e) { trashed = false; }
  const completed = qboCtlDispReadCompletedEvidence_(ss);
  return {
    passed: rows01.length === 0 && rows05.length === 0 && outputs.total === 0 && trashed === true && completed.alreadyDisposed === true,
    remaining01Rows: rows01.length,
    remaining05Rows: rows05.length,
    remainingStateOutputRows: outputs.total,
    payloadFileTrashed: trashed,
    diagnosticsMarkedCompleted: completed.alreadyDisposed
  };
}

function qboCtlDispCountStateOutputs_(ss, sourceIds) {
  const idSet = {};
  sourceIds.forEach(function(id){ idSet[id]=true; });
  const snap = qboCtlTestReadSheetObjects_(ss, '10_Snapshot_Records').filter(function(r){ return idSet[String(r.SourceId || '')]; });
  const changes = qboCtlTestReadSheetObjects_(ss, '11_Change_Records').filter(function(r){ return idSet[String(r.SourceId || '')]; });
  const changeIds = {};
  changes.forEach(function(r){ if(r.ChangeRecordId) changeIds[String(r.ChangeRecordId)] = true; });
  const details = qboCtlTestReadSheetObjects_(ss, '12_Change_Detail').filter(function(r){ return changeIds[String(r.ChangeRecordId || '')]; });
  return {snapshots:snap.length, changes:changes.length, details:details.length, total:snap.length+changes.length+details.length};
}

function qboCtlDispReadCompletedEvidence_(ss) {
  const rows = qboCtlTestReadSheetObjects_(ss, QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.SUMMARY_SHEET);
  const controlled = rows.filter(function(r){ return qboCtlTestIsTestId_(r.IngestionSourceId) || qboCtlTestIsTestId_(r.SourceRunId); });
  if (controlled.length !== QBO_CONTROLLED_TEST_DISPOSITION_.REQUIRED_TARGET_COUNT) return {alreadyDisposed:false};
  const allCompleted = controlled.every(function(r){
    return String(r.GovernanceDisposition || '') === QBO_CONTROLLED_TEST_DISPOSITION_.COMPLETED_DISPOSITION &&
      String(r.ProductionDataMutationApplied || '').toLowerCase() === 'true';
  });
  if (!allCompleted) return {alreadyDisposed:false};

  const sourceIds = controlled.map(function(r){ return String(r.IngestionSourceId || ''); }).filter(Boolean);
  const active01 = qboCtlDispFindRowsByExactIds_(ss.getSheetByName('01_Sources'), 'SourceId', sourceIds);
  const active05 = qboCtlDispFindRowsByExactIds_(ss.getSheetByName('05_Forward_Ingestion_Control'), 'IngestionSourceId', sourceIds);
  return {alreadyDisposed:active01.length===0 && active05.length===0, sourceIds:sourceIds};
}
