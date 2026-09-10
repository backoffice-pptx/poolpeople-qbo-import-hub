/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 24_TriggerManagement.js
 * Purpose     : Install, inspect, and run the daily QBO export schedule while
 *               keeping each exporter in its own Apps Script execution.
 *
 * Public API:
 *   - installDailyQboExportTriggers()
 *   - listQboExportTriggers()
 *   - removeDailyQboExportTriggers()
 *   - startDailyQboExportSchedule()
 *   - resumeQboExportSchedule()
 *
 * Trigger Entry Points:
 *   - runNextScheduledQboExport()
 *
 * Architecture Notes:
 *   - Application 50 intentionally does NOT create one durable trigger per
 *     exporter because Apps Script imposes a per-user/per-script trigger limit.
 *   - One durable daily starter trigger begins a queue. The queue creates only
 *     one transient next-export trigger at a time.
 *   - Each QBO exporter therefore receives an isolated Apps Script execution;
 *     this does not use or depend on 99_TriggeredCalls.js.
 *   - A failed exporter does not block later exporters. The next exporter is
 *     scheduled in finally, then the original error is rethrown so Apps Script
 *     records that execution as failed.
 *
 * Change History:
 *   - 2026-09-03: Replaced the scheduled-export switch with one executable
 *     registry and added one-to-one manifest/schedule/registry validation.
 *   - 2026-09-02: Added persistent scheduled-run history/status recording for
 *     run start/completion and each isolated exporter execution.
 *   - 2026-09-02: Added same-run resume from the first exporter that did not
 *     complete successfully after an interrupted/stranded chain.
 *   - 2026-09-01: Added production preflight validation before a daily queue
 *     is initialized, so configuration failures stop before any exporter runs.
 *   - 2026-09-01: Added chained daily trigger management for 22 independent
 *     exporters without exceeding Apps Script installable-trigger limits.
 * ============================================================================
 */

const DAILY_QBO_EXPORT_ORDER = Object.freeze([
  'PREFERENCES',
  'CLASSES',
  'TERMS',
  'PAYMENT_METHODS',
  'TAX_CODES',
  'DEPARTMENTS',
  'ACCOUNTS',
  'VENDORS',
  'CUSTOMERS',
  'ITEMS',
  'ESTIMATES',
  'BILLS',
  'BILL_PAYMENTS',
  'PURCHASES',
  'DEPOSITS',
  'CREDIT_MEMOS',
  'JOURNAL_ENTRIES',
  'SALES_RECEIPTS',
  'REFUND_RECEIPTS',
  'RECURRING_TRANSACTIONS',
  'PAYMENTS',
  'INVOICES'
]);

const DAILY_QBO_TRIGGER_HANDLERS = Object.freeze({
  START: 'startDailyQboExportSchedule',
  NEXT: 'runNextScheduledQboExport'
});

const DAILY_QBO_QUEUE_PROPERTIES = Object.freeze({
  INDEX: 'QBO_DAILY_EXPORT_QUEUE_INDEX',
  RUN_ID: 'QBO_DAILY_EXPORT_RUN_ID',
  STARTED_AT: 'QBO_DAILY_EXPORT_STARTED_AT',
  FAILED_COUNT: 'QBO_DAILY_EXPORT_FAILED_COUNT'
});


/**
 * Concrete callable registry for scheduled exporters.
 *
 * The manifest remains the descriptive authority. Validation requires every
 * manifest exportFunctionName to have exactly one callable here, with no
 * extra scheduled exporters outside the manifest.
 */
const QBO_SCHEDULED_EXPORTERS = Object.freeze({
  exportQboCustomers: exportQboCustomers,
  exportQboPreferences: exportQboPreferences,
  exportQboItems: exportQboItems,
  exportQboClasses: exportQboClasses,
  exportQboTerms: exportQboTerms,
  exportQboPaymentMethods: exportQboPaymentMethods,
  exportQboTaxCodes: exportQboTaxCodes,
  exportQboDepartments: exportQboDepartments,
  exportQboVendors: exportQboVendors,
  exportQboAccounts: exportQboAccounts,
  exportQboInvoices: exportQboInvoices,
  exportQboPayments: exportQboPayments,
  exportQboCreditMemos: exportQboCreditMemos,
  exportQboEstimates: exportQboEstimates,
  exportQboBills: exportQboBills,
  exportQboBillPayments: exportQboBillPayments,
  exportQboPurchases: exportQboPurchases,
  exportQboDeposits: exportQboDeposits,
  exportQboJournalEntries: exportQboJournalEntries,
  exportQboSalesReceipts: exportQboSalesReceipts,
  exportQboRecurringTransactions: exportQboRecurringTransactions,
  exportQboRefundReceipts: exportQboRefundReceipts
});

/**
 * Installs exactly one durable daily starter trigger.
 * Existing Application-50-managed starter/queue triggers are removed first.
 */
function installDailyQboExportTriggers() {
  validateDailyQboExportSchedule_();
  removeDailyQboExportTriggers();

  const timezone = Session.getScriptTimeZone();
  const trigger = ScriptApp.newTrigger(DAILY_QBO_TRIGGER_HANDLERS.START)
    .timeBased()
    .atHour(DAILY_EXPORT_SCHEDULE.START_HOUR)
    .nearMinute(DAILY_EXPORT_SCHEDULE.START_MINUTE)
    .everyDays(1)
    .inTimezone(timezone)
    .create();

  console.log(
    '[TRIGGER] | INSTALLED | handler=' + DAILY_QBO_TRIGGER_HANDLERS.START +
    ' | timezone=' + timezone +
    ' | approximately=' + padTwoDigits_(DAILY_EXPORT_SCHEDULE.START_HOUR) + ':' +
    padTwoDigits_(DAILY_EXPORT_SCHEDULE.START_MINUTE) +
    ' | triggerId=' + trigger.getUniqueId()
  );

  listQboExportTriggers();
}

/**
 * Logs Application-50-managed daily/queue triggers and queue state.
 */
function listQboExportTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  let managedCount = 0;

  triggers.forEach(function(trigger) {
    const handler = trigger.getHandlerFunction();
    if (!isManagedDailyQboTriggerHandler_(handler)) {
      return;
    }

    managedCount += 1;
    console.log(
      '[TRIGGER] | ACTIVE | handler=' + handler +
      ' | source=' + trigger.getTriggerSource() +
      ' | event=' + trigger.getEventType() +
      ' | triggerId=' + trigger.getUniqueId()
    );
  });

  const props = PropertiesService.getScriptProperties();
  console.log(
    '[TRIGGER] | STATUS | managed=' + managedCount +
    ' | queueIndex=' + (props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.INDEX) || '') +
    ' | runId=' + (props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.RUN_ID) || '') +
    ' | timezone=' + Session.getScriptTimeZone()
  );
}

/**
 * Removes the durable daily starter and any transient queue trigger, then
 * clears queue state. Other project triggers are left untouched.
 */
function removeDailyQboExportTriggers() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const props = PropertiesService.getScriptProperties();
    closeStaleDailyQboRunHistory_(props, 'CANCELLED');
    deleteManagedDailyQboTriggers_();
    clearDailyQboQueueState_();
  } finally {
    lock.releaseLock();
  }

  console.log('[TRIGGER] | REMOVED | Application 50 daily export triggers cleared.');
}

/**
 * Durable daily entry point. Initializes a fresh queue and schedules the first
 * isolated exporter execution.
 */
function startDailyQboExportSchedule() {
  // Validate all read-only production prerequisites before queue state is
  // created. A failed preflight therefore cannot leave a partially initialized
  // daily run or launch any exporter.
  validateQboExportPreflight_();

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    deleteManagedNextQboTriggers_();

    const props = PropertiesService.getScriptProperties();
    closeStaleDailyQboRunHistory_(props, 'REPLACED');

    const runId = Utilities.getUuid();
    const startedAt = new Date().toISOString();

    // Run-history initialization is a required start control. If it fails,
    // queue state is not created and no exporter is launched.
    recordQboScheduledRunStart_(
      runId,
      startedAt,
      DAILY_QBO_EXPORT_ORDER.length
    );

    props.setProperty(DAILY_QBO_QUEUE_PROPERTIES.INDEX, '0');
    props.setProperty(DAILY_QBO_QUEUE_PROPERTIES.RUN_ID, runId);
    props.setProperty(DAILY_QBO_QUEUE_PROPERTIES.STARTED_AT, startedAt);
    props.setProperty(DAILY_QBO_QUEUE_PROPERTIES.FAILED_COUNT, '0');

    console.log(
      '[SCHEDULE] | START | runId=' + runId +
      ' | exports=' + DAILY_QBO_EXPORT_ORDER.length
    );

    scheduleNextQboExportTrigger_();
  } finally {
    lock.releaseLock();
  }
}


/**
 * Resumes the current stranded run, or the latest resumable historical run,
 * at the first exporter that did not complete successfully.
 *
 * The same RunId is preserved. Previously COMPLETE exporters are not rerun.
 * A prior INTERRUPTED attempt remains in history; the retry is recorded as a
 * new exporter attempt for the same run and position.
 */
function resumeQboExportSchedule() {
  validateQboExportPreflight_();

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    deleteManagedNextQboTriggers_();

    const props = PropertiesService.getScriptProperties();
    let runId = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.RUN_ID);
    let resumeState;

    if (runId) {
      resumeState = getQboScheduledRunResumeState_(runId);
    } else {
      resumeState = getLatestQboScheduledRunResumeState_();
      if (!resumeState || !resumeState.runId) {
        throw new Error(
          'No resumable QBO export run was found. Start a new run with ' +
          'startDailyQboExportSchedule().'
        );
      }
      runId = resumeState.runId;
    }

    // A platform-level Apps Script termination can leave the active exporter
    // attempt recorded as RUNNING because its catch/finally never executes.
    // Before retrying, close any such attempt as INTERRUPTED so history never
    // implies that an old execution is still active.
    const interruptedAt = new Date();
    const interruptedExportCount = recordQboScheduledRunningExportsInterrupted_(
      runId,
      interruptedAt,
      'INTERRUPTED',
      'Execution terminated unexpectedly before exporter completed normally.'
    );

    if (interruptedExportCount > 0) {
      console.log(
        '[RUN HISTORY] | EXPORT INTERRUPTED | runId=' + runId +
        ' | count=' + interruptedExportCount +
        ' | parentStatus=RESUME'
      );

      // Reconstruct state after closing the stranded attempt so the retry
      // decision is based on durable, non-RUNNING history.
      resumeState = getQboScheduledRunResumeState_(runId);
    }

    if (resumeState.resumeIndex >= DAILY_QBO_EXPORT_ORDER.length) {
      throw new Error(
        'Run ' + runId + ' has no incomplete exporters to resume.'
      );
    }

    const resumeKey = DAILY_QBO_EXPORT_ORDER[resumeState.resumeIndex];

    // Restore queue state before re-opening history so the scheduler and
    // durable status describe the same logical run.
    props.setProperty(
      DAILY_QBO_QUEUE_PROPERTIES.INDEX,
      String(resumeState.resumeIndex)
    );
    props.setProperty(DAILY_QBO_QUEUE_PROPERTIES.RUN_ID, runId);
    props.setProperty(
      DAILY_QBO_QUEUE_PROPERTIES.STARTED_AT,
      resumeState.startedAt
    );
    props.setProperty(
      DAILY_QBO_QUEUE_PROPERTIES.FAILED_COUNT,
      String(resumeState.failedCount)
    );

    recordQboScheduledRunResumed_(
      runId,
      resumeState.completedCount,
      resumeState.failedCount,
      resumeState.resumeIndex + 1,
      resumeKey
    );

    console.log(
      '[SCHEDULE] | RESUME | runId=' + runId +
      ' | position=' + (resumeState.resumeIndex + 1) + '/' +
      DAILY_QBO_EXPORT_ORDER.length +
      ' | export=' + resumeKey +
      ' | completed=' + resumeState.completedCount +
      ' | failed=' + resumeState.failedCount
    );

    scheduleNextQboExportTrigger_();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Transient queue entry point. Runs exactly one exporter in this execution,
 * advances queue state, schedules the next execution, and rethrows failures.
 */
function runNextScheduledQboExport() {
  validateDailyQboExportSchedule_();

  const props = PropertiesService.getScriptProperties();
  const runId = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.RUN_ID);
  const indexValue = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.INDEX);
  const failedCountValue = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.FAILED_COUNT) || '0';

  if (!runId || indexValue === null) {
    throw new Error(
      'Daily QBO export queue is not initialized. Run startDailyQboExportSchedule().' 
    );
  }

  const index = Number(indexValue);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error('Invalid daily QBO export queue index: ' + indexValue + '.');
  }

  let failedCount = Number(failedCountValue);
  if (!Number.isInteger(failedCount) || failedCount < 0) {
    failedCount = 0;
  }

  if (index >= DAILY_QBO_EXPORT_ORDER.length) {
    completeDailyQboExportSchedule_(runId, failedCount);
    return;
  }

  const exportKey = DAILY_QBO_EXPORT_ORDER[index];
  const entry = getQboExportManifestEntry_(exportKey);
  if (!entry) {
    throw new Error('Daily schedule references unknown export key: ' + exportKey + '.');
  }

  console.log(
    '[SCHEDULE] | EXPORT START | runId=' + runId +
    ' | position=' + (index + 1) + '/' + DAILY_QBO_EXPORT_ORDER.length +
    ' | export=' + exportKey +
    ' | function=' + entry.exportFunctionName
  );

  const exportStartedAt = new Date();
  safeRecordQboRunHistory_(function() {
    recordQboScheduledRunProgress_(
      runId,
      index - failedCount,
      failedCount,
      index + 1,
      exportKey
    );
    recordQboScheduledExportStart_(runId, index + 1, entry, exportStartedAt);
  }, 'export start', runId, exportKey);

  let exportError = null;
  let masterBackupMetadata = null;

  try {
    invokeScheduledQboExporter_(entry.exportFunctionName);
    masterBackupMetadata = consumeQboExporterMasterBackupMetadata_(exportKey);

    if (!masterBackupMetadata) {
      throw new Error(
        'Exporter completed without returning Master Backup metadata for ' +
        exportKey + '.'
      );
    }

    console.log(
      '[SCHEDULE] | EXPORT COMPLETE | runId=' + runId +
      ' | export=' + exportKey
    );
    safeRecordQboRunHistory_(function() {
      recordQboScheduledExportResult_(
        runId,
        entry,
        new Date(),
        'COMPLETE',
        Date.now() - exportStartedAt.getTime(),
        '',
        masterBackupMetadata
      );
    }, 'export complete', runId, exportKey);
  } catch (err) {
    exportError = err;
    failedCount += 1;
    props.setProperty(
      DAILY_QBO_QUEUE_PROPERTIES.FAILED_COUNT,
      String(failedCount)
    );
    console.error(
      '[SCHEDULE] | EXPORT ERROR | runId=' + runId +
      ' | export=' + exportKey +
      ' | error=' + (err && err.message ? err.message : err)
    );
    safeRecordQboRunHistory_(function() {
      recordQboScheduledExportResult_(
        runId,
        entry,
        new Date(),
        'ERROR',
        Date.now() - exportStartedAt.getTime(),
        err && err.message ? err.message : String(err)
      );
    }, 'export error', runId, exportKey);
  } finally {
    const nextIndex = index + 1;
    props.setProperty(DAILY_QBO_QUEUE_PROPERTIES.INDEX, String(nextIndex));

    safeRecordQboRunHistory_(function() {
      recordQboScheduledRunProgress_(
        runId,
        nextIndex - failedCount,
        failedCount,
        nextIndex,
        ''
      );
    }, 'run progress', runId, exportKey);

    if (nextIndex < DAILY_QBO_EXPORT_ORDER.length) {
      scheduleNextQboExportTrigger_();
    } else {
      completeDailyQboExportSchedule_(runId, failedCount);
    }
  }

  if (exportError) {
    throw exportError;
  }
}

/**
 * Verifies that the daily queue contains every manifest exporter exactly once.
 */
function validateDailyQboExportSchedule_() {
  const manifestResult = validateQboExportManifest_();
  const manifest = manifestResult.manifest;
  const manifestKeys = manifest.map(function(entry) { return entry.key; });
  const manifestFunctions = Object.create(null);
  const seen = Object.create(null);

  manifest.forEach(function(entry) {
    manifestFunctions[entry.exportFunctionName] = entry.key;

    if (typeof QBO_SCHEDULED_EXPORTERS[entry.exportFunctionName] !== 'function') {
      throw new Error(
        'Manifest exporter ' + entry.key +
        ' references unsupported scheduled function: ' +
        entry.exportFunctionName + '.'
      );
    }
  });

  Object.keys(QBO_SCHEDULED_EXPORTERS).forEach(function(functionName) {
    if (!manifestFunctions[functionName]) {
      throw new Error(
        'Scheduled exporter registry contains function not present in manifest: ' +
        functionName + '.'
      );
    }
  });

  DAILY_QBO_EXPORT_ORDER.forEach(function(key) {
    if (seen[key]) {
      throw new Error('Duplicate export key in daily schedule: ' + key + '.');
    }
    seen[key] = true;

    if (manifestKeys.indexOf(key) === -1) {
      throw new Error('Unknown export key in daily schedule: ' + key + '.');
    }
  });

  const missing = manifestKeys.filter(function(key) {
    return !seen[key];
  });

  if (missing.length > 0) {
    throw new Error(
      'Daily schedule is missing manifest exporter(s): ' +
      missing.join(', ') + '.'
    );
  }

  if (DAILY_QBO_EXPORT_ORDER.length !== manifest.length) {
    throw new Error(
      'Daily schedule/manifest count mismatch: schedule=' +
      DAILY_QBO_EXPORT_ORDER.length + ', manifest=' + manifest.length + '.'
    );
  }

  const scheduledFunctionCount = Object.keys(QBO_SCHEDULED_EXPORTERS).length;
  if (scheduledFunctionCount !== manifest.length) {
    throw new Error(
      'Scheduled exporter registry/manifest count mismatch: registry=' +
      scheduledFunctionCount + ', manifest=' + manifest.length + '.'
    );
  }

  return {
    exportCount: manifestResult.exportCount,
    sheetCount: manifestResult.sheetCount,
    scheduledFunctionCount: scheduledFunctionCount
  };
}

function scheduleNextQboExportTrigger_() {
  deleteManagedNextQboTriggers_();

  const trigger = ScriptApp.newTrigger(DAILY_QBO_TRIGGER_HANDLERS.NEXT)
    .timeBased()
    .after(DAILY_EXPORT_SCHEDULE.NEXT_EXPORT_DELAY_MS)
    .create();

  console.log(
    '[TRIGGER] | QUEUED NEXT | delayMs=' + DAILY_EXPORT_SCHEDULE.NEXT_EXPORT_DELAY_MS +
    ' | triggerId=' + trigger.getUniqueId()
  );
}

function completeDailyQboExportSchedule_(runId, failedCount) {
  const normalizedFailedCount = Math.max(0, Number(failedCount) || 0);

  safeRecordQboRunHistory_(function() {
    recordQboScheduledRunComplete_(
      runId,
      new Date(),
      DAILY_QBO_EXPORT_ORDER.length - normalizedFailedCount,
      normalizedFailedCount
    );
  }, 'run complete', runId, '');

  deleteManagedNextQboTriggers_();
  clearDailyQboQueueState_();
  console.log(
    '[SCHEDULE] | COMPLETE | runId=' + runId +
    ' | failed=' + normalizedFailedCount
  );
}

function clearDailyQboQueueState_() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(DAILY_QBO_QUEUE_PROPERTIES.INDEX);
  props.deleteProperty(DAILY_QBO_QUEUE_PROPERTIES.RUN_ID);
  props.deleteProperty(DAILY_QBO_QUEUE_PROPERTIES.STARTED_AT);
  props.deleteProperty(DAILY_QBO_QUEUE_PROPERTIES.FAILED_COUNT);
}

function deleteManagedDailyQboTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (isManagedDailyQboTriggerHandler_(trigger.getHandlerFunction())) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function deleteManagedNextQboTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === DAILY_QBO_TRIGGER_HANDLERS.NEXT) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function isManagedDailyQboTriggerHandler_(handler) {
  return handler === DAILY_QBO_TRIGGER_HANDLERS.START ||
    handler === DAILY_QBO_TRIGGER_HANDLERS.NEXT;
}

function invokeScheduledQboExporter_(functionName) {
  const exporter = QBO_SCHEDULED_EXPORTERS[functionName];

  if (typeof exporter !== 'function') {
    throw new Error(
      'Unsupported scheduled exporter function: ' + functionName + '.'
    );
  }

  return exporter();
}


function closeStaleDailyQboRunHistory_(props, status) {
  const runId = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.RUN_ID);
  const indexValue = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.INDEX);
  const failedValue = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.FAILED_COUNT);

  if (!runId || indexValue === null) {
    return;
  }

  const attemptedCount = Math.max(0, Number(indexValue) || 0);
  const failedCount = Math.max(0, Number(failedValue) || 0);
  const completedCount = Math.max(0, attemptedCount - failedCount);

  safeRecordQboRunHistory_(function() {
    const interruptedAt = new Date();
    const interruptedExportCount = recordQboScheduledRunningExportsInterrupted_(
      runId,
      interruptedAt,
      status
    );

    recordQboScheduledRunInterrupted_(
      runId,
      interruptedAt,
      completedCount,
      failedCount,
      status
    );

    if (interruptedExportCount > 0) {
      console.log(
        '[RUN HISTORY] | EXPORT INTERRUPTED | runId=' + runId +
        ' | count=' + interruptedExportCount +
        ' | parentStatus=' + status
      );
    }
  }, 'stale run close', runId, '');
}

function safeRecordQboRunHistory_(callback, stage, runId, exportKey) {
  try {
    callback();
  } catch (error) {
    console.error(
      '[RUN HISTORY] | ERROR | stage=' + stage +
      ' | runId=' + (runId || '') +
      ' | export=' + (exportKey || '') +
      ' | error=' + (error && error.message ? error.message : String(error))
    );
  }
}

function padTwoDigits_(value) {
  return String(value).padStart(2, '0');
}
