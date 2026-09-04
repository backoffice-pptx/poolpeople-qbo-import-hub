/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 52_QBO_GeneralLedgerReport.js
 * Purpose     : Production, read-only extraction of the QBO General Ledger
 *               report for an explicit accounting date window.
 *
 * Public API:
 *   - provisionQboGeneralLedgerReportWorkbook()
 *   - exportQboGeneralLedger()
 *   - exportQboGeneralLedgerForPeriod(startDate, endDate)
 *   - testQboGeneralLedgerReportConfiguration()
 *   - testQboGeneralLedgerSalesTaxStructure()
 *   - showQboGeneralLedgerHistoryStatus()
 *
 * Architecture:
 *   - This is a REPORT extraction path, not a 23rd entity export.
 *   - It is intentionally excluded from QBO_EXPORT_MANIFEST and the daily
 *     22-export scheduler. Report data is date-window dependent and should be
 *     requested for the accounting period needed by the downstream consumer.
 *   - exportQboGeneralLedger() uses configured START/END Script Properties
 *     when both are present; otherwise it exports the last closed calendar
 *     month in the Apps Script project time zone.
 *   - The General Ledger sheet is a historical, period-keyed store. A first
 *     extraction for a report period appends that month's rows; a rerun of an
 *     existing period replaces only that period's rows. Other periods remain
 *     untouched.
 *   - Every successful extract appends one extraction-run row and creates a
 *     timestamped Drive snapshot of the dedicated report workbook. Prior
 *     successful versions therefore remain recoverable after a period rerun.
 *   - A conservative workbook capacity guard prevents writes once projected
 *     allocated cells would exceed the configured safety threshold.
 *
 * QBO impact:
 *   - Read-only. Uses GET reports/GeneralLedger only.
 * ============================================================================
 */

const QBO_GENERAL_LEDGER_REPORT = Object.freeze({
  WORKBOOK_TITLE: 'QBO Export - General Ledger Report',
  DATA_SHEET: 'QBO_GeneralLedger',
  RUNS_SHEET: 'QBO_GeneralLedgerRuns',
  ACCOUNTING_METHOD: 'Cash',
  MAX_WORKBOOK_CELLS: 8000000
});

const QBO_GENERAL_LEDGER_HEADERS = Object.freeze([
  'ExtractRunId',
  'ExtractedAt',
  'ReportName',
  'ReportBasis',
  'ReportStartDate',
  'ReportEndDate',
  'Depth',
  'RowType',
  'GroupLabel',
  'GroupId',
  'SectionSummaryLabel',
  'SectionSummaryAmount',
  'SectionSummaryBalance',
  'Date',
  'TransactionType',
  'TransactionId',
  'Num',
  'Name',
  'NameId',
  'MemoDescription',
  'Split',
  'SplitId',
  'Amount',
  'Balance',
  'ValuesJSON',
  'RawRowJSON'
]);

const QBO_GENERAL_LEDGER_RUN_HEADERS = Object.freeze([
  'ExtractRunId',
  'ExtractedAt',
  'ReportName',
  'ReportBasis',
  'ReportStartDate',
  'ReportEndDate',
  'RowCount',
  'SpreadsheetId',
  'SnapshotFileId',
  'SnapshotFileName'
]);

/**
 * Creates the dedicated General Ledger report workbook when missing.
 * Existing configuration is never replaced.
 *
 * @return {Object} Provisioning result.
 */
function provisionQboGeneralLedgerReportWorkbook() {
  const props = PropertiesService.getScriptProperties();
  const propertyKey = SCRIPT_PROPERTY_KEYS.GENERAL_LEDGER_REPORT_SPREADSHEET_ID;
  const existingId = String(props.getProperty(propertyKey) || '').trim();

  if (existingId) {
    const existing = SpreadsheetApp.openById(existingId);
    ensureQboGeneralLedgerWorkbookSheets_(existing);
    safeLog_(
      '[GL REPORT] | PROVISION | EXISTING | workbook=' + existing.getName() +
      ' | id=' + existingId
    );
    return {
      status: 'EXISTING',
      spreadsheetId: existingId,
      spreadsheetUrl: existing.getUrl()
    };
  }

  const spreadsheet = SpreadsheetApp.create(QBO_GENERAL_LEDGER_REPORT.WORKBOOK_TITLE);
  ensureQboGeneralLedgerWorkbookSheets_(spreadsheet);
  props.setProperty(propertyKey, spreadsheet.getId());

  safeLog_(
    '[GL REPORT] | PROVISION | CREATED | workbook=' + spreadsheet.getName() +
    ' | id=' + spreadsheet.getId()
  );

  return {
    status: 'CREATED',
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl()
  };
}

/**
 * Exports the configured General Ledger period. If no configured period is
 * present, exports the last closed calendar month.
 *
 * Optional Script Properties:
 *   QBO_REPORT_GENERAL_LEDGER_START_DATE = yyyy-mm-dd
 *   QBO_REPORT_GENERAL_LEDGER_END_DATE   = yyyy-mm-dd
 *
 * @return {Object} Export summary.
 */
function exportQboGeneralLedger() {
  const period = resolveQboGeneralLedgerExportPeriod_();
  return exportQboGeneralLedgerForPeriod(period.startDate, period.endDate);
}

/**
 * Exports one explicit inclusive General Ledger date window on cash basis.
 *
 * @param {string} startDate yyyy-mm-dd inclusive.
 * @param {string} endDate yyyy-mm-dd inclusive.
 * @return {Object} Export summary.
 */
function exportQboGeneralLedgerForPeriod(startDate, endDate) {
  validateQboGeneralLedgerPeriod_(startDate, endDate);
  const spreadsheet = getQboGeneralLedgerReportSpreadsheet_();
  const cfg = getConfig_();
  const runId = Utilities.getUuid();
  const extractedAt = new Date();
  const query = [
    'start_date=' + encodeURIComponent(startDate),
    'end_date=' + encodeURIComponent(endDate),
    'accounting_method=' + encodeURIComponent(QBO_GENERAL_LEDGER_REPORT.ACCOUNTING_METHOD),
    'minorversion=' + encodeURIComponent(cfg.minorVersion)
  ].join('&');

  safeLog_(
    '[GL REPORT] | START | run=' + runId +
    ' | period=' + startDate + '..' + endDate +
    ' | basis=' + QBO_GENERAL_LEDGER_REPORT.ACCOUNTING_METHOD
  );

  const report = qboGet_('reports/GeneralLedger?' + query);
  validateQboGeneralLedgerResponse_(report, startDate, endDate);

  const header = report.Header || {};
  const rows = [];
  flattenQboGeneralLedgerRows_(
    report.Rows && Array.isArray(report.Rows.Row) ? report.Rows.Row : [],
    0,
    '',
    '',
    {
      runId: runId,
      extractedAt: extractedAt,
      reportName: valueOrBlank_(header.ReportName),
      reportBasis: valueOrBlank_(header.ReportBasis),
      startDate: valueOrBlank_(header.StartPeriod) || startDate,
      endDate: valueOrBlank_(header.EndPeriod) || endDate
    },
    rows
  );

  let storageResult;
  let snapshot;
  withExportWriteLock_(
    QBO_GENERAL_LEDGER_REPORT.DATA_SHEET,
    spreadsheet.getId(),
    function() {
      storageResult = upsertQboGeneralLedgerPeriod_(
        spreadsheet,
        rows,
        startDate,
        endDate
      );
      snapshot = createQboGeneralLedgerSnapshot_(spreadsheet, startDate, endDate);
    }
  );

  appendQboGeneralLedgerRun_(spreadsheet, [
    runId,
    extractedAt,
    valueOrBlank_(header.ReportName),
    valueOrBlank_(header.ReportBasis),
    valueOrBlank_(header.StartPeriod) || startDate,
    valueOrBlank_(header.EndPeriod) || endDate,
    rows.length,
    spreadsheet.getId(),
    snapshot.fileId,
    snapshot.fileName
  ]);

  const summary = {
    extractRunId: runId,
    reportName: valueOrBlank_(header.ReportName),
    reportBasis: valueOrBlank_(header.ReportBasis),
    startDate: valueOrBlank_(header.StartPeriod) || startDate,
    endDate: valueOrBlank_(header.EndPeriod) || endDate,
    rowCount: rows.length,
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    snapshotFileId: snapshot.fileId,
    snapshotFileName: snapshot.fileName,
    storageAction: storageResult.action,
    replacedRowCount: storageResult.replacedRowCount,
    historicalPeriodCount: storageResult.periodCount
  };

  safeLog_('[GL REPORT] | COMPLETE | ' + JSON.stringify(summary));
  return summary;
}

/**
 * Fast read-only configuration check. Does not call QBO or write anything.
 */
function testQboGeneralLedgerReportConfiguration() {
  const props = PropertiesService.getScriptProperties();
  const workbookId = String(
    props.getProperty(SCRIPT_PROPERTY_KEYS.GENERAL_LEDGER_REPORT_SPREADSHEET_ID) || ''
  ).trim();
  const startDate = String(
    props.getProperty(SCRIPT_PROPERTY_KEYS.GENERAL_LEDGER_REPORT_START_DATE) || ''
  ).trim();
  const endDate = String(
    props.getProperty(SCRIPT_PROPERTY_KEYS.GENERAL_LEDGER_REPORT_END_DATE) || ''
  ).trim();

  if (!workbookId) {
    throw new Error(
      'Missing ' + SCRIPT_PROPERTY_KEYS.GENERAL_LEDGER_REPORT_SPREADSHEET_ID +
      '. Run provisionQboGeneralLedgerReportWorkbook() first.'
    );
  }

  if ((startDate && !endDate) || (!startDate && endDate)) {
    throw new Error(
      'General Ledger report period override is incomplete. Set both ' +
      SCRIPT_PROPERTY_KEYS.GENERAL_LEDGER_REPORT_START_DATE + ' and ' +
      SCRIPT_PROPERTY_KEYS.GENERAL_LEDGER_REPORT_END_DATE + ', or clear both.'
    );
  }

  if (startDate && endDate) {
    validateQboGeneralLedgerPeriod_(startDate, endDate);
  }

  const mode = startDate && endDate
    ? 'CONFIGURED_PERIOD ' + startDate + '..' + endDate
    : 'LAST_CLOSED_MONTH';

  safeLog_(
    '[GL REPORT] | CONFIG OK | workbook=present | mode=' + mode +
    ' | basis=' + QBO_GENERAL_LEDGER_REPORT.ACCOUNTING_METHOD
  );

  return {
    workbookConfigured: true,
    mode: mode,
    accountingMethod: QBO_GENERAL_LEDGER_REPORT.ACCOUNTING_METHOD
  };
}


/**
 * Read-only structural validation of the latest General Ledger extraction run
 * for sales-tax ledger evidence. This intentionally does not hard-code dates
 * or amounts. It verifies that the Texas Comptroller payable section is present
 * and identifies recognized Sales Tax Payment / Sales Tax Adjustment rows.
 *
 * @return {Object} Structural validation summary.
 */

/**
 * Read-only summary of the period-keyed General Ledger history store.
 * Reads only the period-key columns, not the large JSON evidence columns.
 *
 * @return {Object} History summary.
 */
function showQboGeneralLedgerHistoryStatus() {
  const spreadsheet = getQboGeneralLedgerReportSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(QBO_GENERAL_LEDGER_REPORT.DATA_SHEET);
  const status = getQboGeneralLedgerHistoryStatus_(spreadsheet, sheet);
  safeLog_('[GL REPORT] | HISTORY | ' + JSON.stringify(status));
  return status;
}

function testQboGeneralLedgerSalesTaxStructure() {
  const spreadsheet = getQboGeneralLedgerReportSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(QBO_GENERAL_LEDGER_REPORT.DATA_SHEET);
  if (!sheet || sheet.getLastRow() < 2) {
    throw new Error('General Ledger current extract is empty. Run an export first.');
  }

  const runSheet = spreadsheet.getSheetByName(QBO_GENERAL_LEDGER_REPORT.RUNS_SHEET);
  if (!runSheet || runSheet.getLastRow() < 2) {
    throw new Error('General Ledger run history is empty. Run an export first.');
  }
  const latestRunId = String(runSheet.getRange(runSheet.getLastRow(), 1).getValue() || '').trim();
  if (!latestRunId) {
    throw new Error('Latest General Ledger run history row is missing ExtractRunId.');
  }

  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function(value) { return String(value || '').trim(); });
  const required = ['ExtractRunId', 'RowType', 'GroupLabel', 'TransactionType'];
  const index = {};
  required.forEach(function(header) {
    const position = headers.indexOf(header);
    if (position < 0) {
      throw new Error('General Ledger structural validation is missing column ' + header + '.');
    }
    index[header] = position;
  });

  const comptrollerGroup = 'Texas Comptroller Payable';
  let sectionPresent = false;
  let paymentCount = 0;
  let adjustmentCount = 0;

  for (let i = 1; i < values.length; i++) {
    const rowRunId = String(values[i][index.ExtractRunId] || '').trim();
    if (rowRunId !== latestRunId) continue;
    const rowType = String(values[i][index.RowType] || '').trim();
    const groupLabel = String(values[i][index.GroupLabel] || '').trim();
    const transactionType = String(values[i][index.TransactionType] || '').trim();

    if (groupLabel === comptrollerGroup) {
      sectionPresent = true;
      if (rowType === 'Data' && transactionType === 'Sales Tax Payment') {
        paymentCount++;
      }
      if (rowType === 'Data' && transactionType === 'Sales Tax Adjustment') {
        adjustmentCount++;
      }
    }
  }

  if (!sectionPresent) {
    throw new Error('Texas Comptroller Payable section was not found in the current General Ledger extract.');
  }
  if (paymentCount + adjustmentCount === 0) {
    throw new Error(
      'Texas Comptroller Payable section was found, but no Sales Tax Payment or ' +
      'Sales Tax Adjustment rows were recognized in the current extract.'
    );
  }

  const summary = {
    sectionPresent: true,
    salesTaxPaymentCount: paymentCount,
    salesTaxAdjustmentCount: adjustmentCount,
    recognizedSalesTaxEventCount: paymentCount + adjustmentCount,
    extractRunId: latestRunId
  };

  safeLog_('[GL REPORT] | SALES TAX STRUCTURE OK | ' + JSON.stringify(summary));
  return summary;
}

function resolveQboGeneralLedgerExportPeriod_() {
  const props = PropertiesService.getScriptProperties();
  const startDate = String(
    props.getProperty(SCRIPT_PROPERTY_KEYS.GENERAL_LEDGER_REPORT_START_DATE) || ''
  ).trim();
  const endDate = String(
    props.getProperty(SCRIPT_PROPERTY_KEYS.GENERAL_LEDGER_REPORT_END_DATE) || ''
  ).trim();

  if (startDate || endDate) {
    if (!startDate || !endDate) {
      throw new Error(
        'General Ledger report period override requires both START_DATE and END_DATE.'
      );
    }
    validateQboGeneralLedgerPeriod_(startDate, endDate);
    return { startDate: startDate, endDate: endDate };
  }

  const timeZone = Session.getScriptTimeZone() || 'America/Chicago';
  const nowText = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
  const parts = nowText.split('-').map(Number);
  const thisMonthUtc = new Date(Date.UTC(parts[0], parts[1] - 1, 1));
  const priorMonthStartUtc = new Date(Date.UTC(parts[0], parts[1] - 2, 1));
  const priorMonthEndUtc = new Date(thisMonthUtc.getTime() - 24 * 60 * 60 * 1000);

  return {
    startDate: Utilities.formatDate(priorMonthStartUtc, 'UTC', 'yyyy-MM-dd'),
    endDate: Utilities.formatDate(priorMonthEndUtc, 'UTC', 'yyyy-MM-dd')
  };
}

function validateQboGeneralLedgerPeriod_(startDate, endDate) {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(String(startDate || '')) || !pattern.test(String(endDate || ''))) {
    throw new Error('General Ledger dates must use yyyy-mm-dd format.');
  }
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error('General Ledger date window contains an invalid date.');
  }
  if (start.getTime() > end.getTime()) {
    throw new Error('General Ledger startDate must be on or before endDate.');
  }
}

function validateQboGeneralLedgerResponse_(report, startDate, endDate) {
  if (!report || typeof report !== 'object') {
    throw new Error('QBO General Ledger response was empty or invalid.');
  }
  const header = report.Header || {};
  if (header.ReportName !== 'GeneralLedger') {
    throw new Error(
      'Unexpected QBO report response. Expected GeneralLedger but received ' +
      String(header.ReportName || '(missing)') + '.'
    );
  }
  if (header.ReportBasis && header.ReportBasis !== QBO_GENERAL_LEDGER_REPORT.ACCOUNTING_METHOD) {
    throw new Error(
      'Unexpected General Ledger basis ' + header.ReportBasis +
      '; expected ' + QBO_GENERAL_LEDGER_REPORT.ACCOUNTING_METHOD + '.'
    );
  }
  if (header.StartPeriod && header.StartPeriod !== startDate) {
    throw new Error('QBO General Ledger StartPeriod does not match requested startDate.');
  }
  if (header.EndPeriod && header.EndPeriod !== endDate) {
    throw new Error('QBO General Ledger EndPeriod does not match requested endDate.');
  }
}

function flattenQboGeneralLedgerRows_(sourceRows, depth, groupLabel, groupId, meta, outputRows) {
  sourceRows.forEach(function(row) {
    const headerData = row.Header && Array.isArray(row.Header.ColData)
      ? row.Header.ColData
      : [];
    const colData = Array.isArray(row.ColData) ? row.ColData : [];
    const summaryData = row.Summary && Array.isArray(row.Summary.ColData)
      ? row.Summary.ColData
      : [];

    let nextGroupLabel = groupLabel;
    let nextGroupId = groupId;
    if (headerData.length > 0) {
      nextGroupLabel = valueOrBlank_(headerData[0].value) || groupLabel;
      nextGroupId = valueOrBlank_(headerData[0].id) || groupId;
    }

    const rowType = valueOrBlank_(row.type) || (headerData.length > 0 ? 'Section' : 'Data');
    const values = colData.length > 0
      ? colData
      : (summaryData.length > 0 ? summaryData : headerData);

    outputRows.push(buildQboGeneralLedgerRow_(
      meta,
      depth,
      rowType,
      nextGroupLabel,
      nextGroupId,
      values,
      row
    ));

    if (row.Rows && Array.isArray(row.Rows.Row)) {
      flattenQboGeneralLedgerRows_(
        row.Rows.Row,
        depth + 1,
        nextGroupLabel,
        nextGroupId,
        meta,
        outputRows
      );
    }
  });
}

function buildQboGeneralLedgerRow_(meta, depth, rowType, groupLabel, groupId, values, rawRow) {
  function cell(index) {
    return values[index] || {};
  }
  function v(index) {
    return valueOrBlank_(cell(index).value);
  }
  function id(index) {
    return valueOrBlank_(cell(index).id);
  }

  const isDataRow = rowType === 'Data';
  const summaryData = rawRow && rawRow.Summary && Array.isArray(rawRow.Summary.ColData)
    ? rawRow.Summary.ColData
    : [];
  function summaryValue(index) {
    return valueOrBlank_((summaryData[index] || {}).value);
  }

  return [
    meta.runId,
    meta.extractedAt,
    meta.reportName,
    meta.reportBasis,
    meta.startDate,
    meta.endDate,
    depth,
    rowType,
    groupLabel,
    groupId,
    isDataRow ? '' : summaryValue(0),
    isDataRow ? '' : numberOrBlank_(summaryValue(6)),
    isDataRow ? '' : numberOrBlank_(summaryValue(7)),
    isDataRow ? v(0) : '',
    isDataRow ? v(1) : '',
    isDataRow ? id(1) : '',
    isDataRow ? v(2) : '',
    isDataRow ? v(3) : '',
    isDataRow ? id(3) : '',
    isDataRow ? v(4) : '',
    isDataRow ? v(5) : '',
    isDataRow ? id(5) : '',
    isDataRow ? numberOrBlank_(v(6)) : '',
    isDataRow ? numberOrBlank_(v(7)) : '',
    jsonStringifyCellSafe_(values.map(function(item) { return valueOrBlank_(item.value); })),
    jsonStringifyCellSafe_(rawRow)
  ];
}

function getQboGeneralLedgerReportSpreadsheet_() {
  const id = String(
    PropertiesService.getScriptProperties().getProperty(
      SCRIPT_PROPERTY_KEYS.GENERAL_LEDGER_REPORT_SPREADSHEET_ID
    ) || ''
  ).trim();
  if (!id) {
    throw new Error(
      'Missing ' + SCRIPT_PROPERTY_KEYS.GENERAL_LEDGER_REPORT_SPREADSHEET_ID +
      '. Run provisionQboGeneralLedgerReportWorkbook() first.'
    );
  }
  try {
    const spreadsheet = SpreadsheetApp.openById(id);
    ensureQboGeneralLedgerWorkbookSheets_(spreadsheet);
    return spreadsheet;
  } catch (error) {
    throw new Error(
      'Unable to open configured General Ledger report workbook ' + id +
      '. Original error: ' + error.message
    );
  }
}

function ensureQboGeneralLedgerWorkbookSheets_(spreadsheet) {
  [QBO_GENERAL_LEDGER_REPORT.DATA_SHEET, QBO_GENERAL_LEDGER_REPORT.RUNS_SHEET]
    .forEach(function(sheetName) {
      if (!spreadsheet.getSheetByName(sheetName)) {
        spreadsheet.insertSheet(sheetName);
      }
    });

  const defaultSheet = spreadsheet.getSheetByName('Sheet1');
  if (defaultSheet && spreadsheet.getSheets().length > 2 && defaultSheet.getLastRow() === 0) {
    spreadsheet.deleteSheet(defaultSheet);
  }
}

function upsertQboGeneralLedgerPeriod_(spreadsheet, rows, startDate, endDate) {
  const sheet = spreadsheet.getSheetByName(QBO_GENERAL_LEDGER_REPORT.DATA_SHEET);
  const headers = QBO_GENERAL_LEDGER_HEADERS.slice();
  validateExportTableStructure_(headers, rows);
  ensureQboGeneralLedgerHeader_(sheet, headers);

  const existing = findQboGeneralLedgerPeriodBlock_(sheet, startDate, endDate);
  const replacementRows = existing.rowCount;
  const rowsToAdd = rows.length;
  const netAdditionalRows = Math.max(0, rowsToAdd - replacementRows);

  validateQboGeneralLedgerCapacity_(spreadsheet, sheet, netAdditionalRows, headers.length);

  if (replacementRows > 0) {
    // Google Sheets does not allow deleting every non-frozen row in a sheet.
    // A single-period workbook can legitimately match that condition on rerun,
    // so preserve one spare non-frozen row before removing the old period block.
    const frozenRows = sheet.getFrozenRows();
    const remainingNonFrozenRows = sheet.getMaxRows() - frozenRows - replacementRows;
    if (remainingNonFrozenRows < 1) {
      sheet.insertRowsAfter(sheet.getMaxRows(), 1 - remainingNonFrozenRows);
    }
    sheet.deleteRows(existing.startRow, replacementRows);
  }

  const appendStartRow = sheet.getLastRow() + 1;
  if (rowsToAdd > 0) {
    const requiredLastRow = appendStartRow + rowsToAdd - 1;
    if (sheet.getMaxRows() < requiredLastRow) {
      sheet.insertRowsAfter(sheet.getMaxRows(), requiredLastRow - sheet.getMaxRows());
    }
    if (sheet.getMaxColumns() < headers.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
    }

    const started = Date.now();
    sheet.getRange(appendStartRow, 1, rowsToAdd, headers.length).setValues(rows);
    safeLog_(
      '[PERF] ' + QBO_GENERAL_LEDGER_REPORT.DATA_SHEET +
      ' period upsert setValues (' + rowsToAdd + ' rows): ' +
      (Date.now() - started) + ' ms.'
    );

    applyExportDataLayout_(
      sheet,
      sheet.getRange(appendStartRow, 1, rowsToAdd, headers.length),
      rowsToAdd
    );
    applyQboGeneralLedgerPeriodFormats_(sheet, appendStartRow, rowsToAdd);
  }

  formatExportHeader_(sheet, headers, 1);
  applyExportFilter_(sheet, headers.length, Math.max(0, sheet.getLastRow() - 1));
  applyExportColumnWidths_(sheet, {
    9: 240,
    11: 240,
    14: 110,
    15: 160,
    18: 220,
    20: 300,
    21: 240,
    25: 300,
    26: 300
  });

  const history = getQboGeneralLedgerHistoryStatus_(spreadsheet, sheet);
  const action = replacementRows > 0 ? 'REPLACE_PERIOD' : 'APPEND_PERIOD';
  safeLog_(
    '[GL REPORT] | WRITE | action=' + action +
    ' | period=' + startDate + '..' + endDate +
    ' | rows=' + rowsToAdd +
    ' | replacedRows=' + replacementRows +
    ' | totalRows=' + history.dataRowCount +
    ' | periods=' + history.periodCount +
    ' | columns=' + headers.length
  );

  return {
    action: action,
    replacedRowCount: replacementRows,
    periodCount: history.periodCount,
    totalDataRowCount: history.dataRowCount
  };
}

function ensureQboGeneralLedgerHeader_(sheet, headers) {
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }
  const existing = sheet.getLastRow() > 0
    ? sheet.getRange(1, 1, 1, headers.length).getValues()[0]
    : [];
  const matches = existing.length === headers.length && headers.every(function(header, i) {
    return String(existing[i] || '') === header;
  });
  if (!matches) {
    if (sheet.getLastRow() > 1) {
      throw new Error(
        'General Ledger history sheet header does not match the expected schema. ' +
        'Refusing to rewrite historical rows.'
      );
    }
    writeExportHeader_(sheet, headers);
  }
}

function findQboGeneralLedgerPeriodBlock_(sheet, startDate, endDate) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { startRow: 0, rowCount: 0 };
  }

  // Read only ReportStartDate/ReportEndDate. Avoid loading large JSON columns.
  const periodValues = sheet.getRange(2, 5, lastRow - 1, 2).getDisplayValues();
  let first = -1;
  let last = -1;
  let gapDetected = false;

  for (let i = 0; i < periodValues.length; i++) {
    const matches = periodValues[i][0] === startDate && periodValues[i][1] === endDate;
    if (matches) {
      if (first < 0) first = i;
      if (last >= 0 && i !== last + 1) gapDetected = true;
      last = i;
    }
  }

  if (first < 0) {
    return { startRow: 0, rowCount: 0 };
  }
  if (gapDetected) {
    throw new Error(
      'General Ledger period ' + startDate + '..' + endDate +
      ' is not stored as one contiguous block. Refusing unsafe replacement.'
    );
  }
  return { startRow: first + 2, rowCount: last - first + 1 };
}

function getQboGeneralLedgerHistoryStatus_(spreadsheet, sheet) {
  const lastRow = sheet.getLastRow();
  const periods = {};
  if (lastRow >= 2) {
    const values = sheet.getRange(2, 5, lastRow - 1, 2).getDisplayValues();
    values.forEach(function(row) {
      const start = String(row[0] || '').trim();
      const end = String(row[1] || '').trim();
      if (!start || !end) return;
      const key = start + '..' + end;
      periods[key] = (periods[key] || 0) + 1;
    });
  }

  const periodList = Object.keys(periods).sort().map(function(key) {
    return { period: key, rowCount: periods[key] };
  });
  const allocatedCellCount = getQboGeneralLedgerAllocatedCellCount_(spreadsheet);

  return {
    dataRowCount: Math.max(0, lastRow - 1),
    periodCount: periodList.length,
    periods: periodList,
    allocatedCellCount: allocatedCellCount,
    capacityThreshold: QBO_GENERAL_LEDGER_REPORT.MAX_WORKBOOK_CELLS,
    capacityUsedPct: Number(
      (allocatedCellCount / QBO_GENERAL_LEDGER_REPORT.MAX_WORKBOOK_CELLS * 100).toFixed(2)
    )
  };
}

function validateQboGeneralLedgerCapacity_(spreadsheet, dataSheet, netAdditionalRows, columnCount) {
  const currentCells = getQboGeneralLedgerAllocatedCellCount_(spreadsheet);
  const currentMaxRows = dataSheet.getMaxRows();
  const requiredRows = dataSheet.getLastRow() + netAdditionalRows;
  const rowsToAllocate = Math.max(0, requiredRows - currentMaxRows);
  const projectedCells = currentCells + rowsToAllocate * dataSheet.getMaxColumns();

  if (projectedCells > QBO_GENERAL_LEDGER_REPORT.MAX_WORKBOOK_CELLS) {
    throw new Error(
      'General Ledger history write would exceed the configured workbook safety threshold of ' +
      QBO_GENERAL_LEDGER_REPORT.MAX_WORKBOOK_CELLS + ' allocated cells. ' +
      'Current=' + currentCells + ', projected=' + projectedCells + '. '
      + 'Archive or partition historical periods before continuing.'
    );
  }
}

function getQboGeneralLedgerAllocatedCellCount_(spreadsheet) {
  return spreadsheet.getSheets().reduce(function(total, sheet) {
    return total + sheet.getMaxRows() * sheet.getMaxColumns();
  }, 0);
}

function applyQboGeneralLedgerPeriodFormats_(sheet, startRow, rowCount) {
  if (rowCount <= 0) return;
  sheet.getRange(startRow, 2, rowCount, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet.getRange(startRow, 5, rowCount, 2).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(startRow, 12, rowCount, 2).setNumberFormat('$#,##0.00;-$#,##0.00');
  sheet.getRange(startRow, 14, rowCount, 1).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(startRow, 23, rowCount, 2).setNumberFormat('$#,##0.00;-$#,##0.00');
}

function appendQboGeneralLedgerRun_(spreadsheet, row) {
  const sheet = spreadsheet.getSheetByName(QBO_GENERAL_LEDGER_REPORT.RUNS_SHEET);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, QBO_GENERAL_LEDGER_RUN_HEADERS.length)
      .setValues([QBO_GENERAL_LEDGER_RUN_HEADERS.slice()])
      .setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  sheet.getRange(2, 2, Math.max(1, sheet.getLastRow() - 1), 1)
    .setNumberFormat('yyyy-mm-dd hh:mm:ss');
}

function createQboGeneralLedgerSnapshot_(spreadsheet, startDate, endDate) {
  const props = PropertiesService.getScriptProperties();
  const folderId = String(props.getProperty(SCRIPT_PROPERTY_KEYS.SNAPSHOT_FOLDER_ID) || '').trim();
  if (!folderId) {
    throw new Error(
      'Missing ' + SCRIPT_PROPERTY_KEYS.SNAPSHOT_FOLDER_ID +
      '. General Ledger exports require the existing QBO snapshot folder.'
    );
  }
  const folder = DriveApp.getFolderById(folderId);
  const sourceFile = DriveApp.getFileById(spreadsheet.getId());
  const timestamp = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone() || 'America/Chicago',
    EXPORT_SNAPSHOT.TIMESTAMP_FORMAT
  );
  const fileName = spreadsheet.getName() + '_' + startDate + '_to_' + endDate + '_' + timestamp;
  const copy = sourceFile.makeCopy(fileName, folder);

  safeLog_(
    '[GL REPORT] | SNAPSHOT | COMPLETE | file=' + copy.getName() +
    ' | id=' + copy.getId()
  );
  return { fileId: copy.getId(), fileName: copy.getName() };
}
