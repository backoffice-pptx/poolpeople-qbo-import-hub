/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 120_QBO_ControlledTestContaminationAssessment.js
 * Version     : 1.5.95
 * Purpose     : Read-only production/state assessment of controlled State
 *               Capture test-source contamination across source registration,
 *               forward ingestion, Change Payload artifacts, and State
 *               Application output/reference sheets.
 *
 * Safety / doctrine:
 *   - Production/state data is READ ONLY.
 *   - Writes are limited to diagnostic sheets 103/104 and retirement of the
 *     prior v1.5.93 diagnostic-only Drive-scan checkpoint property.
 *   - No controlled-test source, 05 row, Change Payload shard, snapshot,
 *     change record, or change detail is deleted or altered.
 *   - A test source is identified only by the governed helper
 *     isQboStateCaptureControlledTestRunId_() or the exact known prefix.
 *   - Change Payload correlation is narrowed by the exact 05 lifecycle window
 *     and then validated by source/work-unit/cursor/count/hash lineage.
 *   - 10/11 correlation is exact SourceId equality; 12 is correlated through
 *     test-derived ChangeRecordId values from 11_Change_Records.
 * ============================================================================
 */

const QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_ = Object.freeze({
  VERSION: 'QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_V1_5_95',
  SUMMARY_SHEET: '103_Controlled_Test_Assessment',
  ARTIFACT_SHEET: '104_Controlled_Test_Payload_Artifacts',
  CHECKPOINT_PROPERTY: 'QBO_CONTROLLED_TEST_CONTAMINATION_SCAN_V1',
  PAYLOAD_FOLDER_ASSET_KEY: 'QBO_CHANGE_PAYLOADS_FOLDER',
  PAYLOAD_FOLDER_EXPECTED_TYPE: 'Folder',
  ENVIRONMENT: 'PROD',
  TARGET_WINDOW_PADDING_BEFORE_MS: 5 * 60 * 1000,
  TARGET_WINDOW_PADDING_AFTER_MS: 5 * 60 * 1000,
  FILE_PREFIX: 'qbo_change_payload_shard_',
  SUMMARY_HEADERS: Object.freeze([
    'AssessmentRunId','AssessmentVersion','AssessedAt','IngestionSourceId','SourceType','SourceRunId',
    'SourceUnitId','EntityType','PresentIn01Sources','PresentIn05ForwardIngestion','ProcessingStatus',
    'RecordCursor','ObservationCount','PayloadCount','ShardCount','AttemptCount','MatchedPayloadShardCount',
    'MatchedPayloadObservationCount','SnapshotRecordCount','ChangeRecordCount','ChangeDetailCount',
    'ContaminationClassification','GovernanceDisposition','ProductionDataMutationApplied','Detail'
  ]),
  ARTIFACT_HEADERS: Object.freeze([
    'AssessmentRunId','IngestionSourceId','PayloadFileId','PayloadFileName','PayloadShardHash',
    'PayloadCreatedAt','IngestionRunId','WorkUnitId','SourceType','RecordCursorStart',
    'RecordCursorEndExclusive','ObservationCount','PayloadCount','MatchedAt'
  ])
});

/**
 * Public entry point. Targeted single-run assessment for the known controlled
 * FULL_EXPORT test source. Evaluates 01/05/10/11/12 synchronously, narrows
 * Change Payload candidates by exact 05 lifecycle timestamps, then validates
 * full shard lineage and self-hash before counting a match.
 */
function assessQboControlledTestContamination() {
  const startedAt = new Date();
  const ss = getQboStateCaptureSpreadsheet_();
  const model = qboCtlTestBuildTargetModel_(ss);
  if (!model.targets.length) throw new Error('CONTROLLED_TEST_ASSESSMENT_NO_TARGETS');

  // v1.5.93 used one compact resumable scan checkpoint. v1.5.94 replaces the
  // blind folder walk with exact targeted Drive searches and retires that
  // diagnostic-only checkpoint immediately.
  PropertiesService.getScriptProperties().deleteProperty(QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.CHECKPOINT_PROPERTY);

  const assessmentRunId = 'CONTROLLED_TEST_CONTAMINATION|' + Utilities.getUuid();
  qboCtlTestPrepareDiagnosticSheets_(ss, assessmentRunId);
  const scan = qboCtlTestTargetedPayloadReconciliation_(ss, assessmentRunId, model);

  // Re-read state-output sheets after artifact correlation. Production/state
  // remains read-only throughout the assessment.
  const refreshedModel = qboCtlTestBuildTargetModel_(ss);
  const artifactAgg = qboCtlTestReadArtifactAggregation_(ss, assessmentRunId);
  qboCtlTestPersistSummary_(ss, assessmentRunId, refreshedModel, artifactAgg, true);

  const result = qboCtlTestBuildTargetedResult_(assessmentRunId, refreshedModel, artifactAgg, scan, startedAt);
  console.log('[CONTROLLED TEST CONTAMINATION ASSESSMENT] | ' + result.status + ' | ' + JSON.stringify(result, null, 2));
  return result;
}

/** Diagnostic-only reset. Does not delete production/state data or payloads. */
function resetQboControlledTestContaminationAssessment() {
  const ss = getQboStateCaptureSpreadsheet_();
  PropertiesService.getScriptProperties().deleteProperty(QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.CHECKPOINT_PROPERTY);
  [QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.SUMMARY_SHEET, QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.ARTIFACT_SHEET].forEach(function(name) {
    const sh = ss.getSheetByName(name);
    if (sh && sh.getLastRow() > 1) sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).clearContent();
  });
  const result = {status:'DIAGNOSTIC_RESET', productionDataMutationApplied:false};
  console.log('[CONTROLLED TEST CONTAMINATION ASSESSMENT] | RESET | ' + JSON.stringify(result));
  return result;
}

function qboCtlTestBuildTargetModel_(ss) {
  const src01 = qboCtlTestReadSheetObjects_(ss, '01_Sources');
  const src05 = qboCtlTestReadSheetObjects_(ss, '05_Forward_Ingestion_Control');
  const snap10 = qboCtlTestReadSheetObjects_(ss, '10_Snapshot_Records');
  const change11 = qboCtlTestReadSheetObjects_(ss, '11_Change_Records');
  const detail12 = qboCtlTestReadSheetObjects_(ss, '12_Change_Detail');

  const test01 = Object.create(null);
  src01.forEach(function(r) {
    const runId = String(r.SourceRunId || '').trim();
    const sourceId = String(r.SourceId || '').trim();
    if (qboCtlTestIsTestId_(runId) || qboCtlTestIsTestId_(sourceId)) test01[sourceId] = r;
  });

  const test05 = Object.create(null);
  src05.forEach(function(r) {
    const runId = String(r.SourceRunId || '').trim();
    const sourceId = String(r.IngestionSourceId || '').trim();
    if (qboCtlTestIsTestId_(runId) || qboCtlTestIsTestId_(sourceId)) test05[sourceId] = r;
  });

  const ids = Object.create(null);
  Object.keys(test01).forEach(function(id){ if(id) ids[id]=true; });
  Object.keys(test05).forEach(function(id){ if(id) ids[id]=true; });

  const snapshotCounts = Object.create(null);
  snap10.forEach(function(r) {
    const id = String(r.SourceId || '').trim();
    if (ids[id]) snapshotCounts[id] = Number(snapshotCounts[id] || 0) + 1;
  });

  const changeCounts = Object.create(null);
  const testChangeIdsBySource = Object.create(null);
  change11.forEach(function(r) {
    const id = String(r.SourceId || '').trim();
    if (!ids[id]) return;
    changeCounts[id] = Number(changeCounts[id] || 0) + 1;
    if (!testChangeIdsBySource[id]) testChangeIdsBySource[id] = Object.create(null);
    const changeId = String(r.ChangeRecordId || '').trim();
    if (changeId) testChangeIdsBySource[id][changeId] = true;
  });

  const changeIdToSource = Object.create(null);
  Object.keys(testChangeIdsBySource).forEach(function(sourceId) {
    Object.keys(testChangeIdsBySource[sourceId]).forEach(function(changeId) { changeIdToSource[changeId] = sourceId; });
  });
  const detailCounts = Object.create(null);
  detail12.forEach(function(r) {
    const changeId = String(r.ChangeRecordId || '').trim();
    const sourceId = changeIdToSource[changeId];
    if (sourceId) detailCounts[sourceId] = Number(detailCounts[sourceId] || 0) + 1;
  });

  const targets = Object.keys(ids).sort().map(function(id) {
    const a = test01[id] || {};
    const b = test05[id] || {};
    return {
      ingestionSourceId: id,
      sourceType: String(b.SourceType || a.SourceAcquisitionType || ''),
      sourceRunId: String(b.SourceRunId || a.SourceRunId || ''),
      sourceUnitId: String(b.SourceUnitId || a.ExportKey || ''),
      entityType: String(b.EntityType || a.ExportKey || ''),
      presentIn01: !!test01[id],
      presentIn05: !!test05[id],
      processingStatus: String(b.ProcessingStatus || ''),
      recordCursor: b.RecordCursor === undefined ? '' : b.RecordCursor,
      observationCount: b.ObservationCount === undefined ? '' : b.ObservationCount,
      payloadCount: b.PayloadCount === undefined ? '' : b.PayloadCount,
      shardCount: b.ShardCount === undefined ? '' : b.ShardCount,
      attemptCount: b.AttemptCount === undefined ? '' : b.AttemptCount,
      evidenceFileId: String(b.EvidenceFileId || ''),
      evidenceFileName: String(b.EvidenceFileName || ''),
      evidenceHash: String(b.EvidenceHash || ''),
      evidenceHashType: String(b.EvidenceHashType || ''),
      registeredAt: b.RegisteredAt || '',
      lastHeartbeatAt: b.LastHeartbeatAt || '',
      lastProgressAt: b.LastProgressAt || '',
      processedAt: b.ProcessedAt || '',
      requestStartedAt: b.RequestStartedAt || '',
      requestCompletedAt: b.RequestCompletedAt || '',
      snapshotRecordCount: Number(snapshotCounts[id] || 0),
      changeRecordCount: Number(changeCounts[id] || 0),
      changeDetailCount: Number(detailCounts[id] || 0)
    };
  });
  return {targets: targets};
}

function qboCtlTestTargetedPayloadReconciliation_(ss, assessmentRunId, model) {
  const folder = qboResolveGovernedFolderAsset_(
    QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.PAYLOAD_FOLDER_ASSET_KEY,
    QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.PAYLOAD_FOLDER_EXPECTED_TYPE,
    QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.ENVIRONMENT
  );
  const stats = {
    targetSearchCount:0,
    searchedCandidateFileCount:0,
    parsedCandidateFileCount:0,
    invalidJsonCount:0,
    exactMatchedShardCount:0,
    exactMatchedPayloadCount:0,
    exactMatchedObservationCount:0,
    unsupportedTargetCount:0,
    noSearchWindowCount:0
  };

  model.targets.forEach(function(target) {
    if (!target.presentIn05 || Number(target.shardCount || 0) <= 0) return;
    stats.targetSearchCount += 1;

    if (String(target.sourceType || '') !== QBO_FULL_EXPORT_FORWARD_INGESTION_.SOURCE_TYPE) {
      stats.unsupportedTargetCount += 1;
      throw new Error('CONTROLLED_TEST_TARGETED_SEARCH_UNSUPPORTED_SOURCE_TYPE sourceId=' + target.ingestionSourceId + ' sourceType=' + target.sourceType);
    }

    const expected = qboCtlTestExpectedFullExportArtifact_(target);
    const window = qboCtlTestBuildArtifactTimeWindow_(target);
    if (!window) {
      stats.noSearchWindowCount += 1;
      throw new Error('CONTROLLED_TEST_TARGETED_SEARCH_NO_LIFECYCLE_WINDOW sourceId=' + target.ingestionSourceId);
    }

    // DriveApp Folder.searchFiles() rejected the otherwise valid-looking v2
    // query in production (Invalid argument: q). Avoid query-parser dependence:
    // enumerate folder metadata only, filter by shard filename prefix and this
    // exact ingestion row's lifecycle window, then open JSON only for those few
    // candidates. This remains bounded by metadata reads rather than payload-body
    // parsing across the full Change Payload population.
    const files = folder.getFiles();
    const windowStartMs = new Date(window.startIso).getTime();
    const windowEndMs = new Date(window.endIso).getTime();
    let targetCandidates = 0;
    let targetMatches = 0;
    console.log('[CONTROLLED TEST CONTAMINATION ASSESSMENT] | TARGETED ARTIFACT SEARCH | sourceId=' + target.ingestionSourceId + ' | window=' + window.startIso + '..' + window.endIso + ' | expectedWorkUnitId=' + expected.workUnitId);

    while (files.hasNext()) {
      const file = files.next();
      const fileName = String(file.getName() || '');
      if (fileName.indexOf(QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.FILE_PREFIX) !== 0) continue;
      const createdMs = file.getDateCreated().getTime();
      if (createdMs < windowStartMs || createdMs > windowEndMs) continue;

      stats.searchedCandidateFileCount += 1;
      targetCandidates += 1;
      let parsed = null;
      try {
        parsed = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
        stats.parsedCandidateFileCount += 1;
      } catch (err) {
        stats.invalidJsonCount += 1;
        continue;
      }
      const validation = qboCtlTestValidateExpectedFullExportShard_(target, expected, file, parsed);
      if (!validation.exactMatch) continue;
      if (qboCtlTestPersistArtifactMatch_(ss, assessmentRunId, target.ingestionSourceId, file, parsed)) {
        stats.exactMatchedShardCount += 1;
        stats.exactMatchedPayloadCount += validation.payloadCount;
        stats.exactMatchedObservationCount += validation.observationCount;
        targetMatches += 1;
      }
    }

    console.log('[CONTROLLED TEST CONTAMINATION ASSESSMENT] | TARGETED ARTIFACT RESULT | sourceId=' + target.ingestionSourceId + ' | candidates=' + targetCandidates + ' | exactMatches=' + targetMatches + ' | expectedShards=' + Number(target.shardCount || 0));
  });
  return stats;
}

function qboCtlTestExpectedFullExportArtifact_(target) {
  const shardCount = Number(target.shardCount || 0);
  const recordCursor = Number(target.recordCursor || 0);
  const observationCount = Number(target.observationCount || 0);
  const payloadCount = Number(target.payloadCount || 0);
  if (shardCount !== 1) throw new Error('CONTROLLED_TEST_TARGETED_FULL_EXPORT_EXPECTS_ONE_SHARD sourceId=' + target.ingestionSourceId + ' shardCount=' + shardCount);
  if (recordCursor <= 0 || observationCount !== recordCursor || payloadCount !== recordCursor) {
    throw new Error('CONTROLLED_TEST_TARGETED_FULL_EXPORT_LEDGER_COUNTS_NOT_EXACT sourceId=' + target.ingestionSourceId + ' cursor=' + recordCursor + ' observations=' + observationCount + ' payloads=' + payloadCount);
  }
  if (recordCursor > Number(QBO_FULL_EXPORT_FORWARD_INGESTION_.BATCH_SIZE || 100)) {
    throw new Error('CONTROLLED_TEST_TARGETED_FULL_EXPORT_CURSOR_EXCEEDS_SINGLE_BATCH sourceId=' + target.ingestionSourceId + ' cursor=' + recordCursor);
  }
  const start = 0;
  const end = recordCursor;
  return {
    recordCursorStart:start,
    recordCursorEndExclusive:end,
    observationCount:observationCount,
    payloadCount:payloadCount,
    ingestionRunId:'FORWARD_FULL_EXPORT|' + String(target.sourceRunId || ''),
    workUnitId:'FULL_EXPORT_INGEST|' + qboStateCaptureAuditSha256_(target.ingestionSourceId + '|' + start + '|' + end)
  };
}

function qboCtlTestBuildArtifactTimeWindow_(target) {
  const values = [
    target.registeredAt,
    target.requestStartedAt,
    target.requestCompletedAt,
    target.lastHeartbeatAt,
    target.lastProgressAt,
    target.processedAt
  ].map(qboCtlTestTimeMs_).filter(function(v){ return v > 0; });
  if (!values.length) return null;
  const min = Math.min.apply(Math, values) - QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.TARGET_WINDOW_PADDING_BEFORE_MS;
  const max = Math.max.apply(Math, values) + QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.TARGET_WINDOW_PADDING_AFTER_MS;
  return {startIso:new Date(min).toISOString(), endIso:new Date(max).toISOString()};
}

function qboCtlTestValidateExpectedFullExportShard_(target, expected, file, parsed) {
  if (!parsed || !parsed.stableBody) return {exactMatch:false};
  const b = parsed.stableBody;
  const payloads = Array.isArray(b.payloads) ? b.payloads : [];
  if (String(b.sourceId || '') !== target.ingestionSourceId) return {exactMatch:false};
  if (String(b.sourceType || '') !== QBO_FULL_EXPORT_FORWARD_INGESTION_.SOURCE_TYPE) return {exactMatch:false};
  if (String(b.ingestionRunId || '') !== expected.ingestionRunId) return {exactMatch:false};
  if (String(b.workUnitId || '') !== expected.workUnitId) return {exactMatch:false};
  if (Number(b.recordCursorStart) !== expected.recordCursorStart) return {exactMatch:false};
  if (Number(b.recordCursorEndExclusive) !== expected.recordCursorEndExclusive) return {exactMatch:false};
  if (Number(b.observationCount) !== expected.observationCount) return {exactMatch:false};
  if (payloads.length !== expected.payloadCount) return {exactMatch:false};

  const stableJson = qboCanonicalStableStringify_(b);
  const computedHash = qboStateCaptureAuditSha256_(stableJson);
  if (String(parsed.shardHash || '') !== computedHash) throw new Error('CONTROLLED_TEST_TARGETED_SHARD_HASH_MISMATCH fileId=' + file.getId());
  const expectedFileName = QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.FILE_PREFIX + computedHash + '.json';
  if (String(file.getName() || '') !== expectedFileName) throw new Error('CONTROLLED_TEST_TARGETED_SHARD_FILENAME_HASH_MISMATCH fileId=' + file.getId());
  if (String(parsed.schemaVersion || '') !== QBO_CHANGE_PAYLOAD_PERSISTENCE_.SHARD_SCHEMA_VERSION) throw new Error('CONTROLLED_TEST_TARGETED_SHARD_SCHEMA_MISMATCH fileId=' + file.getId());

  payloads.forEach(function(payload, i) {
    if (String(payload.sourceId || '') !== target.ingestionSourceId) throw new Error('CONTROLLED_TEST_TARGETED_PAYLOAD_SOURCE_ID_MISMATCH fileId=' + file.getId() + ' index=' + i);
    if (String(payload.sourceType || '') !== QBO_FULL_EXPORT_FORWARD_INGESTION_.SOURCE_TYPE) throw new Error('CONTROLLED_TEST_TARGETED_PAYLOAD_SOURCE_TYPE_MISMATCH fileId=' + file.getId() + ' index=' + i);
    if (String(payload.workUnitId || '') !== expected.workUnitId) throw new Error('CONTROLLED_TEST_TARGETED_PAYLOAD_WORK_UNIT_MISMATCH fileId=' + file.getId() + ' index=' + i);
    if (String(payload.exportRunId || '') !== String(target.sourceRunId || '')) throw new Error('CONTROLLED_TEST_TARGETED_PAYLOAD_EXPORT_RUN_MISMATCH fileId=' + file.getId() + ' index=' + i);
    const se = payload.sourceEvidence || {};
    if (String(se.evidenceFileId || '') !== String(target.evidenceFileId || '')) throw new Error('CONTROLLED_TEST_TARGETED_PAYLOAD_EVIDENCE_FILE_ID_MISMATCH fileId=' + file.getId() + ' index=' + i);
    if (target.evidenceHash && String(se.evidenceHash || '') !== String(target.evidenceHash)) throw new Error('CONTROLLED_TEST_TARGETED_PAYLOAD_EVIDENCE_HASH_MISMATCH fileId=' + file.getId() + ' index=' + i);
  });

  return {exactMatch:true, observationCount:Number(b.observationCount || 0), payloadCount:payloads.length, shardHash:computedHash};
}

function qboCtlTestTimeMs_(value) {
  if (value instanceof Date) return isNaN(value.getTime()) ? 0 : value.getTime();
  const s = String(value || '').trim();
  if (!s) return 0;
  const d = new Date(s);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function qboCtlTestPersistArtifactMatch_(ss, assessmentRunId, sourceId, file, parsed) {
  const sh = qboCtlTestEnsureSheet_(ss, QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.ARTIFACT_SHEET, QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.ARTIFACT_HEADERS);
  const fileId = file.getId();
  const lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    const vals = sh.getRange(2,1,lastRow-1,3).getValues();
    for (let i=0;i<vals.length;i++) {
      if (String(vals[i][0]||'') === assessmentRunId && String(vals[i][2]||'') === fileId) return false;
    }
  }
  const b = parsed.stableBody || {};
  const payloads = Array.isArray(b.payloads) ? b.payloads : [];
  sh.appendRow([
    assessmentRunId, sourceId, fileId, file.getName(), String(parsed.shardHash || ''), String(parsed.createdAt || ''),
    String(b.ingestionRunId || ''), String(b.workUnitId || ''), String(b.sourceType || ''),
    b.recordCursorStart === undefined ? '' : b.recordCursorStart,
    b.recordCursorEndExclusive === undefined ? '' : b.recordCursorEndExclusive,
    Number(b.observationCount || 0), payloads.length, new Date()
  ]);
  return true;
}

function qboCtlTestReadArtifactAggregation_(ss, assessmentRunId) {
  const out = Object.create(null);
  const sh = ss.getSheetByName(QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.ARTIFACT_SHEET);
  if (!sh || sh.getLastRow() < 2) return out;
  const rows = qboCtlTestReadSheetObjects_(ss, QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.ARTIFACT_SHEET);
  rows.forEach(function(r) {
    if (String(r.AssessmentRunId || '') !== assessmentRunId) return;
    const id = String(r.IngestionSourceId || '');
    if (!out[id]) out[id] = {shards:0, observations:0, payloads:0};
    out[id].shards += 1;
    out[id].observations += Number(r.ObservationCount || 0);
    out[id].payloads += Number(r.PayloadCount || 0);
  });
  return out;
}

function qboCtlTestPersistSummary_(ss, assessmentRunId, model, artifactAgg, scanComplete) {
  const sh = qboCtlTestEnsureSheet_(ss, QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.SUMMARY_SHEET, QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.SUMMARY_HEADERS);
  if (sh.getLastRow() > 1) sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).clearContent();
  const now = new Date();
  const rows = model.targets.map(function(t) {
    const a = artifactAgg[t.ingestionSourceId] || {shards:0, observations:0, payloads:0};
    const downstream = t.snapshotRecordCount + t.changeRecordCount + t.changeDetailCount;
    let classification = '';
    let disposition = '';
    let detail = '';
    if (downstream > 0) {
      classification = 'CONTROLLED_TEST_REACHED_STATE_APPLICATION';
      disposition = 'GOVERNANCE_REVIEW_REQUIRED_NO_MUTATION_AUTHORIZED';
      detail = 'Exact SourceId/ChangeRecord lineage proves controlled-test data reached State Application output/reference sheets.';
    } else if (t.presentIn05) {
      classification = scanComplete ? 'CONTROLLED_TEST_FORWARD_INGESTED_NO_STATE_APPLICATION' : 'PAYLOAD_ARTIFACT_SCAN_IN_PROGRESS';
      disposition = scanComplete ? 'GOVERNANCE_DISPOSITION_REQUIRED' : 'COMPLETE_ARTIFACT_SCAN_BEFORE_DISPOSITION';
      detail = scanComplete ? 'Controlled test reached the forward-ingestion ledger but no exact test-derived rows were found in 10/11/12.' : 'State-output trace complete; payload artifact folder scan is still in progress.';
    } else {
      classification = 'CONTROLLED_TEST_SOURCE_REGISTRATION_ONLY';
      disposition = 'NON_PRODUCTION_TEST_EVIDENCE_RETAIN_PENDING_GOVERNANCE';
      detail = 'Controlled test exists in 01_Sources but has no exact corresponding 05 forward-ingestion row.';
    }
    return [
      assessmentRunId,QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.VERSION,now,t.ingestionSourceId,t.sourceType,t.sourceRunId,
      t.sourceUnitId,t.entityType,t.presentIn01,t.presentIn05,t.processingStatus,t.recordCursor,t.observationCount,t.payloadCount,
      t.shardCount,t.attemptCount,a.shards,a.observations,t.snapshotRecordCount,t.changeRecordCount,t.changeDetailCount,
      classification,disposition,false,detail
    ];
  });
  if (rows.length) sh.getRange(2,1,rows.length,QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.SUMMARY_HEADERS.length).setValues(rows);
}

function qboCtlTestBuildTargetedResult_(assessmentRunId, model, artifactAgg, scan, startedAt) {
  let in01 = 0, in05 = 0, expectedShards = 0, expectedPayloads = 0, matchedShards = 0, matchedObs = 0, matchedPayloads = 0;
  let snapshots = 0, changes = 0, details = 0;
  model.targets.forEach(function(t) {
    if (t.presentIn01) in01 += 1;
    if (t.presentIn05) in05 += 1;
    expectedShards += Number(t.shardCount || 0);
    expectedPayloads += Number(t.payloadCount || 0);
    snapshots += t.snapshotRecordCount; changes += t.changeRecordCount; details += t.changeDetailCount;
    const a = artifactAgg[t.ingestionSourceId] || {shards:0, observations:0, payloads:0};
    matchedShards += a.shards; matchedObs += a.observations; matchedPayloads += a.payloads;
  });
  const exactArtifactReconciliationPassed =
    matchedShards === expectedShards &&
    matchedObs === expectedPayloads &&
    matchedPayloads === expectedPayloads;
  let overall = exactArtifactReconciliationPassed
    ? 'CONTROLLED_TEST_PAYLOAD_EXACTLY_RECONCILED_NO_STATE_APPLICATION_CONTAMINATION'
    : 'CONTROLLED_TEST_PAYLOAD_ARTIFACT_RECONCILIATION_FAILED';
  if (snapshots + changes + details > 0) overall = 'STATE_APPLICATION_CONTAMINATION_FOUND';

  return {
    version: QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.VERSION,
    status: 'DIAGNOSTIC_COMPLETE',
    productionDataReadOnly: true,
    diagnosticOutputWritten: true,
    productionDataMutationApplied: false,
    assessmentRunId: assessmentRunId,
    controlledTestSourceCount: model.targets.length,
    controlledTestPresentIn01Count: in01,
    controlledTestPresentIn05Count: in05,
    expectedShardCountFrom05: expectedShards,
    expectedPayloadCountFrom05: expectedPayloads,
    targetedSearchCount: Number(scan.targetSearchCount || 0),
    searchedCandidatePayloadFileCount: Number(scan.searchedCandidateFileCount || 0),
    parsedCandidatePayloadFileCount: Number(scan.parsedCandidateFileCount || 0),
    matchedPayloadShardCount: matchedShards,
    matchedPayloadObservationCount: matchedObs,
    matchedPayloadCount: matchedPayloads,
    invalidPayloadJsonCount: Number(scan.invalidJsonCount || 0),
    payloadArtifactScanComplete: true,
    exactArtifactReconciliationPassed: exactArtifactReconciliationPassed,
    snapshotRecordCount: snapshots,
    changeRecordCount: changes,
    changeDetailCount: details,
    stateApplicationContaminationFound: snapshots + changes + details > 0,
    overallAssessment: overall,
    sourceMutationAuthorized: false,
    payloadDeletionAuthorized: false,
    stateOutputDeletionAuthorized: false,
    summarySheet: QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.SUMMARY_SHEET,
    artifactSheet: QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.ARTIFACT_SHEET,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString()
  };
}

function qboCtlTestPrepareDiagnosticSheets_(ss, assessmentRunId) {
  const summary = qboCtlTestEnsureSheet_(ss, QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.SUMMARY_SHEET, QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.SUMMARY_HEADERS);
  const artifacts = qboCtlTestEnsureSheet_(ss, QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.ARTIFACT_SHEET, QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.ARTIFACT_HEADERS);
  if (summary.getLastRow() > 1) summary.getRange(2,1,summary.getLastRow()-1,summary.getLastColumn()).clearContent();
  if (artifacts.getLastRow() > 1) artifacts.getRange(2,1,artifacts.getLastRow()-1,artifacts.getLastColumn()).clearContent();
}

function qboCtlTestEnsureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1,1,1,headers.length).setFontWeight('bold');
    sh.getDataRange().setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    return sh;
  }
  const actual = sh.getRange(1,1,1,Math.max(sh.getLastColumn(),headers.length)).getValues()[0].slice(0,headers.length).map(function(v){return String(v||'').trim();});
  for (let i=0;i<headers.length;i++) if (actual[i] !== headers[i]) throw new Error('CONTROLLED_TEST_DIAGNOSTIC_HEADER_MISMATCH sheet=' + name + ' column=' + (i+1));
  return sh;
}

function qboCtlTestReadSheetObjects_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();});
  return sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues().map(function(row) {
    const o = {};
    headers.forEach(function(h,i){ if(h) o[h]=row[i]; });
    return o;
  });
}

function qboCtlTestIsTestId_(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  if (typeof isQboStateCaptureControlledTestRunId_ === 'function' && isQboStateCaptureControlledTestRunId_(s)) return true;
  return s.indexOf('STATE_CAPTURE_AUTOREG_TEST_') >= 0;
}

function qboCtlTestReadCheckpoint_() {
  const raw = PropertiesService.getScriptProperties().getProperty(QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.CHECKPOINT_PROPERTY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (err) { return null; }
}
function qboCtlTestWriteCheckpoint_(v) {
  PropertiesService.getScriptProperties().setProperty(QBO_CONTROLLED_TEST_CONTAMINATION_ASSESSMENT_.CHECKPOINT_PROPERTY, JSON.stringify(v));
}
function qboCtlTestSha256_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  return bytes.map(function(b){ const n=(b<0?b+256:b); return (n<16?'0':'')+n.toString(16); }).join('');
}
