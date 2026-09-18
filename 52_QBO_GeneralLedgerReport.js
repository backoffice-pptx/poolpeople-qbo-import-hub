/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 52_QBO_GeneralLedgerReport.js
 * Purpose     : Production, read-only extraction of the QBO General Ledger
 *               report for an explicit accounting date window.
 *
 * Public API:
 *   - provisionQboGeneralLedgerReportWorkbook()
 *   - bootstrapQboGeneralLedgerControl()
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
  CHANGES_SHEET: 'QBO_GeneralLedgerChanges',
  CONTROL_SHEET: '00_Control',
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

const QBO_GENERAL_LEDGER_CONTROL_HEADERS = Object.freeze([
  'Setting',
  'Value',
  'Description',
  'Last Updated'
]);

const QBO_GENERAL_LEDGER_CONTROL_DEFAULTS = Object.freeze([
  Object.freeze([
    'GL_BACKFILL_START_MONTH',
    '2018-01',
    'First month to process when a new General Ledger historical backfill is started.'
  ]),
  Object.freeze([
    'GL_BACKFILL_END_MONTH',
    '2021-12',
    'Last month to process when a new General Ledger historical backfill is started.'
  ])
]);



const QBO_GENERAL_LEDGER_CHANGE_MATCHER_VERSION = 'BUSINESS_MATCH_V2';
const QBO_GENERAL_LEDGER_CHANGE_CLASSIFIER_VERSION = 'BUSINESS_STATE_V1';

const QBO_GENERAL_LEDGER_CHANGE_HEADERS_V0513 = Object.freeze([
  'ComparisonId','ComparedAt','ReportStartDate','ReportEndDate',
  'PriorExtractRunId','CurrentExtractRunId','ChangeType','RowIdentity',
  'Depth','RowType','GroupLabel','GroupId','SectionSummaryLabel',
  'Date','TransactionType','TransactionId','Num','Name','NameId','MemoDescription','Split','SplitId',
  'ChangedFields','PriorRowHash','CurrentRowHash','PriorAmount','CurrentAmount','AmountDelta',
  'PriorBalance','CurrentBalance','PriorSnapshotRowNumber','CurrentSnapshotRowNumber',
  'PriorSnapshotFileId','CurrentSnapshotFileId'
]);

const QBO_GENERAL_LEDGER_CHANGE_HEADERS_V0514 = Object.freeze([
  'ComparisonId','MatcherVersion','ComparedAt','ReportStartDate','ReportEndDate',
  'PriorExtractRunId','CurrentExtractRunId','ChangeType','RowIdentity',
  'Depth','RowType','GroupLabel','GroupId','SectionSummaryLabel',
  'Date','TransactionType','TransactionId','Num','Name','NameId','MemoDescription','Split','SplitId',
  'ChangedFields','PriorRowHash','CurrentRowHash','PriorAmount','CurrentAmount','AmountDelta',
  'PriorBalance','CurrentBalance','PriorSnapshotRowNumber','CurrentSnapshotRowNumber',
  'PriorSnapshotFileId','CurrentSnapshotFileId'
]);

const QBO_GENERAL_LEDGER_CHANGE_HEADERS = Object.freeze([
  'ComparisonId','MatcherVersion','ClassifierVersion','ComparedAt','ReportStartDate','ReportEndDate',
  'PriorExtractRunId','CurrentExtractRunId','ChangeType','BusinessStateChanged','ChangeClass','RowIdentity',
  'Depth','RowType','GroupLabel','GroupId','SectionSummaryLabel',
  'Date','TransactionType','TransactionId','Num','Name','NameId','MemoDescription','Split','SplitId',
  'ChangedFields','BusinessChangedFields','PriorRowHash','CurrentRowHash',
  'PriorAmount','CurrentAmount','AmountDelta','BusinessAmountDelta',
  'PriorBalance','CurrentBalance','PriorSnapshotRowNumber','CurrentSnapshotRowNumber',
  'PriorSnapshotFileId','CurrentSnapshotFileId'
]);

const QBO_GENERAL_LEDGER_LEGACY_CHANGE_HEADERS_V0511 = Object.freeze([
  'ComparisonId','ComparedAt','ReportStartDate','ReportEndDate',
  'PriorExtractRunId','CurrentExtractRunId','ChangeType','RowIdentity',
  'PriorRowHash','CurrentRowHash','PriorAmount','CurrentAmount','AmountDelta',
  'PriorRowJSON','CurrentRowJSON'
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
 * Ensures the editable General Ledger control sheet exists and returns its
 * current settings. Existing control values are never overwritten.
 *
 * @return {Object} Current editable General Ledger control settings.
 */
function bootstrapQboGeneralLedgerControl() {
  const spreadsheet = getQboGeneralLedgerReportSpreadsheet_();
  ensureQboGeneralLedgerControlSheet_(spreadsheet);
  const settings = readQboGeneralLedgerControlSettings_();
  console.log('[GL CONTROL] | READY | ' + JSON.stringify(settings));
  return settings;
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
  const priorRun = findLatestQboGeneralLedgerRunForPeriod_(spreadsheet, startDate, endDate);
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

  let comparison = null;
  if (priorRun && priorRun.ExtractRunId) {
    comparison = compareQboGeneralLedgerRunSnapshots_(
      spreadsheet,
      priorRun,
      {
        ExtractRunId: runId,
        ReportStartDate: valueOrBlank_(header.StartPeriod) || startDate,
        ReportEndDate: valueOrBlank_(header.EndPeriod) || endDate,
        SnapshotFileId: snapshot.fileId
      },
      true
    );
  }

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
    historicalPeriodCount: storageResult.periodCount,
    priorExtractRunId: priorRun ? priorRun.ExtractRunId : '',
    comparison: comparison
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
  [
    QBO_GENERAL_LEDGER_REPORT.CONTROL_SHEET,
    QBO_GENERAL_LEDGER_REPORT.DATA_SHEET,
    QBO_GENERAL_LEDGER_REPORT.RUNS_SHEET,
    QBO_GENERAL_LEDGER_REPORT.CHANGES_SHEET
  ].forEach(function(sheetName) {
    if (!spreadsheet.getSheetByName(sheetName)) {
      spreadsheet.insertSheet(sheetName);
    }
  });

  ensureQboGeneralLedgerControlSheet_(spreadsheet);

  const defaultSheet = spreadsheet.getSheetByName('Sheet1');
  if (defaultSheet && spreadsheet.getSheets().length > 3 && defaultSheet.getLastRow() === 0) {
    spreadsheet.deleteSheet(defaultSheet);
  }
}

function ensureQboGeneralLedgerControlSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(QBO_GENERAL_LEDGER_REPORT.CONTROL_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(QBO_GENERAL_LEDGER_REPORT.CONTROL_SHEET);
  }

  const headers = QBO_GENERAL_LEDGER_CONTROL_HEADERS.slice();
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }

  const currentHeader = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  const headerMatches = headers.every(function(value, index) {
    return currentHeader[index] === value;
  });
  if (!headerMatches) {
    if (sheet.getLastRow() > 0 && currentHeader.some(function(value) { return value !== ''; })) {
      throw new Error(
        'Schema mismatch in General Ledger control sheet ' +
        QBO_GENERAL_LEDGER_REPORT.CONTROL_SHEET + '.'
      );
    }
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  const existing = {};
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length)
      .getDisplayValues()
      .forEach(function(row) {
        const key = String(row[0] || '').trim();
        if (key) existing[key] = true;
      });
  }

  const now = new Date();
  const rowsToAdd = QBO_GENERAL_LEDGER_CONTROL_DEFAULTS
    .filter(function(definition) { return !existing[definition[0]]; })
    .map(function(definition) {
      return [definition[0], definition[1], definition[2], now];
    });

  if (rowsToAdd.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAdd.length, headers.length)
      .setValues(rowsToAdd);
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.getRange(1, 1, Math.max(1, sheet.getLastRow()), headers.length).setWrap(false);
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 4, sheet.getLastRow() - 1, 1).setNumberFormat('m/d/yyyy');
  }
  sheet.autoResizeColumns(1, headers.length);
}

function readQboGeneralLedgerControlSettings_() {
  const spreadsheet = getQboGeneralLedgerReportSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(QBO_GENERAL_LEDGER_REPORT.CONTROL_SHEET);
  if (!sheet) {
    throw new Error(
      'Missing General Ledger control sheet. Run bootstrapQboGeneralLedgerControl() first.'
    );
  }

  const values = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues()
    : [];
  const settings = {};
  values.forEach(function(row) {
    const key = String(row[0] || '').trim();
    if (key) settings[key] = String(row[1] || '').trim();
  });
  return settings;
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
    // A period can contain multiple physical blocks when legacy display-format
    // identity failed to replace semantically identical Date/text values. Delete
    // every matching block bottom-up so row numbers remain stable.
    const frozenRows = sheet.getFrozenRows();
    const remainingNonFrozenRows = sheet.getMaxRows() - frozenRows - replacementRows;
    if (remainingNonFrozenRows < 1) {
      sheet.insertRowsAfter(sheet.getMaxRows(), 1 - remainingNonFrozenRows);
    }
    existing.blocks.slice().sort(function(a, b) { return b.startRow - a.startRow; })
      .forEach(function(block) {
        sheet.deleteRows(block.startRow, block.rowCount);
      });
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
    return { startRow: 0, rowCount: 0, blocks: [] };
  }

  // Period identity is semantic, not display-format dependent. getValues() may
  // return Date objects while older rows may contain ISO text; normalize both.
  const periodValues = sheet.getRange(2, 5, lastRow - 1, 2).getValues();
  const blocks = [];
  let blockStart = -1;
  let blockCount = 0;
  let total = 0;

  for (let i = 0; i < periodValues.length; i++) {
    const matches = qboGeneralLedgerDateText_(periodValues[i][0]) === startDate &&
      qboGeneralLedgerDateText_(periodValues[i][1]) === endDate;
    if (matches) {
      total++;
      if (blockStart < 0) {
        blockStart = i + 2;
        blockCount = 1;
      } else if (blockStart + blockCount === i + 2) {
        blockCount++;
      } else {
        blocks.push({ startRow: blockStart, rowCount: blockCount });
        blockStart = i + 2;
        blockCount = 1;
      }
    } else if (blockStart >= 0) {
      blocks.push({ startRow: blockStart, rowCount: blockCount });
      blockStart = -1;
      blockCount = 0;
    }
  }
  if (blockStart >= 0) blocks.push({ startRow: blockStart, rowCount: blockCount });

  return {
    startRow: blocks.length ? blocks[0].startRow : 0,
    rowCount: total,
    blocks: blocks
  };
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


function qboGeneralLedgerDateText_(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || 'America/Chicago', 'yyyy-MM-dd');
  }
  const text = String(value).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(text);
  return iso ? iso[1] + '-' + iso[2] + '-' + iso[3] : text;
}

function findLatestQboGeneralLedgerRunForPeriod_(spreadsheet, startDate, endDate) {
  const sheet = spreadsheet.getSheetByName(QBO_GENERAL_LEDGER_REPORT.RUNS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function(v) { return String(v || '').trim(); });
  const idx = {};
  QBO_GENERAL_LEDGER_RUN_HEADERS.forEach(function(h) { idx[h] = headers.indexOf(h); });
  for (let i = values.length - 1; i >= 1; i--) {
    const row = values[i];
    if (qboGeneralLedgerDateText_(row[idx.ReportStartDate]) === startDate &&
        qboGeneralLedgerDateText_(row[idx.ReportEndDate]) === endDate) {
      const out = {};
      QBO_GENERAL_LEDGER_RUN_HEADERS.forEach(function(h) { out[h] = row[idx[h]]; });
      return out;
    }
  }
  return null;
}

function qboGeneralLedgerSnapshotRows_(snapshotFileId, extractRunId, startDate, endDate) {
  const ss = SpreadsheetApp.openById(String(snapshotFileId || '').trim());
  const sheet = ss.getSheetByName(QBO_GENERAL_LEDGER_REPORT.DATA_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function(v) { return String(v || '').trim(); });
  const runIdx = headers.indexOf('ExtractRunId');
  const startIdx = headers.indexOf('ReportStartDate');
  const endIdx = headers.indexOf('ReportEndDate');
  if (runIdx < 0 || startIdx < 0 || endIdx < 0) throw new Error('GL snapshot schema is incomplete.');
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (String(row[runIdx] || '').trim() === String(extractRunId || '').trim() &&
        qboGeneralLedgerDateText_(row[startIdx]) === startDate &&
        qboGeneralLedgerDateText_(row[endIdx]) === endDate) {
      row.__snapshotRowNumber = i + 1;
      rows.push(row);
    }
  }
  return rows;
}

function qboGeneralLedgerStableValue_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || 'America/Chicago', "yyyy-MM-dd'T'HH:mm:ss.SSS");
  }
  return value === null || value === undefined ? '' : String(value);
}

function qboGeneralLedgerHash_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8)
    .map(function(b) { const v = b < 0 ? b + 256 : b; return ('0' + v.toString(16)).slice(-2); })
    .join('');
}

function qboGeneralLedgerRowIdentity_(row) {
  // Exclude run metadata and mutable financial/content values. The remaining
  // structural/business coordinates identify the logical report row.
  const positions = [6,7,8,9,10,13,14,15,16,17,18,20,21];
  return qboGeneralLedgerHash_(positions.map(function(i) {
    return qboGeneralLedgerStableValue_(row[i]);
  }).join('\u001f'));
}

function qboGeneralLedgerRowHash_(row) {
  // Ignore only run-specific metadata. Everything else participates in change detection.
  return qboGeneralLedgerHash_(row.slice(2).map(qboGeneralLedgerStableValue_).join('\u001f'));
}

function qboGeneralLedgerRowsByIdentity_(rows) {
  const groups = {};
  rows.forEach(function(row) {
    const key = qboGeneralLedgerRowIdentity_(row);
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  });
  return groups;
}

function qboGeneralLedgerBusinessFingerprint_(row) {
  // Match duplicate logical-row candidates on business content before considering
  // derived presentation state. Balance and raw/rendered JSON can move when QBO
  // changes row ordering even though the underlying posting is unchanged.
  const ignored = {
    ExtractRunId:true, ExtractedAt:true, ReportName:true, ReportBasis:true,
    Balance:true, ValuesJSON:true, RawRowJSON:true
  };
  const values = [];
  QBO_GENERAL_LEDGER_HEADERS.forEach(function(header, i) {
    if (!ignored[header]) values.push(qboGeneralLedgerStableValue_(row[i]));
  });
  return qboGeneralLedgerHash_(values.join('\u001f'));
}

function qboGeneralLedgerBusinessDifferenceScore_(before, after) {
  const ignored = {
    ExtractRunId:true, ExtractedAt:true, ReportName:true, ReportBasis:true,
    Balance:true, ValuesJSON:true, RawRowJSON:true
  };
  let changed = 0;
  QBO_GENERAL_LEDGER_HEADERS.forEach(function(header, i) {
    if (ignored[header]) return;
    if (qboGeneralLedgerStableValue_(before[i]) !== qboGeneralLedgerStableValue_(after[i])) changed++;
  });
  const a = before[22] === '' ? 0 : Number(before[22]);
  const b = after[22] === '' ? 0 : Number(after[22]);
  const amountDistance = Math.abs((isFinite(a) ? a : 0) - (isFinite(b) ? b : 0));
  return changed * 1000000000 + Math.round(amountDistance * 100);
}

function qboGeneralLedgerPairIdentityGroup_(priorRows, currentRows) {
  const prior = priorRows.map(function(row, i) { return { row:row, i:i, used:false }; });
  const current = currentRows.map(function(row, i) { return { row:row, i:i, used:false }; });
  const pairs = [];
  let exactBusinessMatches = 0;
  let residualPairs = 0;

  // Pass 1: exact business-content matches. This neutralizes row permutations
  // inside duplicate RowIdentity groups before any CHANGED pairing is attempted.
  const currentByFingerprint = {};
  current.forEach(function(item) {
    const fp = qboGeneralLedgerBusinessFingerprint_(item.row);
    if (!currentByFingerprint[fp]) currentByFingerprint[fp] = [];
    currentByFingerprint[fp].push(item);
  });
  prior.forEach(function(item) {
    const fp = qboGeneralLedgerBusinessFingerprint_(item.row);
    const candidates = currentByFingerprint[fp] || [];
    const match = candidates.find(function(x) { return !x.used; });
    if (match) {
      item.used = true; match.used = true;
      pairs.push({ before:item.row, after:match.row });
      exactBusinessMatches++;
    }
  });

  // Pass 2: globally choose the lowest business-difference candidate among the
  // remaining rows. Do not use sheet order as the primary pairing rule.
  while (true) {
    let best = null;
    prior.forEach(function(a) {
      if (a.used) return;
      current.forEach(function(b) {
        if (b.used) return;
        const score = qboGeneralLedgerBusinessDifferenceScore_(a.row, b.row);
        const tie = (a.row.__snapshotRowNumber || 0) * 1000000 + (b.row.__snapshotRowNumber || 0);
        if (!best || score < best.score || (score === best.score && tie < best.tie)) {
          best = { a:a, b:b, score:score, tie:tie };
        }
      });
    });
    if (!best) break;
    best.a.used = true; best.b.used = true;
    pairs.push({ before:best.a.row, after:best.b.row });
    residualPairs++;
  }

  prior.filter(function(x) { return !x.used; }).forEach(function(x) { pairs.push({ before:x.row, after:null }); });
  current.filter(function(x) { return !x.used; }).forEach(function(x) { pairs.push({ before:null, after:x.row }); });
  return { pairs:pairs, exactBusinessMatches:exactBusinessMatches, residualPairs:residualPairs };
}

function qboGeneralLedgerChangeContext_(before, after) {
  const row = after || before || [];
  return [
    row[6] || '', row[7] || '', row[8] || '', row[9] || '', row[10] || '',
    row[13] || '', row[14] || '', row[15] || '', row[16] || '', row[17] || '',
    row[18] || '', row[19] || '', row[20] || '', row[21] || ''
  ];
}

function qboGeneralLedgerChangedFields_(before, after) {
  if (!before || !after) return '';
  const ignored = { ExtractRunId:true, ExtractedAt:true, ReportName:true, ReportBasis:true };
  const changed = [];
  QBO_GENERAL_LEDGER_HEADERS.forEach(function(header, i) {
    if (ignored[header]) return;
    if (qboGeneralLedgerStableValue_(before[i]) !== qboGeneralLedgerStableValue_(after[i])) changed.push(header);
  });
  return changed.join('|');
}

function qboGeneralLedgerBusinessChangedFields_(before, after) {
  if (!before || !after) return '';
  const ignored = {
    ExtractRunId:true, ExtractedAt:true, ReportName:true, ReportBasis:true,
    Balance:true, ValuesJSON:true, RawRowJSON:true
  };
  const changed = [];
  QBO_GENERAL_LEDGER_HEADERS.forEach(function(header, i) {
    if (ignored[header]) return;
    if (qboGeneralLedgerStableValue_(before[i]) !== qboGeneralLedgerStableValue_(after[i])) changed.push(header);
  });
  return changed.join('|');
}

function qboGeneralLedgerClassifyChange_(before, after, changeType) {
  if (!before) return { businessStateChanged:true, changeClass:'BUSINESS_ROW_ADDED', businessChangedFields:'ROW_ADDED' };
  if (!after) return { businessStateChanged:true, changeClass:'BUSINESS_ROW_REMOVED', businessChangedFields:'ROW_REMOVED' };
  const businessChangedFields = qboGeneralLedgerBusinessChangedFields_(before, after);
  if (businessChangedFields) {
    return { businessStateChanged:true, changeClass:'BUSINESS_STATE_CHANGE', businessChangedFields:businessChangedFields };
  }
  if (changeType === 'UNCHANGED') {
    return { businessStateChanged:false, changeClass:'EXACT_UNCHANGED', businessChangedFields:'' };
  }
  return { businessStateChanged:false, changeClass:'DERIVED_OR_REPRESENTATIONAL_CHANGE', businessChangedFields:'' };
}

function qboGeneralLedgerHeadersMatch_(actual, expected) {
  return expected.every(function(header, i) { return String(actual[i] || '').trim() === header; });
}

function qboGeneralLedgerPrepareChangesSheet_(workbook) {
  let sheet = workbook.getSheetByName(QBO_GENERAL_LEDGER_REPORT.CHANGES_SHEET);
  if (!sheet) sheet = workbook.insertSheet(QBO_GENERAL_LEDGER_REPORT.CHANGES_SHEET);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1,1,1,QBO_GENERAL_LEDGER_CHANGE_HEADERS.length).setValues([QBO_GENERAL_LEDGER_CHANGE_HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  const width = Math.max(sheet.getLastColumn(), QBO_GENERAL_LEDGER_CHANGE_HEADERS.length, QBO_GENERAL_LEDGER_LEGACY_CHANGE_HEADERS_V0511.length);
  const actual = sheet.getRange(1,1,1,width).getDisplayValues()[0];
  if (qboGeneralLedgerHeadersMatch_(actual, QBO_GENERAL_LEDGER_CHANGE_HEADERS)) {
    sheet.setFrozenRows(1);
    return sheet;
  }
  if (qboGeneralLedgerHeadersMatch_(actual, QBO_GENERAL_LEDGER_CHANGE_HEADERS_V0514)) {
    const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Chicago', 'yyyyMMdd_HHmmss');
    const archivedName = 'QBO_GLChanges_Superseded_v0514_' + stamp;
    sheet.setName(archivedName);
    safeLog_('[GL REPORT] | CHANGE LEDGER MIGRATION | ARCHIVED PRE-CLASSIFIER | sheet=' + archivedName + ' | rows=' + sheet.getLastRow());
    sheet = workbook.insertSheet(QBO_GENERAL_LEDGER_REPORT.CHANGES_SHEET);
    sheet.getRange(1,1,1,QBO_GENERAL_LEDGER_CHANGE_HEADERS.length).setValues([QBO_GENERAL_LEDGER_CHANGE_HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  if (qboGeneralLedgerHeadersMatch_(actual, QBO_GENERAL_LEDGER_CHANGE_HEADERS_V0513)) {
    const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Chicago', 'yyyyMMdd_HHmmss');
    const archivedName = 'QBO_GLChanges_Superseded_v0513_' + stamp;
    sheet.setName(archivedName);
    safeLog_('[GL REPORT] | CHANGE LEDGER MIGRATION | ARCHIVED SUPERSEDED MATCHER | sheet=' + archivedName + ' | rows=' + sheet.getLastRow());
    sheet = workbook.insertSheet(QBO_GENERAL_LEDGER_REPORT.CHANGES_SHEET);
    sheet.getRange(1,1,1,QBO_GENERAL_LEDGER_CHANGE_HEADERS.length).setValues([QBO_GENERAL_LEDGER_CHANGE_HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  if (qboGeneralLedgerHeadersMatch_(actual, QBO_GENERAL_LEDGER_LEGACY_CHANGE_HEADERS_V0511)) {
    // v0.5.11 could partially populate rows before Sheets rejected an oversized JSON cell.
    // Preserve that interrupted artifact verbatim and create a clean governed ledger.
    const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Chicago', 'yyyyMMdd_HHmmss');
    const archivedName = 'QBO_GLChanges_Abandoned_v0511_' + stamp;
    sheet.setName(archivedName);
    safeLog_('[GL REPORT] | CHANGE LEDGER MIGRATION | ARCHIVED | sheet=' + archivedName + ' | rows=' + sheet.getLastRow());
    sheet = workbook.insertSheet(QBO_GENERAL_LEDGER_REPORT.CHANGES_SHEET);
    sheet.getRange(1,1,1,QBO_GENERAL_LEDGER_CHANGE_HEADERS.length).setValues([QBO_GENERAL_LEDGER_CHANGE_HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  if (sheet.getLastRow() === 1) {
    sheet.clear();
    sheet.getRange(1,1,1,QBO_GENERAL_LEDGER_CHANGE_HEADERS.length).setValues([QBO_GENERAL_LEDGER_CHANGE_HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  throw new Error('QBO_GeneralLedgerChanges has an unknown populated header contract; refusing automatic rewrite.');
}

function qboGeneralLedgerComparisonAlreadyPersisted_(sheet, comparisonId) {
  if (!sheet || sheet.getLastRow() < 2) return false;
  const ids = sheet.getRange(2,1,sheet.getLastRow()-1,1).getDisplayValues();
  return ids.some(function(row) { return String(row[0] || '').trim() === comparisonId; });
}

function compareQboGeneralLedgerRunSnapshots_(workbook, priorRun, currentRun, persist) {
  const startDate = qboGeneralLedgerDateText_(currentRun.ReportStartDate);
  const endDate = qboGeneralLedgerDateText_(currentRun.ReportEndDate);
  if (qboGeneralLedgerDateText_(priorRun.ReportStartDate) !== startDate ||
      qboGeneralLedgerDateText_(priorRun.ReportEndDate) !== endDate) {
    throw new Error('GL comparison requires runs for the same report period.');
  }
  const priorRows = qboGeneralLedgerSnapshotRows_(priorRun.SnapshotFileId, priorRun.ExtractRunId, startDate, endDate);
  const currentRows = qboGeneralLedgerSnapshotRows_(currentRun.SnapshotFileId, currentRun.ExtractRunId, startDate, endDate);
  const priorGroups = qboGeneralLedgerRowsByIdentity_(priorRows);
  const currentGroups = qboGeneralLedgerRowsByIdentity_(currentRows);
  const keys = {};
  Object.keys(priorGroups).forEach(function(k) { keys[k] = true; });
  Object.keys(currentGroups).forEach(function(k) { keys[k] = true; });
  const comparisonId = 'GLCMP_' + qboGeneralLedgerHash_(
    QBO_GENERAL_LEDGER_CHANGE_MATCHER_VERSION + '\u001f' + QBO_GENERAL_LEDGER_CHANGE_CLASSIFIER_VERSION + '\u001f' + String(priorRun.ExtractRunId || '') + '\u001f' + String(currentRun.ExtractRunId || '')
  ).slice(0,32);
  const comparedAt = new Date();
  const changes = [];
  const counts = { ADDED:0, REMOVED:0, CHANGED:0, UNCHANGED:0 };
  let netAmountDelta = 0;
  let businessAmountDelta = 0;
  let businessStateChangedCount = 0;
  let derivedOrRepresentationalChangeCount = 0;
  let exactBusinessMatches = 0;
  let residualPairs = 0;

  Object.keys(keys).sort().forEach(function(key) {
    const matched = qboGeneralLedgerPairIdentityGroup_(priorGroups[key] || [], currentGroups[key] || []);
    exactBusinessMatches += matched.exactBusinessMatches;
    residualPairs += matched.residualPairs;
    matched.pairs.forEach(function(pair) {
      const before = pair.before;
      const after = pair.after;
      const beforeHash = before ? qboGeneralLedgerRowHash_(before) : '';
      const afterHash = after ? qboGeneralLedgerRowHash_(after) : '';
      const type = !before ? 'ADDED' : !after ? 'REMOVED' : beforeHash === afterHash ? 'UNCHANGED' : 'CHANGED';
      counts[type]++;
      const priorAmount = before && before[22] !== '' ? Number(before[22]) : 0;
      const currentAmount = after && after[22] !== '' ? Number(after[22]) : 0;
      const delta = (isFinite(currentAmount) ? currentAmount : 0) - (isFinite(priorAmount) ? priorAmount : 0);
      netAmountDelta += delta;
      const classification = qboGeneralLedgerClassifyChange_(before, after, type);
      const businessDelta = classification.businessStateChanged ? delta : 0;
      businessAmountDelta += businessDelta;
      if (classification.businessStateChanged) businessStateChangedCount++;
      if (classification.changeClass === 'DERIVED_OR_REPRESENTATIONAL_CHANGE') derivedOrRepresentationalChangeCount++;
      const context = qboGeneralLedgerChangeContext_(before, after);
      changes.push([
        comparisonId, QBO_GENERAL_LEDGER_CHANGE_MATCHER_VERSION, QBO_GENERAL_LEDGER_CHANGE_CLASSIFIER_VERSION, comparedAt, startDate, endDate,
        priorRun.ExtractRunId, currentRun.ExtractRunId, type, classification.businessStateChanged, classification.changeClass, key
      ].concat(context).concat([
        qboGeneralLedgerChangedFields_(before, after), classification.businessChangedFields, beforeHash, afterHash,
        before ? before[22] : '', after ? after[22] : '', delta, businessDelta,
        before ? before[23] : '', after ? after[23] : '',
        before ? before.__snapshotRowNumber || '' : '', after ? after.__snapshotRowNumber || '' : '',
        before ? String(priorRun.SnapshotFileId || '') : '',
        after ? String(currentRun.SnapshotFileId || '') : ''
      ]));
    });
  });

  let persisted = false;
  let alreadyPersisted = false;
  if (persist) {
    const sheet = qboGeneralLedgerPrepareChangesSheet_(workbook);
    alreadyPersisted = qboGeneralLedgerComparisonAlreadyPersisted_(sheet, comparisonId);
    if (!alreadyPersisted && changes.length) {
      sheet.getRange(sheet.getLastRow()+1,1,changes.length,QBO_GENERAL_LEDGER_CHANGE_HEADERS.length).setValues(changes);
      sheet.getDataRange().setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
      persisted = true;
    }
  }

  const summary = {
    comparisonId: comparisonId,
    matcherVersion: QBO_GENERAL_LEDGER_CHANGE_MATCHER_VERSION,
    classifierVersion: QBO_GENERAL_LEDGER_CHANGE_CLASSIFIER_VERSION,
    exactBusinessMatches: exactBusinessMatches,
    residualPairs: residualPairs,
    priorExtractRunId: String(priorRun.ExtractRunId || ''),
    currentExtractRunId: String(currentRun.ExtractRunId || ''),
    priorSnapshotFileId: String(priorRun.SnapshotFileId || ''),
    currentSnapshotFileId: String(currentRun.SnapshotFileId || ''),
    priorRowCount: priorRows.length,
    currentRowCount: currentRows.length,
    added: counts.ADDED,
    removed: counts.REMOVED,
    changed: counts.CHANGED,
    unchanged: counts.UNCHANGED,
    netAmountDelta: Number(netAmountDelta.toFixed(2)),
    businessStateChanged: businessStateChangedCount,
    derivedOrRepresentationalChanges: derivedOrRepresentationalChangeCount,
    businessAmountDelta: Number(businessAmountDelta.toFixed(2)),
    persisted: persisted,
    alreadyPersisted: alreadyPersisted
  };
  safeLog_('[GL REPORT] | RUN COMPARISON | ' + JSON.stringify(summary));
  return summary;
}

function compareLatestTwoQboGeneralLedgerRunsForLatestPeriod() {
  const ss = getQboGeneralLedgerReportSpreadsheet_();
  const sheet = ss.getSheetByName(QBO_GENERAL_LEDGER_REPORT.RUNS_SHEET);
  if (!sheet || sheet.getLastRow() < 3) throw new Error('At least two GL run-history rows are required.');
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function(v) { return String(v || '').trim(); });
  const idx = {};
  QBO_GENERAL_LEDGER_RUN_HEADERS.forEach(function(h) { idx[h] = headers.indexOf(h); });
  function toRun(row) {
    const out = {};
    QBO_GENERAL_LEDGER_RUN_HEADERS.forEach(function(h) { out[h] = row[idx[h]]; });
    return out;
  }
  const current = toRun(values[values.length - 1]);
  const startDate = qboGeneralLedgerDateText_(current.ReportStartDate);
  const endDate = qboGeneralLedgerDateText_(current.ReportEndDate);
  let prior = null;
  for (let i = values.length - 2; i >= 1; i--) {
    const candidate = toRun(values[i]);
    if (qboGeneralLedgerDateText_(candidate.ReportStartDate) === startDate &&
        qboGeneralLedgerDateText_(candidate.ReportEndDate) === endDate) {
      prior = candidate;
      break;
    }
  }
  if (!prior) throw new Error('No prior GL run exists for latest period ' + startDate + '..' + endDate + '.');
  return compareQboGeneralLedgerRunSnapshots_(ss, prior, current, true);
}

function testQboGeneralLedgerRunComparisonEvidenceContract() {
  const headers = QBO_GENERAL_LEDGER_CHANGE_HEADERS;
  if (headers.indexOf('PriorRowJSON') >= 0 || headers.indexOf('CurrentRowJSON') >= 0) {
    throw new Error('GL comparison must not duplicate full row JSON into change-ledger cells.');
  }
  ['MatcherVersion','ClassifierVersion','BusinessStateChanged','ChangeClass','TransactionType','TransactionId','Num','Name','MemoDescription','Split','ChangedFields','BusinessChangedFields','BusinessAmountDelta'].forEach(function(h) {
    if (headers.indexOf(h) < 0) throw new Error('Missing human-auditable GL change context field ' + h + '.');
  });
  ['PriorSnapshotRowNumber','CurrentSnapshotRowNumber','PriorSnapshotFileId','CurrentSnapshotFileId'].forEach(function(h) {
    if (headers.indexOf(h) < 0) throw new Error('Missing exact GL change evidence locator ' + h + '.');
  });
  const id1 = 'GLCMP_' + qboGeneralLedgerHash_('A\u001fB').slice(0,32);
  const id2 = 'GLCMP_' + qboGeneralLedgerHash_('A\u001fB').slice(0,32);
  if (id1 !== id2) throw new Error('GL comparison identity must be deterministic for the same run pair.');
  if (!qboGeneralLedgerHeadersMatch_(QBO_GENERAL_LEDGER_LEGACY_CHANGE_HEADERS_V0511, QBO_GENERAL_LEDGER_LEGACY_CHANGE_HEADERS_V0511)) {
    throw new Error('Legacy v0.5.11 change-ledger contract must be recognizable for safe archival migration.');
  }
  const priorPermutation = [
    ['', '', '', '', '', '', 0,'Data','Accounts Receivable','122','', '', '', new Date(2026,7,1),'Payment','P1','', 'Test','N1','', 'Accounts Receivable','122',3.59,-10,'',''],
    ['', '', '', '', '', '', 0,'Data','Accounts Receivable','122','', '', '', new Date(2026,7,1),'Payment','P1','', 'Test','N1','', 'Accounts Receivable','122',22.44,-20,'','']
  ];
  const currentPermutation = [priorPermutation[1].slice(), priorPermutation[0].slice()];
  currentPermutation[0][23] = -30; currentPermutation[1][23] = -40;
  const paired = qboGeneralLedgerPairIdentityGroup_(priorPermutation, currentPermutation);
  if (paired.exactBusinessMatches !== 2) throw new Error('Permutation matching test failed: expected 2 exact business matches.');
  const pairedAmounts = paired.pairs.map(function(p) { return String(p.before[22]) + '>' + String(p.after[22]); }).sort();
  if (pairedAmounts.join('|') !== '22.44>22.44|3.59>3.59') throw new Error('Permutation matching paired different amount rows.');
  if (qboGeneralLedgerBusinessFingerprint_(priorPermutation[0]) !== qboGeneralLedgerBusinessFingerprint_(currentPermutation[1])) throw new Error('Business fingerprint should ignore Balance/raw presentation changes.');
  const derivedBefore = priorPermutation[0].slice();
  const derivedAfter = priorPermutation[0].slice(); derivedAfter[23] = -999; derivedAfter[24] = 'rendered-change'; derivedAfter[25] = 'raw-change';
  const derivedClass = qboGeneralLedgerClassifyChange_(derivedBefore, derivedAfter, 'CHANGED');
  if (derivedClass.businessStateChanged !== false || derivedClass.changeClass !== 'DERIVED_OR_REPRESENTATIONAL_CHANGE') throw new Error('Balance/raw-only change must not be classified as business-state change.');
  const businessAfter = priorPermutation[0].slice(); businessAfter[22] = 4.59;
  const businessClass = qboGeneralLedgerClassifyChange_(priorPermutation[0], businessAfter, 'CHANGED');
  if (businessClass.businessStateChanged !== true || businessClass.businessChangedFields.indexOf('Amount') < 0) throw new Error('Amount change must be classified as business-state change.');
  const addedClass = qboGeneralLedgerClassifyChange_(null, priorPermutation[0], 'ADDED');
  if (!addedClass.businessStateChanged || addedClass.changeClass !== 'BUSINESS_ROW_ADDED') throw new Error('Added row must be classified as business evidence change.');
  const removedClass = qboGeneralLedgerClassifyChange_(priorPermutation[0], null, 'REMOVED');
  if (!removedClass.businessStateChanged || removedClass.changeClass !== 'BUSINESS_ROW_REMOVED') throw new Error('Removed row must be classified as business evidence change.');
  const exactClass = qboGeneralLedgerClassifyChange_(priorPermutation[0], priorPermutation[0].slice(), 'UNCHANGED');
  if (exactClass.businessStateChanged || exactClass.changeClass !== 'EXACT_UNCHANGED') throw new Error('Exact unchanged row classification failed.');
  const result = { Suite:'GeneralLedgerRunComparisonEvidenceContract', checkCount:12, passed:true };
  safeLog_('[GL REPORT] | TEST | ' + JSON.stringify(result));
  return result;
}

function testQboGeneralLedgerPeriodIdentityNormalization() {
  const d = new Date(2026, 7, 1);
  if (qboGeneralLedgerDateText_(d) !== '2026-08-01') throw new Error('Date normalization failed.');
  if (qboGeneralLedgerDateText_('2026-08-01') !== '2026-08-01') throw new Error('ISO normalization failed.');
  const result = { Suite:'GeneralLedgerPeriodIdentityNormalization', checkCount:2, passed:true };
  safeLog_('[GL REPORT] | TEST | ' + JSON.stringify(result));
  return result;
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
