/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 53_QBO_GeneralLedgerBackfill.js
 * Purpose     : Resumable month-by-month historical General Ledger backfill.
 *
 * Public API:
 *   - startQboGeneralLedgerBackfill()
 *   - resumeQboGeneralLedgerBackfill()
 *   - showQboGeneralLedgerBackfillStatus()
 *   - cancelQboGeneralLedgerBackfill()
 *   - repairQboGeneralLedgerBackfillCompletedStatus()
 *
 * Trigger Entry Point:
 *   - runNextQboGeneralLedgerBackfillMonth()
 *
 * Architecture:
 *   - One calendar month per Apps Script execution.
 *   - Calls exportQboGeneralLedgerForPeriod(); it does not duplicate extraction.
 *   - Default initial range is 2022-01 through 2026-06 because July/August 2026
 *     are already validated in the historical GL workbook.
 *   - Queue position advances only after a successful monthly export. If an
 *     execution is terminated by Apps Script, resume retries that same month.
 *   - Only one transient backfill trigger is maintained at a time.
 * ============================================================================
 */

const QBO_GL_BACKFILL = Object.freeze({
  DEFAULT_START_MONTH: '2022-01',
  DEFAULT_END_MONTH: '2026-06',
  NEXT_MONTH_DELAY_MS: 2 * 60 * 1000,
  HANDLER: 'runNextQboGeneralLedgerBackfillMonth'
});

const QBO_GL_BACKFILL_PROPERTIES = Object.freeze({
  RUN_ID: 'QBO_GL_BACKFILL_RUN_ID',
  START_MONTH: 'QBO_GL_BACKFILL_START_MONTH',
  END_MONTH: 'QBO_GL_BACKFILL_END_MONTH',
  CURRENT_MONTH: 'QBO_GL_BACKFILL_CURRENT_MONTH',
  STATUS: 'QBO_GL_BACKFILL_STATUS',
  STARTED_AT: 'QBO_GL_BACKFILL_STARTED_AT',
  LAST_COMPLETED_MONTH: 'QBO_GL_BACKFILL_LAST_COMPLETED_MONTH',
  LAST_COMPLETED_AT: 'QBO_GL_BACKFILL_LAST_COMPLETED_AT',
  LAST_ERROR: 'QBO_GL_BACKFILL_LAST_ERROR'
});

/** Starts the bounded initial historical backfill. */
function startQboGeneralLedgerBackfill() {
  validateQboGeneralLedgerBackfillConfiguration_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    deleteQboGeneralLedgerBackfillTriggers_();
    const props = PropertiesService.getScriptProperties();
    const existingStatus = props.getProperty(QBO_GL_BACKFILL_PROPERTIES.STATUS) || '';
    if (existingStatus === 'RUNNING' || existingStatus === 'READY') {
      throw new Error(
        'A General Ledger backfill is already active. Use ' +
        'showQboGeneralLedgerBackfillStatus() or resumeQboGeneralLedgerBackfill().'
      );
    }

    const runId = Utilities.getUuid();
    const startedAt = new Date().toISOString();
    props.setProperties({
      [QBO_GL_BACKFILL_PROPERTIES.RUN_ID]: runId,
      [QBO_GL_BACKFILL_PROPERTIES.START_MONTH]: QBO_GL_BACKFILL.DEFAULT_START_MONTH,
      [QBO_GL_BACKFILL_PROPERTIES.END_MONTH]: QBO_GL_BACKFILL.DEFAULT_END_MONTH,
      [QBO_GL_BACKFILL_PROPERTIES.CURRENT_MONTH]: QBO_GL_BACKFILL.DEFAULT_START_MONTH,
      [QBO_GL_BACKFILL_PROPERTIES.STATUS]: 'READY',
      [QBO_GL_BACKFILL_PROPERTIES.STARTED_AT]: startedAt,
      [QBO_GL_BACKFILL_PROPERTIES.LAST_COMPLETED_MONTH]: '',
      [QBO_GL_BACKFILL_PROPERTIES.LAST_COMPLETED_AT]: '',
      [QBO_GL_BACKFILL_PROPERTIES.LAST_ERROR]: ''
    });

    console.log(
      '[GL BACKFILL] | START | runId=' + runId +
      ' | range=' + QBO_GL_BACKFILL.DEFAULT_START_MONTH + '..' +
      QBO_GL_BACKFILL.DEFAULT_END_MONTH +
      ' | months=' + countQboGeneralLedgerBackfillMonths_(
        QBO_GL_BACKFILL.DEFAULT_START_MONTH,
        QBO_GL_BACKFILL.DEFAULT_END_MONTH
      )
    );
    scheduleNextQboGeneralLedgerBackfillTrigger_();
  } finally {
    lock.releaseLock();
  }
}

/** Resumes the same logical run at its current not-yet-completed month. */
function resumeQboGeneralLedgerBackfill() {
  validateQboGeneralLedgerBackfillConfiguration_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    deleteQboGeneralLedgerBackfillTriggers_();
    const props = PropertiesService.getScriptProperties();
    const runId = props.getProperty(QBO_GL_BACKFILL_PROPERTIES.RUN_ID) || '';
    const currentMonth = props.getProperty(QBO_GL_BACKFILL_PROPERTIES.CURRENT_MONTH) || '';
    const endMonth = props.getProperty(QBO_GL_BACKFILL_PROPERTIES.END_MONTH) || '';
    const status = props.getProperty(QBO_GL_BACKFILL_PROPERTIES.STATUS) || '';
    if (!runId || !currentMonth || !endMonth) {
      throw new Error('No resumable General Ledger backfill was found.');
    }
    if (status === 'COMPLETE' || status === 'CANCELLED') {
      throw new Error('General Ledger backfill is ' + status + ' and cannot be resumed.');
    }
    props.setProperty(QBO_GL_BACKFILL_PROPERTIES.STATUS, 'READY');
    props.setProperty(QBO_GL_BACKFILL_PROPERTIES.LAST_ERROR, '');
    console.log(
      '[GL BACKFILL] | RESUME | runId=' + runId +
      ' | month=' + currentMonth + ' | endMonth=' + endMonth
    );
    scheduleNextQboGeneralLedgerBackfillTrigger_();
  } finally {
    lock.releaseLock();
  }
}

/** Runs exactly one month, then schedules the next month only after success. */
function runNextQboGeneralLedgerBackfillMonth() {
  validateQboGeneralLedgerBackfillConfiguration_();

  // A one-time Apps Script trigger can remain visible/disabled after it fires.
  // Remove the trigger that launched this execution (and any stale duplicates)
  // before processing the month. A successful non-final month creates exactly
  // one fresh successor trigger; final/error exits leave none behind.
  deleteQboGeneralLedgerBackfillTriggers_();

  const props = PropertiesService.getScriptProperties();
  const runId = props.getProperty(QBO_GL_BACKFILL_PROPERTIES.RUN_ID) || '';
  const currentMonth = props.getProperty(QBO_GL_BACKFILL_PROPERTIES.CURRENT_MONTH) || '';
  const endMonth = props.getProperty(QBO_GL_BACKFILL_PROPERTIES.END_MONTH) || '';
  if (!runId || !currentMonth || !endMonth) {
    throw new Error('General Ledger backfill queue is not initialized.');
  }

  const period = qboGeneralLedgerMonthPeriod_(currentMonth);
  props.setProperty(QBO_GL_BACKFILL_PROPERTIES.STATUS, 'RUNNING');
  props.setProperty(QBO_GL_BACKFILL_PROPERTIES.LAST_ERROR, '');
  console.log(
    '[GL BACKFILL] | MONTH START | runId=' + runId +
    ' | month=' + currentMonth + ' | period=' + period.startDate + '..' + period.endDate
  );

  try {
    const result = exportQboGeneralLedgerForPeriod(period.startDate, period.endDate);
    const completedAt = new Date().toISOString();
    props.setProperty(QBO_GL_BACKFILL_PROPERTIES.LAST_COMPLETED_MONTH, currentMonth);
    props.setProperty(QBO_GL_BACKFILL_PROPERTIES.LAST_COMPLETED_AT, completedAt);

    if (currentMonth === endMonth) {
      // Defensive final cleanup. The trigger that launched this execution was
      // removed at entry, but clear any duplicate/stale backfill triggers before
      // recording the durable COMPLETE state.
      deleteQboGeneralLedgerBackfillTriggers_();
      props.setProperty(QBO_GL_BACKFILL_PROPERTIES.STATUS, 'COMPLETE');
      console.log(
        '[GL BACKFILL] | COMPLETE | runId=' + runId +
        ' | lastMonth=' + currentMonth + ' | rowCount=' + result.rowCount +
        ' | triggerCount=' + getQboGeneralLedgerBackfillTriggers_().length
      );
      return;
    }

    const nextMonth = addQboGeneralLedgerMonths_(currentMonth, 1);
    props.setProperty(QBO_GL_BACKFILL_PROPERTIES.CURRENT_MONTH, nextMonth);
    props.setProperty(QBO_GL_BACKFILL_PROPERTIES.STATUS, 'READY');
    console.log(
      '[GL BACKFILL] | MONTH COMPLETE | runId=' + runId +
      ' | month=' + currentMonth + ' | rows=' + result.rowCount +
      ' | action=' + result.storageAction + ' | nextMonth=' + nextMonth
    );
    scheduleNextQboGeneralLedgerBackfillTrigger_();
  } catch (err) {
    props.setProperty(QBO_GL_BACKFILL_PROPERTIES.STATUS, 'ERROR');
    props.setProperty(
      QBO_GL_BACKFILL_PROPERTIES.LAST_ERROR,
      String(err && err.message ? err.message : err).slice(0, 1000)
    );
    console.error(
      '[GL BACKFILL] | ERROR | runId=' + runId +
      ' | month=' + currentMonth + ' | error=' +
      String(err && err.message ? err.message : err)
    );
    throw err;
  }
}

/** Logs and returns durable backfill state. */
function showQboGeneralLedgerBackfillStatus() {
  const props = PropertiesService.getScriptProperties();
  const state = {};
  Object.keys(QBO_GL_BACKFILL_PROPERTIES).forEach(function(name) {
    const key = QBO_GL_BACKFILL_PROPERTIES[name];
    state[name] = props.getProperty(key) || '';
  });
  state.triggerCount = getQboGeneralLedgerBackfillTriggers_().length;
  if (state.START_MONTH && state.END_MONTH) {
    state.totalMonths = countQboGeneralLedgerBackfillMonths_(state.START_MONTH, state.END_MONTH);
  }
  console.log('[GL BACKFILL] | STATUS | ' + JSON.stringify(state));
  return state;
}

/** Cancels the current chain without deleting its audit/status properties. */
function cancelQboGeneralLedgerBackfill() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let finalStatus = '';
  try {
    deleteQboGeneralLedgerBackfillTriggers_();
    const props = PropertiesService.getScriptProperties();
    const runId = props.getProperty(QBO_GL_BACKFILL_PROPERTIES.RUN_ID) || '';
    const currentStatus = props.getProperty(QBO_GL_BACKFILL_PROPERTIES.STATUS) || '';
    if (runId) {
      // A completed run is historical fact, not an active chain. Cleanup may
      // remove stale triggers, but it must not rewrite COMPLETE as CANCELLED.
      if (currentStatus !== 'COMPLETE') {
        props.setProperty(QBO_GL_BACKFILL_PROPERTIES.STATUS, 'CANCELLED');
        finalStatus = 'CANCELLED';
      } else {
        finalStatus = 'COMPLETE';
      }
    }
  } finally {
    lock.releaseLock();
  }
  console.log('[GL BACKFILL] | CANCEL | finalStatus=' + finalStatus);
}

/**
 * Repairs durable status after a fully completed run was incorrectly marked
 * CANCELLED during stale-trigger cleanup. This does not run or rewrite GL data.
 * It succeeds only when the durable state proves the end month already finished
 * and no backfill trigger remains.
 */
function repairQboGeneralLedgerBackfillCompletedStatus() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    const runId = props.getProperty(QBO_GL_BACKFILL_PROPERTIES.RUN_ID) || '';
    const endMonth = props.getProperty(QBO_GL_BACKFILL_PROPERTIES.END_MONTH) || '';
    const currentMonth = props.getProperty(QBO_GL_BACKFILL_PROPERTIES.CURRENT_MONTH) || '';
    const lastCompletedMonth =
      props.getProperty(QBO_GL_BACKFILL_PROPERTIES.LAST_COMPLETED_MONTH) || '';
    const triggerCount = getQboGeneralLedgerBackfillTriggers_().length;

    if (!runId || !endMonth) {
      throw new Error('No General Ledger backfill run is available to repair.');
    }
    if (currentMonth !== endMonth || lastCompletedMonth !== endMonth) {
      throw new Error(
        'Cannot repair General Ledger backfill to COMPLETE because the durable ' +
        'state does not show the end month as completed.'
      );
    }
    if (triggerCount !== 0) {
      throw new Error(
        'Cannot repair General Ledger backfill to COMPLETE while ' +
        triggerCount + ' backfill trigger(s) remain.'
      );
    }

    props.setProperty(QBO_GL_BACKFILL_PROPERTIES.STATUS, 'COMPLETE');
    props.setProperty(QBO_GL_BACKFILL_PROPERTIES.LAST_ERROR, '');
    console.log(
      '[GL BACKFILL] | STATUS REPAIRED | runId=' + runId +
      ' | lastMonth=' + lastCompletedMonth + ' | triggerCount=0 | status=COMPLETE'
    );
    return showQboGeneralLedgerBackfillStatus();
  } finally {
    lock.releaseLock();
  }
}

function validateQboGeneralLedgerBackfillConfiguration_() {
  testQboGeneralLedgerReportConfiguration();
  qboGeneralLedgerMonthPeriod_(QBO_GL_BACKFILL.DEFAULT_START_MONTH);
  qboGeneralLedgerMonthPeriod_(QBO_GL_BACKFILL.DEFAULT_END_MONTH);
  if (QBO_GL_BACKFILL.DEFAULT_START_MONTH > QBO_GL_BACKFILL.DEFAULT_END_MONTH) {
    throw new Error('General Ledger backfill start month is after end month.');
  }
}

function scheduleNextQboGeneralLedgerBackfillTrigger_() {
  deleteQboGeneralLedgerBackfillTriggers_();
  const trigger = ScriptApp.newTrigger(QBO_GL_BACKFILL.HANDLER)
    .timeBased()
    .after(QBO_GL_BACKFILL.NEXT_MONTH_DELAY_MS)
    .create();
  console.log(
    '[GL BACKFILL] | TRIGGER SCHEDULED | delayMs=' + QBO_GL_BACKFILL.NEXT_MONTH_DELAY_MS +
    ' | triggerId=' + trigger.getUniqueId()
  );
}

function getQboGeneralLedgerBackfillTriggers_() {
  return ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === QBO_GL_BACKFILL.HANDLER;
  });
}

function deleteQboGeneralLedgerBackfillTriggers_() {
  getQboGeneralLedgerBackfillTriggers_().forEach(function(trigger) {
    ScriptApp.deleteTrigger(trigger);
  });
}

function qboGeneralLedgerMonthPeriod_(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) {
    throw new Error('Invalid General Ledger backfill month: ' + month + '. Expected yyyy-mm.');
  }
  const parts = month.split('-');
  const year = Number(parts[0]);
  const monthNumber = Number(parts[1]);
  if (monthNumber < 1 || monthNumber > 12) {
    throw new Error('Invalid General Ledger backfill month: ' + month + '.');
  }
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    startDate: month + '-01',
    endDate: month + '-' + (lastDay < 10 ? '0' : '') + lastDay
  };
}

function addQboGeneralLedgerMonths_(month, count) {
  const parts = month.split('-');
  const date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1 + count, 1));
  return date.getUTCFullYear() + '-' + padTwoDigits_(date.getUTCMonth() + 1);
}

function countQboGeneralLedgerBackfillMonths_(startMonth, endMonth) {
  const s = startMonth.split('-').map(Number);
  const e = endMonth.split('-').map(Number);
  return (e[0] - s[0]) * 12 + (e[1] - s[1]) + 1;
}
