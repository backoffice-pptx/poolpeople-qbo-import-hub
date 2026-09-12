/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 72_QBO_StateCaptureMigration.js
 * Purpose     : Controlled migration/reconciliation from legacy STATE_ROW_V1
 *               evidence into the canonical Snapshot / Change / Change Detail
 *               model for all governed entity exports in the historical backfill sequence.
 *
 * Public API:
 *   - provisionQboStateCaptureCanonicalStructure()
 *   - testQboCanonicalStateMigrationReadiness()
 *   - migrateQboCanonicalStateControlledScope()
 *   - migrateQboCanonicalStatePaymentMethods()
 *   - migrateQboCanonicalStateCustomers()
 *   - migrateQboCanonicalStateItems()
 *   - migrateQboCanonicalStateClasses()
 *   - migrateQboCanonicalStateTerms()
 *   - migrateQboCanonicalStateTaxCodes()
 *   - migrateQboCanonicalStateDepartments()
 *   - migrateQboCanonicalStateVendors()
 *   - migrateQboCanonicalStateAccounts()
 *   - migrateQboCanonicalStateInvoices()
 *   - migrateQboCanonicalStatePayments()
 *   - migrateQboCanonicalStateCreditMemos()
 *   - migrateQboCanonicalStateEstimates()
 *   - migrateQboCanonicalStateBills()
 *   - migrateQboCanonicalStateBillPayments()
 *   - migrateQboCanonicalStatePurchases()
 *   - migrateQboCanonicalStateDeposits()
 *   - migrateQboCanonicalStateJournalEntries()
 *   - migrateQboCanonicalStateSalesReceipts()
 *   - migrateQboCanonicalStateRecurringTransactions()
 *   - migrateQboCanonicalStateRefundReceipts()
 *   - auditQboCanonicalStateInvoicesThroughCursor()
 *   - auditQboCanonicalStatePaymentsCurrentSource()
 *   - auditQboCanonicalStatePaymentsThroughCursor()
 *
 * Safety:
 *   - v1.5.5 retains all governed entity wrappers and adds mandatory per-source post-write reconciliation before a resumable cursor may advance.
 *   - v1.5.6 fixes general reconciliation comparison for Google Sheets scalar/date coercion.
 *   - v1.5.7 fixes date-only/timestamp strings stored in Change Detail BeforeValue/AfterValue that Sheets round-trips as Date objects; reconciliation uses the recomputed expected value as the semantic type anchor and does not change stored evidence.
 *   - v1.5.8 adds a read-only current-source audit wrapper so a failed resumable reconciliation can be diagnosed without advancing or resetting its cursor.
 *   - v1.5.9 fixes numeric-looking canonical strings in Change Detail BeforeValue/AfterValue that Sheets round-trips as numbers; reconciliation uses the recomputed expected value as the semantic type anchor and does not change stored evidence.
 *   - v1.5.10 adds a public Payments through-cursor reconciliation audit wrapper; no canonicalization, persistence, or cursor behavior changes.
 *   - Execute wrappers one at a time and review each result before continuing.
 *   - DEPOSITS is a planned completeness checkpoint because some historical Sheet RawJSON is known to be truncated.
 *   - Never rewrites or deletes 10_State_Capture legacy evidence.
 *   - Never changes existing 01_Sources processing status.
 *   - Requires complete legacy RawJSON for every row in controlled scope.
 *   - Deterministic IDs make reruns idempotent after partial writes.
 *   - A source is not cursor-complete until expected Snapshot / Change / Detail records reconcile against stored canonical rows.
 * ============================================================================
 */

function provisionQboStateCaptureCanonicalStructure() {
  return provisionQboStateCaptureWorkbook();
}

function testQboCanonicalStateMigrationReadiness() {
  const spreadsheet = getQboStateCaptureSpreadsheet_();
  initializeQboStateCaptureWorkbook_(spreadsheet);
  validateQboStateCaptureWorkbookLocation_(spreadsheet);

  const result = {
    version: QBO_STATE_CAPTURE.VERSION,
    canonicalizationVersion: QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
    controlledScope: QBO_STATE_CAPTURE.CANONICAL_MIGRATION_SCOPE.slice(),
    legacyWriteEnabled: QBO_STATE_CAPTURE.LEGACY_STATE_WRITE_ENABLED,
    sheets: {
      sources: Boolean(spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES)),
      legacyStates: Boolean(spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.STATES)),
      snapshots: Boolean(spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SNAPSHOTS)),
      changes: Boolean(spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.CHANGES)),
      changeDetail: Boolean(spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.CHANGE_DETAIL))
    },
    ready: true
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function migrateQboCanonicalStateControlledScope() {
  const results = [];
  QBO_STATE_CAPTURE.CANONICAL_MIGRATION_SCOPE.forEach(function(exportKey) {
    results.push(migrateQboCanonicalStateExport_(exportKey));
  });
  return results;
}

function migrateQboCanonicalStatePaymentMethods() {
  return migrateQboCanonicalStateExport_('PAYMENT_METHODS');
}
function migrateQboCanonicalStateCustomers() {
  return migrateQboCanonicalStateExport_('CUSTOMERS');
}
function migrateQboCanonicalStateItems() {
  return migrateQboCanonicalStateExport_('ITEMS');
}
function migrateQboCanonicalStateClasses() {
  return migrateQboCanonicalStateExport_('CLASSES');
}
function migrateQboCanonicalStateTerms() {
  return migrateQboCanonicalStateExport_('TERMS');
}
function migrateQboCanonicalStateTaxCodes() {
  return migrateQboCanonicalStateExport_('TAX_CODES');
}

function migrateQboCanonicalStateDepartments() {
  return migrateQboCanonicalStateExport_('DEPARTMENTS');
}
function migrateQboCanonicalStateVendors() {
  return migrateQboCanonicalStateExport_('VENDORS');
}
function migrateQboCanonicalStateAccounts() {
  return migrateQboCanonicalStateExport_('ACCOUNTS');
}
function migrateQboCanonicalStateInvoices() {
  return migrateNextQboCanonicalStateInvoicesBatch();
}
function resetQboCanonicalStateInvoicesMigrationBatch() {
  return resetQboCanonicalStateMigrationBatch_('INVOICES');
}
function getQboCanonicalStateInvoicesMigrationBatchStatus() {
  return getQboCanonicalStateMigrationBatchStatus_('INVOICES');
}
function auditQboCanonicalStateInvoicesThroughCursor() {
  return auditQboCanonicalStateMigrationThroughCursor_('INVOICES');
}
function migrateNextQboCanonicalStateInvoicesBatch() {
  return migrateQboCanonicalStateExportResumable_('INVOICES');
}
function migrateQboCanonicalStatePayments() {
  return migrateQboCanonicalStateExportResumable_('PAYMENTS');
}
function auditQboCanonicalStatePaymentsCurrentSource() {
  return auditQboCanonicalStateMigrationCurrentSource_('PAYMENTS');
}

/** Read-only full reconciliation audit for all Payments sources before the current cursor. */
function auditQboCanonicalStatePaymentsThroughCursor() {
  return auditQboCanonicalStateMigrationThroughCursor_('PAYMENTS');
}
function migrateQboCanonicalStateCreditMemos() {
  return migrateQboCanonicalStateExport_('CREDIT_MEMOS');
}
function migrateQboCanonicalStateEstimates() {
  return migrateQboCanonicalStateExport_('ESTIMATES');
}
function migrateQboCanonicalStateBills() {
  return migrateQboCanonicalStateExport_('BILLS');
}
function migrateQboCanonicalStateBillPayments() {
  return migrateQboCanonicalStateExport_('BILL_PAYMENTS');
}
function migrateQboCanonicalStatePurchases() {
  return migrateQboCanonicalStateExportResumable_('PURCHASES');
}
function migrateQboCanonicalStateDeposits() {
  return migrateQboCanonicalStateExportResumable_('DEPOSITS');
}
function migrateQboCanonicalStateJournalEntries() {
  return migrateQboCanonicalStateExport_('JOURNAL_ENTRIES');
}
function migrateQboCanonicalStateSalesReceipts() {
  return migrateQboCanonicalStateExport_('SALES_RECEIPTS');
}
function migrateQboCanonicalStateRecurringTransactions() {
  return migrateQboCanonicalStateExport_('RECURRING_TRANSACTIONS');
}
function migrateQboCanonicalStateRefundReceipts() {
  return migrateQboCanonicalStateExport_('REFUND_RECEIPTS');
}



/**
 * Resumable source-batched canonical migration for large entity exports.
 * The cursor advances only after an entire source is durably processed.
 * A retry of the same source is safe because Snapshot/Change/Detail IDs are deterministic.
 */
function migrateQboCanonicalStateExportResumable_(exportKey) {
  const normalizedExportKey = String(exportKey || '').trim();
  if (QBO_STATE_CAPTURE.CANONICAL_MIGRATION_SCOPE.indexOf(normalizedExportKey) === -1) {
    throw new Error('CONTROLLED_CANONICAL_MIGRATION_SCOPE_VIOLATION: ' + normalizedExportKey);
  }

  const manifestEntry = getQboExportManifestEntry_(normalizedExportKey);
  if (!manifestEntry) throw new Error('Unknown export key: ' + normalizedExportKey);

  const lock = LockService.getScriptLock();
  lock.waitLock(QBO_STATE_CAPTURE.EXECUTION_LOCK_TIMEOUT_MS);
  const startedAt = new Date();
  const ingestionRunId = 'CANONICAL_MIGRATION_BATCH|' + Utilities.getUuid();

  try {
    const spreadsheet = getQboStateCaptureSpreadsheet_();
    initializeQboStateCaptureWorkbook_(spreadsheet);
    validateQboStateCaptureWorkbookLocation_(spreadsheet);

    const sourceSheet = spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
    const snapshotSheet = spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SNAPSHOTS);
    const changeSheet = spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.CHANGES);
    const detailSheet = spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.CHANGE_DETAIL);

    const sources = loadQboStateCaptureWriteSources_(sourceSheet, normalizedExportKey)
      .filter(function(source) { return source.sourceStatus === QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE; });

    const cursorKey = qboCanonicalMigrationCursorKey_(normalizedExportKey);
    const props = PropertiesService.getScriptProperties();
    let startIndex = Number(props.getProperty(cursorKey) || 0);
    if (!isFinite(startIndex) || startIndex < 0) startIndex = 0;
    if (startIndex > sources.length) startIndex = sources.length;

    const batchSize = Math.max(1, Number(QBO_STATE_CAPTURE.CANONICAL_MIGRATION_BATCH_SIZE_SOURCES || 1));
    const endExclusive = Math.min(sources.length, startIndex + batchSize);
    const baselineSourceId = sources.length ? sources[0].sourceId : '';
    const existingSnapshotIds = qboCanonicalLoadIdSet_(snapshotSheet, 'SnapshotRecordId');
    const existingChangeIds = qboCanonicalLoadIdSet_(changeSheet, 'ChangeRecordId');
    const existingDetailIds = qboCanonicalLoadIdSet_(detailSheet, 'ChangeDetailId');

    const sourceIndexById = Object.create(null);
    sources.forEach(function(source, i) { sourceIndexById[source.sourceId] = i; });

    let stateByEntity = Object.create(null);
    if (startIndex > 0) {
      const priorSnapshotMap = qboCanonicalLoadLatestSnapshotMapThroughSource_(
        snapshotSheet, normalizedExportKey, sourceIndexById, startIndex - 1
      );
      stateByEntity = qboCanonicalLoadSourceStateOnly_(
        sources[startIndex - 1], manifestEntry, priorSnapshotMap
      );
    }

    const summary = {
      version: QBO_STATE_CAPTURE.VERSION,
      canonicalizationVersion: QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
      mode: 'CONTROLLED_CANONICAL_MIGRATION_RESUMABLE',
      exportKey: normalizedExportKey,
      sourcesFound: sources.length,
      batchStartIndex: startIndex,
      batchEndExclusive: endExclusive,
      batchSourcesPlanned: Math.max(0, endExclusive - startIndex),
      sourcesProcessedThisRun: 0,
      nextSourceIndex: startIndex,
      complete: startIndex >= sources.length,
      sourceRowsRead: 0,
      entitiesEvaluated: 0,
      snapshotsRequired: 0,
      snapshotsAppended: 0,
      changesRequired: 0,
      changesAppended: 0,
      changeDetailsRequired: 0,
      changeDetailsAppended: 0,
      initialState: 0,
      newEntity: 0,
      stateChanged: 0,
      unchanged: 0,
      metadataOnlyCollapsed: 0,
      rawPayloadIncomplete: 0,
      sourcesReconciled: 0,
      reconciliationMissing: 0,
      reconciliationUnexpected: 0,
      reconciliationMismatched: 0,
      actionRequired: false,
      errors: []
    };

    for (let sourceIndex = startIndex; sourceIndex < endExclusive; sourceIndex += 1) {
      const sourceResult = qboCanonicalMigrateSource_(
        sources[sourceIndex], manifestEntry, baselineSourceId, stateByEntity,
        snapshotSheet, changeSheet, detailSheet,
        existingSnapshotIds, existingChangeIds, existingDetailIds
      );
      Object.keys(sourceResult).forEach(function(key) {
        if (typeof sourceResult[key] === 'number' && typeof summary[key] === 'number') {
          summary[key] += sourceResult[key];
        }
      });

      SpreadsheetApp.flush();
      const reconciliation = qboCanonicalReconcileSource_(
        sources[sourceIndex], sourceResult,
        snapshotSheet, changeSheet, detailSheet
      );
      summary.reconciliationMissing += reconciliation.missing;
      summary.reconciliationUnexpected += reconciliation.unexpected;
      summary.reconciliationMismatched += reconciliation.mismatched;
      if (!reconciliation.valid) {
        summary.actionRequired = true;
        throw new Error(
          'CANONICAL_SOURCE_RECONCILIATION_FAILED export=' + normalizedExportKey +
          ' source=' + sources[sourceIndex].sourceId +
          ' missing=' + reconciliation.missing +
          ' unexpected=' + reconciliation.unexpected +
          ' mismatched=' + reconciliation.mismatched
        );
      }

      summary.sourcesReconciled += 1;
      summary.sourcesProcessedThisRun += 1;
      summary.nextSourceIndex = sourceIndex + 1;
      props.setProperty(cursorKey, String(summary.nextSourceIndex));
    }

    summary.complete = summary.nextSourceIndex >= sources.length;
    if (summary.complete) props.setProperty(cursorKey, String(sources.length));

    // Reconciliation-only value. It is inexpensive enough to calculate once the export completes.
    if (summary.complete) {
      summary.metadataOnlyCollapsed = qboCanonicalCountLegacyFalseChanges_(spreadsheet, normalizedExportKey);
    }

    qboCanonicalAppendIngestionLog_(spreadsheet, {
      ingestionRunId: ingestionRunId,
      startedAt: startedAt,
      completedAt: new Date(),
      operation: 'CONTROLLED_CANONICAL_MIGRATION_RESUMABLE',
      processingPhase: 'SOURCE_BATCH',
      status: summary.complete ? 'COMPLETE' : 'PARTIAL',
      exportKey: normalizedExportKey,
      sourceRowsScanned: summary.sourceRowsRead,
      entitiesEvaluated: summary.entitiesEvaluated,
      snapshotsCreated: summary.snapshotsAppended,
      changesCreated: summary.changesAppended,
      changeDetailsCreated: summary.changeDetailsAppended,
      unchangedEntities: summary.unchanged,
      errorCount: 0,
      actionRequired: false,
      error: ''
    });

    console.log(JSON.stringify(summary, null, 2));
    console.log('[CANONICAL MIGRATION BATCH] | ' + (summary.complete ? 'COMPLETE' : 'PARTIAL') +
      ' | export=' + normalizedExportKey +
      ' | processed=' + summary.sourcesProcessedThisRun +
      ' | nextSourceIndex=' + summary.nextSourceIndex +
      ' | totalSources=' + sources.length +
      ' | snapshots=' + summary.snapshotsAppended +
      ' | changes=' + summary.changesAppended +
      ' | details=' + summary.changeDetailsAppended);
    return summary;
  } catch (error) {
    try {
      const spreadsheet = getQboStateCaptureSpreadsheet_();
      qboCanonicalAppendIngestionLog_(spreadsheet, {
        ingestionRunId: ingestionRunId,
        startedAt: startedAt,
        completedAt: new Date(),
        operation: 'CONTROLLED_CANONICAL_MIGRATION_RESUMABLE',
        processingPhase: 'SOURCE_BATCH',
        status: 'ERROR',
        exportKey: normalizedExportKey,
        errorCount: 1,
        actionRequired: true,
        error: error && error.message ? error.message : String(error)
      });
    } catch (logError) {
      console.error('[CANONICAL MIGRATION BATCH] | ERROR LOG FAILED | ' + logError);
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function qboCanonicalMigrationCursorKey_(exportKey) {
  return QBO_STATE_CAPTURE.CANONICAL_MIGRATION_BATCH_PROPERTY_PREFIX + String(exportKey || '').trim();
}

function resetQboCanonicalStateMigrationBatch_(exportKey) {
  const normalizedExportKey = String(exportKey || '').trim();
  PropertiesService.getScriptProperties().deleteProperty(qboCanonicalMigrationCursorKey_(normalizedExportKey));
  const result = { version: QBO_STATE_CAPTURE.VERSION, exportKey: normalizedExportKey, nextSourceIndex: 0, reset: true };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function getQboCanonicalStateMigrationBatchStatus_(exportKey) {
  const normalizedExportKey = String(exportKey || '').trim();
  const spreadsheet = getQboStateCaptureSpreadsheet_();
  const sourceSheet = spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
  const sources = loadQboStateCaptureWriteSources_(sourceSheet, normalizedExportKey)
    .filter(function(source) { return source.sourceStatus === QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE; });
  const raw = PropertiesService.getScriptProperties().getProperty(qboCanonicalMigrationCursorKey_(normalizedExportKey));
  let nextSourceIndex = Number(raw || 0);
  if (!isFinite(nextSourceIndex) || nextSourceIndex < 0) nextSourceIndex = 0;
  if (nextSourceIndex > sources.length) nextSourceIndex = sources.length;
  const result = {
    version: QBO_STATE_CAPTURE.VERSION,
    exportKey: normalizedExportKey,
    totalSources: sources.length,
    nextSourceIndex: nextSourceIndex,
    remainingSources: Math.max(0, sources.length - nextSourceIndex),
    complete: sources.length > 0 && nextSourceIndex >= sources.length
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function qboCanonicalLoadLatestSnapshotMapThroughSource_(snapshotSheet, exportKey, sourceIndexById, maxSourceIndex) {
  const map = Object.create(null);
  if (!snapshotSheet || snapshotSheet.getLastRow() <= 1) return map;
  const headers = snapshotSheet.getRange(1, 1, 1, snapshotSheet.getLastColumn()).getValues()[0];
  const index = buildQboStateCaptureWriteHeaderIndex_(headers);
  ['SnapshotRecordId', 'SourceId', 'ExportKey', 'EntityId', 'CanonicalStateHash'].forEach(function(name) {
    if (index[name] === undefined) throw new Error('Missing snapshot header ' + name);
  });
  const values = snapshotSheet.getRange(2, 1, snapshotSheet.getLastRow() - 1, snapshotSheet.getLastColumn()).getValues();
  values.forEach(function(row) {
    if (String(row[index.ExportKey] || '').trim() !== exportKey) return;
    const sourceId = String(row[index.SourceId] || '').trim();
    const sourceIndex = sourceIndexById[sourceId];
    if (sourceIndex === undefined || sourceIndex > maxSourceIndex) return;
    const entityId = String(row[index.EntityId] || '').trim();
    if (!entityId) return;
    const prior = map[entityId];
    if (!prior || sourceIndex > prior.sourceIndex) {
      map[entityId] = {
        sourceIndex: sourceIndex,
        snapshotId: String(row[index.SnapshotRecordId] || '').trim(),
        canonicalHash: String(row[index.CanonicalStateHash] || '').trim()
      };
    }
  });
  return map;
}

function qboCanonicalLoadSourceStateOnly_(source, manifestEntry, priorSnapshotMap) {
  validateQboStateCaptureWriteSource_(source, manifestEntry);
  const sourceSpreadsheet = SpreadsheetApp.openById(source.masterBackupFileId);
  const sourceSheetName = manifestEntry.sheetNames[0];
  const entitySheet = sourceSpreadsheet.getSheetByName(sourceSheetName);
  if (!entitySheet) throw new Error('MISSING_CANONICAL_SOURCE_SHEET ' + sourceSheetName);
  const lastRow = entitySheet.getLastRow();
  const lastColumn = entitySheet.getLastColumn();
  const stateByEntity = Object.create(null);
  if (lastRow <= 1) return stateByEntity;
  const values = entitySheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values[0].map(function(value) { return String(value || '').trim(); });
  const index = buildQboStateCaptureWriteHeaderIndex_(headers);
  const entityIdHeader = QBO_STATE_CAPTURE_ENTITY_ID_HEADERS_[source.exportKey] || 'Id';
  [entityIdHeader, 'RawJSON'].forEach(function(name) {
    if (index[name] === undefined) throw new Error('CANONICAL_MIGRATION_SOURCE_SCHEMA_MISSING ' + name + ' sheet=' + sourceSheetName);
  });

  for (let i = 1; i < values.length; i += 1) {
    const row = values[i];
    const entityId = String(row[index[entityIdHeader]] || '').trim();
    if (!entityId) throw new Error('MISSING_ENTITY_ID sourceRow=' + (i + 1));
    const rawPayload = String(row[index.RawJSON] || '');
    if (rawPayload.indexOf(QBO_STATE_CAPTURE_RAW_TRUNCATION_MARKER_) !== -1) {
      throw new Error('CONTROLLED_MIGRATION_REQUIRES_COMPLETE_RAWJSON export=' + source.exportKey + ' entityId=' + entityId + ' source=' + source.sourceId);
    }
    let rawEntity;
    try { rawEntity = JSON.parse(rawPayload); }
    catch (error) { throw new Error('INVALID_RAWJSON entityId=' + entityId + ' source=' + source.sourceId); }
    const canonicalState = qboCanonicalizeEntityState_(source.exportKey, manifestEntry.entityName, rawEntity);
    const canonicalHash = qboCanonicalStateHash_(source.exportKey, manifestEntry.entityName, canonicalState);
    const snapshot = priorSnapshotMap[entityId];
    if (!snapshot) {
      throw new Error('MISSING_PRIOR_CANONICAL_SNAPSHOT export=' + source.exportKey + ' entityId=' + entityId + ' source=' + source.sourceId);
    }
    if (snapshot.canonicalHash !== canonicalHash) {
      throw new Error('PRIOR_CANONICAL_HASH_MISMATCH export=' + source.exportKey + ' entityId=' + entityId + ' source=' + source.sourceId);
    }
    stateByEntity[entityId] = {
      canonicalState: canonicalState,
      canonicalHash: canonicalHash,
      snapshotId: snapshot.snapshotId,
      sourceId: source.sourceId,
      observationCompletedAt: source.observationCompletedAt
    };
  }
  return stateByEntity;
}

function migrateQboCanonicalStateExport_(exportKey) {
  const normalizedExportKey = String(exportKey || '').trim();
  if (QBO_STATE_CAPTURE.CANONICAL_MIGRATION_SCOPE.indexOf(normalizedExportKey) === -1) {
    throw new Error(
      'CONTROLLED_CANONICAL_MIGRATION_SCOPE_VIOLATION: ' + normalizedExportKey +
      ' is not allowed by the governed canonical migration scope.'
    );
  }

  const manifestEntry = getQboExportManifestEntry_(normalizedExportKey);
  if (!manifestEntry) throw new Error('Unknown export key: ' + normalizedExportKey);

  const lock = LockService.getScriptLock();
  lock.waitLock(QBO_STATE_CAPTURE.EXECUTION_LOCK_TIMEOUT_MS);
  const startedAt = new Date();
  const ingestionRunId = 'CANONICAL_MIGRATION|' + Utilities.getUuid();

  try {
    const spreadsheet = getQboStateCaptureSpreadsheet_();
    initializeQboStateCaptureWorkbook_(spreadsheet);
    validateQboStateCaptureWorkbookLocation_(spreadsheet);

    const sourceSheet = spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
    const snapshotSheet = spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SNAPSHOTS);
    const changeSheet = spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.CHANGES);
    const detailSheet = spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.CHANGE_DETAIL);

    const sources = loadQboStateCaptureWriteSources_(sourceSheet, normalizedExportKey)
      .filter(function(source) {
        return source.sourceStatus === QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE;
      });

    const baselineSourceId = sources.length ? sources[0].sourceId : '';
    const existingSnapshotIds = qboCanonicalLoadIdSet_(snapshotSheet, 'SnapshotRecordId');
    const existingChangeIds = qboCanonicalLoadIdSet_(changeSheet, 'ChangeRecordId');
    const existingDetailIds = qboCanonicalLoadIdSet_(detailSheet, 'ChangeDetailId');
    const stateByEntity = Object.create(null);

    const summary = {
      version: QBO_STATE_CAPTURE.VERSION,
      canonicalizationVersion: QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
      mode: 'CONTROLLED_CANONICAL_MIGRATION',
      exportKey: normalizedExportKey,
      sourcesFound: sources.length,
      sourceRowsRead: 0,
      entitiesEvaluated: 0,
      snapshotsRequired: 0,
      snapshotsAppended: 0,
      changesRequired: 0,
      changesAppended: 0,
      changeDetailsRequired: 0,
      changeDetailsAppended: 0,
      initialState: 0,
      newEntity: 0,
      stateChanged: 0,
      unchanged: 0,
      metadataOnlyCollapsed: 0,
      rawPayloadIncomplete: 0,
      actionRequired: false,
      errors: []
    };

    sources.forEach(function(source) {
      const sourceResult = qboCanonicalMigrateSource_(
        source,
        manifestEntry,
        baselineSourceId,
        stateByEntity,
        snapshotSheet,
        changeSheet,
        detailSheet,
        existingSnapshotIds,
        existingChangeIds,
        existingDetailIds
      );
      Object.keys(sourceResult).forEach(function(key) {
        if (typeof sourceResult[key] === 'number' && typeof summary[key] === 'number') {
          summary[key] += sourceResult[key];
        }
      });
    });

    summary.metadataOnlyCollapsed = qboCanonicalCountLegacyFalseChanges_(
      spreadsheet,
      normalizedExportKey,
      stateByEntity
    );

    qboCanonicalAppendIngestionLog_(spreadsheet, {
      ingestionRunId: ingestionRunId,
      startedAt: startedAt,
      completedAt: new Date(),
      operation: 'CONTROLLED_CANONICAL_MIGRATION',
      processingPhase: 'STEP_6_PREVALIDATION',
      status: 'COMPLETE',
      exportKey: normalizedExportKey,
      sourceRowsScanned: summary.sourceRowsRead,
      entitiesEvaluated: summary.entitiesEvaluated,
      snapshotsCreated: summary.snapshotsAppended,
      changesCreated: summary.changesAppended,
      changeDetailsCreated: summary.changeDetailsAppended,
      unchangedEntities: summary.unchanged,
      errorCount: 0,
      actionRequired: false,
      error: ''
    });

    console.log(JSON.stringify(summary, null, 2));
    console.log(
      '[CANONICAL MIGRATION] | COMPLETE' +
      ' | export=' + normalizedExportKey +
      ' | snapshots=' + summary.snapshotsAppended +
      ' | changes=' + summary.changesAppended +
      ' | details=' + summary.changeDetailsAppended +
      ' | unchanged=' + summary.unchanged
    );
    return summary;
  } catch (error) {
    try {
      const spreadsheet = getQboStateCaptureSpreadsheet_();
      qboCanonicalAppendIngestionLog_(spreadsheet, {
        ingestionRunId: ingestionRunId,
        startedAt: startedAt,
        completedAt: new Date(),
        operation: 'CONTROLLED_CANONICAL_MIGRATION',
        processingPhase: 'STEP_6_PREVALIDATION',
        status: 'ERROR',
        exportKey: normalizedExportKey,
        errorCount: 1,
        actionRequired: true,
        error: error && error.message ? error.message : String(error)
      });
    } catch (logError) {
      console.error('[CANONICAL MIGRATION] | ERROR LOG FAILED | ' + logError);
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function qboCanonicalMigrateSource_(
  source,
  manifestEntry,
  baselineSourceId,
  stateByEntity,
  snapshotSheet,
  changeSheet,
  detailSheet,
  existingSnapshotIds,
  existingChangeIds,
  existingDetailIds,
  options
) {
  validateQboStateCaptureWriteSource_(source, manifestEntry);
  const writeEnabled = !options || options.writeEnabled !== false;

  const sourceSpreadsheet = SpreadsheetApp.openById(source.masterBackupFileId);
  const sourceSheetName = manifestEntry.sheetNames[0];
  const entitySheet = sourceSpreadsheet.getSheetByName(sourceSheetName);
  if (!entitySheet) throw new Error('MISSING_CANONICAL_SOURCE_SHEET ' + sourceSheetName);

  const lastRow = entitySheet.getLastRow();
  const lastColumn = entitySheet.getLastColumn();
  const result = {
    sourceRowsRead: Math.max(0, lastRow - 1),
    entitiesEvaluated: 0,
    snapshotsRequired: 0,
    snapshotsAppended: 0,
    changesRequired: 0,
    changesAppended: 0,
    changeDetailsRequired: 0,
    changeDetailsAppended: 0,
    initialState: 0,
    newEntity: 0,
    stateChanged: 0,
    unchanged: 0,
    rawPayloadIncomplete: 0,
    expectedSnapshots: [],
    expectedChanges: [],
    expectedDetails: []
  };
  if (lastRow <= 1) return result;

  const values = entitySheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values[0].map(function(value) { return String(value || '').trim(); });
  const index = buildQboStateCaptureWriteHeaderIndex_(headers);
  const entityIdHeader = QBO_STATE_CAPTURE_ENTITY_ID_HEADERS_[source.exportKey] || 'Id';
  [entityIdHeader, 'SyncToken', 'CreateTime', 'LastUpdatedTime', 'RawJSON'].forEach(function(name) {
    if (index[name] === undefined) {
      throw new Error('CANONICAL_MIGRATION_SOURCE_SCHEMA_MISSING ' + name + ' sheet=' + sourceSheetName);
    }
  });

  const idsSeen = Object.create(null);
  const snapshotRows = [];
  const changeRows = [];
  const detailRows = [];
  const capturedAt = new Date();

  for (let i = 1; i < values.length; i += 1) {
    const row = values[i];
    const entityId = String(row[index[entityIdHeader]] || '').trim();
    if (!entityId) throw new Error('MISSING_ENTITY_ID sourceRow=' + (i + 1));
    if (idsSeen[entityId]) throw new Error('DUPLICATE_ENTITY_ID entityId=' + entityId);
    idsSeen[entityId] = true;

    const rawPayload = String(row[index.RawJSON] || '');
    const rawComplete = rawPayload.indexOf(QBO_STATE_CAPTURE_RAW_TRUNCATION_MARKER_) === -1;
    if (!rawComplete) {
      result.rawPayloadIncomplete += 1;
      throw new Error(
        'CONTROLLED_MIGRATION_REQUIRES_COMPLETE_RAWJSON export=' + source.exportKey +
        ' entityId=' + entityId + ' source=' + source.sourceId
      );
    }

    let rawEntity;
    try {
      rawEntity = JSON.parse(rawPayload);
    } catch (error) {
      throw new Error('INVALID_RAWJSON entityId=' + entityId + ' source=' + source.sourceId);
    }

    const canonicalState = qboCanonicalizeEntityState_(source.exportKey, manifestEntry.entityName, rawEntity);
    const canonicalHash = qboCanonicalStateHash_(source.exportKey, manifestEntry.entityName, canonicalState);
    const rawHash = qboCanonicalRawPayloadHash_(rawPayload);
    const prior = stateByEntity[entityId] || null;
    result.entitiesEvaluated += 1;

    if (prior && prior.canonicalHash === canonicalHash) {
      result.unchanged += 1;
      continue;
    }

    const snapshotReason = prior
      ? 'STATE_CHANGED'
      : (source.sourceId === baselineSourceId ? 'INITIAL_STATE' : 'NEW_ENTITY');
    const snapshotId = qboCanonicalBuildSnapshotId_(source.sourceId, manifestEntry.entityName, entityId, canonicalHash);
    result.snapshotsRequired += 1;
    if (snapshotReason === 'INITIAL_STATE') result.initialState += 1;
    if (snapshotReason === 'NEW_ENTITY') result.newEntity += 1;
    if (snapshotReason === 'STATE_CHANGED') result.stateChanged += 1;

    const snapshotRecord = [
      snapshotId,
      QBO_STATE_CAPTURE.SNAPSHOT_RECORD_VERSION,
      source.sourceId,
      source.sourceAcquisitionType,
      source.sourceRunId,
      source.exportKey,
      source.exportFunction,
      source.observationStartedAt,
      source.observationCompletedAt,
      source.masterBackupFileId,
      source.masterBackupFileName,
      sourceSheetName,
      i + 1,
      manifestEntry.entityName,
      entityId,
      'LIVE',
      row[index.CreateTime] || '',
      row[index.LastUpdatedTime] || '',
      row[index.SyncToken] === undefined ? '' : row[index.SyncToken],
      QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
      canonicalHash,
      rawHash,
      true,
      true,
      'LEGACY_RAWJSON',
      prior ? prior.snapshotId : '',
      snapshotReason,
      capturedAt
    ];
    result.expectedSnapshots.push(qboCanonicalExpectationFromRow_(QBO_STATE_CAPTURE_HEADERS.SNAPSHOTS, snapshotRecord, 'CapturedAt'));
    if (!existingSnapshotIds[snapshotId] && writeEnabled) {
      snapshotRows.push(snapshotRecord);
      existingSnapshotIds[snapshotId] = true;
      result.snapshotsAppended += 1;
    }

    if (snapshotReason !== 'INITIAL_STATE') {
      const changeType = snapshotReason === 'NEW_ENTITY' ? 'ADD' : 'UPDATE';
      const beforeCanonical = prior ? prior.canonicalState : QBO_CANONICAL_MISSING_;
      const diffs = qboCanonicalDiff_(beforeCanonical, canonicalState);
      const changeId = qboCanonicalBuildChangeId_(
        prior ? prior.snapshotId : '',
        snapshotId,
        changeType,
        manifestEntry.entityName,
        entityId
      );
      result.changesRequired += 1;
      result.changeDetailsRequired += diffs.length;

      const changeRecord = [
        changeId,
        QBO_STATE_CAPTURE.CHANGE_RECORD_VERSION,
        manifestEntry.entityName,
        entityId,
        changeType,
        source.observationCompletedAt || capturedAt,
        source.sourceId,
        source.sourceAcquisitionType,
        source.sourceRunId,
        '',
        prior ? prior.snapshotId : '',
        snapshotId,
        prior ? prior.canonicalHash : '',
        canonicalHash,
        diffs.length,
        true,
        false,
        'COMPLETE',
        capturedAt
      ];
      result.expectedChanges.push(qboCanonicalExpectationFromRow_(QBO_STATE_CAPTURE_HEADERS.CHANGES, changeRecord, 'CreatedAt'));
      if (!existingChangeIds[changeId] && writeEnabled) {
        changeRows.push(changeRecord);
        existingChangeIds[changeId] = true;
        result.changesAppended += 1;
      }

      diffs.forEach(function(diff, diffIndex) {
        const detailId = qboCanonicalBuildDetailId_(changeId, diff.path, diff.operation);
        const detailRecord = [
          detailId,
          QBO_STATE_CAPTURE.CHANGE_DETAIL_VERSION,
          changeId,
          diffIndex + 1,
          manifestEntry.entityName,
          entityId,
          diff.path,
          diff.operation,
          diff.beforeType,
          diff.beforeValue,
          diff.afterType,
          diff.afterValue,
          diff.beforeValueHash,
          diff.afterValueHash,
          diff.classification,
          capturedAt
        ];
        result.expectedDetails.push(qboCanonicalExpectationFromRow_(QBO_STATE_CAPTURE_HEADERS.CHANGE_DETAIL, detailRecord, 'CreatedAt'));
        if (existingDetailIds[detailId] || !writeEnabled) return;
        detailRows.push(detailRecord);
        existingDetailIds[detailId] = true;
        result.changeDetailsAppended += 1;
      });
    }

    stateByEntity[entityId] = {
      canonicalState: canonicalState,
      canonicalHash: canonicalHash,
      snapshotId: snapshotId,
      sourceId: source.sourceId,
      observationCompletedAt: source.observationCompletedAt
    };
  }

  if (writeEnabled) {
    qboCanonicalAppendRows_(snapshotSheet, snapshotRows, QBO_STATE_CAPTURE_HEADERS.SNAPSHOTS.length);
    qboCanonicalAppendRows_(changeSheet, changeRows, QBO_STATE_CAPTURE_HEADERS.CHANGES.length);
    qboCanonicalAppendRows_(detailSheet, detailRows, QBO_STATE_CAPTURE_HEADERS.CHANGE_DETAIL.length);
  }

  return result;
}



function auditQboCanonicalStateMigrationCurrentSource_(exportKey) {
  const normalizedExportKey = String(exportKey || '').trim();
  const manifestEntry = getQboExportManifestEntry_(normalizedExportKey);
  if (!manifestEntry) throw new Error('Unknown export key: ' + normalizedExportKey);

  const lock = LockService.getScriptLock();
  lock.waitLock(QBO_STATE_CAPTURE.EXECUTION_LOCK_TIMEOUT_MS);
  try {
    const spreadsheet = getQboStateCaptureSpreadsheet_();
    initializeQboStateCaptureWorkbook_(spreadsheet);
    validateQboStateCaptureWorkbookLocation_(spreadsheet);
    const sourceSheet = spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
    const snapshotSheet = spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SNAPSHOTS);
    const changeSheet = spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.CHANGES);
    const detailSheet = spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.CHANGE_DETAIL);
    const sources = loadQboStateCaptureWriteSources_(sourceSheet, normalizedExportKey)
      .filter(function(source) { return source.sourceStatus === QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE; });
    const rawCursor = PropertiesService.getScriptProperties().getProperty(qboCanonicalMigrationCursorKey_(normalizedExportKey));
    let cursor = Number(rawCursor || 0);
    if (!isFinite(cursor) || cursor < 0) cursor = 0;
    if (cursor > sources.length) cursor = sources.length;

    const result = {
      version: QBO_STATE_CAPTURE.VERSION,
      canonicalizationVersion: QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
      mode: 'CANONICAL_MIGRATION_CURRENT_SOURCE_RECONCILIATION_AUDIT',
      exportKey: normalizedExportKey,
      cursor: cursor,
      sourcesFound: sources.length,
      sourceIndex: cursor,
      sourceId: cursor < sources.length ? sources[cursor].sourceId : '',
      complete: cursor >= sources.length,
      expectedSnapshots: 0,
      expectedChanges: 0,
      expectedDetails: 0,
      missing: 0,
      unexpected: 0,
      mismatched: 0,
      mismatchSamples: [],
      valid: true
    };

    if (result.complete) {
      console.log(JSON.stringify(result, null, 2));
      console.log('[CANONICAL CURRENT SOURCE AUDIT] | COMPLETE | export=' + normalizedExportKey + ' | cursor=' + cursor + ' | totalSources=' + sources.length);
      return result;
    }

    const baselineSourceId = sources.length ? sources[0].sourceId : '';
    const sourceIndexById = Object.create(null);
    sources.forEach(function(source, index) { sourceIndexById[source.sourceId] = index; });
    let stateByEntity = Object.create(null);
    if (cursor > 0) {
      const priorSnapshotMap = qboCanonicalLoadLatestSnapshotMapThroughSource_(
        snapshotSheet, normalizedExportKey, sourceIndexById, cursor - 1
      );
      stateByEntity = qboCanonicalLoadSourceStateOnly_(
        sources[cursor - 1], manifestEntry, priorSnapshotMap
      );
    }

    const existingSnapshotIds = qboCanonicalLoadIdSet_(snapshotSheet, 'SnapshotRecordId');
    const existingChangeIds = qboCanonicalLoadIdSet_(changeSheet, 'ChangeRecordId');
    const existingDetailIds = qboCanonicalLoadIdSet_(detailSheet, 'ChangeDetailId');
    const derived = qboCanonicalMigrateSource_(
      sources[cursor], manifestEntry, baselineSourceId, stateByEntity,
      snapshotSheet, changeSheet, detailSheet,
      existingSnapshotIds, existingChangeIds, existingDetailIds,
      { writeEnabled: false }
    );
    const reconciliation = qboCanonicalReconcileSource_(
      sources[cursor], derived, snapshotSheet, changeSheet, detailSheet
    );

    result.expectedSnapshots = derived.expectedSnapshots.length;
    result.expectedChanges = derived.expectedChanges.length;
    result.expectedDetails = derived.expectedDetails.length;
    result.missing = reconciliation.missing;
    result.unexpected = reconciliation.unexpected;
    result.mismatched = reconciliation.mismatched;
    result.mismatchSamples = reconciliation.mismatchSamples || [];
    result.valid = reconciliation.valid;

    console.log(JSON.stringify(result, null, 2));
    console.log('[CANONICAL CURRENT SOURCE AUDIT] | ' + (result.valid ? 'PASS' : 'FAIL') +
      ' | export=' + normalizedExportKey +
      ' | sourceIndex=' + cursor +
      ' | missing=' + result.missing +
      ' | unexpected=' + result.unexpected +
      ' | mismatched=' + result.mismatched);
    return result;
  } finally {
    lock.releaseLock();
  }
}

function auditQboCanonicalStateMigrationThroughCursor_(exportKey) {
  const normalizedExportKey = String(exportKey || '').trim();
  const manifestEntry = getQboExportManifestEntry_(normalizedExportKey);
  if (!manifestEntry) throw new Error('Unknown export key: ' + normalizedExportKey);

  const lock = LockService.getScriptLock();
  lock.waitLock(QBO_STATE_CAPTURE.EXECUTION_LOCK_TIMEOUT_MS);
  try {
    const spreadsheet = getQboStateCaptureSpreadsheet_();
    initializeQboStateCaptureWorkbook_(spreadsheet);
    validateQboStateCaptureWorkbookLocation_(spreadsheet);
    const sourceSheet = spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
    const snapshotSheet = spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SNAPSHOTS);
    const changeSheet = spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.CHANGES);
    const detailSheet = spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.CHANGE_DETAIL);
    const sources = loadQboStateCaptureWriteSources_(sourceSheet, normalizedExportKey)
      .filter(function(source) { return source.sourceStatus === QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE; });
    const rawCursor = PropertiesService.getScriptProperties().getProperty(qboCanonicalMigrationCursorKey_(normalizedExportKey));
    let cursor = Number(rawCursor || 0);
    if (!isFinite(cursor) || cursor < 0) cursor = 0;
    if (cursor > sources.length) cursor = sources.length;

    const baselineSourceId = sources.length ? sources[0].sourceId : '';
    const existingSnapshotIds = qboCanonicalLoadIdSet_(snapshotSheet, 'SnapshotRecordId');
    const existingChangeIds = qboCanonicalLoadIdSet_(changeSheet, 'ChangeRecordId');
    const existingDetailIds = qboCanonicalLoadIdSet_(detailSheet, 'ChangeDetailId');
    const stateByEntity = Object.create(null);
    const result = {
      version: QBO_STATE_CAPTURE.VERSION,
      canonicalizationVersion: QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
      mode: 'CANONICAL_MIGRATION_RECONCILIATION_AUDIT',
      exportKey: normalizedExportKey,
      cursor: cursor,
      sourcesFound: sources.length,
      sourcesAudited: 0,
      expectedSnapshots: 0,
      expectedChanges: 0,
      expectedDetails: 0,
      missing: 0,
      unexpected: 0,
      mismatched: 0,
      valid: true,
      sourceResults: []
    };

    for (let sourceIndex = 0; sourceIndex < cursor; sourceIndex += 1) {
      const derived = qboCanonicalMigrateSource_(
        sources[sourceIndex], manifestEntry, baselineSourceId, stateByEntity,
        snapshotSheet, changeSheet, detailSheet,
        existingSnapshotIds, existingChangeIds, existingDetailIds,
        { writeEnabled: false }
      );
      const reconciliation = qboCanonicalReconcileSource_(
        sources[sourceIndex], derived, snapshotSheet, changeSheet, detailSheet
      );
      result.sourcesAudited += 1;
      result.expectedSnapshots += derived.expectedSnapshots.length;
      result.expectedChanges += derived.expectedChanges.length;
      result.expectedDetails += derived.expectedDetails.length;
      result.missing += reconciliation.missing;
      result.unexpected += reconciliation.unexpected;
      result.mismatched += reconciliation.mismatched;
      result.sourceResults.push({
        sourceIndex: sourceIndex,
        sourceId: sources[sourceIndex].sourceId,
        expectedSnapshots: derived.expectedSnapshots.length,
        expectedChanges: derived.expectedChanges.length,
        expectedDetails: derived.expectedDetails.length,
        missing: reconciliation.missing,
        unexpected: reconciliation.unexpected,
        mismatched: reconciliation.mismatched,
        mismatchSamples: reconciliation.mismatchSamples || [],
        valid: reconciliation.valid
      });
      if (!reconciliation.valid) result.valid = false;
    }

    console.log(JSON.stringify(result, null, 2));
    console.log('[CANONICAL RECONCILIATION AUDIT] | ' + (result.valid ? 'PASS' : 'FAIL') +
      ' | export=' + normalizedExportKey +
      ' | cursor=' + cursor +
      ' | sourcesAudited=' + result.sourcesAudited +
      ' | missing=' + result.missing +
      ' | unexpected=' + result.unexpected +
      ' | mismatched=' + result.mismatched);
    return result;
  } finally {
    lock.releaseLock();
  }
}

function qboCanonicalExpectationFromRow_(headers, row, volatileHeader) {
  const values = Object.create(null);
  headers.forEach(function(header, i) {
    if (header === volatileHeader) return;
    values[header] = qboCanonicalComparableCell_(row[i], header);
  });
  return { id: String(row[0] || '').trim(), values: values };
}

function qboCanonicalComparableCell_(value, header) {
  if (value === null || value === undefined || value === '') return '';

  // SpreadsheetApp may round-trip values with a different JavaScript type than
  // the exact value supplied to setValues() (for example, "61" may return as
  // 61 and ISO-looking timestamps may return as Date objects). Reconciliation
  // validates persisted semantic content, not incidental Sheets storage typing.
  const dateHeaders = {
    ObservationStartedAt: true,
    ObservationCompletedAt: true,
    DetectedAt: true,
    QboCreateTime: true,
    QboLastUpdatedTime: true
  };

  if (dateHeaders[String(header || '')]) {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'number' && isFinite(value)) {
      // Google Sheets serial date epoch is 1899-12-30.
      const millis = Math.round((value - 25569) * 86400000);
      const serialDate = new Date(millis);
      if (!isNaN(serialDate.getTime())) return serialDate.toISOString();
    }
    const parsed = new Date(String(value));
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }

  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') {
    if (!isFinite(value)) return String(value);
    return String(value === 0 ? 0 : value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}


/**
 * Reconciliation-only normalization for values read back from Google Sheets.
 *
 * Change Detail BeforeValue / AfterValue intentionally preserve canonical scalar
 * values as strings. Google Sheets may nevertheless store a date-looking string
 * such as "2026-09-01" as a Date cell and return a Date object from getValues().
 * The recomputed expected value is the semantic anchor: only when the stored Date
 * represents the same expected date/date-time do we normalize it back to that
 * expected string. A genuinely different date/time still fails reconciliation.
 */
function qboCanonicalComparableStoredCell_(value, header, expectedValue) {
  const normalized = qboCanonicalComparableCell_(value, header);
  const name = String(header || '');
  if (name !== 'BeforeValue' && name !== 'AfterValue') {
    return normalized;
  }

  const expected = expectedValue === null || expectedValue === undefined ? '' : String(expectedValue);
  if (!expected) return normalized;

  // Canonical detail values are strings, but Sheets may coerce numeric-looking
  // strings such as "180.00" to numeric cells and return 180 from getValues().
  // Use the recomputed expected string as the semantic anchor. Only accept the
  // stored number when it is finite and numerically equal to that expected
  // canonical decimal; genuinely different values still fail reconciliation.
  if (typeof value === 'number' && isFinite(value) &&
      /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(expected)) {
    const expectedNumber = Number(expected);
    if (isFinite(expectedNumber) && expectedNumber === value) return expected;
    return normalized;
  }

  if (!(value instanceof Date)) return normalized;

  if (/^\d{4}-\d{2}-\d{2}$/.test(expected)) {
    const utcDate = value.toISOString().slice(0, 10);
    let scriptDate = '';
    try {
      scriptDate = Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } catch (ignore) {}
    if (expected === utcDate || expected === scriptDate) return expected;
    return normalized;
  }

  // If the canonical detail value is a date-time string, compare the instant.
  // Return the exact expected representation only when both values denote the
  // same instant so offset-vs-Z formatting cannot create a false mismatch.
  if (/^\d{4}-\d{2}-\d{2}T/.test(expected)) {
    const parsedExpected = new Date(expected);
    if (!isNaN(parsedExpected.getTime()) && parsedExpected.getTime() === value.getTime()) {
      return expected;
    }
  }

  return normalized;
}

function qboCanonicalReconcileSource_(source, sourceResult, snapshotSheet, changeSheet, detailSheet) {
  const snapshotAudit = qboCanonicalReconcileExpectedRows_(
    snapshotSheet, 'SnapshotRecordId', sourceResult.expectedSnapshots,
    function(index, row) { return String(row[index.SourceId] || '').trim() === source.sourceId; },
    'CapturedAt'
  );
  const changeAudit = qboCanonicalReconcileExpectedRows_(
    changeSheet, 'ChangeRecordId', sourceResult.expectedChanges,
    function(index, row) { return String(row[index.SourceId] || '').trim() === source.sourceId; },
    'CreatedAt'
  );

  const expectedChangeIds = Object.create(null);
  sourceResult.expectedChanges.forEach(function(item) { expectedChangeIds[item.id] = true; });
  const detailAudit = qboCanonicalReconcileExpectedRows_(
    detailSheet, 'ChangeDetailId', sourceResult.expectedDetails,
    function(index, row) {
      return Boolean(expectedChangeIds[String(row[index.ChangeRecordId] || '').trim()]);
    },
    'CreatedAt'
  );

  const result = {
    sourceId: source.sourceId,
    expectedSnapshots: sourceResult.expectedSnapshots.length,
    expectedChanges: sourceResult.expectedChanges.length,
    expectedDetails: sourceResult.expectedDetails.length,
    missing: snapshotAudit.missing + changeAudit.missing + detailAudit.missing,
    unexpected: snapshotAudit.unexpected + changeAudit.unexpected + detailAudit.unexpected,
    mismatched: snapshotAudit.mismatched + changeAudit.mismatched + detailAudit.mismatched,
    duplicateIds: snapshotAudit.duplicateIds + changeAudit.duplicateIds + detailAudit.duplicateIds,
    mismatchSamples: [].concat(snapshotAudit.mismatchSamples || [], changeAudit.mismatchSamples || [], detailAudit.mismatchSamples || []).slice(0, 10),
    valid: snapshotAudit.valid && changeAudit.valid && detailAudit.valid
  };
  if (result.duplicateIds) {
    result.mismatched += result.duplicateIds;
    result.valid = false;
  }
  return result;
}

function qboCanonicalReconcileExpectedRows_(sheet, idHeader, expected, includeRowFn, volatileHeader) {
  const expectedById = Object.create(null);
  expected.forEach(function(item) { expectedById[item.id] = item.values; });
  const foundCounts = Object.create(null);
  const actualById = Object.create(null);
  let unexpected = 0;

  if (sheet && sheet.getLastRow() > 1) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(v) { return String(v || '').trim(); });
    const index = buildQboStateCaptureWriteHeaderIndex_(headers);
    if (index[idHeader] === undefined) throw new Error('Missing reconciliation ID header ' + idHeader + ' on ' + sheet.getName());
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    rows.forEach(function(row) {
      if (!includeRowFn(index, row)) return;
      const id = String(row[index[idHeader]] || '').trim();
      if (!id) return;
      foundCounts[id] = (foundCounts[id] || 0) + 1;
      if (!actualById[id]) {
        const values = Object.create(null);
        headers.forEach(function(header, i) {
          if (header === volatileHeader) return;
          const expectedValue = expectedById[id] ? expectedById[id][header] : undefined;
          values[header] = qboCanonicalComparableStoredCell_(row[i], header, expectedValue);
        });
        actualById[id] = values;
      }
      if (!expectedById[id]) unexpected += 1;
    });
  }

  let missing = 0;
  let mismatched = 0;
  let duplicateIds = 0;
  const mismatchSamples = [];
  Object.keys(expectedById).forEach(function(id) {
    const count = foundCounts[id] || 0;
    if (!count) {
      missing += 1;
      return;
    }
    if (count > 1) duplicateIds += count - 1;
    if (qboCanonicalStableStringify_(actualById[id]) !== qboCanonicalStableStringify_(expectedById[id])) {
      mismatched += 1;
      if (mismatchSamples.length < 10) {
        const expectedValues = expectedById[id] || {};
        const actualValues = actualById[id] || {};
        const differingHeaders = [];
        Object.keys(expectedValues).forEach(function(header) {
          if (qboCanonicalStableStringify_(expectedValues[header]) !== qboCanonicalStableStringify_(actualValues[header])) {
            differingHeaders.push({
              header: header,
              expected: expectedValues[header],
              actual: actualValues[header]
            });
          }
        });
        mismatchSamples.push({ id: id, differingHeaders: differingHeaders.slice(0, 10) });
      }
    }
  });

  return {
    missing: missing,
    unexpected: unexpected,
    mismatched: mismatched,
    duplicateIds: duplicateIds,
    mismatchSamples: mismatchSamples,
    valid: missing === 0 && unexpected === 0 && mismatched === 0 && duplicateIds === 0
  };
}

function qboCanonicalAppendRows_(sheet, rows, width) {
  if (!rows.length) return;
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, width).setValues(rows);
  applyQboStateCaptureSheetLayout_(sheet);
}

function qboCanonicalLoadIdSet_(sheet, idHeader) {
  const set = Object.create(null);
  if (!sheet || sheet.getLastRow() <= 1) return set;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const index = buildQboStateCaptureWriteHeaderIndex_(headers);
  if (index[idHeader] === undefined) throw new Error('Missing ID header ' + idHeader + ' on ' + sheet.getName());
  sheet.getRange(2, index[idHeader] + 1, sheet.getLastRow() - 1, 1).getValues().forEach(function(row) {
    const id = String(row[0] || '').trim();
    if (id) set[id] = true;
  });
  return set;
}

function qboCanonicalBuildSnapshotId_(sourceId, entityType, entityId, canonicalHash) {
  return 'SNAPSHOT|' + qboStateCaptureAuditSha256_(qboCanonicalStableStringify_({
    version: QBO_STATE_CAPTURE.SNAPSHOT_RECORD_VERSION,
    canonicalizationVersion: QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
    sourceId: String(sourceId || ''),
    entityType: String(entityType || ''),
    entityId: String(entityId || ''),
    canonicalStateHash: String(canonicalHash || '')
  }));
}

function qboCanonicalBuildChangeId_(beforeSnapshotId, afterSnapshotId, changeType, entityType, entityId) {
  return 'CHANGE|' + qboStateCaptureAuditSha256_(qboCanonicalStableStringify_({
    version: QBO_STATE_CAPTURE.CHANGE_RECORD_VERSION,
    beforeSnapshotRecordId: String(beforeSnapshotId || ''),
    afterSnapshotRecordId: String(afterSnapshotId || ''),
    changeType: String(changeType || ''),
    entityType: String(entityType || ''),
    entityId: String(entityId || '')
  }));
}

function qboCanonicalBuildDetailId_(changeId, path, operation) {
  return 'DETAIL|' + qboStateCaptureAuditSha256_(qboCanonicalStableStringify_({
    version: QBO_STATE_CAPTURE.CHANGE_DETAIL_VERSION,
    changeRecordId: String(changeId || ''),
    path: String(path || ''),
    operation: String(operation || '')
  }));
}

function qboCanonicalAppendIngestionLog_(spreadsheet, values) {
  const sheet = spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.INGESTION_LOG);
  if (!sheet) return;
  const v = values || {};
  sheet.appendRow([
    v.ingestionRunId || '', v.startedAt || '', v.completedAt || '', v.operation || '',
    v.processingPhase || '', v.status || '', v.sourceAcquisitionType || '', v.sourceId || '',
    v.sourceRunId || '', v.exportKey || '', v.sourceRowsScanned || 0, v.entitiesEvaluated || 0,
    v.eligibleSources || 0, v.alreadyRegistered || 0, v.registeredSources || 0, v.skippedSources || 0,
    v.snapshotsCreated || 0, v.changesCreated || 0, v.changeDetailsCreated || 0, v.unchangedEntities || 0,
    v.errorCount || 0, Boolean(v.actionRequired), v.error || '', QBO_STATE_CAPTURE.VERSION, new Date()
  ]);
  applyQboStateCaptureSheetLayout_(sheet);
}

/**
 * Diagnostic only. The authoritative false-change count is derived from the
 * canonical migration itself. This helper compares legacy STATE_CHANGED row
 * count with canonical UPDATE count for the export and is intentionally used
 * only for reconciliation reporting.
 */
function qboCanonicalCountLegacyFalseChanges_(spreadsheet, exportKey) {
  const legacy = spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.STATES);
  if (!legacy || legacy.getLastRow() <= 1) return 0;
  const headers = legacy.getRange(1, 1, 1, legacy.getLastColumn()).getValues()[0];
  const index = buildQboStateCaptureWriteHeaderIndex_(headers);
  if (index.ExportKey === undefined || index.CaptureReason === undefined) return 0;
  let legacyChanged = 0;
  legacy.getRange(2, 1, legacy.getLastRow() - 1, legacy.getLastColumn()).getValues().forEach(function(row) {
    if (String(row[index.ExportKey] || '').trim() === exportKey &&
        String(row[index.CaptureReason] || '').trim() === 'STATE_CHANGED') {
      legacyChanged += 1;
    }
  });

  const changes = spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.CHANGES);
  if (!changes || changes.getLastRow() <= 1) return legacyChanged;
  const chHeaders = changes.getRange(1, 1, 1, changes.getLastColumn()).getValues()[0];
  const chIndex = buildQboStateCaptureWriteHeaderIndex_(chHeaders);
  let canonicalUpdates = 0;
  changes.getRange(2, 1, changes.getLastRow() - 1, changes.getLastColumn()).getValues().forEach(function(row) {
    if (String(row[chIndex.ChangeType] || '').trim() !== 'UPDATE') return;
    const sourceId = String(row[chIndex.SourceId] || '');
    // SourceId itself does not carry ExportKey for every future acquisition type;
    // this diagnostic is only valid for the current FULL_EXPORT migration scope.
    if (sourceId.slice(-1 * (exportKey.length + 1)) === '|' + exportKey) canonicalUpdates += 1;
  });
  return Math.max(0, legacyChanged - canonicalUpdates);
}
