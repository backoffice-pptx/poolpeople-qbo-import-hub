/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 111_QBO_ForwardIngestionIntegrityAudit.js
 * Version     : 1.5.92
 * Purpose     : Comprehensive, read-only integrity audit for every governed
 *               column and row in 05_Forward_Ingestion_Control and 01_Sources,
 *               including source-specific and cross-sheet invariants.
 *
 * Safety:
 *   - READ ONLY. No sheet/property/Drive mutations.
 *   - Classifies checks as VALID, VALID_BLANK, INVALID, or UNVERIFIABLE.
 *   - Does not manufacture missing timestamps or rewrite historical evidence.
 *   - Controlled STATE_CAPTURE_AUTOREG_TEST_* sources remain audit evidence but
 *     are classified non-production and excluded from production eligibility.
 * ============================================================================
 */

const QBO_FORWARD_INGESTION_INTEGRITY_AUDIT_ = Object.freeze({
  VERSION: 'QBO_FORWARD_INGESTION_INTEGRITY_AUDIT_V5_HISTORICAL_TIMESTAMP_EXCEPTIONS',
  TEST_RUN_PREFIX: 'STATE_CAPTURE_AUTOREG_TEST_',
  MAX_DETAIL_ROWS: 250,
  RESULT_VALID: 'VALID',
  RESULT_VALID_BLANK: 'VALID_BLANK',
  RESULT_INVALID: 'INVALID',
  RESULT_UNVERIFIABLE: 'UNVERIFIABLE',
  SHA256_RE: /^[a-f0-9]{64}$/i,
  DRIVE_ID_RE: /^[A-Za-z0-9_-]{20,}$/,
  UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  NATIVE_CDC_CYCLE_RE: /^\d{8}T\d{4}Z\|[0-9a-f-]{36}$/i
});

let QBO_FORWARD_INGESTION_HISTORICAL_EXCEPTION_CACHE_ = null;

/** Primary comprehensive audit entry point. */
function auditQboStateCaptureLedgerIntegrity() {
  return qboBuildStateCaptureLedgerIntegrityAudit_({log: true, includeAllFindings: false});
}

/**
 * Internal builder used by the full-workbook durable audit.
 * options.log=false suppresses the historically oversized JSON log.
 * options.includeAllFindings=true returns the complete finding set for durable persistence.
 */
function qboBuildStateCaptureLedgerIntegrityAudit_(options) {
  options = options || {};
  const spreadsheet = getQboStateCaptureSpreadsheet_();
  QBO_FORWARD_INGESTION_HISTORICAL_EXCEPTION_CACHE_ = qboIntegrityLoadHistoricalTimestampExceptions_(spreadsheet);
  const controlSheet = spreadsheet.getSheetByName(QBO_FORWARD_INGESTION_CONTROL_.SHEET_NAME);
  const sourceSheet = spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
  if (!controlSheet) throw new Error('FORWARD_INGESTION_INTEGRITY_05_NOT_FOUND');
  if (!sourceSheet) throw new Error('FORWARD_INGESTION_INTEGRITY_01_NOT_FOUND');

  const controlHeaderAudit = qboIntegrityAuditHeaders_(
    controlSheet,
    QBO_FORWARD_INGESTION_HEADERS_,
    '05_Forward_Ingestion_Control'
  );
  const sourceHeaderAudit = qboIntegrityAuditHeaders_(
    sourceSheet,
    QBO_STATE_CAPTURE_HEADERS.SOURCES,
    '01_Sources'
  );

  const controlRows = qboIntegrityReadSheetRows_(controlSheet, QBO_FORWARD_INGESTION_HEADERS_);
  const sourceRows = qboIntegrityReadSheetRows_(sourceSheet, QBO_STATE_CAPTURE_HEADERS.SOURCES);
  const sourceById = Object.create(null);
  sourceRows.forEach(function(row) {
    const id = String(row.SourceId || '').trim();
    if (id && !sourceById[id]) sourceById[id] = row;
  });

  const findings = [];
  const counters = qboIntegrityNewCounters_();
  const seen05 = Object.create(null);
  const seen01 = Object.create(null);

  controlRows.forEach(function(row) {
    qboIntegrityAudit05Row_(row, sourceById, seen05, findings, counters);
  });
  sourceRows.forEach(function(row) {
    qboIntegrityAudit01Row_(row, seen01, findings, counters);
  });
  qboIntegrityAuditCrossSheet_(controlRows, sourceRows, sourceById, findings, counters);

  const result = {
    version: QBO_FORWARD_INGESTION_INTEGRITY_AUDIT_.VERSION,
    readOnly: true,
    scope: 'ALL_GOVERNED_COLUMNS_ALL_ROWS',
    sheets: {
      forwardIngestionControl: {
        sheetName: controlSheet.getName(),
        rowCount: controlRows.length,
        governedColumnCount: QBO_FORWARD_INGESTION_HEADERS_.length,
        headerAudit: controlHeaderAudit
      },
      sources: {
        sheetName: sourceSheet.getName(),
        rowCount: sourceRows.length,
        governedColumnCount: QBO_STATE_CAPTURE_HEADERS.SOURCES.length,
        headerAudit: sourceHeaderAudit
      }
    },
    summary: qboIntegrityFinalizeCounters_(counters, findings),
    historicalTimestampExceptionCount: Object.keys(QBO_FORWARD_INGESTION_HISTORICAL_EXCEPTION_CACHE_ || {}).length,
    controlledTestSourceCount: sourceRows.filter(function(r) {
      return isQboStateCaptureControlledTestRunId_(r.SourceRunId);
    }).length,
    detailsTruncated: !options.includeAllFindings && findings.length > QBO_FORWARD_INGESTION_INTEGRITY_AUDIT_.MAX_DETAIL_ROWS,
    findings: options.includeAllFindings ? findings : findings.slice(0, QBO_FORWARD_INGESTION_INTEGRITY_AUDIT_.MAX_DETAIL_ROWS),
    repairApplied: false
  };

  if (options.log !== false) {
    console.log('[STATE CAPTURE LEDGER INTEGRITY] | AUDIT SUMMARY | ' + JSON.stringify({
      version: result.version,
      readOnly: result.readOnly,
      scope: result.scope,
      summary: result.summary,
      controlledTestSourceCount: result.controlledTestSourceCount,
      detailsTruncated: result.detailsTruncated
    }, null, 2));
  }
  return result;
}

/** Backward-compatible wrapper retained from v1.5.75. */
function auditQboForwardIngestionControlIntegrity() {
  return auditQboStateCaptureLedgerIntegrity();
}

function qboIntegrityAudit05Row_(row, sourceById, seen, findings, counters) {
  const sheet = '05_Forward_Ingestion_Control';
  const rowId = String(row.IngestionSourceId || '').trim();
  const sourceType = String(row.SourceType || '').trim();
  const status = String(row.ProcessingStatus || '').trim();

  qboIntegrityRequiredText_(sheet, row, 'IngestionSourceId', rowId, findings, counters);
  qboIntegrityAllowed_(sheet, row, 'SourceType', sourceType, QBO_FORWARD_INGESTION_CONTROL_.SOURCE_TYPES, findings, counters);
  qboIntegrityRequiredText_(sheet, row, 'SourceRunId', row.SourceRunId, findings, counters);
  qboIntegrityRequiredText_(sheet, row, 'SourceUnitId', row.SourceUnitId, findings, counters);
  qboIntegrityRequiredText_(sheet, row, 'EntityType', row.EntityType, findings, counters, sourceType === 'WEBHOOK' && String(row.SourceStatus || '') === 'EVIDENCE_EXCEPTION');
  qboIntegrityRequiredText_(sheet, row, 'EvidenceFileId', row.EvidenceFileId, findings, counters);
  qboIntegrityPatternOrBlank_(sheet, row, 'EvidenceFileId', row.EvidenceFileId, QBO_FORWARD_INGESTION_INTEGRITY_AUDIT_.DRIVE_ID_RE, false, findings, counters, 'DRIVE_FILE_ID_FORMAT');
  qboIntegrityRequiredText_(sheet, row, 'EvidenceFileName', row.EvidenceFileName, findings, counters);

  const allowEvidenceBlank = sourceType === 'WEBHOOK' && String(row.SourceStatus || '') === 'EVIDENCE_EXCEPTION';
  qboIntegrityPatternOrBlank_(sheet, row, 'EvidenceHash', row.EvidenceHash, QBO_FORWARD_INGESTION_INTEGRITY_AUDIT_.SHA256_RE, allowEvidenceBlank, findings, counters, 'SHA256_FORMAT');
  if (row.EvidenceHash) {
    const expectedHashType = sourceType === 'NATIVE_CDC' ? 'SHA-256' :
      sourceType === 'FULL_EXPORT' ? 'SOURCE_LINEAGE_SHA256' :
      sourceType === 'WEBHOOK' ? 'RAW_PAYLOAD_SHA256' : '';
    qboIntegrityExact_(sheet, row, 'EvidenceHashType', row.EvidenceHashType, expectedHashType, findings, counters, 'HASH_TYPE_SOURCE_MISMATCH');
  } else {
    qboIntegrityBlankAllowed_(sheet, row, 'EvidenceHashType', row.EvidenceHashType, allowEvidenceBlank, findings, counters, 'HASH_TYPE_WITHOUT_HASH');
  }

  qboIntegrityDateRequired_(sheet, row, 'ObservedAt', row.ObservedAt, findings, counters);
  qboIntegrityDateOptional_(sheet, row, 'SourceWindowStart', row.SourceWindowStart, findings, counters);
  qboIntegrityDateOptional_(sheet, row, 'SourceWindowEnd', row.SourceWindowEnd, findings, counters);
  qboIntegrityDateOptional_(sheet, row, 'SourceResponseTime', row.SourceResponseTime, findings, counters);
  qboIntegrityDateOptional_(sheet, row, 'RequestStartedAt', row.RequestStartedAt, findings, counters);
  qboIntegrityDateOptional_(sheet, row, 'RequestCompletedAt', row.RequestCompletedAt, findings, counters);
  qboIntegrityRequiredText_(sheet, row, 'SourceStatus', row.SourceStatus, findings, counters);
  qboIntegrityAllowed_(sheet, row, 'ProcessingStatus', status,
    [QBO_FORWARD_INGESTION_CONTROL_.STATUS_AVAILABLE, QBO_FORWARD_INGESTION_CONTROL_.STATUS_PROCESSING,
     QBO_FORWARD_INGESTION_CONTROL_.STATUS_PROCESSED, QBO_FORWARD_INGESTION_CONTROL_.STATUS_BLOCKED],
    findings, counters);

  ['RecordCursor','ObservationCount','PayloadCount','ShardCount','AttemptCount'].forEach(function(col) {
    const allowBlank = col === 'ObservationCount' && status === QBO_FORWARD_INGESTION_CONTROL_.STATUS_BLOCKED;
    qboIntegrityNonnegativeInteger_(sheet, row, col, row[col], allowBlank, findings, counters);
  });

  qboIntegrityDateOptional_(sheet, row, 'ClaimExpiresAt', row.ClaimExpiresAt, findings, counters);
  qboIntegrityDateOptional_(sheet, row, 'LastHeartbeatAt', row.LastHeartbeatAt, findings, counters);
  qboIntegrityDateOptional_(sheet, row, 'LastProgressAt', row.LastProgressAt, findings, counters);
  qboIntegrityDateOptional_(sheet, row, 'ProcessedAt', row.ProcessedAt, findings, counters);
  qboIntegrityDateRequired_(sheet, row, 'RegisteredAt', row.RegisteredAt, findings, counters);

  if (rowId) {
    if (seen[rowId]) qboIntegrityFinding_(sheet, row, 'IngestionSourceId', 'DUPLICATE_INGESTION_SOURCE_ID', 'INVALID', 'firstRow=' + seen[rowId], findings, counters);
    else seen[rowId] = row.rowNumber;
  }

  qboIntegrityAudit05SourceSpecific_(row, sourceById, findings, counters);
  qboIntegrityAudit05Lifecycle_(row, findings, counters);
  qboIntegrityAudit05Chronology_(row, findings, counters);
  qboIntegrityAudit05Counts_(row, findings, counters);
}

function qboIntegrityAudit05SourceSpecific_(row, sourceById, findings, counters) {
  const sheet = '05_Forward_Ingestion_Control';
  const t = String(row.SourceType || '').trim();
  const id = String(row.IngestionSourceId || '').trim();
  const run = String(row.SourceRunId || '').trim();
  const unit = String(row.SourceUnitId || '').trim();
  const entity = String(row.EntityType || '').trim();

  if (t === 'NATIVE_CDC') {
    qboIntegrityPatternOrBlank_(sheet,row,'SourceRunId',run,QBO_FORWARD_INGESTION_INTEGRITY_AUDIT_.NATIVE_CDC_CYCLE_RE,false,findings,counters,'NATIVE_CDC_CYCLE_ID_FORMAT');
    qboIntegrityExact_(sheet,row,'SourceUnitId',unit,run + '|' + entity,findings,counters,'NATIVE_CDC_SOURCE_UNIT_ID');
    qboIntegrityExact_(sheet,row,'IngestionSourceId',id,'NATIVE_CDC|' + run + '|' + entity,findings,counters,'NATIVE_CDC_INGESTION_SOURCE_ID');
    qboIntegrityRequiredDateBySource_(sheet,row,'SourceWindowStart',row.SourceWindowStart,findings,counters);
    qboIntegrityRequiredDateBySource_(sheet,row,'SourceWindowEnd',row.SourceWindowEnd,findings,counters);
    qboIntegrityRequiredDateBySource_(sheet,row,'SourceResponseTime',row.SourceResponseTime,findings,counters);
    qboIntegrityRequiredDateBySource_(sheet,row,'RequestStartedAt',row.RequestStartedAt,findings,counters);
    qboIntegrityRequiredDateBySource_(sheet,row,'RequestCompletedAt',row.RequestCompletedAt,findings,counters);
    qboIntegrityExact_(sheet,row,'SourceStatus',row.SourceStatus,'SUCCESS',findings,counters,'NATIVE_CDC_SOURCE_STATUS');
  } else if (t === 'FULL_EXPORT') {
    qboIntegrityExact_(sheet,row,'SourceUnitId',unit,id,findings,counters,'FULL_EXPORT_SOURCE_UNIT_ID');
    if (id) qboIntegrityExact_(sheet,row,'IngestionSourceId',id,'FULL_EXPORT|' + run + '|' + qboIntegrityExportKeyFromSourceId_(id),findings,counters,'FULL_EXPORT_INGESTION_SOURCE_ID');
    ['SourceWindowStart','SourceWindowEnd','SourceResponseTime'].forEach(function(col) {
      qboIntegrityBlankExpected_(sheet,row,col,row[col],findings,counters,'FULL_EXPORT_FIELD_EXPECTED_BLANK');
    });
    const source = sourceById[id];
    if (!source) {
      qboIntegrityFinding_(sheet,row,'IngestionSourceId','FULL_EXPORT_SOURCE_NOT_IN_01','INVALID','',findings,counters);
    }
  } else if (t === 'WEBHOOK') {
    if (id.indexOf('WEBHOOK|HISTORICAL|') === 0) {
      qboIntegrityFinding_(sheet,row,'IngestionSourceId','WEBHOOK_HISTORICAL_ID_RECOGNIZED','VALID','',findings,counters);
    } else {
      qboIntegrityExact_(sheet,row,'IngestionSourceId',id,'WEBHOOK|' + run,findings,counters,'WEBHOOK_INGESTION_SOURCE_ID');
      qboIntegrityExact_(sheet,row,'SourceUnitId',unit,run,findings,counters,'WEBHOOK_SOURCE_UNIT_ID');
    }
    ['SourceWindowStart','SourceWindowEnd','SourceResponseTime','RequestStartedAt'].forEach(function(col) {
      qboIntegrityBlankExpected_(sheet,row,col,row[col],findings,counters,'WEBHOOK_FIELD_EXPECTED_BLANK');
    });
    qboIntegrityRequiredDateBySource_(sheet,row,'RequestCompletedAt',row.RequestCompletedAt,findings,counters);
  }
}

function qboIntegrityAudit05Lifecycle_(row, findings, counters) {
  const sheet = '05_Forward_Ingestion_Control';
  const s = String(row.ProcessingStatus || '').trim();
  const err = String(row.ProcessingError || '');
  const owner = String(row.ClaimOwner || '').trim();
  const expiry = row.ClaimExpiresAt;
  const attempts = qboIntegrityNum_(row.AttemptCount);
  const cursor = qboIntegrityNum_(row.RecordCursor);
  const payload = qboIntegrityNum_(row.PayloadCount);
  const shards = qboIntegrityNum_(row.ShardCount);
  const hasCommittedProgress = Number(cursor || 0) > 0 || Number(payload || 0) > 0 || Number(shards || 0) > 0;

  if (s === QBO_FORWARD_INGESTION_CONTROL_.STATUS_AVAILABLE) {
    qboIntegrityBlankExpected_(sheet,row,'ClaimOwner',owner,findings,counters,'AVAILABLE_CLAIM_OWNER');
    qboIntegrityBlankExpected_(sheet,row,'ClaimExpiresAt',expiry,findings,counters,'AVAILABLE_CLAIM_EXPIRY');
    qboIntegrityBlankExpected_(sheet,row,'ProcessedAt',row.ProcessedAt,findings,counters,'AVAILABLE_PROCESSED_AT');
    qboIntegrityBlankExpected_(sheet,row,'ProcessingError',err,findings,counters,'AVAILABLE_PROCESSING_ERROR');

    // Initial AVAILABLE rows (AttemptCount=0) may legitimately have no worker
    // lifecycle timestamps. AVAILABLE after a completed partial checkpoint is
    // different: all current adapters checkpoint with progress=true, so both
    // heartbeat and progress must survive on the row.
    if ((attempts !== null && attempts > 0) || hasCommittedProgress) {
      qboIntegrityDateRequired_(sheet,row,'LastHeartbeatAt',row.LastHeartbeatAt,findings,counters);
      qboIntegrityDateRequired_(sheet,row,'LastProgressAt',row.LastProgressAt,findings,counters);
    }
  } else if (s === QBO_FORWARD_INGESTION_CONTROL_.STATUS_PROCESSING) {
    qboIntegrityRequiredText_(sheet,row,'ClaimOwner',owner,findings,counters);
    qboIntegrityDateRequired_(sheet,row,'ClaimExpiresAt',expiry,findings,counters);
    // Claiming a row always writes LastHeartbeatAt and increments AttemptCount.
    qboIntegrityDateRequired_(sheet,row,'LastHeartbeatAt',row.LastHeartbeatAt,findings,counters);
    qboIntegrityBlankExpected_(sheet,row,'ProcessedAt',row.ProcessedAt,findings,counters,'PROCESSING_PROCESSED_AT');
    qboIntegrityBlankExpected_(sheet,row,'ProcessingError',err,findings,counters,'PROCESSING_PROCESSING_ERROR');
    // LastProgressAt can be blank on a first in-flight attempt before the first
    // checkpoint. If committed progress already exists, it must be populated.
    if (hasCommittedProgress) qboIntegrityDateRequired_(sheet,row,'LastProgressAt',row.LastProgressAt,findings,counters);
  } else if (s === QBO_FORWARD_INGESTION_CONTROL_.STATUS_PROCESSED) {
    qboIntegrityBlankExpected_(sheet,row,'ClaimOwner',owner,findings,counters,'PROCESSED_CLAIM_OWNER');
    qboIntegrityBlankExpected_(sheet,row,'ClaimExpiresAt',expiry,findings,counters,'PROCESSED_CLAIM_EXPIRY');
    // Every current source adapter, including the zero-observation terminal
    // path, completes through qboForwardIngestionCheckpoint_ with progress=true.
    qboIntegrityDateRequired_(sheet,row,'LastHeartbeatAt',row.LastHeartbeatAt,findings,counters);
    qboIntegrityDateRequired_(sheet,row,'LastProgressAt',row.LastProgressAt,findings,counters);
    qboIntegrityDateRequired_(sheet,row,'ProcessedAt',row.ProcessedAt,findings,counters);
    qboIntegrityBlankExpected_(sheet,row,'ProcessingError',err,findings,counters,'PROCESSED_PROCESSING_ERROR');
  } else if (s === QBO_FORWARD_INGESTION_CONTROL_.STATUS_BLOCKED) {
    qboIntegrityBlankExpected_(sheet,row,'ClaimOwner',owner,findings,counters,'BLOCKED_CLAIM_OWNER');
    qboIntegrityBlankExpected_(sheet,row,'ClaimExpiresAt',expiry,findings,counters,'BLOCKED_CLAIM_EXPIRY');
    qboIntegrityBlankExpected_(sheet,row,'ProcessedAt',row.ProcessedAt,findings,counters,'BLOCKED_PROCESSED_AT');
    qboIntegrityRequiredText_(sheet,row,'ProcessingError',err,findings,counters);
    // Registration is allowed to create an initially BLOCKED row without any
    // processing attempt. A row blocked by a claimed worker, however, always
    // receives a heartbeat from the claim/block path.
    if (attempts !== null && attempts > 0) qboIntegrityDateRequired_(sheet,row,'LastHeartbeatAt',row.LastHeartbeatAt,findings,counters);
    // Blocking does not itself create progress. A prior committed checkpoint
    // does, and that prior progress timestamp must remain present.
    if (hasCommittedProgress) qboIntegrityDateRequired_(sheet,row,'LastProgressAt',row.LastProgressAt,findings,counters);
  }
}

function qboIntegrityAudit05Chronology_(row, findings, counters) {
  const sheet = '05_Forward_Ingestion_Control';
  qboIntegrityDateOrder_(sheet,row,'SourceWindowStart','SourceWindowEnd',row.SourceWindowStart,row.SourceWindowEnd,findings,counters);
  qboIntegrityDateOrder_(sheet,row,'RequestStartedAt','RequestCompletedAt',row.RequestStartedAt,row.RequestCompletedAt,findings,counters);
  qboIntegrityDateOrder_(sheet,row,'RegisteredAt','LastHeartbeatAt',row.RegisteredAt,row.LastHeartbeatAt,findings,counters);
  qboIntegrityDateOrder_(sheet,row,'RegisteredAt','LastProgressAt',row.RegisteredAt,row.LastProgressAt,findings,counters);
  qboIntegrityDateOrder_(sheet,row,'RegisteredAt','ProcessedAt',row.RegisteredAt,row.ProcessedAt,findings,counters);
  qboIntegrityDateOrder_(sheet,row,'LastProgressAt','ProcessedAt',row.LastProgressAt,row.ProcessedAt,findings,counters);
}

function qboIntegrityAudit05Counts_(row, findings, counters) {
  const sheet = '05_Forward_Ingestion_Control';
  const status = String(row.ProcessingStatus || '');
  const cursor = qboIntegrityNum_(row.RecordCursor);
  const obs = qboIntegrityNum_(row.ObservationCount);
  const payload = qboIntegrityNum_(row.PayloadCount);
  const shards = qboIntegrityNum_(row.ShardCount);
  const attempts = qboIntegrityNum_(row.AttemptCount);

  if (cursor !== null && obs !== null && cursor > obs) qboIntegrityFinding_(sheet,row,'RecordCursor','CURSOR_GT_OBSERVATION_COUNT','INVALID',cursor + '>' + obs,findings,counters);
  if (payload !== null && obs !== null && payload > obs) qboIntegrityFinding_(sheet,row,'PayloadCount','PAYLOAD_GT_OBSERVATION_COUNT','INVALID',payload + '>' + obs,findings,counters);
  if (shards !== null && attempts !== null && shards > attempts) qboIntegrityFinding_(sheet,row,'ShardCount','SHARD_GT_ATTEMPT_COUNT','INVALID',shards + '>' + attempts,findings,counters);
  if (status === QBO_FORWARD_INGESTION_CONTROL_.STATUS_PROCESSED && obs !== null && cursor !== null && cursor !== obs) qboIntegrityFinding_(sheet,row,'RecordCursor','PROCESSED_CURSOR_NOT_COMPLETE','INVALID',cursor + '!=' + obs,findings,counters);
  if (status === QBO_FORWARD_INGESTION_CONTROL_.STATUS_PROCESSED && obs !== null && payload !== null && payload !== obs) qboIntegrityFinding_(sheet,row,'PayloadCount','PROCESSED_PAYLOAD_COUNT_NOT_OBSERVATION_COUNT','INVALID',payload + '!=' + obs,findings,counters);
  if (attempts !== null && attempts === 0 && status !== QBO_FORWARD_INGESTION_CONTROL_.STATUS_AVAILABLE) qboIntegrityFinding_(sheet,row,'AttemptCount','NON_AVAILABLE_WITH_ZERO_ATTEMPTS','INVALID','',findings,counters);
}

function qboIntegrityAudit01Row_(row, seen, findings, counters) {
  const sheet = '01_Sources';
  const id = String(row.SourceId || '').trim();
  const type = String(row.SourceAcquisitionType || '').trim();
  const run = String(row.SourceRunId || '').trim();
  const exportKey = String(row.ExportKey || '').trim();
  const status = String(row.ProcessingStatus || '').trim();

  qboIntegrityRequiredText_(sheet,row,'SourceId',id,findings,counters);
  qboIntegrityAllowed_(sheet,row,'SourceAcquisitionType',type,[QBO_STATE_CAPTURE.SOURCE_ACQUISITION_TYPE,QBO_STATE_CAPTURE.LEGACY_SOURCE_ACQUISITION_TYPE],findings,counters);
  qboIntegrityRequiredText_(sheet,row,'ExportKey',exportKey,findings,counters);
  qboIntegrityRequiredText_(sheet,row,'ExportFunction',row.ExportFunction,findings,counters);
  qboIntegrityDateOptional_(sheet,row,'ObservationStartedAt',row.ObservationStartedAt,findings,counters);
  qboIntegrityDateRequired_(sheet,row,'ObservationCompletedAt',row.ObservationCompletedAt,findings,counters);
  qboIntegrityRequiredText_(sheet,row,'MasterBackupFileId',row.MasterBackupFileId,findings,counters);
  qboIntegrityPatternOrBlank_(sheet,row,'MasterBackupFileId',row.MasterBackupFileId,QBO_FORWARD_INGESTION_INTEGRITY_AUDIT_.DRIVE_ID_RE,false,findings,counters,'DRIVE_FILE_ID_FORMAT');
  qboIntegrityRequiredText_(sheet,row,'MasterBackupFileName',row.MasterBackupFileName,findings,counters);
  qboIntegrityAllowed_(sheet,row,'SourceLineageBasis',row.SourceLineageBasis,[QBO_STATE_CAPTURE.LINEAGE_BASIS_RUN_HISTORY,QBO_STATE_CAPTURE.LINEAGE_BASIS_PRE_RUN_HISTORY],findings,counters);
  qboIntegrityAllowed_(sheet,row,'SourceScopeType',row.SourceScopeType,[QBO_STATE_CAPTURE.RAW_SCOPE_ALL_RETRIEVABLE,QBO_STATE_CAPTURE.PREFERENCES_SCOPE],findings,counters);
  qboIntegrityDateOptional_(sheet,row,'SourceScopeStart',row.SourceScopeStart,findings,counters);
  qboIntegrityDateOptional_(sheet,row,'SourceScopeEnd',row.SourceScopeEnd,findings,counters);
  qboIntegrityBoolean_(sheet,row,'SourceScopeComplete',row.SourceScopeComplete,findings,counters);
  qboIntegrityExact_(sheet,row,'SourceStatus',row.SourceStatus,QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE,findings,counters,'SOURCE_STATUS_UNEXPECTED');
  qboIntegrityDateRequired_(sheet,row,'RegisteredAt',row.RegisteredAt,findings,counters);
  qboIntegrityDateOptional_(sheet,row,'ProcessedAt',row.ProcessedAt,findings,counters);
  qboIntegrityAllowed_(sheet,row,'ProcessingStatus',status,[QBO_STATE_CAPTURE.PROCESSING_STATUS_UNPROCESSED,QBO_STATE_CAPTURE.PROCESSING_STATUS_PROCESSED,QBO_STATE_CAPTURE.PROCESSING_STATUS_ERROR],findings,counters);

  if (id) {
    if (seen[id]) qboIntegrityFinding_(sheet,row,'SourceId','DUPLICATE_SOURCE_ID','INVALID','firstRow=' + seen[id],findings,counters);
    else seen[id] = row.rowNumber;
  }

  const manifest = getQboExportManifestEntry_(exportKey);
  if (!manifest) qboIntegrityFinding_(sheet,row,'ExportKey','UNKNOWN_EXPORT_KEY','INVALID',exportKey,findings,counters);
  else qboIntegrityExact_(sheet,row,'ExportFunction',row.ExportFunction,manifest.exportFunctionName,findings,counters,'EXPORT_FUNCTION_MISMATCH');

  if (type === QBO_STATE_CAPTURE.SOURCE_ACQUISITION_TYPE) {
    qboIntegrityRequiredText_(sheet,row,'SourceRunId',run,findings,counters);
    qboIntegrityExact_(sheet,row,'SourceId',id,'FULL_EXPORT|' + run + '|' + exportKey,findings,counters,'FULL_EXPORT_SOURCE_ID');
    qboIntegrityExact_(sheet,row,'SourceLineageBasis',row.SourceLineageBasis,QBO_STATE_CAPTURE.LINEAGE_BASIS_RUN_HISTORY,findings,counters,'FULL_EXPORT_LINEAGE_BASIS');
    qboIntegrityDateRequired_(sheet,row,'ObservationStartedAt',row.ObservationStartedAt,findings,counters);
  } else if (type === QBO_STATE_CAPTURE.LEGACY_SOURCE_ACQUISITION_TYPE) {
    qboIntegrityBlankExpected_(sheet,row,'SourceRunId',run,findings,counters,'LEGACY_SOURCE_RUN_ID_EXPECTED_BLANK');
    qboIntegrityBlankExpected_(sheet,row,'ObservationStartedAt',row.ObservationStartedAt,findings,counters,'LEGACY_OBSERVATION_STARTED_EXPECTED_BLANK');
    qboIntegrityExact_(sheet,row,'SourceId',id,'FULL_EXPORT_LEGACY|' + String(row.MasterBackupFileId || '').trim() + '|' + exportKey,findings,counters,'LEGACY_SOURCE_ID');
    qboIntegrityExact_(sheet,row,'SourceLineageBasis',row.SourceLineageBasis,QBO_STATE_CAPTURE.LINEAGE_BASIS_PRE_RUN_HISTORY,findings,counters,'LEGACY_LINEAGE_BASIS');
  }

  const isPrefs = exportKey === 'PREFERENCES';
  qboIntegrityExact_(sheet,row,'SourceScopeType',row.SourceScopeType,isPrefs ? QBO_STATE_CAPTURE.PREFERENCES_SCOPE : QBO_STATE_CAPTURE.RAW_SCOPE_ALL_RETRIEVABLE,findings,counters,'SOURCE_SCOPE_TYPE');
  if (isPrefs) {
    qboIntegrityBlankExpected_(sheet,row,'SourceScopeStart',row.SourceScopeStart,findings,counters,'PREFERENCES_SCOPE_START_BLANK');
    qboIntegrityBlankExpected_(sheet,row,'SourceScopeEnd',row.SourceScopeEnd,findings,counters,'PREFERENCES_SCOPE_END_BLANK');
  }

  if (status === QBO_STATE_CAPTURE.PROCESSING_STATUS_PROCESSED) {
    qboIntegrityDateRequired_(sheet,row,'ProcessedAt',row.ProcessedAt,findings,counters);
    qboIntegrityBlankExpected_(sheet,row,'ProcessingError',row.ProcessingError,findings,counters,'PROCESSED_PROCESSING_ERROR');
  } else if (status === QBO_STATE_CAPTURE.PROCESSING_STATUS_UNPROCESSED) {
    qboIntegrityBlankExpected_(sheet,row,'ProcessedAt',row.ProcessedAt,findings,counters,'UNPROCESSED_PROCESSED_AT');
    qboIntegrityBlankExpected_(sheet,row,'ProcessingError',row.ProcessingError,findings,counters,'UNPROCESSED_PROCESSING_ERROR');
  } else if (status === QBO_STATE_CAPTURE.PROCESSING_STATUS_ERROR) {
    qboIntegrityRequiredText_(sheet,row,'ProcessingError',row.ProcessingError,findings,counters);
  }

  qboIntegrityDateOrder_(sheet,row,'ObservationStartedAt','ObservationCompletedAt',row.ObservationStartedAt,row.ObservationCompletedAt,findings,counters);
  qboIntegrityDateOrder_(sheet,row,'RegisteredAt','ProcessedAt',row.RegisteredAt,row.ProcessedAt,findings,counters);

  if (isQboStateCaptureControlledTestRunId_(run)) {
    qboIntegrityFinding_(sheet,row,'SourceRunId','CONTROLLED_TEST_SOURCE_NON_PRODUCTION','VALID','excludedFromProductionEligibility=true',findings,counters);
  }
}

function qboIntegrityAuditCrossSheet_(controlRows, sourceRows, sourceById, findings, counters) {
  controlRows.forEach(function(row) {
    if (String(row.SourceType || '') !== 'FULL_EXPORT') return;
    const source = sourceById[String(row.IngestionSourceId || '').trim()];
    if (!source) return;
    const sheet = 'CROSS_SHEET';
    qboIntegrityCrossExact_(sheet,row,'SourceRunId',row.SourceRunId,source.SourceRunId,'05_vs_01_SourceRunId',findings,counters);
    qboIntegrityCrossExact_(sheet,row,'EvidenceFileId',row.EvidenceFileId,source.MasterBackupFileId,'05_vs_01_EvidenceFileId',findings,counters);
    qboIntegrityCrossExact_(sheet,row,'EvidenceFileName',row.EvidenceFileName,source.MasterBackupFileName,'05_vs_01_EvidenceFileName',findings,counters);
    qboIntegrityCrossDateExact_(sheet,row,'ObservedAt',row.ObservedAt,source.ObservationCompletedAt,'05_vs_01_ObservedAt',findings,counters);
    // RequestStartedAt / RequestCompletedAt are not governed as exact 05-vs-01
    // equality invariants. They represent adapter/request observations and may be
    // populated under distinct writer events. Do not manufacture UNVERIFIABLE
    // findings by comparing them as if they were semantically identical.
    qboIntegrityCrossExact_(sheet,row,'SourceStatus',row.SourceStatus,source.SourceStatus,'05_vs_01_SourceStatus',findings,counters);
    if (row.RegisteredAt) {
      qboIntegrityFinding_(sheet,row,'RegisteredAt','05_REGISTERED_AT_PRESENT','VALID','01RegisteredAt=' + qboIntegrityIso_(source.RegisteredAt),findings,counters);
    } else if (source.RegisteredAt) {
      qboIntegrityFinding_(sheet,row,'RegisteredAt','05_REGISTERED_AT_EXACT_RECOVERY_EVIDENCE','INVALID','01RegisteredAt=' + qboIntegrityIso_(source.RegisteredAt),findings,counters);
    }
    if (isQboStateCaptureControlledTestRunId_(source.SourceRunId)) {
      qboIntegrityFinding_(sheet,row,'IngestionSourceId','CONTROLLED_TEST_PRESENT_IN_05','INVALID','mustRemainExcludedFromProductionProcessing',findings,counters);
    }
  });
}

function qboIntegrityAuditHeaders_(sheet, expected, label) {
  const actual = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), expected.length)).getValues()[0];
  const missing = expected.filter(function(h) { return actual.indexOf(h) < 0; });
  const unexpected = actual.filter(function(h) { return h && expected.indexOf(h) < 0; });
  const orderMismatch = expected.some(function(h, i) { return actual[i] !== h; });
  return {label:label, expectedCount:expected.length, actualNonblankCount:actual.filter(Boolean).length, missing:missing, unexpected:unexpected, orderMismatch:orderMismatch, valid:missing.length===0 && unexpected.length===0 && !orderMismatch};
}

function qboIntegrityReadSheetRows_(sheet, headers) {
  if (sheet.getLastRow() <= 1) return [];
  const actual = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  const idx = Object.create(null);
  actual.forEach(function(h,i){ if (h) idx[String(h)] = i; });
  return sheet.getRange(2,1,sheet.getLastRow()-1,sheet.getLastColumn()).getValues().map(function(values,offset){
    const row = {rowNumber:offset+2};
    headers.forEach(function(h){ row[h] = idx[h] === undefined ? '' : values[idx[h]]; });
    return row;
  });
}

function qboIntegrityNewCounters_() { return {checks:0, VALID:0, VALID_BLANK:0, INVALID:0, UNVERIFIABLE:0, bySheet:Object.create(null), byColumn:Object.create(null), byCode:Object.create(null)}; }
function qboIntegrityFinalizeCounters_(c, findings) { return {checkCount:c.checks, validCount:c.VALID, validBlankCount:c.VALID_BLANK, invalidCount:c.INVALID, unverifiableCount:c.UNVERIFIABLE, findingCount:findings.length, bySheet:c.bySheet, byColumn:c.byColumn, byCode:c.byCode}; }

function qboIntegrityFinding_(sheet,row,column,code,result,detail,findings,counters) {
  counters.checks += 1;
  counters[result] = (counters[result] || 0) + 1;
  counters.bySheet[sheet] = counters.bySheet[sheet] || {VALID:0,VALID_BLANK:0,INVALID:0,UNVERIFIABLE:0};
  counters.bySheet[sheet][result] += 1;
  const colKey = sheet + '|' + column;
  counters.byColumn[colKey] = counters.byColumn[colKey] || {VALID:0,VALID_BLANK:0,INVALID:0,UNVERIFIABLE:0};
  counters.byColumn[colKey][result] += 1;
  counters.byCode[code] = (counters.byCode[code] || 0) + 1;
  if (result === 'INVALID' || result === 'UNVERIFIABLE' || code.indexOf('CONTROLLED_TEST') >= 0 || code.indexOf('RECOVERY_EVIDENCE') >= 0) {
    findings.push({sheet:sheet,rowNumber:row.rowNumber||'',rowId:String(row.IngestionSourceId||row.SourceId||''),column:column,code:code,result:result,detail:detail||''});
  }
}

function qboIntegrityRequiredText_(sheet,row,col,value,findings,counters,blankAllowed) {
  const s = String(value || '').trim();
  if (s) qboIntegrityFinding_(sheet,row,col,'REQUIRED_TEXT_PRESENT','VALID','',findings,counters);
  else if (blankAllowed) qboIntegrityFinding_(sheet,row,col,'CONDITIONAL_BLANK_ALLOWED','VALID_BLANK','',findings,counters);
  else qboIntegrityFinding_(sheet,row,col,'REQUIRED_TEXT_BLANK','INVALID','',findings,counters);
}
function qboIntegrityAllowed_(sheet,row,col,value,allowed,findings,counters) {
  const s = String(value || '').trim();
  qboIntegrityFinding_(sheet,row,col,allowed.indexOf(s)>=0?'ALLOWED_VALUE':'VALUE_NOT_ALLOWED',allowed.indexOf(s)>=0?'VALID':'INVALID',s,findings,counters);
}
function qboIntegrityExact_(sheet,row,col,actual,expected,findings,counters,code) {
  const a = String(actual || '').trim(), e = String(expected || '').trim();
  qboIntegrityFinding_(sheet,row,col,a===e?'EXACT_MATCH':(code||'EXACT_MISMATCH'),a===e?'VALID':'INVALID','actual=' + a + ' expected=' + e,findings,counters);
}
function qboIntegrityBlankExpected_(sheet,row,col,value,findings,counters,code) {
  const blank = value === '' || value === null || value === undefined;
  qboIntegrityFinding_(sheet,row,col,blank?'EXPECTED_BLANK':(code||'EXPECTED_BLANK_NONBLANK'),blank?'VALID_BLANK':'INVALID',blank?'':'value=' + String(value),findings,counters);
}
function qboIntegrityBlankAllowed_(sheet,row,col,value,blankAllowed,findings,counters,code) {
  const blank = value === '' || value === null || value === undefined;
  if (blank && blankAllowed) qboIntegrityFinding_(sheet,row,col,'CONDITIONAL_BLANK_ALLOWED','VALID_BLANK','',findings,counters);
  else if (blank) qboIntegrityFinding_(sheet,row,col,code||'UNEXPECTED_BLANK','INVALID','',findings,counters);
  else qboIntegrityFinding_(sheet,row,col,'VALUE_PRESENT','VALID','',findings,counters);
}
function qboIntegrityPatternOrBlank_(sheet,row,col,value,re,blankAllowed,findings,counters,code) {
  const s = String(value || '').trim();
  if (!s) return qboIntegrityFinding_(sheet,row,col,blankAllowed?'CONDITIONAL_BLANK_ALLOWED':'REQUIRED_PATTERN_VALUE_BLANK',blankAllowed?'VALID_BLANK':'INVALID','',findings,counters);
  qboIntegrityFinding_(sheet,row,col,re.test(s)?'PATTERN_VALID':(code||'PATTERN_INVALID'),re.test(s)?'VALID':'INVALID',s,findings,counters);
}
function qboIntegrityDateRequired_(sheet,row,col,value,findings,counters) {
  const d = qboIntegrityDate_(value);
  if (d) {
    qboIntegrityFinding_(sheet,row,col,'DATE_VALID','VALID',d.toISOString(),findings,counters);
    return;
  }
  if (!value && qboIntegrityIsGovernedHistoricalTimestampException_(sheet, row, col)) {
    qboIntegrityFinding_(sheet,row,col,'HISTORICAL_UNRECOVERABLE_WRITER_DEFECT','VALID_BLANK',
      'Exact historical timestamp is unrecoverable; blank is retained under governed exception registry. Current/future equivalent defects remain invalid unless separately governed.',
      findings,counters);
    return;
  }
  qboIntegrityFinding_(sheet,row,col,value?'DATE_INVALID':'REQUIRED_DATE_BLANK','INVALID',String(value||''),findings,counters);
}
function qboIntegrityRequiredDateBySource_(sheet,row,col,value,findings,counters) { qboIntegrityDateRequired_(sheet,row,col,value,findings,counters); }
function qboIntegrityDateOptional_(sheet,row,col,value,findings,counters) {
  if (value === '' || value === null || value === undefined) return qboIntegrityFinding_(sheet,row,col,'OPTIONAL_DATE_BLANK','VALID_BLANK','',findings,counters);
  const d = qboIntegrityDate_(value);
  qboIntegrityFinding_(sheet,row,col,d?'DATE_VALID':'DATE_INVALID',d?'VALID':'INVALID',d?d.toISOString():String(value),findings,counters);
}
function qboIntegrityBoolean_(sheet,row,col,value,findings,counters) {
  const valid = value === true || value === false || String(value).toUpperCase()==='TRUE' || String(value).toUpperCase()==='FALSE';
  qboIntegrityFinding_(sheet,row,col,valid?'BOOLEAN_VALID':'BOOLEAN_INVALID',valid?'VALID':'INVALID',String(value),findings,counters);
}
function qboIntegrityNonnegativeInteger_(sheet,row,col,value,blankAllowed,findings,counters) {
  if ((value === '' || value === null || value === undefined) && blankAllowed) return qboIntegrityFinding_(sheet,row,col,'CONDITIONAL_BLANK_ALLOWED','VALID_BLANK','',findings,counters);
  const n = Number(value); const valid = value !== '' && isFinite(n) && n >= 0 && Math.floor(n) === n;
  qboIntegrityFinding_(sheet,row,col,valid?'NONNEGATIVE_INTEGER_VALID':'NONNEGATIVE_INTEGER_INVALID',valid?'VALID':'INVALID',String(value),findings,counters);
}
function qboIntegrityDateOrder_(sheet,row,aName,bName,aValue,bValue,findings,counters) {
  if (!aValue || !bValue) return qboIntegrityFinding_(sheet,row,aName+'->'+bName,'DATE_ORDER_NOT_APPLICABLE','VALID_BLANK','',findings,counters);
  const a = qboIntegrityDate_(aValue), b = qboIntegrityDate_(bValue);
  if (!a || !b) return qboIntegrityFinding_(sheet,row,aName+'->'+bName,'DATE_ORDER_UNVERIFIABLE','UNVERIFIABLE','',findings,counters);
  qboIntegrityFinding_(sheet,row,aName+'->'+bName,a.getTime()<=b.getTime()?'DATE_ORDER_VALID':'DATE_ORDER_REVERSED',a.getTime()<=b.getTime()?'VALID':'INVALID',a.toISOString()+' <= '+b.toISOString(),findings,counters);
}
function qboIntegrityCrossExact_(sheet,row,col,a,b,code,findings,counters) {
  const same = String(a||'').trim() === String(b||'').trim();
  qboIntegrityFinding_(sheet,row,col,same?code+'_MATCH':code+'_MISMATCH',same?'VALID':'INVALID','05=' + String(a||'') + ' 01=' + String(b||''),findings,counters);
}
function qboIntegrityCrossDateExact_(sheet,row,col,a,b,code,findings,counters) {
  const ad=qboIntegrityDate_(a), bd=qboIntegrityDate_(b);
  if (!ad || !bd) return qboIntegrityFinding_(sheet,row,col,code+'_UNVERIFIABLE','UNVERIFIABLE','',findings,counters);
  const same=ad.getTime()===bd.getTime();
  qboIntegrityFinding_(sheet,row,col,same?code+'_MATCH':code+'_MISMATCH',same?'VALID':'INVALID','05=' + ad.toISOString() + ' 01=' + bd.toISOString(),findings,counters);
}
function qboIntegrityLoadHistoricalTimestampExceptions_(ss) {
  const out = Object.create(null);
  if (!ss) return out;
  const sh = ss.getSheetByName('102_Historical_Timestamp_Exceptions');
  if (!sh || sh.getLastRow() < 2) return out;
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(function(v){ return String(v || '').trim(); });
  const idx = Object.create(null); headers.forEach(function(h,i){ idx[h]=i; });
  ['IngestionSourceId','ColumnName','ExceptionCode','Status'].forEach(function(h){ if (idx[h] === undefined) throw new Error('HISTORICAL_EXCEPTION_REGISTRY_HEADER_MISSING ' + h); });
  const values = sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues();
  values.forEach(function(r){
    const id = String(r[idx.IngestionSourceId] || '').trim();
    const col = String(r[idx.ColumnName] || '').trim();
    const code = String(r[idx.ExceptionCode] || '').trim();
    const status = String(r[idx.Status] || '').trim();
    if (!id || !col) return;
    if (status !== 'ACTIVE') return;
    if (code !== 'HISTORICAL_UNRECOVERABLE_WRITER_DEFECT') return;
    out[id + '|' + col] = true;
  });
  return out;
}

function qboIntegrityIsGovernedHistoricalTimestampException_(sheet, row, col) {
  if (sheet !== '05_Forward_Ingestion_Control') return false;
  if (['RegisteredAt','LastHeartbeatAt','LastProgressAt','ProcessedAt'].indexOf(col) < 0) return false;
  const id = String(row && row.IngestionSourceId || '').trim();
  if (!id) return false;
  const cache = QBO_FORWARD_INGESTION_HISTORICAL_EXCEPTION_CACHE_ || Object.create(null);
  return cache[id + '|' + col] === true;
}

function qboIntegrityDate_(value) { if (!value) return null; const d=value instanceof Date?value:new Date(value); return isNaN(d.getTime())?null:d; }
function qboIntegrityIso_(value) { const d=qboIntegrityDate_(value); return d?d.toISOString():String(value||''); }
function qboIntegrityNum_(value) { if (value === '' || value === null || value === undefined) return null; const n=Number(value); return isFinite(n)?n:null; }
function qboIntegrityExportKeyFromSourceId_(id) { const p=String(id||'').split('|'); return p.length>=3?p[p.length-1]:''; }
