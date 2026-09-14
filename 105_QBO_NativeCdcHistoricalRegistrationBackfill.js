/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 105_QBO_NativeCdcHistoricalRegistrationBackfill.js
 * Version     : 1.5.67
 * Purpose     : One-time discovery and registration of historical Native CDC
 *               acquisition evidence into 05_Forward_Ingestion_Control.
 *
 * Locked controls:
 *   - Discovers both legacy flat and UTC YYYY/MM/DD Native CDC layouts.
 *   - Never moves, renames, or rewrites acquisition evidence.
 *   - Freezes the candidate manifest list at startup for deterministic resume.
 *   - Registration is idempotent by NATIVE_CDC|<CycleId>|<EntityType>.
 *   - Historical non-delete observations MUST normalize completely from the
 *     captured CDC entity object. Current targeted QBO fetch is forbidden as
 *     historical reconstruction evidence.
 *   - Unsafe/incomplete historical sources are registered BLOCKED with explicit
 *     evidence exceptions; they are never handed to the normal dispatcher.
 *   - State Application remains disabled.
 * ============================================================================
 */

const QBO_NATIVE_CDC_HISTORICAL_REGISTRATION_ = Object.freeze({
  VERSION: 'QBO_NATIVE_CDC_HISTORICAL_REGISTRATION_V1',
  STATE_PROPERTY_KEY: 'QBO_NATIVE_CDC_HISTORICAL_REGISTRATION_STATE_V1',
  LEASE_PROPERTY_KEY: 'QBO_NATIVE_CDC_HISTORICAL_REGISTRATION_LEASE_V1',
  CONTINUATION_HANDLER: 'runNextQboNativeCdcHistoricalRegistrationBackfill',
  WORKER_RUNTIME_BUDGET_MS: 210000,
  MIN_SAFE_NEW_WORK_MS: 30000,
  LEASE_MS: 6 * 60 * 1000,
  CONTINUATION_DELAY_MS: 60 * 1000
});

function testQboNativeCdcHistoricalRegistrationReadiness() {
  const control = provisionQboForwardIngestionControl();
  const forward = testQboNativeCdcForwardIngestionReadiness();
  const result = {
    ready: !!(control.ready && forward.ready),
    version: QBO_NATIVE_CDC_HISTORICAL_REGISTRATION_.VERSION,
    discoversLegacyFlatLayout: true,
    discoversUtcDatePartitionedLayout: true,
    freezesCandidateManifestList: true,
    historicalCurrentFetchForbidden: true,
    incompleteHistoricalEvidenceRegisteredBlocked: true,
    existingLedgerRowsRemainAuthoritative: true,
    stateApplicationWritesEnabled: false
  };
  console.log('[NATIVE CDC HIST REG] | READY | ' + JSON.stringify(result));
  return result;
}

/** Discovery-only preview. No control rows or durable backfill state are written. */
function previewQboNativeCdcHistoricalRegistrationBackfill() {
  const discovery = qboNativeCdcHistoricalDiscoverCandidates_();
  const result = {
    version: QBO_NATIVE_CDC_HISTORICAL_REGISTRATION_.VERSION,
    committedCycleCount: discovery.committedCycleCount,
    alreadyFullyRegisteredCycleCount: discovery.alreadyFullyRegisteredCycleCount,
    candidateCycleCount: discovery.candidates.length,
    candidateSourceUnitCount: discovery.candidates.length * QBO_NATIVE_CDC_PRODUCTION.ENTITIES.length,
    firstCandidate: discovery.candidates.length ? discovery.candidates[0] : null,
    lastCandidate: discovery.candidates.length ? discovery.candidates[discovery.candidates.length - 1] : null,
    sampleCycleIds: discovery.candidates.slice(0, 10).map(function(row) { return row.cycleId; }),
    mutatesEvidence: false,
    mutatesLedger: false
  };
  console.log('[NATIVE CDC HIST REG] | PREVIEW | ' + JSON.stringify(result));
  return result;
}

function startQboNativeCdcHistoricalRegistrationBackfill() {
  const existing = qboNativeCdcHistoricalReadState_();
  if (existing && existing.status === 'RUNNING') {
    throw new Error('NATIVE_CDC_HIST_REG_ALREADY_RUNNING runId=' + existing.runId);
  }
  const discovery = qboNativeCdcHistoricalDiscoverCandidates_();
  const now = new Date();
  const state = {
    version: QBO_NATIVE_CDC_HISTORICAL_REGISTRATION_.VERSION,
    runId: 'NATIVE_CDC_HIST_REG|' + Utilities.getUuid(),
    status: discovery.candidates.length ? 'RUNNING' : 'SUCCESS',
    paused: false,
    startedAt: now.toISOString(),
    completedAt: discovery.candidates.length ? '' : now.toISOString(),
    lastHeartbeatAt: now.toISOString(),
    lastProgressAt: '',
    manifestIndex: 0,
    manifestCount: discovery.candidates.length,
    manifests: discovery.candidates,
    registeredSourceUnitCount: 0,
    alreadyRegisteredSourceUnitCount: 0,
    blockedSourceUnitCount: 0,
    safeSourceUnitCount: 0,
    completedCycleCount: 0,
    lastCycleId: '',
    lastError: ''
  };
  qboNativeCdcHistoricalWriteState_(state);
  qboNativeCdcHistoricalRemoveContinuationTriggers_();
  console.log('[NATIVE CDC HIST REG] | STARTED | ' + JSON.stringify(qboNativeCdcHistoricalStatusView_(state)));
  if (state.status === 'RUNNING') return runNextQboNativeCdcHistoricalRegistrationBackfill();
  return qboNativeCdcHistoricalStatusView_(state);
}

function runNextQboNativeCdcHistoricalRegistrationBackfill() {
  const workerId = Utilities.getUuid();
  if (!qboNativeCdcHistoricalClaimLease_(workerId)) {
    const skipped = {action:'ALREADY_ACTIVE', workerId:workerId};
    console.log('[NATIVE CDC HIST REG] | WORKER SKIPPED | ' + JSON.stringify(skipped));
    return skipped;
  }
  const startedMs = Date.now();
  try {
    let state = qboNativeCdcHistoricalReadState_();
    if (!state) throw new Error('NATIVE_CDC_HIST_REG_STATE_NOT_FOUND');
    if (state.paused === true) return qboNativeCdcHistoricalStatusView_(state);
    if (state.status !== 'RUNNING') return qboNativeCdcHistoricalStatusView_(state);

    while (state.manifestIndex < state.manifestCount) {
      const elapsed = Date.now() - startedMs;
      const remaining = QBO_NATIVE_CDC_HISTORICAL_REGISTRATION_.WORKER_RUNTIME_BUDGET_MS - elapsed;
      if (state.completedCycleCount > 0 && remaining < QBO_NATIVE_CDC_HISTORICAL_REGISTRATION_.MIN_SAFE_NEW_WORK_MS) break;

      const manifestRef = state.manifests[state.manifestIndex];
      const cycleResult = qboNativeCdcHistoricalRegisterManifest_(manifestRef);
      state.manifestIndex += 1;
      state.completedCycleCount += 1;
      state.registeredSourceUnitCount += Number(cycleResult.registered || 0);
      state.alreadyRegisteredSourceUnitCount += Number(cycleResult.alreadyRegistered || 0);
      state.blockedSourceUnitCount += Number(cycleResult.blocked || 0);
      state.safeSourceUnitCount += Number(cycleResult.safe || 0);
      state.lastCycleId = cycleResult.cycleId;
      state.lastProgressAt = new Date().toISOString();
      state.lastHeartbeatAt = state.lastProgressAt;
      state.lastError = '';
      qboNativeCdcHistoricalWriteState_(state);
      qboNativeCdcHistoricalHeartbeatLease_(workerId);
      console.log('[NATIVE CDC HIST REG] | CYCLE COMPLETE | ' + JSON.stringify(cycleResult));
    }

    if (state.manifestIndex >= state.manifestCount) {
      state.status = 'SUCCESS';
      state.completedAt = new Date().toISOString();
      state.lastHeartbeatAt = state.completedAt;
      qboNativeCdcHistoricalWriteState_(state);
      qboNativeCdcHistoricalRemoveContinuationTriggers_();
      console.log('[NATIVE CDC HIST REG] | COMPLETE | ' + JSON.stringify(qboNativeCdcHistoricalStatusView_(state)));
    } else {
      state.lastHeartbeatAt = new Date().toISOString();
      qboNativeCdcHistoricalWriteState_(state);
      qboNativeCdcHistoricalScheduleContinuation_();
      console.log('[NATIVE CDC HIST REG] | CHECKPOINT | ' + JSON.stringify(qboNativeCdcHistoricalStatusView_(state)));
    }
    return qboNativeCdcHistoricalStatusView_(state);
  } catch (error) {
    const state = qboNativeCdcHistoricalReadState_() || {};
    state.status = 'ERROR';
    state.lastError = String(error && error.message ? error.message : error);
    state.lastHeartbeatAt = new Date().toISOString();
    qboNativeCdcHistoricalWriteState_(state);
    qboNativeCdcHistoricalRemoveContinuationTriggers_();
    console.error('[NATIVE CDC HIST REG] | ERROR | ' + state.lastError);
    throw error;
  } finally {
    qboNativeCdcHistoricalReleaseLease_(workerId);
  }
}

function listQboNativeCdcHistoricalRegistrationStatus() {
  const state = qboNativeCdcHistoricalReadState_();
  const result = state ? qboNativeCdcHistoricalStatusView_(state) : {status:'NOT_STARTED', version:QBO_NATIVE_CDC_HISTORICAL_REGISTRATION_.VERSION};
  console.log('[NATIVE CDC HIST REG] | STATUS | ' + JSON.stringify(result));
  return result;
}

function pauseQboNativeCdcHistoricalRegistrationBackfill() {
  const state = qboNativeCdcHistoricalReadState_();
  if (!state || state.status !== 'RUNNING') return listQboNativeCdcHistoricalRegistrationStatus();
  state.paused = true;
  state.lastHeartbeatAt = new Date().toISOString();
  qboNativeCdcHistoricalWriteState_(state);
  qboNativeCdcHistoricalRemoveContinuationTriggers_();
  console.log('[NATIVE CDC HIST REG] | PAUSED | ' + JSON.stringify(qboNativeCdcHistoricalStatusView_(state)));
  return qboNativeCdcHistoricalStatusView_(state);
}

function resumeQboNativeCdcHistoricalRegistrationBackfill() {
  const state = qboNativeCdcHistoricalReadState_();
  if (!state) throw new Error('NATIVE_CDC_HIST_REG_STATE_NOT_FOUND');
  if (state.status === 'SUCCESS') return qboNativeCdcHistoricalStatusView_(state);
  state.status = 'RUNNING';
  state.paused = false;
  state.lastError = '';
  state.lastHeartbeatAt = new Date().toISOString();
  qboNativeCdcHistoricalWriteState_(state);
  qboNativeCdcHistoricalRemoveContinuationTriggers_();
  qboNativeCdcHistoricalScheduleContinuation_();
  console.log('[NATIVE CDC HIST REG] | RESUMED | ' + JSON.stringify(qboNativeCdcHistoricalStatusView_(state)));
  return qboNativeCdcHistoricalStatusView_(state);
}

function qboNativeCdcHistoricalDiscoverCandidates_() {
  const root = qboNativeCdcResolveEvidenceFolder_();
  const folders = qboNativeCdcListRunFoldersForDiscovery_(root);
  const controlSheet = qboForwardIngestionEnsureSheet_();
  const existingRows = qboForwardIngestionReadRows_(controlSheet);
  const existingIds = Object.create(null);
  existingRows.forEach(function(row) { existingIds[String(row.IngestionSourceId || '')] = true; });
  const candidates = [];
  let committedCycleCount = 0;
  let alreadyFullyRegisteredCycleCount = 0;

  folders.forEach(function(folder) {
    const files = folder.getFilesByName(QBO_NATIVE_CDC_PRODUCTION.MANIFEST_FILE_NAME);
    if (!files.hasNext()) return;
    const manifestFile = files.next();
    if (files.hasNext()) throw new Error('NATIVE_CDC_HIST_REG_DUPLICATE_MANIFEST folderId=' + folder.getId());
    let manifest;
    try { manifest = JSON.parse(manifestFile.getBlob().getDataAsString('UTF-8')); }
    catch (ignore) { return; }
    const cycleId = String(manifest.cycleId || '').trim();
    if (!cycleId || String(manifest.status || '') !== 'SUCCESS' || manifest.watermarkCommitted !== true) return;
    const evidence = Array.isArray(manifest.entityEvidence) ? manifest.entityEvidence : [];
    if (evidence.length !== QBO_NATIVE_CDC_PRODUCTION.ENTITIES.length) return;
    committedCycleCount += 1;
    let missing = 0;
    evidence.forEach(function(entityEvidence) {
      const entityType = String(entityEvidence.entity || '').trim();
      const sourceId = 'NATIVE_CDC|' + cycleId + '|' + entityType;
      if (!existingIds[sourceId]) missing += 1;
    });
    if (missing === 0) {
      alreadyFullyRegisteredCycleCount += 1;
      return;
    }
    candidates.push({
      cycleId:cycleId,
      manifestFileId:manifestFile.getId(),
      runFolderId:folder.getId(),
      runStartedAt:String(manifest.runStartedAt || ''),
      runCompletedAt:String(manifest.runCompletedAt || ''),
      returnedEntityCount:Number(manifest.returnedEntityCount || 0),
      unregisteredSourceUnitCount:missing
    });
  });
  candidates.sort(function(a, b) {
    const at = Date.parse(a.runStartedAt || '') || 0;
    const bt = Date.parse(b.runStartedAt || '') || 0;
    if (at !== bt) return at - bt;
    return a.cycleId.localeCompare(b.cycleId);
  });
  return {committedCycleCount:committedCycleCount, alreadyFullyRegisteredCycleCount:alreadyFullyRegisteredCycleCount, candidates:candidates};
}

function qboNativeCdcHistoricalRegisterManifest_(manifestRef) {
  const file = DriveApp.getFileById(String(manifestRef.manifestFileId || ''));
  let manifest;
  try { manifest = JSON.parse(file.getBlob().getDataAsString('UTF-8')); }
  catch (error) { throw new Error('NATIVE_CDC_HIST_REG_MANIFEST_INVALID_JSON fileId=' + manifestRef.manifestFileId); }
  const cycleId = String(manifest.cycleId || '').trim();
  if (cycleId !== String(manifestRef.cycleId || '')) throw new Error('NATIVE_CDC_HIST_REG_CYCLE_ID_MISMATCH');
  if (String(manifest.status || '') !== 'SUCCESS' || manifest.watermarkCommitted !== true) throw new Error('NATIVE_CDC_HIST_REG_MANIFEST_NOT_COMMITTED cycle=' + cycleId);
  const evidence = Array.isArray(manifest.entityEvidence) ? manifest.entityEvidence : [];
  if (evidence.length !== QBO_NATIVE_CDC_PRODUCTION.ENTITIES.length) throw new Error('NATIVE_CDC_HIST_REG_ENTITY_COUNT_MISMATCH cycle=' + cycleId);

  const registrationTime = new Date();
  const controlSheet = qboForwardIngestionEnsureSheet_();
  let registered = 0, alreadyRegistered = 0, blocked = 0, safe = 0;
  evidence.forEach(function(entityEvidence) {
    const entityType = String(entityEvidence.entity || '').trim();
    const sourceId = 'NATIVE_CDC|' + cycleId + '|' + entityType;
    if (qboForwardIngestionFindBySourceId_(controlSheet, sourceId)) {
      alreadyRegistered += 1;
      return;
    }
    const preflight = qboNativeCdcHistoricalPreflightEvidence_(entityEvidence, entityType);
    const result = qboForwardIngestionRegisterSource_({
      ingestionSourceId:sourceId,
      sourceType:QBO_NATIVE_CDC_FORWARD_INGESTION_.SOURCE_TYPE,
      sourceRunId:cycleId,
      sourceUnitId:cycleId + '|' + entityType,
      entityType:entityType,
      evidenceFileId:String(entityEvidence.evidenceFileId || ''),
      evidenceFileName:String(entityEvidence.evidenceFileName || ''),
      evidenceHash:String(entityEvidence.payloadSha256 || ''),
      evidenceHashType:'SHA-256',
      observedAt:String(entityEvidence.requestCompletedAt || manifest.runCompletedAt || ''),
      sourceWindowStart:String(manifest.windowStart || ''),
      sourceWindowEnd:String(manifest.windowEnd || ''),
      sourceResponseTime:String(entityEvidence.qboResponseTime || ''),
      requestStartedAt:String(entityEvidence.requestStartedAt || ''),
      requestCompletedAt:String(entityEvidence.requestCompletedAt || ''),
      sourceStatus:'SUCCESS',
      observationCount:Number(entityEvidence.returnedEntityCount || 0),
      processingStatus:preflight.safe ? QBO_FORWARD_INGESTION_CONTROL_.STATUS_AVAILABLE : QBO_FORWARD_INGESTION_CONTROL_.STATUS_BLOCKED,
      processingError:preflight.safe ? '' : preflight.reason,
      registeredAt:registrationTime
    });
    if (result.registered) registered += 1; else alreadyRegistered += 1;
    if (preflight.safe) safe += 1; else blocked += 1;
  });
  return {cycleId:cycleId, registered:registered, alreadyRegistered:alreadyRegistered, safe:safe, blocked:blocked, registeredAt:registrationTime.toISOString()};
}

function qboNativeCdcHistoricalPreflightEvidence_(entityEvidence, entityType) {
  if (!qboSourceAdapterDefinition_(entityType)) return {safe:false, reason:'HISTORICAL_CDC_UNSUPPORTED_ENTITY_TYPE ' + entityType};
  if (String(entityEvidence.status || '') !== 'SUCCESS') return {safe:false, reason:'HISTORICAL_CDC_ENTITY_EVIDENCE_NOT_SUCCESS'};
  const fileId = String(entityEvidence.evidenceFileId || '').trim();
  if (!fileId) return {safe:false, reason:'HISTORICAL_CDC_EVIDENCE_FILE_ID_MISSING'};
  let file, text;
  try {
    file = DriveApp.getFileById(fileId);
    text = file.getBlob().getDataAsString('UTF-8');
  } catch (error) {
    return {safe:false, reason:'HISTORICAL_CDC_EVIDENCE_FILE_UNREADABLE fileId=' + fileId};
  }
  if (entityEvidence.evidenceFileName && file.getName() !== String(entityEvidence.evidenceFileName)) {
    return {safe:false, reason:'HISTORICAL_CDC_EVIDENCE_NAME_MISMATCH'};
  }
  const expectedHash = String(entityEvidence.payloadSha256 || '');
  if (expectedHash && qboStateCaptureAuditSha256_(text) !== expectedHash) return {safe:false, reason:'HISTORICAL_CDC_EVIDENCE_HASH_MISMATCH'};
  let envelope;
  try { envelope = JSON.parse(text); }
  catch (error) { return {safe:false, reason:'HISTORICAL_CDC_EVIDENCE_INVALID_JSON'}; }
  const entities = qboSourceAdapterExtractNativeCdcEntities_(envelope, entityType);
  const expectedCount = Number(entityEvidence.returnedEntityCount || 0);
  if (entities.length !== expectedCount) return {safe:false, reason:'HISTORICAL_CDC_OBSERVATION_COUNT_MISMATCH expected=' + expectedCount + ' actual=' + entities.length};

  const incomplete = [];
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    const entityId = String(entity && entity.Id || '').trim();
    if (!entityId) {
      incomplete.push('index=' + i + ':MISSING_ENTITY_ID');
      continue;
    }
    if (String(entity.status || '').toLowerCase() === 'deleted') continue;
    const assessment = qboSourceAdapterAssessRawEntityCompleteness_(entityType, entity);
    if (!assessment.complete) incomplete.push(entityId + ':' + assessment.reason);
  }
  if (incomplete.length) {
    return {safe:false, reason:'HISTORICAL_CDC_RAW_ENTITY_INCOMPLETE_NO_CURRENT_FETCH ' + incomplete.slice(0, 10).join(';')};
  }
  return {safe:true, reason:'CAPTURED_CDC_ENTITY_EVIDENCE_COMPLETE', observationCount:entities.length};
}

function qboNativeCdcHistoricalReadState_() {
  const raw = PropertiesService.getScriptProperties().getProperty(QBO_NATIVE_CDC_HISTORICAL_REGISTRATION_.STATE_PROPERTY_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch (error) { throw new Error('NATIVE_CDC_HIST_REG_STATE_INVALID_JSON'); }
}

function qboNativeCdcHistoricalWriteState_(state) {
  PropertiesService.getScriptProperties().setProperty(QBO_NATIVE_CDC_HISTORICAL_REGISTRATION_.STATE_PROPERTY_KEY, JSON.stringify(state));
}

function qboNativeCdcHistoricalStatusView_(state) {
  return {
    version:state.version || QBO_NATIVE_CDC_HISTORICAL_REGISTRATION_.VERSION,
    runId:state.runId || '', status:state.status || '', paused:state.paused === true,
    manifestIndex:Number(state.manifestIndex || 0), manifestCount:Number(state.manifestCount || 0),
    completedCycleCount:Number(state.completedCycleCount || 0),
    registeredSourceUnitCount:Number(state.registeredSourceUnitCount || 0),
    alreadyRegisteredSourceUnitCount:Number(state.alreadyRegisteredSourceUnitCount || 0),
    safeSourceUnitCount:Number(state.safeSourceUnitCount || 0), blockedSourceUnitCount:Number(state.blockedSourceUnitCount || 0),
    lastCycleId:state.lastCycleId || '', startedAt:state.startedAt || '', completedAt:state.completedAt || '',
    lastHeartbeatAt:state.lastHeartbeatAt || '', lastProgressAt:state.lastProgressAt || '', lastError:state.lastError || ''
  };
}

function qboNativeCdcHistoricalClaimLease_(workerId) {
  return qboForwardIngestionWithLock_(function() {
    const props = PropertiesService.getScriptProperties();
    const key = QBO_NATIVE_CDC_HISTORICAL_REGISTRATION_.LEASE_PROPERTY_KEY;
    const now = Date.now();
    let lease = null;
    try { lease = JSON.parse(props.getProperty(key) || 'null'); } catch (ignore) {}
    if (lease && Number(lease.expiresAtMs || 0) > now && lease.workerId !== workerId) return false;
    props.setProperty(key, JSON.stringify({workerId:workerId, acquiredAt:new Date(now).toISOString(), expiresAtMs:now + QBO_NATIVE_CDC_HISTORICAL_REGISTRATION_.LEASE_MS}));
    return true;
  });
}

function qboNativeCdcHistoricalHeartbeatLease_(workerId) {
  qboForwardIngestionWithLock_(function() {
    const props = PropertiesService.getScriptProperties();
    const key = QBO_NATIVE_CDC_HISTORICAL_REGISTRATION_.LEASE_PROPERTY_KEY;
    let lease = null;
    try { lease = JSON.parse(props.getProperty(key) || 'null'); } catch (ignore) {}
    if (!lease || lease.workerId !== workerId) throw new Error('NATIVE_CDC_HIST_REG_LEASE_MISMATCH');
    lease.expiresAtMs = Date.now() + QBO_NATIVE_CDC_HISTORICAL_REGISTRATION_.LEASE_MS;
    lease.lastHeartbeatAt = new Date().toISOString();
    props.setProperty(key, JSON.stringify(lease));
  });
}

function qboNativeCdcHistoricalReleaseLease_(workerId) {
  qboForwardIngestionWithLock_(function() {
    const props = PropertiesService.getScriptProperties();
    const key = QBO_NATIVE_CDC_HISTORICAL_REGISTRATION_.LEASE_PROPERTY_KEY;
    let lease = null;
    try { lease = JSON.parse(props.getProperty(key) || 'null'); } catch (ignore) {}
    if (lease && lease.workerId === workerId) props.deleteProperty(key);
  });
}

function qboNativeCdcHistoricalRemoveContinuationTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === QBO_NATIVE_CDC_HISTORICAL_REGISTRATION_.CONTINUATION_HANDLER) ScriptApp.deleteTrigger(trigger);
  });
}

function qboNativeCdcHistoricalScheduleContinuation_() {
  qboNativeCdcHistoricalRemoveContinuationTriggers_();
  ScriptApp.newTrigger(QBO_NATIVE_CDC_HISTORICAL_REGISTRATION_.CONTINUATION_HANDLER)
    .timeBased().after(QBO_NATIVE_CDC_HISTORICAL_REGISTRATION_.CONTINUATION_DELAY_MS).create();
}
