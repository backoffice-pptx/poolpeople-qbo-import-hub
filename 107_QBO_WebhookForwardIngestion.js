/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 107_QBO_WebhookForwardIngestion.js
 * Version     : 1.5.97
 * Purpose     : Production Webhook forward ingestion from immutable receipt
 *               evidence into shared normalized Change Payloads.
 *
 * Locked ownership boundary:
 *   Webhook receipt evidence -> 05_Forward_Ingestion_Control -> shared
 *   normalization -> immutable Change Payloads.
 *
 *   01_Sources is FULL_EXPORT-specific and is not written by this module.
 *   Drive enumeration is discovery-only; 05 remains the authoritative forward
 *   processing/checkpoint ledger.
 *
 * Idempotency rule:
 *   Non-delete webhook events require a targeted QBO fetch. The fetched entity
 *   is frozen first into the governed Captured States folder using a
 *   deterministic observation identity. A retry reuses that exact captured
 *   state before rebuilding/persisting the Change Payload, preventing a later
 *   QBO state from replacing the already-observed fetch after a partial failure.
 * ============================================================================
 */

const QBO_WEBHOOK_FORWARD_INGESTION_ = Object.freeze({
  VERSION: 'QBO_WEBHOOK_FORWARD_INGESTION_V3_MAINTENANCE_PAUSE',
  SOURCE_TYPE: 'WEBHOOK',
  SOURCE_EXPECTED_VALUE: 'QBO_WEBHOOK',
  CUTOVER_PROPERTY_KEY: 'QBO_WEBHOOK_FORWARD_INGESTION_CUTOVER_V1',
  PIPELINE_LEASE_PROPERTY_KEY: 'QBO_WEBHOOK_FORWARD_INGESTION_PIPELINE_LEASE_V1',
  PIPELINE_LEASE_MS: 6 * 60 * 1000,
  DISPATCH_HANDLER: 'dispatchQboWebhookIngestion',
  DISPATCH_INTERVAL_MINUTES: 5,
  BATCH_SIZE: 25,
  WORKER_RUNTIME_BUDGET_MS: 210000,
  MIN_SAFE_NEW_WORK_MS: 30000,
  EVIDENCE_FOLDER_ASSET_KEY: 'QBO_WEBHOOK_EVIDENCE_FOLDER',
  EVIDENCE_FOLDER_EXPECTED_TYPE: 'Folder',
  CAPTURED_STATES_FOLDER_ASSET_KEY: 'QBO_CAPTURED_STATES_FOLDER',
  CAPTURED_STATES_FOLDER_EXPECTED_TYPE: 'Folder',
  ENVIRONMENT: 'PROD',
  CAPTURE_SCHEMA_VERSION: 'QBO_WEBHOOK_CAPTURED_ENTITY_V1',
  CAPTURE_FILE_PREFIX: 'qbo_webhook_entity_capture_'
});

function testQboWebhookForwardIngestionReadiness() {
  const control = provisionQboForwardIngestionControl();
  const persistence = testQboChangePayloadPersistenceReadiness();
  const adapters = testQboSourceObservationAdapterReadiness();
  const evidenceFolder = qboResolveGovernedFolderAsset_(
    QBO_WEBHOOK_FORWARD_INGESTION_.EVIDENCE_FOLDER_ASSET_KEY,
    QBO_WEBHOOK_FORWARD_INGESTION_.EVIDENCE_FOLDER_EXPECTED_TYPE,
    QBO_WEBHOOK_FORWARD_INGESTION_.ENVIRONMENT
  );
  const capturedStatesFolder = qboResolveGovernedFolderAsset_(
    QBO_WEBHOOK_FORWARD_INGESTION_.CAPTURED_STATES_FOLDER_ASSET_KEY,
    QBO_WEBHOOK_FORWARD_INGESTION_.CAPTURED_STATES_FOLDER_EXPECTED_TYPE,
    QBO_WEBHOOK_FORWARD_INGESTION_.ENVIRONMENT
  );
  const cutover = qboWebhookForwardReadCutover_();
  const result = {
    ready: !!(control.ready && persistence.ready && adapters.ready && evidenceFolder && capturedStatesFolder),
    version: QBO_WEBHOOK_FORWARD_INGESTION_.VERSION,
    controlVersion: QBO_FORWARD_INGESTION_CONTROL_.VERSION,
    payloadVersion: QBO_CHANGE_PAYLOAD_CONTRACT_.VERSION,
    normalizationVersion: QBO_CHANGE_PAYLOAD_CONTRACT_.NORMALIZATION_VERSION,
    adapterVersion: QBO_SOURCE_OBSERVATION_ADAPTERS_.VERSION,
    sourceInventoryAuthority: 'Webhook receipt evidence',
    forwardProcessingAuthority: QBO_FORWARD_INGESTION_CONTROL_.SHEET_NAME,
    sourceType: QBO_WEBHOOK_FORWARD_INGESTION_.SOURCE_TYPE,
    evidenceFolderId: evidenceFolder.getId(),
    evidenceFolderName: evidenceFolder.getName(),
    capturedStatesFolderId: capturedStatesFolder.getId(),
    capturedStatesFolderName: capturedStatesFolder.getName(),
    batchSize: QBO_WEBHOOK_FORWARD_INGESTION_.BATCH_SIZE,
    runtimeBudgetMs: QBO_WEBHOOK_FORWARD_INGESTION_.WORKER_RUNTIME_BUDGET_MS,
    minSafeNewWorkMs: QBO_WEBHOOK_FORWARD_INGESTION_.MIN_SAFE_NEW_WORK_MS,
    webhookRequiresTargetedFetch: true,
    targetedFetchFrozenBeforePayloadPersistence: true,
    recoveryRegistrationScanSupported: true,
    dispatcherSupported: true,
    singleActiveWorkerChain: true,
    historicalClaimIsolation: true,
    cutoverInitialized: !!cutover,
    cutoverAt: cutover ? cutover.cutoverAt : '',
    historicalReceiptForwardSweepEnabled: false,
    historicalReconstructionMode: false,
    stateApplicationWritesEnabled: false,
    webhookEventsSheetWritesEnabled: false
  };
  if (!result.ready) throw new Error('WEBHOOK_FORWARD_INGESTION_NOT_READY ' + JSON.stringify(result));
  console.log('[WEBHOOK INGESTION] | READY | ' + JSON.stringify(result));
  return result;
}

function initializeQboWebhookForwardIngestionCutover() {
  return qboForwardIngestionWithLock_(function() {
    const props = PropertiesService.getScriptProperties();
    const existing = qboWebhookForwardReadCutover_();
    if (existing) {
      const result = {
        status: 'ALREADY_INITIALIZED',
        version: QBO_WEBHOOK_FORWARD_INGESTION_.VERSION,
        cutoverAt: existing.cutoverAt,
        forwardProcessingAuthority: QBO_FORWARD_INGESTION_CONTROL_.SHEET_NAME
      };
      console.log('[WEBHOOK INGESTION] | CUTOVER | status=ALREADY_INITIALIZED | ' + JSON.stringify(result));
      return result;
    }
    const state = {
      version: QBO_WEBHOOK_FORWARD_INGESTION_.VERSION,
      cutoverAt: new Date().toISOString()
    };
    props.setProperty(QBO_WEBHOOK_FORWARD_INGESTION_.CUTOVER_PROPERTY_KEY, JSON.stringify(state));
    console.log('[WEBHOOK INGESTION] | CUTOVER | status=INITIALIZED | ' + JSON.stringify(state));
    return Object.assign({status:'INITIALIZED'}, state);
  });
}

function listQboWebhookForwardIngestionStatus() {
  const cutover = qboWebhookForwardReadCutover_();
  const sheet = qboForwardIngestionEnsureSheet_();
  const rows = qboForwardIngestionReadRows_(sheet).filter(function(row) {
    return String(row.SourceType || '') === QBO_WEBHOOK_FORWARD_INGESTION_.SOURCE_TYPE;
  });
  const byStatus = Object.create(null);
  rows.forEach(function(row) {
    const status = String(row.ProcessingStatus || '(blank)');
    byStatus[status] = (byStatus[status] || 0) + 1;
  });
  const result = {
    version: QBO_WEBHOOK_FORWARD_INGESTION_.VERSION,
    cutoverInitialized: !!cutover,
    cutoverAt: cutover ? cutover.cutoverAt : '',
    rowCount: rows.length,
    byStatus: byStatus,
    availableCount: Number(byStatus[QBO_FORWARD_INGESTION_CONTROL_.STATUS_AVAILABLE] || 0),
    processingCount: Number(byStatus[QBO_FORWARD_INGESTION_CONTROL_.STATUS_PROCESSING] || 0),
    processedCount: Number(byStatus[QBO_FORWARD_INGESTION_CONTROL_.STATUS_PROCESSED] || 0),
    blockedCount: Number(byStatus[QBO_FORWARD_INGESTION_CONTROL_.STATUS_BLOCKED] || 0)
  };
  console.log('[WEBHOOK INGESTION] | STATUS | ' + JSON.stringify(result));
  return result;
}

function pauseQboWebhookIngestion() {
  const before = listQboWebhookIngestionDispatcher();
  removeQboWebhookIngestionDispatcher();
  const after = listQboWebhookIngestionDispatcher();
  const result = {pipeline:'WEBHOOK', paused:true, removedTriggerCount:before.length, activeTriggerCount:after.length};
  console.log('[WEBHOOK INGESTION] | PAUSED | ' + JSON.stringify(result));
  return result;
}

function resumeQboWebhookIngestion() {
  installQboWebhookIngestionDispatcher();
  const after = listQboWebhookIngestionDispatcher();
  const result = {pipeline:'WEBHOOK', paused:false, activeTriggerCount:after.length};
  console.log('[WEBHOOK INGESTION] | RESUMED | ' + JSON.stringify(result));
  return result;
}

function installQboWebhookIngestionDispatcher() {
  removeQboWebhookIngestionDispatcher();
  ScriptApp.newTrigger(QBO_WEBHOOK_FORWARD_INGESTION_.DISPATCH_HANDLER)
    .timeBased()
    .everyMinutes(QBO_WEBHOOK_FORWARD_INGESTION_.DISPATCH_INTERVAL_MINUTES)
    .create();
  console.log('[WEBHOOK INGESTION] | DISPATCHER INSTALLED | handler=' + QBO_WEBHOOK_FORWARD_INGESTION_.DISPATCH_HANDLER + ' | everyMinutes=' + QBO_WEBHOOK_FORWARD_INGESTION_.DISPATCH_INTERVAL_MINUTES);
  return listQboWebhookIngestionDispatcher();
}

function removeQboWebhookIngestionDispatcher() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === QBO_WEBHOOK_FORWARD_INGESTION_.DISPATCH_HANDLER) ScriptApp.deleteTrigger(trigger);
  });
  console.log('[WEBHOOK INGESTION] | DISPATCHER REMOVED');
  return listQboWebhookIngestionDispatcher();
}

function listQboWebhookIngestionDispatcher() {
  const rows = [];
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() !== QBO_WEBHOOK_FORWARD_INGESTION_.DISPATCH_HANDLER) return;
    rows.push({handler:trigger.getHandlerFunction(), source:String(trigger.getTriggerSource()), eventType:String(trigger.getEventType()), triggerId:trigger.getUniqueId()});
    console.log('[WEBHOOK INGESTION] | DISPATCHER ACTIVE | handler=' + trigger.getHandlerFunction() + ' | triggerId=' + trigger.getUniqueId());
  });
  console.log('[WEBHOOK INGESTION] | DISPATCHER STATUS | managed=' + rows.length);
  return rows;
}

function dispatchQboWebhookIngestion() {
  let registration = null;
  try { registration = registerPendingQboWebhookReceiptsForForwardIngestion(); }
  catch (error) {
    console.error('[WEBHOOK INGESTION] | PENDING REGISTRATION FAILED | ' + (error && error.message ? error.message : error));
  }
  const work = runNextQboWebhookIngestionWork();
  const result = {registration:registration, work:work};
  console.log('[WEBHOOK INGESTION] | DISPATCH COMPLETE | ' + JSON.stringify(result));
  return result;
}

/**
 * Recovery/discovery scan only. Webhook Drive evidence is discovery authority;
 * 05 remains resume/checkpoint authority. Only post-cutover receipts are
 * eligible. Historical receipts are intentionally deferred to the separate
 * controlled historical webhook registration/reconstruction backfill.
 */
function registerPendingQboWebhookReceiptsForForwardIngestion() {
  const cutover = qboWebhookForwardRequireCutover_();
  const folder = qboResolveGovernedFolderAsset_(
    QBO_WEBHOOK_FORWARD_INGESTION_.EVIDENCE_FOLDER_ASSET_KEY,
    QBO_WEBHOOK_FORWARD_INGESTION_.EVIDENCE_FOLDER_EXPECTED_TYPE,
    QBO_WEBHOOK_FORWARD_INGESTION_.ENVIRONMENT
  );
  const files = folder.getFiles();
  let filesScanned = 0;
  let eligible = 0;
  let registered = 0;
  let alreadyRegistered = 0;
  let blockedRegistered = 0;
  let skipped = 0;
  const skippedByReason = Object.create(null);

  while (files.hasNext()) {
    const file = files.next();
    filesScanned += 1;
    const candidate = qboWebhookForwardInspectReceiptFile_(file, cutover);
    if (!candidate.eligible) {
      skipped += 1;
      skippedByReason[candidate.reason] = (skippedByReason[candidate.reason] || 0) + 1;
      continue;
    }
    eligible += 1;
    const result = qboForwardIngestionRegisterSource_(candidate.registration);
    if (result.registered) {
      registered += 1;
      if (candidate.registration.processingStatus === QBO_FORWARD_INGESTION_CONTROL_.STATUS_BLOCKED) blockedRegistered += 1;
    } else {
      alreadyRegistered += 1;
    }
    console.log('[WEBHOOK INGESTION] | RECEIPT REGISTERED | sourceId=' + candidate.registration.ingestionSourceId + ' | registered=' + result.registered + ' | alreadyRegistered=' + result.alreadyRegistered + ' | initialStatus=' + candidate.registration.processingStatus);
  }

  const result = {
    cutoverAt: cutover.cutoverAt,
    filesScanned: filesScanned,
    eligible: eligible,
    registered: registered,
    alreadyRegistered: alreadyRegistered,
    blockedRegistered: blockedRegistered,
    skipped: skipped,
    skippedByReason: skippedByReason
  };
  console.log('[WEBHOOK INGESTION] | PENDING REGISTRATION | ' + JSON.stringify(result));
  return result;
}

function runNextQboWebhookIngestionWork() {
  qboWebhookForwardRequireCutover_();
  const workerId = Utilities.getUuid();
  if (!qboWebhookForwardClaimPipeline_(workerId)) {
    const busy = {action:'ALREADY_ACTIVE', workerId:workerId};
    console.log('[WEBHOOK INGESTION] | WORKER SKIPPED | ' + JSON.stringify(busy));
    return busy;
  }

  const startedMs = Date.now();
  let workUnits = 0;
  let observations = 0;
  let payloads = 0;
  let shards = 0;
  try {
    while (Date.now() - startedMs < QBO_WEBHOOK_FORWARD_INGESTION_.WORKER_RUNTIME_BUDGET_MS) {
      const remaining = QBO_WEBHOOK_FORWARD_INGESTION_.WORKER_RUNTIME_BUDGET_MS - (Date.now() - startedMs);
      if (workUnits > 0 && remaining < QBO_WEBHOOK_FORWARD_INGESTION_.MIN_SAFE_NEW_WORK_MS) break;
      const source = qboForwardIngestionClaimNextMatching_(
        QBO_WEBHOOK_FORWARD_INGESTION_.SOURCE_TYPE,
        workerId,
        function(row) { return String(row.SourceStatus || '') !== 'HISTORICAL_RECONSTRUCTION'; }
      );
      if (!source) break;
      try {
        const result = qboWebhookForwardIngestClaimedSource_(source, workerId);
        workUnits += 1;
        observations += Number(result.observations || 0);
        payloads += Number(result.payloads || 0);
        shards += Number(result.shards || 0);
        qboWebhookForwardHeartbeatPipeline_(workerId);
      } catch (error) {
        qboForwardIngestionBlock_(source.IngestionSourceId, workerId, error);
        console.error('[WEBHOOK INGESTION] | BLOCKED | sourceId=' + source.IngestionSourceId + ' | ' + (error && error.message ? error.message : error));
        throw error;
      }
    }
    const result = {workerId:workerId, workUnits:workUnits, observations:observations, payloads:payloads, shards:shards};
    console.log('[WEBHOOK INGESTION] | WORKER COMPLETE | ' + JSON.stringify(result));
    return result;
  } finally {
    qboWebhookForwardReleasePipeline_(workerId);
  }
}

function qboWebhookForwardIngestClaimedSource_(control, workerId) {
  const sourceId = String(control.IngestionSourceId || '').trim();
  const evidenceFileId = String(control.EvidenceFileId || '').trim();
  if (!sourceId || !evidenceFileId) throw new Error('WEBHOOK_INGESTION_SOURCE_CONTROL_INCOMPLETE sourceId=' + sourceId);

  const file = DriveApp.getFileById(evidenceFileId);
  if (control.EvidenceFileName && file.getName() !== String(control.EvidenceFileName)) {
    throw new Error('WEBHOOK_INGESTION_EVIDENCE_NAME_MISMATCH sourceId=' + sourceId);
  }
  const text = file.getBlob().getDataAsString('UTF-8');
  let receipt;
  try { receipt = JSON.parse(text); }
  catch (error) { throw new Error('WEBHOOK_INGESTION_RECEIPT_INVALID_JSON sourceId=' + sourceId); }

  const validation = qboWebhookForwardValidateReceipt_(receipt);
  if (!validation.valid) throw new Error('WEBHOOK_INGESTION_RECEIPT_INVALID sourceId=' + sourceId + ' reason=' + validation.reason);
  if (String(control.EvidenceHash || '') && String(control.EvidenceHash) !== validation.rawPayloadSha256) {
    throw new Error('WEBHOOK_INGESTION_EVIDENCE_HASH_MISMATCH sourceId=' + sourceId);
  }
  if (sourceId !== 'WEBHOOK|' + validation.receiptId) {
    throw new Error('WEBHOOK_INGESTION_SOURCE_ID_MISMATCH sourceId=' + sourceId + ' receiptId=' + validation.receiptId);
  }

  const events = validation.events;
  const cursor = Number(control.RecordCursor || 0);
  const expectedCount = control.ObservationCount === '' ? events.length : Number(control.ObservationCount || 0);
  if (expectedCount !== events.length) {
    throw new Error('WEBHOOK_INGESTION_OBSERVATION_COUNT_MISMATCH sourceId=' + sourceId + ' expected=' + expectedCount + ' actual=' + events.length);
  }

  if (events.length === 0 || cursor >= events.length) {
    qboForwardIngestionCheckpoint_(sourceId, workerId, {
      recordCursor: events.length,
      observationCount: events.length,
      processed: true,
      progress: true
    });
    console.log('[WEBHOOK INGESTION] | SOURCE COMPLETE | sourceId=' + sourceId + ' | observations=' + events.length + ' | payloads=0');
    return {observations:0, payloads:0, shards:0, finished:true};
  }

  const end = Math.min(cursor + QBO_WEBHOOK_FORWARD_INGESTION_.BATCH_SIZE, events.length);
  const workUnitId = 'WEBHOOK_INGEST|' + qboStateCaptureAuditSha256_(sourceId + '|' + cursor + '|' + end);
  const payloadBatch = [];

  for (let i = cursor; i < end; i++) {
    const event = events[i];
    const entityType = String(event.entityType || '').trim();
    const entityId = String(event.entityId || '').trim();
    const operation = String(event.operation || '').trim().toUpperCase();
    if (!qboSourceAdapterDefinition_(entityType)) throw new Error('WEBHOOK_INGESTION_UNSUPPORTED_ENTITY_TYPE sourceId=' + sourceId + ' entityType=' + entityType);
    if (!entityId) throw new Error('WEBHOOK_INGESTION_MISSING_ENTITY_ID sourceId=' + sourceId + ' index=' + i);
    if (String(event.realmId || '') !== String(getQboRealmId_() || '')) {
      throw new Error('WEBHOOK_INGESTION_REALM_MISMATCH sourceId=' + sourceId + ' index=' + i);
    }

    const normalizedOperation = operation === 'DELETE' ? 'DELETE' : operation;
    const sourceObservationId = sourceId + '|OBS|' + i + '|' + entityType + '|' + entityId + '|' + normalizedOperation;
    let capturedEntity = null;
    let observedAt = new Date().toISOString();
    if (normalizedOperation !== 'DELETE') {
      const capture = qboWebhookForwardGetOrCreateCapturedEntity_(sourceObservationId, validation, event);
      capturedEntity = capture.rawEntity;
      observedAt = capture.capturedAt;
    }

    payloadBatch.push(qboAdaptWebhookEntityObservation_({
      sourceObservationId: sourceObservationId,
      entityType: entityType,
      entityId: entityId,
      operation: normalizedOperation,
      observedAt: observedAt,
      sourceChangeTime: String(event.sourceChangeTime || ''),
      sourceReceivedAt: validation.receivedAt,
      evidenceFileId: evidenceFileId,
      evidenceFileName: String(control.EvidenceFileName || file.getName()),
      evidenceHash: validation.rawPayloadSha256,
      evidenceReference: evidenceFileId,
      receiptId: validation.receiptId,
      signatureVerified: true,
      sourceEventCount: events.length,
      rawEntity: capturedEntity,
      rawEntityAcquisitionType: capturedEntity ? 'TARGETED_QBO_FETCH_AFTER_WEBHOOK_CAPTURED' : '',
      historicalReconstruction: false
    }));
  }

  const persisted = qboPersistChangePayloadShard_(payloadBatch, {
    ingestionRunId: 'FORWARD_WEBHOOK|' + validation.receiptId,
    workUnitId: workUnitId,
    sourceId: sourceId,
    sourceRunId: String(control.SourceRunId || validation.receiptId || ''),
    sourceType: QBO_WEBHOOK_FORWARD_INGESTION_.SOURCE_TYPE,
    sourceIndex: '',
    recordCursorStart: cursor,
    recordCursorEndExclusive: end
  });
  const finished = end >= events.length;
  qboForwardIngestionCheckpoint_(sourceId, workerId, {
    recordCursor: end,
    observationCount: events.length,
    payloadCountDelta: payloadBatch.length,
    shardCountDelta: 1,
    processed: finished,
    progress: true
  });
  console.log('[WEBHOOK INGESTION] | BATCH COMPLETE | sourceId=' + sourceId + ' | cursor=' + cursor + '..' + end + '/' + events.length + ' | payloads=' + payloadBatch.length + ' | shardCreated=' + persisted.created + ' | reconciled=' + persisted.reconciled);
  if (finished) console.log('[WEBHOOK INGESTION] | SOURCE COMPLETE | sourceId=' + sourceId + ' | observations=' + events.length + ' | payloads=' + payloadBatch.length);
  return {observations:end-cursor, payloads:payloadBatch.length, shards:1, finished:finished};
}

function qboWebhookForwardInspectReceiptFile_(file, cutover) {
  const createdAt = file.getDateCreated();
  const cutoverMs = new Date(cutover.cutoverAt).getTime();
  let text = '';
  let receipt = null;
  try {
    text = file.getBlob().getDataAsString('UTF-8');
    receipt = JSON.parse(text);
  } catch (error) {
    if (!createdAt || createdAt.getTime() < cutoverMs) return {eligible:false, reason:'PRE_CUTOVER_UNREADABLE_FILE'};
    const sourceId = 'WEBHOOK|FILE|' + file.getId();
    return {
      eligible:true,
      registration:qboWebhookForwardBlockedRegistration_(sourceId, file, createdAt.toISOString(), 'WEBHOOK_RECEIPT_INVALID_JSON')
    };
  }

  const receivedAt = String(receipt.receivedAt || '');
  const receivedMs = new Date(receivedAt).getTime();
  if (!receivedAt || isNaN(receivedMs)) {
    if (!createdAt || createdAt.getTime() < cutoverMs) return {eligible:false, reason:'PRE_CUTOVER_MISSING_RECEIVED_AT'};
    const sourceId = 'WEBHOOK|' + String(receipt.webhookReceiptId || ('FILE|' + file.getId()));
    return {
      eligible:true,
      registration:qboWebhookForwardBlockedRegistration_(sourceId, file, createdAt.toISOString(), 'WEBHOOK_RECEIPT_MISSING_OR_INVALID_RECEIVED_AT')
    };
  }
  if (receivedMs < cutoverMs) return {eligible:false, reason:'PRE_CUTOVER_RECEIPT'};

  const validation = qboWebhookForwardValidateReceipt_(receipt);
  const receiptId = String(receipt.webhookReceiptId || '').trim();
  const sourceId = 'WEBHOOK|' + (receiptId || ('FILE|' + file.getId()));
  if (!validation.valid) {
    return {
      eligible:true,
      registration:qboWebhookForwardBlockedRegistration_(sourceId, file, receivedAt, validation.reason)
    };
  }

  const entityTypes = Object.create(null);
  validation.events.forEach(function(event) { entityTypes[String(event.entityType || '')] = true; });
  const typeKeys = Object.keys(entityTypes).filter(function(v) { return !!v; });
  const entityType = typeKeys.length === 1 ? typeKeys[0] : (typeKeys.length > 1 ? 'MULTI_ENTITY' : '');
  return {
    eligible:true,
    registration:{
      ingestionSourceId: sourceId,
      sourceType: QBO_WEBHOOK_FORWARD_INGESTION_.SOURCE_TYPE,
      sourceRunId: validation.receiptId,
      sourceUnitId: validation.receiptId,
      entityType: entityType,
      evidenceFileId: file.getId(),
      evidenceFileName: file.getName(),
      evidenceHash: validation.rawPayloadSha256,
      evidenceHashType: 'RAW_PAYLOAD_SHA256',
      observedAt: validation.receivedAt,
      sourceWindowStart: '',
      sourceWindowEnd: '',
      sourceResponseTime: '',
      requestStartedAt: '',
      requestCompletedAt: validation.receivedAt,
      sourceStatus: 'VERIFIED',
      observationCount: validation.events.length,
      processingStatus: QBO_FORWARD_INGESTION_CONTROL_.STATUS_AVAILABLE,
      registeredAt: new Date()
    }
  };
}

function qboWebhookForwardBlockedRegistration_(sourceId, file, observedAt, reason) {
  return {
    ingestionSourceId: sourceId,
    sourceType: QBO_WEBHOOK_FORWARD_INGESTION_.SOURCE_TYPE,
    sourceRunId: sourceId.replace(/^WEBHOOK\|/, ''),
    sourceUnitId: sourceId,
    entityType: '',
    evidenceFileId: file.getId(),
    evidenceFileName: file.getName(),
    evidenceHash: '',
    evidenceHashType: '',
    observedAt: observedAt,
    sourceStatus: 'EVIDENCE_EXCEPTION',
    observationCount: '',
    processingStatus: QBO_FORWARD_INGESTION_CONTROL_.STATUS_BLOCKED,
    processingError: reason,
    registeredAt: new Date()
  };
}

function qboWebhookForwardValidateReceipt_(receipt) {
  if (!receipt || typeof receipt !== 'object') return {valid:false, reason:'WEBHOOK_RECEIPT_NOT_OBJECT'};
  const receiptId = String(receipt.webhookReceiptId || '').trim();
  if (!receiptId) return {valid:false, reason:'WEBHOOK_RECEIPT_MISSING_ID'};
  if (String(receipt.source || '') !== QBO_WEBHOOK_FORWARD_INGESTION_.SOURCE_EXPECTED_VALUE) return {valid:false, reason:'WEBHOOK_RECEIPT_SOURCE_MISMATCH'};
  if (receipt.signatureVerified !== true) return {valid:false, reason:'WEBHOOK_RECEIPT_SIGNATURE_NOT_VERIFIED'};
  const receivedAt = String(receipt.receivedAt || '');
  if (!receivedAt || isNaN(new Date(receivedAt).getTime())) return {valid:false, reason:'WEBHOOK_RECEIPT_INVALID_RECEIVED_AT'};
  const rawPayloadSha256 = String(receipt.rawPayloadSha256 || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(rawPayloadSha256)) return {valid:false, reason:'WEBHOOK_RECEIPT_INVALID_RAW_PAYLOAD_SHA256'};
  const rawPayloadBase64 = String(receipt.rawPayloadBase64 || '');
  if (!rawPayloadBase64) return {valid:false, reason:'WEBHOOK_RECEIPT_MISSING_RAW_PAYLOAD_BASE64'};
  let decoded;
  try { decoded = Utilities.base64Decode(rawPayloadBase64); }
  catch (error) { return {valid:false, reason:'WEBHOOK_RECEIPT_INVALID_RAW_PAYLOAD_BASE64'}; }
  const actualHash = qboWebhookForwardSha256Bytes_(decoded);
  if (actualHash !== rawPayloadSha256) return {valid:false, reason:'WEBHOOK_RECEIPT_RAW_PAYLOAD_HASH_MISMATCH'};
  const events = qboSourceAdapterExtractWebhookEvents_(receipt);
  const declaredCount = Number(receipt.entityEventCount || 0);
  if (declaredCount !== events.length) return {valid:false, reason:'WEBHOOK_RECEIPT_EVENT_COUNT_MISMATCH'};
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!String(event.realmId || '').trim()) return {valid:false, reason:'WEBHOOK_RECEIPT_EVENT_MISSING_REALM'};
    if (!String(event.entityType || '').trim()) return {valid:false, reason:'WEBHOOK_RECEIPT_EVENT_MISSING_ENTITY_TYPE'};
    if (!String(event.entityId || '').trim()) return {valid:false, reason:'WEBHOOK_RECEIPT_EVENT_MISSING_ENTITY_ID'};
    if (!String(event.operation || '').trim()) return {valid:false, reason:'WEBHOOK_RECEIPT_EVENT_MISSING_OPERATION'};
    if (!qboSourceAdapterDefinition_(event.entityType)) return {valid:false, reason:'WEBHOOK_RECEIPT_UNSUPPORTED_ENTITY_TYPE_' + event.entityType};
  }
  return {
    valid:true,
    receiptId:receiptId,
    receivedAt:receivedAt,
    rawPayloadSha256:rawPayloadSha256,
    events:events
  };
}

function qboWebhookForwardGetOrCreateCapturedEntity_(sourceObservationId, validation, event) {
  const folder = qboResolveGovernedFolderAsset_(
    QBO_WEBHOOK_FORWARD_INGESTION_.CAPTURED_STATES_FOLDER_ASSET_KEY,
    QBO_WEBHOOK_FORWARD_INGESTION_.CAPTURED_STATES_FOLDER_EXPECTED_TYPE,
    QBO_WEBHOOK_FORWARD_INGESTION_.ENVIRONMENT
  );
  const observationHash = qboStateCaptureAuditSha256_(sourceObservationId);
  const fileName = QBO_WEBHOOK_FORWARD_INGESTION_.CAPTURE_FILE_PREFIX + observationHash + '.json';
  const existing = folder.getFilesByName(fileName);
  if (existing.hasNext()) {
    const file = existing.next();
    if (existing.hasNext()) throw new Error('WEBHOOK_CAPTURE_DUPLICATE_FILE_NAME ' + fileName);
    let envelope;
    try { envelope = JSON.parse(file.getBlob().getDataAsString('UTF-8')); }
    catch (error) { throw new Error('WEBHOOK_CAPTURE_EXISTING_INVALID_JSON file=' + fileName); }
    qboWebhookForwardValidateCapturedEntity_(envelope, sourceObservationId, event);
    return {rawEntity:envelope.rawEntity, capturedAt:String(envelope.capturedAt || ''), fileId:file.getId(), fileName:fileName, reconciled:true};
  }

  const rawEntity = qboSourceAdapterFetchEntity_(event.entityType, event.entityId);
  const assessment = qboSourceAdapterAssessRawEntityCompleteness_(event.entityType, rawEntity);
  if (!assessment.complete) throw new Error('WEBHOOK_CAPTURE_RAW_ENTITY_INCOMPLETE entity=' + event.entityType + '|' + event.entityId + ' reason=' + assessment.reason);
  const capturedAt = new Date().toISOString();
  const rawJson = jsonStringifySafe_(rawEntity);
  const envelope = {
    schemaVersion: QBO_WEBHOOK_FORWARD_INGESTION_.CAPTURE_SCHEMA_VERSION,
    sourceObservationId: sourceObservationId,
    receiptId: validation.receiptId,
    entityType: String(event.entityType || ''),
    entityId: String(event.entityId || ''),
    operation: String(event.operation || ''),
    sourceChangeTime: String(event.sourceChangeTime || ''),
    receivedAt: validation.receivedAt,
    capturedAt: capturedAt,
    rawEntityHash: qboCanonicalRawPayloadHash_(rawJson),
    rawEntity: rawEntity
  };
  const file = folder.createFile(fileName, JSON.stringify(envelope, null, 2), MimeType.PLAIN_TEXT);
  return {rawEntity:rawEntity, capturedAt:capturedAt, fileId:file.getId(), fileName:fileName, reconciled:false};
}

function qboWebhookForwardValidateCapturedEntity_(envelope, sourceObservationId, event) {
  if (!envelope || envelope.schemaVersion !== QBO_WEBHOOK_FORWARD_INGESTION_.CAPTURE_SCHEMA_VERSION) throw new Error('WEBHOOK_CAPTURE_SCHEMA_MISMATCH');
  if (String(envelope.sourceObservationId || '') !== String(sourceObservationId || '')) throw new Error('WEBHOOK_CAPTURE_OBSERVATION_ID_MISMATCH');
  if (String(envelope.entityType || '') !== String(event.entityType || '')) throw new Error('WEBHOOK_CAPTURE_ENTITY_TYPE_MISMATCH');
  if (String(envelope.entityId || '') !== String(event.entityId || '')) throw new Error('WEBHOOK_CAPTURE_ENTITY_ID_MISMATCH');
  if (!envelope.rawEntity || typeof envelope.rawEntity !== 'object') throw new Error('WEBHOOK_CAPTURE_MISSING_RAW_ENTITY');
  const rawJson = jsonStringifySafe_(envelope.rawEntity);
  const hash = qboCanonicalRawPayloadHash_(rawJson);
  if (String(envelope.rawEntityHash || '') !== hash) throw new Error('WEBHOOK_CAPTURE_RAW_ENTITY_HASH_MISMATCH');
  const assessment = qboSourceAdapterAssessRawEntityCompleteness_(event.entityType, envelope.rawEntity);
  if (!assessment.complete) throw new Error('WEBHOOK_CAPTURE_RAW_ENTITY_INCOMPLETE reason=' + assessment.reason);
  return true;
}

function qboWebhookForwardReadCutover_() {
  const text = PropertiesService.getScriptProperties().getProperty(QBO_WEBHOOK_FORWARD_INGESTION_.CUTOVER_PROPERTY_KEY);
  if (!text) return null;
  let state;
  try { state = JSON.parse(text); }
  catch (error) { throw new Error('WEBHOOK_FORWARD_CUTOVER_INVALID_JSON'); }
  if (!state || !state.cutoverAt || isNaN(new Date(state.cutoverAt).getTime())) throw new Error('WEBHOOK_FORWARD_CUTOVER_INVALID_STATE');
  return state;
}

function qboWebhookForwardRequireCutover_() {
  const cutover = qboWebhookForwardReadCutover_();
  if (!cutover) throw new Error('WEBHOOK_FORWARD_CUTOVER_NOT_INITIALIZED');
  return cutover;
}

function qboWebhookForwardClaimPipeline_(workerId) {
  return qboForwardIngestionWithLock_(function() {
    const props = PropertiesService.getScriptProperties();
    const key = QBO_WEBHOOK_FORWARD_INGESTION_.PIPELINE_LEASE_PROPERTY_KEY;
    let lease = null;
    try { lease = JSON.parse(props.getProperty(key) || 'null'); } catch (ignore) {}
    const now = Date.now();
    if (lease && Number(lease.expiresAtMs || 0) > now && lease.workerId !== workerId) return false;
    props.setProperty(key, JSON.stringify({workerId:workerId, acquiredAt:new Date(now).toISOString(), expiresAtMs:now + QBO_WEBHOOK_FORWARD_INGESTION_.PIPELINE_LEASE_MS}));
    return true;
  });
}

function qboWebhookForwardHeartbeatPipeline_(workerId) {
  qboForwardIngestionWithLock_(function() {
    const props = PropertiesService.getScriptProperties();
    const key = QBO_WEBHOOK_FORWARD_INGESTION_.PIPELINE_LEASE_PROPERTY_KEY;
    let lease = null;
    try { lease = JSON.parse(props.getProperty(key) || 'null'); } catch (ignore) {}
    if (!lease || lease.workerId !== workerId) throw new Error('WEBHOOK_INGESTION_PIPELINE_LEASE_MISMATCH');
    const now = Date.now();
    lease.expiresAtMs = now + QBO_WEBHOOK_FORWARD_INGESTION_.PIPELINE_LEASE_MS;
    lease.lastHeartbeatAt = new Date(now).toISOString();
    props.setProperty(key, JSON.stringify(lease));
  });
}

function qboWebhookForwardReleasePipeline_(workerId) {
  qboForwardIngestionWithLock_(function() {
    const props = PropertiesService.getScriptProperties();
    const key = QBO_WEBHOOK_FORWARD_INGESTION_.PIPELINE_LEASE_PROPERTY_KEY;
    let lease = null;
    try { lease = JSON.parse(props.getProperty(key) || 'null'); } catch (ignore) {}
    if (lease && lease.workerId === workerId) props.deleteProperty(key);
  });
}

function qboWebhookForwardSha256Bytes_(bytes) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  return digest.map(function(b) {
    const v = b < 0 ? b + 256 : b;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}
