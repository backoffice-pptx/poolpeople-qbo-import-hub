/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 69_QBO_StateCaptureProcessingAudit.js
 * Purpose     : Legacy STATE_ROW_V1 read-only audit retained for migration
 *               evidence. Its parent-row hash semantics are superseded by
 *               QBO_CANONICAL_STATE_V1 in module 71.
 *
 * Public API:
 *   - auditQboStateCaptureProcessing()
 *   - auditQboStateCaptureProcessingForExport(exportKey)
 *   - auditQboStateCaptureProcessingPaymentMethods()
 *   - auditQboStateCaptureProcessingCustomers()
 *   - auditQboStateCaptureProcessingInvoices()
 *   - resetQboStateCaptureProcessingAuditBatch()
 *   - getQboStateCaptureProcessingAuditBatchStatus()
 *   - auditNextQboStateCaptureProcessingExport()
 *
 * Architecture:
 *   - LEGACY DIAGNOSTIC ONLY. Do not use its StateHash as canonical business state.
 *   - READ ONLY with respect to QBO and governed workbooks. This module does
 *     not write to 01_Sources, 10_State_Capture, 90_Run_Log, run history,
 *     Master Backups, or current export workbooks. The resumable batch helper
 *     stores only a numeric cursor in Apps Script Properties.
 *   - Canonical source is the first (parent) sheet named by QBO_EXPORT_MANIFEST.
 *   - PREFERENCES is intentionally excluded from the first standard-entity pass.
 *   - The first eligible observation for an ExportKey establishes INITIAL_STATE.
 *   - An entity first appearing after that baseline is NEW_ENTITY.
 *   - A later differing canonical parent-row state is STATE_CHANGED.
 *   - An unchanged canonical state produces no proposed capture row.
 *   - Entity absence is not interpreted as deletion/void/restoration in Phase 2.
 *   - StateHash is SHA-256 over the complete exported parent-row state except
 *     RawJSON. RawPayloadHash hashes the stored RawJSON cell separately.
 *   - RawPayloadComplete reports whether the stored RawJSON bears the existing
 *     Sheets cell truncation marker; incomplete RawJSON does not prevent the
 *     exported-row StateHash from being evaluated.
 * ============================================================================
 */

const QBO_STATE_CAPTURE_AUDIT_HASH_VERSION_ = 'STATE_ROW_V1';
const QBO_STATE_CAPTURE_RAW_TRUNCATION_MARKER_ = '[TRUNCATED: original length ';

const QBO_STATE_CAPTURE_ENTITY_ID_HEADERS_ = Object.freeze({
  RECURRING_TRANSACTIONS: 'RecurringTransactionId'
});


const QBO_STATE_CAPTURE_AUDIT_BATCH_CURSOR_PROPERTY_ =
  'QBO_STATE_CAPTURE_AUDIT_BATCH_CURSOR_V1';

/**
 * Returns standard entity ExportKeys in manifest order. PREFERENCES is excluded
 * because it is not part of the first standard-entity State Capture pass.
 */
function getQboStateCaptureProcessingAuditBatchExportKeys_() {
  return getQboExportManifest()
    .map(function(entry) { return entry.key; })
    .filter(function(exportKey) { return exportKey !== 'PREFERENCES'; });
}

/**
 * Resets only the resumable audit cursor. No governed workbook is modified.
 */
function resetQboStateCaptureProcessingAuditBatch() {
  PropertiesService.getScriptProperties()
    .deleteProperty(QBO_STATE_CAPTURE_AUDIT_BATCH_CURSOR_PROPERTY_);

  const status = getQboStateCaptureProcessingAuditBatchStatus();
  console.log(
    '[STATE CAPTURE AUDIT BATCH] | RESET' +
    ' | nextIndex=' + status.nextIndex +
    ' | nextExport=' + (status.nextExportKey || '') +
    ' | totalExports=' + status.totalExports
  );
  return status;
}

/**
 * Reports resumable batch position without changing it.
 */
function getQboStateCaptureProcessingAuditBatchStatus() {
  const exportKeys = getQboStateCaptureProcessingAuditBatchExportKeys_();
  const raw = PropertiesService.getScriptProperties()
    .getProperty(QBO_STATE_CAPTURE_AUDIT_BATCH_CURSOR_PROPERTY_);
  let cursor = raw === null || raw === '' ? 0 : Number(raw);

  if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;
  cursor = Math.floor(cursor);
  if (cursor > exportKeys.length) cursor = exportKeys.length;

  const status = {
    version: QBO_STATE_CAPTURE.VERSION,
    mode: 'READ_ONLY_RESUMABLE_BY_EXPORT',
    nextIndex: cursor,
    completedExports: cursor,
    totalExports: exportKeys.length,
    remainingExports: Math.max(0, exportKeys.length - cursor),
    nextExportKey: cursor < exportKeys.length ? exportKeys[cursor] : '',
    complete: cursor >= exportKeys.length
  };

  console.log(JSON.stringify(status, null, 2));
  console.log(
    '[STATE CAPTURE AUDIT BATCH] | STATUS' +
    ' | completed=' + status.completedExports + '/' + status.totalExports +
    ' | next=' + (status.nextExportKey || '') +
    ' | complete=' + status.complete
  );
  return status;
}

/**
 * Audits exactly one ExportKey per invocation and advances the cursor only after
 * a clean completed audit. If execution times out or actionRequired=true, the
 * cursor remains on the same ExportKey so the next invocation safely resumes.
 *
 * This helper intentionally creates no clock trigger and does not touch the
 * production QBO export queue.
 */
function auditNextQboStateCaptureProcessingExport() {
  const exportKeys = getQboStateCaptureProcessingAuditBatchExportKeys_();
  const properties = PropertiesService.getScriptProperties();
  const raw = properties.getProperty(QBO_STATE_CAPTURE_AUDIT_BATCH_CURSOR_PROPERTY_);
  let cursor = raw === null || raw === '' ? 0 : Number(raw);

  if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;
  cursor = Math.floor(cursor);
  if (cursor >= exportKeys.length) {
    return getQboStateCaptureProcessingAuditBatchStatus();
  }

  const exportKey = exportKeys[cursor];
  console.log(
    '[STATE CAPTURE AUDIT BATCH] | START' +
    ' | index=' + cursor +
    ' | export=' + exportKey +
    ' | totalExports=' + exportKeys.length
  );

  const audit = auditQboStateCaptureProcessingInternal_(exportKey);

  if (audit.actionRequired) {
    console.error(
      '[STATE CAPTURE AUDIT BATCH] | HOLD' +
      ' | index=' + cursor +
      ' | export=' + exportKey +
      ' | reason=ACTION_REQUIRED' +
      ' | cursorAdvanced=false'
    );
    return {
      version: QBO_STATE_CAPTURE.VERSION,
      mode: 'READ_ONLY_RESUMABLE_BY_EXPORT',
      exportKey: exportKey,
      cursorAdvanced: false,
      audit: audit
    };
  }

  const nextCursor = cursor + 1;
  properties.setProperty(
    QBO_STATE_CAPTURE_AUDIT_BATCH_CURSOR_PROPERTY_,
    String(nextCursor)
  );

  const nextExportKey = nextCursor < exportKeys.length ? exportKeys[nextCursor] : '';
  console.log(
    '[STATE CAPTURE AUDIT BATCH] | COMPLETE' +
    ' | index=' + cursor +
    ' | export=' + exportKey +
    ' | cursorAdvanced=true' +
    ' | completed=' + nextCursor + '/' + exportKeys.length +
    ' | next=' + nextExportKey
  );

  return {
    version: QBO_STATE_CAPTURE.VERSION,
    mode: 'READ_ONLY_RESUMABLE_BY_EXPORT',
    exportKey: exportKey,
    cursorAdvanced: true,
    nextExportKey: nextExportKey,
    complete: nextCursor >= exportKeys.length,
    audit: audit
  };
}

/**
 * Audits every registered standard FULL_EXPORT / FULL_EXPORT_LEGACY source.
 * This can be a long-running diagnostic because each immutable Master Backup
 * must be opened and its canonical parent sheet read.
 */
function auditQboStateCaptureProcessing() {
  return auditQboStateCaptureProcessingInternal_('');
}

/**
 * Audits one ExportKey. Prefer this first while validating Phase 2 behavior.
 *
 * @param {string} exportKey QBO_EXPORT_MANIFEST key.
 */
function auditQboStateCaptureProcessingForExport(exportKey) {
  return auditQboStateCaptureProcessingInternal_(exportKey);
}

/**
 * Parameterless controlled first test for the Apps Script editor.
 */
function auditQboStateCaptureProcessingPaymentMethods() {
  return auditQboStateCaptureProcessingInternal_('PAYMENT_METHODS');
}

/**
 * Apps Script no-argument wrapper for a controlled CUSTOMERS audit.
 */
function auditQboStateCaptureProcessingCustomers() {
  return auditQboStateCaptureProcessingInternal_('CUSTOMERS');
}

function auditQboStateCaptureProcessingInternal_(requestedExportKey) {
  const startedAt = new Date();
  const normalizedExportKey = String(requestedExportKey || '').trim();

  const stateSpreadsheet = getQboStateCaptureSpreadsheet_();
  validateQboStateCaptureWorkbookStructure_(stateSpreadsheet);
  validateQboStateCaptureWorkbookLocation_(stateSpreadsheet);

  const sourceSheet = stateSpreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
  const sourceRows = loadQboStateCaptureAuditSources_(sourceSheet, normalizedExportKey);

  const manifestByKey = Object.create(null);
  getQboExportManifest().forEach(function(entry) {
    manifestByKey[entry.key] = entry;
  });

  if (normalizedExportKey && !manifestByKey[normalizedExportKey]) {
    throw new Error('Unknown QBO State Capture audit ExportKey: ' + normalizedExportKey + '.');
  }

  const summary = {
    version: QBO_STATE_CAPTURE.VERSION,
    mode: 'READ_ONLY',
    requestedExportKey: normalizedExportKey || 'ALL_STANDARD_ENTITIES',
    registeredSourcesScanned: sourceRows.length,
    eligibleSources: 0,
    processedSources: 0,
    skippedPreferenceSources: 0,
    blockedSources: 0,
    sourceRowsRead: 0,
    entitiesEvaluated: 0,
    proposedCaptureRows: 0,
    initialState: 0,
    newEntity: 0,
    stateChanged: 0,
    unchanged: 0,
    missingEntityIdRows: 0,
    duplicateEntityIdRows: 0,
    rawPayloadIncomplete: 0,
    actionRequired: false,
    blockedDetails: []
  };

  const stateByExportKey = Object.create(null);
  const baselineSeenByExportKey = Object.create(null);

  console.log(
    '[STATE CAPTURE AUDIT] | START' +
    ' | version=' + QBO_STATE_CAPTURE.VERSION +
    ' | mode=READ_ONLY' +
    ' | export=' + (normalizedExportKey || 'ALL_STANDARD_ENTITIES') +
    ' | sources=' + sourceRows.length
  );

  sourceRows.forEach(function(source) {
    const manifestEntry = manifestByKey[source.exportKey];
    if (!manifestEntry) {
      recordQboStateCaptureAuditBlock_(summary, source, 'UNKNOWN_EXPORT_KEY');
      return;
    }

    if (source.exportKey === 'PREFERENCES') {
      summary.skippedPreferenceSources += 1;
      console.log(
        '[STATE CAPTURE AUDIT] | SOURCE SKIPPED' +
        ' | sourceId=' + source.sourceId +
        ' | export=PREFERENCES' +
        ' | reason=SPECIAL_SOURCE_NOT_IN_STANDARD_ENTITY_PASS'
      );
      return;
    }

    if (
      source.sourceStatus !== QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE ||
      (source.sourceAcquisitionType !== QBO_STATE_CAPTURE.SOURCE_ACQUISITION_TYPE &&
       source.sourceAcquisitionType !== QBO_STATE_CAPTURE.LEGACY_SOURCE_ACQUISITION_TYPE)
    ) {
      return;
    }

    summary.eligibleSources += 1;

    try {
      const result = auditQboStateCaptureSource_(
        source,
        manifestEntry,
        stateByExportKey,
        baselineSeenByExportKey
      );

      summary.processedSources += 1;
      summary.sourceRowsRead += result.sourceRowsRead;
      summary.entitiesEvaluated += result.entitiesEvaluated;
      summary.proposedCaptureRows += result.proposedCaptureRows;
      summary.initialState += result.initialState;
      summary.newEntity += result.newEntity;
      summary.stateChanged += result.stateChanged;
      summary.unchanged += result.unchanged;
      summary.missingEntityIdRows += result.missingEntityIdRows;
      summary.duplicateEntityIdRows += result.duplicateEntityIdRows;
      summary.rawPayloadIncomplete += result.rawPayloadIncomplete;

      if (result.missingEntityIdRows || result.duplicateEntityIdRows) {
        summary.actionRequired = true;
      }

      console.log(
        '[STATE CAPTURE AUDIT] | SOURCE' +
        ' | sourceId=' + source.sourceId +
        ' | export=' + source.exportKey +
        ' | sheet=' + result.sourceSheetName +
        ' | rows=' + result.sourceRowsRead +
        ' | initial=' + result.initialState +
        ' | new=' + result.newEntity +
        ' | changed=' + result.stateChanged +
        ' | unchanged=' + result.unchanged +
        ' | rawIncomplete=' + result.rawPayloadIncomplete +
        ' | missingId=' + result.missingEntityIdRows +
        ' | duplicateId=' + result.duplicateEntityIdRows
      );
    } catch (error) {
      recordQboStateCaptureAuditBlock_(
        summary,
        source,
        error && error.message ? error.message : String(error)
      );
    }
  });

  summary.durationMs = new Date().getTime() - startedAt.getTime();
  summary.actionRequired = summary.actionRequired || summary.blockedSources > 0;

  console.log(JSON.stringify(summary, null, 2));
  console.log(
    '[STATE CAPTURE AUDIT] | COMPLETE' +
    ' | export=' + (normalizedExportKey || 'ALL_STANDARD_ENTITIES') +
    ' | processedSources=' + summary.processedSources +
    ' | proposed=' + summary.proposedCaptureRows +
    ' | initial=' + summary.initialState +
    ' | new=' + summary.newEntity +
    ' | changed=' + summary.stateChanged +
    ' | unchanged=' + summary.unchanged +
    ' | blocked=' + summary.blockedSources +
    ' | actionRequired=' + summary.actionRequired +
    ' | durationMs=' + summary.durationMs
  );

  return summary;
}

function loadQboStateCaptureAuditSources_(sourceSheet, requestedExportKey) {
  const lastRow = sourceSheet.getLastRow();
  if (lastRow <= 1) {
    return [];
  }

  const headers = sourceSheet.getRange(1, 1, 1, sourceSheet.getLastColumn()).getValues()[0];
  const index = buildQboStateCaptureAuditHeaderIndex_(headers);
  const required = [
    'SourceId',
    'SourceAcquisitionType',
    'ExportKey',
    'ExportFunction',
    'ObservationStartedAt',
    'ObservationCompletedAt',
    'MasterBackupFileId',
    'MasterBackupFileName',
    'SourceStatus',
    'RegisteredAt'
  ];
  required.forEach(function(name) {
    if (index[name] === undefined) {
      throw new Error('01_Sources is missing required column: ' + name + '.');
    }
  });

  const values = sourceSheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const rows = [];

  values.forEach(function(row, i) {
    const exportKey = String(row[index.ExportKey] || '').trim();
    if (requestedExportKey && exportKey !== requestedExportKey) {
      return;
    }

    rows.push({
      sourceSheetRow: i + 2,
      sourceId: String(row[index.SourceId] || '').trim(),
      sourceAcquisitionType: String(row[index.SourceAcquisitionType] || '').trim(),
      sourceRunId: String(row[index.SourceRunId] || '').trim(),
      exportKey: exportKey,
      exportFunction: String(row[index.ExportFunction] || '').trim(),
      observationStartedAt: row[index.ObservationStartedAt] || '',
      observationCompletedAt: row[index.ObservationCompletedAt] || '',
      masterBackupFileId: String(row[index.MasterBackupFileId] || '').trim(),
      masterBackupFileName: String(row[index.MasterBackupFileName] || '').trim(),
      sourceStatus: String(row[index.SourceStatus] || '').trim(),
      registeredAt: row[index.RegisteredAt] || ''
    });
  });

  rows.sort(function(a, b) {
    const aTime = qboStateCaptureAuditTime_(a.observationCompletedAt);
    const bTime = qboStateCaptureAuditTime_(b.observationCompletedAt);
    if (aTime !== bTime) return aTime - bTime;

    const aRegistered = qboStateCaptureAuditTime_(a.registeredAt);
    const bRegistered = qboStateCaptureAuditTime_(b.registeredAt);
    if (aRegistered !== bRegistered) return aRegistered - bRegistered;

    return a.sourceSheetRow - b.sourceSheetRow;
  });

  return rows;
}

function auditQboStateCaptureSource_(source, manifestEntry, stateByExportKey, baselineSeenByExportKey) {
  if (!source.masterBackupFileId || !source.masterBackupFileName) {
    throw new Error('MISSING_MASTER_BACKUP_LINEAGE');
  }

  if (!source.observationCompletedAt) {
    throw new Error('MISSING_OBSERVATION_COMPLETED_AT');
  }

  if (manifestEntry.exportFunctionName !== source.exportFunction) {
    throw new Error(
      'EXPORT_FUNCTION_MISMATCH expected=' + manifestEntry.exportFunctionName +
      ' found=' + source.exportFunction
    );
  }

  const backupValidation = validateQboMasterBackupReference_(
    source.masterBackupFileId,
    source.masterBackupFileName
  );
  if (!backupValidation.valid) {
    throw new Error('INVALID_MASTER_BACKUP_REFERENCE ' + backupValidation.reason);
  }

  const sourceSpreadsheet = SpreadsheetApp.openById(source.masterBackupFileId);
  const sourceSheetName = manifestEntry.sheetNames[0];
  const sourceSheet = sourceSpreadsheet.getSheetByName(sourceSheetName);
  if (!sourceSheet) {
    throw new Error('MISSING_CANONICAL_PARENT_SHEET ' + sourceSheetName);
  }

  const lastRow = sourceSheet.getLastRow();
  const lastColumn = sourceSheet.getLastColumn();
  if (lastRow < 1 || lastColumn < 1) {
    throw new Error('EMPTY_CANONICAL_PARENT_SHEET ' + sourceSheetName);
  }

  const values = sourceSheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values[0].map(function(v) { return String(v || '').trim(); });
  const index = buildQboStateCaptureAuditHeaderIndex_(headers);

  const entityIdHeader = QBO_STATE_CAPTURE_ENTITY_ID_HEADERS_[source.exportKey] || 'Id';
  const required = [entityIdHeader, 'SyncToken', 'CreateTime', 'LastUpdatedTime', 'RawJSON'];
  required.forEach(function(name) {
    if (index[name] === undefined) {
      throw new Error(
        'CANONICAL_PARENT_SCHEMA_MISSING_COLUMN ' + name +
        ' sheet=' + sourceSheetName
      );
    }
  });

  if (!stateByExportKey[source.exportKey]) {
    stateByExportKey[source.exportKey] = Object.create(null);
  }
  const latestState = stateByExportKey[source.exportKey];
  const isBaselineSource = !baselineSeenByExportKey[source.exportKey];
  const idsSeenInSource = Object.create(null);

  const result = {
    sourceSheetName: sourceSheetName,
    sourceRowsRead: Math.max(0, values.length - 1),
    entitiesEvaluated: 0,
    proposedCaptureRows: 0,
    initialState: 0,
    newEntity: 0,
    stateChanged: 0,
    unchanged: 0,
    missingEntityIdRows: 0,
    duplicateEntityIdRows: 0,
    rawPayloadIncomplete: 0
  };

  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];
    const entityId = String(row[index[entityIdHeader]] || '').trim();
    if (!entityId) {
      result.missingEntityIdRows += 1;
      continue;
    }

    if (idsSeenInSource[entityId]) {
      result.duplicateEntityIdRows += 1;
      continue;
    }
    idsSeenInSource[entityId] = true;

    result.entitiesEvaluated += 1;

    const rawPayload = String(row[index.RawJSON] || '');
    const rawPayloadComplete = rawPayload.indexOf(QBO_STATE_CAPTURE_RAW_TRUNCATION_MARKER_) === -1;
    if (!rawPayloadComplete) {
      result.rawPayloadIncomplete += 1;
    }

    const stateHash = qboStateCaptureAuditStateHash_(
      source.exportKey,
      manifestEntry.entityName,
      headers,
      row,
      index.RawJSON
    );

    const prior = latestState[entityId];
    if (isBaselineSource) {
      result.initialState += 1;
      result.proposedCaptureRows += 1;
    } else if (!prior) {
      result.newEntity += 1;
      result.proposedCaptureRows += 1;
    } else if (prior.stateHash !== stateHash) {
      result.stateChanged += 1;
      result.proposedCaptureRows += 1;
    } else {
      result.unchanged += 1;
    }

    latestState[entityId] = {
      stateHash: stateHash,
      rawPayloadHash: qboStateCaptureAuditSha256_(rawPayload),
      rawPayloadComplete: rawPayloadComplete,
      qboSyncToken: row[index.SyncToken],
      qboCreateTime: row[index.CreateTime],
      qboLastUpdatedTime: row[index.LastUpdatedTime],
      sourceId: source.sourceId,
      sourceRowNumber: rowIndex + 1
    };
  }

  baselineSeenByExportKey[source.exportKey] = true;
  return result;
}

function qboStateCaptureAuditStateHash_(exportKey, entityType, headers, row, rawJsonIndex) {
  const fields = [];
  for (let i = 0; i < headers.length; i += 1) {
    if (i === rawJsonIndex) continue;
    fields.push([headers[i], qboStateCaptureAuditCanonicalCell_(row[i])]);
  }

  return qboStateCaptureAuditSha256_(JSON.stringify({
    version: QBO_STATE_CAPTURE_AUDIT_HASH_VERSION_,
    exportKey: exportKey,
    entityType: entityType,
    fields: fields
  }));
}

function qboStateCaptureAuditCanonicalCell_(value) {
  if (value === null || value === undefined || value === '') return ['BLANK', ''];
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return ['DATE', value.toISOString()];
  }
  if (typeof value === 'boolean') return ['BOOLEAN', value ? 'true' : 'false'];
  if (typeof value === 'number') return ['NUMBER', String(value)];
  return ['STRING', String(value)];
}

function qboStateCaptureAuditSha256_(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value === undefined || value === null ? '' : value),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(byte) {
    return ('0' + ((byte + 256) % 256).toString(16)).slice(-2);
  }).join('');
}

function buildQboStateCaptureAuditHeaderIndex_(headers) {
  const index = Object.create(null);
  headers.forEach(function(header, i) {
    const name = String(header || '').trim();
    if (name && index[name] === undefined) {
      index[name] = i;
    }
  });
  return index;
}

function qboStateCaptureAuditTime_(value) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const date = Object.prototype.toString.call(value) === '[object Date]'
    ? value
    : new Date(value);
  const time = date.getTime();
  return isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

function recordQboStateCaptureAuditBlock_(summary, source, reason) {
  summary.blockedSources += 1;
  summary.actionRequired = true;
  if (summary.blockedDetails.length < 100) {
    summary.blockedDetails.push({
      sourceSheetRow: source.sourceSheetRow,
      sourceId: source.sourceId,
      exportKey: source.exportKey,
      reason: reason
    });
  }

  console.error(
    '[STATE CAPTURE AUDIT] | SOURCE BLOCKED' +
    ' | sourceId=' + source.sourceId +
    ' | export=' + source.exportKey +
    ' | reason=' + reason
  );
}

/**
 * Apps Script editor wrapper for a read-only INVOICES State Capture processing audit.
 */
function auditQboStateCaptureProcessingInvoices() {
  return auditQboStateCaptureProcessingForExport('INVOICES');
}
