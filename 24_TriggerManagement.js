

/**
 * Returns the coordination lock used exclusively by the daily FULL_EXPORT
 * scheduler. App 50 contains other independent pipelines (Native CDC, State
 * Capture, GL backfill, audits) that intentionally use ScriptLock for their
 * own execution domains. Using UserLock here prevents those long-running
 * project-wide locks from starving daily-scheduler control operations while
 * still serializing the installable-trigger chain and manual controls executed
 * by the trigger owner.
 */
function getDailyQboSchedulerLock_() {
  return LockService.getUserLock();
}
/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 24_TriggerManagement.js
 * Purpose     : Install, inspect, and run the daily QBO export schedule while
 *               keeping each exporter in its own Apps Script execution.
 *
 * Public API:
 *   - installDailyQboExportTriggers()
 *   - listQboExportTriggers()
 *   - diagnoseQboExportSchedulerState()
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
 *   - 2026-09-12: Added read-only scheduler runtime-state diagnostic for
 *     queue/worker claim inspection without acquiring ScriptLock.
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
  FAILED_COUNT: 'QBO_DAILY_EXPORT_FAILED_COUNT',
  ACTIVE_TOKEN: 'QBO_DAILY_EXPORT_ACTIVE_TOKEN',
  ACTIVE_INDEX: 'QBO_DAILY_EXPORT_ACTIVE_INDEX',
  ACTIVE_EXPORT_KEY: 'QBO_DAILY_EXPORT_ACTIVE_EXPORT_KEY',
  ACTIVE_STARTED_AT: 'QBO_DAILY_EXPORT_ACTIVE_STARTED_AT'
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
 * Read-only scheduler diagnostic.
 *
 * Intentionally does not acquire ScriptLock so it can inspect persisted worker
 * claim state even while another scheduler execution currently owns that lock.
 * This function never mutates queue state, worker state, triggers, or history.
 */
function diagnoseQboExportSchedulerState() {
  const props = PropertiesService.getScriptProperties();
  const nowMs = Date.now();
  const activeState = getActiveDailyQboWorkerState_(props);

  const runId = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.RUN_ID) || '';
  const queueIndexValue = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.INDEX);
  const queueIndex = queueIndexValue === null || queueIndexValue === ''
    ? ''
    : Number(queueIndexValue);

  const activeAgeMs = activeState && activeState.startedAtMs
    ? Math.max(0, nowMs - activeState.startedAtMs)
    : '';
  const stale = activeState
    ? isDailyQboWorkerStateStaleAt_(activeState, nowMs)
    : false;

  console.log(
    '[SCHEDULE DIAGNOSTIC] | STATE' +
    ' | runId=' + runId +
    ' | queueIndex=' + queueIndex +
    ' | activeToken=' + (activeState ? activeState.token : '') +
    ' | activeIndex=' + (activeState ? activeState.index : '') +
    ' | activeExportKey=' + (activeState ? activeState.exportKey : '') +
    ' | activeStartedAt=' + (activeState ? activeState.startedAt : '') +
    ' | activeAgeMs=' + activeAgeMs +
    ' | stale=' + stale +
    ' | staleThresholdMs=' + DAILY_EXPORT_SCHEDULE.WORKER_STALE_MS +
    ' | timezone=' + Session.getScriptTimeZone()
  );

  return {
    runId: runId,
    queueIndex: queueIndex,
    activeToken: activeState ? activeState.token : '',
    activeIndex: activeState ? activeState.index : '',
    activeExportKey: activeState ? activeState.exportKey : '',
    activeStartedAt: activeState ? activeState.startedAt : '',
    activeAgeMs: activeAgeMs,
    stale: stale,
    staleThresholdMs: DAILY_EXPORT_SCHEDULE.WORKER_STALE_MS,
    timezone: Session.getScriptTimeZone()
  };
}

/**
 * Removes the durable daily starter and any transient queue trigger, then
 * clears queue state. Other project triggers are left untouched.
 */
function removeDailyQboExportTriggers() {
  const lock = getDailyQboSchedulerLock_();
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

  // Phase 1: capture current queue identity under a short ScriptLock. Avoid
  // Sheet/run-history work while the project-wide lock is held.
  const initialLock = getDailyQboSchedulerLock_();
  initialLock.waitLock(30000);

  let existingRunId;
  let existingIndex;
  let existingActiveState;
  try {
    deleteManagedNextQboTriggers_();
    const props = PropertiesService.getScriptProperties();
    existingRunId = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.RUN_ID) || '';
    existingIndex = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.INDEX);
    existingActiveState = getActiveDailyQboWorkerState_(props);
  } finally {
    initialLock.releaseLock();
  }

  if (existingRunId && existingIndex !== null) {
    if (existingActiveState && !isDailyQboWorkerStateStale_(existingActiveState)) {
      console.log(
        '[SCHEDULE] | STARTER PRESERVE ACTIVE RUN | runId=' + existingRunId +
        ' | export=' + (existingActiveState.exportKey || '') +
        ' | activeAgeMs=' + (Date.now() - existingActiveState.startedAtMs)
      );
      scheduleNextQboExportTrigger_();
      return;
    }

    // Slow durable-history recovery is outside ScriptLock.
    const interruptedAt = new Date();
    const interruptedExportCount = recordQboScheduledRunningExportsInterrupted_(
      existingRunId,
      interruptedAt,
      'RESUME',
      'Daily starter recovered an unfinished scheduled run instead of replacing it.'
    );
    const resumeState = getQboScheduledRunResumeState_(existingRunId);

    if (resumeState.resumeIndex < DAILY_QBO_EXPORT_ORDER.length) {
      const resumeKey = DAILY_QBO_EXPORT_ORDER[resumeState.resumeIndex];
      const commitLock = getDailyQboSchedulerLock_();
      commitLock.waitLock(30000);
      try {
        const props = PropertiesService.getScriptProperties();
        const currentRunId = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.RUN_ID) || '';
        const currentIndex = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.INDEX);
        const activeState = getActiveDailyQboWorkerState_(props);

        if (currentRunId !== existingRunId || String(currentIndex) !== String(existingIndex)) {
          throw new Error(
            'Daily starter aborted recovery because scheduler queue state changed during ' +
            'history reconstruction.'
          );
        }
        if (activeState && !isDailyQboWorkerStateStale_(activeState)) {
          throw new Error(
            'Daily starter aborted recovery because another scheduler worker became active.'
          );
        }

        props.setProperty(
          DAILY_QBO_QUEUE_PROPERTIES.INDEX,
          String(resumeState.resumeIndex)
        );
        props.setProperty(
          DAILY_QBO_QUEUE_PROPERTIES.STARTED_AT,
          resumeState.startedAt
        );
        props.setProperty(
          DAILY_QBO_QUEUE_PROPERTIES.FAILED_COUNT,
          String(resumeState.failedCount)
        );
        clearActiveDailyQboWorkerState_(props);
      } finally {
        commitLock.releaseLock();
      }

      recordQboScheduledRunResumed_(
        existingRunId,
        resumeState.completedCount,
        resumeState.failedCount,
        resumeState.resumeIndex + 1,
        resumeKey
      );

      console.log(
        '[SCHEDULE] | STARTER RESUME | runId=' + existingRunId +
        ' | position=' + (resumeState.resumeIndex + 1) + '/' +
        DAILY_QBO_EXPORT_ORDER.length +
        ' | export=' + resumeKey +
        ' | interrupted=' + interruptedExportCount
      );
      scheduleNextQboExportTrigger_();
      return;
    }

    // History says the prior run is fully complete. Close it outside ScriptLock;
    // there is no live non-stale worker and the transient trigger was removed.
    completeDailyQboExportSchedule_(existingRunId, resumeState.failedCount);
  }

  const runId = Utilities.getUuid();
  const startedAt = new Date().toISOString();

  // Atomically create queue state first; if durable history creation fails,
  // rollback only if this run still owns the queue and no worker claimed it.
  const createLock = getDailyQboSchedulerLock_();
  createLock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    const currentRunId = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.RUN_ID);
    const currentIndex = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.INDEX);
    if (currentRunId && currentIndex !== null) {
      throw new Error(
        'Daily starter cannot create a new run because another scheduler run is active: ' +
        currentRunId + '.'
      );
    }

    props.setProperty(DAILY_QBO_QUEUE_PROPERTIES.INDEX, '0');
    props.setProperty(DAILY_QBO_QUEUE_PROPERTIES.RUN_ID, runId);
    props.setProperty(DAILY_QBO_QUEUE_PROPERTIES.STARTED_AT, startedAt);
    props.setProperty(DAILY_QBO_QUEUE_PROPERTIES.FAILED_COUNT, '0');
    clearActiveDailyQboWorkerState_(props);
  } finally {
    createLock.releaseLock();
  }

  try {
    recordQboScheduledRunStart_(
      runId,
      startedAt,
      DAILY_QBO_EXPORT_ORDER.length
    );
  } catch (err) {
    const rollbackLock = getDailyQboSchedulerLock_();
    rollbackLock.waitLock(30000);
    try {
      const props = PropertiesService.getScriptProperties();
      const currentRunId = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.RUN_ID);
      const activeState = getActiveDailyQboWorkerState_(props);
      if (currentRunId === runId && !activeState) {
        clearDailyQboQueueState_();
      }
    } finally {
      rollbackLock.releaseLock();
    }
    throw err;
  }

  console.log(
    '[SCHEDULE] | START | runId=' + runId +
    ' | exports=' + DAILY_QBO_EXPORT_ORDER.length
  );

  scheduleNextQboExportTrigger_();
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

  // Phase 1: stop the transient chain and capture the queue identity while
  // holding ScriptLock only for scheduler state / trigger mutation.
  const initialLock = getDailyQboSchedulerLock_();
  initialLock.waitLock(30000);

  let expectedRunId;
  let expectedIndex;
  try {
    deleteManagedNextQboTriggers_();
    const props = PropertiesService.getScriptProperties();
    expectedRunId = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.RUN_ID) || '';
    expectedIndex = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.INDEX);
  } finally {
    initialLock.releaseLock();
  }

  // History reconstruction can touch Sheets and must never hold ScriptLock.
  let runId = expectedRunId;
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
    resumeState = getQboScheduledRunResumeState_(runId);
  }

  if (resumeState.resumeIndex >= DAILY_QBO_EXPORT_ORDER.length) {
    throw new Error(
      'Run ' + runId + ' has no incomplete exporters to resume.'
    );
  }

  const resumeKey = DAILY_QBO_EXPORT_ORDER[resumeState.resumeIndex];

  // Phase 2: compare-and-set queue state. If another execution changed the
  // queue while history was being reconstructed, fail rather than overwrite it.
  const commitLock = getDailyQboSchedulerLock_();
  commitLock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    const currentRunId = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.RUN_ID) || '';
    const currentIndex = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.INDEX);
    const activeState = getActiveDailyQboWorkerState_(props);

    if (activeState && !isDailyQboWorkerStateStale_(activeState)) {
      throw new Error(
        'Cannot resume run ' + runId + ': another scheduler worker is active for ' +
        (activeState.exportKey || 'unknown export') + '.'
      );
    }

    if (expectedRunId) {
      if (currentRunId !== expectedRunId || String(currentIndex) !== String(expectedIndex)) {
        throw new Error(
          'Cannot resume run ' + runId + ': scheduler queue state changed while ' +
          'resume history was being reconstructed.'
        );
      }
    } else if (currentRunId && currentRunId !== runId) {
      throw new Error(
        'Cannot resume historical run ' + runId + ': another scheduler run is now active.'
      );
    }

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
    clearActiveDailyQboWorkerState_(props);
  } finally {
    commitLock.releaseLock();
  }

  // Durable status and trigger creation are intentionally outside ScriptLock.
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
}

/**
 * Transient queue entry point. Runs exactly one exporter in this execution,
 * advances queue state, schedules the next execution, and rethrows failures.
 */
function runNextScheduledQboExport() {
  validateDailyQboExportSchedule_();

  const claim = claimDailyQboWorker_();
  if (!claim) {
    return;
  }

  const runId = claim.runId;

  if (claim.completeOnly) {
    completeDailyQboExportSchedule_(runId, claim.failedCount);
    return;
  }

  const index = claim.index;
  const exportKey = claim.exportKey;
  const entry = claim.entry;
  let failedCount = claim.failedCount;

  if (claim.recoveredStaleWorker) {
    const interruptedCount = recordQboScheduledRunningExportsInterrupted_(
      runId,
      new Date(),
      'RECOVERED',
      'Scheduler watchdog recovered a stale worker claim after no normal completion.'
    );
    console.warn(
      '[SCHEDULE] | STALE WORKER RECOVERED | runId=' + runId +
      ' | export=' + exportKey +
      ' | interrupted=' + interruptedCount
    );
  }

  console.log(
    '[SCHEDULE] | EXPORT START | runId=' + runId +
    ' | position=' + (index + 1) + '/' + DAILY_QBO_EXPORT_ORDER.length +
    ' | export=' + exportKey +
    ' | function=' + entry.exportFunctionName +
    ' | workerToken=' + claim.token
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
  let retryableError = false;
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

    safeRegisterQboCompletedFullExportSource_(runId, exportKey);
  } catch (err) {
    exportError = err;
    retryableError = isRetryableQboSchedulerError_(err);

    if (retryableError) {
      console.warn(
        '[SCHEDULE] | EXPORT RETRY | runId=' + runId +
        ' | export=' + exportKey +
        ' | code=' + String(err && err.code || '') +
        ' | error=' + (err && err.message ? err.message : err)
      );
      safeRecordQboRunHistory_(function() {
        recordQboScheduledExportResult_(
          runId,
          entry,
          new Date(),
          'INTERRUPTED',
          Date.now() - exportStartedAt.getTime(),
          'Retryable scheduler condition: ' +
            (err && err.message ? err.message : String(err))
        );
      }, 'export retry', runId, exportKey);
    } else {
      failedCount += 1;
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
    }
  }

  const finalization = finalizeDailyQboWorkerClaim_(
    claim,
    failedCount,
    retryableError
  );

  if (finalization.claimLost) {
    console.warn(
      '[SCHEDULE] | CLAIM LOST | runId=' + runId +
      ' | export=' + exportKey +
      ' | workerToken=' + claim.token +
      ' | queueMutationSkipped=true'
    );
  } else if (finalization.completeRun) {
    completeDailyQboExportSchedule_(runId, failedCount);
  } else {
    scheduleNextQboExportTrigger_();
  }

  if (exportError && !retryableError) {
    throw exportError;
  }
}


/**
 * Atomically claims the current queue position for one Apps Script execution.
 * A watchdog trigger is armed before the exporter starts so platform-level
 * termination cannot sever the queue chain permanently.
 */
function claimDailyQboWorker_() {
  const lock = getDailyQboSchedulerLock_();
  lock.waitLock(30000);

  try {
    const props = PropertiesService.getScriptProperties();
    const runId = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.RUN_ID);
    const indexValue = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.INDEX);
    const failedCountValue = props.getProperty(
      DAILY_QBO_QUEUE_PROPERTIES.FAILED_COUNT
    ) || '0';

    if (!runId || indexValue === null) {
      console.warn('[SCHEDULE] | WORKER NOOP | reason=queue_not_initialized');
      return null;
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
      clearActiveDailyQboWorkerState_(props);
      return {
        runId: runId,
        index: index,
        failedCount: failedCount,
        completeOnly: true
      };
    }

    const activeState = getActiveDailyQboWorkerState_(props);
    let recoveredStaleWorker = false;

    if (activeState) {
      if (!isDailyQboWorkerStateStale_(activeState)) {
        console.log(
          '[SCHEDULE] | WORKER DEFER | runId=' + runId +
          ' | activeExport=' + (activeState.exportKey || '') +
          ' | activeAgeMs=' + (Date.now() - activeState.startedAtMs)
        );
        scheduleNextQboExportTrigger_();
        return null;
      }

      recoveredStaleWorker = true;
      console.warn(
        '[SCHEDULE] | WORKER STALE | runId=' + runId +
        ' | activeExport=' + (activeState.exportKey || '') +
        ' | activeAgeMs=' + (Date.now() - activeState.startedAtMs)
      );
      clearActiveDailyQboWorkerState_(props);
    }

    const exportKey = DAILY_QBO_EXPORT_ORDER[index];
    const entry = getQboExportManifestEntry_(exportKey);
    if (!entry) {
      throw new Error('Daily schedule references unknown export key: ' + exportKey + '.');
    }

    const token = Utilities.getUuid();
    const startedAt = new Date().toISOString();

    props.setProperty(DAILY_QBO_QUEUE_PROPERTIES.ACTIVE_TOKEN, token);
    props.setProperty(DAILY_QBO_QUEUE_PROPERTIES.ACTIVE_INDEX, String(index));
    props.setProperty(DAILY_QBO_QUEUE_PROPERTIES.ACTIVE_EXPORT_KEY, exportKey);
    props.setProperty(DAILY_QBO_QUEUE_PROPERTIES.ACTIVE_STARTED_AT, startedAt);

    // Arm recovery before entering long-running exporter code. A normal finish
    // replaces this watchdog with the ordinary next-export trigger.
    scheduleNextQboExportTrigger_();

    return {
      token: token,
      runId: runId,
      index: index,
      failedCount: failedCount,
      exportKey: exportKey,
      entry: entry,
      startedAt: startedAt,
      recoveredStaleWorker: recoveredStaleWorker,
      completeOnly: false
    };
  } finally {
    lock.releaseLock();
  }
}


function finalizeDailyQboWorkerClaim_(claim, failedCount, retrySamePosition) {
  if (claim.completeOnly) {
    return { claimLost: false, completeRun: true };
  }

  const normalizedFailedCount = Math.max(0, Number(failedCount) || 0);
  let nextIndex;

  // ScriptLock protects only the atomic claim comparison and queue mutation.
  // Run-history spreadsheet I/O is intentionally performed after release.
  const lock = getDailyQboSchedulerLock_();
  lock.waitLock(30000);

  try {
    const props = PropertiesService.getScriptProperties();
    const currentToken = props.getProperty(
      DAILY_QBO_QUEUE_PROPERTIES.ACTIVE_TOKEN
    );

    if (String(currentToken || '') !== String(claim.token || '')) {
      return { claimLost: true, completeRun: false };
    }

    props.setProperty(
      DAILY_QBO_QUEUE_PROPERTIES.FAILED_COUNT,
      String(normalizedFailedCount)
    );

    nextIndex = retrySamePosition ? claim.index : claim.index + 1;
    props.setProperty(DAILY_QBO_QUEUE_PROPERTIES.INDEX, String(nextIndex));
    clearActiveDailyQboWorkerState_(props);
  } finally {
    lock.releaseLock();
  }

  safeRecordQboRunHistory_(function() {
    recordQboScheduledRunProgress_(
      claim.runId,
      nextIndex - normalizedFailedCount,
      normalizedFailedCount,
      retrySamePosition ? claim.index + 1 : nextIndex,
      retrySamePosition ? claim.exportKey : ''
    );
  }, 'run progress', claim.runId, claim.exportKey);

  return {
    claimLost: false,
    completeRun: nextIndex >= DAILY_QBO_EXPORT_ORDER.length
  };
}


function getActiveDailyQboWorkerState_(props) {
  const token = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.ACTIVE_TOKEN);
  if (!token) {
    return null;
  }

  const startedAt = props.getProperty(
    DAILY_QBO_QUEUE_PROPERTIES.ACTIVE_STARTED_AT
  );
  const startedAtMs = Date.parse(String(startedAt || ''));

  return {
    token: token,
    index: Number(props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.ACTIVE_INDEX)),
    exportKey: props.getProperty(
      DAILY_QBO_QUEUE_PROPERTIES.ACTIVE_EXPORT_KEY
    ) || '',
    startedAt: startedAt || '',
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : 0
  };
}


function isDailyQboWorkerStateStale_(activeState) {
  return isDailyQboWorkerStateStaleAt_(activeState, Date.now());
}


function isDailyQboWorkerStateStaleAt_(activeState, nowMs) {
  if (!activeState || !activeState.startedAtMs) {
    return true;
  }

  return Number(nowMs) - activeState.startedAtMs >=
    DAILY_EXPORT_SCHEDULE.WORKER_STALE_MS;
}


function clearActiveDailyQboWorkerState_(props) {
  props.deleteProperty(DAILY_QBO_QUEUE_PROPERTIES.ACTIVE_TOKEN);
  props.deleteProperty(DAILY_QBO_QUEUE_PROPERTIES.ACTIVE_INDEX);
  props.deleteProperty(DAILY_QBO_QUEUE_PROPERTIES.ACTIVE_EXPORT_KEY);
  props.deleteProperty(DAILY_QBO_QUEUE_PROPERTIES.ACTIVE_STARTED_AT);
}


function isRetryableQboSchedulerError_(error) {
  return Boolean(
    error && String(error.code || '') === 'QBO_WRITE_LEASE_BUSY'
  );
}

/**
 * Controlled one-export production-path test for State Capture auto-registration.
 *
 * Runs PAYMENT_METHODS as a real one-export acquisition without initializing the
 * daily queue or creating any triggers. It writes a legitimate one-export run
 * and export history record, creates the normal Master Backup, then invokes the
 * same State Capture auto-registration helper used by runNextScheduledQboExport().
 *
 * This is intentionally manual-only and must never be installed as a trigger.
 */
function testQboStateCaptureAutoRegistrationOnce() {
  validateDailyQboExportSchedule_();

  const exportKey = 'PAYMENT_METHODS';
  const entry = getQboExportManifestEntry_(exportKey);
  if (!entry) {
    throw new Error('Unable to resolve controlled test export: ' + exportKey + '.');
  }

  const runId = 'STATE_CAPTURE_AUTOREG_TEST_' + Utilities.getUuid();
  const startedAt = new Date();
  let masterBackupMetadata = null;

  console.log(
    '[STATE CAPTURE AUTO TEST] | START' +
    ' | runId=' + runId +
    ' | export=' + exportKey +
    ' | function=' + entry.exportFunctionName
  );

  recordQboScheduledRunStart_(runId, startedAt, 1);
  recordQboScheduledRunProgress_(runId, 0, 0, 1, exportKey);
  recordQboScheduledExportStart_(runId, 1, entry, startedAt);

  try {
    invokeScheduledQboExporter_(entry.exportFunctionName);
    masterBackupMetadata = consumeQboExporterMasterBackupMetadata_(exportKey);

    if (!masterBackupMetadata) {
      throw new Error(
        'Controlled test exporter completed without returning Master Backup metadata for ' +
        exportKey + '.'
      );
    }

    const completedAt = new Date();
    recordQboScheduledExportResult_(
      runId,
      entry,
      completedAt,
      'COMPLETE',
      completedAt.getTime() - startedAt.getTime(),
      '',
      masterBackupMetadata
    );

    const registration = registerQboCompletedFullExportSource_(runId, exportKey);

    recordQboScheduledRunProgress_(runId, 1, 0, 1, '');
    recordQboScheduledRunComplete_(runId, new Date(), 1, 0);

    console.log(
      '[STATE CAPTURE AUTO TEST] | COMPLETE' +
      ' | runId=' + runId +
      ' | export=' + exportKey +
      ' | masterBackup=' + masterBackupMetadata.masterBackupFileName +
      ' | registered=' + Boolean(registration && registration.registered) +
      ' | alreadyRegistered=' + Boolean(registration && registration.alreadyRegistered)
    );

    return {
      runId: runId,
      exportKey: exportKey,
      masterBackupFileId: masterBackupMetadata.masterBackupFileId,
      masterBackupFileName: masterBackupMetadata.masterBackupFileName,
      registration: registration
    };
  } catch (error) {
    const completedAt = new Date();
    try {
      recordQboScheduledExportResult_(
        runId,
        entry,
        completedAt,
        'ERROR',
        completedAt.getTime() - startedAt.getTime(),
        error && error.message ? error.message : String(error),
        masterBackupMetadata
      );
    } catch (historyError) {
      console.error(
        '[STATE CAPTURE AUTO TEST] | HISTORY ERROR' +
        ' | runId=' + runId +
        ' | error=' + (historyError && historyError.message ? historyError.message : historyError)
      );
    }

    try {
      recordQboScheduledRunProgress_(runId, 0, 1, 1, '');
      recordQboScheduledRunComplete_(runId, completedAt, 0, 1);
    } catch (runHistoryError) {
      console.error(
        '[STATE CAPTURE AUTO TEST] | RUN HISTORY ERROR' +
        ' | runId=' + runId +
        ' | error=' + (runHistoryError && runHistoryError.message ? runHistoryError.message : runHistoryError)
      );
    }

    console.error(
      '[STATE CAPTURE AUTO TEST] | ERROR' +
      ' | runId=' + runId +
      ' | export=' + exportKey +
      ' | error=' + (error && error.message ? error.message : error)
    );
    throw error;
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
  clearActiveDailyQboWorkerState_(props);
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
