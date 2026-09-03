/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 26_RunHistory.js
 * Purpose     : Persist daily scheduler run history, per-export execution
 *               history, and latest exporter status in a dedicated workbook.
 *
 * Public API:
 *   - provisionQboRunHistoryWorkbook()
 *   - testQboRunHistoryConfiguration()
 *   - showQboRunStatus()
 *
 * Internal Helpers:
 *   - getQboRunHistorySpreadsheet_()
 *   - initializeQboRunHistoryWorkbook_()
 *   - recordQboScheduledRunStart_()
 *   - recordQboScheduledExportStart_()
 *   - recordQboScheduledExportResult_()
 *   - recordQboScheduledRunProgress_()
 *   - recordQboScheduledRunComplete_()
 *   - recordQboScheduledRunningExportsInterrupted_()
 *   - recordQboScheduledRunResumed_()
 *   - getQboScheduledRunResumeState_()
 *   - getLatestQboScheduledRunResumeState_()
 *
 * Architecture Notes:
 *   - This workbook stores operational metadata only. QBO entity payloads
 *     remain in their independent export workbooks.
 *   - Scheduled-run logging is intentionally centralized in the chained
 *     scheduler; entity exporters are not modified.
 *   - The latest-status sheet gives one durable row per manifest exporter so a
 *     failed/stuck run remains visible even if an Apps Script execution ends
 *     before the next queue handoff.
 *
 * Change History:
 *   - 2026-09-03: Added failure-path safeguards so interruption cleanup
 *     cannot overwrite a newer exporter status, and extracted the durable
 *     resume-state reducer for deterministic regression testing.
 *   - 2026-09-02: Added persistent scheduled-run history and latest status.
 *   - 2026-09-02: Close stranded RUNNING exporter rows when a scheduled run
 *                 is explicitly cancelled or replaced.
 *   - 2026-09-02: Added same-RunId resume state reconstruction from durable
 *                 exporter history.
 * ============================================================================
 */

const QBO_RUN_HISTORY_HEADERS_ = Object.freeze({
  RUNS: Object.freeze([
    'RunId',
    'StartedAt',
    'CompletedAt',
    'Status',
    'TotalExports',
    'CompletedExports',
    'FailedExports',
    'CurrentPosition',
    'CurrentExport',
    'LastUpdatedAt'
  ]),
  EXPORTS: Object.freeze([
    'RunId',
    'Position',
    'ExportKey',
    'ExportFunction',
    'StartedAt',
    'CompletedAt',
    'Status',
    'DurationMs',
    'Error'
  ]),
  STATUS: Object.freeze([
    'ExportKey',
    'ExportFunction',
    'LastRunId',
    'LastStartedAt',
    'LastCompletedAt',
    'LastStatus',
    'LastDurationMs',
    'LastError'
  ])
});

/**
 * Creates the dedicated run-history workbook once and stores its ID.
 * Safe to rerun; an existing configured workbook is validated/repaired rather
 * than replaced.
 */
function provisionQboRunHistoryWorkbook() {
  const props = PropertiesService.getScriptProperties();
  let spreadsheetId = String(
    props.getProperty(SCRIPT_PROPERTY_KEYS.RUN_HISTORY_SPREADSHEET_ID) || ''
  ).trim();
  let spreadsheet;
  let created = false;

  if (spreadsheetId) {
    spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  } else {
    spreadsheet = SpreadsheetApp.create(QBO_RUN_HISTORY.WORKBOOK_TITLE);
    spreadsheetId = spreadsheet.getId();
    props.setProperty(
      SCRIPT_PROPERTY_KEYS.RUN_HISTORY_SPREADSHEET_ID,
      spreadsheetId
    );
    created = true;
  }

  initializeQboRunHistoryWorkbook_(spreadsheet);

  console.log(
    '[RUN HISTORY] | PROVISIONED | created=' + created +
    ' | workbook=' + spreadsheet.getName() +
    ' | spreadsheetId=' + spreadsheetId
  );

  return spreadsheetId;
}

/**
 * Read-only validation of the configured run-history workbook.
 */
function testQboRunHistoryConfiguration() {
  const spreadsheet = getQboRunHistorySpreadsheet_();
  validateQboRunHistoryWorkbookStructure_(spreadsheet);

  console.log(
    '[RUN HISTORY] | CONFIG OK | workbook=' + spreadsheet.getName() +
    ' | spreadsheetId=' + spreadsheet.getId() +
    ' | sheets=' + [
      QBO_RUN_HISTORY.RUNS_SHEET,
      QBO_RUN_HISTORY.EXPORTS_SHEET,
      QBO_RUN_HISTORY.STATUS_SHEET
    ].join(', ')
  );
}

/**
 * Logs the latest scheduled-run summary and current exporter statuses.
 */
function showQboRunStatus() {
  const spreadsheet = getQboRunHistorySpreadsheet_();
  validateQboRunHistoryWorkbookStructure_(spreadsheet);

  const runsSheet = spreadsheet.getSheetByName(QBO_RUN_HISTORY.RUNS_SHEET);
  const statusSheet = spreadsheet.getSheetByName(QBO_RUN_HISTORY.STATUS_SHEET);

  if (runsSheet.getLastRow() > 1) {
    const row = runsSheet.getRange(
      runsSheet.getLastRow(),
      1,
      1,
      QBO_RUN_HISTORY_HEADERS_.RUNS.length
    ).getValues()[0];

    console.log(
      '[RUN HISTORY] | LATEST | runId=' + row[0] +
      ' | status=' + row[3] +
      ' | completed=' + row[5] + '/' + row[4] +
      ' | failed=' + row[6] +
      ' | current=' + (row[8] || '') +
      ' | startedAt=' + formatQboRunHistoryLogValue_(row[1]) +
      ' | completedAt=' + formatQboRunHistoryLogValue_(row[2])
    );
  } else {
    console.log('[RUN HISTORY] | LATEST | none');
  }

  if (statusSheet.getLastRow() <= 1) {
    console.log('[RUN HISTORY] | STATUS | none');
    return;
  }

  const values = statusSheet.getRange(
    2,
    1,
    statusSheet.getLastRow() - 1,
    QBO_RUN_HISTORY_HEADERS_.STATUS.length
  ).getValues();

  values.forEach(function(row) {
    console.log(
      '[RUN HISTORY] | STATUS | export=' + row[0] +
      ' | status=' + (row[5] || '') +
      ' | runId=' + (row[2] || '') +
      ' | completedAt=' + formatQboRunHistoryLogValue_(row[4]) +
      (row[7] ? ' | error=' + row[7] : '')
    );
  });
}

function getQboRunHistorySpreadsheet_() {
  const spreadsheetId = String(
    PropertiesService.getScriptProperties().getProperty(
      SCRIPT_PROPERTY_KEYS.RUN_HISTORY_SPREADSHEET_ID
    ) || ''
  ).trim();

  if (!spreadsheetId) {
    throw new Error(
      'Missing ' + SCRIPT_PROPERTY_KEYS.RUN_HISTORY_SPREADSHEET_ID +
      '. Run provisionQboRunHistoryWorkbook() first.'
    );
  }

  try {
    return SpreadsheetApp.openById(spreadsheetId);
  } catch (error) {
    throw new Error(
      'Unable to open QBO run-history workbook ' + spreadsheetId +
      '. Original error: ' +
      (error && error.message ? error.message : String(error))
    );
  }
}

function initializeQboRunHistoryWorkbook_(spreadsheet) {
  const runsSheet = ensureQboRunHistorySheet_(
    spreadsheet,
    QBO_RUN_HISTORY.RUNS_SHEET,
    QBO_RUN_HISTORY_HEADERS_.RUNS
  );
  ensureQboRunHistorySheet_(
    spreadsheet,
    QBO_RUN_HISTORY.EXPORTS_SHEET,
    QBO_RUN_HISTORY_HEADERS_.EXPORTS
  );
  const statusSheet = ensureQboRunHistorySheet_(
    spreadsheet,
    QBO_RUN_HISTORY.STATUS_SHEET,
    QBO_RUN_HISTORY_HEADERS_.STATUS
  );

  // Initialize one durable status row per manifest exporter without
  // overwriting any status already collected.
  const existingStatus = Object.create(null);
  if (statusSheet.getLastRow() > 1) {
    statusSheet.getRange(
      2,
      1,
      statusSheet.getLastRow() - 1,
      1
    ).getValues().forEach(function(row, index) {
      if (row[0]) {
        existingStatus[String(row[0])] = index + 2;
      }
    });
  }

  getQboExportManifest().forEach(function(entry) {
    if (!existingStatus[entry.key]) {
      statusSheet.appendRow([
        entry.key,
        entry.exportFunctionName,
        '', '', '', 'NEVER_RUN', '', ''
      ]);
    }
  });

  [runsSheet, statusSheet].forEach(function(sheet) {
    sheet.setFrozenRows(1);
  });
}

function ensureQboRunHistorySheet_(spreadsheet, sheetName, headers) {
  let sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    // Reuse the default blank sheet for the first operational sheet when safe.
    const sheets = spreadsheet.getSheets();
    if (
      sheets.length === 1 &&
      sheets[0].getLastRow() === 0 &&
      sheets[0].getLastColumn() === 0
    ) {
      sheet = sheets[0];
      sheet.setName(sheetName);
    } else {
      sheet = spreadsheet.insertSheet(sheetName);
    }
  }

  const currentHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const matches = headers.every(function(header, index) {
    return currentHeaders[index] === header;
  });

  if (!matches) {
    if (sheet.getLastRow() > 1) {
      throw new Error(
        'Run-history sheet ' + sheetName +
        ' contains data but its header does not match the required schema.'
      );
    }
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  sheet.setFrozenRows(1);
  return sheet;
}

function validateQboRunHistoryWorkbookStructure_(spreadsheet) {
  const required = [
    [QBO_RUN_HISTORY.RUNS_SHEET, QBO_RUN_HISTORY_HEADERS_.RUNS],
    [QBO_RUN_HISTORY.EXPORTS_SHEET, QBO_RUN_HISTORY_HEADERS_.EXPORTS],
    [QBO_RUN_HISTORY.STATUS_SHEET, QBO_RUN_HISTORY_HEADERS_.STATUS]
  ];

  required.forEach(function(spec) {
    const sheet = spreadsheet.getSheetByName(spec[0]);
    if (!sheet) {
      throw new Error('Run-history workbook is missing sheet ' + spec[0] + '.');
    }

    const actual = sheet.getRange(1, 1, 1, spec[1].length).getValues()[0];
    spec[1].forEach(function(expected, index) {
      if (actual[index] !== expected) {
        throw new Error(
          'Run-history sheet ' + spec[0] +
          ' header mismatch at column ' + (index + 1) +
          ': expected ' + expected + ', found ' + actual[index] + '.'
        );
      }
    });
  });

  const statusSheet = spreadsheet.getSheetByName(QBO_RUN_HISTORY.STATUS_SHEET);
  const statusKeys = Object.create(null);
  if (statusSheet.getLastRow() > 1) {
    statusSheet.getRange(
      2,
      1,
      statusSheet.getLastRow() - 1,
      1
    ).getValues().forEach(function(row) {
      const key = String(row[0] || '').trim();
      if (!key) {
        return;
      }
      if (statusKeys[key]) {
        throw new Error('Run-history status contains duplicate export key ' + key + '.');
      }
      statusKeys[key] = true;
    });
  }

  const missingStatusKeys = getQboExportManifest().map(function(entry) {
    return entry.key;
  }).filter(function(key) {
    return !statusKeys[key];
  });

  if (missingStatusKeys.length > 0) {
    throw new Error(
      'Run-history status is missing manifest exporter(s): ' +
      missingStatusKeys.join(', ') + '.'
    );
  }
}

function recordQboScheduledRunStart_(runId, startedAt, totalExports) {
  const spreadsheet = getQboRunHistorySpreadsheet_();
  const sheet = spreadsheet.getSheetByName(QBO_RUN_HISTORY.RUNS_SHEET);
  const now = new Date();

  sheet.appendRow([
    runId,
    new Date(startedAt),
    '',
    'RUNNING',
    totalExports,
    0,
    0,
    0,
    '',
    now
  ]);
}

function recordQboScheduledExportStart_(runId, position, entry, startedAt) {
  const spreadsheet = getQboRunHistorySpreadsheet_();
  const exportsSheet = spreadsheet.getSheetByName(QBO_RUN_HISTORY.EXPORTS_SHEET);
  const statusSheet = spreadsheet.getSheetByName(QBO_RUN_HISTORY.STATUS_SHEET);

  exportsSheet.appendRow([
    runId,
    position,
    entry.key,
    entry.exportFunctionName,
    new Date(startedAt),
    '',
    'RUNNING',
    '',
    ''
  ]);

  updateQboExportStatusRow_(statusSheet, entry, [
    runId,
    new Date(startedAt),
    '',
    'RUNNING',
    '',
    ''
  ]);
}

function recordQboScheduledExportResult_(runId, entry, completedAt, status, durationMs, errorMessage) {
  const spreadsheet = getQboRunHistorySpreadsheet_();
  const exportsSheet = spreadsheet.getSheetByName(QBO_RUN_HISTORY.EXPORTS_SHEET);
  const statusSheet = spreadsheet.getSheetByName(QBO_RUN_HISTORY.STATUS_SHEET);
  const rowNumber = findQboExportRunRow_(exportsSheet, runId, entry.key);

  if (!rowNumber) {
    throw new Error(
      'Unable to locate run-history row for runId=' + runId +
      ', export=' + entry.key + '.'
    );
  }

  exportsSheet.getRange(rowNumber, 6, 1, 4).setValues([[
    new Date(completedAt),
    status,
    durationMs,
    errorMessage || ''
  ]]);

  const startedAt = exportsSheet.getRange(rowNumber, 5).getValue();
  updateQboExportStatusRow_(statusSheet, entry, [
    runId,
    startedAt,
    new Date(completedAt),
    status,
    durationMs,
    errorMessage || ''
  ]);
}

function recordQboScheduledRunProgress_(runId, completedExports, failedExports, currentPosition, currentExport) {
  const spreadsheet = getQboRunHistorySpreadsheet_();
  const sheet = spreadsheet.getSheetByName(QBO_RUN_HISTORY.RUNS_SHEET);
  const rowNumber = findQboRunRow_(sheet, runId);

  if (!rowNumber) {
    throw new Error('Unable to locate run-history row for runId=' + runId + '.');
  }

  sheet.getRange(rowNumber, 6, 1, 5).setValues([[
    completedExports,
    failedExports,
    currentPosition,
    currentExport || '',
    new Date()
  ]]);
}

function recordQboScheduledRunComplete_(runId, completedAt, completedExports, failedExports) {
  const spreadsheet = getQboRunHistorySpreadsheet_();
  const sheet = spreadsheet.getSheetByName(QBO_RUN_HISTORY.RUNS_SHEET);
  const rowNumber = findQboRunRow_(sheet, runId);

  if (!rowNumber) {
    throw new Error('Unable to locate run-history row for runId=' + runId + '.');
  }

  const finalStatus = failedExports > 0 ? 'COMPLETE_WITH_ERRORS' : 'COMPLETE';

  sheet.getRange(rowNumber, 3, 1, 8).setValues([[
    new Date(completedAt),
    finalStatus,
    DAILY_QBO_EXPORT_ORDER.length,
    completedExports,
    failedExports,
    DAILY_QBO_EXPORT_ORDER.length,
    '',
    new Date()
  ]]);
}

/**
 * Returns true only when the current latest-status row still represents the
 * exact RUNNING attempt being closed.
 *
 * This prevents retroactive cleanup of an old stranded attempt from
 * overwriting a newer COMPLETE/ERROR/INTERRUPTED status.
 */
function shouldUpdateQboInterruptedLatestStatus_(statusRow, runId, startedAt) {
  if (!statusRow || statusRow.length < QBO_RUN_HISTORY_HEADERS_.STATUS.length) {
    return false;
  }

  if (
    String(statusRow[2] || '') !== String(runId) ||
    String(statusRow[5] || '') !== 'RUNNING'
  ) {
    return false;
  }

  const expectedStartedMs = getQboHistoryDateMs_(startedAt);
  const actualStartedMs = getQboHistoryDateMs_(statusRow[3]);

  if (!Number.isFinite(expectedStartedMs) || !Number.isFinite(actualStartedMs)) {
    return String(statusRow[3] || '') === String(startedAt || '');
  }

  return actualStartedMs === expectedStartedMs;
}


/**
 * Normalizes a history timestamp to milliseconds for exact-attempt matching.
 */
function getQboHistoryDateMs_(value) {
  if (
    value &&
    Object.prototype.toString.call(value) === '[object Date]' &&
    Number.isFinite(value.getTime())
  ) {
    return value.getTime();
  }

  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : NaN;
}


/**
 * Reads the current status row for one manifest exporter.
 */
function getQboExportStatusRow_(statusSheet, exportKey) {
  if (statusSheet.getLastRow() <= 1) {
    return null;
  }

  const values = statusSheet.getRange(
    2,
    1,
    statusSheet.getLastRow() - 1,
    QBO_RUN_HISTORY_HEADERS_.STATUS.length
  ).getValues();

  for (let index = 0; index < values.length; index += 1) {
    if (String(values[index][0] || '') === String(exportKey)) {
      return values[index];
    }
  }

  return null;
}


function recordQboScheduledRunningExportsInterrupted_(runId, completedAt, parentStatus, reasonOverride) {
  const spreadsheet = getQboRunHistorySpreadsheet_();
  const exportsSheet = spreadsheet.getSheetByName(QBO_RUN_HISTORY.EXPORTS_SHEET);
  const statusSheet = spreadsheet.getSheetByName(QBO_RUN_HISTORY.STATUS_SHEET);

  if (exportsSheet.getLastRow() <= 1) {
    return 0;
  }

  const values = exportsSheet.getRange(
    2,
    1,
    exportsSheet.getLastRow() - 1,
    QBO_RUN_HISTORY_HEADERS_.EXPORTS.length
  ).getValues();

  const interruptedAt = new Date(completedAt);
  const reason = reasonOverride ||
    ('Scheduled run ' + (parentStatus || 'INTERRUPTED') +
    ' before exporter completed normally.');
  let interruptedCount = 0;

  values.forEach(function(row, index) {
    if (
      String(row[0]) !== String(runId) ||
      String(row[6] || '') !== 'RUNNING'
    ) {
      return;
    }

    const rowNumber = index + 2;
    const startedAt = row[4];
    const startedMs = startedAt && Object.prototype.toString.call(startedAt) === '[object Date]'
      ? startedAt.getTime()
      : NaN;
    const durationMs = Number.isFinite(startedMs)
      ? Math.max(0, interruptedAt.getTime() - startedMs)
      : '';
    const exportKey = String(row[2] || '');
    const entry = getQboExportManifestEntry_(exportKey);

    exportsSheet.getRange(rowNumber, 6, 1, 4).setValues([[
      interruptedAt,
      'INTERRUPTED',
      durationMs,
      reason
    ]]);

    if (entry) {
      const currentStatusRow = getQboExportStatusRow_(statusSheet, exportKey);

      if (
        shouldUpdateQboInterruptedLatestStatus_(
          currentStatusRow,
          runId,
          startedAt
        )
      ) {
        updateQboExportStatusRow_(statusSheet, entry, [
          runId,
          startedAt,
          interruptedAt,
          'INTERRUPTED',
          durationMs,
          reason
        ]);
      } else {
        console.log(
          '[RUN HISTORY] | STATUS PRESERVED | runId=' + runId +
          ' | export=' + exportKey +
          ' | reason=newer status already exists'
        );
      }
    }

    interruptedCount += 1;
  });

  return interruptedCount;
}

function recordQboScheduledRunInterrupted_(runId, completedAt, completedExports, failedExports, status) {
  const spreadsheet = getQboRunHistorySpreadsheet_();
  const sheet = spreadsheet.getSheetByName(QBO_RUN_HISTORY.RUNS_SHEET);
  const rowNumber = findQboRunRow_(sheet, runId);

  if (!rowNumber) {
    return;
  }

  sheet.getRange(rowNumber, 3, 1, 8).setValues([[
    new Date(completedAt),
    status || 'INTERRUPTED',
    DAILY_QBO_EXPORT_ORDER.length,
    completedExports,
    failedExports,
    completedExports + failedExports,
    '',
    new Date()
  ]]);
}


function recordQboScheduledRunResumed_(runId, completedExports, failedExports, currentPosition, currentExport) {
  const spreadsheet = getQboRunHistorySpreadsheet_();
  const sheet = spreadsheet.getSheetByName(QBO_RUN_HISTORY.RUNS_SHEET);
  const rowNumber = findQboRunRow_(sheet, runId);

  if (!rowNumber) {
    throw new Error('Unable to locate run-history row for runId=' + runId + '.');
  }

  // Preserve the original StartedAt and TotalExports. Re-open only the
  // terminal/progress fields for the same logical run.
  sheet.getRange(rowNumber, 3, 1, 8).setValues([[
    '',
    'RUNNING',
    DAILY_QBO_EXPORT_ORDER.length,
    completedExports,
    failedExports,
    currentPosition,
    currentExport || '',
    new Date()
  ]]);
}

function getLatestQboScheduledRunResumeState_() {
  const spreadsheet = getQboRunHistorySpreadsheet_();
  const runsSheet = spreadsheet.getSheetByName(QBO_RUN_HISTORY.RUNS_SHEET);

  if (runsSheet.getLastRow() <= 1) {
    return null;
  }

  const values = runsSheet.getRange(
    2,
    1,
    runsSheet.getLastRow() - 1,
    QBO_RUN_HISTORY_HEADERS_.RUNS.length
  ).getValues();

  const resumableStatuses = {
    RUNNING: true,
    INTERRUPTED: true,
    CANCELLED: true,
    REPLACED: true
  };

  for (let index = values.length - 1; index >= 0; index -= 1) {
    const runId = String(values[index][0] || '').trim();
    const status = String(values[index][3] || '').trim();

    if (!runId || !resumableStatuses[status]) {
      continue;
    }

    const state = getQboScheduledRunResumeState_(runId);
    if (state.resumeIndex < DAILY_QBO_EXPORT_ORDER.length) {
      return state;
    }
  }

  return null;
}

function getQboScheduledRunResumeState_(runId) {
  const spreadsheet = getQboRunHistorySpreadsheet_();
  const runsSheet = spreadsheet.getSheetByName(QBO_RUN_HISTORY.RUNS_SHEET);
  const exportsSheet = spreadsheet.getSheetByName(QBO_RUN_HISTORY.EXPORTS_SHEET);
  const runRowNumber = findQboRunRow_(runsSheet, runId);

  if (!runRowNumber) {
    throw new Error('Unable to locate run-history row for runId=' + runId + '.');
  }

  const runRow = runsSheet.getRange(
    runRowNumber,
    1,
    1,
    QBO_RUN_HISTORY_HEADERS_.RUNS.length
  ).getValues()[0];

  const startedAtValue = runRow[1];
  const startedAt = startedAtValue &&
    Object.prototype.toString.call(startedAtValue) === '[object Date]'
      ? startedAtValue.toISOString()
      : String(startedAtValue || '');

  if (!startedAt) {
    throw new Error('Run ' + runId + ' is missing StartedAt and cannot be resumed.');
  }

  let exportRows = [];
  if (exportsSheet.getLastRow() > 1) {
    exportRows = exportsSheet.getRange(
      2,
      1,
      exportsSheet.getLastRow() - 1,
      QBO_RUN_HISTORY_HEADERS_.EXPORTS.length
    ).getValues();
  }

  return buildQboScheduledRunResumeState_(
    String(runId),
    startedAt,
    exportRows,
    DAILY_QBO_EXPORT_ORDER
  );
}


/**
 * Pure reducer used by resume/recovery and failure-path regression tests.
 *
 * Later retry rows for the same exporter supersede earlier attempts. The first
 * exporter whose latest attempt is not COMPLETE is the resume point.
 */
function buildQboScheduledRunResumeState_(runId, startedAt, exportRows, exportOrder) {
  const latestStatusByKey = Object.create(null);

  (exportRows || []).forEach(function(row) {
    if (String(row[0]) !== String(runId)) {
      return;
    }

    const key = String(row[2] || '').trim();
    if (key) {
      latestStatusByKey[key] = String(row[6] || '').trim();
    }
  });

  let resumeIndex = exportOrder.length;

  for (let index = 0; index < exportOrder.length; index += 1) {
    const status = latestStatusByKey[exportOrder[index]] || '';

    if (status !== 'COMPLETE') {
      resumeIndex = index;
      break;
    }
  }

  let completedCount = 0;
  let failedCount = 0;

  for (let index = 0; index < resumeIndex; index += 1) {
    const status = latestStatusByKey[exportOrder[index]] || '';

    if (status === 'COMPLETE') {
      completedCount += 1;
    } else if (status === 'ERROR') {
      failedCount += 1;
    }
  }

  return {
    runId: String(runId),
    startedAt: String(startedAt),
    resumeIndex: resumeIndex,
    completedCount: completedCount,
    failedCount: failedCount
  };
}
function updateQboExportStatusRow_(sheet, entry, values) {
  const rowNumber = findQboStatusRow_(sheet, entry.key);

  if (!rowNumber) {
    sheet.appendRow([
      entry.key,
      entry.exportFunctionName
    ].concat(values));
    return;
  }

  sheet.getRange(rowNumber, 2, 1, 7).setValues([[
    entry.exportFunctionName,
    values[0],
    values[1],
    values[2],
    values[3],
    values[4],
    values[5]
  ]]);
}

function findQboRunRow_(sheet, runId) {
  if (sheet.getLastRow() <= 1) {
    return 0;
  }

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (String(values[index][0]) === String(runId)) {
      return index + 2;
    }
  }
  return 0;
}

function findQboExportRunRow_(sheet, runId, exportKey) {
  if (sheet.getLastRow() <= 1) {
    return 0;
  }

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (
      String(values[index][0]) === String(runId) &&
      String(values[index][2]) === String(exportKey)
    ) {
      return index + 2;
    }
  }
  return 0;
}

function findQboStatusRow_(sheet, exportKey) {
  if (sheet.getLastRow() <= 1) {
    return 0;
  }

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let index = 0; index < values.length; index += 1) {
    if (String(values[index][0]) === String(exportKey)) {
      return index + 2;
    }
  }
  return 0;
}

function formatQboRunHistoryLogValue_(value) {
  if (!value) {
    return '';
  }
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return value.toISOString();
  }
  return String(value);
}
