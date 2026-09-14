/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 103_QBO_ForwardIngestionControl.js
 * Version     : 1.5.67
 * Purpose     : Shared durable forward-ingestion control ledger for normalized
 *               observations from Native CDC, Webhooks, and FULL_EXPORT.
 *
 * Contract:
 *   - Source evidence remains immutable in its governed acquisition store.
 *   - This ledger is the durable processed/unprocessed/checkpoint authority for
 *     forward ingestion. Drive folder enumeration is not the processing state.
 *   - 90_Ingestion_Log remains operational/audit telemetry and is not the
 *     resume authority.
 *   - Source-specific adapters feed the same Change Payload normalization and
 *     persistence contracts.
 * ============================================================================
 */

const QBO_FORWARD_INGESTION_CONTROL_ = Object.freeze({
  VERSION: 'QBO_FORWARD_INGESTION_CONTROL_V3',
  SHEET_NAME: '05_Forward_Ingestion_Control',
  CLAIM_TIMEOUT_MS: 360000,
  LOCK_TIMEOUT_MS: 30000,
  STATUS_AVAILABLE: 'AVAILABLE',
  STATUS_PROCESSING: 'PROCESSING',
  STATUS_PROCESSED: 'PROCESSED',
  STATUS_BLOCKED: 'BLOCKED',
  SOURCE_TYPES: Object.freeze(['NATIVE_CDC', 'WEBHOOK', 'FULL_EXPORT'])
});

const QBO_FORWARD_INGESTION_HEADERS_ = Object.freeze([
  'IngestionSourceId',
  'SourceType',
  'SourceRunId',
  'SourceUnitId',
  'EntityType',
  'EvidenceFileId',
  'EvidenceFileName',
  'EvidenceHash',
  'EvidenceHashType',
  'ObservedAt',
  'SourceWindowStart',
  'SourceWindowEnd',
  'SourceResponseTime',
  'RequestStartedAt',
  'RequestCompletedAt',
  'SourceStatus',
  'ProcessingStatus',
  'RecordCursor',
  'ObservationCount',
  'PayloadCount',
  'ShardCount',
  'AttemptCount',
  'ClaimOwner',
  'ClaimExpiresAt',
  'LastHeartbeatAt',
  'LastProgressAt',
  'ProcessedAt',
  'ProcessingError',
  'RegisteredAt'
]);

function provisionQboForwardIngestionControl() {
  const sheet = qboForwardIngestionEnsureSheet_();
  const result = {
    ready: true,
    version: QBO_FORWARD_INGESTION_CONTROL_.VERSION,
    sheetName: sheet.getName(),
    headerCount: QBO_FORWARD_INGESTION_HEADERS_.length,
    sourceTypes: QBO_FORWARD_INGESTION_CONTROL_.SOURCE_TYPES.slice(),
    authoritativeResumeControl: true,
    driveFolderEnumerationIsResumeControl: false,
    ingestionLogIsResumeControl: false,
    registeredAtRequired: true,
    registrationTimestampImmutable: true,
    postInsertRegisteredAtVerification: true,
    initialBlockedRegistrationSupported: true
  };
  console.log('[FORWARD INGESTION] | CONTROL READY | ' + JSON.stringify(result));
  return result;
}

function testQboForwardIngestionControlReadiness() {
  return provisionQboForwardIngestionControl();
}

function listQboForwardIngestionStatus() {
  const sheet = qboForwardIngestionEnsureSheet_();
  const rows = qboForwardIngestionReadRows_(sheet);
  const byStatus = Object.create(null);
  const bySourceType = Object.create(null);
  rows.forEach(function(row) {
    const status = row.ProcessingStatus || '(blank)';
    const sourceType = row.SourceType || '(blank)';
    byStatus[status] = (byStatus[status] || 0) + 1;
    bySourceType[sourceType] = (bySourceType[sourceType] || 0) + 1;
  });
  const result = {
    version: QBO_FORWARD_INGESTION_CONTROL_.VERSION,
    rowCount: rows.length,
    byStatus: byStatus,
    bySourceType: bySourceType,
    availableCount: Number(byStatus[QBO_FORWARD_INGESTION_CONTROL_.STATUS_AVAILABLE] || 0),
    processingCount: Number(byStatus[QBO_FORWARD_INGESTION_CONTROL_.STATUS_PROCESSING] || 0),
    processedCount: Number(byStatus[QBO_FORWARD_INGESTION_CONTROL_.STATUS_PROCESSED] || 0),
    blockedCount: Number(byStatus[QBO_FORWARD_INGESTION_CONTROL_.STATUS_BLOCKED] || 0)
  };
  console.log('[FORWARD INGESTION] | STATUS | ' + JSON.stringify(result));
  return result;
}

function qboForwardIngestionEnsureSheet_() {
  const spreadsheet = getQboStateCaptureSpreadsheet_();
  const sheet = ensureQboStateCaptureSheet_(
    spreadsheet,
    QBO_FORWARD_INGESTION_CONTROL_.SHEET_NAME,
    QBO_FORWARD_INGESTION_HEADERS_
  );
  applyQboStateCaptureSheetLayout_(sheet);
  return sheet;
}

function qboForwardIngestionHeaderIndex_() {
  const map = Object.create(null);
  QBO_FORWARD_INGESTION_HEADERS_.forEach(function(header, i) { map[header] = i; });
  return map;
}

function qboForwardIngestionReadRows_(sheet) {
  if (sheet.getLastRow() <= 1) return [];
  const idx = qboForwardIngestionHeaderIndex_();
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, QBO_FORWARD_INGESTION_HEADERS_.length)
    .getValues()
    .map(function(values, offset) {
      const row = {rowNumber: offset + 2, _values: values};
      Object.keys(idx).forEach(function(header) { row[header] = values[idx[header]]; });
      return row;
    });
}

function qboForwardIngestionFindBySourceId_(sheet, sourceId) {
  sourceId = String(sourceId || '').trim();
  if (!sourceId || sheet.getLastRow() <= 1) return null;
  const finder = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(sourceId)
    .matchEntireCell(true)
    .findNext();
  if (!finder) return null;
  const rowNumber = finder.getRow();
  const values = sheet.getRange(rowNumber, 1, 1, QBO_FORWARD_INGESTION_HEADERS_.length).getValues()[0];
  const idx = qboForwardIngestionHeaderIndex_();
  const row = {rowNumber: rowNumber, _values: values};
  Object.keys(idx).forEach(function(header) { row[header] = values[idx[header]]; });
  return row;
}

function qboForwardIngestionRegisterSource_(source) {
  source = source || {};
  const sourceId = String(source.ingestionSourceId || '').trim();
  const sourceType = String(source.sourceType || '').trim();
  if (!sourceId) throw new Error('FORWARD_INGESTION_REGISTER_MISSING_SOURCE_ID');
  if (QBO_FORWARD_INGESTION_CONTROL_.SOURCE_TYPES.indexOf(sourceType) < 0) {
    throw new Error('FORWARD_INGESTION_REGISTER_UNSUPPORTED_SOURCE_TYPE ' + sourceType);
  }

  return qboForwardIngestionWithLock_(function() {
    const sheet = qboForwardIngestionEnsureSheet_();
    const existing = qboForwardIngestionFindBySourceId_(sheet, sourceId);
    if (existing) {
      const mismatches = [];
      ['SourceType','SourceRunId','SourceUnitId','EntityType','EvidenceFileId','EvidenceHash'].forEach(function(field) {
        const requested = String(source[qboForwardIngestionInputField_(field)] || '');
        const persisted = String(existing[field] || '');
        if (requested && persisted && requested !== persisted) mismatches.push(field);
      });
      if (mismatches.length) {
        throw new Error('FORWARD_INGESTION_SOURCE_ID_COLLISION sourceId=' + sourceId + ' fields=' + mismatches.join(','));
      }
      return {registered:false, alreadyRegistered:true, sourceId:sourceId, rowNumber:existing.rowNumber};
    }

    const registeredAt = qboForwardIngestionResolveRegisteredAt_(source.registeredAt);
    const initialProcessingStatus = String(source.processingStatus || QBO_FORWARD_INGESTION_CONTROL_.STATUS_AVAILABLE);
    if ([QBO_FORWARD_INGESTION_CONTROL_.STATUS_AVAILABLE, QBO_FORWARD_INGESTION_CONTROL_.STATUS_BLOCKED].indexOf(initialProcessingStatus) < 0) {
      throw new Error('FORWARD_INGESTION_REGISTER_INVALID_INITIAL_STATUS ' + initialProcessingStatus);
    }
    const initialProcessingError = initialProcessingStatus === QBO_FORWARD_INGESTION_CONTROL_.STATUS_BLOCKED
      ? String(source.processingError || 'FORWARD_INGESTION_REGISTERED_BLOCKED')
      : '';
    const row = [
      sourceId,
      sourceType,
      String(source.sourceRunId || ''),
      String(source.sourceUnitId || ''),
      String(source.entityType || ''),
      String(source.evidenceFileId || ''),
      String(source.evidenceFileName || ''),
      String(source.evidenceHash || ''),
      String(source.evidenceHashType || ''),
      source.observedAt || '',
      source.sourceWindowStart || '',
      source.sourceWindowEnd || '',
      source.sourceResponseTime || '',
      source.requestStartedAt || '',
      source.requestCompletedAt || '',
      String(source.sourceStatus || 'AVAILABLE'),
      initialProcessingStatus,
      0,
      source.observationCount === undefined ? '' : Number(source.observationCount || 0),
      0,
      0,
      0,
      '',
      '',
      '',
      '',
      '',
      initialProcessingError,
      registeredAt
    ];
    const rowNumber = sheet.getLastRow() + 1;
    sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
    SpreadsheetApp.flush();
    const persisted = qboForwardIngestionFindBySourceId_(sheet, sourceId);
    if (!persisted || !persisted.RegisteredAt) {
      throw new Error('FORWARD_INGESTION_REGISTERED_AT_NOT_PERSISTED sourceId=' + sourceId);
    }
    return {registered:true, alreadyRegistered:false, sourceId:sourceId, rowNumber:rowNumber, registeredAt:persisted.RegisteredAt};
  });
}


function qboForwardIngestionResolveRegisteredAt_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return new Date(value.getTime());
  if (value) {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) return parsed;
    throw new Error('FORWARD_INGESTION_REGISTERED_AT_INVALID ' + value);
  }
  return new Date();
}

function qboForwardIngestionRepairBlankRegisteredAt_(predicate, registeredAt) {
  const repairedAt = qboForwardIngestionResolveRegisteredAt_(registeredAt);
  return qboForwardIngestionWithLock_(function() {
    const sheet = qboForwardIngestionEnsureSheet_();
    const rows = qboForwardIngestionReadRows_(sheet);
    const idx = qboForwardIngestionHeaderIndex_();
    let repaired = 0;
    const repairedSourceIds = [];
    rows.forEach(function(row) {
      if (row.RegisteredAt) return;
      if (predicate && predicate(row) !== true) return;
      sheet.getRange(row.rowNumber, idx.RegisteredAt + 1).setValue(repairedAt);
      repaired += 1;
      repairedSourceIds.push(String(row.IngestionSourceId || ''));
    });
    SpreadsheetApp.flush();
    repairedSourceIds.forEach(function(sourceId) {
      const persisted = qboForwardIngestionFindBySourceId_(sheet, sourceId);
      if (!persisted || !persisted.RegisteredAt) {
        throw new Error('FORWARD_INGESTION_REGISTERED_AT_REPAIR_NOT_PERSISTED sourceId=' + sourceId);
      }
    });
    return {repaired:repaired, registeredAt:repairedAt.toISOString(), sourceIds:repairedSourceIds};
  });
}

function qboForwardIngestionInputField_(ledgerField) {
  const map = {
    SourceType:'sourceType', SourceRunId:'sourceRunId', SourceUnitId:'sourceUnitId', EntityType:'entityType',
    EvidenceFileId:'evidenceFileId', EvidenceHash:'evidenceHash'
  };
  return map[ledgerField] || ledgerField;
}

function qboForwardIngestionClaimNext_(sourceType, workerId) {
  return qboForwardIngestionWithLock_(function() {
    const sheet = qboForwardIngestionEnsureSheet_();
    const rows = qboForwardIngestionReadRows_(sheet);
    const now = Date.now();
    let selected = null;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (sourceType && String(row.SourceType || '') !== sourceType) continue;
      const status = String(row.ProcessingStatus || '');
      const claimExpiryMs = row.ClaimExpiresAt ? new Date(row.ClaimExpiresAt).getTime() : 0;
      const claimStale = status === QBO_FORWARD_INGESTION_CONTROL_.STATUS_PROCESSING && claimExpiryMs && claimExpiryMs <= now;
      if (status === QBO_FORWARD_INGESTION_CONTROL_.STATUS_AVAILABLE || claimStale) {
        selected = row;
        break;
      }
    }
    if (!selected) return null;

    const idx = qboForwardIngestionHeaderIndex_();
    const values = selected._values.slice();
    values[idx.ProcessingStatus] = QBO_FORWARD_INGESTION_CONTROL_.STATUS_PROCESSING;
    values[idx.AttemptCount] = Number(values[idx.AttemptCount] || 0) + 1;
    values[idx.ClaimOwner] = workerId;
    values[idx.ClaimExpiresAt] = new Date(now + QBO_FORWARD_INGESTION_CONTROL_.CLAIM_TIMEOUT_MS);
    values[idx.LastHeartbeatAt] = new Date(now);
    values[idx.ProcessingError] = '';
    sheet.getRange(selected.rowNumber, 1, 1, values.length).setValues([values]);
    return qboForwardIngestionFindBySourceId_(sheet, selected.IngestionSourceId);
  });
}

function qboForwardIngestionCheckpoint_(sourceId, workerId, patch) {
  patch = patch || {};
  return qboForwardIngestionWithLock_(function() {
    const sheet = qboForwardIngestionEnsureSheet_();
    const row = qboForwardIngestionFindBySourceId_(sheet, sourceId);
    if (!row) throw new Error('FORWARD_INGESTION_CHECKPOINT_SOURCE_NOT_FOUND ' + sourceId);
    if (String(row.ClaimOwner || '') !== String(workerId || '')) {
      throw new Error('FORWARD_INGESTION_CHECKPOINT_CLAIM_MISMATCH sourceId=' + sourceId);
    }
    const idx = qboForwardIngestionHeaderIndex_();
    const values = row._values.slice();
    const now = new Date();
    if (patch.recordCursor !== undefined) values[idx.RecordCursor] = Number(patch.recordCursor || 0);
    if (patch.observationCount !== undefined) values[idx.ObservationCount] = Number(patch.observationCount || 0);
    if (patch.payloadCountDelta) values[idx.PayloadCount] = Number(values[idx.PayloadCount] || 0) + Number(patch.payloadCountDelta || 0);
    if (patch.shardCountDelta) values[idx.ShardCount] = Number(values[idx.ShardCount] || 0) + Number(patch.shardCountDelta || 0);
    values[idx.LastHeartbeatAt] = now;
    if (patch.progress === true) values[idx.LastProgressAt] = now;
    values[idx.ProcessingError] = '';
    if (patch.processed === true) {
      values[idx.ProcessingStatus] = QBO_FORWARD_INGESTION_CONTROL_.STATUS_PROCESSED;
      values[idx.ProcessedAt] = now;
      values[idx.ClaimOwner] = '';
      values[idx.ClaimExpiresAt] = '';
    } else {
      values[idx.ProcessingStatus] = QBO_FORWARD_INGESTION_CONTROL_.STATUS_AVAILABLE;
      values[idx.ClaimOwner] = '';
      values[idx.ClaimExpiresAt] = '';
    }
    sheet.getRange(row.rowNumber, 1, 1, values.length).setValues([values]);
    return true;
  });
}

function qboForwardIngestionBlock_(sourceId, workerId, error) {
  const message = String(error && error.message ? error.message : error || '');
  return qboForwardIngestionWithLock_(function() {
    const sheet = qboForwardIngestionEnsureSheet_();
    const row = qboForwardIngestionFindBySourceId_(sheet, sourceId);
    if (!row) return false;
    if (row.ClaimOwner && String(row.ClaimOwner) !== String(workerId || '')) return false;
    const idx = qboForwardIngestionHeaderIndex_();
    const values = row._values.slice();
    values[idx.ProcessingStatus] = QBO_FORWARD_INGESTION_CONTROL_.STATUS_BLOCKED;
    values[idx.ClaimOwner] = '';
    values[idx.ClaimExpiresAt] = '';
    values[idx.LastHeartbeatAt] = new Date();
    values[idx.ProcessingError] = message;
    sheet.getRange(row.rowNumber, 1, 1, values.length).setValues([values]);
    return true;
  });
}

function qboForwardIngestionWithLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(QBO_FORWARD_INGESTION_CONTROL_.LOCK_TIMEOUT_MS)) {
    throw new Error('FORWARD_INGESTION_CONTROL_LOCK_TIMEOUT');
  }
  try { return callback(); }
  finally { lock.releaseLock(); }
}
