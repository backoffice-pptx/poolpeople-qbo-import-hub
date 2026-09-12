/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 70_QBO_StateCaptureProcessing.js
 * Purpose     : Production Phase 2 State Capture writer for standard FULL_EXPORT
 *               entity observations already registered in 01_Sources.
 *
 * Public API:
 *   - testQboStateCaptureWriteReadiness()
 *   - processQboStateCapturePaymentMethods()
 *   - resetQboStateCaptureWriteBatch()
 *   - getQboStateCaptureWriteBatchStatus()
 *   - processNextQboStateCaptureWriteExport()
 *
 * Internal production integration (not yet wired into the nightly scheduler in
 * this controlled-test package):
 *   - processQboCompletedFullExportSource_(runId, exportKey)
 *   - safeProcessQboCompletedFullExportSource_(runId, exportKey)
 *
 * Idempotency / retry contract:
 *   - 01_Sources SourceId is the stable source-observation identity.
 *   - CaptureId is deterministic from SourceId + EntityId + StateHash.
 *   - A source is marked PROCESSED only after all required capture rows for that
 *     source are durably present in 10_State_Capture.
 *   - If execution stops after capture rows are appended but before the source
 *     status is updated, rerunning is safe: existing CaptureIds are detected,
 *     missing capture rows are appended, then the source is marked PROCESSED.
 *   - ERROR and UNPROCESSED sources are retryable. PROCESSED sources are no-op.
 *   - Sources for an ExportKey must be processed in observation order. A later
 *     source is blocked while an earlier eligible source remains unprocessed.
 *   - PREFERENCES remains outside the standard-entity Phase 2 pass.
 *   - No deletion/void/restored semantics are inferred from entity absence.
 *
 * State contract:
 *   - Canonical source is the manifest parent sheet only.
 *   - StateHash uses the already-audited STATE_ROW_V1 canonical hash helper from
 *     69_QBO_StateCaptureProcessingAudit.js and excludes RawJSON.
 *   - RawPayloadHash hashes the stored RawJSON cell separately.
 *   - RawPayloadComplete=false is preserved when the exporter truncation marker
 *     is present; this does not prevent canonical state capture.
 * ============================================================================
 */

const QBO_STATE_CAPTURE_WRITE_BATCH_CURSOR_PROPERTY_ =
  'QBO_STATE_CAPTURE_WRITE_BATCH_CURSOR_V1';

/**
 * Read-only readiness check before the first governed write.
 */
function testQboStateCaptureWriteReadiness() {
  const stateSpreadsheet = getQboStateCaptureSpreadsheet_();
  validateQboStateCaptureWorkbookStructure_(stateSpreadsheet);
  validateQboStateCaptureWorkbookLocation_(stateSpreadsheet);

  const sourceSheet = stateSpreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
  const stateSheet = stateSpreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.STATES);
  const sourceIndex = buildQboStateCaptureWriteHeaderIndex_(
    sourceSheet.getRange(1, 1, 1, sourceSheet.getLastColumn()).getValues()[0]
  );
  const stateIndex = buildQboStateCaptureWriteHeaderIndex_(
    stateSheet.getRange(1, 1, 1, stateSheet.getLastColumn()).getValues()[0]
  );

  ['SourceId', 'ExportKey', 'SourceStatus', 'ProcessingStatus', 'ProcessedAt', 'ProcessingError']
    .forEach(function(name) {
      if (sourceIndex[name] === undefined) {
        throw new Error('01_Sources is missing required processing column: ' + name + '.');
      }
    });

  QBO_STATE_CAPTURE_HEADERS.STATES.forEach(function(name) {
    if (stateIndex[name] === undefined) {
      throw new Error('10_State_Capture is missing required column: ' + name + '.');
    }
  });

  const result = {
    version: QBO_STATE_CAPTURE.VERSION,
    mode: 'WRITE_READINESS_READ_ONLY',
    sourceRows: Math.max(0, sourceSheet.getLastRow() - 1),
    existingCaptureRows: Math.max(0, stateSheet.getLastRow() - 1),
    standardExportKeys: getQboStateCaptureWriteBatchExportKeys_().length,
    ready: true
  };

  console.log(JSON.stringify(result, null, 2));
  console.log(
    '[STATE CAPTURE WRITE] | READINESS OK' +
    ' | version=' + result.version +
    ' | sources=' + result.sourceRows +
    ' | existingCaptureRows=' + result.existingCaptureRows +
    ' | standardExports=' + result.standardExportKeys
  );
  return result;
}

/**
 * Controlled first write target. PAYMENT_METHODS is intentionally small and was
 * already validated by the Phase 2 read-only audit.
 */
function processQboStateCapturePaymentMethods() {
  assertQboLegacyStateWriteEnabled_();
  return processQboStateCaptureExport_('PAYMENT_METHODS');
}

/**
 * Resets only the write-batch ExportKey cursor. It does not alter State Capture
 * rows or source processing statuses.
 */
function resetQboStateCaptureWriteBatch() {
  PropertiesService.getScriptProperties()
    .deleteProperty(QBO_STATE_CAPTURE_WRITE_BATCH_CURSOR_PROPERTY_);

  const status = getQboStateCaptureWriteBatchStatus();
  console.log(
    '[STATE CAPTURE WRITE BATCH] | RESET' +
    ' | nextIndex=' + status.nextIndex +
    ' | nextExport=' + (status.nextExportKey || '') +
    ' | totalExports=' + status.totalExports
  );
  return status;
}

function getQboStateCaptureWriteBatchStatus() {
  const exportKeys = getQboStateCaptureWriteBatchExportKeys_();
  const raw = PropertiesService.getScriptProperties()
    .getProperty(QBO_STATE_CAPTURE_WRITE_BATCH_CURSOR_PROPERTY_);
  let cursor = raw === null || raw === '' ? 0 : Number(raw);

  if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;
  cursor = Math.floor(cursor);
  if (cursor > exportKeys.length) cursor = exportKeys.length;

  const stateSpreadsheet = getQboStateCaptureSpreadsheet_();
  validateQboStateCaptureWorkbookStructure_(stateSpreadsheet);
  const sourceSheet = stateSpreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
  const counts = countQboStateCapturePendingStandardSources_(sourceSheet);

  const status = {
    version: QBO_STATE_CAPTURE.VERSION,
    mode: 'WRITE_RESUMABLE_BY_EXPORT',
    nextIndex: cursor,
    completedExports: cursor,
    totalExports: exportKeys.length,
    remainingExports: Math.max(0, exportKeys.length - cursor),
    nextExportKey: cursor < exportKeys.length ? exportKeys[cursor] : '',
    pendingStandardSources: counts.pending,
    processedStandardSources: counts.processed,
    errorStandardSources: counts.error,
    complete: cursor >= exportKeys.length
  };

  console.log(JSON.stringify(status, null, 2));
  console.log(
    '[STATE CAPTURE WRITE BATCH] | STATUS' +
    ' | completed=' + status.completedExports + '/' + status.totalExports +
    ' | next=' + (status.nextExportKey || '') +
    ' | pendingSources=' + status.pendingStandardSources +
    ' | errors=' + status.errorStandardSources +
    ' | complete=' + status.complete
  );
  return status;
}

/**
 * Processes one ExportKey per manual invocation. Within that ExportKey, sources
 * are processed oldest-to-newest. If Apps Script terminates mid-export, already
 * completed sources remain durable and the ExportKey cursor does not advance;
 * rerunning resumes safely from the first non-PROCESSED source.
 */
function processNextQboStateCaptureWriteExport() {
  assertQboLegacyStateWriteEnabled_();
  const exportKeys = getQboStateCaptureWriteBatchExportKeys_();
  const properties = PropertiesService.getScriptProperties();
  const raw = properties.getProperty(QBO_STATE_CAPTURE_WRITE_BATCH_CURSOR_PROPERTY_);
  let cursor = raw === null || raw === '' ? 0 : Number(raw);

  if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;
  cursor = Math.floor(cursor);
  if (cursor >= exportKeys.length) {
    return getQboStateCaptureWriteBatchStatus();
  }

  const exportKey = exportKeys[cursor];
  console.log(
    '[STATE CAPTURE WRITE BATCH] | START' +
    ' | index=' + cursor +
    ' | export=' + exportKey +
    ' | totalExports=' + exportKeys.length
  );

  const result = processQboStateCaptureExport_(exportKey);
  if (result.actionRequired) {
    console.error(
      '[STATE CAPTURE WRITE BATCH] | HOLD' +
      ' | index=' + cursor +
      ' | export=' + exportKey +
      ' | reason=ACTION_REQUIRED' +
      ' | cursorAdvanced=false'
    );
    return {
      version: QBO_STATE_CAPTURE.VERSION,
      mode: 'WRITE_RESUMABLE_BY_EXPORT',
      exportKey: exportKey,
      cursorAdvanced: false,
      result: result
    };
  }

  const nextCursor = cursor + 1;
  properties.setProperty(QBO_STATE_CAPTURE_WRITE_BATCH_CURSOR_PROPERTY_, String(nextCursor));
  const nextExportKey = nextCursor < exportKeys.length ? exportKeys[nextCursor] : '';

  console.log(
    '[STATE CAPTURE WRITE BATCH] | COMPLETE' +
    ' | index=' + cursor +
    ' | export=' + exportKey +
    ' | cursorAdvanced=true' +
    ' | completed=' + nextCursor + '/' + exportKeys.length +
    ' | next=' + nextExportKey
  );

  return {
    version: QBO_STATE_CAPTURE.VERSION,
    mode: 'WRITE_RESUMABLE_BY_EXPORT',
    exportKey: exportKey,
    cursorAdvanced: true,
    nextExportKey: nextExportKey,
    complete: nextCursor >= exportKeys.length,
    result: result
  };
}

/**
 * Production exact-source processor. The nightly scheduler will call this only
 * after the exact COMPLETE source has been auto-registered. It refuses to skip
 * older unprocessed observations for the same ExportKey.
 */
function processQboCompletedFullExportSource_(runId, exportKey) {
  assertQboLegacyStateWriteEnabled_();
  const normalizedRunId = String(runId || '').trim();
  const normalizedExportKey = String(exportKey || '').trim();
  if (!normalizedRunId || !normalizedExportKey) {
    throw new Error('State Capture exact-source processing requires runId and exportKey.');
  }
  if (normalizedExportKey === 'PREFERENCES') {
    return {
      version: QBO_STATE_CAPTURE.VERSION,
      exportKey: normalizedExportKey,
      skipped: true,
      reason: 'PREFERENCES_SPECIAL_SOURCE_NOT_IN_STANDARD_ENTITY_PASS',
      actionRequired: false
    };
  }

  const sourceId = buildQboFullExportSourceId_(normalizedRunId, normalizedExportKey);
  return processQboStateCaptureSourceById_(sourceId);
}

/**
 * Non-throwing wrapper for future scheduler integration. State Capture failure
 * must not retroactively fail an otherwise successful QBO acquisition.
 */
function safeProcessQboCompletedFullExportSource_(runId, exportKey) {
  try {
    return processQboCompletedFullExportSource_(runId, exportKey);
  } catch (error) {
    console.error(
      '[STATE CAPTURE WRITE] | AUTO PROCESS ERROR' +
      ' | runId=' + (runId || '') +
      ' | export=' + (exportKey || '') +
      ' | error=' + (error && error.message ? error.message : String(error))
    );
    return null;
  }
}

function getQboStateCaptureWriteBatchExportKeys_() {
  return getQboExportManifest()
    .map(function(entry) { return entry.key; })
    .filter(function(exportKey) { return exportKey !== 'PREFERENCES'; });
}

function processQboStateCaptureExport_(exportKey) {
  assertQboLegacyStateWriteEnabled_();
  const normalizedExportKey = String(exportKey || '').trim();
  const manifestEntry = getQboExportManifestEntry_(normalizedExportKey);
  if (!manifestEntry) {
    throw new Error('Unknown State Capture write ExportKey: ' + normalizedExportKey + '.');
  }
  if (normalizedExportKey === 'PREFERENCES') {
    throw new Error('PREFERENCES is not part of the standard entity write pass.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(QBO_STATE_CAPTURE.EXECUTION_LOCK_TIMEOUT_MS);

  const startedAt = new Date();
  const summary = {
    version: QBO_STATE_CAPTURE.VERSION,
    mode: 'WRITE',
    exportKey: normalizedExportKey,
    sourcesFound: 0,
    sourcesAlreadyProcessed: 0,
    sourcesProcessed: 0,
    sourcesFailed: 0,
    sourceRowsRead: 0,
    captureRowsRequired: 0,
    captureRowsAlreadyPresent: 0,
    captureRowsAppended: 0,
    initialState: 0,
    newEntity: 0,
    stateChanged: 0,
    unchanged: 0,
    rawPayloadIncomplete: 0,
    actionRequired: false,
    errors: []
  };

  try {
    const stateSpreadsheet = getQboStateCaptureSpreadsheet_();
    validateQboStateCaptureWorkbookStructure_(stateSpreadsheet);
    validateQboStateCaptureWorkbookLocation_(stateSpreadsheet);

    const sourceSheet = stateSpreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
    const stateSheet = stateSpreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.STATES);
    const sources = loadQboStateCaptureWriteSources_(sourceSheet, normalizedExportKey);
    summary.sourcesFound = sources.length;
    const eligibleSources = sources.filter(function(source) {
      return source.sourceStatus === QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE;
    });
    const baselineSourceId = eligibleSources.length > 0 ? eligibleSources[0].sourceId : '';

    const latestState = loadQboStateCaptureLatestStates_(stateSheet, normalizedExportKey);
    const existingCaptureIds = loadQboStateCaptureExistingCaptureIds_(stateSheet);

    console.log(
      '[STATE CAPTURE WRITE] | START' +
      ' | version=' + QBO_STATE_CAPTURE.VERSION +
      ' | export=' + normalizedExportKey +
      ' | sources=' + sources.length +
      ' | existingEntities=' + Object.keys(latestState).length
    );

    for (let i = 0; i < sources.length; i += 1) {
      const source = sources[i];
      if (source.sourceStatus !== QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE) {
        continue;
      }
      if (source.processingStatus === QBO_STATE_CAPTURE.PROCESSING_STATUS_PROCESSED) {
        summary.sourcesAlreadyProcessed += 1;
        continue;
      }

      try {
        const result = processQboStateCaptureSourceLocked_(
          stateSpreadsheet,
          sourceSheet,
          stateSheet,
          source,
          manifestEntry,
          latestState,
          existingCaptureIds,
          source.sourceId === baselineSourceId
        );
        summary.sourcesProcessed += 1;
        mergeQboStateCaptureWriteSummary_(summary, result);
      } catch (error) {
        summary.sourcesFailed += 1;
        summary.actionRequired = true;
        const message = error && error.message ? error.message : String(error);
        summary.errors.push({sourceId: source.sourceId, error: message});
        setQboStateCaptureSourceProcessingResult_(
          sourceSheet,
          source,
          QBO_STATE_CAPTURE.PROCESSING_STATUS_ERROR,
          '',
          message
        );
        console.error(
          '[STATE CAPTURE WRITE] | SOURCE ERROR' +
          ' | sourceId=' + source.sourceId +
          ' | export=' + source.exportKey +
          ' | error=' + message
        );
        break;
      }
    }

    summary.durationMs = new Date().getTime() - startedAt.getTime();
    console.log(JSON.stringify(summary, null, 2));
    console.log(
      '[STATE CAPTURE WRITE] | COMPLETE' +
      ' | export=' + normalizedExportKey +
      ' | processed=' + summary.sourcesProcessed +
      ' | alreadyProcessed=' + summary.sourcesAlreadyProcessed +
      ' | appended=' + summary.captureRowsAppended +
      ' | required=' + summary.captureRowsRequired +
      ' | initial=' + summary.initialState +
      ' | new=' + summary.newEntity +
      ' | changed=' + summary.stateChanged +
      ' | unchanged=' + summary.unchanged +
      ' | actionRequired=' + summary.actionRequired +
      ' | durationMs=' + summary.durationMs
    );
    return summary;
  } finally {
    lock.releaseLock();
  }
}

function processQboStateCaptureSourceById_(sourceId) {
  const normalizedSourceId = String(sourceId || '').trim();
  if (!normalizedSourceId) throw new Error('SourceId is required.');

  const lock = LockService.getScriptLock();
  lock.waitLock(QBO_STATE_CAPTURE.EXECUTION_LOCK_TIMEOUT_MS);

  try {
    const stateSpreadsheet = getQboStateCaptureSpreadsheet_();
    validateQboStateCaptureWorkbookStructure_(stateSpreadsheet);
    validateQboStateCaptureWorkbookLocation_(stateSpreadsheet);
    const sourceSheet = stateSpreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
    const stateSheet = stateSpreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.STATES);
    const allSources = loadQboStateCaptureWriteSources_(sourceSheet, '');
    const targetIndex = allSources.findIndex(function(source) {
      return source.sourceId === normalizedSourceId;
    });
    if (targetIndex < 0) {
      throw new Error('Registered State Capture source not found: ' + normalizedSourceId + '.');
    }

    const source = allSources[targetIndex];
    if (source.exportKey === 'PREFERENCES') {
      return {skipped: true, reason: 'PREFERENCES_SPECIAL_SOURCE_NOT_IN_STANDARD_ENTITY_PASS'};
    }
    if (source.processingStatus === QBO_STATE_CAPTURE.PROCESSING_STATUS_PROCESSED) {
      console.log('[STATE CAPTURE WRITE] | SOURCE ALREADY PROCESSED | sourceId=' + source.sourceId);
      return {sourceId: source.sourceId, alreadyProcessed: true, actionRequired: false};
    }

    const earlierPending = allSources.some(function(candidate) {
      return candidate.exportKey === source.exportKey &&
        candidate.sourceStatus === QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE &&
        candidate.processingStatus !== QBO_STATE_CAPTURE.PROCESSING_STATUS_PROCESSED &&
        compareQboStateCaptureSourceOrder_(candidate, source) < 0;
    });
    if (earlierPending) {
      throw new Error(
        'PRIOR_SOURCE_UNPROCESSED export=' + source.exportKey +
        ' targetSourceId=' + source.sourceId
      );
    }

    const exportSources = allSources.filter(function(candidate) {
      return candidate.exportKey === source.exportKey &&
        candidate.sourceStatus === QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE;
    });
    const isBaselineSource = exportSources.length > 0 &&
      exportSources[0].sourceId === source.sourceId;

    const manifestEntry = getQboExportManifestEntry_(source.exportKey);
    if (!manifestEntry) throw new Error('Unknown ExportKey: ' + source.exportKey + '.');
    const latestState = loadQboStateCaptureLatestStates_(stateSheet, source.exportKey);
    const existingCaptureIds = loadQboStateCaptureExistingCaptureIds_(stateSheet);

    return processQboStateCaptureSourceLocked_(
      stateSpreadsheet,
      sourceSheet,
      stateSheet,
      source,
      manifestEntry,
      latestState,
      existingCaptureIds,
      isBaselineSource
    );
  } finally {
    lock.releaseLock();
  }
}

function processQboStateCaptureSourceLocked_(
  stateSpreadsheet,
  sourceSheet,
  stateSheet,
  source,
  manifestEntry,
  latestState,
  existingCaptureIds,
  isBaselineSource
) {
  validateQboStateCaptureWriteSource_(source, manifestEntry);

  const sourceSpreadsheet = SpreadsheetApp.openById(source.masterBackupFileId);
  const sourceSheetName = manifestEntry.sheetNames[0];
  const canonicalSheet = sourceSpreadsheet.getSheetByName(sourceSheetName);
  if (!canonicalSheet) throw new Error('MISSING_CANONICAL_PARENT_SHEET ' + sourceSheetName);

  const lastRow = canonicalSheet.getLastRow();
  const lastColumn = canonicalSheet.getLastColumn();
  if (lastRow < 1 || lastColumn < 1) {
    throw new Error('EMPTY_CANONICAL_PARENT_SHEET ' + sourceSheetName);
  }

  const values = canonicalSheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values[0].map(function(value) { return String(value || '').trim(); });
  const index = buildQboStateCaptureWriteHeaderIndex_(headers);
  const entityIdHeader = QBO_STATE_CAPTURE_ENTITY_ID_HEADERS_[source.exportKey] || 'Id';
  [entityIdHeader, 'SyncToken', 'CreateTime', 'LastUpdatedTime', 'RawJSON']
    .forEach(function(name) {
      if (index[name] === undefined) {
        throw new Error('CANONICAL_PARENT_SCHEMA_MISSING_COLUMN ' + name + ' sheet=' + sourceSheetName);
      }
    });

  const idsSeen = Object.create(null);
  const captureRows = [];
  const stateUpdates = [];
  const result = {
    sourceId: source.sourceId,
    sourceRowsRead: Math.max(0, values.length - 1),
    captureRowsRequired: 0,
    captureRowsAlreadyPresent: 0,
    captureRowsAppended: 0,
    initialState: 0,
    newEntity: 0,
    stateChanged: 0,
    unchanged: 0,
    rawPayloadIncomplete: 0,
    actionRequired: false
  };

  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];
    const entityId = String(row[index[entityIdHeader]] || '').trim();
    if (!entityId) throw new Error('MISSING_ENTITY_ID sourceRow=' + (rowIndex + 1));
    if (idsSeen[entityId]) throw new Error('DUPLICATE_ENTITY_ID entityId=' + entityId);
    idsSeen[entityId] = true;

    const rawPayload = String(row[index.RawJSON] || '');
    const rawPayloadComplete =
      rawPayload.indexOf(QBO_STATE_CAPTURE_RAW_TRUNCATION_MARKER_) === -1;
    if (!rawPayloadComplete) result.rawPayloadIncomplete += 1;

    const stateHash = qboStateCaptureAuditStateHash_(
      source.exportKey,
      manifestEntry.entityName,
      headers,
      row,
      index.RawJSON
    );
    const rawPayloadHash = qboStateCaptureAuditSha256_(rawPayload);
    const prior = latestState[entityId];
    const captureId = buildQboStateCaptureId_(source.sourceId, entityId, stateHash);
    const existingCapture = existingCaptureIds[captureId];
    let captureReason = '';

    // On a retry after capture rows were durably appended but before 01_Sources
    // was marked PROCESSED, the deterministic CaptureId is authoritative.
    // Preserve its original reason rather than reclassifying against state rows
    // that now include this same source observation.
    if (existingCapture) {
      captureReason = existingCapture.captureReason;
      result.captureRowsRequired += 1;
      result.captureRowsAlreadyPresent += 1;
      if (captureReason === 'INITIAL_STATE') result.initialState += 1;
      if (captureReason === 'NEW_ENTITY') result.newEntity += 1;
      if (captureReason === 'STATE_CHANGED') result.stateChanged += 1;
    } else if (!prior) {
      captureReason = isBaselineSource ? 'INITIAL_STATE' : 'NEW_ENTITY';
    } else if (prior.stateHash !== stateHash) {
      captureReason = 'STATE_CHANGED';
    } else {
      result.unchanged += 1;
    }

    if (captureReason && !existingCapture) {
      result.captureRowsRequired += 1;
      if (captureReason === 'INITIAL_STATE') result.initialState += 1;
      if (captureReason === 'NEW_ENTITY') result.newEntity += 1;
      if (captureReason === 'STATE_CHANGED') result.stateChanged += 1;

      captureRows.push([
          captureId,
          QBO_STATE_CAPTURE.CAPTURE_VERSION,
          source.sourceAcquisitionType,
          source.sourceRunId,
          source.exportKey,
          source.exportFunction,
          source.observationStartedAt,
          source.observationCompletedAt,
          source.masterBackupFileId,
          source.masterBackupFileName,
          sourceSheetName,
          rowIndex + 1,
          manifestEntry.entityName,
          entityId,
          row[index.CreateTime] || '',
          row[index.LastUpdatedTime] || '',
          row[index.SyncToken] === undefined ? '' : row[index.SyncToken],
          stateHash,
          rawPayloadHash,
          rawPayloadComplete,
          captureReason,
          new Date()
        ]);
      existingCaptureIds[captureId] = {captureReason: captureReason};
    }

    stateUpdates.push({
      entityId: entityId,
      stateHash: stateHash,
      observationCompletedAt: source.observationCompletedAt,
      sourceId: source.sourceId
    });
  }

  if (captureRows.length > 0) {
    stateSheet.getRange(
      stateSheet.getLastRow() + 1,
      1,
      captureRows.length,
      QBO_STATE_CAPTURE_HEADERS.STATES.length
    ).setValues(captureRows);
    result.captureRowsAppended = captureRows.length;
    applyQboStateCaptureSheetLayout_(stateSheet);
  }

  // Update in-memory latest state only after the required capture rows have
  // been durably written (or proven already present by deterministic CaptureId).
  stateUpdates.forEach(function(update) {
    latestState[update.entityId] = update;
  });

  setQboStateCaptureSourceProcessingResult_(
    sourceSheet,
    source,
    QBO_STATE_CAPTURE.PROCESSING_STATUS_PROCESSED,
    new Date(),
    ''
  );

  console.log(
    '[STATE CAPTURE WRITE] | SOURCE COMPLETE' +
    ' | sourceId=' + source.sourceId +
    ' | export=' + source.exportKey +
    ' | rows=' + result.sourceRowsRead +
    ' | required=' + result.captureRowsRequired +
    ' | appended=' + result.captureRowsAppended +
    ' | alreadyPresent=' + result.captureRowsAlreadyPresent +
    ' | initial=' + result.initialState +
    ' | new=' + result.newEntity +
    ' | changed=' + result.stateChanged +
    ' | unchanged=' + result.unchanged +
    ' | rawIncomplete=' + result.rawPayloadIncomplete
  );

  return result;
}

function validateQboStateCaptureWriteSource_(source, manifestEntry) {
  if (source.sourceStatus !== QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE) {
    throw new Error('SOURCE_NOT_AVAILABLE status=' + source.sourceStatus);
  }
  if (source.sourceAcquisitionType !== QBO_STATE_CAPTURE.SOURCE_ACQUISITION_TYPE &&
      source.sourceAcquisitionType !== QBO_STATE_CAPTURE.LEGACY_SOURCE_ACQUISITION_TYPE) {
    throw new Error('UNSUPPORTED_SOURCE_ACQUISITION_TYPE ' + source.sourceAcquisitionType);
  }
  if (!source.observationCompletedAt) throw new Error('MISSING_OBSERVATION_COMPLETED_AT');
  if (!source.masterBackupFileId || !source.masterBackupFileName) {
    throw new Error('MISSING_MASTER_BACKUP_LINEAGE');
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
}

function loadQboStateCaptureWriteSources_(sourceSheet, requestedExportKey) {
  const lastRow = sourceSheet.getLastRow();
  if (lastRow <= 1) return [];

  const headers = sourceSheet.getRange(1, 1, 1, sourceSheet.getLastColumn()).getValues()[0];
  const index = buildQboStateCaptureWriteHeaderIndex_(headers);
  QBO_STATE_CAPTURE_HEADERS.SOURCES.forEach(function(name) {
    if (index[name] === undefined) throw new Error('01_Sources is missing required column: ' + name + '.');
  });

  const values = sourceSheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const rows = [];
  values.forEach(function(row, i) {
    const exportKey = String(row[index.ExportKey] || '').trim();
    if (requestedExportKey && exportKey !== requestedExportKey) return;
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
      registeredAt: row[index.RegisteredAt] || '',
      processedAt: row[index.ProcessedAt] || '',
      processingStatus: String(row[index.ProcessingStatus] || '').trim(),
      processingError: String(row[index.ProcessingError] || ''),
      processingStatusColumn: index.ProcessingStatus + 1,
      processedAtColumn: index.ProcessedAt + 1,
      processingErrorColumn: index.ProcessingError + 1
    });
  });
  rows.sort(compareQboStateCaptureSourceOrder_);
  return rows;
}

function compareQboStateCaptureSourceOrder_(a, b) {
  const aTime = qboStateCaptureAuditTime_(a.observationCompletedAt);
  const bTime = qboStateCaptureAuditTime_(b.observationCompletedAt);
  if (aTime !== bTime) return aTime - bTime;
  const aRegistered = qboStateCaptureAuditTime_(a.registeredAt);
  const bRegistered = qboStateCaptureAuditTime_(b.registeredAt);
  if (aRegistered !== bRegistered) return aRegistered - bRegistered;
  return a.sourceSheetRow - b.sourceSheetRow;
}

function loadQboStateCaptureLatestStates_(stateSheet, exportKey) {
  const latest = Object.create(null);
  if (stateSheet.getLastRow() <= 1) return latest;

  const headers = stateSheet.getRange(1, 1, 1, stateSheet.getLastColumn()).getValues()[0];
  const index = buildQboStateCaptureWriteHeaderIndex_(headers);
  ['ExportKey', 'EntityId', 'StateHash', 'ObservationCompletedAt', 'CapturedAt']
    .forEach(function(name) {
      if (index[name] === undefined) throw new Error('10_State_Capture missing column: ' + name + '.');
    });

  const values = stateSheet.getRange(2, 1, stateSheet.getLastRow() - 1, headers.length).getValues();
  values.forEach(function(row, i) {
    if (String(row[index.ExportKey] || '').trim() !== exportKey) return;
    const entityId = String(row[index.EntityId] || '').trim();
    if (!entityId) return;
    const candidate = {
      entityId: entityId,
      stateHash: String(row[index.StateHash] || '').trim(),
      observationCompletedAt: row[index.ObservationCompletedAt] || '',
      capturedAt: row[index.CapturedAt] || '',
      stateSheetRow: i + 2
    };
    const prior = latest[entityId];
    if (!prior || compareQboStateCaptureStateOrder_(prior, candidate) < 0) {
      latest[entityId] = candidate;
    }
  });
  return latest;
}

function compareQboStateCaptureStateOrder_(a, b) {
  const aObs = qboStateCaptureAuditTime_(a.observationCompletedAt);
  const bObs = qboStateCaptureAuditTime_(b.observationCompletedAt);
  if (aObs !== bObs) return aObs - bObs;
  const aCapture = qboStateCaptureAuditTime_(a.capturedAt);
  const bCapture = qboStateCaptureAuditTime_(b.capturedAt);
  if (aCapture !== bCapture) return aCapture - bCapture;
  return (a.stateSheetRow || 0) - (b.stateSheetRow || 0);
}

function loadQboStateCaptureExistingCaptureIds_(stateSheet) {
  const result = Object.create(null);
  if (stateSheet.getLastRow() <= 1) return result;

  const headers = stateSheet.getRange(1, 1, 1, stateSheet.getLastColumn()).getValues()[0];
  const index = buildQboStateCaptureWriteHeaderIndex_(headers);
  if (index.CaptureId === undefined || index.CaptureReason === undefined) {
    throw new Error('10_State_Capture is missing CaptureId or CaptureReason.');
  }

  const values = stateSheet.getRange(2, 1, stateSheet.getLastRow() - 1, headers.length).getValues();
  values.forEach(function(row) {
    const captureId = String(row[index.CaptureId] || '').trim();
    if (!captureId) return;
    result[captureId] = {
      captureReason: String(row[index.CaptureReason] || '').trim()
    };
  });
  return result;
}

function buildQboStateCaptureId_(sourceId, entityId, stateHash) {
  const digest = qboStateCaptureAuditSha256_(JSON.stringify({
    version: QBO_STATE_CAPTURE.CAPTURE_VERSION,
    sourceId: String(sourceId || ''),
    entityId: String(entityId || ''),
    stateHash: String(stateHash || '')
  }));
  return 'CAPTURE|' + digest;
}

function setQboStateCaptureSourceProcessingResult_(sourceSheet, source, status, processedAt, error) {
  sourceSheet.getRange(source.sourceSheetRow, source.processedAtColumn).setValue(processedAt || '');
  sourceSheet.getRange(source.sourceSheetRow, source.processingStatusColumn).setValue(status || '');
  sourceSheet.getRange(source.sourceSheetRow, source.processingErrorColumn).setValue(error || '');
  applyQboStateCaptureSheetLayout_(sourceSheet);
  source.processingStatus = status || '';
  source.processedAt = processedAt || '';
  source.processingError = error || '';
}

function mergeQboStateCaptureWriteSummary_(summary, result) {
  summary.sourceRowsRead += result.sourceRowsRead;
  summary.captureRowsRequired += result.captureRowsRequired;
  summary.captureRowsAlreadyPresent += result.captureRowsAlreadyPresent;
  summary.captureRowsAppended += result.captureRowsAppended;
  summary.initialState += result.initialState;
  summary.newEntity += result.newEntity;
  summary.stateChanged += result.stateChanged;
  summary.unchanged += result.unchanged;
  summary.rawPayloadIncomplete += result.rawPayloadIncomplete;
}


function countQboStateCapturePendingStandardSources_(sourceSheet) {
  const standard = Object.create(null);
  getQboStateCaptureWriteBatchExportKeys_().forEach(function(key) { standard[key] = true; });
  const sources = loadQboStateCaptureWriteSources_(sourceSheet, '');
  const counts = {pending: 0, processed: 0, error: 0};
  sources.forEach(function(source) {
    if (!standard[source.exportKey] || source.sourceStatus !== QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE) return;
    if (source.processingStatus === QBO_STATE_CAPTURE.PROCESSING_STATUS_PROCESSED) {
      counts.processed += 1;
    } else {
      counts.pending += 1;
      if (source.processingStatus === QBO_STATE_CAPTURE.PROCESSING_STATUS_ERROR) counts.error += 1;
    }
  });
  return counts;
}

function buildQboStateCaptureWriteHeaderIndex_(headers) {
  const index = Object.create(null);
  headers.forEach(function(header, i) {
    const name = String(header || '').trim();
    if (name && index[name] === undefined) index[name] = i;
  });
  return index;
}


/**
 * Hard guard preventing additional STATE_ROW_V1 writes while the canonical
 * v1.5.x canonical migration is active. This preserves the historical table as
 * migration evidence and prevents any additional entity from being processed
 * under superseded STATE_ROW_V1 semantics.
 */
function assertQboLegacyStateWriteEnabled_() {
  if (!QBO_STATE_CAPTURE.LEGACY_STATE_WRITE_ENABLED) {
    throw new Error(
      'LEGACY_STATE_WRITE_DISABLED: 10_State_Capture/STATE_ROW_V1 is frozen. ' +
      'Use the canonical migration/test functions in 72_QBO_StateCaptureMigration.js. ' +
      'Do not use the legacy writer for TERMS or any later export.'
    );
  }
}
