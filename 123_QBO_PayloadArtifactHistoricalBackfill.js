/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 123_QBO_PayloadArtifactHistoricalBackfill.js
 * Version     : 1.5.100
 * Purpose     : Resumable exact reconstruction of the historical
 *               06_Payload_Artifacts ledger from immutable Change Payload
 *               shards plus 05_Forward_Ingestion_Control.
 *
 * Safety:
 *   - Existing Change Payload files are read-only.
 *   - 05 is read-only.
 *   - Only 06_Payload_Artifacts and diagnostic sheets are written.
 *   - Unknown/mismatched lineage is recorded, never guessed.
 * ============================================================================
 */

const QBO_PAYLOAD_ARTIFACT_BACKFILL_ = Object.freeze({
  VERSION: 'QBO_PAYLOAD_ARTIFACT_HISTORICAL_BACKFILL_V1_5_100',
  FINDING_SHEET: '105_Payload_Artifact_Backfill_Findings',
  SUMMARY_SHEET: '106_Payload_Artifact_Backfill_Summary',
  RUNTIME_BUDGET_MS: 225000,
  CONTINUATION_HANDLER: 'qboPayloadArtifactHistoricalBackfillContinuation_',
  CONTINUATION_DELAY_MS: 60000,
  FILE_PREFIX: 'qbo_change_payload_shard_',
  FINDING_HEADERS: Object.freeze([
    'RunId','PayloadFileId','PayloadFileName','IngestionSourceId','FindingCode','Detail','ObservedAt'
  ]),
  SUMMARY_HEADERS: Object.freeze([
    'RunId','Status','FolderShardCount','AlreadyLedgeredCount','ProcessedThisRun','RegisteredExactThisRun',
    'RegisteredNonExactThisRun','InvalidJsonThisRun','HashMismatchThisRun','RemainingEstimate','StartedAt','CompletedAt','IteratorExhausted','ContinuationScheduled'
  ])
});

function runQboPayloadArtifactHistoricalBackfill() {
  // Manual/start entry point. A continuation chain is self-managed from here.
  qboPayloadArtifactBackfillDeleteContinuationTriggers_();
  return qboPayloadArtifactHistoricalBackfillWorker_();
}

function qboPayloadArtifactHistoricalBackfillContinuation_() {
  // Remove the fired/queued continuation before doing work so the worker can
  // safely create exactly one successor if runtime is reached again.
  qboPayloadArtifactBackfillDeleteContinuationTriggers_();
  return qboPayloadArtifactHistoricalBackfillWorker_();
}

function cancelQboPayloadArtifactHistoricalBackfillContinuation() {
  const removed = qboPayloadArtifactBackfillDeleteContinuationTriggers_();
  const result = {version:QBO_PAYLOAD_ARTIFACT_BACKFILL_.VERSION,status:'CONTINUATION_CANCELLED',removedTriggerCount:removed};
  console.log('[PAYLOAD ARTIFACT BACKFILL] | CONTINUATION_CANCELLED | ' + JSON.stringify(result));
  return result;
}

function qboPayloadArtifactBackfillDeleteContinuationTriggers_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    let removed = 0;
    ScriptApp.getProjectTriggers().forEach(function(trigger) {
      if (trigger.getHandlerFunction() === QBO_PAYLOAD_ARTIFACT_BACKFILL_.CONTINUATION_HANDLER) {
        ScriptApp.deleteTrigger(trigger);
        removed += 1;
      }
    });
    return removed;
  } finally {
    lock.releaseLock();
  }
}

function qboPayloadArtifactBackfillScheduleContinuation_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const existing = ScriptApp.getProjectTriggers().filter(function(trigger) {
      return trigger.getHandlerFunction() === QBO_PAYLOAD_ARTIFACT_BACKFILL_.CONTINUATION_HANDLER;
    });
    if (existing.length > 0) return {scheduled:false,alreadyPresent:true,triggerCount:existing.length};
    const trigger = ScriptApp.newTrigger(QBO_PAYLOAD_ARTIFACT_BACKFILL_.CONTINUATION_HANDLER)
      .timeBased()
      .after(QBO_PAYLOAD_ARTIFACT_BACKFILL_.CONTINUATION_DELAY_MS)
      .create();
    return {scheduled:true,alreadyPresent:false,triggerId:trigger.getUniqueId()};
  } finally {
    lock.releaseLock();
  }
}

function qboPayloadArtifactBackfillMigrateSummarySchema_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(QBO_PAYLOAD_ARTIFACT_BACKFILL_.SUMMARY_SHEET);
  if (!sheet || sheet.getLastRow() === 0) return;

  const legacyHeaders = [
    'RunId','Status','FolderShardCount','AlreadyLedgeredCount','ProcessedThisRun','RegisteredExactThisRun',
    'RegisteredNonExactThisRun','InvalidJsonThisRun','HashMismatchThisRun','RemainingEstimate','StartedAt','CompletedAt'
  ];
  const lastColumn = Math.max(sheet.getLastColumn(), legacyHeaders.length);
  const observed = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function(v) { return String(v || ''); });
  const current = QBO_PAYLOAD_ARTIFACT_BACKFILL_.SUMMARY_HEADERS;
  const exactCurrent = current.every(function(h, i) { return observed[i] === h; }) && observed.slice(current.length).every(function(v) { return v === ''; });
  if (exactCurrent) return;

  const exactLegacy = legacyHeaders.every(function(h, i) { return observed[i] === h; }) && observed.slice(legacyHeaders.length).every(function(v) { return v === ''; });
  if (!exactLegacy) return; // Fail closed in ensureQboStateCaptureSheet_ below.

  // Append-only schema migration. Existing historical summary rows remain intact;
  // the two v1.5.99+ continuation fields are added at the end.
  sheet.getRange(1, legacyHeaders.length + 1, 1, 2).setValues([['IteratorExhausted','ContinuationScheduled']]);
  console.log('[PAYLOAD ARTIFACT BACKFILL] | SUMMARY_SCHEMA_MIGRATED | legacyColumns=12 | currentColumns=14');
}

function qboPayloadArtifactHistoricalBackfillWorker_() {
  provisionQboPayloadArtifactLedger();
  const startedAt = new Date();
  const runId = 'PAYLOAD_ARTIFACT_BACKFILL|' + Utilities.getUuid();
  const folder = qboResolveGovernedFolderAsset_(
    QBO_CHANGE_PAYLOAD_PERSISTENCE_.FOLDER_ASSET_KEY,
    QBO_CHANGE_PAYLOAD_PERSISTENCE_.FOLDER_EXPECTED_TYPE,
    QBO_CHANGE_PAYLOAD_PERSISTENCE_.ENVIRONMENT
  );
  const ledgerSheet = qboPayloadArtifactEnsureSheet_();
  const existingRows = qboPayloadArtifactReadRows_(ledgerSheet);
  const ledgeredIds = Object.create(null);
  existingRows.forEach(function(r) { ledgeredIds[String(r.PayloadFileId || '')] = true; });

  const controlSheet = qboForwardIngestionEnsureSheet_();
  const controlRows = qboForwardIngestionReadRows_(controlSheet);
  const controlBySource = Object.create(null);
  controlRows.forEach(function(r) { controlBySource[String(r.IngestionSourceId || '')] = r; });

  // Historical Change Payload reconstruction (module 102) was sourced from
  // 01_Sources and intentionally did not create 05 forward-ingestion rows.
  // Preserve that distinction: absence from 05 is not an orphan when the
  // shard's embedded sourceId can be proven against the authoritative 01 row.
  const sourceSheet = getQboStateCaptureSpreadsheet_().getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
  const sourceRows = loadQboStateCaptureWriteSources_(sourceSheet, '');
  const source01ById = Object.create(null);
  sourceRows.forEach(function(r) { source01ById[String(r.sourceId || '')] = r; });

  const spreadsheet = getQboStateCaptureSpreadsheet_();
  qboPayloadArtifactBackfillMigrateSummarySchema_(spreadsheet);
  const findingSheet = ensureQboStateCaptureSheet_(spreadsheet, QBO_PAYLOAD_ARTIFACT_BACKFILL_.FINDING_SHEET, QBO_PAYLOAD_ARTIFACT_BACKFILL_.FINDING_HEADERS);
  const summarySheet = ensureQboStateCaptureSheet_(spreadsheet, QBO_PAYLOAD_ARTIFACT_BACKFILL_.SUMMARY_SHEET, QBO_PAYLOAD_ARTIFACT_BACKFILL_.SUMMARY_HEADERS);
  applyQboStateCaptureSheetLayout_(findingSheet);
  applyQboStateCaptureSheetLayout_(summarySheet);

  let folderShardCount = 0;
  let alreadyLedgeredCount = 0;
  let processedThisRun = 0;
  let exactThisRun = 0;
  let nonExactThisRun = 0;
  let invalidJsonThisRun = 0;
  let hashMismatchThisRun = 0;
  let timedOut = false;
  const findingRows = [];
  const iterator = folder.getFiles();

  while (iterator.hasNext()) {
    const file = iterator.next();
    const fileName = String(file.getName() || '');
    if (fileName.indexOf(QBO_PAYLOAD_ARTIFACT_BACKFILL_.FILE_PREFIX) !== 0 || !/\.json$/i.test(fileName)) continue;
    folderShardCount += 1;
    const fileId = file.getId();
    if (ledgeredIds[fileId]) {
      alreadyLedgeredCount += 1;
      continue;
    }
    if (Date.now() - startedAt.getTime() >= QBO_PAYLOAD_ARTIFACT_BACKFILL_.RUNTIME_BUDGET_MS) {
      timedOut = true;
      break;
    }

    processedThisRun += 1;
    let envelope;
    try {
      envelope = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
    } catch (error) {
      invalidJsonThisRun += 1;
      findingRows.push([runId,fileId,fileName,'','INVALID_JSON',String(error && error.message || error),new Date()]);
      continue;
    }

    const stableBody = envelope && envelope.stableBody || {};
    const sourceId = String(stableBody.sourceId || '');
    const stableJson = qboCanonicalStableStringify_(stableBody);
    const actualHash = qboStateCaptureAuditSha256_(stableJson);
    const envelopeHash = String(envelope.shardHash || '');
    const expectedName = QBO_CHANGE_PAYLOAD_PERSISTENCE_.FILE_PREFIX + actualHash + '.json';
    const hashValid = envelopeHash === actualHash && fileName === expectedName;
    if (!hashValid) {
      hashMismatchThisRun += 1;
      findingRows.push([runId,fileId,fileName,sourceId,'SHARD_HASH_OR_FILENAME_MISMATCH',
        'envelopeHash=' + envelopeHash + '; actualHash=' + actualHash + '; expectedName=' + expectedName,new Date()]);
    }

    const control = controlBySource[sourceId] || null;
    const payloads = Array.isArray(stableBody.payloads) ? stableBody.payloads : [];
    const observationCount = Number(stableBody.observationCount || payloads.length || 0);
    let lineageStatus = QBO_PAYLOAD_ARTIFACT_LEDGER_.LINEAGE_EXACT;
    const lineageProblems = [];
    if (!control) {
      const historicalSource = source01ById[sourceId] || null;
      const historicalRun = String(stableBody.ingestionRunId || '').indexOf('HIST_PAYLOAD|') === 0;
      const historicalWorkUnit = String(stableBody.workUnitId || '').indexOf('HISTWU|') === 0;
      const sourceTypeMatches01 = historicalSource &&
        String(historicalSource.sourceAcquisitionType || '') === String(stableBody.sourceType || '');
      const sourceRunMatches01 = historicalSource &&
        String(historicalSource.sourceRunId || '') === qboPayloadArtifactSourceRunIdFromSourceId_(sourceId);
      if (historicalSource && historicalRun && historicalWorkUnit && sourceTypeMatches01 && sourceRunMatches01 && hashValid) {
        lineageStatus = QBO_PAYLOAD_ARTIFACT_LEDGER_.LINEAGE_HISTORICAL_SOURCE_EXACT;
      } else {
        lineageStatus = QBO_PAYLOAD_ARTIFACT_LEDGER_.LINEAGE_ORPHAN;
        if (!historicalSource) lineageProblems.push('NO_MATCHING_01_OR_05_SOURCE');
        else {
          if (!historicalRun) lineageProblems.push('NOT_HIST_PAYLOAD_RUN');
          if (!historicalWorkUnit) lineageProblems.push('NOT_HISTWU');
          if (!sourceTypeMatches01) lineageProblems.push('SOURCE_TYPE_01');
          if (!sourceRunMatches01) lineageProblems.push('SOURCE_RUN_ID_01');
          if (!hashValid) lineageProblems.push('HASH');
        }
      }
    } else {
      if (String(control.SourceType || '') !== String(stableBody.sourceType || '')) lineageProblems.push('SOURCE_TYPE');
      const expectedIngestionRunId = 'FORWARD_' + String(control.SourceType || '') + '|' + String(control.SourceRunId || '');
      if (String(stableBody.ingestionRunId || '') !== expectedIngestionRunId) lineageProblems.push('INGESTION_RUN_ID');
      if (Number(stableBody.recordCursorEndExclusive || 0) < Number(stableBody.recordCursorStart || 0)) lineageProblems.push('CURSOR_ORDER');
      if (observationCount !== payloads.length) lineageProblems.push('OBSERVATION_PAYLOAD_COUNT');
      if (!hashValid) lineageProblems.push('HASH');
      if (lineageProblems.length) lineageStatus = QBO_PAYLOAD_ARTIFACT_LEDGER_.LINEAGE_MISMATCH;
    }

    qboPayloadArtifactRegister_({
      ingestionSourceId: sourceId,
      sourceType: String(stableBody.sourceType || ''),
      sourceRunId: control ? String(control.SourceRunId || '') : (source01ById[sourceId] ? String(source01ById[sourceId].sourceRunId || '') : ''),
      ingestionRunId: String(stableBody.ingestionRunId || ''),
      workUnitId: String(stableBody.workUnitId || ''),
      recordCursorStart: stableBody.recordCursorStart,
      recordCursorEndExclusive: stableBody.recordCursorEndExclusive,
      observationCount: observationCount,
      payloadCount: payloads.length,
      payloadFileId: fileId,
      payloadFileName: fileName,
      payloadShardHash: actualHash,
      payloadCreatedAt: file.getDateCreated(),
      persistedAt: new Date(),
      registrationMode: QBO_PAYLOAD_ARTIFACT_LEDGER_.REGISTRATION_MODE_HISTORICAL,
      lineageStatus: lineageStatus,
      contentVerifiedAt: new Date()
    });
    ledgeredIds[fileId] = true;

    if (lineageStatus === QBO_PAYLOAD_ARTIFACT_LEDGER_.LINEAGE_EXACT || lineageStatus === QBO_PAYLOAD_ARTIFACT_LEDGER_.LINEAGE_HISTORICAL_SOURCE_EXACT) {
      exactThisRun += 1;
    } else {
      nonExactThisRun += 1;
      findingRows.push([runId,fileId,fileName,sourceId,lineageStatus,lineageProblems.join(','),new Date()]);
    }
  }

  if (findingRows.length) {
    findingSheet.getRange(findingSheet.getLastRow() + 1, 1, findingRows.length, QBO_PAYLOAD_ARTIFACT_BACKFILL_.FINDING_HEADERS.length).setValues(findingRows);
  }

  const allLedgerRows = qboPayloadArtifactReadRows_(ledgerSheet);
  // EOF is authoritative. remainingEstimate is intentionally null until EOF;
  // a runtime-truncated iterator cannot know the total physical population.
  const iteratorExhausted = !timedOut && !iterator.hasNext();
  const remainingEstimate = iteratorExhausted ? Math.max(0, folderShardCount - allLedgerRows.length) : null;
  const status = iteratorExhausted && remainingEstimate === 0 ? 'BACKFILL_COMPLETE' : 'BACKFILL_IN_PROGRESS';
  let continuation = {scheduled:false};
  if (status === 'BACKFILL_IN_PROGRESS') {
    continuation = qboPayloadArtifactBackfillScheduleContinuation_();
  } else {
    qboPayloadArtifactBackfillDeleteContinuationTriggers_();
  }
  const completedAt = new Date();
  summarySheet.appendRow([
    runId,status,folderShardCount,alreadyLedgeredCount,processedThisRun,exactThisRun,nonExactThisRun,
    invalidJsonThisRun,hashMismatchThisRun,remainingEstimate,startedAt,completedAt,iteratorExhausted,Boolean(continuation.scheduled || continuation.alreadyPresent)
  ]);
  applyQboStateCaptureSheetLayout_(findingSheet);
  applyQboStateCaptureSheetLayout_(summarySheet);

  const result = {
    version: QBO_PAYLOAD_ARTIFACT_BACKFILL_.VERSION,
    status: status,
    productionPayloadMutationApplied: false,
    forwardIngestionControlMutationApplied: false,
    payloadArtifactLedgerWritten: true,
    folderShardCount: folderShardCount,
    ledgerRowCount: allLedgerRows.length,
    alreadyLedgeredCount: alreadyLedgeredCount,
    processedThisRun: processedThisRun,
    registeredExactThisRun: exactThisRun,
    registeredNonExactThisRun: nonExactThisRun,
    invalidPayloadJsonThisRun: invalidJsonThisRun,
    hashMismatchThisRun: hashMismatchThisRun,
    remainingEstimate: remainingEstimate,
    iteratorExhausted: iteratorExhausted,
    continuationScheduled: Boolean(continuation.scheduled || continuation.alreadyPresent),
    continuation: continuation,
    findingSheet: QBO_PAYLOAD_ARTIFACT_BACKFILL_.FINDING_SHEET,
    summarySheet: QBO_PAYLOAD_ARTIFACT_BACKFILL_.SUMMARY_SHEET,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString()
  };
  console.log('[PAYLOAD ARTIFACT BACKFILL] | ' + status + ' | ' + JSON.stringify(result, null, 2));
  return result;
}

function auditQboPayloadArtifactReconciliation() {
  const folder = qboResolveGovernedFolderAsset_(
    QBO_CHANGE_PAYLOAD_PERSISTENCE_.FOLDER_ASSET_KEY,
    QBO_CHANGE_PAYLOAD_PERSISTENCE_.FOLDER_EXPECTED_TYPE,
    QBO_CHANGE_PAYLOAD_PERSISTENCE_.ENVIRONMENT
  );
  const ledgerRows = qboPayloadArtifactReadRows_(qboPayloadArtifactEnsureSheet_());
  const controlRows = qboForwardIngestionReadRows_(qboForwardIngestionEnsureSheet_());
  const ledgerByFileId = Object.create(null);
  const ledgerBySource = Object.create(null);
  const workUnitKeys = Object.create(null);
  const duplicateFileIds = [];
  const duplicateWorkUnits = [];
  ledgerRows.forEach(function(r) {
    const fileId = String(r.PayloadFileId || '');
    if (ledgerByFileId[fileId]) duplicateFileIds.push(fileId);
    ledgerByFileId[fileId] = r;
    const sourceId = String(r.IngestionSourceId || '');
    if (!ledgerBySource[sourceId]) ledgerBySource[sourceId] = [];
    ledgerBySource[sourceId].push(r);
    const workUnitId = String(r.WorkUnitId || '');
    const workUnitKey = sourceId + '|' + workUnitId;
    if (workUnitId && workUnitKeys[workUnitKey]) duplicateWorkUnits.push(workUnitKey);
    if (workUnitId) workUnitKeys[workUnitKey] = true;
  });

  const physicalIds = Object.create(null);
  const unledgeredPhysicalFiles = [];
  let physicalShardCount = 0;
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const name = String(f.getName() || '');
    if (name.indexOf(QBO_PAYLOAD_ARTIFACT_BACKFILL_.FILE_PREFIX) !== 0 || !/\.json$/i.test(name)) continue;
    physicalShardCount += 1;
    physicalIds[f.getId()] = true;
    if (!ledgerByFileId[f.getId()]) unledgeredPhysicalFiles.push({fileId:f.getId(),fileName:name});
  }

  const missingPhysicalFiles = ledgerRows.filter(function(r) { return !physicalIds[String(r.PayloadFileId || '')]; })
    .map(function(r) { return {fileId:String(r.PayloadFileId || ''),fileName:String(r.PayloadFileName || ''),sourceId:String(r.IngestionSourceId || '')}; });
  const sourceReconciliationFailures = [];
  const cursorCoverageFailures = [];
  controlRows.forEach(function(c) {
    const sourceId = String(c.IngestionSourceId || '');
    const artifacts = (ledgerBySource[sourceId] || []).slice();
    const expectedShards = Number(c.ShardCount || 0);
    const artifactCount = artifacts.length;
    const artifactPayloads = artifacts.reduce(function(sum, a) { return sum + Number(a.PayloadCount || 0); }, 0);
    const expectedPayloads = Number(c.PayloadCount || 0);
    if (expectedShards !== artifactCount || expectedPayloads !== artifactPayloads) {
      sourceReconciliationFailures.push({
        sourceId:sourceId,
        expectedShards:expectedShards,
        artifactRows:artifactCount,
        expectedPayloads:expectedPayloads,
        artifactPayloads:artifactPayloads
      });
    }
    if (artifacts.length) {
      artifacts.sort(function(a,b) { return Number(a.RecordCursorStart || 0) - Number(b.RecordCursorStart || 0); });
      let expectedStart = 0;
      let validCoverage = true;
      artifacts.forEach(function(a) {
        const start = Number(a.RecordCursorStart || 0);
        const end = Number(a.RecordCursorEndExclusive || 0);
        if (start !== expectedStart || end < start) validCoverage = false;
        expectedStart = end;
      });
      const controlCursor = Number(c.RecordCursor || 0);
      if (expectedStart !== controlCursor) validCoverage = false;
      if (!validCoverage) cursorCoverageFailures.push({sourceId:sourceId,artifactCount:artifacts.length,artifactEnd:expectedStart,controlCursor:controlCursor});
    }
  });
  const nonExactLineageRows = ledgerRows.filter(function(r) {
    const status = String(r.LineageStatus || '');
    return status !== QBO_PAYLOAD_ARTIFACT_LEDGER_.LINEAGE_EXACT &&
      status !== QBO_PAYLOAD_ARTIFACT_LEDGER_.LINEAGE_HISTORICAL_SOURCE_EXACT;
  }).map(function(r) {
    return {fileId:String(r.PayloadFileId || ''),sourceId:String(r.IngestionSourceId || ''),lineageStatus:String(r.LineageStatus || '')};
  });

  const valid = duplicateFileIds.length === 0 && duplicateWorkUnits.length === 0 && unledgeredPhysicalFiles.length === 0 && missingPhysicalFiles.length === 0 && sourceReconciliationFailures.length === 0 && cursorCoverageFailures.length === 0 && nonExactLineageRows.length === 0;
  const result = {
    version: 'QBO_PAYLOAD_ARTIFACT_RECONCILIATION_AUDIT_V1_5_99',
    status: valid ? 'VALID' : 'INVALID',
    physicalShardCount: physicalShardCount,
    ledgerRowCount: ledgerRows.length,
    controlSourceCount: controlRows.length,
    duplicateFileIdCount: duplicateFileIds.length,
    duplicateWorkUnitCount: duplicateWorkUnits.length,
    unledgeredPhysicalFileCount: unledgeredPhysicalFiles.length,
    missingPhysicalFileCount: missingPhysicalFiles.length,
    sourceReconciliationFailureCount: sourceReconciliationFailures.length,
    cursorCoverageFailureCount: cursorCoverageFailures.length,
    nonExactLineageRowCount: nonExactLineageRows.length,
    duplicateFileIds: duplicateFileIds.slice(0,25),
    duplicateWorkUnits: duplicateWorkUnits.slice(0,25),
    unledgeredPhysicalFiles: unledgeredPhysicalFiles.slice(0,25),
    missingPhysicalFiles: missingPhysicalFiles.slice(0,25),
    sourceReconciliationFailures: sourceReconciliationFailures.slice(0,25),
    cursorCoverageFailures: cursorCoverageFailures.slice(0,25),
    nonExactLineageRows: nonExactLineageRows.slice(0,25)
  };
  console.log('[PAYLOAD ARTIFACT RECONCILIATION AUDIT] | ' + result.status + ' | ' + JSON.stringify(result, null, 2));
  return result;
}


/**
 * Recover the run id encoded by the governed FULL_EXPORT source identity.
 * This does not guess: FULL_EXPORT|<RunId>|<ExportKey> is the workbook contract.
 */
function qboPayloadArtifactSourceRunIdFromSourceId_(sourceId) {
  const parts = String(sourceId || '').split('|');
  return parts.length >= 3 && parts[0] === 'FULL_EXPORT' ? String(parts[1] || '') : '';
}

/**
 * Upgrade already-inventoried ORPHAN_NO_05_SOURCE rows when immutable shard
 * evidence proves they were created by module 102 historical reconstruction
 * from an exact authoritative 01_Sources row.
 *
 * Mutates only 06 lineage metadata: SourceRunId, LineageStatus,
 * ContentVerifiedAt. Payload files, 01, and 05 remain read-only.
 */
function reconcileQboHistoricalPayloadArtifactSourceLineage() {
  provisionQboPayloadArtifactLedger();
  const ss = getQboStateCaptureSpreadsheet_();
  const sourceSheet = ss.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
  const sources = loadQboStateCaptureWriteSources_(sourceSheet, '');
  const sourceById = Object.create(null);
  sources.forEach(function(s) { sourceById[String(s.sourceId || '')] = s; });

  const ledgerSheet = qboPayloadArtifactEnsureSheet_();
  const rows = qboPayloadArtifactReadRows_(ledgerSheet);
  const idx = qboPayloadArtifactHeaderIndex_();
  let assessed = 0, upgraded = 0, retainedOrphan = 0, invalid = 0;
  const details = [];

  rows.forEach(function(r) {
    if (String(r.LineageStatus || '') !== QBO_PAYLOAD_ARTIFACT_LEDGER_.LINEAGE_ORPHAN) return;
    assessed += 1;
    const fileId = String(r.PayloadFileId || '');
    let envelope, file;
    try {
      file = DriveApp.getFileById(fileId);
      envelope = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
    } catch (e) {
      invalid += 1;
      details.push({fileId:fileId,status:'INVALID_ARTIFACT',detail:String(e && e.message || e)});
      return;
    }
    const body = envelope && envelope.stableBody || {};
    const sourceId = String(body.sourceId || '');
    const source = sourceById[sourceId] || null;
    const actualHash = qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(body));
    const hashValid = String(envelope.shardHash || '') === actualHash &&
      String(file.getName() || '') === QBO_CHANGE_PAYLOAD_PERSISTENCE_.FILE_PREFIX + actualHash + '.json' &&
      String(r.PayloadShardHash || '') === actualHash;
    const historicalRun = String(body.ingestionRunId || '').indexOf('HIST_PAYLOAD|') === 0;
    const historicalWorkUnit = String(body.workUnitId || '').indexOf('HISTWU|') === 0;
    const sourceTypeMatches = source && String(source.sourceAcquisitionType || '') === String(body.sourceType || '');
    const sourceRunId = qboPayloadArtifactSourceRunIdFromSourceId_(sourceId);
    const sourceRunMatches = source && String(source.sourceRunId || '') === sourceRunId;
    const ledgerIdentityMatches = String(r.IngestionSourceId || '') === sourceId &&
      String(r.IngestionRunId || '') === String(body.ingestionRunId || '') &&
      String(r.WorkUnitId || '') === String(body.workUnitId || '');

    if (!(source && hashValid && historicalRun && historicalWorkUnit && sourceTypeMatches && sourceRunMatches && ledgerIdentityMatches)) {
      retainedOrphan += 1;
      details.push({fileId:fileId,sourceId:sourceId,status:'RETAINED_ORPHAN',detail:[
        !source?'NO_01_SOURCE':'',!hashValid?'HASH':'',!historicalRun?'NOT_HIST_PAYLOAD':'',
        !historicalWorkUnit?'NOT_HISTWU':'',!sourceTypeMatches?'SOURCE_TYPE':'',
        !sourceRunMatches?'SOURCE_RUN':'',!ledgerIdentityMatches?'LEDGER_IDENTITY':''
      ].filter(Boolean).join(',')});
      return;
    }

    ledgerSheet.getRange(r.rowNumber, idx.SourceRunId + 1).setValue(sourceRunId);
    ledgerSheet.getRange(r.rowNumber, idx.LineageStatus + 1).setValue(QBO_PAYLOAD_ARTIFACT_LEDGER_.LINEAGE_HISTORICAL_SOURCE_EXACT);
    ledgerSheet.getRange(r.rowNumber, idx.ContentVerifiedAt + 1).setValue(new Date());
    upgraded += 1;
    details.push({fileId:fileId,sourceId:sourceId,status:'UPGRADED_HISTORICAL_SOURCE_EXACT',sourceRunId:sourceRunId});
  });
  SpreadsheetApp.flush();
  applyQboStateCaptureSheetLayout_(ledgerSheet);
  const result = {
    version:'QBO_PAYLOAD_ARTIFACT_HISTORICAL_SOURCE_LINEAGE_RECONCILIATION_V1_5_98',
    status:(retainedOrphan===0 && invalid===0)?'VALID':'REVIEW_REQUIRED',
    assessedOrphanRows:assessed,
    upgradedHistoricalSourceExact:upgraded,
    retainedOrphanRows:retainedOrphan,
    invalidArtifactRows:invalid,
    payloadMutationApplied:false,
    source01MutationApplied:false,
    forward05MutationApplied:false,
    ledger06LineageMetadataUpdated:upgraded>0,
    details:details.slice(0,25)
  };
  console.log('[PAYLOAD ARTIFACT HISTORICAL SOURCE LINEAGE] | '+result.status+' | '+JSON.stringify(result,null,2));
  return result;
}
