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
  STARTED_AT: 'QBO_DAILY_EXPORT_STARTED_AT'
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
    const runId = Utilities.getUuid();
    props.setProperty(DAILY_QBO_QUEUE_PROPERTIES.INDEX, '0');
    props.setProperty(DAILY_QBO_QUEUE_PROPERTIES.RUN_ID, runId);
    props.setProperty(
      DAILY_QBO_QUEUE_PROPERTIES.STARTED_AT,
      new Date().toISOString()
    );

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
 * Transient queue entry point. Runs exactly one exporter in this execution,
 * advances queue state, schedules the next execution, and rethrows failures.
 */
function runNextScheduledQboExport() {
  validateDailyQboExportSchedule_();

  const props = PropertiesService.getScriptProperties();
  const runId = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.RUN_ID);
  const indexValue = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.INDEX);

  if (!runId || indexValue === null) {
    throw new Error(
      'Daily QBO export queue is not initialized. Run startDailyQboExportSchedule().' 
    );
  }

  const index = Number(indexValue);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error('Invalid daily QBO export queue index: ' + indexValue + '.');
  }

  if (index >= DAILY_QBO_EXPORT_ORDER.length) {
    completeDailyQboExportSchedule_(runId);
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

  let exportError = null;

  try {
    invokeScheduledQboExporter_(entry.exportFunctionName);
    console.log(
      '[SCHEDULE] | EXPORT COMPLETE | runId=' + runId +
      ' | export=' + exportKey
    );
  } catch (err) {
    exportError = err;
    console.error(
      '[SCHEDULE] | EXPORT ERROR | runId=' + runId +
      ' | export=' + exportKey +
      ' | error=' + (err && err.message ? err.message : err)
    );
  } finally {
    const nextIndex = index + 1;
    props.setProperty(DAILY_QBO_QUEUE_PROPERTIES.INDEX, String(nextIndex));

    if (nextIndex < DAILY_QBO_EXPORT_ORDER.length) {
      scheduleNextQboExportTrigger_();
    } else {
      completeDailyQboExportSchedule_(runId);
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
  const manifest = getQboExportManifest();
  const manifestKeys = manifest.map(function(entry) { return entry.key; });
  const seen = {};

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
      'Daily schedule is missing manifest exporter(s): ' + missing.join(', ') + '.'
    );
  }

  if (DAILY_QBO_EXPORT_ORDER.length !== manifest.length) {
    throw new Error(
      'Daily schedule/manifest count mismatch: schedule=' +
      DAILY_QBO_EXPORT_ORDER.length + ', manifest=' + manifest.length + '.'
    );
  }
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

function completeDailyQboExportSchedule_(runId) {
  deleteManagedNextQboTriggers_();
  clearDailyQboQueueState_();
  console.log('[SCHEDULE] | COMPLETE | runId=' + runId);
}

function clearDailyQboQueueState_() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(DAILY_QBO_QUEUE_PROPERTIES.INDEX);
  props.deleteProperty(DAILY_QBO_QUEUE_PROPERTIES.RUN_ID);
  props.deleteProperty(DAILY_QBO_QUEUE_PROPERTIES.STARTED_AT);
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
  switch (functionName) {
    case 'exportQboCustomers': return exportQboCustomers();
    case 'exportQboPreferences': return exportQboPreferences();
    case 'exportQboItems': return exportQboItems();
    case 'exportQboClasses': return exportQboClasses();
    case 'exportQboTerms': return exportQboTerms();
    case 'exportQboPaymentMethods': return exportQboPaymentMethods();
    case 'exportQboTaxCodes': return exportQboTaxCodes();
    case 'exportQboDepartments': return exportQboDepartments();
    case 'exportQboVendors': return exportQboVendors();
    case 'exportQboAccounts': return exportQboAccounts();
    case 'exportQboInvoices': return exportQboInvoices();
    case 'exportQboPayments': return exportQboPayments();
    case 'exportQboCreditMemos': return exportQboCreditMemos();
    case 'exportQboEstimates': return exportQboEstimates();
    case 'exportQboBills': return exportQboBills();
    case 'exportQboBillPayments': return exportQboBillPayments();
    case 'exportQboPurchases': return exportQboPurchases();
    case 'exportQboDeposits': return exportQboDeposits();
    case 'exportQboJournalEntries': return exportQboJournalEntries();
    case 'exportQboSalesReceipts': return exportQboSalesReceipts();
    case 'exportQboRecurringTransactions': return exportQboRecurringTransactions();
    case 'exportQboRefundReceipts': return exportQboRefundReceipts();
    default:
      throw new Error('Unsupported scheduled exporter function: ' + functionName + '.');
  }
}

function padTwoDigits_(value) {
  return String(value).padStart(2, '0');
}
