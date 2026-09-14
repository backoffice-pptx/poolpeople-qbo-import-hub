/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 106_QBO_FullExportForwardIngestion.js
 * Version     : 1.5.68
 * Purpose     : FULL_EXPORT forward-ingestion bridge from authoritative
 *               01_Sources registration into the shared 05 forward-ingestion
 *               control ledger, followed by normalization into immutable
 *               Change Payload shards.
 *
 * Locked ownership boundary:
 *   - 01_Sources remains FULL_EXPORT/FULL_EXPORT_LEGACY source inventory.
 *   - 05_Forward_Ingestion_Control is the cross-source processing/checkpoint
 *     authority for Native CDC, Webhooks, and FULL_EXPORT.
 *   - This module never turns 01_Sources into a cross-source registry.
 *   - Only post-cutover standard FULL_EXPORT sources enter this forward path.
 *   - FULL_EXPORT_LEGACY remains historical-backfill-only.
 *   - PREFERENCES remains outside the canonical entity payload path pending its
 *     separately governed attribute-level history implementation.
 *   - State Application remains disabled; this module writes only 05 control
 *     state plus immutable Change Payload shards.
 * ============================================================================
 */

const QBO_FULL_EXPORT_FORWARD_INGESTION_ = Object.freeze({
  VERSION: 'QBO_FULL_EXPORT_FORWARD_INGESTION_V1',
  SOURCE_TYPE: 'FULL_EXPORT',
  CUTOVER_PROPERTY_KEY: 'QBO_FULL_EXPORT_FORWARD_INGESTION_CUTOVER_V1',
  BATCH_SIZE: 100,
  WORKER_RUNTIME_BUDGET_MS: 210000,
  MIN_SAFE_NEW_WORK_MS: 30000,
  DISPATCH_INTERVAL_MINUTES: 5,
  DISPATCH_HANDLER: 'dispatchQboFullExportIngestion',
  PIPELINE_LEASE_PROPERTY_KEY: 'QBO_FULL_EXPORT_FORWARD_INGESTION_PIPELINE_LEASE_V1',
  PIPELINE_LEASE_MS: 6 * 60 * 1000
});

function testQboFullExportForwardIngestionReadiness() {
  const control = provisionQboForwardIngestionControl();
  const persistence = testQboChangePayloadPersistenceReadiness();
  const adapters = testQboSourceObservationAdapterReadiness();
  const cutover = qboFullExportForwardLoadCutover_();
  const result = {
    ready: !!(control.ready && persistence.ready && adapters.ready),
    version: QBO_FULL_EXPORT_FORWARD_INGESTION_.VERSION,
    controlVersion: QBO_FORWARD_INGESTION_CONTROL_.VERSION,
    payloadVersion: QBO_CHANGE_PAYLOAD_CONTRACT_.VERSION,
    normalizationVersion: QBO_CHANGE_PAYLOAD_CONTRACT_.NORMALIZATION_VERSION,
    adapterVersion: QBO_SOURCE_OBSERVATION_ADAPTERS_.VERSION,
    sourceInventoryAuthority: '01_Sources',
    forwardProcessingAuthority: QBO_FORWARD_INGESTION_CONTROL_.SHEET_NAME,
    sourceType: QBO_FULL_EXPORT_FORWARD_INGESTION_.SOURCE_TYPE,
    standardFullExportOnly: true,
    legacyFullExportForwardIngestionEnabled: false,
    preferencesForwardIngestionEnabled: false,
    batchSize: QBO_FULL_EXPORT_FORWARD_INGESTION_.BATCH_SIZE,
    runtimeBudgetMs: QBO_FULL_EXPORT_FORWARD_INGESTION_.WORKER_RUNTIME_BUDGET_MS,
    minSafeNewWorkMs: QBO_FULL_EXPORT_FORWARD_INGESTION_.MIN_SAFE_NEW_WORK_MS,
    automaticPostExportRegistration: true,
    recoveryRegistrationScanSupported: true,
    dispatcherSupported: true,
    singleActiveWorkerChain: true,
    cutoverInitialized: !!cutover,
    cutoverAt: cutover ? cutover.cutoverAt : '',
    stateApplicationWritesEnabled: false
  };
  if (!result.ready) throw new Error('FULL_EXPORT_FORWARD_INGESTION_NOT_READY ' + JSON.stringify(result));
  console.log('[FULL EXPORT INGESTION] | READY | ' + JSON.stringify(result));
  return result;
}

/**
 * Establishes the durable forward-ingestion cutover boundary.
 *
 * This must be run once before the daily FULL_EXPORT schedule is re-enabled.
 * Existing historical 01_Sources rows are deliberately excluded. Re-running is
 * idempotent and preserves the original cutover timestamp.
 */
function initializeQboFullExportForwardIngestionCutover() {
  return qboForwardIngestionWithLock_(function() {
    const props = PropertiesService.getScriptProperties();
    const key = QBO_FULL_EXPORT_FORWARD_INGESTION_.CUTOVER_PROPERTY_KEY;
    const existing = qboFullExportForwardLoadCutover_();
    if (existing) {
      console.log('[FULL EXPORT INGESTION] | CUTOVER | status=ALREADY_INITIALIZED | ' + JSON.stringify(existing));
      return existing;
    }
    const state = {
      version: QBO_FULL_EXPORT_FORWARD_INGESTION_.VERSION,
      cutoverAt: new Date().toISOString(),
      sourceInventoryAuthority: '01_Sources',
      forwardProcessingAuthority: QBO_FORWARD_INGESTION_CONTROL_.SHEET_NAME
    };
    props.setProperty(key, JSON.stringify(state));
    console.log('[FULL EXPORT INGESTION] | CUTOVER | status=INITIALIZED | ' + JSON.stringify(state));
    return state;
  });
}

function listQboFullExportForwardIngestionStatus() {
  const cutover = qboFullExportForwardLoadCutover_();
  const sheet = qboForwardIngestionEnsureSheet_();
  const rows = qboForwardIngestionReadRows_(sheet).filter(function(row) {
    return String(row.SourceType || '') === QBO_FULL_EXPORT_FORWARD_INGESTION_.SOURCE_TYPE;
  });
  const byStatus = Object.create(null);
  rows.forEach(function(row) {
    const status = String(row.ProcessingStatus || '(blank)');
    byStatus[status] = (byStatus[status] || 0) + 1;
  });
  const result = {
    version: QBO_FULL_EXPORT_FORWARD_INGESTION_.VERSION,
    cutoverInitialized: !!cutover,
    cutoverAt: cutover ? cutover.cutoverAt : '',
    rowCount: rows.length,
    byStatus: byStatus,
    availableCount: Number(byStatus[QBO_FORWARD_INGESTION_CONTROL_.STATUS_AVAILABLE] || 0),
    processingCount: Number(byStatus[QBO_FORWARD_INGESTION_CONTROL_.STATUS_PROCESSING] || 0),
    processedCount: Number(byStatus[QBO_FORWARD_INGESTION_CONTROL_.STATUS_PROCESSED] || 0),
    blockedCount: Number(byStatus[QBO_FORWARD_INGESTION_CONTROL_.STATUS_BLOCKED] || 0)
  };
  console.log('[FULL EXPORT INGESTION] | STATUS | ' + JSON.stringify(result));
  return result;
}

function installQboFullExportIngestionDispatcher() {
  removeQboFullExportIngestionDispatcher();
  ScriptApp.newTrigger(QBO_FULL_EXPORT_FORWARD_INGESTION_.DISPATCH_HANDLER)
    .timeBased()
    .everyMinutes(QBO_FULL_EXPORT_FORWARD_INGESTION_.DISPATCH_INTERVAL_MINUTES)
    .create();
  console.log('[FULL EXPORT INGESTION] | DISPATCHER INSTALLED | handler=' + QBO_FULL_EXPORT_FORWARD_INGESTION_.DISPATCH_HANDLER + ' | everyMinutes=' + QBO_FULL_EXPORT_FORWARD_INGESTION_.DISPATCH_INTERVAL_MINUTES);
  return listQboFullExportIngestionDispatcher();
}

function removeQboFullExportIngestionDispatcher() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === QBO_FULL_EXPORT_FORWARD_INGESTION_.DISPATCH_HANDLER) ScriptApp.deleteTrigger(trigger);
  });
  console.log('[FULL EXPORT INGESTION] | DISPATCHER REMOVED');
  return listQboFullExportIngestionDispatcher();
}

function listQboFullExportIngestionDispatcher() {
  const rows = [];
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() !== QBO_FULL_EXPORT_FORWARD_INGESTION_.DISPATCH_HANDLER) return;
    rows.push({handler:trigger.getHandlerFunction(), source:String(trigger.getTriggerSource()), eventType:String(trigger.getEventType()), triggerId:trigger.getUniqueId()});
    console.log('[FULL EXPORT INGESTION] | DISPATCHER ACTIVE | handler=' + trigger.getHandlerFunction() + ' | triggerId=' + trigger.getUniqueId());
  });
  console.log('[FULL EXPORT INGESTION] | DISPATCHER STATUS | managed=' + rows.length);
  return rows;
}

/**
 * Independent production dispatcher. It first repairs any post-cutover
 * 01_Sources -> 05 handoff missed by the exporter, then drains FULL_EXPORT
 * rows from the shared ledger using bounded batches.
 */
function dispatchQboFullExportIngestion() {
  let registration = null;
  try { registration = registerPendingQboFullExportSourcesForForwardIngestion(); }
  catch (error) {
    console.error('[FULL EXPORT INGESTION] | PENDING REGISTRATION FAILED | ' + (error && error.message ? error.message : error));
  }
  const work = runNextQboFullExportIngestionWork();
  const result = {registration:registration, work:work};
  console.log('[FULL EXPORT INGESTION] | DISPATCH COMPLETE | ' + JSON.stringify(result));
  return result;
}

/** Called by the standard FULL_EXPORT auto-registration wrapper in module 68. */
function safeRegisterQboFullExportSourceForForwardIngestion_(sourceId) {
  try {
    return registerQboFullExportSourceForForwardIngestion_(sourceId);
  } catch (error) {
    console.error('[FULL EXPORT INGESTION] | AUTO REGISTER ERROR | sourceId=' + (sourceId || '') + ' | error=' + (error && error.message ? error.message : String(error)));
    return null;
  }
}

function registerQboFullExportSourceForForwardIngestion_(sourceId) {
  const cutover = qboFullExportForwardRequireCutover_();
  const source = qboFullExportForwardResolveSource_(sourceId);
  const eligibility = qboFullExportForwardAssessSource_(source, cutover);
  if (!eligibility.eligible) {
    const result = {sourceId:source.sourceId, registered:false, alreadyRegistered:false, skipped:true, reason:eligibility.reason};
    console.log('[FULL EXPORT INGESTION] | SOURCE SKIPPED | ' + JSON.stringify(result));
    return result;
  }
  return qboFullExportForwardRegisterResolvedSource_(source);
}

/**
 * Recovery scan only. It never registers historical pre-cutover sources.
 * 01_Sources is authoritative discovery; 05 is authoritative forward resume.
 */
function registerPendingQboFullExportSourcesForForwardIngestion() {
  const cutover = qboFullExportForwardRequireCutover_();
  const sources = qboFullExportForwardLoadSources_();
  let eligible = 0;
  let registered = 0;
  let alreadyRegistered = 0;
  let skipped = 0;
  const skippedByReason = Object.create(null);

  sources.forEach(function(source) {
    const assessment = qboFullExportForwardAssessSource_(source, cutover);
    if (!assessment.eligible) {
      skipped += 1;
      skippedByReason[assessment.reason] = (skippedByReason[assessment.reason] || 0) + 1;
      return;
    }
    eligible += 1;
    const result = qboFullExportForwardRegisterResolvedSource_(source);
    if (result.registered) registered += 1;
    else alreadyRegistered += 1;
  });

  const result = {
    cutoverAt: cutover.cutoverAt,
    sourceRowsScanned: sources.length,
    eligible: eligible,
    registered: registered,
    alreadyRegistered: alreadyRegistered,
    skipped: skipped,
    skippedByReason: skippedByReason
  };
  console.log('[FULL EXPORT INGESTION] | PENDING REGISTRATION | ' + JSON.stringify(result));
  return result;
}

function qboFullExportForwardRegisterResolvedSource_(source) {
  const manifest = getQboExportManifestEntry_(source.exportKey);
  if (!manifest) throw new Error('FULL_EXPORT_FORWARD_UNKNOWN_EXPORT ' + source.exportKey);
  const sourceEvidenceHash = qboStateCaptureAuditSha256_(
    source.sourceId + '|' + source.masterBackupFileId + '|' + source.masterBackupFileName + '|' +
    qboFullExportForwardIso_(source.observationCompletedAt) + '|' + source.exportKey
  );
  const result = qboForwardIngestionRegisterSource_({
    ingestionSourceId: source.sourceId,
    sourceType: QBO_FULL_EXPORT_FORWARD_INGESTION_.SOURCE_TYPE,
    sourceRunId: source.sourceRunId,
    sourceUnitId: source.sourceId,
    entityType: manifest.entityName,
    evidenceFileId: source.masterBackupFileId,
    evidenceFileName: source.masterBackupFileName,
    evidenceHash: sourceEvidenceHash,
    evidenceHashType: 'SOURCE_LINEAGE_SHA256',
    observedAt: qboFullExportForwardIso_(source.observationCompletedAt),
    sourceWindowStart: '',
    sourceWindowEnd: '',
    sourceResponseTime: '',
    requestStartedAt: source.observationStartedAt || '',
    requestCompletedAt: source.observationCompletedAt || '',
    sourceStatus: source.sourceStatus,
    registeredAt: new Date()
  });
  console.log('[FULL EXPORT INGESTION] | SOURCE REGISTERED | sourceId=' + source.sourceId + ' | export=' + source.exportKey + ' | registered=' + result.registered + ' | alreadyRegistered=' + result.alreadyRegistered);
  return result;
}

function runNextQboFullExportIngestionWork() {
  qboFullExportForwardRequireCutover_();
  const workerId = Utilities.getUuid();
  if (!qboFullExportForwardClaimPipeline_(workerId)) {
    const busy = {action:'ALREADY_ACTIVE', workerId:workerId};
    console.log('[FULL EXPORT INGESTION] | WORKER SKIPPED | ' + JSON.stringify(busy));
    return busy;
  }

  const startedMs = Date.now();
  let workUnits = 0;
  let observations = 0;
  let payloads = 0;
  let shards = 0;
  try {
    while (Date.now() - startedMs < QBO_FULL_EXPORT_FORWARD_INGESTION_.WORKER_RUNTIME_BUDGET_MS) {
      const remaining = QBO_FULL_EXPORT_FORWARD_INGESTION_.WORKER_RUNTIME_BUDGET_MS - (Date.now() - startedMs);
      if (workUnits > 0 && remaining < QBO_FULL_EXPORT_FORWARD_INGESTION_.MIN_SAFE_NEW_WORK_MS) break;
      const source = qboForwardIngestionClaimNext_(QBO_FULL_EXPORT_FORWARD_INGESTION_.SOURCE_TYPE, workerId);
      if (!source) break;

      try {
        const result = qboFullExportForwardIngestClaimedSource_(source, workerId);
        workUnits += 1;
        observations += Number(result.observations || 0);
        payloads += Number(result.payloads || 0);
        shards += Number(result.shards || 0);
        qboFullExportForwardHeartbeatPipeline_(workerId);
      } catch (error) {
        qboForwardIngestionBlock_(source.IngestionSourceId, workerId, error);
        console.error('[FULL EXPORT INGESTION] | BLOCKED | sourceId=' + source.IngestionSourceId + ' | ' + (error && error.message ? error.message : error));
        throw error;
      }
    }

    const result = {workerId:workerId, workUnits:workUnits, observations:observations, payloads:payloads, shards:shards};
    console.log('[FULL EXPORT INGESTION] | WORKER COMPLETE | ' + JSON.stringify(result));
    return result;
  } finally {
    qboFullExportForwardReleasePipeline_(workerId);
  }
}

function qboFullExportForwardIngestClaimedSource_(control, workerId) {
  const sourceId = String(control.IngestionSourceId || '').trim();
  if (!sourceId) throw new Error('FULL_EXPORT_FORWARD_CONTROL_MISSING_SOURCE_ID');
  const source = qboFullExportForwardResolveSource_(sourceId);
  const cutover = qboFullExportForwardRequireCutover_();
  const eligibility = qboFullExportForwardAssessSource_(source, cutover);
  if (!eligibility.eligible) throw new Error('FULL_EXPORT_FORWARD_CLAIMED_SOURCE_NOT_ELIGIBLE sourceId=' + sourceId + ' reason=' + eligibility.reason);

  if (String(control.EvidenceFileId || '') !== source.masterBackupFileId) {
    throw new Error('FULL_EXPORT_FORWARD_EVIDENCE_FILE_ID_MISMATCH sourceId=' + sourceId);
  }
  if (control.EvidenceFileName && String(control.EvidenceFileName) !== source.masterBackupFileName) {
    throw new Error('FULL_EXPORT_FORWARD_EVIDENCE_FILE_NAME_MISMATCH sourceId=' + sourceId);
  }

  const manifest = getQboExportManifestEntry_(source.exportKey);
  if (!manifest) throw new Error('FULL_EXPORT_FORWARD_UNKNOWN_EXPORT ' + source.exportKey);
  if (manifest.entityName === 'Preferences') throw new Error('FULL_EXPORT_FORWARD_PREFERENCES_NOT_ENABLED sourceId=' + sourceId);

  const sourceSs = SpreadsheetApp.openById(source.masterBackupFileId);
  const sheetName = manifest.sheetNames[0];
  const sheet = sourceSs.getSheetByName(sheetName);
  if (!sheet) throw new Error('FULL_EXPORT_FORWARD_MISSING_PARENT_SHEET ' + sheetName + ' sourceId=' + sourceId);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) throw new Error('FULL_EXPORT_FORWARD_EMPTY_PARENT_SHEET ' + sheetName + ' sourceId=' + sourceId);

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(v) { return String(v || '').trim(); });
  const idx = qboObservationHeaderIndex_(headers);
  const entityIdHeader = QBO_STATE_CAPTURE_ENTITY_ID_HEADERS_[source.exportKey] || manifest.entityIdHeader || 'Id';
  if (idx.RawJSON === undefined || idx[entityIdHeader] === undefined) {
    throw new Error('FULL_EXPORT_FORWARD_REQUIRED_COLUMNS_MISSING sourceId=' + sourceId + ' sheet=' + sheetName);
  }

  const dataRows = Math.max(0, lastRow - 1);
  const cursor = Number(control.RecordCursor || 0);
  const ledgerObservationCount = control.ObservationCount === '' ? null : Number(control.ObservationCount || 0);
  if (ledgerObservationCount !== null && ledgerObservationCount !== dataRows) {
    throw new Error('FULL_EXPORT_FORWARD_OBSERVATION_COUNT_MISMATCH sourceId=' + sourceId + ' expected=' + ledgerObservationCount + ' actual=' + dataRows);
  }

  if (dataRows === 0 || cursor >= dataRows) {
    qboForwardIngestionCheckpoint_(sourceId, workerId, {
      recordCursor: dataRows,
      observationCount: dataRows,
      processed: true,
      progress: true
    });
    console.log('[FULL EXPORT INGESTION] | SOURCE COMPLETE | sourceId=' + sourceId + ' | observations=' + dataRows + ' | payloads=0');
    return {observations:0, payloads:0, shards:0, finished:true};
  }

  const end = Math.min(cursor + QBO_FULL_EXPORT_FORWARD_INGESTION_.BATCH_SIZE, dataRows);
  const rowStart = cursor + 2;
  const values = sheet.getRange(rowStart, 1, end - cursor, lastCol).getValues();
  const workUnitId = 'FULL_EXPORT_INGEST|' + qboStateCaptureAuditSha256_(sourceId + '|' + cursor + '|' + end);
  const observedAt = qboFullExportForwardIso_(source.observationCompletedAt);
  const sourceEvidenceHash = String(control.EvidenceHash || qboStateCaptureAuditSha256_(source.sourceId + '|' + source.masterBackupFileId + '|' + source.masterBackupFileName + '|' + observedAt + '|' + source.exportKey));
  const payloadBatch = [];

  values.forEach(function(row, offset) {
    const sourceRowNumber = rowStart + offset;
    const entityId = String(row[idx[entityIdHeader]] || '').trim();
    const raw = String(row[idx.RawJSON] || '');
    if (!entityId) throw new Error('FULL_EXPORT_FORWARD_MISSING_ENTITY_ID sourceId=' + sourceId + ' row=' + sourceRowNumber);
    if (!raw) throw new Error('FULL_EXPORT_FORWARD_RAWJSON_MISSING sourceId=' + sourceId + ' row=' + sourceRowNumber + ' entityId=' + entityId);
    if (raw.indexOf(QBO_STATE_CAPTURE_RAW_TRUNCATION_MARKER_) >= 0) {
      throw new Error('FULL_EXPORT_FORWARD_RAWJSON_TRUNCATED sourceId=' + sourceId + ' row=' + sourceRowNumber + ' entityId=' + entityId);
    }
    let entity;
    try { entity = JSON.parse(raw); }
    catch (error) { throw new Error('FULL_EXPORT_FORWARD_RAWJSON_INVALID sourceId=' + sourceId + ' row=' + sourceRowNumber + ' entityId=' + entityId); }
    const rawEntityId = qboObservationResolveEntityId_(source.exportKey, entity);
    if (rawEntityId !== entityId) {
      throw new Error('FULL_EXPORT_FORWARD_ENTITY_ID_MISMATCH sourceId=' + sourceId + ' row=' + sourceRowNumber + ' sheetId=' + entityId + ' rawId=' + rawEntityId);
    }

    try {
      qboNormalizeRawEntityObservation_(source.exportKey, manifest.entityName, entity);
    } catch (error) {
      throw new Error('FULL_EXPORT_FORWARD_RAW_ENTITY_INCOMPLETE sourceId=' + sourceId + ' row=' + sourceRowNumber + ' entityId=' + entityId + ' detail=' + (error && error.message ? error.message : error));
    }
    const sourceChangeTime = String(entity.MetaData && entity.MetaData.LastUpdatedTime || '');
    payloadBatch.push(qboNormalizeAndBuildChangePayload_({
      sourceType: QBO_FULL_EXPORT_FORWARD_INGESTION_.SOURCE_TYPE,
      sourceObservationId: sourceId + '|ROW|' + sourceRowNumber,
      exportKey: source.exportKey,
      entityType: manifest.entityName,
      rawEntity: entity,
      observedAt: observedAt,
      sourceChangeTime: sourceChangeTime,
      operation: 'UPSERT',
      exportRunId: source.sourceRunId,
      sourceId: sourceId,
      sourceRowNumber: sourceRowNumber,
      workUnitId: workUnitId,
      continuationId: workerId,
      sourceEvidence: {
        sourceType: QBO_FULL_EXPORT_FORWARD_INGESTION_.SOURCE_TYPE,
        evidenceFileId: source.masterBackupFileId,
        evidenceFileName: source.masterBackupFileName,
        evidenceHash: sourceEvidenceHash,
        evidenceHashType: 'SOURCE_LINEAGE_SHA256',
        evidenceReference: 'GOOGLE_SHEETS_FILE_ID:' + source.masterBackupFileId,
        exportRunId: source.sourceRunId,
        workUnitId: workUnitId,
        sourceOperation: 'OBSERVE',
        sourceChangeTime: sourceChangeTime,
        sourceReceivedAt: observedAt
      },
      rawEntityEvidence: {
        acquisitionType: 'FULL_EXPORT_RAWJSON',
        acquiredAt: observedAt,
        rawJson: raw,
        rawEntityHash: qboCanonicalRawPayloadHash_(raw),
        complete: true,
        completenessReason: 'SOURCE_RAWJSON_PARSE_AND_GOVERNED_NORMALIZATION_SUCCEEDED',
        fetchedFromQbo: false
      },
      sourceReportedChange: false,
      historicalReconstruction: false,
      reconstructionStatus: 'COMPLETE'
    }));
  });

  const persisted = qboPersistChangePayloadShard_(payloadBatch, {
    ingestionRunId: 'FORWARD_FULL_EXPORT|' + source.sourceRunId,
    workUnitId: workUnitId,
    sourceId: sourceId,
    sourceType: QBO_FULL_EXPORT_FORWARD_INGESTION_.SOURCE_TYPE,
    sourceIndex: '',
    recordCursorStart: cursor,
    recordCursorEndExclusive: end
  });
  const finished = end >= dataRows;
  qboForwardIngestionCheckpoint_(sourceId, workerId, {
    recordCursor: end,
    observationCount: dataRows,
    payloadCountDelta: payloadBatch.length,
    shardCountDelta: 1,
    processed: finished,
    progress: true
  });
  console.log('[FULL EXPORT INGESTION] | BATCH COMPLETE | sourceId=' + sourceId + ' | cursor=' + cursor + '..' + end + '/' + dataRows + ' | payloads=' + payloadBatch.length + ' | shardCreated=' + persisted.created + ' | reconciled=' + persisted.reconciled);
  if (finished) console.log('[FULL EXPORT INGESTION] | SOURCE COMPLETE | sourceId=' + sourceId + ' | observations=' + dataRows);
  return {observations:end-cursor, payloads:payloadBatch.length, shards:1, finished:finished};
}

function qboFullExportForwardLoadCutover_() {
  const raw = PropertiesService.getScriptProperties().getProperty(QBO_FULL_EXPORT_FORWARD_INGESTION_.CUTOVER_PROPERTY_KEY);
  if (!raw) return null;
  let state;
  try { state = JSON.parse(raw); }
  catch (error) { throw new Error('FULL_EXPORT_FORWARD_CUTOVER_INVALID_JSON'); }
  if (!state || !state.cutoverAt || isNaN(new Date(state.cutoverAt).getTime())) {
    throw new Error('FULL_EXPORT_FORWARD_CUTOVER_INVALID');
  }
  return state;
}

function qboFullExportForwardRequireCutover_() {
  const state = qboFullExportForwardLoadCutover_();
  if (!state) throw new Error('FULL_EXPORT_FORWARD_CUTOVER_NOT_INITIALIZED');
  return state;
}

function qboFullExportForwardLoadSources_() {
  const spreadsheet = getQboStateCaptureSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
  if (!sheet) throw new Error('FULL_EXPORT_FORWARD_01_SOURCES_NOT_FOUND');
  return loadQboStateCaptureWriteSources_(sheet, '');
}

function qboFullExportForwardResolveSource_(sourceId) {
  sourceId = String(sourceId || '').trim();
  if (!sourceId) throw new Error('FULL_EXPORT_FORWARD_MISSING_SOURCE_ID');
  const sources = qboFullExportForwardLoadSources_();
  for (let i = 0; i < sources.length; i++) {
    if (sources[i].sourceId === sourceId) return sources[i];
  }
  throw new Error('FULL_EXPORT_FORWARD_SOURCE_NOT_FOUND ' + sourceId);
}

function qboFullExportForwardAssessSource_(source, cutover) {
  if (!source) return {eligible:false, reason:'SOURCE_NOT_FOUND'};
  if (source.sourceAcquisitionType !== QBO_STATE_CAPTURE.SOURCE_ACQUISITION_TYPE) return {eligible:false, reason:'NOT_STANDARD_FULL_EXPORT'};
  if (source.sourceStatus !== QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE) return {eligible:false, reason:'SOURCE_NOT_AVAILABLE'};
  if (!source.masterBackupFileId || !source.masterBackupFileName) return {eligible:false, reason:'MISSING_MASTER_BACKUP_LINEAGE'};
  if (QBO_STATE_CAPTURE.CANONICAL_MIGRATION_SCOPE.indexOf(String(source.exportKey || '').trim()) < 0) {
    return {eligible:false, reason:source.exportKey === 'PREFERENCES' ? 'PREFERENCES_DEFERRED' : 'OUTSIDE_CANONICAL_ENTITY_SCOPE'};
  }
  const registeredMs = qboFullExportForwardTimeMs_(source.registeredAt);
  const cutoverMs = qboFullExportForwardTimeMs_(cutover && cutover.cutoverAt);
  if (!registeredMs) return {eligible:false, reason:'SOURCE_REGISTERED_AT_MISSING'};
  if (registeredMs < cutoverMs) return {eligible:false, reason:'PRE_CUTOVER_SOURCE'};
  return {eligible:true, reason:'ELIGIBLE'};
}

function qboFullExportForwardClaimPipeline_(workerId) {
  return qboForwardIngestionWithLock_(function() {
    const props = PropertiesService.getScriptProperties();
    const key = QBO_FULL_EXPORT_FORWARD_INGESTION_.PIPELINE_LEASE_PROPERTY_KEY;
    const now = Date.now();
    let lease = null;
    try { lease = JSON.parse(props.getProperty(key) || 'null'); } catch (ignore) {}
    if (lease && Number(lease.expiresAtMs || 0) > now && lease.workerId !== workerId) return false;
    props.setProperty(key, JSON.stringify({workerId:workerId, acquiredAt:new Date(now).toISOString(), expiresAtMs:now + QBO_FULL_EXPORT_FORWARD_INGESTION_.PIPELINE_LEASE_MS}));
    return true;
  });
}

function qboFullExportForwardHeartbeatPipeline_(workerId) {
  qboForwardIngestionWithLock_(function() {
    const props = PropertiesService.getScriptProperties();
    const key = QBO_FULL_EXPORT_FORWARD_INGESTION_.PIPELINE_LEASE_PROPERTY_KEY;
    let lease = null;
    try { lease = JSON.parse(props.getProperty(key) || 'null'); } catch (ignore) {}
    if (!lease || lease.workerId !== workerId) throw new Error('FULL_EXPORT_FORWARD_PIPELINE_LEASE_MISMATCH');
    const now = Date.now();
    lease.expiresAtMs = now + QBO_FULL_EXPORT_FORWARD_INGESTION_.PIPELINE_LEASE_MS;
    lease.lastHeartbeatAt = new Date(now).toISOString();
    props.setProperty(key, JSON.stringify(lease));
  });
}

function qboFullExportForwardReleasePipeline_(workerId) {
  qboForwardIngestionWithLock_(function() {
    const props = PropertiesService.getScriptProperties();
    const key = QBO_FULL_EXPORT_FORWARD_INGESTION_.PIPELINE_LEASE_PROPERTY_KEY;
    let lease = null;
    try { lease = JSON.parse(props.getProperty(key) || 'null'); } catch (ignore) {}
    if (lease && lease.workerId === workerId) props.deleteProperty(key);
  });
}

function qboFullExportForwardTimeMs_(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const ms = new Date(value).getTime();
  return isNaN(ms) ? 0 : ms;
}

function qboFullExportForwardIso_(value) {
  const ms = qboFullExportForwardTimeMs_(value);
  if (!ms) throw new Error('FULL_EXPORT_FORWARD_INVALID_OBSERVED_AT ' + value);
  return new Date(ms).toISOString();
}
