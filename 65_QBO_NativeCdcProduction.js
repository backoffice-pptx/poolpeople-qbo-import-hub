/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 65_QBO_NativeCdcProduction.js
 * Purpose     : Production QBO Native CDC source-evidence acquisition.
 *
 * Public API:
 *   - testQboNativeCdcProductionConfiguration()
 *   - installQboNativeCdcTriggers()
 *   - removeQboNativeCdcTriggers()
 *   - listQboNativeCdcTriggers()
 *   - listQboNativeCdcStatus()
 *   - pauseQboNativeCdcProduction()
 *   - resumeQboNativeCdcProduction()
 *   - retryPendingQboNativeCdcIngestionRegistration()
 *   - startQboNativeCdcCycle()
 *   - resumeQboNativeCdcCycle()
 * Trigger entry point:
 *   - runNextQboNativeCdcWave()
 * Compatibility:
 *   - runQboNativeCdcProduction() now starts/resumes the governed cycle and no
 *     longer runs all 20 entities inline under one long ScriptLock.
 * ============================================================================
 */

function testQboNativeCdcProductionConfiguration() {
  const folder = qboNativeCdcResolveEvidenceFolder_();
  const cfg = QBO_NATIVE_CDC_PRODUCTION;
  const result = {
    ok: true,
    version: cfg.VERSION,
    assetKey: cfg.EVIDENCE_FOLDER_ASSET_KEY,
    folderId: folder.getId(),
    folderName: folder.getName(),
    entityCount: cfg.ENTITIES.length,
    initialLookbackDays: cfg.INITIAL_LOOKBACK_DAYS,
    overlapMinutes: cfg.OVERLAP_MINUTES,
    cycleMinutes: cfg.CYCLE_MINUTES,
    entitiesPerWave: cfg.ENTITIES_PER_WAVE,
    workerRuntimeBudgetMs: cfg.WORKER_RUNTIME_BUDGET_MS,
    workerLeaseMs: cfg.WORKER_LEASE_MS,
    productionPaused: qboNativeCdcIsPaused_(),
    newEvidenceLayout: QBO_NATIVE_CDC_PRODUCTION.DATE_PARTITION_NEW_EVIDENCE ? 'UTC_YYYY/MM/DD' : 'FLAT',
    automaticForwardRegistration: true
  };
  console.log('[NATIVE CDC PROD] | CONFIG OK | ' + JSON.stringify(result, null, 2));
  return result;
}

function pauseQboNativeCdcProduction() {
  let result = null;
  qboNativeCdcWithControlLock_(function() {
    const state = qboNativeCdcReadState_();
    const now = Date.now();
    const activeStatus = !!(state && ['RUNNING', 'INITIALIZING', 'FINALIZING'].indexOf(String(state.status || '')) >= 0);
    const workerLeaseActive = !!(state && state.workerLeaseOwner && Number(state.workerLeaseExpiresAtMs || 0) > now);
    if (activeStatus || workerLeaseActive) {
      result = {
        action: 'REFUSED_ACTIVE_CYCLE',
        cycleId: state && state.cycleId ? state.cycleId : '',
        status: state && state.status ? state.status : '',
        workerLeaseActive: workerLeaseActive
      };
      return;
    }

    PropertiesService.getScriptProperties().setProperty(QBO_NATIVE_CDC_PRODUCTION.PAUSE_PROPERTY_KEY, 'true');
    qboNativeCdcDeleteManagedTriggers_();
    result = {
      action: 'PAUSED',
      productionPaused: true,
      recurringStartRemoved: true,
      pendingContinuationsRemoved: true,
      committedWatermark: PropertiesService.getScriptProperties().getProperty(QBO_NATIVE_CDC_PRODUCTION.WATERMARK_PROPERTY_KEY) || '',
      cycleId: state && state.cycleId ? state.cycleId : '',
      status: state && state.status ? state.status : 'IDLE'
    };
  });
  console.log('[NATIVE CDC PROD] | PAUSE | ' + JSON.stringify(result));
  return result;
}

function resumeQboNativeCdcProduction() {
  let result = null;
  qboNativeCdcWithControlLock_(function() {
    const state = qboNativeCdcReadState_();
    const now = Date.now();
    const activeStatus = !!(state && ['RUNNING', 'INITIALIZING', 'FINALIZING'].indexOf(String(state.status || '')) >= 0);
    const workerLeaseActive = !!(state && state.workerLeaseOwner && Number(state.workerLeaseExpiresAtMs || 0) > now);
    if (activeStatus || workerLeaseActive) {
      result = {
        action: 'REFUSED_ACTIVE_CYCLE',
        cycleId: state && state.cycleId ? state.cycleId : '',
        status: state && state.status ? state.status : '',
        workerLeaseActive: workerLeaseActive
      };
      return;
    }

    const props = PropertiesService.getScriptProperties();
    props.deleteProperty(QBO_NATIVE_CDC_PRODUCTION.PAUSE_PROPERTY_KEY);
    // Resume starts from a clean scheduler surface: no stale continuation is
    // recreated. Only the recurring cycle starter is installed.
    qboNativeCdcDeleteManagedTriggers_();
    ScriptApp.newTrigger(QBO_NATIVE_CDC_PRODUCTION.TRIGGER_HANDLERS.START)
      .timeBased()
      .everyMinutes(QBO_NATIVE_CDC_PRODUCTION.CYCLE_MINUTES)
      .create();
    result = {
      action: 'RESUMED',
      productionPaused: false,
      recurringStartInstalled: true,
      pendingContinuationsInstalled: false,
      committedWatermark: props.getProperty(QBO_NATIVE_CDC_PRODUCTION.WATERMARK_PROPERTY_KEY) || '',
      cycleId: state && state.cycleId ? state.cycleId : '',
      status: state && state.status ? state.status : 'IDLE'
    };
  });
  console.log('[NATIVE CDC PROD] | RESUME PRODUCTION | ' + JSON.stringify(result));
  return result;
}

function installQboNativeCdcTriggers() {
  testQboNativeCdcProductionConfiguration();
  qboNativeCdcWithControlLock_(function() {
    qboNativeCdcDeleteManagedTriggers_();
    ScriptApp.newTrigger(QBO_NATIVE_CDC_PRODUCTION.TRIGGER_HANDLERS.START)
      .timeBased()
      .everyMinutes(QBO_NATIVE_CDC_PRODUCTION.CYCLE_MINUTES)
      .create();
  });
  console.log('[NATIVE CDC PROD] | TRIGGER INSTALLED | handler=' +
    QBO_NATIVE_CDC_PRODUCTION.TRIGGER_HANDLERS.START + ' | everyMinutes=' +
    QBO_NATIVE_CDC_PRODUCTION.CYCLE_MINUTES);
  return listQboNativeCdcTriggers();
}

function removeQboNativeCdcTriggers() {
  qboNativeCdcWithControlLock_(function() { qboNativeCdcDeleteManagedTriggers_(); });
  console.log('[NATIVE CDC PROD] | TRIGGERS REMOVED');
  return listQboNativeCdcTriggers();
}

function listQboNativeCdcTriggers() {
  const cfg = QBO_NATIVE_CDC_PRODUCTION;
  const rows = [];
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    const handler = trigger.getHandlerFunction();
    if (handler !== cfg.TRIGGER_HANDLERS.START && handler !== cfg.TRIGGER_HANDLERS.NEXT) return;
    rows.push({handler: handler, source: String(trigger.getTriggerSource()), eventType: String(trigger.getEventType()), triggerId: trigger.getUniqueId()});
    console.log('[NATIVE CDC PROD] | TRIGGER ACTIVE | handler=' + handler +
      ' | source=' + trigger.getTriggerSource() + ' | event=' + trigger.getEventType() +
      ' | triggerId=' + trigger.getUniqueId());
  });
  console.log('[NATIVE CDC PROD] | TRIGGER STATUS | managed=' + rows.length);
  return rows;
}

function listQboNativeCdcStatus() {
  const state = qboNativeCdcReadState_();
  if (!state) {
    const empty = {status: 'IDLE', watermark: PropertiesService.getScriptProperties().getProperty(QBO_NATIVE_CDC_PRODUCTION.WATERMARK_PROPERTY_KEY) || '', activeCycle: false, productionPaused: qboNativeCdcIsPaused_()};
    console.log('[NATIVE CDC PROD] | STATUS | ' + JSON.stringify(empty, null, 2));
    return empty;
  }
  const now = Date.now();
  const result = Object.assign({}, state, {
    activeCycle: state.status === 'RUNNING',
    workerLeaseActive: !!(state.workerLeaseOwner && Number(state.workerLeaseExpiresAtMs || 0) > now),
    stale: state.status === 'RUNNING' && (now - Number(state.lastHeartbeatAtMs || state.startedAtMs || now) > QBO_NATIVE_CDC_PRODUCTION.STALE_CYCLE_MS),
    productionPaused: qboNativeCdcIsPaused_(),
    newEvidenceLayout: QBO_NATIVE_CDC_PRODUCTION.DATE_PARTITION_NEW_EVIDENCE ? 'UTC_YYYY/MM/DD' : 'FLAT',
    automaticForwardRegistration: true
  });
  delete result.workerLeaseOwner;
  console.log('[NATIVE CDC PROD] | STATUS | ' + JSON.stringify(result, null, 2));
  return result;
}

function startQboNativeCdcCycle() {
  testQboNativeCdcProductionConfiguration();
  const started = new Date();
  const window = qboNativeCdcBuildWindow_(started);
  const cycleId = qboNativeCdcBuildCycleId_(started);
  const initToken = Utilities.getUuid();
  let action = null;

  // Reserve initialization atomically, then release the project-wide lock
  // before any Drive operation.
  qboNativeCdcWithControlLock_(function() {
    if (qboNativeCdcIsPaused_()) {
      action = {action: 'PAUSED', productionPaused: true};
      return;
    }
    const current = qboNativeCdcReadState_();
    const now = Date.now();
    if (current && (current.status === 'RUNNING' || current.status === 'INITIALIZING' || current.status === 'FINALIZING')) {
      if (current.status === 'RUNNING') qboNativeCdcEnsureContinuationTriggerLocked_();
      action = {action: 'ALREADY_ACTIVE', cycleId: current.cycleId || '', status: current.status, entityIndex: current.entityIndex || 0};
      return;
    }
    qboNativeCdcWriteState_({
      schemaVersion: 2, version: QBO_NATIVE_CDC_PRODUCTION.VERSION,
      cycleId: cycleId, status: 'INITIALIZING', initToken: initToken,
      startedAt: started.toISOString(), startedAtMs: started.getTime(),
      windowStart: window.start.toISOString(), windowEnd: window.end.toISOString(),
      initialRun: window.initialRun, priorSuccessfulWatermark: window.priorSuccessfulWatermark || '',
      lastProgressAt: started.toISOString(), lastProgressAtMs: started.getTime(),
      lastHeartbeatAt: started.toISOString(), lastHeartbeatAtMs: started.getTime(),
      lastError: ''
    });
  });
  if (action) return action;

  const runParentFolder = qboNativeCdcResolveRunParentFolder_(started);
  const runFolderName = QBO_NATIVE_CDC_PRODUCTION.RUN_FOLDER_PREFIX + Utilities.formatDate(started, 'UTC', 'yyyyMMdd_HHmmss_SSS') + '_' + cycleId;
  const runFolder = runParentFolder.createFolder(runFolderName);

  let state;
  qboNativeCdcWithControlLock_(function() {
    const reserved = qboNativeCdcReadState_();
    if (!reserved || reserved.status !== 'INITIALIZING' || reserved.initToken !== initToken || reserved.cycleId !== cycleId) {
      throw new Error('Native CDC initialization reservation was replaced before commit. Orphan folder=' + runFolder.getId());
    }
    state = Object.assign({}, reserved, {
      status: 'RUNNING', entityIndex: 0, entityCount: QBO_NATIVE_CDC_PRODUCTION.ENTITIES.length,
      currentEntity: QBO_NATIVE_CDC_PRODUCTION.ENTITIES[0], completedEntityCount: 0,
      workerLeaseOwner: '', workerLeaseExpiresAt: '', workerLeaseExpiresAtMs: 0,
      continuationCount: 0, runFolderId: runFolder.getId(), runFolderName: runFolderName,
      manifestFileId: '', watermarkCommitted: false, committedWatermark: ''
    });
    delete state.initToken;
    qboNativeCdcWriteState_(state);
    qboNativeCdcEnsureContinuationTriggerLocked_();
  });

  // Drive manifest write occurs outside ScriptLock.
  qboNativeCdcWriteManifest_(state);
  console.log('[NATIVE CDC PROD] | CYCLE STARTED | cycle=' + cycleId + ' | window=' + state.windowStart + '..' + state.windowEnd + ' | initial=' + state.initialRun);
  action = {action: 'STARTED', cycleId: cycleId, entityIndex: 0};
  console.log('[NATIVE CDC PROD] | START RESULT | ' + JSON.stringify(action));
  return action;
}
function resumeQboNativeCdcCycle() {
  let result;
  qboNativeCdcWithControlLock_(function() {
    if (qboNativeCdcIsPaused_()) { result = {action: 'PAUSED', productionPaused: true}; return; }
    const state = qboNativeCdcReadState_();
    if (!state || state.status !== 'RUNNING') { result = {action: 'NO_ACTIVE_CYCLE'}; return; }
    qboNativeCdcEnsureContinuationTriggerLocked_();
    result = {action: 'CONTINUATION_ENSURED', cycleId: state.cycleId, entityIndex: state.entityIndex};
  });
  console.log('[NATIVE CDC PROD] | RESUME | ' + JSON.stringify(result));
  return result;
}

function runQboNativeCdcProduction() { return startQboNativeCdcCycle(); }

function runNextQboNativeCdcWave() {
  const workerId = Utilities.getUuid();
  const continuationId = Utilities.getUuid();
  let state = qboNativeCdcClaimWorker_(workerId, continuationId);
  if (!state) return {action: 'NO_CLAIM'};
  const workerStartedMs = Date.now();
  let processed = 0;
  try {
    while (processed < QBO_NATIVE_CDC_PRODUCTION.ENTITIES_PER_WAVE && Date.now() - workerStartedMs < QBO_NATIVE_CDC_PRODUCTION.WORKER_RUNTIME_BUDGET_MS) {
      state = qboNativeCdcReadState_();
      if (!state || state.status !== 'RUNNING' || Number(state.entityIndex) >= QBO_NATIVE_CDC_PRODUCTION.ENTITIES.length) break;
      qboNativeCdcAssertWorkerOwner_(state, workerId);
      const entityName = QBO_NATIVE_CDC_PRODUCTION.ENTITIES[state.entityIndex];
      const entityRunId = state.cycleId + '|' + entityName;
      const workUnitId = entityRunId;
      qboNativeCdcAcquireEntityLease_(entityName, workerId, state.cycleId);
      try {
        qboNativeCdcHeartbeat_(workerId);
        qboNativeCdcProcessEntity_(state, entityName, entityRunId, workUnitId, continuationId);
        qboNativeCdcCommitEntityCheckpoint_(workerId, state.cycleId, entityName);
        processed += 1;
      } finally {
        qboNativeCdcReleaseEntityLease_(entityName, workerId, state.cycleId);
      }
    }
    state = qboNativeCdcReadState_();
    if (state && state.status === 'RUNNING' && Number(state.entityIndex) >= QBO_NATIVE_CDC_PRODUCTION.ENTITIES.length) qboNativeCdcFinalizeCycle_(workerId, state.cycleId);
  } catch (error) {
    qboNativeCdcRecordWorkerError_(workerId, error);
    throw error;
  } finally {
    qboNativeCdcReleaseWorker_(workerId);
    qboNativeCdcScheduleIfNeeded_();
  }
  console.log('[NATIVE CDC PROD] | WAVE COMPLETE | continuation=' + continuationId + ' | processed=' + processed);
  return listQboNativeCdcStatus();
}

function qboNativeCdcClaimWorker_(workerId, continuationId) {
  let claimed = null;
  qboNativeCdcWithControlLock_(function() {
    qboNativeCdcDeleteTriggersByHandlerLocked_(QBO_NATIVE_CDC_PRODUCTION.TRIGGER_HANDLERS.NEXT);
    if (qboNativeCdcIsPaused_()) return;
    const state = qboNativeCdcReadState_();
    if (!state || state.status !== 'RUNNING') return;
    const now = Date.now();
    if (state.workerLeaseOwner && Number(state.workerLeaseExpiresAtMs || 0) > now && state.workerLeaseOwner !== workerId) {
      qboNativeCdcEnsureContinuationTriggerLocked_();
      return;
    }
    state.workerLeaseOwner = workerId;
    state.workerLeaseExpiresAtMs = now + QBO_NATIVE_CDC_PRODUCTION.WORKER_LEASE_MS;
    state.workerLeaseExpiresAt = new Date(state.workerLeaseExpiresAtMs).toISOString();
    state.lastHeartbeatAtMs = now;
    state.lastHeartbeatAt = new Date(now).toISOString();
    state.continuationCount = Number(state.continuationCount || 0) + 1;
    state.lastContinuationId = continuationId;
    qboNativeCdcWriteState_(state);
    claimed = state;
  });
  return claimed;
}

function qboNativeCdcReleaseWorker_(workerId) {
  qboNativeCdcWithControlLock_(function() {
    const state = qboNativeCdcReadState_();
    if (!state || state.workerLeaseOwner !== workerId) return;
    state.workerLeaseOwner = ''; state.workerLeaseExpiresAt = ''; state.workerLeaseExpiresAtMs = 0;
    qboNativeCdcWriteState_(state);
  });
}

function qboNativeCdcHeartbeat_(workerId) {
  qboNativeCdcWithControlLock_(function() {
    const state = qboNativeCdcReadState_();
    qboNativeCdcAssertWorkerOwner_(state, workerId);
    const now = Date.now();
    state.lastHeartbeatAtMs = now; state.lastHeartbeatAt = new Date(now).toISOString();
    state.workerLeaseExpiresAtMs = now + QBO_NATIVE_CDC_PRODUCTION.WORKER_LEASE_MS;
    state.workerLeaseExpiresAt = new Date(state.workerLeaseExpiresAtMs).toISOString();
    qboNativeCdcWriteState_(state);
  });
}

function qboNativeCdcProcessEntity_(state, entityName, entityRunId, workUnitId, continuationId) {
  const cfg = getConfig_();
  const runFolder = DriveApp.getFolderById(state.runFolderId);
  const fileName = QBO_NATIVE_CDC_PRODUCTION.ENTITY_FILE_PREFIX + entityName + '.json';

  // Idempotent recovery is checked before making another QBO request. A hard
  // termination may have persisted immutable evidence without advancing the
  // checkpoint or, in the narrowest case, without persisting metadata.
  const existing = runFolder.getFilesByName(fileName);
  if (existing.hasNext()) {
    const priorFile = existing.next();
    if (existing.hasNext()) throw new Error('Native CDC evidence reconciliation found duplicate files for cycle ' + state.cycleId + ', entity ' + entityName + '.');
    const priorMeta = qboNativeCdcReadEntityMeta_(state.cycleId, entityName);
    if (priorMeta && priorMeta.status === 'SUCCESS' && priorMeta.evidenceFileId === priorFile.getId()) {
      console.log('[NATIVE CDC PROD] | ENTITY RECOVERED | cycle=' + state.cycleId + ' | entity=' + entityName + ' | evidenceFileId=' + priorFile.getId());
      return;
    }

    const priorJson = priorFile.getBlob().getDataAsString('UTF-8');
    let priorResponse;
    try { priorResponse = JSON.parse(priorJson); }
    catch (error) { throw new Error('Native CDC existing evidence is invalid JSON for ' + entityName + ': ' + error.message); }
    const priorEntities = qboNativeCdcProductionExtractEntities_(priorResponse, entityName);
    const priorDeleted = priorEntities.filter(function(entity) { return entity && String(entity.status || '').toLowerCase() === 'deleted'; }).length;
    qboNativeCdcWriteEntityMeta_(state.cycleId, entityName, {
      cycleId: state.cycleId, entityRunId: entityRunId, workUnitId: workUnitId,
      continuationId: continuationId, entity: entityName, status: 'SUCCESS',
      returnedEntityCount: priorEntities.length, liveEntityCount: priorEntities.length - priorDeleted,
      deletedEntityCount: priorDeleted, evidenceFileId: priorFile.getId(), evidenceFileName: fileName,
      payloadSha256: qboNativeCdcSha256_(priorJson), requestStartedAt: '', requestCompletedAt: '',
      qboResponseTime: priorResponse && priorResponse.time ? String(priorResponse.time) : '',
      minorVersion: String(cfg.minorVersion), recoveredAfterHardTermination: true
    });
    console.log('[NATIVE CDC PROD] | ENTITY METADATA RECONSTRUCTED | cycle=' + state.cycleId + ' | entity=' + entityName + ' | evidenceFileId=' + priorFile.getId());
    return;
  }

  const requestStartedAt = new Date();
  const response = qboNativeCdcRequestEntity_(entityName, new Date(state.windowStart), cfg.minorVersion);
  const requestCompletedAt = new Date();
  const entities = qboNativeCdcProductionExtractEntities_(response, entityName);
  const deletedCount = entities.filter(function(entity) { return entity && String(entity.status || '').toLowerCase() === 'deleted'; }).length;
  const liveCount = entities.length - deletedCount;
  const json = JSON.stringify(response, null, 2);
  const file = runFolder.createFile(fileName, json, 'application/json');
  const meta = {
    cycleId: state.cycleId, entityRunId: entityRunId, workUnitId: workUnitId,
    continuationId: continuationId, entity: entityName, status: 'SUCCESS',
    returnedEntityCount: entities.length, liveEntityCount: liveCount, deletedEntityCount: deletedCount,
    evidenceFileId: file.getId(), evidenceFileName: fileName, payloadSha256: qboNativeCdcSha256_(json),
    requestStartedAt: requestStartedAt.toISOString(), requestCompletedAt: requestCompletedAt.toISOString(),
    qboResponseTime: response && response.time ? String(response.time) : '', minorVersion: String(cfg.minorVersion)
  };
  qboNativeCdcWriteEntityMeta_(state.cycleId, entityName, meta);
  const persisted = DriveApp.getFileById(file.getId());
  if (persisted.getName() !== fileName || persisted.getSize() <= 0) throw new Error('Native CDC evidence reconciliation failed for ' + entityName + ' in cycle ' + state.cycleId + '.');
  console.log('[NATIVE CDC PROD] | ENTITY COMPLETE | cycle=' + state.cycleId + ' | entity=' + entityName + ' | count=' + entities.length + ' | deleted=' + deletedCount + ' | entityRunId=' + entityRunId);
}
function qboNativeCdcCommitEntityCheckpoint_(workerId, cycleId, entityName) {
  let committed;
  qboNativeCdcWithControlLock_(function() {
    const state = qboNativeCdcReadState_();
    qboNativeCdcAssertWorkerOwner_(state, workerId);
    if (state.cycleId !== cycleId) throw new Error('Native CDC cycle changed before checkpoint commit.');
    const expected = QBO_NATIVE_CDC_PRODUCTION.ENTITIES[state.entityIndex];
    if (expected !== entityName) throw new Error('Native CDC checkpoint mismatch. Expected ' + expected + ', got ' + entityName + '.');
    const meta = qboNativeCdcReadEntityMeta_(cycleId, entityName);
    if (!meta || meta.status !== 'SUCCESS' || !meta.evidenceFileId) throw new Error('Native CDC checkpoint refused: durable SUCCESS evidence metadata missing for ' + entityName + '.');
    state.entityIndex = Number(state.entityIndex) + 1;
    state.completedEntityCount = state.entityIndex;
    state.currentEntity = state.entityIndex < QBO_NATIVE_CDC_PRODUCTION.ENTITIES.length ? QBO_NATIVE_CDC_PRODUCTION.ENTITIES[state.entityIndex] : '';
    state.lastError = '';
    const now = Date.now();
    state.lastProgressAtMs = now; state.lastProgressAt = new Date(now).toISOString();
    state.lastHeartbeatAtMs = now; state.lastHeartbeatAt = new Date(now).toISOString();
    state.workerLeaseExpiresAtMs = now + QBO_NATIVE_CDC_PRODUCTION.WORKER_LEASE_MS;
    state.workerLeaseExpiresAt = new Date(state.workerLeaseExpiresAtMs).toISOString();
    qboNativeCdcWriteState_(state);
    committed = Object.assign({}, state);
  });
  qboNativeCdcWriteManifest_(committed);
}
function qboNativeCdcFinalizeCycle_(workerId, cycleId) {
  let finalizing;
  qboNativeCdcWithControlLock_(function() {
    const state = qboNativeCdcReadState_();
    qboNativeCdcAssertWorkerOwner_(state, workerId);
    if (state.cycleId !== cycleId || Number(state.entityIndex) !== QBO_NATIVE_CDC_PRODUCTION.ENTITIES.length) throw new Error('Native CDC finalize refused before complete cycle.');
    QBO_NATIVE_CDC_PRODUCTION.ENTITIES.forEach(function(entityName) {
      const meta = qboNativeCdcReadEntityMeta_(cycleId, entityName);
      if (!meta || meta.status !== 'SUCCESS' || !meta.evidenceFileId) throw new Error('Native CDC finalize refused: missing successful evidence for ' + entityName + '.');
    });
    state.status = 'FINALIZING';
    state.completedAt = new Date().toISOString();
    qboNativeCdcWriteState_(state);
    finalizing = Object.assign({}, state);
  });

  // Persist complete pre-watermark manifest outside ScriptLock.
  qboNativeCdcWriteManifest_(finalizing);

  let completed;
  qboNativeCdcWithControlLock_(function() {
    const state = qboNativeCdcReadState_();
    if (!state || state.cycleId !== cycleId || state.status !== 'FINALIZING') throw new Error('Native CDC finalize ownership changed before watermark commit.');
    PropertiesService.getScriptProperties().setProperty(QBO_NATIVE_CDC_PRODUCTION.WATERMARK_PROPERTY_KEY, state.windowEnd);
    state.status = 'SUCCESS'; state.watermarkCommitted = true; state.committedWatermark = state.windowEnd;
    state.lastProgressAt = new Date().toISOString(); state.lastProgressAtMs = Date.now();
    state.workerLeaseOwner = ''; state.workerLeaseExpiresAt = ''; state.workerLeaseExpiresAtMs = 0;
    qboNativeCdcWriteState_(state);
    completed = Object.assign({}, state);
  });
  const committedManifestFile = qboNativeCdcWriteManifest_(completed);
  console.log('[NATIVE CDC PROD] | CYCLE COMPLETE | cycle=' + completed.cycleId + ' | entities=' + completed.completedEntityCount + ' | watermark=' + completed.committedWatermark);

  // Registration is a post-commit handoff. The acquisition watermark is already
  // authoritative at this point. Persist a durable pending handoff before the
  // registration attempt so a transient Sheet/Drive failure can be retried by
  // the independent ingestion dispatcher without reopening the CDC window.
  qboNativeCdcPublishIngestionHandoff_(completed.cycleId, committedManifestFile.getId());
}
function qboNativeCdcPublishIngestionHandoff_(cycleId, manifestFileId) {
  const pending = {
    cycleId: String(cycleId || ''),
    manifestFileId: String(manifestFileId || ''),
    createdAt: new Date().toISOString()
  };
  qboNativeCdcEnqueueIngestionHandoff_(pending);
  try {
    const result = registerQboNativeCdcManifestForIngestion_(pending.manifestFileId);
    qboNativeCdcRemoveIngestionHandoff_(pending);
    console.log('[NATIVE CDC PROD] | INGESTION HANDOFF REGISTERED | ' + JSON.stringify({cycleId:pending.cycleId, manifestFileId:pending.manifestFileId, registered:result.registered, alreadyRegistered:result.alreadyRegistered}));
    return {registered:true, result:result};
  } catch (error) {
    console.error('[NATIVE CDC PROD] | INGESTION HANDOFF PENDING | cycle=' + pending.cycleId + ' | manifestFileId=' + pending.manifestFileId + ' | ' + (error && error.message ? error.message : error));
    return {registered:false, error:String(error && error.message ? error.message : error)};
  }
}

function retryPendingQboNativeCdcIngestionRegistration() {
  const queue = qboNativeCdcReadIngestionHandoffQueue_();
  if (!queue.length) {
    const empty = {action:'NO_PENDING_HANDOFF'};
    console.log('[NATIVE CDC PROD] | INGESTION HANDOFF | ' + JSON.stringify(empty));
    return empty;
  }
  const pending = queue[0];
  const result = registerQboNativeCdcManifestForIngestion_(pending.manifestFileId);
  qboNativeCdcRemoveIngestionHandoff_(pending);
  const remaining = qboNativeCdcReadIngestionHandoffQueue_().length;
  const out = {action:'REGISTERED', cycleId:pending.cycleId, manifestFileId:pending.manifestFileId, registered:result.registered, alreadyRegistered:result.alreadyRegistered, remainingPending:remaining};
  console.log('[NATIVE CDC PROD] | INGESTION HANDOFF | ' + JSON.stringify(out));
  return out;
}

function qboNativeCdcEnqueueIngestionHandoff_(pending) {
  qboNativeCdcWithControlLock_(function() {
    const queue = qboNativeCdcReadIngestionHandoffQueue_();
    const found = queue.some(function(item) { return item.cycleId === pending.cycleId && item.manifestFileId === pending.manifestFileId; });
    if (!found) queue.push(pending);
    PropertiesService.getScriptProperties().setProperty(QBO_NATIVE_CDC_PRODUCTION.INGESTION_HANDOFF_PROPERTY_KEY, JSON.stringify(queue));
  });
}

function qboNativeCdcRemoveIngestionHandoff_(pending) {
  qboNativeCdcWithControlLock_(function() {
    const queue = qboNativeCdcReadIngestionHandoffQueue_().filter(function(item) {
      return !(item.cycleId === pending.cycleId && item.manifestFileId === pending.manifestFileId);
    });
    const props = PropertiesService.getScriptProperties();
    if (queue.length) props.setProperty(QBO_NATIVE_CDC_PRODUCTION.INGESTION_HANDOFF_PROPERTY_KEY, JSON.stringify(queue));
    else props.deleteProperty(QBO_NATIVE_CDC_PRODUCTION.INGESTION_HANDOFF_PROPERTY_KEY);
  });
}

function qboNativeCdcReadIngestionHandoffQueue_() {
  const raw = PropertiesService.getScriptProperties().getProperty(QBO_NATIVE_CDC_PRODUCTION.INGESTION_HANDOFF_PROPERTY_KEY);
  if (!raw) return [];
  let queue;
  try { queue = JSON.parse(raw); }
  catch (error) { throw new Error('NATIVE_CDC_PENDING_INGESTION_HANDOFF_INVALID_JSON'); }
  if (!Array.isArray(queue)) throw new Error('NATIVE_CDC_PENDING_INGESTION_HANDOFF_INVALID_SCHEMA');
  queue.forEach(function(item) {
    if (!item || !item.manifestFileId || !item.cycleId) throw new Error('NATIVE_CDC_PENDING_INGESTION_HANDOFF_INCOMPLETE');
  });
  return queue;
}

function qboNativeCdcRecordWorkerError_(workerId, error) {
  const message = error && error.message ? error.message : String(error);
  let errored = null;
  qboNativeCdcWithControlLock_(function() {
    const state = qboNativeCdcReadState_();
    if (!state || state.workerLeaseOwner !== workerId) return;
    const entityName = state.currentEntity || '';
    const attemptsKey = QBO_NATIVE_CDC_PRODUCTION.ENTITY_META_PREFIX + 'ATTEMPTS__' + state.cycleId + '__' + entityName;
    const props = PropertiesService.getScriptProperties();
    const attempts = Number(props.getProperty(attemptsKey) || 0) + 1;
    props.setProperty(attemptsKey, String(attempts));
    state.lastError = message; state.lastHeartbeatAt = new Date().toISOString(); state.lastHeartbeatAtMs = Date.now();
    if (attempts >= QBO_NATIVE_CDC_PRODUCTION.MAX_ENTITY_ATTEMPTS) {
      state.status = 'FAILED'; state.failedEntity = entityName; state.failedEntityAttempts = attempts; state.completedAt = new Date().toISOString();
    }
    qboNativeCdcWriteState_(state);
    errored = Object.assign({}, state);
  });
  if (errored) qboNativeCdcWriteManifest_(errored);
  console.error('[NATIVE CDC PROD] | WORKER ERROR | ' + message);
}
function qboNativeCdcAcquireEntityLease_(entityName, workerId, cycleId) {
  qboNativeCdcWithControlLock_(function() {
    const props = PropertiesService.getScriptProperties();
    const key = qboNativeCdcEntityLeaseKey_(entityName); const now = Date.now();
    let lease = null; try { lease = JSON.parse(props.getProperty(key) || 'null'); } catch (ignore) {}
    if (lease && Number(lease.expiresAtMs || 0) > now && (lease.workerId !== workerId || lease.cycleId !== cycleId)) throw new Error('Native CDC entity lease busy for ' + entityName + '.');
    props.setProperty(key, JSON.stringify({entity: entityName, workerId: workerId, cycleId: cycleId, acquiredAt: new Date(now).toISOString(), expiresAtMs: now + QBO_NATIVE_CDC_PRODUCTION.ENTITY_LEASE_MS}));
  });
}

function qboNativeCdcReleaseEntityLease_(entityName, workerId, cycleId) {
  qboNativeCdcWithControlLock_(function() {
    const props = PropertiesService.getScriptProperties(); const key = qboNativeCdcEntityLeaseKey_(entityName);
    let lease = null; try { lease = JSON.parse(props.getProperty(key) || 'null'); } catch (ignore) {}
    if (lease && lease.workerId === workerId && lease.cycleId === cycleId) props.deleteProperty(key);
  });
}

function qboNativeCdcScheduleIfNeeded_() {
  qboNativeCdcWithControlLock_(function() {
    if (qboNativeCdcIsPaused_()) {
      qboNativeCdcDeleteTriggersByHandlerLocked_(QBO_NATIVE_CDC_PRODUCTION.TRIGGER_HANDLERS.NEXT);
      return;
    }
    const state = qboNativeCdcReadState_();
    if (state && state.status === 'RUNNING') qboNativeCdcEnsureContinuationTriggerLocked_();
    else qboNativeCdcDeleteTriggersByHandlerLocked_(QBO_NATIVE_CDC_PRODUCTION.TRIGGER_HANDLERS.NEXT);
  });
}

function qboNativeCdcEnsureContinuationTriggerLocked_() {
  if (qboNativeCdcIsPaused_()) return;
  const handler = QBO_NATIVE_CDC_PRODUCTION.TRIGGER_HANDLERS.NEXT;
  const found = ScriptApp.getProjectTriggers().some(function(trigger) { return trigger.getHandlerFunction() === handler; });
  if (found) return;
  ScriptApp.newTrigger(handler).timeBased().after(QBO_NATIVE_CDC_PRODUCTION.CONTINUATION_DELAY_MS).create();
  console.log('[NATIVE CDC PROD] | CONTINUATION SCHEDULED | afterMs=' + QBO_NATIVE_CDC_PRODUCTION.CONTINUATION_DELAY_MS);
}

function qboNativeCdcIsPaused_() {
  return String(PropertiesService.getScriptProperties().getProperty(QBO_NATIVE_CDC_PRODUCTION.PAUSE_PROPERTY_KEY) || '').toLowerCase() === 'true';
}

function qboNativeCdcDeleteManagedTriggers_() {
  qboNativeCdcDeleteTriggersByHandlerLocked_(QBO_NATIVE_CDC_PRODUCTION.TRIGGER_HANDLERS.START);
  qboNativeCdcDeleteTriggersByHandlerLocked_(QBO_NATIVE_CDC_PRODUCTION.TRIGGER_HANDLERS.NEXT);
}

function qboNativeCdcDeleteTriggersByHandlerLocked_(handler) {
  ScriptApp.getProjectTriggers().forEach(function(trigger) { if (trigger.getHandlerFunction() === handler) ScriptApp.deleteTrigger(trigger); });
}

function qboNativeCdcWriteManifest_(state) {
  const runFolder = DriveApp.getFolderById(state.runFolderId);
  const entityEvidence = []; let returnedEntityCount = 0; let liveEntityCount = 0; let deletedEntityCount = 0;
  QBO_NATIVE_CDC_PRODUCTION.ENTITIES.forEach(function(entityName) {
    const meta = qboNativeCdcReadEntityMeta_(state.cycleId, entityName);
    if (!meta || meta.status !== 'SUCCESS') return;
    entityEvidence.push(meta); returnedEntityCount += Number(meta.returnedEntityCount || 0); liveEntityCount += Number(meta.liveEntityCount || 0); deletedEntityCount += Number(meta.deletedEntityCount || 0);
  });
  const manifest = {
    version: state.version, schemaVersion: state.schemaVersion, cycleId: state.cycleId,
    status: state.status, runStartedAt: state.startedAt, runCompletedAt: state.completedAt || null,
    windowStart: state.windowStart, windowEnd: state.windowEnd, initialRun: state.initialRun,
    initialLookbackDays: state.initialRun ? QBO_NATIVE_CDC_PRODUCTION.INITIAL_LOOKBACK_DAYS : null,
    overlapMinutes: state.initialRun ? 0 : QBO_NATIVE_CDC_PRODUCTION.OVERLAP_MINUTES,
    priorSuccessfulWatermark: state.priorSuccessfulWatermark || null,
    entityTypesRequested: QBO_NATIVE_CDC_PRODUCTION.ENTITIES.slice(), completedEntityCount: Number(state.completedEntityCount || 0), currentEntity: state.currentEntity || null,
    returnedEntityCount: returnedEntityCount, liveEntityCount: liveEntityCount, deletedEntityCount: deletedEntityCount,
    source: 'QBO_NATIVE_CDC', sourceAcquisitionType: 'NATIVE_CDC', runFolderId: state.runFolderId, runFolderName: state.runFolderName,
    watermarkCommitted: !!state.watermarkCommitted, committedWatermark: state.committedWatermark || null,
    lastProgressAt: state.lastProgressAt, lastHeartbeatAt: state.lastHeartbeatAt, lastError: state.lastError || null,
    entityEvidence: entityEvidence
  };
  const json = JSON.stringify(manifest, null, 2);
  let file;
  if (state.manifestFileId) { file = DriveApp.getFileById(state.manifestFileId); file.setContent(json); }
  else {
    file = runFolder.createFile(QBO_NATIVE_CDC_PRODUCTION.MANIFEST_FILE_NAME, json, 'application/json');
    qboNativeCdcWithControlLock_(function() {
      const current = qboNativeCdcReadState_();
      if (!current || current.cycleId !== state.cycleId) throw new Error('Native CDC manifest publication refused because cycle state changed.');
      if (current.manifestFileId && current.manifestFileId !== file.getId()) throw new Error('Native CDC duplicate manifest publication detected for cycle ' + state.cycleId + '.');
      current.manifestFileId = file.getId();
      qboNativeCdcWriteState_(current);
      state.manifestFileId = file.getId();
    });
  }
  return file;
}

function qboNativeCdcBuildCycleId_(startedAt) {
  const bucketMs = QBO_NATIVE_CDC_PRODUCTION.CYCLE_MINUTES * 60 * 1000;
  const bucket = new Date(Math.floor(startedAt.getTime() / bucketMs) * bucketMs);
  return Utilities.formatDate(bucket, 'UTC', "yyyyMMdd'T'HHmm'Z'") + '|' + Utilities.getUuid();
}

function qboNativeCdcAssertWorkerOwner_(state, workerId) {
  if (!state || state.status !== 'RUNNING') throw new Error('Native CDC worker no longer owns an active RUNNING cycle.');
  if (state.workerLeaseOwner !== workerId) throw new Error('Native CDC worker lease ownership changed.');
  if (Number(state.workerLeaseExpiresAtMs || 0) <= Date.now()) throw new Error('Native CDC worker lease expired.');
}

function qboNativeCdcReadState_() {
  const raw = PropertiesService.getScriptProperties().getProperty(QBO_NATIVE_CDC_PRODUCTION.STATE_PROPERTY_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (error) { throw new Error('Invalid Native CDC cycle state JSON: ' + error.message); }
}

function qboNativeCdcWriteState_(state) { PropertiesService.getScriptProperties().setProperty(QBO_NATIVE_CDC_PRODUCTION.STATE_PROPERTY_KEY, JSON.stringify(state)); }
function qboNativeCdcWriteEntityMeta_(cycleId, entityName, meta) { PropertiesService.getScriptProperties().setProperty(qboNativeCdcEntityMetaKey_(cycleId, entityName), JSON.stringify(meta)); }
function qboNativeCdcReadEntityMeta_(cycleId, entityName) { const raw = PropertiesService.getScriptProperties().getProperty(qboNativeCdcEntityMetaKey_(cycleId, entityName)); if (!raw) return null; try { return JSON.parse(raw); } catch (ignore) { return null; } }
function qboNativeCdcEntityMetaKey_(cycleId, entityName) { return QBO_NATIVE_CDC_PRODUCTION.ENTITY_META_PREFIX + cycleId + '__' + entityName; }
function qboNativeCdcEntityLeaseKey_(entityName) { return QBO_NATIVE_CDC_PRODUCTION.ENTITY_LEASE_PREFIX + entityName; }

function qboNativeCdcWithControlLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(QBO_NATIVE_CDC_PRODUCTION.CONTROL_LOCK_TIMEOUT_MS)) throw new Error('Unable to acquire short Native CDC control lock within ' + QBO_NATIVE_CDC_PRODUCTION.CONTROL_LOCK_TIMEOUT_MS + ' ms.');
  try { return fn(); } finally { lock.releaseLock(); }
}

function qboNativeCdcBuildWindow_(startedAt) {
  const props = PropertiesService.getScriptProperties();
  const rawWatermark = String(props.getProperty(QBO_NATIVE_CDC_PRODUCTION.WATERMARK_PROPERTY_KEY) || '').trim();
  const end = new Date(startedAt.getTime());
  if (!rawWatermark) return {start: new Date(end.getTime() - QBO_NATIVE_CDC_PRODUCTION.INITIAL_LOOKBACK_DAYS * 86400000), end: end, initialRun: true, priorSuccessfulWatermark: null};
  const watermark = new Date(rawWatermark);
  if (isNaN(watermark.getTime())) throw new Error('Invalid durable Native CDC watermark in Script Property ' + QBO_NATIVE_CDC_PRODUCTION.WATERMARK_PROPERTY_KEY + ': ' + rawWatermark);
  if (watermark.getTime() > end.getTime()) throw new Error('Native CDC successful watermark is in the future: ' + rawWatermark);
  const start = new Date(watermark.getTime() - QBO_NATIVE_CDC_PRODUCTION.OVERLAP_MINUTES * 60000);
  const oldestAllowed = new Date(end.getTime() - QBO_NATIVE_CDC_PRODUCTION.MAX_CDC_LOOKBACK_DAYS * 86400000);
  if (start.getTime() < oldestAllowed.getTime()) throw new Error('Native CDC recovery window exceeds the configured ' + QBO_NATIVE_CDC_PRODUCTION.MAX_CDC_LOOKBACK_DAYS + '-day source limit. Last successful watermark=' + watermark.toISOString() + '. Do not advance the watermark manually; use the governed recovery process.');
  return {start: start, end: end, initialRun: false, priorSuccessfulWatermark: watermark.toISOString()};
}

function qboNativeCdcRequestEntity_(entityName, changedSince, minorVersion) {
  const path = 'cdc?entities=' + encodeURIComponent(entityName) + '&changedSince=' + encodeURIComponent(changedSince.toISOString()) + '&minorversion=' + encodeURIComponent(String(minorVersion));
  return qboGet_(path);
}

function qboNativeCdcProductionExtractEntities_(response, entityName) {
  const output = [];
  const cdcResponses = Array.isArray(response && response.CDCResponse) ? response.CDCResponse : (response && response.CDCResponse ? [response.CDCResponse] : []);
  cdcResponses.forEach(function(cdcResponse) {
    const queryResponses = Array.isArray(cdcResponse && cdcResponse.QueryResponse) ? cdcResponse.QueryResponse : (cdcResponse && cdcResponse.QueryResponse ? [cdcResponse.QueryResponse] : []);
    queryResponses.forEach(function(queryResponse) {
      const raw = queryResponse && queryResponse[entityName]; const entities = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      entities.forEach(function(entity) { if (entity && typeof entity === 'object') output.push(entity); });
    });
  });
  return output;
}

function qboNativeCdcResolveEvidenceFolder_() {
  if (typeof DataPlatform05 === 'undefined' || typeof DataPlatform05.getConfiguredAssetReference !== 'function') throw new Error('Application 05 library DataPlatform05 is unavailable. Cannot resolve governed asset ' + QBO_NATIVE_CDC_PRODUCTION.EVIDENCE_FOLDER_ASSET_KEY + '.');
  const asset = DataPlatform05.getConfiguredAssetReference(QBO_NATIVE_CDC_PRODUCTION.EVIDENCE_FOLDER_ASSET_KEY, QBO_NATIVE_CDC_PRODUCTION.EVIDENCE_FOLDER_EXPECTED_TYPE, QBO_NATIVE_CDC_PRODUCTION.ENVIRONMENT);
  const folderId = asset && String(asset.ResourceIdentifier || '').trim();
  if (!folderId) throw new Error('Application 05 returned no ResourceIdentifier for governed asset ' + QBO_NATIVE_CDC_PRODUCTION.EVIDENCE_FOLDER_ASSET_KEY + '.');
  try { return DriveApp.getFolderById(folderId); } catch (error) { throw new Error('Unable to open governed Native CDC evidence folder ' + folderId + ': ' + (error && error.message ? error.message : String(error))); }
}

function qboNativeCdcResolveRunParentFolder_(startedAt) {
  const root = qboNativeCdcResolveEvidenceFolder_();
  if (!QBO_NATIVE_CDC_PRODUCTION.DATE_PARTITION_NEW_EVIDENCE) return root;
  const started = startedAt instanceof Date ? startedAt : new Date(startedAt);
  if (isNaN(started.getTime())) throw new Error('NATIVE_CDC_INVALID_RUN_PARTITION_DATE');
  const year = Utilities.formatDate(started, 'UTC', 'yyyy');
  const month = Utilities.formatDate(started, 'UTC', 'MM');
  const day = Utilities.formatDate(started, 'UTC', 'dd');
  return qboNativeCdcGetOrCreateSingleChildFolder_(qboNativeCdcGetOrCreateSingleChildFolder_(qboNativeCdcGetOrCreateSingleChildFolder_(root, year), month), day);
}

function qboNativeCdcGetOrCreateSingleChildFolder_(parent, name) {
  const matches = parent.getFoldersByName(name);
  if (matches.hasNext()) {
    const folder = matches.next();
    if (matches.hasNext()) throw new Error('NATIVE_CDC_DUPLICATE_PARTITION_FOLDER parentId=' + parent.getId() + ' name=' + name);
    return folder;
  }
  return parent.createFolder(name);
}

function qboNativeCdcSha256_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function(value) { const unsigned = value < 0 ? value + 256 : value; return ('0' + unsigned.toString(16)).slice(-2); }).join('');
}
