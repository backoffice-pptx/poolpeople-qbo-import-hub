/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 92_QBO_RecursiveContractCoverageAudit.js
 * Purpose     : Automated historical contract-coverage audit across parent and
 *               governed child datasets, with durable path-level findings.
 *
 * Architecture under test:
 *   Canonical state derives from governed flattened export contract plus
 *   governed child datasets; RawJSON is validation evidence.
 *
 * What this audit does:
 *   - Re-runs every configured canonical export across every AVAILABLE
 *     historical FULL_EXPORT/FULL_EXPORT_LEGACY source.
 *   - Recursively inventories canonical business-state paths from RawJSON.
 *   - Tests whether each canonical path is physically represented by a
 *     flattened scalar column, an explicit non-RawJSON JSON container column,
 *     or a governed child dataset.
 *   - Audits child-sheet RawJSON/evidence against the child sheet's flattened
 *     columns as a second contract layer.
 *   - Persists all path results and per-source summaries to the State Capture
 *     workbook.
 *   - Uses one transient time trigger at a time so the user does not have to
 *     run source-by-source audit functions manually.
 *
 * Important limits:
 *   - This is a structural/value-evidence coverage audit, not proof that every
 *     transformed value has perfect business-semantic equivalence.
 *   - Low-sample/ambiguous mappings are reported REVIEW_REQUIRED rather than
 *     silently treated as covered.
 *   - RawJSON columns themselves are NEVER accepted as contract coverage.
 *
 * Public API:
 *   - startQboRecursiveContractCoverageAudit()
 *   - resumeQboRecursiveContractCoverageAudit()
 *   - stopQboRecursiveContractCoverageAudit()
 *   - listQboRecursiveContractCoverageAuditStatus()
 *
 * Trigger entry point:
 *   - runNextQboRecursiveContractCoverageAudit()
 * ============================================================================
 */

const QBO_RECURSIVE_CONTRACT_AUDIT_ = Object.freeze({
  AUDIT_VERSION: 'RECURSIVE_CONTRACT_COVERAGE_V3',
  HANDLER: 'runNextQboRecursiveContractCoverageAudit',
  WATCHDOG_HANDLER: 'watchQboRecursiveContractCoverageAudit',
  NEXT_TRIGGER_DELAY_MS: 60000,
  WORKER_RUNTIME_BUDGET_MS: 240000,
  WORKER_MAX_SOURCES: 25,
  LOCK_TIMEOUT_MS: 30000,
  PROPERTIES: Object.freeze({
    RUN_ID: 'QBO_RECURSIVE_CONTRACT_AUDIT_RUN_ID_V1',
    STATUS: 'QBO_RECURSIVE_CONTRACT_AUDIT_STATUS_V1',
    STARTED_AT: 'QBO_RECURSIVE_CONTRACT_AUDIT_STARTED_AT_V1',
    CURSOR: 'QBO_RECURSIVE_CONTRACT_AUDIT_CURSOR_V1',
    SOURCE_COUNT: 'QBO_RECURSIVE_CONTRACT_AUDIT_SOURCE_COUNT_V1',
    PATH_ROWS: 'QBO_RECURSIVE_CONTRACT_AUDIT_PATH_ROWS_V1',
    COVERED: 'QBO_RECURSIVE_CONTRACT_AUDIT_COVERED_V1',
    REVIEW: 'QBO_RECURSIVE_CONTRACT_AUDIT_REVIEW_V1',
    UNCOVERED: 'QBO_RECURSIVE_CONTRACT_AUDIT_UNCOVERED_V1',
    ERRORS: 'QBO_RECURSIVE_CONTRACT_AUDIT_ERRORS_V1',
    LAST_ERROR: 'QBO_RECURSIVE_CONTRACT_AUDIT_LAST_ERROR_V1',
    IN_PROGRESS_SOURCE: 'QBO_RECURSIVE_CONTRACT_AUDIT_IN_PROGRESS_SOURCE_V1'
  }),
  STATUS: Object.freeze({
    RUNNING: 'RUNNING',
    COMPLETE: 'COMPLETE',
    STOPPED: 'STOPPED',
    ERROR: 'ERROR'
  }),
  CONTRACT_LEVEL: Object.freeze({
    PARENT: 'PARENT',
    CHILD: 'CHILD'
  }),
  COVERAGE: Object.freeze({
    FLATTENED: 'COVERED_FLATTENED_COLUMN',
    JSON: 'COVERED_JSON_CONTAINER',
    CHILD: 'COVERED_CHILD_DATASET',
    REVIEW: 'REVIEW_REQUIRED',
    UNCOVERED: 'UNCOVERED'
  }),
  // Parent-level nested paths represented by these child evidence streams are
  // merged back into the parent path result when the child audit itself finds
  // physical flattened coverage.
  CHILD_EVIDENCE: Object.freeze({
    ITEMS: Object.freeze([
      Object.freeze({sheetName:'QBO_ItemGroupLines', evidenceColumn:'RawJSON', prefix:'ItemGroupDetail.ItemGroupLine[]'})
    ]),
    TAX_CODES: Object.freeze([
      Object.freeze({sheetName:'QBO_TaxCodeRates', evidenceColumn:'RawJSON', prefixResolver:'TAX_CODE_RATE'})
    ]),
    INVOICES: Object.freeze([
      Object.freeze({sheetName:'QBO_InvoiceLines', evidenceColumn:'RawJSON', prefix:'Line[]'})
    ]),
    PAYMENTS: Object.freeze([
      Object.freeze({sheetName:'QBO_PaymentApplications', evidenceColumn:'PaymentLineRawJSON', prefix:'Line[]'}),
      Object.freeze({sheetName:'QBO_PaymentApplications', evidenceColumn:'LinkedTxnRawJSON', prefix:'Line[].LinkedTxn[]'})
    ]),
    CREDIT_MEMOS: Object.freeze([
      Object.freeze({sheetName:'QBO_CreditMemoLines', evidenceColumn:'RawJSON', prefix:'Line[]'})
    ]),
    ESTIMATES: Object.freeze([
      Object.freeze({sheetName:'QBO_EstimateLines', evidenceColumn:'RawJSON', prefix:'Line[]'})
    ]),
    BILLS: Object.freeze([
      Object.freeze({sheetName:'QBO_BillLines', evidenceColumn:'RawJSON', prefix:'Line[]'})
    ]),
    BILL_PAYMENTS: Object.freeze([
      Object.freeze({sheetName:'QBO_BillPaymentApplications', evidenceColumn:'PaymentLineRawJSON', prefix:'Line[]'}),
      Object.freeze({sheetName:'QBO_BillPaymentApplications', evidenceColumn:'LinkedTxnRawJSON', prefix:'Line[].LinkedTxn[]'})
    ]),
    PURCHASES: Object.freeze([
      Object.freeze({sheetName:'QBO_PurchaseLines', evidenceColumn:'RawJSON', prefix:'Line[]'})
    ]),
    DEPOSITS: Object.freeze([
      Object.freeze({sheetName:'QBO_DepositLines', evidenceColumn:'RawJSON', prefix:'Line[]'})
    ]),
    JOURNAL_ENTRIES: Object.freeze([
      Object.freeze({sheetName:'QBO_JournalEntryLines', evidenceColumn:'RawJSON', prefix:'Line[]'})
    ]),
    SALES_RECEIPTS: Object.freeze([
      Object.freeze({sheetName:'QBO_SalesReceiptLines', evidenceColumn:'RawJSON', prefix:'Line[]'})
    ]),
    RECURRING_TRANSACTIONS: Object.freeze([
      // RecurringTransaction can expose the embedded transaction under several
      // QBO top-level keys. Child coverage is therefore reported independently;
      // exact parent coverage is normally proven by EmbeddedTransactionJSON.
      Object.freeze({sheetName:'QBO_RecurringTransactionLines', evidenceColumn:'RawJSON', prefix:'EmbeddedTransaction.Line[]', mergeToParent:false})
    ]),
    REFUND_RECEIPTS: Object.freeze([
      Object.freeze({sheetName:'QBO_RefundReceiptLines', evidenceColumn:'RawJSON', prefix:'Line[]'})
    ])
  })
});

/**
 * Start a fresh full recursive parent+child audit.
 *
 * Startup is intentionally short and does not process a historical source inline.
 * The full durable state is written in one Script Properties batch, the run row is
 * recorded, and only then are the watchdog/worker triggers installed. This avoids
 * a cancelled manual start leaving a new RunId attached to stale cursor/counters.
 */
function startQboRecursiveContractCoverageAudit() {
  const lock = LockService.getScriptLock();
  lock.waitLock(QBO_RECURSIVE_CONTRACT_AUDIT_.LOCK_TIMEOUT_MS);
  let result;
  try {
    const ss = getQboStateCaptureSpreadsheet_();
    initializeQboStateCaptureWorkbook_(ss);
    validateQboStateCaptureWorkbookLocation_(ss);
    deleteAllQboRecursiveContractAuditTriggers_();

    const props = PropertiesService.getScriptProperties();
    const runId = 'CONTRACT_AUDIT|' + Utilities.getUuid();
    const startedAt = new Date().toISOString();
    const cursor = {exportIndex: 0, sourceIndex: 0};
    const keys = QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES;
    const initialState = {};
    initialState[keys.RUN_ID] = runId;
    initialState[keys.STATUS] = QBO_RECURSIVE_CONTRACT_AUDIT_.STATUS.RUNNING;
    initialState[keys.STARTED_AT] = startedAt;
    initialState[keys.CURSOR] = JSON.stringify(cursor);
    initialState[keys.SOURCE_COUNT] = '0';
    initialState[keys.PATH_ROWS] = '0';
    initialState[keys.COVERED] = '0';
    initialState[keys.REVIEW] = '0';
    initialState[keys.UNCOVERED] = '0';
    initialState[keys.ERRORS] = '0';
    initialState[keys.LAST_ERROR] = '';
    initialState[keys.IN_PROGRESS_SOURCE] = '';
    props.setProperties(initialState, false);

    result = qboRecursiveContractAuditReadState_(props);
    if (
      result.runId !== runId ||
      result.status !== QBO_RECURSIVE_CONTRACT_AUDIT_.STATUS.RUNNING ||
      result.startedAt !== startedAt ||
      result.cursor.exportIndex !== 0 ||
      result.cursor.sourceIndex !== 0 ||
      result.sourceCountProcessed !== 0 ||
      result.pathRowsWritten !== 0 ||
      result.coveredPaths !== 0 ||
      result.reviewPaths !== 0 ||
      result.uncoveredPaths !== 0 ||
      result.errorCount !== 0
    ) {
      throw new Error('Recursive contract audit startup state verification failed.');
    }

    appendQboRecursiveContractAuditRunRow_(ss, {
      runId: runId,
      status: QBO_RECURSIVE_CONTRACT_AUDIT_.STATUS.RUNNING,
      startedAt: startedAt,
      completedAt: '',
      exportCount: QBO_STATE_CAPTURE.CANONICAL_MIGRATION_SCOPE.length,
      sourceCountProcessed: 0,
      pathRowsWritten: 0,
      coveredPaths: 0,
      reviewPaths: 0,
      uncoveredPaths: 0,
      errorCount: 0,
      cursorExportIndex: 0,
      cursorSourceIndex: 0,
      lastError: ''
    });

    installQboRecursiveContractAuditWatchdog_();
    scheduleNextQboRecursiveContractAuditTrigger_();
    console.log('[RECURSIVE CONTRACT AUDIT] | STARTED | runId=' + runId + ' | cursor=0/0 | first worker scheduled');
  } finally {
    lock.releaseLock();
  }

  return result;
}

/** Resume the current audit from its durable cursor without processing inline. */
function resumeQboRecursiveContractCoverageAudit() {
  const props = PropertiesService.getScriptProperties();
  const runId = String(props.getProperty(QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.RUN_ID) || '').trim();
  if (!runId) throw new Error('No recursive contract audit run exists to resume.');
  props.setProperty(QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.STATUS, QBO_RECURSIVE_CONTRACT_AUDIT_.STATUS.RUNNING);
  deleteQboRecursiveContractAuditWorkerTriggers_();
  installQboRecursiveContractAuditWatchdog_();
  scheduleNextQboRecursiveContractAuditTrigger_();
  console.log('[RECURSIVE CONTRACT AUDIT] | RESUME | runId=' + runId + ' | worker scheduled');
  return qboRecursiveContractAuditReadState_(props);
}

/** Stop future audit executions without clearing results or cursor. */
function stopQboRecursiveContractCoverageAudit() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.STATUS, QBO_RECURSIVE_CONTRACT_AUDIT_.STATUS.STOPPED);
  deleteAllQboRecursiveContractAuditTriggers_();
  const ss = getQboStateCaptureSpreadsheet_();
  qboRecursiveContractAuditUpdateRunRow_(ss, props, '');
  console.log('[RECURSIVE CONTRACT AUDIT] | STOPPED');
  return listQboRecursiveContractCoverageAuditStatus();
}

/** Log and return durable audit status/cursor. */
function listQboRecursiveContractCoverageAuditStatus() {
  const props = PropertiesService.getScriptProperties();
  const result = qboRecursiveContractAuditReadState_(props);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Trigger entry point. Processes a bounded batch of historical sources.
 *
 * The worker checkpoints after every completed source and continues until either
 * the conservative runtime budget or the per-execution source cap is reached.
 * One continuation trigger is scheduled only when work remains. The script lock
 * stays held for the worker lifetime so the watchdog cannot mistake an active
 * batch for a missing worker.
 */
function runNextQboRecursiveContractCoverageAudit() {
  const lock = LockService.getScriptLock();
  lock.waitLock(QBO_RECURSIVE_CONTRACT_AUDIT_.LOCK_TIMEOUT_MS);
  const workerStartedMs = Date.now();
  let processedThisExecution = 0;
  let shouldScheduleNext = false;
  let result;

  try {
    deleteQboRecursiveContractAuditWorkerTriggers_();
    const props = PropertiesService.getScriptProperties();
    let state = qboRecursiveContractAuditReadState_(props);
    if (!state.runId) throw new Error('Recursive contract audit has not been started.');
    if (state.status !== QBO_RECURSIVE_CONTRACT_AUDIT_.STATUS.RUNNING) {
      console.log('[RECURSIVE CONTRACT AUDIT] | NOOP | status=' + state.status);
      return state;
    }

    const scope = QBO_STATE_CAPTURE.CANONICAL_MIGRATION_SCOPE;
    const ss = getQboStateCaptureSpreadsheet_();
    initializeQboStateCaptureWorkbook_(ss);
    const sourceSheet = ss.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);

    while (state.status === QBO_RECURSIVE_CONTRACT_AUDIT_.STATUS.RUNNING) {
      const elapsedMs = Date.now() - workerStartedMs;
      if (
        processedThisExecution > 0 &&
        (elapsedMs >= QBO_RECURSIVE_CONTRACT_AUDIT_.WORKER_RUNTIME_BUDGET_MS ||
         processedThisExecution >= QBO_RECURSIVE_CONTRACT_AUDIT_.WORKER_MAX_SOURCES)
      ) {
        shouldScheduleNext = state.cursor.exportIndex < scope.length;
        result = {
          status: 'BATCH_CHECKPOINT',
          processedThisExecution: processedThisExecution,
          elapsedMs: elapsedMs,
          nextCursor: state.cursor
        };
        console.log(
          '[RECURSIVE CONTRACT AUDIT] | BATCH CHECKPOINT | processed=' + processedThisExecution +
          ' | elapsedMs=' + elapsedMs +
          ' | cursor=' + state.cursor.exportIndex + '/' + state.cursor.sourceIndex
        );
        break;
      }

      let cursor = state.cursor;
      if (cursor.exportIndex >= scope.length) {
        result = completeQboRecursiveContractCoverageAudit_(props);
        state = qboRecursiveContractAuditReadState_(props);
        break;
      }

      const exportKey = scope[cursor.exportIndex];
      const sources = loadQboStateCaptureWriteSources_(sourceSheet, exportKey)
        .filter(function(source) {
          return source.sourceStatus === QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE;
        });

      if (!sources.length || cursor.sourceIndex >= sources.length) {
        cursor = {exportIndex: cursor.exportIndex + 1, sourceIndex: 0};
        props.setProperty(QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.CURSOR, JSON.stringify(cursor));
        qboRecursiveContractAuditUpdateRunRow_(ss, props, '');
        state = qboRecursiveContractAuditReadState_(props);
        if (cursor.exportIndex >= scope.length) {
          result = completeQboRecursiveContractCoverageAudit_(props);
          state = qboRecursiveContractAuditReadState_(props);
          break;
        }
        continue;
      }

      const source = sources[cursor.sourceIndex];
      const sourceWorkKey = [state.runId, exportKey, cursor.sourceIndex, source.sourceId].join('|');
      // SourceId is the idempotency key for persisted audit evidence. Always clear
      // prior rows for this run/source before processing so watchdog retries,
      // cursor re-entry, or a changing source registry cannot leave duplicate evidence.
      qboRecursiveContractAuditDeleteSourceRows_(ss, state.runId, exportKey, source.sourceId);
      props.setProperty(QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.IN_PROGRESS_SOURCE, sourceWorkKey);

      const sourceStartedAt = new Date();
      try {
        const sourceResult = qboRecursiveContractAuditSource_(
          ss,
          state.runId,
          exportKey,
          cursor.sourceIndex,
          source,
          sourceStartedAt
        );

        const nextCursor = cursor.sourceIndex + 1 >= sources.length
          ? {exportIndex: cursor.exportIndex + 1, sourceIndex: 0}
          : {exportIndex: cursor.exportIndex, sourceIndex: cursor.sourceIndex + 1};

        // Commit the source checkpoint before attempting any additional work.
        props.setProperty(QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.CURSOR, JSON.stringify(nextCursor));
        props.deleteProperty(QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.IN_PROGRESS_SOURCE);
        qboRecursiveContractAuditIncrementProperty_(props, QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.SOURCE_COUNT, 1);
        qboRecursiveContractAuditIncrementProperty_(props, QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.PATH_ROWS, sourceResult.pathRowsWritten);
        qboRecursiveContractAuditIncrementProperty_(props, QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.COVERED, sourceResult.coveredPaths);
        qboRecursiveContractAuditIncrementProperty_(props, QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.REVIEW, sourceResult.reviewPaths);
        qboRecursiveContractAuditIncrementProperty_(props, QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.UNCOVERED, sourceResult.uncoveredPaths);
        props.deleteProperty(QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.LAST_ERROR);
        qboRecursiveContractAuditUpdateRunRow_(ss, props, '');

        processedThisExecution += 1;
        result = sourceResult;
        state = qboRecursiveContractAuditReadState_(props);

        if (nextCursor.exportIndex >= scope.length) {
          result.runCompletion = completeQboRecursiveContractCoverageAudit_(props);
          state = qboRecursiveContractAuditReadState_(props);
          break;
        }
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        qboRecursiveContractAuditIncrementProperty_(props, QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.ERRORS, 1);
        props.setProperty(QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.LAST_ERROR, message);
        props.setProperty(QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.STATUS, QBO_RECURSIVE_CONTRACT_AUDIT_.STATUS.ERROR);
        qboRecursiveContractAuditUpdateRunRow_(ss, props, message);
        console.error('[RECURSIVE CONTRACT AUDIT] | ERROR | export=' + exportKey + ' | sourceIndex=' + cursor.sourceIndex + ' | ' + message);
        throw error;
      }
    }

    state = qboRecursiveContractAuditReadState_(props);
    shouldScheduleNext = state.status === QBO_RECURSIVE_CONTRACT_AUDIT_.STATUS.RUNNING &&
      state.cursor.exportIndex < scope.length;
  } finally {
    lock.releaseLock();
  }

  if (shouldScheduleNext) scheduleNextQboRecursiveContractAuditTrigger_();
  return result;
}

/** Watchdog: re-seed a worker only when no worker is active or scheduled. */
function watchQboRecursiveContractCoverageAudit() {
  const props = PropertiesService.getScriptProperties();
  const state = qboRecursiveContractAuditReadState_(props);
  if (state.status !== QBO_RECURSIVE_CONTRACT_AUDIT_.STATUS.RUNNING) return state;

  // The active worker holds this same script lock for its whole bounded batch.
  // If the watchdog cannot acquire it immediately, work is active and no
  // replacement trigger should be created.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    console.log('[RECURSIVE CONTRACT AUDIT] | WATCHDOG | active worker detected; no action.');
    return state;
  }
  try {
    if (!hasQboRecursiveContractAuditWorkerTrigger_()) {
      scheduleNextQboRecursiveContractAuditTrigger_();
      console.log('[RECURSIVE CONTRACT AUDIT] | WATCHDOG | worker trigger restored.');
    }
  } finally {
    lock.releaseLock();
  }
  return state;
}

function qboRecursiveContractAuditSource_(stateSs, runId, exportKey, sourceIndex, source, startedAt) {
  const manifestEntry = getQboExportManifestEntry_(exportKey);
  validateQboStateCaptureWriteSource_(source, manifestEntry);
  const sourceSs = SpreadsheetApp.openById(source.masterBackupFileId);
  const childSpecs = QBO_RECURSIVE_CONTRACT_AUDIT_.CHILD_EVIDENCE[exportKey] || [];
  const childPathCoverage = Object.create(null);
  const pathRows = [];
  let childRows = 0;
  let completeChildEvidenceRows = 0;
  let truncatedChildEvidenceRows = 0;
  let invalidChildEvidenceRows = 0;
  const childSheetsSeen = Object.create(null);

  childSpecs.forEach(function(spec) {
    const sheet = sourceSs.getSheetByName(spec.sheetName);
    if (!sheet) return;
    childSheetsSeen[spec.sheetName] = true;
    const childResult = qboRecursiveContractAuditSheet_(sheet, {
      exportKey: exportKey,
      contractLevel: QBO_RECURSIVE_CONTRACT_AUDIT_.CONTRACT_LEVEL.CHILD,
      evidenceColumn: spec.evidenceColumn,
      prefix: spec.prefix || '',
      prefixResolver: spec.prefixResolver || '',
      source: source,
      sourceIndex: sourceIndex,
      runId: runId
    });
    childRows += childResult.totalRows;
    completeChildEvidenceRows += childResult.completeRawRows;
    truncatedChildEvidenceRows += childResult.truncatedRawRows;
    invalidChildEvidenceRows += childResult.invalidRawRows;
    Array.prototype.push.apply(pathRows, childResult.rows);

    if (spec.mergeToParent !== false) {
      childResult.rows.forEach(function(row) {
        if (String(row[12] || '').indexOf('COVERED_') === 0) {
          childPathCoverage[String(row[8] || '')] = {
            sheetName: spec.sheetName,
            evidenceColumn: spec.evidenceColumn,
            status: row[12],
            method: row[13]
          };
        }
      });
      const delegatedPrefix = spec.prefix || '';
      if (delegatedPrefix) {
        childPathCoverage[delegatedPrefix] = {
          sheetName: spec.sheetName,
          evidenceColumn: spec.evidenceColumn,
          status: QBO_RECURSIVE_CONTRACT_AUDIT_.COVERAGE.CHILD,
          method: 'CHILD_DATASET_ROOT'
        };
      }
    }
  });

  const parentSheetName = manifestEntry.sheetNames[0];
  const parentSheet = sourceSs.getSheetByName(parentSheetName);
  if (!parentSheet) throw new Error('Recursive audit parent sheet missing: ' + parentSheetName);

  const parentResult = qboRecursiveContractAuditSheet_(parentSheet, {
    exportKey: exportKey,
    contractLevel: QBO_RECURSIVE_CONTRACT_AUDIT_.CONTRACT_LEVEL.PARENT,
    evidenceColumn: 'RawJSON',
    prefix: '',
    source: source,
    sourceIndex: sourceIndex,
    runId: runId,
    childPathCoverage: childPathCoverage,
    entityName: manifestEntry.entityName
  });
  Array.prototype.push.apply(pathRows, parentResult.rows);

  qboRecursiveContractAuditAppendRows_(
    stateSs.getSheetByName(QBO_STATE_CAPTURE.SHEETS.CONTRACT_AUDIT_PATHS),
    pathRows,
    QBO_STATE_CAPTURE_HEADERS.CONTRACT_AUDIT_PATHS.length
  );

  let coveredPaths = 0;
  let reviewPaths = 0;
  let uncoveredPaths = 0;
  pathRows.forEach(function(row) {
    const status = String(row[12] || '');
    if (status.indexOf('COVERED_') === 0) coveredPaths += 1;
    else if (status === QBO_RECURSIVE_CONTRACT_AUDIT_.COVERAGE.REVIEW) reviewPaths += 1;
    else if (status === QBO_RECURSIVE_CONTRACT_AUDIT_.COVERAGE.UNCOVERED) uncoveredPaths += 1;
  });

  const completedAt = new Date();
  const sourceStatus = uncoveredPaths > 0
    ? 'ACTION_REQUIRED'
    : (reviewPaths > 0 ? 'REVIEW_REQUIRED' : 'PASSED');

  qboRecursiveContractAuditAppendRows_(
    stateSs.getSheetByName(QBO_STATE_CAPTURE.SHEETS.CONTRACT_AUDIT_SOURCES),
    [[
      runId,
      exportKey,
      sourceIndex,
      source.sourceId,
      source.masterBackupFileName,
      parentResult.totalRows,
      parentResult.completeRawRows,
      parentResult.truncatedRawRows,
      parentResult.invalidRawRows,
      Object.keys(childSheetsSeen).sort().join(';'),
      childRows,
      completeChildEvidenceRows,
      truncatedChildEvidenceRows,
      invalidChildEvidenceRows,
      pathRows.length,
      coveredPaths,
      reviewPaths,
      uncoveredPaths,
      sourceStatus,
      startedAt,
      completedAt
    ]],
    QBO_STATE_CAPTURE_HEADERS.CONTRACT_AUDIT_SOURCES.length
  );

  const result = {
    version: QBO_STATE_CAPTURE.VERSION,
    auditVersion: QBO_RECURSIVE_CONTRACT_AUDIT_.AUDIT_VERSION,
    runId: runId,
    exportKey: exportKey,
    sourceIndex: sourceIndex,
    sourceId: source.sourceId,
    masterBackupFileName: source.masterBackupFileName,
    parentRows: parentResult.totalRows,
    completeParentRawRows: parentResult.completeRawRows,
    truncatedParentRawRows: parentResult.truncatedRawRows,
    invalidParentRawRows: parentResult.invalidRawRows,
    childSheetsAudited: Object.keys(childSheetsSeen).sort(),
    childRows: childRows,
    completeChildEvidenceRows: completeChildEvidenceRows,
    truncatedChildEvidenceRows: truncatedChildEvidenceRows,
    invalidChildEvidenceRows: invalidChildEvidenceRows,
    pathRowsWritten: pathRows.length,
    coveredPaths: coveredPaths,
    reviewPaths: reviewPaths,
    uncoveredPaths: uncoveredPaths,
    status: sourceStatus
  };
  console.log(JSON.stringify(result, null, 2));
  console.log('[RECURSIVE CONTRACT AUDIT] | ' + sourceStatus + ' | export=' + exportKey + ' | sourceIndex=' + sourceIndex + ' | paths=' + pathRows.length + ' | covered=' + coveredPaths + ' | review=' + reviewPaths + ' | uncovered=' + uncoveredPaths);
  return result;
}

function qboRecursiveContractAuditSheet_(sheet, options) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 1 || lastColumn < 1) {
    return {rows:[], totalRows:0, completeRawRows:0, truncatedRawRows:0, invalidRawRows:0};
  }
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values[0].map(function(v) { return String(v || '').trim(); });
  const index = Object.create(null);
  headers.forEach(function(h, i) { if (h) index[h] = i; });
  const evidenceIndex = index[options.evidenceColumn];
  if (evidenceIndex === undefined) {
    throw new Error('Recursive audit evidence column missing: ' + options.evidenceColumn + ' sheet=' + sheet.getName());
  }

  const evidenceColumns = Object.create(null);
  headers.forEach(function(header, i) {
    if (/RawJSON$/i.test(header)) evidenceColumns[i] = true;
  });
  const candidateIndexes = [];
  const jsonCandidateIndexes = [];
  headers.forEach(function(header, i) {
    if (!header || evidenceColumns[i]) return;
    candidateIndexes.push(i);
    if (/JSON$/i.test(header)) jsonCandidateIndexes.push(i);
  });

  const stats = Object.create(null);
  let completeRawRows = 0;
  let truncatedRawRows = 0;
  let invalidRawRows = 0;

  for (let r = 1; r < values.length; r += 1) {
    const row = values[r];
    const rawText = String(row[evidenceIndex] || '').trim();
    if (!rawText) continue;
    if (rawText.indexOf(QBO_STATE_CAPTURE_RAW_TRUNCATION_MARKER_) !== -1) {
      truncatedRawRows += 1;
      continue;
    }

    let raw;
    try { raw = JSON.parse(rawText); }
    catch (e) { invalidRawRows += 1; continue; }
    completeRawRows += 1;

    const prefix = qboRecursiveContractAuditResolvePrefix_(options, row, index);
    const canonical = options.contractLevel === QBO_RECURSIVE_CONTRACT_AUDIT_.CONTRACT_LEVEL.PARENT
      ? qboCanonicalizeEntityState_(options.exportKey, options.entityName || options.exportKey, raw)
      : qboCanonicalizeValue_(raw, {
          exportKey: options.exportKey,
          entityType: options.exportKey,
          path: prefix,
          parentKey: '',
          root: false
        });

    const nodes = [];
    qboRecursiveContractAuditEnumerateCanonicalNodes_(canonical, prefix, nodes, true);
    const rawSubtrees = Object.create(null);
    qboRecursiveContractAuditCollectRawSubtrees_(raw, prefix, rawSubtrees, true);

    const cellValueToColumns = Object.create(null);
    candidateIndexes.forEach(function(ci) {
      if (jsonCandidateIndexes.indexOf(ci) !== -1) return;
      qboRecursiveContractAuditScalarKeys_(row[ci]).forEach(function(key) {
        if (!cellValueToColumns[key]) cellValueToColumns[key] = [];
        if (cellValueToColumns[key].indexOf(headers[ci]) === -1) cellValueToColumns[key].push(headers[ci]);
      });
    });

    const jsonContainerMatches = [];
    jsonCandidateIndexes.forEach(function(ci) {
      const text = String(row[ci] || '').trim();
      if (!text) return;
      let parsed;
      try { parsed = JSON.parse(text); }
      catch (e) { return; }
      const stable = qboRecursiveContractAuditStableRaw_(parsed);
      const matchingPaths = rawSubtrees[stable] || [];
      matchingPaths.forEach(function(path) {
        // Exact JSON equality is necessary but not sufficient. Empty objects/arrays
        // and repeated constant structures can occur in unrelated columns. Require
        // the candidate container name to be semantically compatible with the raw
        // subtree root before accepting it as coverage evidence.
        if (qboRecursiveContractAuditJsonContainerCompatible_(path, headers[ci], options)) {
          jsonContainerMatches.push({path:path, column:headers[ci]});
        }
      });
    });

    const entityId = qboRecursiveContractAuditExampleEntityId_(raw, row, headers);
    nodes.forEach(function(node) {
      let stat = stats[node.path];
      if (!stat) {
        stat = stats[node.path] = {
          path: node.path,
          pathType: node.type,
          observedCount: 0,
          nonBlankObservedCount: 0,
          scalarCandidates: Object.create(null),
          scalarDistinct: Object.create(null),
          jsonCandidates: Object.create(null),
          exampleEntityId: entityId,
          exampleValue: qboRecursiveContractAuditExampleValue_(node.value)
        };
      }
      stat.observedCount += 1;
      if (qboRecursiveContractAuditHasValue_(node.value)) stat.nonBlankObservedCount += 1;

      if (node.type === 'SCALAR' && qboRecursiveContractAuditHasValue_(node.value)) {
        const scalarKeys = qboRecursiveContractAuditScalarKeys_(node.value);
        const distinctKey = scalarKeys.length ? scalarKeys[0] : qboRecursiveContractAuditNormalizeScalar_(node.value);
        stat.scalarDistinct[distinctKey] = true;
        const matchedColumns = Object.create(null);
        scalarKeys.forEach(function(key) {
          (cellValueToColumns[key] || []).forEach(function(column) { matchedColumns[column] = true; });
        });
        Object.keys(matchedColumns).forEach(function(column) {
          stat.scalarCandidates[column] = (stat.scalarCandidates[column] || 0) + 1;
        });
      }

      jsonContainerMatches.forEach(function(match) {
        if (qboRecursiveContractAuditPathWithin_(node.path, match.path)) {
          stat.jsonCandidates[match.column] = (stat.jsonCandidates[match.column] || 0) + 1;
        }
      });
    });
  }

  const auditedAt = new Date();
  options.sheetName = sheet.getName();
  const classifications = Object.create(null);
  Object.keys(stats).forEach(function(path) {
    classifications[path] = qboRecursiveContractAuditClassifyPath_(stats[path], headers, options);
  });
  // A structural object/array does not require its own JSON container when the
  // governed flattened contract proves coverage for every observed descendant.
  // This prevents a fully flattened address/detail object from being falsely
  // reported as missing merely because the container itself is not serialized.
  Object.keys(stats).sort(function(a, b) { return b.length - a.length; }).forEach(function(path) {
    const stat = stats[path];
    if (stat.pathType !== 'OBJECT' && stat.pathType !== 'ARRAY') return;
    const descendants = Object.keys(stats).filter(function(other) {
      return other !== path && qboRecursiveContractAuditPathWithin_(other, path);
    });
    if (!descendants.length) return;
    const allCovered = descendants.every(function(other) {
      return String(classifications[other].status || '').indexOf('COVERED_') === 0;
    });
    if (allCovered) {
      classifications[path] = {
        status: QBO_RECURSIVE_CONTRACT_AUDIT_.COVERAGE.FLATTENED,
        method: 'ALL_OBSERVED_DESCENDANTS_COVERED',
        representedBySheet: sheet.getName(),
        representedByColumn: '',
        matchCount: stat.observedCount,
        matchRate: 1,
        confidence: 'HIGH',
        actionRequired: false
      };
    }
  });

  const rows = Object.keys(stats).sort().map(function(path) {
    const stat = stats[path];
    const classification = classifications[path];
    return [
      options.runId,
      options.exportKey,
      options.sourceIndex,
      options.source.sourceId,
      options.source.masterBackupFileName,
      options.contractLevel,
      sheet.getName(),
      options.evidenceColumn,
      stat.path,
      stat.pathType,
      stat.observedCount,
      stat.nonBlankObservedCount,
      classification.status,
      classification.method,
      classification.representedBySheet || '',
      classification.representedByColumn || '',
      classification.matchCount || 0,
      classification.matchRate === '' ? '' : classification.matchRate,
      classification.confidence,
      stat.exampleEntityId,
      stat.exampleValue,
      classification.actionRequired,
      auditedAt
    ];
  });

  return {
    rows: rows,
    totalRows: Math.max(0, values.length - 1),
    completeRawRows: completeRawRows,
    truncatedRawRows: truncatedRawRows,
    invalidRawRows: invalidRawRows
  };
}

function qboRecursiveContractAuditClassifyPath_(stat, headers, options) {
  const child = options.childPathCoverage && options.childPathCoverage[stat.path];
  if (child) {
    return {
      status: QBO_RECURSIVE_CONTRACT_AUDIT_.COVERAGE.CHILD,
      method: 'GOVERNED_CHILD_DATASET',
      representedBySheet: child.sheetName,
      representedByColumn: child.evidenceColumn,
      matchCount: stat.observedCount,
      matchRate: 1,
      confidence: 'HIGH',
      actionRequired: false
    };
  }

  const bestJson = qboRecursiveContractAuditBestCandidate_(stat.jsonCandidates, stat.observedCount, stat.path);
  if (bestJson && bestJson.rate >= 0.90) {
    return {
      status: QBO_RECURSIVE_CONTRACT_AUDIT_.COVERAGE.JSON,
      method: 'EXACT_RAW_SUBTREE_JSON_CONTAINER',
      representedBySheet: options.sheetName || '',
      representedByColumn: bestJson.column,
      matchCount: bestJson.count,
      matchRate: bestJson.rate,
      confidence: 'HIGH',
      actionRequired: false
    };
  }

  if (stat.pathType === 'SCALAR' && stat.nonBlankObservedCount > 0) {
    const bestScalar = qboRecursiveContractAuditBestCandidate_(stat.scalarCandidates, stat.nonBlankObservedCount, stat.path);
    if (bestScalar) {
      const distinctScalarValues = Object.keys(stat.scalarDistinct || {}).length;
      if (
        stat.nonBlankObservedCount >= 3 &&
        bestScalar.rate >= 0.95 &&
        bestScalar.semanticScore >= 0.35
      ) {
        return {
          status: QBO_RECURSIVE_CONTRACT_AUDIT_.COVERAGE.FLATTENED,
          method: 'CONSISTENT_SCALAR_VALUE_MATCH',
          representedBySheet: '',
          representedByColumn: bestScalar.column,
          matchCount: bestScalar.count,
          matchRate: bestScalar.rate,
          confidence: bestScalar.semanticScore >= 0.35 ? 'HIGH' : 'MEDIUM',
          actionRequired: false
        };
      }
      if (stat.nonBlankObservedCount < 3 && bestScalar.rate === 1 && bestScalar.semanticScore >= 0.35) {
        return {
          status: QBO_RECURSIVE_CONTRACT_AUDIT_.COVERAGE.FLATTENED,
          method: 'LOW_SAMPLE_SEMANTIC_SCALAR_MATCH',
          representedBySheet: '',
          representedByColumn: bestScalar.column,
          matchCount: bestScalar.count,
          matchRate: bestScalar.rate,
          confidence: 'MEDIUM',
          actionRequired: false
        };
      }
      if (bestScalar.rate >= 0.50) {
        return {
          status: QBO_RECURSIVE_CONTRACT_AUDIT_.COVERAGE.REVIEW,
          method: 'AMBIGUOUS_OR_LOW_SAMPLE_SCALAR_MATCH',
          representedBySheet: '',
          representedByColumn: bestScalar.column,
          matchCount: bestScalar.count,
          matchRate: bestScalar.rate,
          confidence: 'LOW',
          actionRequired: true
        };
      }
    }
  }

  if (stat.observedCount < 3) {
    return {
      status: QBO_RECURSIVE_CONTRACT_AUDIT_.COVERAGE.REVIEW,
      method: 'INSUFFICIENT_OBSERVATIONS_TO_PROVE_COVERAGE',
      representedBySheet: '',
      representedByColumn: '',
      matchCount: 0,
      matchRate: '',
      confidence: 'LOW',
      actionRequired: true
    };
  }

  return {
    status: QBO_RECURSIVE_CONTRACT_AUDIT_.COVERAGE.UNCOVERED,
    method: 'NO_NON_RAWJSON_PHYSICAL_REPRESENTATION_PROVEN',
    representedBySheet: '',
    representedByColumn: '',
    matchCount: 0,
    matchRate: 0,
    confidence: 'HIGH',
    actionRequired: true
  };
}

function qboRecursiveContractAuditBestCandidate_(candidateCounts, denominator, path) {
  let best = null;
  Object.keys(candidateCounts || {}).forEach(function(column) {
    const count = candidateCounts[column];
    const rate = denominator ? count / denominator : 0;
    const semanticScore = qboRecursiveContractAuditSemanticScore_(path, column);
    const candidate = {column:column, count:count, rate:rate, semanticScore:semanticScore};
    if (!best || candidate.rate > best.rate ||
        (candidate.rate === best.rate && candidate.semanticScore > best.semanticScore) ||
        (candidate.rate === best.rate && candidate.semanticScore === best.semanticScore && candidate.column < best.column)) {
      best = candidate;
    }
  });
  return best;
}

function qboRecursiveContractAuditSemanticScore_(path, column) {
  const p = String(path || '').replace(/\[\]/g, '').split('.');
  const last = p.length ? p[p.length - 1] : '';
  const prev = p.length > 1 ? p[p.length - 2] : '';
  const c = qboRecursiveContractAuditSemanticNorm_(column);
  const targets = [];

  function addTarget_(value) {
    const normalized = qboRecursiveContractAuditSemanticNorm_(value);
    if (normalized && targets.indexOf(normalized) === -1) targets.push(normalized);
  }

  addTarget_(last);
  if (prev) addTarget_(prev + last);

  if (last === 'value') {
    // QBO wrapper objects frequently expose the business value as `.value`.
    // For references the flattened contract normally uses `<Base>Id`; Currency
    // is commonly represented as CurrencyCode. For non-reference wrappers
    // (CustomerMemo.value, etc.) the wrapper name itself is the semantic target.
    if (/Ref$/.test(prev)) {
      const base = prev.replace(/Ref$/, '');
      addTarget_(base + 'Id');
      addTarget_(base);
      if (/^Currency$/i.test(base)) addTarget_(base + 'Code');
    } else {
      addTarget_(prev);
    }
  }

  if (last === 'Address' && prev) {
    addTarget_(prev);
    addTarget_(prev.replace(/Addr$/, ''));
  }
  if (last === 'FreeFormNumber' && prev) addTarget_(prev);
  if (last === 'URI' && prev) {
    addTarget_(prev);
    addTarget_(prev.replace(/Addr$/, 'Address'));
  }
  if (/^CountrySubDivisionCode$/i.test(last)) {
    addTarget_('State');
    if (prev) addTarget_(prev + 'State');
  }

  let best = 0;
  targets.forEach(function(target) {
    if (c === target) best = Math.max(best, 1);
    else if (target && (c.indexOf(target) !== -1 || target.indexOf(c) !== -1)) best = Math.max(best, 0.75);
  });

  if (last === 'value' && /Ref$/.test(prev)) {
    const base = qboRecursiveContractAuditSemanticNorm_(prev.replace(/Ref$/, ''));
    if (base && c.indexOf(base) !== -1 && (/(id|code)$/.test(c))) best = Math.max(best, 0.9);
  }
  return best;
}

function qboRecursiveContractAuditSemanticNorm_(value) {
  let s = qboRecursiveContractAuditNameNorm_(value);
  // Expand common QBO/export abbreviations before comparing names.
  s = s.replace(/txn/g, 'transaction')
       .replace(/amt/g, 'amount')
       .replace(/qty/g, 'quantity')
       .replace(/addr(?!ess)/g, 'address')
       .replace(/desc(?!ription)/g, 'description');
  return s;
}

function qboRecursiveContractAuditNameNorm_(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Exact serialized JSON equality is only accepted when the candidate column
 * is semantically compatible with the matched raw subtree root. This prevents
 * unrelated empty [] / {} values from proving false coverage.
 */
function qboRecursiveContractAuditJsonContainerCompatible_(rawPath, column, options) {
  const path = String(rawPath || '');
  const col = String(column || '');
  const colNorm = qboRecursiveContractAuditSemanticNorm_(col.replace(/JSON$/i, ''));
  const segments = path.replace(/\[\]/g, '').split('.');
  const last = segments.length ? segments[segments.length - 1] : '';
  const lastNorm = qboRecursiveContractAuditSemanticNorm_(last);

  const aliases = {
    transactiontaxdetail: ['txntaxdetail'],
    linkedtransactions: ['linkedtransaction'],
    linkedothertransactions: ['linkedtransaction'],
    customfields: ['customfield'],
    deliveryinfo: ['deliveryinfo'],
    creditcardpayment: ['creditcardpayment'],
    shipfromaddress: ['shipfromaddress'],
    recurdataref: ['recurdataref'],
    taxexemptionref: ['taxexemptionref'],
    cashback: ['cashback'],
    customextensions: ['customextensions']
  };

  if (lastNorm && (colNorm === lastNorm || colNorm.indexOf(lastNorm) !== -1 || lastNorm.indexOf(colNorm) !== -1)) return true;

  const aliasTargets = aliases[colNorm] || [];
  if (aliasTargets.indexOf(lastNorm) !== -1) return true;

  // Recurring transactions intentionally retain the entire embedded Invoice /
  // SalesReceipt/etc. object in EmbeddedTransactionJSON.
  if (colNorm === 'embeddedtransaction' && options && options.exportKey === 'RECURRING_TRANSACTIONS') {
    if (segments.length === 1 && /^(Invoice|SalesReceipt|Estimate|CreditMemo|Bill|Purchase|RefundReceipt)$/i.test(last)) return true;
  }

  // Recurring child rows retain the polymorphic detail object in LineDetailJSON.
  if (colNorm === 'linedetail' && /LineDetail$/i.test(last)) return true;

  return false;
}

function qboRecursiveContractAuditResolvePrefix_(options, row, index) {
  if (options.prefixResolver === 'TAX_CODE_RATE') {
    const rateListType = index.RateListType === undefined ? '' : String(row[index.RateListType] || '');
    return /^purchase/i.test(rateListType)
      ? 'PurchaseTaxRateList.TaxRateDetail[]'
      : 'SalesTaxRateList.TaxRateDetail[]';
  }
  return String(options.prefix || '');
}

function qboRecursiveContractAuditEnumerateCanonicalNodes_(value, basePath, output, skipRoot) {
  if (value === null || typeof value !== 'object') {
    if (basePath) output.push({path:basePath, type:'SCALAR', value:value});
    return;
  }

  if (Array.isArray(value)) {
    const arrayPath = /\[\]$/.test(basePath) ? basePath : basePath + '[]';
    if (!skipRoot && arrayPath) output.push({path:arrayPath, type:'ARRAY', value:value});
    value.forEach(function(item) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        Object.keys(item).forEach(function(key) {
          qboRecursiveContractAuditEnumerateCanonicalNodes_(item[key], arrayPath + '.' + key, output, false);
        });
      } else if (Array.isArray(item)) {
        qboRecursiveContractAuditEnumerateCanonicalNodes_(item, arrayPath, output, true);
      } else {
        output.push({path:arrayPath, type:'SCALAR', value:item});
      }
    });
    return;
  }

  if (!skipRoot && basePath) output.push({path:basePath, type:'OBJECT', value:value});
  Object.keys(value).forEach(function(key) {
    const path = basePath ? basePath + '.' + key : key;
    qboRecursiveContractAuditEnumerateCanonicalNodes_(value[key], path, output, false);
  });
}

function qboRecursiveContractAuditCollectRawSubtrees_(value, basePath, map, skipRoot) {
  if (value === null || typeof value !== 'object') return;
  const stable = qboRecursiveContractAuditStableRaw_(value);
  if (!skipRoot && basePath) {
    if (!map[stable]) map[stable] = [];
    map[stable].push(basePath);
  }

  if (Array.isArray(value)) {
    const arrayPath = /\[\]$/.test(basePath) ? basePath : basePath + '[]';
    value.forEach(function(item) {
      qboRecursiveContractAuditCollectRawSubtrees_(item, arrayPath, map, false);
    });
    return;
  }

  Object.keys(value).forEach(function(key) {
    if (key === 'domain' || key === 'sparse' || key === 'SyncToken' || key === 'MetaData' || key === 'V4IDPseudonym') return;
    const child = value[key];
    if (child === null || typeof child !== 'object') return;
    const path = basePath ? basePath + '.' + key : key;
    if (Array.isArray(child)) {
      const arrayPath = path + '[]';
      const arrayStable = qboRecursiveContractAuditStableRaw_(child);
      if (!map[arrayStable]) map[arrayStable] = [];
      map[arrayStable].push(arrayPath);
      child.forEach(function(item) {
        qboRecursiveContractAuditCollectRawSubtrees_(item, arrayPath, map, false);
      });
    } else {
      const childStable = qboRecursiveContractAuditStableRaw_(child);
      if (!map[childStable]) map[childStable] = [];
      map[childStable].push(path);
      qboRecursiveContractAuditCollectRawSubtrees_(child, path, map, true);
    }
  });
}

function qboRecursiveContractAuditStableRaw_(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return '[' + value.map(qboRecursiveContractAuditStableRaw_).join(',') + ']';
  if (typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(function(key) {
      return JSON.stringify(key) + ':' + qboRecursiveContractAuditStableRaw_(value[key]);
    }).join(',') + '}';
  }
  return JSON.stringify(value);
}

function qboRecursiveContractAuditPathWithin_(path, containerPath) {
  if (!containerPath) return false;
  return path === containerPath ||
    path.indexOf(containerPath + '.') === 0 ||
    path.indexOf(containerPath + '[]') === 0;
}

function qboRecursiveContractAuditScalarKeys_(value) {
  if (value === null || value === undefined || value === '') return [];
  const keys = [];
  function add_(key) {
    key = String(key || '');
    if (key && keys.indexOf(key) === -1) keys.push(key);
  }

  if (value instanceof Date) {
    add_('ts:' + value.toISOString());
    // Google Sheets getValues() materializes date-only cells as Date objects.
    // Compare those against QBO's YYYY-MM-DD strings using the script timezone
    // so timezone conversion does not turn a valid date into the prior/next day.
    add_('date:' + Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd'));
    return keys;
  }
  if (typeof value === 'boolean') {
    add_('bool:' + (value ? 'true' : 'false'));
    return keys;
  }
  if (typeof value === 'number') {
    add_('num:' + String(value));
    // QBO reference IDs, document numbers, and postal codes are often JSON
    // strings, while Google Sheets may materialize the same digit-only value
    // as a Number. Add a lossless safe-integer bridge without collapsing
    // formatted strings such as leading-zero identifiers.
    if (Number.isSafeInteger(value)) add_('integer:' + String(value));
    return keys;
  }

  const text = String(value).trim();
  if (!text) return [];
  add_('str:' + text);
  if (/^-?(?:0|[1-9]\d*)$/.test(text)) add_('integer:' + text);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) add_('date:' + text);
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const parsed = new Date(text);
    if (!isNaN(parsed.getTime())) add_('ts:' + parsed.toISOString());
  }
  return keys;
}

function qboRecursiveContractAuditNormalizeScalar_(value) {
  const keys = qboRecursiveContractAuditScalarKeys_(value);
  return keys.length ? keys[0] : '';
}

function qboRecursiveContractAuditHasValue_(value) {
  return value !== null && value !== undefined && value !== '';
}

function qboRecursiveContractAuditExampleEntityId_(raw, row, headers) {
  if (raw && raw.Id !== undefined && raw.Id !== null) return String(raw.Id);
  const idIndexes = [];
  headers.forEach(function(header, index) { if (/Id$/.test(header)) idIndexes.push(index); });
  for (let i = 0; i < idIndexes.length; i += 1) {
    const value = String(row[idIndexes[i]] || '').trim();
    if (value) return value;
  }
  return '';
}

function qboRecursiveContractAuditExampleValue_(value) {
  let text;
  try {
    text = value && typeof value === 'object'
      ? qboRecursiveContractAuditStableRaw_(value)
      : String(value === undefined ? '' : value);
  } catch (e) {
    text = String(value || '');
  }
  return text.length > 500 ? text.slice(0, 497) + '...' : text;
}

function qboRecursiveContractAuditAppendRows_(sheet, rows, width) {
  if (!rows || !rows.length) return;
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, width).setValues(rows);
  sheet.getRange(sheet.getLastRow() - rows.length + 1, 1, rows.length, width)
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
}

function scheduleNextQboRecursiveContractAuditTrigger_() {
  deleteQboRecursiveContractAuditWorkerTriggers_();
  const trigger = ScriptApp.newTrigger(QBO_RECURSIVE_CONTRACT_AUDIT_.HANDLER)
    .timeBased()
    .after(QBO_RECURSIVE_CONTRACT_AUDIT_.NEXT_TRIGGER_DELAY_MS)
    .create();
  console.log('[RECURSIVE CONTRACT AUDIT] | NEXT SCHEDULED | triggerId=' + trigger.getUniqueId());
}

function installQboRecursiveContractAuditWatchdog_() {
  deleteQboRecursiveContractAuditWatchdogTriggers_();
  ScriptApp.newTrigger(QBO_RECURSIVE_CONTRACT_AUDIT_.WATCHDOG_HANDLER)
    .timeBased()
    .everyMinutes(10)
    .create();
}

function hasQboRecursiveContractAuditWorkerTrigger_() {
  return ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === QBO_RECURSIVE_CONTRACT_AUDIT_.HANDLER;
  });
}

function deleteQboRecursiveContractAuditWorkerTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === QBO_RECURSIVE_CONTRACT_AUDIT_.HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function deleteQboRecursiveContractAuditWatchdogTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === QBO_RECURSIVE_CONTRACT_AUDIT_.WATCHDOG_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function deleteAllQboRecursiveContractAuditTriggers_() {
  deleteQboRecursiveContractAuditWorkerTriggers_();
  deleteQboRecursiveContractAuditWatchdogTriggers_();
}

function qboRecursiveContractAuditDeleteSourceRows_(ss, runId, exportKey, sourceId) {
  [
    QBO_STATE_CAPTURE.SHEETS.CONTRACT_AUDIT_PATHS,
    QBO_STATE_CAPTURE.SHEETS.CONTRACT_AUDIT_SOURCES
  ].forEach(function(sheetName) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() < 2) return;
    const lastRow = sheet.getLastRow();
    const width = Math.min(4, sheet.getLastColumn());
    const rows = sheet.getRange(2, 1, lastRow - 1, width).getValues();
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const rowRunId = String(rows[i][0] || '');
      const rowExportKey = String(rows[i][1] || '');
      const rowSourceId = sheetName === QBO_STATE_CAPTURE.SHEETS.CONTRACT_AUDIT_PATHS
        ? String(rows[i][3] || '')
        : String(rows[i][3] || '');
      if (rowRunId === runId && rowExportKey === exportKey && rowSourceId === sourceId) {
        sheet.deleteRow(i + 2);
      }
    }
  });
}

function qboRecursiveContractAuditReadState_(props) {
  let cursor = {exportIndex:0, sourceIndex:0};
  const rawCursor = props.getProperty(QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.CURSOR);
  if (rawCursor) {
    try { cursor = JSON.parse(rawCursor); } catch (e) {}
  }
  return {
    runId: String(props.getProperty(QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.RUN_ID) || ''),
    status: String(props.getProperty(QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.STATUS) || ''),
    startedAt: String(props.getProperty(QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.STARTED_AT) || ''),
    cursor: cursor,
    sourceCountProcessed: Number(props.getProperty(QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.SOURCE_COUNT) || 0),
    pathRowsWritten: Number(props.getProperty(QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.PATH_ROWS) || 0),
    coveredPaths: Number(props.getProperty(QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.COVERED) || 0),
    reviewPaths: Number(props.getProperty(QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.REVIEW) || 0),
    uncoveredPaths: Number(props.getProperty(QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.UNCOVERED) || 0),
    errorCount: Number(props.getProperty(QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.ERRORS) || 0),
    lastError: String(props.getProperty(QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.LAST_ERROR) || '')
  };
}

function qboRecursiveContractAuditIncrementProperty_(props, key, delta) {
  const next = Number(props.getProperty(key) || 0) + Number(delta || 0);
  props.setProperty(key, String(next));
  return next;
}

function completeQboRecursiveContractCoverageAudit_(props) {
  props.setProperty(QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.STATUS, QBO_RECURSIVE_CONTRACT_AUDIT_.STATUS.COMPLETE);
  deleteAllQboRecursiveContractAuditTriggers_();
  props.deleteProperty(QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.IN_PROGRESS_SOURCE);
  const ss = getQboStateCaptureSpreadsheet_();
  // Progress counters are intentionally lightweight and can count a source
  // more than once if an execution is retried. Reconcile the COMPLETE row
  // from persisted, source-keyed audit evidence so final totals are authoritative.
  qboRecursiveContractAuditReconcileRunCounters_(ss, props);
  qboRecursiveContractAuditUpdateRunRow_(ss, props, '');
  const state = qboRecursiveContractAuditReadState_(props);
  console.log('[RECURSIVE CONTRACT AUDIT] | COMPLETE | runId=' + state.runId + ' | sources=' + state.sourceCountProcessed + ' | paths=' + state.pathRowsWritten + ' | covered=' + state.coveredPaths + ' | review=' + state.reviewPaths + ' | uncovered=' + state.uncoveredPaths);
  return state;
}

function qboRecursiveContractAuditReconcileRunCounters_(ss, props) {
  const state = qboRecursiveContractAuditReadState_(props);
  const runId = state.runId;
  const pathSheet = ss.getSheetByName(QBO_STATE_CAPTURE.SHEETS.CONTRACT_AUDIT_PATHS);
  const sourceSheet = ss.getSheetByName(QBO_STATE_CAPTURE.SHEETS.CONTRACT_AUDIT_SOURCES);
  const pathHeaders = QBO_STATE_CAPTURE_HEADERS.CONTRACT_AUDIT_PATHS;
  const sourceHeaders = QBO_STATE_CAPTURE_HEADERS.CONTRACT_AUDIT_SOURCES;
  const pathIndex = Object.create(null);
  const sourceIndex = Object.create(null);
  pathHeaders.forEach(function(header, index) { pathIndex[header] = index; });
  sourceHeaders.forEach(function(header, index) { sourceIndex[header] = index; });

  const uniqueSources = Object.create(null);
  if (sourceSheet && sourceSheet.getLastRow() >= 2) {
    const sourceValues = sourceSheet.getRange(
      2, 1, sourceSheet.getLastRow() - 1, sourceHeaders.length
    ).getValues();
    sourceValues.forEach(function(row) {
      if (String(row[sourceIndex.RunId] || '') !== runId) return;
      const exportKey = String(row[sourceIndex.ExportKey] || '');
      const sourceId = String(row[sourceIndex.SourceId] || '');
      if (exportKey && sourceId) uniqueSources[exportKey + '|' + sourceId] = true;
    });
  }

  const uniquePaths = Object.create(null);
  let covered = 0;
  let review = 0;
  let uncovered = 0;
  if (pathSheet && pathSheet.getLastRow() >= 2) {
    const pathValues = pathSheet.getRange(
      2, 1, pathSheet.getLastRow() - 1, pathHeaders.length
    ).getValues();
    pathValues.forEach(function(row) {
      if (String(row[pathIndex.RunId] || '') !== runId) return;
      const key = [
        row[pathIndex.ExportKey],
        row[pathIndex.SourceId],
        row[pathIndex.ContractLevel],
        row[pathIndex.SheetName],
        row[pathIndex.RawEvidenceColumn],
        row[pathIndex.CanonicalPath],
        row[pathIndex.CoverageStatus],
        row[pathIndex.CoverageMethod],
        row[pathIndex.RepresentedBySheet],
        row[pathIndex.RepresentedByColumn]
      ].map(function(value) { return String(value || ''); }).join('|');
      if (uniquePaths[key]) return;
      uniquePaths[key] = true;
      const status = String(row[pathIndex.CoverageStatus] || '');
      if (status.indexOf('COVERED_') === 0) covered += 1;
      else if (status === 'REVIEW_REQUIRED') review += 1;
      else if (status === 'UNCOVERED') uncovered += 1;
    });
  }

  props.setProperties({
    [QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.SOURCE_COUNT]: String(Object.keys(uniqueSources).length),
    [QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.PATH_ROWS]: String(Object.keys(uniquePaths).length),
    [QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.COVERED]: String(covered),
    [QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.REVIEW]: String(review),
    [QBO_RECURSIVE_CONTRACT_AUDIT_.PROPERTIES.UNCOVERED]: String(uncovered)
  }, false);
}

function appendQboRecursiveContractAuditRunRow_(ss, record) {
  const sheet = ss.getSheetByName(QBO_STATE_CAPTURE.SHEETS.CONTRACT_AUDIT_RUNS);
  qboRecursiveContractAuditAppendRows_(sheet, [[
    record.runId,
    QBO_STATE_CAPTURE.VERSION,
    QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
    record.status,
    record.startedAt,
    record.completedAt,
    record.exportCount,
    record.sourceCountProcessed,
    record.pathRowsWritten,
    record.coveredPaths,
    record.reviewPaths,
    record.uncoveredPaths,
    record.errorCount,
    record.cursorExportIndex,
    record.cursorSourceIndex,
    record.lastError
  ]], QBO_STATE_CAPTURE_HEADERS.CONTRACT_AUDIT_RUNS.length);
}

function qboRecursiveContractAuditUpdateRunRow_(ss, props, lastError) {
  const state = qboRecursiveContractAuditReadState_(props);
  const sheet = ss.getSheetByName(QBO_STATE_CAPTURE.SHEETS.CONTRACT_AUDIT_RUNS);
  if (!sheet || sheet.getLastRow() < 2) return;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, QBO_STATE_CAPTURE_HEADERS.CONTRACT_AUDIT_RUNS.length).getValues();
  let rowNumber = 0;
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (String(values[i][0] || '') === state.runId) { rowNumber = i + 2; break; }
  }
  if (!rowNumber) return;
  const completedAt = state.status === QBO_RECURSIVE_CONTRACT_AUDIT_.STATUS.COMPLETE ||
    state.status === QBO_RECURSIVE_CONTRACT_AUDIT_.STATUS.STOPPED ||
    state.status === QBO_RECURSIVE_CONTRACT_AUDIT_.STATUS.ERROR
    ? new Date()
    : '';
  sheet.getRange(rowNumber, 1, 1, QBO_STATE_CAPTURE_HEADERS.CONTRACT_AUDIT_RUNS.length).setValues([[
    state.runId,
    QBO_STATE_CAPTURE.VERSION,
    QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
    state.status,
    state.startedAt,
    completedAt,
    QBO_STATE_CAPTURE.CANONICAL_MIGRATION_SCOPE.length,
    state.sourceCountProcessed,
    state.pathRowsWritten,
    state.coveredPaths,
    state.reviewPaths,
    state.uncoveredPaths,
    state.errorCount,
    state.cursor.exportIndex,
    state.cursor.sourceIndex,
    lastError || state.lastError || ''
  ]]);
}
