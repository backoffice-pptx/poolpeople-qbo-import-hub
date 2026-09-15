/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 104_QBO_NativeCdcForwardIngestion.js
 * Version     : 1.5.97
 * Purpose     : Production Native CDC forward ingestion: committed-cycle
 *               registration, independent dispatch, and normalization into
 *               immutable Change Payload shards using the shared control ledger.
 * ============================================================================
 */

const QBO_NATIVE_CDC_FORWARD_INGESTION_ = Object.freeze({
  VERSION: 'QBO_NATIVE_CDC_FORWARD_INGESTION_V4_MAINTENANCE_PAUSE',
  SOURCE_TYPE: 'NATIVE_CDC',
  BATCH_SIZE: 100,
  WORKER_RUNTIME_BUDGET_MS: 210000,
  MIN_SAFE_NEW_WORK_MS: 30000,
  DISPATCH_INTERVAL_MINUTES: 5,
  DISPATCH_HANDLER: 'dispatchQboNativeCdcIngestion',
  PIPELINE_LEASE_PROPERTY_KEY: 'QBO_NATIVE_CDC_FORWARD_INGESTION_PIPELINE_LEASE_V1',
  PIPELINE_LEASE_MS: 6 * 60 * 1000
});

function testQboNativeCdcForwardIngestionReadiness() {
  const control = provisionQboForwardIngestionControl();
  const persistence = testQboChangePayloadPersistenceReadiness();
  const adapters = testQboSourceObservationAdapterReadiness();
  const result = {
    ready: !!(control.ready && persistence.ready && adapters.ready),
    version: QBO_NATIVE_CDC_FORWARD_INGESTION_.VERSION,
    controlVersion: QBO_FORWARD_INGESTION_CONTROL_.VERSION,
    payloadVersion: QBO_CHANGE_PAYLOAD_CONTRACT_.VERSION,
    normalizationVersion: QBO_CHANGE_PAYLOAD_CONTRACT_.NORMALIZATION_VERSION,
    adapterVersion: QBO_SOURCE_OBSERVATION_ADAPTERS_.VERSION,
    batchSize: QBO_NATIVE_CDC_FORWARD_INGESTION_.BATCH_SIZE,
    runtimeBudgetMs: QBO_NATIVE_CDC_FORWARD_INGESTION_.WORKER_RUNTIME_BUDGET_MS,
    minSafeNewWorkMs: QBO_NATIVE_CDC_FORWARD_INGESTION_.MIN_SAFE_NEW_WORK_MS,
    automaticRegistrationEnabled: true,
    automaticDispatcherEnabled: true,
    stateApplicationWritesEnabled: false,
    datePartitionDiscoverySupported: true,
    singleActiveWorkerChain: true,
    explicitRegistrationTimestamp: true,
    registeredAtRepairSupported: true
  };
  if (!result.ready) throw new Error('NATIVE_CDC_FORWARD_INGESTION_NOT_READY ' + JSON.stringify(result));
  console.log('[NATIVE CDC INGESTION] | READY | ' + JSON.stringify(result));
  return result;
}

function pauseQboNativeCdcIngestion() {
  const before = listQboNativeCdcIngestionDispatcher();
  removeQboNativeCdcIngestionDispatcher();
  const after = listQboNativeCdcIngestionDispatcher();
  const result = {pipeline:'NATIVE_CDC', paused:true, removedTriggerCount:before.length, activeTriggerCount:after.length};
  console.log('[NATIVE CDC INGESTION] | PAUSED | ' + JSON.stringify(result));
  return result;
}

function resumeQboNativeCdcIngestion() {
  installQboNativeCdcIngestionDispatcher();
  const after = listQboNativeCdcIngestionDispatcher();
  const result = {pipeline:'NATIVE_CDC', paused:false, activeTriggerCount:after.length};
  console.log('[NATIVE CDC INGESTION] | RESUMED | ' + JSON.stringify(result));
  return result;
}

function installQboNativeCdcIngestionDispatcher() {
  removeQboNativeCdcIngestionDispatcher();
  ScriptApp.newTrigger(QBO_NATIVE_CDC_FORWARD_INGESTION_.DISPATCH_HANDLER)
    .timeBased()
    .everyMinutes(QBO_NATIVE_CDC_FORWARD_INGESTION_.DISPATCH_INTERVAL_MINUTES)
    .create();
  console.log('[NATIVE CDC INGESTION] | DISPATCHER INSTALLED | handler=' + QBO_NATIVE_CDC_FORWARD_INGESTION_.DISPATCH_HANDLER + ' | everyMinutes=' + QBO_NATIVE_CDC_FORWARD_INGESTION_.DISPATCH_INTERVAL_MINUTES);
  return listQboNativeCdcIngestionDispatcher();
}

function removeQboNativeCdcIngestionDispatcher() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === QBO_NATIVE_CDC_FORWARD_INGESTION_.DISPATCH_HANDLER) ScriptApp.deleteTrigger(trigger);
  });
  console.log('[NATIVE CDC INGESTION] | DISPATCHER REMOVED');
  return listQboNativeCdcIngestionDispatcher();
}

function listQboNativeCdcIngestionDispatcher() {
  const rows = [];
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() !== QBO_NATIVE_CDC_FORWARD_INGESTION_.DISPATCH_HANDLER) return;
    rows.push({handler:trigger.getHandlerFunction(), source:String(trigger.getTriggerSource()), eventType:String(trigger.getEventType()), triggerId:trigger.getUniqueId()});
    console.log('[NATIVE CDC INGESTION] | DISPATCHER ACTIVE | handler=' + trigger.getHandlerFunction() + ' | triggerId=' + trigger.getUniqueId());
  });
  console.log('[NATIVE CDC INGESTION] | DISPATCHER STATUS | managed=' + rows.length);
  return rows;
}

function dispatchQboNativeCdcIngestion() {
  let handoff = null;
  try { handoff = retryPendingQboNativeCdcIngestionRegistration(); }
  catch (error) {
    console.error('[NATIVE CDC INGESTION] | HANDOFF RETRY FAILED | ' + (error && error.message ? error.message : error));
  }
  const work = runNextQboNativeCdcIngestionWork();
  const result = {handoff:handoff, work:work};
  console.log('[NATIVE CDC INGESTION] | DISPATCH COMPLETE | ' + JSON.stringify(result));
  return result;
}

/** Registers all 20 entity evidence units from the latest fully committed
 * Native CDC cycle. Idempotent by NATIVE_CDC|<CycleId>|<EntityType>. */
function registerLatestQboNativeCdcCycleForIngestion() {
  const state = qboNativeCdcReadState_();
  if (!state || state.status !== 'SUCCESS' || state.watermarkCommitted !== true) {
    throw new Error('NATIVE_CDC_INGESTION_LATEST_CYCLE_NOT_COMMITTED');
  }
  if (!state.runFolderId) throw new Error('NATIVE_CDC_INGESTION_LATEST_CYCLE_MISSING_RUN_FOLDER');
  const folder = DriveApp.getFolderById(state.runFolderId);
  const files = folder.getFilesByName(QBO_NATIVE_CDC_PRODUCTION.MANIFEST_FILE_NAME);
  if (!files.hasNext()) throw new Error('NATIVE_CDC_INGESTION_MANIFEST_NOT_FOUND cycle=' + state.cycleId);
  const file = files.next();
  if (files.hasNext()) throw new Error('NATIVE_CDC_INGESTION_DUPLICATE_MANIFEST cycle=' + state.cycleId);
  return registerQboNativeCdcManifestForIngestion_(file.getId());
}

function registerQboNativeCdcManifestForIngestion_(manifestFileId) {
  const file = DriveApp.getFileById(String(manifestFileId || '').trim());
  let manifest;
  try { manifest = JSON.parse(file.getBlob().getDataAsString('UTF-8')); }
  catch (error) { throw new Error('NATIVE_CDC_INGESTION_MANIFEST_INVALID_JSON fileId=' + manifestFileId); }

  const cycleId = String(manifest.cycleId || '').trim();
  if (!cycleId) throw new Error('NATIVE_CDC_INGESTION_MANIFEST_MISSING_CYCLE_ID');
  if (String(manifest.status || '') !== 'SUCCESS' || manifest.watermarkCommitted !== true) {
    throw new Error('NATIVE_CDC_INGESTION_MANIFEST_NOT_COMMITTED cycle=' + cycleId);
  }
  const evidence = Array.isArray(manifest.entityEvidence) ? manifest.entityEvidence : [];
  if (evidence.length !== QBO_NATIVE_CDC_PRODUCTION.ENTITIES.length) {
    throw new Error('NATIVE_CDC_INGESTION_MANIFEST_ENTITY_COUNT_MISMATCH cycle=' + cycleId + ' count=' + evidence.length);
  }

  const registeredAt = new Date();
  let registered = 0;
  let alreadyRegistered = 0;
  evidence.forEach(function(entityEvidence) {
    const entityType = String(entityEvidence.entity || '').trim();
    if (!qboSourceAdapterDefinition_(entityType)) {
      throw new Error('NATIVE_CDC_INGESTION_UNSUPPORTED_ENTITY_TYPE ' + entityType);
    }
    if (String(entityEvidence.status || '') !== 'SUCCESS' || !entityEvidence.evidenceFileId) {
      throw new Error('NATIVE_CDC_INGESTION_ENTITY_EVIDENCE_NOT_SUCCESS cycle=' + cycleId + ' entity=' + entityType);
    }
    const sourceId = 'NATIVE_CDC|' + cycleId + '|' + entityType;
    const result = qboForwardIngestionRegisterSource_({
      ingestionSourceId: sourceId,
      sourceType: QBO_NATIVE_CDC_FORWARD_INGESTION_.SOURCE_TYPE,
      sourceRunId: cycleId,
      sourceUnitId: cycleId + '|' + entityType,
      entityType: entityType,
      evidenceFileId: String(entityEvidence.evidenceFileId || ''),
      evidenceFileName: String(entityEvidence.evidenceFileName || ''),
      evidenceHash: String(entityEvidence.payloadSha256 || ''),
      evidenceHashType: 'SHA-256',
      observedAt: String(entityEvidence.requestCompletedAt || manifest.runCompletedAt || ''),
      sourceWindowStart: String(manifest.windowStart || ''),
      sourceWindowEnd: String(manifest.windowEnd || ''),
      sourceResponseTime: String(entityEvidence.qboResponseTime || ''),
      requestStartedAt: String(entityEvidence.requestStartedAt || ''),
      requestCompletedAt: String(entityEvidence.requestCompletedAt || ''),
      sourceStatus: 'SUCCESS',
      observationCount: Number(entityEvidence.returnedEntityCount || 0),
      registeredAt: registeredAt
    });
    if (result.registered) registered += 1;
    else alreadyRegistered += 1;
  });

  const result = {
    cycleId: cycleId,
    manifestFileId: file.getId(),
    sourceUnitCount: evidence.length,
    registered: registered,
    alreadyRegistered: alreadyRegistered,
    registeredAt: registeredAt.toISOString()
  };
  console.log('[NATIVE CDC INGESTION] | CYCLE REGISTERED | ' + JSON.stringify(result));
  return result;
}




/** One-time production repair for the first automatically registered v1.5.65
 * cycle. Cloud execution evidence shows the post-commit registration completed
 * at Sep 13 2026 11:22:53 PM America/Chicago = 2026-09-14T04:22:53Z. */
function repairQboNativeCdc0400RegisteredAt() {
  const cycleId = '20260914T0400Z|e83314f0-5b3b-4ff2-88b4-0d70b98d3531';
  const registeredAt = '2026-09-14T04:22:53.000Z';
  const result = qboForwardIngestionRepairBlankRegisteredAt_(function(row) {
    return String(row.SourceType || '') === QBO_NATIVE_CDC_FORWARD_INGESTION_.SOURCE_TYPE &&
      String(row.SourceRunId || '') === cycleId;
  }, registeredAt);
  const out = {
    cycleId: cycleId,
    repaired: result.repaired,
    registeredAt: result.registeredAt,
    expectedSourceUnitCount: QBO_NATIVE_CDC_PRODUCTION.ENTITIES.length,
    valid: result.repaired === QBO_NATIVE_CDC_PRODUCTION.ENTITIES.length
  };
  if (!out.valid && result.repaired !== 0) {
    throw new Error('NATIVE_CDC_REGISTERED_AT_REPAIR_COUNT_MISMATCH repaired=' + result.repaired + ' expected=' + out.expectedSourceUnitCount);
  }
  console.log('[NATIVE CDC INGESTION] | REGISTERED AT REPAIR | ' + JSON.stringify(out));
  return out;
}

function validateQboNativeCdcRegisteredAtCompleteness() {
  const sheet = qboForwardIngestionEnsureSheet_();
  const rows = qboForwardIngestionReadRows_(sheet).filter(function(row) {
    return String(row.SourceType || '') === QBO_NATIVE_CDC_FORWARD_INGESTION_.SOURCE_TYPE;
  });
  const blank = rows.filter(function(row) { return !row.RegisteredAt; });
  const result = {
    sourceType: QBO_NATIVE_CDC_FORWARD_INGESTION_.SOURCE_TYPE,
    rowCount: rows.length,
    blankRegisteredAtCount: blank.length,
    blankSourceIds: blank.map(function(row) { return String(row.IngestionSourceId || ''); }),
    valid: blank.length === 0
  };
  console.log('[NATIVE CDC INGESTION] | REGISTERED AT VALIDATION | ' + JSON.stringify(result));
  return result;
}

/** Manual validation/backfill discovery helper. Scans the governed Native CDC
 * evidence root for the most recent fully committed cycle that returned at
 * least one entity and is not already fully registered in the forward-ingestion
 * ledger. Drive enumeration is discovery-only here; 05_Forward_Ingestion_Control
 * remains the authoritative resume/processed control. */
function registerLatestUnregisteredNonEmptyQboNativeCdcCycleForIngestion() {
  const evidenceFolder = qboNativeCdcResolveEvidenceFolder_();
  const controlSheet = qboForwardIngestionEnsureSheet_();
  const folders = qboNativeCdcListRunFoldersForDiscovery_(evidenceFolder);
  const candidates = [];

  for (let folderIndex = 0; folderIndex < folders.length; folderIndex++) {
    const folder = folders[folderIndex];
    const name = String(folder.getName() || '');
    if (name.indexOf(QBO_NATIVE_CDC_PRODUCTION.RUN_FOLDER_PREFIX) !== 0) continue;

    const manifestFiles = folder.getFilesByName(QBO_NATIVE_CDC_PRODUCTION.MANIFEST_FILE_NAME);
    if (!manifestFiles.hasNext()) continue;
    const manifestFile = manifestFiles.next();
    if (manifestFiles.hasNext()) {
      throw new Error('NATIVE_CDC_INGESTION_DUPLICATE_MANIFEST_FOLDER folderId=' + folder.getId());
    }

    let manifest;
    try { manifest = JSON.parse(manifestFile.getBlob().getDataAsString('UTF-8')); }
    catch (error) { continue; }

    const cycleId = String(manifest.cycleId || '').trim();
    if (!cycleId || String(manifest.status || '') !== 'SUCCESS' || manifest.watermarkCommitted !== true) continue;
    if (Number(manifest.returnedEntityCount || 0) <= 0) continue;

    const evidence = Array.isArray(manifest.entityEvidence) ? manifest.entityEvidence : [];
    if (evidence.length !== QBO_NATIVE_CDC_PRODUCTION.ENTITIES.length) continue;

    let unregisteredCount = 0;
    evidence.forEach(function(entityEvidence) {
      const entityType = String(entityEvidence.entity || '').trim();
      const sourceId = 'NATIVE_CDC|' + cycleId + '|' + entityType;
      if (!qboForwardIngestionFindBySourceId_(controlSheet, sourceId)) unregisteredCount += 1;
    });
    if (unregisteredCount === 0) continue;

    candidates.push({
      cycleId: cycleId,
      runStartedAt: String(manifest.runStartedAt || ''),
      returnedEntityCount: Number(manifest.returnedEntityCount || 0),
      manifestFileId: manifestFile.getId(),
      runFolderId: folder.getId(),
      unregisteredSourceUnitCount: unregisteredCount
    });
  }

  if (!candidates.length) throw new Error('NATIVE_CDC_INGESTION_NO_UNREGISTERED_NONEMPTY_CYCLE');
  candidates.sort(function(a, b) {
    const at = Date.parse(a.runStartedAt || '') || 0;
    const bt = Date.parse(b.runStartedAt || '') || 0;
    if (at !== bt) return bt - at;
    return b.cycleId.localeCompare(a.cycleId);
  });

  const selected = candidates[0];
  console.log('[NATIVE CDC INGESTION] | NONEMPTY CYCLE SELECTED | ' + JSON.stringify(selected));
  return registerQboNativeCdcManifestForIngestion_(selected.manifestFileId);
}

function qboNativeCdcListRunFoldersForDiscovery_(root) {
  const runFolders = [];
  const top = root.getFolders();
  while (top.hasNext()) {
    const child = top.next();
    const name = String(child.getName() || '');
    if (name.indexOf(QBO_NATIVE_CDC_PRODUCTION.RUN_FOLDER_PREFIX) === 0) {
      runFolders.push(child); // legacy flat layout
      continue;
    }
    if (!/^\d{4}$/.test(name)) continue;
    const months = child.getFolders();
    while (months.hasNext()) {
      const month = months.next();
      if (!/^\d{2}$/.test(String(month.getName() || ''))) continue;
      const days = month.getFolders();
      while (days.hasNext()) {
        const day = days.next();
        if (!/^\d{2}$/.test(String(day.getName() || ''))) continue;
        const runs = day.getFolders();
        while (runs.hasNext()) {
          const run = runs.next();
          if (String(run.getName() || '').indexOf(QBO_NATIVE_CDC_PRODUCTION.RUN_FOLDER_PREFIX) === 0) runFolders.push(run);
        }
      }
    }
  }
  return runFolders;
}

function runNextQboNativeCdcIngestionWork() {
  const workerId = Utilities.getUuid();
  if (!qboNativeCdcClaimIngestionPipeline_(workerId)) {
    const busy = {action:'ALREADY_ACTIVE', workerId:workerId};
    console.log('[NATIVE CDC INGESTION] | WORKER SKIPPED | ' + JSON.stringify(busy));
    return busy;
  }

  const startedMs = Date.now();
  let workUnits = 0;
  let observations = 0;
  let payloads = 0;
  let shards = 0;
  try {
    while (Date.now() - startedMs < QBO_NATIVE_CDC_FORWARD_INGESTION_.WORKER_RUNTIME_BUDGET_MS) {
      const remaining = QBO_NATIVE_CDC_FORWARD_INGESTION_.WORKER_RUNTIME_BUDGET_MS - (Date.now() - startedMs);
      if (workUnits > 0 && remaining < QBO_NATIVE_CDC_FORWARD_INGESTION_.MIN_SAFE_NEW_WORK_MS) break;
      const source = qboForwardIngestionClaimNext_(QBO_NATIVE_CDC_FORWARD_INGESTION_.SOURCE_TYPE, workerId);
      if (!source) break;

      try {
        const result = qboNativeCdcIngestClaimedSource_(source, workerId);
        workUnits += 1;
        observations += Number(result.observations || 0);
        payloads += Number(result.payloads || 0);
        shards += Number(result.shards || 0);
        qboNativeCdcHeartbeatIngestionPipeline_(workerId);
      } catch (error) {
        qboForwardIngestionBlock_(source.IngestionSourceId, workerId, error);
        console.error('[NATIVE CDC INGESTION] | BLOCKED | sourceId=' + source.IngestionSourceId + ' | ' + (error && error.message ? error.message : error));
        throw error;
      }
    }

    const result = {workerId:workerId, workUnits:workUnits, observations:observations, payloads:payloads, shards:shards};
    console.log('[NATIVE CDC INGESTION] | WORKER COMPLETE | ' + JSON.stringify(result));
    return result;
  } finally {
    qboNativeCdcReleaseIngestionPipeline_(workerId);
  }
}

function qboNativeCdcClaimIngestionPipeline_(workerId) {
  return qboForwardIngestionWithLock_(function() {
    const props = PropertiesService.getScriptProperties();
    const key = QBO_NATIVE_CDC_FORWARD_INGESTION_.PIPELINE_LEASE_PROPERTY_KEY;
    const now = Date.now();
    let lease = null;
    try { lease = JSON.parse(props.getProperty(key) || 'null'); } catch (ignore) {}
    if (lease && Number(lease.expiresAtMs || 0) > now && lease.workerId !== workerId) return false;
    props.setProperty(key, JSON.stringify({workerId:workerId, acquiredAt:new Date(now).toISOString(), expiresAtMs:now + QBO_NATIVE_CDC_FORWARD_INGESTION_.PIPELINE_LEASE_MS}));
    return true;
  });
}

function qboNativeCdcHeartbeatIngestionPipeline_(workerId) {
  qboForwardIngestionWithLock_(function() {
    const props = PropertiesService.getScriptProperties();
    const key = QBO_NATIVE_CDC_FORWARD_INGESTION_.PIPELINE_LEASE_PROPERTY_KEY;
    let lease = null;
    try { lease = JSON.parse(props.getProperty(key) || 'null'); } catch (ignore) {}
    if (!lease || lease.workerId !== workerId) throw new Error('NATIVE_CDC_INGESTION_PIPELINE_LEASE_MISMATCH');
    const now = Date.now();
    lease.expiresAtMs = now + QBO_NATIVE_CDC_FORWARD_INGESTION_.PIPELINE_LEASE_MS;
    lease.lastHeartbeatAt = new Date(now).toISOString();
    props.setProperty(key, JSON.stringify(lease));
  });
}

function qboNativeCdcReleaseIngestionPipeline_(workerId) {
  qboForwardIngestionWithLock_(function() {
    const props = PropertiesService.getScriptProperties();
    const key = QBO_NATIVE_CDC_FORWARD_INGESTION_.PIPELINE_LEASE_PROPERTY_KEY;
    let lease = null;
    try { lease = JSON.parse(props.getProperty(key) || 'null'); } catch (ignore) {}
    if (lease && lease.workerId === workerId) props.deleteProperty(key);
  });
}

function qboNativeCdcIngestClaimedSource_(source, workerId) {
  const sourceId = String(source.IngestionSourceId || '');
  const entityType = String(source.EntityType || '');
  const evidenceFileId = String(source.EvidenceFileId || '');
  if (!sourceId || !entityType || !evidenceFileId) throw new Error('NATIVE_CDC_INGESTION_SOURCE_CONTROL_INCOMPLETE sourceId=' + sourceId);

  const file = DriveApp.getFileById(evidenceFileId);
  if (source.EvidenceFileName && file.getName() !== String(source.EvidenceFileName)) {
    throw new Error('NATIVE_CDC_INGESTION_EVIDENCE_NAME_MISMATCH sourceId=' + sourceId);
  }
  const text = file.getBlob().getDataAsString('UTF-8');
  const hash = qboStateCaptureAuditSha256_(text);
  if (source.EvidenceHash && hash !== String(source.EvidenceHash)) {
    throw new Error('NATIVE_CDC_INGESTION_EVIDENCE_HASH_MISMATCH sourceId=' + sourceId);
  }
  let envelope;
  try { envelope = JSON.parse(text); }
  catch (error) { throw new Error('NATIVE_CDC_INGESTION_EVIDENCE_INVALID_JSON sourceId=' + sourceId); }
  const entities = qboSourceAdapterExtractNativeCdcEntities_(envelope, entityType);
  const cursor = Number(source.RecordCursor || 0);
  const expectedCount = source.ObservationCount === '' ? entities.length : Number(source.ObservationCount || 0);
  if (expectedCount !== entities.length) {
    throw new Error('NATIVE_CDC_INGESTION_OBSERVATION_COUNT_MISMATCH sourceId=' + sourceId + ' expected=' + expectedCount + ' actual=' + entities.length);
  }

  if (entities.length === 0 || cursor >= entities.length) {
    qboForwardIngestionCheckpoint_(sourceId, workerId, {
      recordCursor: entities.length,
      observationCount: entities.length,
      processed: true,
      progress: true
    });
    console.log('[NATIVE CDC INGESTION] | SOURCE COMPLETE | sourceId=' + sourceId + ' | observations=' + entities.length + ' | payloads=0');
    return {observations:0, payloads:0, shards:0, finished:true};
  }

  const end = Math.min(cursor + QBO_NATIVE_CDC_FORWARD_INGESTION_.BATCH_SIZE, entities.length);
  const workUnitId = 'NATIVE_CDC_INGEST|' + qboStateCaptureAuditSha256_(sourceId + '|' + cursor + '|' + end);
  const payloadBatch = [];
  for (let i = cursor; i < end; i++) {
    const entity = entities[i];
    const entityId = String(entity && entity.Id || '').trim();
    if (!entityId) throw new Error('NATIVE_CDC_INGESTION_MISSING_ENTITY_ID sourceId=' + sourceId + ' index=' + i);
    const operation = String(entity.status || '').toLowerCase() === 'deleted' ? 'DELETE' : 'UPSERT';
    const sourceChangeTime = String(entity.MetaData && entity.MetaData.LastUpdatedTime || source.SourceResponseTime || '');
    const sourceObservationId = sourceId + '|OBS|' + i + '|' + entityId + '|' + operation;
    payloadBatch.push(qboAdaptNativeCdcEntityObservation_({
      sourceObservationId: sourceObservationId,
      entityType: entityType,
      entityId: entityId,
      rawEntity: entity,
      operation: operation,
      observedAt: String(source.RequestCompletedAt || source.ObservedAt || ''),
      sourceChangeTime: sourceChangeTime,
      sourceReceivedAt: String(source.RequestCompletedAt || source.ObservedAt || ''),
      evidenceFileId: evidenceFileId,
      evidenceFileName: String(source.EvidenceFileName || ''),
      evidenceHash: String(source.EvidenceHash || ''),
      evidenceReference: evidenceFileId,
      cycleId: String(source.SourceRunId || ''),
      entityRunId: String(source.SourceUnitId || ''),
      workUnitId: workUnitId,
      continuationId: workerId
    }));
  }

  const persisted = qboPersistChangePayloadShard_(payloadBatch, {
    ingestionRunId: 'FORWARD_NATIVE_CDC|' + String(source.SourceRunId || ''),
    workUnitId: workUnitId,
    sourceId: sourceId,
    sourceRunId: String(source.SourceRunId || ''),
    sourceType: QBO_NATIVE_CDC_FORWARD_INGESTION_.SOURCE_TYPE,
    sourceIndex: '',
    recordCursorStart: cursor,
    recordCursorEndExclusive: end
  });
  const finished = end >= entities.length;
  qboForwardIngestionCheckpoint_(sourceId, workerId, {
    recordCursor: end,
    observationCount: entities.length,
    payloadCountDelta: payloadBatch.length,
    shardCountDelta: 1,
    processed: finished,
    progress: true
  });
  console.log('[NATIVE CDC INGESTION] | BATCH COMPLETE | sourceId=' + sourceId + ' | cursor=' + cursor + '..' + end + '/' + entities.length + ' | payloads=' + payloadBatch.length + ' | shardCreated=' + persisted.created + ' | reconciled=' + persisted.reconciled);
  if (finished) console.log('[NATIVE CDC INGESTION] | SOURCE COMPLETE | sourceId=' + sourceId + ' | observations=' + entities.length + ' | payloads=' + payloadBatch.length);
  return {observations:end-cursor, payloads:payloadBatch.length, shards:1, finished:finished};
}
