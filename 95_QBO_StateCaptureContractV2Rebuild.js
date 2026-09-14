/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 95_QBO_StateCaptureContractV2Rebuild.js
 * Purpose     : Controlled, versioned rebuild/replay of canonical State Capture
 *               history under QBO_CANONICAL_STATE_V2.
 *
 * Safety contract:
 *   - Never deletes or rewrites QBO_CANONICAL_STATE_V1 history.
 *   - Writes only V2 snapshot/change/detail rows with versioned deterministic IDs.
 *   - Processes sources oldest-to-newest and checkpoints after each source.
 *   - Re-entry is idempotent: deterministic IDs plus source reconciliation make
 *     interrupted execution safe to resume.
 *   - RawJSON is evidence only and may be incomplete without blocking V2 state.
 * ============================================================================
 */

const QBO_CANONICAL_V2_REBUILD_ = Object.freeze({
  HANDLER: 'runNextQboCanonicalV2Rebuild',
  WATCHDOG_HANDLER: 'watchQboCanonicalV2Rebuild',
  NEXT_TRIGGER_DELAY_MS: 60000,
  WORKER_RUNTIME_BUDGET_MS: 240000,
  WORKER_MAX_SOURCES: 8,
  STALE_AFTER_MS: 15 * 60 * 1000,
  LEASE_DURATION_MS: 6 * 60 * 1000,
  CONTROL_LOCK_TIMEOUT_MS: 5000,
  PROPERTIES: Object.freeze({
    RUN_ID: 'QBO_CANONICAL_V2_REBUILD_RUN_ID',
    STATUS: 'QBO_CANONICAL_V2_REBUILD_STATUS',
    EXPORT_INDEX: 'QBO_CANONICAL_V2_REBUILD_EXPORT_INDEX',
    SOURCE_INDEX: 'QBO_CANONICAL_V2_REBUILD_SOURCE_INDEX',
    STARTED_AT: 'QBO_CANONICAL_V2_REBUILD_STARTED_AT',
    LAST_PROGRESS_AT: 'QBO_CANONICAL_V2_REBUILD_LAST_PROGRESS_AT',
    LAST_HEARTBEAT_AT: 'QBO_CANONICAL_V2_REBUILD_LAST_HEARTBEAT_AT',
    WORKER_LEASE_TOKEN: 'QBO_CANONICAL_V2_REBUILD_WORKER_LEASE_TOKEN',
    WORKER_LEASE_EXPIRES_AT: 'QBO_CANONICAL_V2_REBUILD_WORKER_LEASE_EXPIRES_AT',
    LAST_ERROR: 'QBO_CANONICAL_V2_REBUILD_LAST_ERROR'
  })
});

function startQboCanonicalV2Rebuild() {
  testQboCanonicalV2ContractReadiness();
  validateQboFlatteningRemediationContract();
  const result = qboCanonicalV2WithControlLock_(function(props) {
    const current = qboCanonicalV2ReadRebuildState_(props);
    if (current.status === 'RUNNING') {
      throw new Error('CANONICAL_V2_REBUILD_ALREADY_RUNNING runId=' + current.runId);
    }
    const now = new Date();
    const runId = 'CANONICAL_V2_REBUILD|' + Utilities.getUuid();
    props.setProperties({
      QBO_CANONICAL_V2_REBUILD_RUN_ID: runId,
      QBO_CANONICAL_V2_REBUILD_STATUS: 'RUNNING',
      QBO_CANONICAL_V2_REBUILD_EXPORT_INDEX: '0',
      QBO_CANONICAL_V2_REBUILD_SOURCE_INDEX: '0',
      QBO_CANONICAL_V2_REBUILD_STARTED_AT: now.toISOString(),
      QBO_CANONICAL_V2_REBUILD_LAST_PROGRESS_AT: now.toISOString(),
      QBO_CANONICAL_V2_REBUILD_LAST_HEARTBEAT_AT: now.toISOString(),
      QBO_CANONICAL_V2_REBUILD_WORKER_LEASE_TOKEN: '',
      QBO_CANONICAL_V2_REBUILD_WORKER_LEASE_EXPIRES_AT: '',
      QBO_CANONICAL_V2_REBUILD_LAST_ERROR: ''
    }, false);
    return runId;
  });
  qboCanonicalV2DeleteTriggers_();
  qboCanonicalV2InstallWatchdog_();
  qboCanonicalV2ScheduleWorker_();
  console.log('[CANONICAL V2 REBUILD] | STARTED | runId=' + result);
  return listQboCanonicalV2RebuildStatus();
}

function resumeQboCanonicalV2Rebuild() {
  qboCanonicalV2WithControlLock_(function(props) {
    const state = qboCanonicalV2ReadRebuildState_(props);
    if (!state.runId) throw new Error('NO_CANONICAL_V2_REBUILD_STATE');
    if (state.status === 'COMPLETE') return;
    props.setProperties({
      QBO_CANONICAL_V2_REBUILD_STATUS: 'RUNNING',
      QBO_CANONICAL_V2_REBUILD_LAST_ERROR: ''
    }, false);
  });
  qboCanonicalV2InstallWatchdog_();
  qboCanonicalV2ScheduleWorker_();
  return listQboCanonicalV2RebuildStatus();
}

function stopQboCanonicalV2Rebuild() {
  qboCanonicalV2WithControlLock_(function(props) {
    if (props.getProperty(QBO_CANONICAL_V2_REBUILD_.PROPERTIES.RUN_ID)) {
      props.setProperties({
        QBO_CANONICAL_V2_REBUILD_STATUS: 'STOPPED',
        QBO_CANONICAL_V2_REBUILD_WORKER_LEASE_TOKEN: '',
        QBO_CANONICAL_V2_REBUILD_WORKER_LEASE_EXPIRES_AT: ''
      }, false);
    }
  });
  qboCanonicalV2DeleteTriggers_();
  return listQboCanonicalV2RebuildStatus();
}

function listQboCanonicalV2RebuildStatus() {
  const state = qboCanonicalV2ReadRebuildState_(PropertiesService.getScriptProperties());
  const scope = QBO_STATE_CAPTURE.CANONICAL_MIGRATION_SCOPE;
  const result = {
    runId: state.runId,
    status: state.status,
    canonicalizationVersion: QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
    exportIndex: state.exportIndex,
    sourceIndex: state.sourceIndex,
    exportCount: scope.length,
    currentExportKey: state.exportIndex < scope.length ? scope[state.exportIndex] : '',
    startedAt: state.startedAt,
    lastProgressAt: state.lastProgressAt,
    lastHeartbeatAt: state.lastHeartbeatAt,
    workerLeaseExpiresAt: state.workerLeaseExpiresAt,
    workerLeaseActive: qboCanonicalV2LeaseIsActive_(state),
    lastError: state.lastError
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function runNextQboCanonicalV2Rebuild() {
  qboCanonicalV2DeleteWorkerTriggers_();
  const continuationId = Utilities.getUuid();
  const leaseToken = qboCanonicalV2TryClaimWorkerLease_(continuationId);
  if (!leaseToken) {
    console.log('[CANONICAL V2 REBUILD] | WORKER SKIP | another rebuild worker owns the active lease.');
    return;
  }

  let shouldSchedule = false;
  try {
    const props = PropertiesService.getScriptProperties();
    let state = qboCanonicalV2ReadRebuildState_(props);
    if (state.status !== 'RUNNING') return;

    const startedMs = Date.now();
    let processed = 0;
    while (
      state.status === 'RUNNING' &&
      processed < QBO_CANONICAL_V2_REBUILD_.WORKER_MAX_SOURCES &&
      Date.now() - startedMs < QBO_CANONICAL_V2_REBUILD_.WORKER_RUNTIME_BUDGET_MS
    ) {
      qboCanonicalV2HeartbeatLease_(leaseToken);
      const step = qboCanonicalV2ProcessOneSource_(state, props, leaseToken);
      processed += step.sourceProcessed ? 1 : 0;
      state = qboCanonicalV2ReadRebuildState_(props);
      if (step.complete) break;
    }

    shouldSchedule = state.status === 'RUNNING';
    if (state.status === 'COMPLETE') qboCanonicalV2DeleteTriggers_();
  } catch (error) {
    qboCanonicalV2SetErrorState_(error);
    throw error;
  } finally {
    qboCanonicalV2ReleaseWorkerLease_(leaseToken);
  }

  if (shouldSchedule) qboCanonicalV2ScheduleWorker_();
}

function watchQboCanonicalV2Rebuild() {
  const props = PropertiesService.getScriptProperties();
  const state = qboCanonicalV2ReadRebuildState_(props);
  if (state.status !== 'RUNNING') return state;

  const leaseActive = qboCanonicalV2LeaseIsActive_(state);
  const lastHeartbeatMs = state.lastHeartbeatAt ? new Date(state.lastHeartbeatAt).getTime() : 0;
  const lastProgressMs = state.lastProgressAt ? new Date(state.lastProgressAt).getTime() : 0;
  const staleHeartbeat = !lastHeartbeatMs || Date.now() - lastHeartbeatMs > QBO_CANONICAL_V2_REBUILD_.STALE_AFTER_MS;
  const staleProgress = !lastProgressMs || Date.now() - lastProgressMs > QBO_CANONICAL_V2_REBUILD_.STALE_AFTER_MS;

  if (leaseActive) {
    console.log('[CANONICAL V2 REBUILD] | WATCHDOG | active rebuild lease; no action.');
    return state;
  }

  if (staleHeartbeat || staleProgress || !qboCanonicalV2HasWorkerTrigger_()) {
    qboCanonicalV2ScheduleWorker_();
    console.log('[CANONICAL V2 REBUILD] | WATCHDOG | worker trigger restored; lease inactive.');
  }
  return state;
}

function qboCanonicalV2TryClaimWorkerLease_(continuationId) {
  return qboCanonicalV2WithControlLock_(function(props) {
    const state = qboCanonicalV2ReadRebuildState_(props);
    if (state.status !== 'RUNNING') return '';
    if (qboCanonicalV2LeaseIsActive_(state)) return '';
    const now = new Date();
    const token = state.runId + '|' + continuationId;
    props.setProperties({
      QBO_CANONICAL_V2_REBUILD_WORKER_LEASE_TOKEN: token,
      QBO_CANONICAL_V2_REBUILD_WORKER_LEASE_EXPIRES_AT: new Date(now.getTime() + QBO_CANONICAL_V2_REBUILD_.LEASE_DURATION_MS).toISOString(),
      QBO_CANONICAL_V2_REBUILD_LAST_HEARTBEAT_AT: now.toISOString()
    }, false);
    return token;
  });
}

function qboCanonicalV2HeartbeatLease_(leaseToken) {
  qboCanonicalV2WithControlLock_(function(props) {
    const P = QBO_CANONICAL_V2_REBUILD_.PROPERTIES;
    if (props.getProperty(P.WORKER_LEASE_TOKEN) !== leaseToken) {
      throw new Error('CANONICAL_V2_REBUILD_LEASE_LOST');
    }
    const now = new Date();
    props.setProperties({
      QBO_CANONICAL_V2_REBUILD_WORKER_LEASE_EXPIRES_AT: new Date(now.getTime() + QBO_CANONICAL_V2_REBUILD_.LEASE_DURATION_MS).toISOString(),
      QBO_CANONICAL_V2_REBUILD_LAST_HEARTBEAT_AT: now.toISOString()
    }, false);
  });
}

function qboCanonicalV2ReleaseWorkerLease_(leaseToken) {
  if (!leaseToken) return;
  qboCanonicalV2WithControlLock_(function(props) {
    const P = QBO_CANONICAL_V2_REBUILD_.PROPERTIES;
    if (props.getProperty(P.WORKER_LEASE_TOKEN) !== leaseToken) return;
    props.setProperties({
      QBO_CANONICAL_V2_REBUILD_WORKER_LEASE_TOKEN: '',
      QBO_CANONICAL_V2_REBUILD_WORKER_LEASE_EXPIRES_AT: '',
      QBO_CANONICAL_V2_REBUILD_LAST_HEARTBEAT_AT: new Date().toISOString()
    }, false);
  });
}

function qboCanonicalV2LeaseIsActive_(state) {
  if (!state || !state.workerLeaseToken || !state.workerLeaseExpiresAt) return false;
  const expiresMs = new Date(state.workerLeaseExpiresAt).getTime();
  return isFinite(expiresMs) && expiresMs > Date.now();
}

function qboCanonicalV2WithControlLock_(fn) {
  // Apps Script has no named locks. ScriptLock is deliberately held only for
  // this very short property mutation; it is never held during replay work,
  // spreadsheet reads/writes, QBO calls, or trigger waits.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(QBO_CANONICAL_V2_REBUILD_.CONTROL_LOCK_TIMEOUT_MS)) {
    throw new Error('CANONICAL_V2_REBUILD_CONTROL_LOCK_TIMEOUT');
  }
  try {
    return fn(PropertiesService.getScriptProperties());
  } finally {
    lock.releaseLock();
  }
}

function qboCanonicalV2SetErrorState_(error) {
  qboCanonicalV2WithControlLock_(function(props) {
    props.setProperty(QBO_CANONICAL_V2_REBUILD_.PROPERTIES.STATUS, 'ERROR');
    props.setProperty(QBO_CANONICAL_V2_REBUILD_.PROPERTIES.LAST_ERROR,
      error && error.message ? error.message : String(error));
  });
}

function qboCanonicalV2ProcessOneSource_(state, props, leaseToken) {
  const scope = QBO_STATE_CAPTURE.CANONICAL_MIGRATION_SCOPE;
  if (state.exportIndex >= scope.length) {
    qboCanonicalV2Checkpoint_(leaseToken, {
      QBO_CANONICAL_V2_REBUILD_STATUS: 'COMPLETE',
      QBO_CANONICAL_V2_REBUILD_LAST_PROGRESS_AT: new Date().toISOString()
    });
    return {complete:true, sourceProcessed:false};
  }

  const exportKey = scope[state.exportIndex];
  const manifestEntry = getQboExportManifestEntry_(exportKey);
  const ss = getQboStateCaptureSpreadsheet_();
  initializeQboStateCaptureWorkbook_(ss);
  validateQboStateCaptureWorkbookLocation_(ss);
  const sourceSheet = ss.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
  const snapshotSheet = ss.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SNAPSHOTS);
  const changeSheet = ss.getSheetByName(QBO_STATE_CAPTURE.SHEETS.CHANGES);
  const detailSheet = ss.getSheetByName(QBO_STATE_CAPTURE.SHEETS.CHANGE_DETAIL);
  const sources = loadQboStateCaptureWriteSources_(sourceSheet, exportKey)
    .filter(function(source) { return source.sourceStatus === QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE; });

  if (state.sourceIndex >= sources.length) {
    qboCanonicalV2Checkpoint_(leaseToken, {
      QBO_CANONICAL_V2_REBUILD_EXPORT_INDEX: String(state.exportIndex + 1),
      QBO_CANONICAL_V2_REBUILD_SOURCE_INDEX: '0',
      QBO_CANONICAL_V2_REBUILD_LAST_PROGRESS_AT: new Date().toISOString()
    });
    return {complete:false, sourceProcessed:false};
  }

  const source = sources[state.sourceIndex];
  const currentState = qboCanonicalV2BuildSourceState_(source, manifestEntry);
  const priorState = state.sourceIndex > 0
    ? qboCanonicalV2BuildSourceState_(sources[state.sourceIndex - 1], manifestEntry)
    : Object.create(null);
  const sourceIndexById = Object.create(null);
  sources.forEach(function(item, i) { sourceIndexById[item.sourceId] = i; });
  const priorSnapshotMap = qboCanonicalV2LoadLatestSnapshotMap_(snapshotSheet, exportKey, sourceIndexById, state.sourceIndex - 1);
  const existingSnapshotIds = qboCanonicalLoadIdSet_(snapshotSheet, 'SnapshotRecordId');
  const existingChangeIds = qboCanonicalLoadIdSet_(changeSheet, 'ChangeRecordId');
  const existingDetailIds = qboCanonicalLoadIdSet_(detailSheet, 'ChangeDetailId');
  const snapshotRows = [];
  const changeRows = [];
  const detailRows = [];
  const capturedAt = new Date();
  let unchanged = 0;

  Object.keys(currentState).sort().forEach(function(entityId) {
    const current = currentState[entityId];
    const prior = priorState[entityId] || null;
    if (prior && prior.canonicalHash === current.canonicalHash) {
      unchanged += 1;
      return;
    }
    const priorStored = priorSnapshotMap[entityId] || null;
    const reason = prior ? 'STATE_CHANGED' : (state.sourceIndex === 0 ? 'INITIAL_STATE' : 'NEW_ENTITY');
    const snapshotId = qboCanonicalBuildSnapshotId_(source.sourceId, manifestEntry.entityName, entityId, current.canonicalHash);
    const priorSnapshotId = priorStored ? priorStored.snapshotId : '';
    const snapshotRecord = [
      snapshotId, QBO_STATE_CAPTURE.SNAPSHOT_RECORD_VERSION, source.sourceId,
      source.sourceAcquisitionType, source.sourceRunId, source.exportKey, source.exportFunction,
      source.observationStartedAt, source.observationCompletedAt, source.masterBackupFileId,
      source.masterBackupFileName, manifestEntry.sheetNames[0], current.sourceRowNumber,
      manifestEntry.entityName, entityId, 'LIVE', current.qboCreateTime,
      current.qboLastUpdatedTime, current.qboSyncToken, QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
      current.canonicalHash, current.rawPayloadHash, current.rawPayloadComplete, true,
      QBO_CANONICAL_V2_SOURCE_, priorSnapshotId, reason, capturedAt
    ];
    if (!existingSnapshotIds[snapshotId]) {
      snapshotRows.push(snapshotRecord);
      existingSnapshotIds[snapshotId] = true;
    }

    if (reason !== 'INITIAL_STATE') {
      const changeType = reason === 'NEW_ENTITY' ? 'ADD' : 'UPDATE';
      const beforeCanonical = prior ? prior.canonicalState : QBO_CANONICAL_MISSING_;
      const diffs = qboCanonicalDiff_(beforeCanonical, current.canonicalState);
      const changeId = qboCanonicalBuildChangeId_(priorSnapshotId, snapshotId, changeType, manifestEntry.entityName, entityId);
      const changeRecord = [
        changeId, QBO_STATE_CAPTURE.CHANGE_RECORD_VERSION, manifestEntry.entityName, entityId,
        changeType, source.observationCompletedAt || capturedAt, source.sourceId,
        source.sourceAcquisitionType, source.sourceRunId, '', priorSnapshotId, snapshotId,
        prior ? prior.canonicalHash : '', current.canonicalHash, diffs.length, true, false,
        'COMPLETE', capturedAt
      ];
      if (!existingChangeIds[changeId]) {
        changeRows.push(changeRecord);
        existingChangeIds[changeId] = true;
      }
      diffs.forEach(function(diff, diffIndex) {
        const detailId = qboCanonicalBuildDetailId_(changeId, diff.path, diff.operation);
        if (existingDetailIds[detailId]) return;
        detailRows.push([
          detailId, QBO_STATE_CAPTURE.CHANGE_DETAIL_VERSION, changeId, diffIndex + 1,
          manifestEntry.entityName, entityId, diff.path, diff.operation, diff.beforeType,
          diff.beforeValue, diff.afterType, diff.afterValue, diff.beforeValueHash,
          diff.afterValueHash, diff.classification, capturedAt
        ]);
        existingDetailIds[detailId] = true;
      });
    }
  });

  qboCanonicalAppendRows_(snapshotSheet, snapshotRows, QBO_STATE_CAPTURE_HEADERS.SNAPSHOTS.length);
  qboCanonicalAppendRows_(changeSheet, changeRows, QBO_STATE_CAPTURE_HEADERS.CHANGES.length);
  qboCanonicalAppendRows_(detailSheet, detailRows, QBO_STATE_CAPTURE_HEADERS.CHANGE_DETAIL.length);
  SpreadsheetApp.flush();
  qboCanonicalV2AssertPersistedIds_(snapshotSheet, 'SnapshotRecordId', snapshotRows, 0);
  qboCanonicalV2AssertPersistedIds_(changeSheet, 'ChangeRecordId', changeRows, 0);
  qboCanonicalV2AssertPersistedIds_(detailSheet, 'ChangeDetailId', detailRows, 0);

  qboCanonicalAppendIngestionLog_(ss, {
    ingestionRunId: state.runId,
    startedAt: capturedAt,
    completedAt: new Date(),
    operation: 'CANONICAL_V2_CONTROLLED_REBUILD_REPLAY',
    processingPhase: 'SOURCE_REPLAY',
    status: 'COMPLETE',
    sourceAcquisitionType: source.sourceAcquisitionType,
    sourceId: source.sourceId,
    sourceRunId: source.sourceRunId,
    exportKey: exportKey,
    sourceRowsScanned: Object.keys(currentState).length,
    entitiesEvaluated: Object.keys(currentState).length,
    snapshotsCreated: snapshotRows.length,
    changesCreated: changeRows.length,
    changeDetailsCreated: detailRows.length,
    unchangedEntities: unchanged,
    errorCount: 0,
    actionRequired: false,
    error: ''
  });

  qboCanonicalV2Checkpoint_(leaseToken, {
    QBO_CANONICAL_V2_REBUILD_SOURCE_INDEX: String(state.sourceIndex + 1),
    QBO_CANONICAL_V2_REBUILD_LAST_PROGRESS_AT: new Date().toISOString(),
    QBO_CANONICAL_V2_REBUILD_LAST_HEARTBEAT_AT: new Date().toISOString(),
    QBO_CANONICAL_V2_REBUILD_LAST_ERROR: ''
  });
  console.log('[CANONICAL V2 REBUILD] | SOURCE COMPLETE | export=' + exportKey +
    ' | sourceIndex=' + state.sourceIndex + '/' + sources.length +
    ' | sourceId=' + source.sourceId + ' | snapshots=' + snapshotRows.length +
    ' | changes=' + changeRows.length + ' | details=' + detailRows.length +
    ' | unchanged=' + unchanged);
  return {complete:false, sourceProcessed:true};
}

function qboCanonicalV2LoadLatestSnapshotMap_(sheet, exportKey, sourceIndexById, maxSourceIndex) {
  const result = Object.create(null);
  if (maxSourceIndex < 0 || sheet.getLastRow() <= 1) return result;
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function(value) { return String(value || '').trim(); });
  const index = buildQboStateCaptureWriteHeaderIndex_(headers);
  values.slice(1).forEach(function(row) {
    if (String(row[index.ExportKey] || '').trim() !== exportKey) return;
    if (String(row[index.CanonicalizationVersion] || '').trim() !== QBO_STATE_CAPTURE.CANONICALIZATION_VERSION) return;
    const sourceId = String(row[index.SourceId] || '').trim();
    const sourceIndex = sourceIndexById[sourceId];
    if (sourceIndex === undefined || sourceIndex > maxSourceIndex) return;
    const entityId = String(row[index.EntityId] || '').trim();
    const existing = result[entityId];
    if (!existing || sourceIndex >= existing.sourceIndex) {
      result[entityId] = {
        sourceIndex: sourceIndex,
        snapshotId: String(row[index.SnapshotRecordId] || '').trim(),
        canonicalHash: String(row[index.CanonicalStateHash] || '').trim()
      };
    }
  });
  return result;
}

function qboCanonicalV2Checkpoint_(leaseToken, updates) {
  qboCanonicalV2WithControlLock_(function(props) {
    const P = QBO_CANONICAL_V2_REBUILD_.PROPERTIES;
    if (!leaseToken || props.getProperty(P.WORKER_LEASE_TOKEN) !== leaseToken) {
      throw new Error('CANONICAL_V2_REBUILD_CHECKPOINT_LEASE_MISMATCH');
    }
    props.setProperties(updates, false);
  });
}

function qboCanonicalV2ReadRebuildState_(props) {
  const P = QBO_CANONICAL_V2_REBUILD_.PROPERTIES;
  const exportIndex = Math.max(0, Number(props.getProperty(P.EXPORT_INDEX) || 0));
  const sourceIndex = Math.max(0, Number(props.getProperty(P.SOURCE_INDEX) || 0));
  return {
    runId: props.getProperty(P.RUN_ID) || '',
    status: props.getProperty(P.STATUS) || '',
    exportIndex: isFinite(exportIndex) ? Math.floor(exportIndex) : 0,
    sourceIndex: isFinite(sourceIndex) ? Math.floor(sourceIndex) : 0,
    startedAt: props.getProperty(P.STARTED_AT) || '',
    lastProgressAt: props.getProperty(P.LAST_PROGRESS_AT) || '',
    lastHeartbeatAt: props.getProperty(P.LAST_HEARTBEAT_AT) || '',
    workerLeaseToken: props.getProperty(P.WORKER_LEASE_TOKEN) || '',
    workerLeaseExpiresAt: props.getProperty(P.WORKER_LEASE_EXPIRES_AT) || '',
    lastError: props.getProperty(P.LAST_ERROR) || ''
  };
}

function qboCanonicalV2ScheduleWorker_() {
  if (qboCanonicalV2HasWorkerTrigger_()) return;
  ScriptApp.newTrigger(QBO_CANONICAL_V2_REBUILD_.HANDLER)
    .timeBased().after(QBO_CANONICAL_V2_REBUILD_.NEXT_TRIGGER_DELAY_MS).create();
}

function qboCanonicalV2InstallWatchdog_() {
  const exists = ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === QBO_CANONICAL_V2_REBUILD_.WATCHDOG_HANDLER;
  });
  if (!exists) ScriptApp.newTrigger(QBO_CANONICAL_V2_REBUILD_.WATCHDOG_HANDLER).timeBased().everyMinutes(5).create();
}

function qboCanonicalV2HasWorkerTrigger_() {
  return ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === QBO_CANONICAL_V2_REBUILD_.HANDLER;
  });
}

function qboCanonicalV2AssertPersistedIds_(sheet, idHeader, rows, idColumnIndex) {
  if (!rows || !rows.length) return;
  const persisted = qboCanonicalLoadIdSet_(sheet, idHeader);
  const missing = rows.map(function(row) { return String(row[idColumnIndex] || '').trim(); })
    .filter(function(id) { return id && !persisted[id]; });
  if (missing.length) {
    throw new Error('CANONICAL_V2_PERSISTENCE_RECONCILIATION_FAILED sheet=' + sheet.getName() +
      ' missing=' + missing.slice(0, 10).join(','));
  }
}

function qboCanonicalV2DeleteWorkerTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === QBO_CANONICAL_V2_REBUILD_.HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function qboCanonicalV2DeleteTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    const handler = trigger.getHandlerFunction();
    if (handler === QBO_CANONICAL_V2_REBUILD_.HANDLER || handler === QBO_CANONICAL_V2_REBUILD_.WATCHDOG_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}
