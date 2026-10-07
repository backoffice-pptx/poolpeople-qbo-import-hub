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
  'SnapshotFileName',
  'SnapshotArtifactContract'
]);

const QBO_GENERAL_LEDGER_SNAPSHOT_ARTIFACT_CONTRACT_V2 = 'GL_RUN_SNAPSHOT_V2';
const QBO_GENERAL_LEDGER_LEGACY_ARTIFACT_CONTRACT_V1 = 'LEGACY_FULL_STORE_CONTAINER_V1';
const QBO_GENERAL_LEDGER_SNAPSHOT_METADATA_SHEET = '00_Metadata';
const QBO_GENERAL_LEDGER_SNAPSHOT_METADATA_HEADERS = Object.freeze(['Field','Value']);

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
  ensureQboGeneralLedgerRunRegistrySchemaV2_(spreadsheet);
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
        endDate,
        extractedAt
      );
      snapshot = createQboGeneralLedgerRunSnapshotV2_(
        rows,
        runId,
        startDate,
        endDate,
        extractedAt
      );
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
    snapshot.fileName,
    snapshot.artifactContract
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
        SnapshotFileId: snapshot.fileId,
        SnapshotArtifactContract: snapshot.artifactContract
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
    snapshotArtifactContract: snapshot.artifactContract,
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
  ensureQboGeneralLedgerRunRegistrySchemaV2_(spreadsheet);

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
  ensureQboGeneralLedgerRunRegistrySchemaV2_(spreadsheet);
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
  ensureQboGeneralLedgerRunRegistrySchemaV2_(spreadsheet);
  const sheet = spreadsheet.getSheetByName(QBO_GENERAL_LEDGER_REPORT.RUNS_SHEET);
  if (row.length !== QBO_GENERAL_LEDGER_RUN_HEADERS.length) {
    throw new Error('GL_RUN_REGISTRY_ROW_WIDTH_INVALID: expected=' + QBO_GENERAL_LEDGER_RUN_HEADERS.length + ' actual=' + row.length);
  }
  if (!(row[1] instanceof Date) || isNaN(row[1].getTime())) {
    throw new Error('GL_RUN_REGISTRY_EXTRACTED_AT_INVALID');
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, QBO_GENERAL_LEDGER_RUN_HEADERS.length)
      .setValues([QBO_GENERAL_LEDGER_RUN_HEADERS.slice()])
      .setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  const targetRow = sheet.getLastRow() + 1;
  const extractedAt = new Date(row[1].getTime());
  const writeRow = row.slice();
  writeRow[1] = extractedAt; // persist provenance atomically with the registry row
  sheet.getRange(targetRow, 1, 1, writeRow.length).setValues([writeRow]);
  const extractedAtCell = sheet.getRange(targetRow, 2);
  extractedAtCell.setNumberFormat('yyyy-mm-dd hh:mm:ss');
  SpreadsheetApp.flush();
  const storedExtractedAt = extractedAtCell.getValue();
  if (!qboGeneralLedgerTimestampsMatchToSecond_(storedExtractedAt, extractedAt)) {
    throw new Error('GL_RUN_REGISTRY_EXTRACTED_AT_WRITE_MISMATCH: run=' + String(row[0] || ''));
  }
  return { registryRow: targetRow, extractedAt: storedExtractedAt };
}

function qboGeneralLedgerTimestampsMatchToSecond_(left, right) {
  if (!(left instanceof Date) || isNaN(left.getTime())) return false;
  if (!(right instanceof Date) || isNaN(right.getTime())) return false;
  return Math.floor(left.getTime() / 1000) === Math.floor(right.getTime() / 1000);
}

function findQboGeneralLedgerRunById_(spreadsheet, extractRunId) {
  ensureQboGeneralLedgerRunRegistrySchemaV2_(spreadsheet);
  const sheet = spreadsheet.getSheetByName(QBO_GENERAL_LEDGER_REPORT.RUNS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function(v) { return String(v || '').trim(); });
  const idx = {};
  QBO_GENERAL_LEDGER_RUN_HEADERS.forEach(function(h) { idx[h] = headers.indexOf(h); });
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idx.ExtractRunId] || '').trim() === String(extractRunId || '').trim()) {
      const out = {};
      QBO_GENERAL_LEDGER_RUN_HEADERS.forEach(function(h) { out[h] = values[i][idx[h]]; });
      out.__RegistryRow = i + 1;
      return out;
    }
  }
  return null;
}

function findPriorQboGeneralLedgerRunForRun_(spreadsheet, currentRun) {
  const sheet = spreadsheet.getSheetByName(QBO_GENERAL_LEDGER_REPORT.RUNS_SHEET);
  if (!sheet || sheet.getLastRow() < 3) return null;
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function(v) { return String(v || '').trim(); });
  const idx = {};
  QBO_GENERAL_LEDGER_RUN_HEADERS.forEach(function(h) { idx[h] = headers.indexOf(h); });
  const currentRow = Number(currentRun && currentRun.__RegistryRow || 0);
  const startDate = qboGeneralLedgerDateText_(currentRun && currentRun.ReportStartDate);
  const endDate = qboGeneralLedgerDateText_(currentRun && currentRun.ReportEndDate);
  for (let i = (currentRow ? currentRow - 2 : values.length - 1); i >= 1; i--) {
    const row = values[i];
    if (qboGeneralLedgerDateText_(row[idx.ReportStartDate]) === startDate &&
        qboGeneralLedgerDateText_(row[idx.ReportEndDate]) === endDate) {
      const out = {};
      QBO_GENERAL_LEDGER_RUN_HEADERS.forEach(function(h) { out[h] = row[idx[h]]; });
      out.__RegistryRow = i + 1;
      return out;
    }
  }
  return null;
}


function ensureQboGeneralLedgerRunRegistrySchemaV2_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(QBO_GENERAL_LEDGER_REPORT.RUNS_SHEET);
  if (!sheet) throw new Error('GL_RUN_REGISTRY_SHEET_MISSING');
  const target = QBO_GENERAL_LEDGER_RUN_HEADERS.slice();
  const legacy = target.slice(0, target.length - 1);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, target.length).setValues([target]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    return { status:'INITIALIZED', addedColumns:1 };
  }
  const width = Math.max(sheet.getLastColumn(), legacy.length);
  const actual = sheet.getRange(1, 1, 1, width).getDisplayValues()[0].map(function(v) { return String(v || '').trim(); });
  const current = actual.slice(0, target.length);
  const currentMatches = target.every(function(h, i) { return current[i] === h; });
  if (currentMatches) return { status:'CURRENT', addedColumns:0 };
  const legacyMatches = legacy.every(function(h, i) { return actual[i] === h; }) &&
    actual.slice(legacy.length).every(function(v) { return v === ''; });
  if (!legacyMatches) throw new Error('GL_RUN_REGISTRY_SCHEMA_MISMATCH');
  if (sheet.getMaxColumns() < target.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), target.length - sheet.getMaxColumns());
  sheet.getRange(1, target.length).setValue(target[target.length - 1]).setFontWeight('bold');
  return { status:'MIGRATED_APPEND_ONLY', addedColumns:1 };
}

function createQboGeneralLedgerRunSnapshotV2_(rows, runId, startDate, endDate, extractedAt) {
  // GL run artifacts have a separate route from full-master backups.
  const folderId = qboGlRunSnapshotFoldersV05136_().runFolder.getId();
  if (!Array.isArray(rows)) throw new Error('GL_RUN_SNAPSHOT_V2_ROWS_REQUIRED');
  if (!(extractedAt instanceof Date) || isNaN(extractedAt.getTime())) throw new Error('GL_RUN_SNAPSHOT_V2_EXTRACTED_AT_REQUIRED');
  rows.forEach(function(row, i) {
    if (String(row[0] || '').trim() !== String(runId || '').trim()) throw new Error('GL_RUN_SNAPSHOT_V2_RUN_ID_MISMATCH: row=' + (i + 2));
    if (qboGeneralLedgerDateText_(row[4]) !== startDate || qboGeneralLedgerDateText_(row[5]) !== endDate) {
      throw new Error('GL_RUN_SNAPSHOT_V2_PERIOD_MISMATCH: row=' + (i + 2));
    }
  });
  const folder = DriveApp.getFolderById(folderId);
  const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Chicago', EXPORT_SNAPSHOT.TIMESTAMP_FORMAT);
  const shortRun = String(runId || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
  const fileName = 'QBO_GL_RUN_SNAPSHOT_V2_' + startDate + '_to_' + endDate + '_' + shortRun + '_' + timestamp;
  const snapshot = SpreadsheetApp.create(fileName, Math.max(rows.length + 1, 2), QBO_GENERAL_LEDGER_HEADERS.length);
  const file = DriveApp.getFileById(snapshot.getId());
  file.moveTo(folder);
  try {
    const sheet = snapshot.getSheets()[0];
    sheet.setName(QBO_GENERAL_LEDGER_REPORT.DATA_SHEET);
    sheet.getRange(1, 1, 1, QBO_GENERAL_LEDGER_HEADERS.length).setValues([QBO_GENERAL_LEDGER_HEADERS.slice()]);
    if (rows.length) sheet.getRange(2, 1, rows.length, QBO_GENERAL_LEDGER_HEADERS.length).setValues(rows);
    formatExportHeader_(sheet, QBO_GENERAL_LEDGER_HEADERS.slice(), 1);
    if (rows.length) applyQboGeneralLedgerPeriodFormats_(sheet, 2, rows.length);
    sheet.setFrozenRows(1);
    const metadata = snapshot.insertSheet(QBO_GENERAL_LEDGER_SNAPSHOT_METADATA_SHEET, 0);
    const metadataRows = [
      ['ArtifactContract', QBO_GENERAL_LEDGER_SNAPSHOT_ARTIFACT_CONTRACT_V2],
      ['ExtractRunId', String(runId || '')],
      ['ExtractedAt', new Date(extractedAt.getTime())],
      ['ReportName', 'GeneralLedger'],
      ['ReportBasis', rows.length ? valueOrBlank_(rows[0][3]) : 'Cash'],
      ['ReportStartDate', startDate],
      ['ReportEndDate', endDate],
      ['RowCount', rows.length]
    ];
    metadata.getRange(1, 1, 1, 2).setValues([QBO_GENERAL_LEDGER_SNAPSHOT_METADATA_HEADERS.slice()]).setFontWeight('bold');
    metadata.getRange(2, 1, metadataRows.length, 2).setValues(metadataRows);
    metadata.getRange(4, 2).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    metadata.setFrozenRows(1);
    SpreadsheetApp.flush();
    validateQboGeneralLedgerRunSnapshotV2_(snapshot.getId(), runId, startDate, endDate, rows.length, extractedAt);
  } catch (error) {
    try { file.setTrashed(true); } catch (cleanupError) {}
    throw error;
  }
  safeLog_('[GL REPORT] | RUN SNAPSHOT V2 | COMPLETE | contract=' + QBO_GENERAL_LEDGER_SNAPSHOT_ARTIFACT_CONTRACT_V2 + ' | run=' + runId + ' | rows=' + rows.length + ' | file=' + fileName + ' | id=' + snapshot.getId());
  return { fileId:snapshot.getId(), fileName:fileName, artifactContract:QBO_GENERAL_LEDGER_SNAPSHOT_ARTIFACT_CONTRACT_V2 };
}

function validateQboGeneralLedgerRunSnapshotV2_(snapshotFileId, runId, startDate, endDate, expectedRowCount, expectedExtractedAt) {
  const ss = SpreadsheetApp.openById(String(snapshotFileId || '').trim());
  const sheet = ss.getSheetByName(QBO_GENERAL_LEDGER_REPORT.DATA_SHEET);
  if (!sheet) throw new Error('GL_RUN_SNAPSHOT_V2_DATA_SHEET_MISSING');
  const lastColumn = sheet.getLastColumn();
  if (lastColumn !== QBO_GENERAL_LEDGER_HEADERS.length) throw new Error('GL_RUN_SNAPSHOT_V2_COLUMN_COUNT_MISMATCH');
  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].map(function(v) { return String(v || '').trim(); });
  if (!QBO_GENERAL_LEDGER_HEADERS.every(function(h, i) { return headers[i] === h; })) throw new Error('GL_RUN_SNAPSHOT_V2_HEADER_MISMATCH');
  const actualRows = Math.max(0, sheet.getLastRow() - 1);
  if (actualRows !== expectedRowCount) throw new Error('GL_RUN_SNAPSHOT_V2_ROW_COUNT_MISMATCH: expected=' + expectedRowCount + ' actual=' + actualRows);
  const rows = qboGeneralLedgerSnapshotRows_(snapshotFileId, runId, startDate, endDate);
  if (rows.length !== expectedRowCount) throw new Error('GL_RUN_SNAPSHOT_V2_IDENTITY_FILTER_MISMATCH: expected=' + expectedRowCount + ' actual=' + rows.length);

  const metadata = ss.getSheetByName(QBO_GENERAL_LEDGER_SNAPSHOT_METADATA_SHEET);
  if (expectedExtractedAt) {
    if (!metadata) throw new Error('GL_RUN_SNAPSHOT_V2_METADATA_SHEET_MISSING');
    const metaValues = metadata.getDataRange().getValues();
    const meta = {};
    for (let i = 1; i < metaValues.length; i++) meta[String(metaValues[i][0] || '').trim()] = metaValues[i][1];
    if (String(meta.ArtifactContract || '') !== QBO_GENERAL_LEDGER_SNAPSHOT_ARTIFACT_CONTRACT_V2) throw new Error('GL_RUN_SNAPSHOT_V2_METADATA_CONTRACT_MISMATCH');
    if (String(meta.ExtractRunId || '') !== String(runId || '')) throw new Error('GL_RUN_SNAPSHOT_V2_METADATA_RUN_ID_MISMATCH');
    if (!qboGeneralLedgerTimestampsMatchToSecond_(meta.ExtractedAt, expectedExtractedAt)) throw new Error('GL_RUN_SNAPSHOT_V2_METADATA_EXTRACTED_AT_MISMATCH');
    if (qboGeneralLedgerDateText_(meta.ReportStartDate) !== startDate || qboGeneralLedgerDateText_(meta.ReportEndDate) !== endDate) throw new Error('GL_RUN_SNAPSHOT_V2_METADATA_PERIOD_MISMATCH');
    if (Number(meta.RowCount) !== Number(expectedRowCount)) throw new Error('GL_RUN_SNAPSHOT_V2_METADATA_ROW_COUNT_MISMATCH');
  }
  return { valid:true, rowCount:rows.length, artifactContract:QBO_GENERAL_LEDGER_SNAPSHOT_ARTIFACT_CONTRACT_V2, metadataValidated:!!expectedExtractedAt };
}

function qboGeneralLedgerArtifactContractForRun_(run) {
  const explicit = String(run && run.SnapshotArtifactContract || '').trim();
  return explicit || QBO_GENERAL_LEDGER_LEGACY_ARTIFACT_CONTRACT_V1;
}

function testQboGeneralLedgerRunSnapshotV1218Contract() {
  const checks = [];
  function check(name, passed) { checks.push({name:name, passed:!!passed}); if (!passed) throw new Error('GL_RUN_SNAPSHOT_V2_CONTRACT_FAIL: ' + name); }
  check('V2 artifact contract is explicit', QBO_GENERAL_LEDGER_SNAPSHOT_ARTIFACT_CONTRACT_V2 === 'GL_RUN_SNAPSHOT_V2');
  check('legacy blank discriminator remains grandfathered', qboGeneralLedgerArtifactContractForRun_({SnapshotArtifactContract:''}) === 'LEGACY_FULL_STORE_CONTAINER_V1');
  check('run registry appends artifact discriminator', QBO_GENERAL_LEDGER_RUN_HEADERS[QBO_GENERAL_LEDGER_RUN_HEADERS.length - 1] === 'SnapshotArtifactContract');
  check('snapshot creator accepts exact run rows', /createQboGeneralLedgerRunSnapshotV2_/.test(exportQboGeneralLedgerForPeriod.toString()));
  check('legacy full-workbook snapshot creator is retired from export path', !/createQboGeneralLedgerSnapshot_/.test(exportQboGeneralLedgerForPeriod.toString()));
  check('snapshot validation checks exact row count', /ROW_COUNT_MISMATCH/.test(validateQboGeneralLedgerRunSnapshotV2_.toString()));
  check('snapshot validation checks exact header', /HEADER_MISMATCH/.test(validateQboGeneralLedgerRunSnapshotV2_.toString()));
  check('snapshot validation checks exact identity filter', /IDENTITY_FILTER_MISMATCH/.test(validateQboGeneralLedgerRunSnapshotV2_.toString()));
  check('comparison reader remains container compatible', /ExtractRunId/.test(qboGeneralLedgerSnapshotRows_.toString()) && /ReportStartDate/.test(qboGeneralLedgerSnapshotRows_.toString()));
  check('registry migration is append-only', /MIGRATED_APPEND_ONLY/.test(ensureQboGeneralLedgerRunRegistrySchemaV2_.toString()));
  check('registry timestamp comparison is normalized to whole-second precision', qboGeneralLedgerTimestampsMatchToSecond_(new Date(1760000000123), new Date(1760000000999)));
  check('registry timestamp comparison rejects a different second', !qboGeneralLedgerTimestampsMatchToSecond_(new Date(1760000000123), new Date(1760000001123)));
  check('failed v1.5.217 run has explicit recovery fixture', typeof recoverQboGeneralLedgerRunSnapshotV1218Failed217For2609 === 'function');
  const result = {Version:'1.5.218', Status:'PASS', Test_Count:checks.length, Passed:checks.filter(function(c){return c.passed;}).length, Checks:checks};
  safeLog_('[GL REPORT] | V1.5.218 CONTRACT | ' + JSON.stringify(result));
  return result;
}



/** One-time recovery/diagnostic for the interrupted v1.5.217 September validation run. */
function recoverQboGeneralLedgerRunSnapshotV1218Failed217For2609() {
  const failedRunId = '8e6119f0-969c-4b03-8bde-b78a12df850d';
  const failedSnapshotFileId = '1iaznRyRnDUfrpAL_ztpa_OgqZ5mjTfKEaIHWvLg1Ydo';
  const startDate = '2026-09-01';
  const endDate = '2026-09-30';
  const expectedRowCount = 2215;
  const ss = getQboGeneralLedgerReportSpreadsheet_();
  const run = findQboGeneralLedgerRunById_(ss, failedRunId);
  if (!run) throw new Error('GL_V1217_FAILED_RUN_REGISTRY_ROW_MISSING: run=' + failedRunId);
  if (String(run.SnapshotFileId || '').trim() !== failedSnapshotFileId) throw new Error('GL_V1217_FAILED_RUN_SNAPSHOT_ID_MISMATCH');
  if (qboGeneralLedgerArtifactContractForRun_(run) !== QBO_GENERAL_LEDGER_SNAPSHOT_ARTIFACT_CONTRACT_V2) throw new Error('GL_V1217_FAILED_RUN_ARTIFACT_CONTRACT_MISMATCH');
  if (qboGeneralLedgerDateText_(run.ReportStartDate) !== startDate || qboGeneralLedgerDateText_(run.ReportEndDate) !== endDate) throw new Error('GL_V1217_FAILED_RUN_PERIOD_MISMATCH');
  if (Number(run.RowCount) !== expectedRowCount) throw new Error('GL_V1217_FAILED_RUN_ROW_COUNT_MISMATCH');
  const validation = validateQboGeneralLedgerRunSnapshotV2_(failedSnapshotFileId, failedRunId, startDate, endDate, expectedRowCount);
  const prior = findPriorQboGeneralLedgerRunForRun_(ss, run);
  if (!prior) throw new Error('GL_V1217_FAILED_RUN_PRIOR_RUN_MISSING');
  const comparison = compareQboGeneralLedgerRunSnapshots_(ss, prior, run, true);
  const out = {
    Version:'1.5.218', Status:'RECOVERED', Period_Key:'2609', ExtractRunId:failedRunId,
    RegistryRow:run.__RegistryRow, SnapshotFileId:failedSnapshotFileId,
    SnapshotArtifactContract:qboGeneralLedgerArtifactContractForRun_(run),
    RowCount:Number(run.RowCount), SnapshotValidated:validation.valid, SnapshotRowCount:validation.rowCount,
    PriorExtractRunId:String(prior.ExtractRunId || ''),
    PriorSnapshotArtifactContract:qboGeneralLedgerArtifactContractForRun_(prior),
    Comparison:comparison, Writes_Performed:'COMPARISON_ONLY'
  };
  safeLog_('[GL REPORT] | V1.5.218 V1.5.217 FAILED-RUN RECOVERY | ' + JSON.stringify(out));
  return out;
}

/** One-time regression fixture for Step 6B runtime validation. */
function validateQboGeneralLedgerRunSnapshotV1218For2609() {
  const result = exportQboGeneralLedgerForPeriod('2026-09-01', '2026-09-30');
  const validation = validateQboGeneralLedgerRunSnapshotV2_(result.snapshotFileId, result.extractRunId, result.startDate, result.endDate, result.rowCount);
  const ss = getQboGeneralLedgerReportSpreadsheet_();
  const run = findLatestQboGeneralLedgerRunForPeriod_(ss, '2026-09-01', '2026-09-30');
  const out = {
    Version:'1.5.218', Status:'SUCCESS', Period_Key:'2609', ExtractRunId:result.extractRunId,
    SnapshotFileId:result.snapshotFileId, SnapshotFileName:result.snapshotFileName,
    SnapshotArtifactContract:qboGeneralLedgerArtifactContractForRun_(run), RowCount:result.rowCount,
    SnapshotValidated:validation.valid, SnapshotRowCount:validation.rowCount,
    PriorExtractRunId:result.priorExtractRunId, Comparison:result.comparison
  };
  safeLog_('[GL REPORT] | V1.5.218 RUNTIME VALIDATION | ' + JSON.stringify(out));
  return out;
}


/** v1.5.220 zero-argument contract test. */
function testQboGeneralLedgerRunSnapshotV1220Contract() {
  const checks = [];
  function check(name, passed) { checks.push({name:name, passed:!!passed}); }
  const appendSrc = appendQboGeneralLedgerRun_.toString();
  const snapshotSrc = createQboGeneralLedgerRunSnapshotV2_.toString();
  const recoverySrc = recoverQboGeneralLedgerExtractedAtV1220Failed217For2609.toString();
  check('V2 artifact contract remains explicit', QBO_GENERAL_LEDGER_SNAPSHOT_ARTIFACT_CONTRACT_V2 === 'GL_RUN_SNAPSHOT_V2');
  check('registry writer isolates ExtractedAt write', /writeRow\[1\] = ''/.test(appendSrc) && /extractedAtCell\.setValue/.test(appendSrc));
  check('registry writer formats ExtractedAt as timestamp', /yyyy-mm-dd hh:mm:ss/.test(appendSrc));
  check('registry writer flushes before verification', /SpreadsheetApp\.flush/.test(appendSrc));
  check('registry writer verifies semantic timestamp', /qboGeneralLedgerTimestampsMatchToSecond_/.test(appendSrc));
  check('V2 snapshot contains metadata sheet', /QBO_GENERAL_LEDGER_SNAPSHOT_METADATA_SHEET/.test(snapshotSrc));
  check('V2 metadata includes ExtractRunId', /ExtractRunId/.test(snapshotSrc));
  check('V2 metadata includes ExtractedAt', /ExtractedAt/.test(snapshotSrc));
  check('V2 metadata includes period and row count', /ReportStartDate/.test(snapshotSrc) && /ReportEndDate/.test(snapshotSrc) && /RowCount/.test(snapshotSrc));
  check('recovery is fixed to interrupted run', /8e6119f0-969c-4b03-8bde-b78a12df850d/.test(recoverySrc));
  check('recovery requires all run rows', /2215/.test(recoverySrc));
  check('recovery writes only registry ExtractedAt cell', /getRange\(registryRow, 2\)/.test(recoverySrc));
  const passed = checks.filter(function(c){return c.passed;}).length;
  const result = {Version:'1.5.220', Status:passed===checks.length?'PASS':'FAIL', Test_Count:checks.length, Passed:passed, Checks:checks};
  safeLog_('[GL REPORT] | V1.5.220 CONTRACT | ' + JSON.stringify(result));
  if (passed !== checks.length) throw new Error('GL_V1_5_220_CONTRACT_FAILED');
  return result;
}

/** Controlled recovery of the v1.5.217 interrupted registry timestamp. */
function recoverQboGeneralLedgerExtractedAtV1220Failed217For2609() {
  const runId = '8e6119f0-969c-4b03-8bde-b78a12df850d';
  const expectedRows = 2215;
  const spreadsheet = getQboGeneralLedgerReportSpreadsheet_();
  const run = findQboGeneralLedgerRunById_(spreadsheet, runId);
  if (!run) throw new Error('GL_V1220_RECOVERY_RUN_NOT_FOUND');
  const registryRow = Number(run.__RegistryRow || 0);
  if (!registryRow) throw new Error('GL_V1220_RECOVERY_REGISTRY_ROW_MISSING');
  if (run.ExtractedAt instanceof Date && !isNaN(run.ExtractedAt.getTime())) {
    throw new Error('GL_V1220_RECOVERY_REFUSED_ALREADY_HAS_EXTRACTED_AT');
  }
  if (String(run.SnapshotArtifactContract || '') !== QBO_GENERAL_LEDGER_SNAPSHOT_ARTIFACT_CONTRACT_V2) throw new Error('GL_V1220_RECOVERY_ARTIFACT_CONTRACT_MISMATCH');
  if (qboGeneralLedgerDateText_(run.ReportStartDate) !== '2026-09-01' || qboGeneralLedgerDateText_(run.ReportEndDate) !== '2026-09-30') throw new Error('GL_V1220_RECOVERY_PERIOD_MISMATCH');
  if (Number(run.RowCount) !== expectedRows) throw new Error('GL_V1220_RECOVERY_REGISTRY_ROW_COUNT_MISMATCH');

  const data = spreadsheet.getSheetByName(QBO_GENERAL_LEDGER_REPORT.DATA_SHEET);
  const values = data.getDataRange().getValues();
  const matching = [];
  for (let i = 1; i < values.length; i++) if (String(values[i][0] || '').trim() === runId) matching.push(values[i]);
  if (matching.length !== expectedRows) throw new Error('GL_V1220_RECOVERY_DATA_ROW_COUNT_MISMATCH: expected=' + expectedRows + ' actual=' + matching.length);
  let recoveredMs = null;
  for (let i = 0; i < matching.length; i++) {
    const value = matching[i][1];
    if (!(value instanceof Date) || isNaN(value.getTime())) throw new Error('GL_V1220_RECOVERY_DATA_EXTRACTED_AT_INVALID: row=' + (i + 1));
    if (recoveredMs === null) recoveredMs = value.getTime();
    if (value.getTime() !== recoveredMs) throw new Error('GL_V1220_RECOVERY_MULTIPLE_EXTRACTED_AT_VALUES');
  }
  const recovered = new Date(recoveredMs);
  const runSheet = spreadsheet.getSheetByName(QBO_GENERAL_LEDGER_REPORT.RUNS_SHEET);
  const cell = runSheet.getRange(registryRow, 2);
  cell.setNumberFormat('yyyy-mm-dd hh:mm:ss');
  cell.setValue(recovered);
  SpreadsheetApp.flush();
  const stored = cell.getValue();
  if (!qboGeneralLedgerTimestampsMatchToSecond_(stored, recovered)) throw new Error('GL_V1220_RECOVERY_WRITE_VERIFICATION_FAILED');
  const result = {Version:'1.5.220', Status:'RECOVERED', ExtractRunId:runId, RegistryRow:registryRow, EvidenceRowCount:matching.length, UniqueExtractedAtCount:1, RecoveredExtractedAtISO:recovered.toISOString(), StoredExtractedAtISO:stored.toISOString(), Writes_Performed:1};
  safeLog_('[GL REPORT] | V1.5.220 EXTRACTED_AT RECOVERY | ' + JSON.stringify(result));
  return result;
}

/** One-time full-path September 2026 validation fixture for v1.5.220. */
function validateQboGeneralLedgerRunSnapshotV1220For2609() {
  const result = exportQboGeneralLedgerForPeriod('2026-09-01', '2026-09-30', 'Cash');
  const spreadsheet = getQboGeneralLedgerReportSpreadsheet_();
  const run = findQboGeneralLedgerRunById_(spreadsheet, result.extractRunId || result.ExtractRunId);
  if (!run) throw new Error('GL_V1220_VALIDATION_RUN_NOT_REGISTERED');
  if (!(run.ExtractedAt instanceof Date) || isNaN(run.ExtractedAt.getTime())) throw new Error('GL_V1220_VALIDATION_EXTRACTED_AT_MISSING');
  if (String(run.SnapshotArtifactContract || '') !== QBO_GENERAL_LEDGER_SNAPSHOT_ARTIFACT_CONTRACT_V2) throw new Error('GL_V1220_VALIDATION_ARTIFACT_CONTRACT_MISMATCH');
  validateQboGeneralLedgerRunSnapshotV2_(run.SnapshotFileId, run.ExtractRunId, '2026-09-01', '2026-09-30', Number(run.RowCount), run.ExtractedAt);
  const prior = findPriorQboGeneralLedgerRunForRun_(spreadsheet, run);
  const output = {Version:'1.5.220', Status:'PASS', ExtractRunId:run.ExtractRunId, ExtractedAtISO:run.ExtractedAt.toISOString(), RowCount:Number(run.RowCount), SnapshotFileId:String(run.SnapshotFileId || ''), SnapshotArtifactContract:String(run.SnapshotArtifactContract || ''), PriorExtractRunId:prior ? String(prior.ExtractRunId || '') : '', PriorSnapshotArtifactContract:prior ? qboGeneralLedgerArtifactContractForRun_(prior) : '', MetadataValidated:true};
  safeLog_('[GL REPORT] | V1.5.220 FULL PATH 2609 | ' + JSON.stringify(output));
  return output;
}


/** v1.5.221 zero-argument Step 6B call-chain contract test. */
function testQboGeneralLedgerRunSnapshotV1221Contract() {
  const checks = [];
  function check(name, passed) { checks.push({name:name, passed:!!passed}); }
  const exportSrc = exportQboGeneralLedgerForPeriod.toString();
  const validatorSrc = validateQboGeneralLedgerRunSnapshotV2_.toString();
  const diagnosticSrc = diagnoseQboGeneralLedgerInterruptedRunV1221For2609.toString();
  check('production export passes extractedAt into V2 snapshot creator', /createQboGeneralLedgerRunSnapshotV2_\s*\(\s*rows\s*,\s*runId\s*,\s*startDate\s*,\s*endDate\s*,\s*extractedAt\s*\)/s.test(exportSrc));
  check('V2 snapshot creator requires extractedAt', /GL_RUN_SNAPSHOT_V2_EXTRACTED_AT_REQUIRED/.test(createQboGeneralLedgerRunSnapshotV2_.toString()));
  check('V2 validator reaches metadata validation before success return', validatorSrc.indexOf('QBO_GENERAL_LEDGER_SNAPSHOT_METADATA_SHEET') >= 0 && validatorSrc.indexOf('QBO_GENERAL_LEDGER_SNAPSHOT_METADATA_SHEET') < validatorSrc.lastIndexOf('return { valid:true'));
  check('V2 validator checks metadata ExtractedAt', /METADATA_EXTRACTED_AT_MISMATCH/.test(validatorSrc));
  check('V2 validator checks metadata period', /METADATA_PERIOD_MISMATCH/.test(validatorSrc));
  check('V2 validator checks metadata row count', /METADATA_ROW_COUNT_MISMATCH/.test(validatorSrc));
  check('registry writer still isolates and verifies ExtractedAt', /extractedAtCell\.setValue/.test(appendQboGeneralLedgerRun_.toString()) && /qboGeneralLedgerTimestampsMatchToSecond_/.test(appendQboGeneralLedgerRun_.toString()));
  check('diagnostic is fixed to interrupted v1.5.220 run', /6885afa7-640e-4c2c-9751-492f2451cb22/.test(diagnosticSrc));
  check('diagnostic does not invoke QBO export', !/exportQboGeneralLedgerForPeriod\s*\(/.test(diagnosticSrc));
  check('diagnostic performs no production writes', !/setValue\s*\(|setValues\s*\(|appendRow\s*\(|deleteRow\s*\(|clear\s*\(/.test(diagnosticSrc));
  const passed = checks.filter(function(c){ return c.passed; }).length;
  const result = {Version:'1.5.221', Status:passed===checks.length?'PASS':'FAIL', Test_Count:checks.length, Passed:passed, Checks:checks};
  safeLog_('[GL REPORT] | V1.5.221 CONTRACT | ' + JSON.stringify(result));
  if (passed !== checks.length) throw new Error('GL_V1_5_221_CONTRACT_FAILED');
  return result;
}

/** Read-only diagnostic for the interrupted v1.5.220 September validation run. */
function diagnoseQboGeneralLedgerInterruptedRunV1221For2609() {
  const runId = '6885afa7-640e-4c2c-9751-492f2451cb22';
  const startDate = '2026-09-01';
  const endDate = '2026-09-30';
  const spreadsheet = getQboGeneralLedgerReportSpreadsheet_();
  const registryRun = findQboGeneralLedgerRunById_(spreadsheet, runId);
  const data = spreadsheet.getSheetByName(QBO_GENERAL_LEDGER_REPORT.DATA_SHEET);
  if (!data) throw new Error('GL_V1221_DIAGNOSTIC_DATA_SHEET_MISSING');
  const values = data.getDataRange().getValues();
  const headers = values[0].map(function(v){ return String(v || '').trim(); });
  const runIdx = headers.indexOf('ExtractRunId');
  const extractedIdx = headers.indexOf('ExtractedAt');
  const startIdx = headers.indexOf('ReportStartDate');
  const endIdx = headers.indexOf('ReportEndDate');
  if (runIdx < 0 || extractedIdx < 0 || startIdx < 0 || endIdx < 0) throw new Error('GL_V1221_DIAGNOSTIC_REQUIRED_COLUMNS_MISSING');
  let runRows = 0;
  let periodRows = 0;
  const periodRunCounts = {};
  const extractedMs = {};
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const rowRunId = String(row[runIdx] || '').trim();
    const inPeriod = qboGeneralLedgerDateText_(row[startIdx]) === startDate && qboGeneralLedgerDateText_(row[endIdx]) === endDate;
    if (inPeriod) {
      periodRows++;
      periodRunCounts[rowRunId || '(blank)'] = (periodRunCounts[rowRunId || '(blank)'] || 0) + 1;
    }
    if (rowRunId === runId) {
      runRows++;
      const v = row[extractedIdx];
      const key = v instanceof Date && !isNaN(v.getTime()) ? String(v.getTime()) : 'INVALID:' + String(v || '');
      extractedMs[key] = (extractedMs[key] || 0) + 1;
    }
  }
  const uniqueKeys = Object.keys(extractedMs);
  const uniqueExtractedAtISO = uniqueKeys.map(function(k){
    return /^\d+$/.test(k) ? new Date(Number(k)).toISOString() : k;
  });
  const props = PropertiesService.getScriptProperties();
  const folderId = String(props.getProperty(SCRIPT_PROPERTY_KEYS.SNAPSHOT_FOLDER_ID) || '').trim();
  const shortRun = runId.replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
  let matchingSnapshotFiles = [];
  if (folderId) {
    const files = DriveApp.getFolderById(folderId).getFiles();
    while (files.hasNext()) {
      const f = files.next();
      const name = String(f.getName() || '');
      if (name.indexOf('QBO_GL_RUN_SNAPSHOT_V2_' + startDate + '_to_' + endDate + '_' + shortRun + '_') === 0) {
        matchingSnapshotFiles.push({FileId:f.getId(), FileName:name});
      }
    }
  }
  const result = {
    Version:'1.5.221', Status:'DIAGNOSTIC_COMPLETE', Writes_To_GL_Production:0,
    ExtractRunId:runId, RegistryPresent:!!registryRun,
    RegistryRow:registryRun ? Number(registryRun.__RegistryRow || 0) : 0,
    MatchingDataRowCount:runRows,
    UniqueExtractedAtCount:uniqueKeys.length,
    UniqueExtractedAtISO:uniqueExtractedAtISO,
    CurrentPeriodRowCount:periodRows,
    CurrentPeriodRunCounts:periodRunCounts,
    MatchingV2SnapshotFileCount:matchingSnapshotFiles.length,
    MatchingV2SnapshotFiles:matchingSnapshotFiles,
    ReplacedRowsFromFailedExecutionLog:4360,
    ReplacedRowsHistoricalCompositionRecoverableFromCurrentStore:false
  };
  safeLog_('[GL REPORT] | V1.5.221 INTERRUPTED-RUN DIAGNOSTIC | ' + JSON.stringify(result));
  return result;
}

/** v1.5.223 zero-argument read-only live-registry diagnostic contract. */
function testQboGeneralLedgerLiveRegistryV1223Contract() {
  const checks = [];
  function check(name, passed) { checks.push({name:name, passed:!!passed}); }
  const src = diagnoseQboGeneralLedgerLiveRegistryV1222ForFailedA98b.toString();
  check('diagnostic has zero-argument operator wrapper', typeof diagnoseQboGeneralLedgerLiveRegistryV1223ForFailedA98b === 'function' && diagnoseQboGeneralLedgerLiveRegistryV1223ForFailedA98b.length === 0);
  check('diagnostic is fixed to failed a98b run', /a98b060b-ac45-4c05-a2b0-5c8670b5fc3f/.test(src));
  check('diagnostic inspects comparison registry rows', /1be5e167-35cc-4130-8c29-1ef8004146cc/.test(src) && /8e6119f0-969c-4b03-8bde-b78a12df850d/.test(src));
  check('diagnostic inspects registry raw and display values', /getValues/.test(src) && /getDisplayValues/.test(src));
  check('diagnostic inspects formats formulas notes and validation', /getNumberFormat\s*\(/.test(src) && /getFormula\s*\(/.test(src) && /getNote\s*\(/.test(src) && /getDataValidation\s*\(/.test(src));
  check('diagnostic inspects merged ranges and protections', /getMergedRanges/.test(src) && /getProtections/.test(src));
  check('diagnostic compares GL-row and V2-metadata ExtractedAt', /DataRowsExtractedAt/.test(src) && /SnapshotMetadataExtractedAt/.test(src));
  check('diagnostic reports spreadsheet locale and timezone', /getSpreadsheetLocale/.test(src) && /getSpreadsheetTimeZone/.test(src));
  check('diagnostic does not invoke GL export', !/exportQboGeneralLedgerForPeriod\s*\(/.test(src));
  check('diagnostic does not write production registry', !/deleteRow\s*\(|appendRow\s*\(|clear\s*\(/.test(src) && !/registry[^\n]*setValue/i.test(src));
  const passed = checks.filter(function(c){ return c.passed; }).length;
  const result = {Version:'1.5.223', Status:passed===checks.length?'PASS':'FAIL', Test_Count:checks.length, Passed:passed, Checks:checks};
  safeLog_('[GL REPORT] | V1.5.223 CONTRACT | ' + JSON.stringify(result));
  if (passed !== checks.length) throw new Error('GL_V1_5_223_CONTRACT_FAILED');
  return result;
}

/**
 * Read-only production diagnostic for the failed a98b V2 registry timestamp write.
 * Creates no GL acquisition and performs no writes to the production GL workbook.
 */
function diagnoseQboGeneralLedgerLiveRegistryV1223ForFailedA98b() {
  return diagnoseQboGeneralLedgerLiveRegistryV1222ForFailedA98b();
}

function diagnoseQboGeneralLedgerLiveRegistryV1222ForFailedA98b() {
  const failedRunId = 'a98b060b-ac45-4c05-a2b0-5c8670b5fc3f';
  const preFilingRunId = '1be5e167-35cc-4130-8c29-1ef8004146cc';
  const recoveredV2RunId = '8e6119f0-969c-4b03-8bde-b78a12df850d';
  const expectedSnapshotId = '1WZlwdTGfKkGTVDavikRyaCkkgeEm4kPjyaXLLkDUP_4';
  const spreadsheet = getQboGeneralLedgerReportSpreadsheet_();
  const registry = spreadsheet.getSheetByName(QBO_GENERAL_LEDGER_REPORT.RUNS_SHEET);
  const data = spreadsheet.getSheetByName(QBO_GENERAL_LEDGER_REPORT.DATA_SHEET);
  if (!registry || !data) throw new Error('GL_V1222_REQUIRED_SHEET_MISSING');

  const registryValues = registry.getDataRange().getValues();
  const registryDisplay = registry.getDataRange().getDisplayValues();
  const headers = registryDisplay[0].map(function(v){ return String(v || '').trim(); });
  const runIdx = headers.indexOf('ExtractRunId');
  const extractedIdx = headers.indexOf('ExtractedAt');
  if (runIdx < 0 || extractedIdx < 0) throw new Error('GL_V1222_REGISTRY_COLUMNS_MISSING');

  function registryCellDiagnostic_(runId) {
    let rowNumber = 0;
    for (let i = 1; i < registryValues.length; i++) {
      if (String(registryValues[i][runIdx] || '').trim() === runId) { rowNumber = i + 1; break; }
    }
    if (!rowNumber) return {ExtractRunId:runId, Present:false};
    const cell = registry.getRange(rowNumber, extractedIdx + 1);
    const raw = cell.getValue();
    const validation = cell.getDataValidation();
    const merged = cell.getMergedRanges();
    return {
      ExtractRunId:runId, Present:true, RegistryRow:rowNumber,
      RawType:Object.prototype.toString.call(raw), IsDate:raw instanceof Date && !isNaN(raw.getTime()),
      ISO:raw instanceof Date && !isNaN(raw.getTime()) ? raw.toISOString() : '',
      Display:cell.getDisplayValue(), Formula:cell.getFormula(), NumberFormat:cell.getNumberFormat(),
      Note:cell.getNote(), HasDataValidation:!!validation, MergedRangeCount:merged.length,
      MergedRanges:merged.map(function(r){ return r.getA1Notation(); })
    };
  }

  const comparedRegistryCells = [
    registryCellDiagnostic_(preFilingRunId),
    registryCellDiagnostic_(recoveredV2RunId),
    registryCellDiagnostic_(failedRunId)
  ];

  const dataValues = data.getDataRange().getValues();
  const dataHeaders = dataValues[0].map(function(v){ return String(v || '').trim(); });
  const dRunIdx = dataHeaders.indexOf('ExtractRunId');
  const dExtractedIdx = dataHeaders.indexOf('ExtractedAt');
  if (dRunIdx < 0 || dExtractedIdx < 0) throw new Error('GL_V1222_DATA_COLUMNS_MISSING');
  let matchingRows = 0;
  const dataExtracted = {};
  for (let i = 1; i < dataValues.length; i++) {
    if (String(dataValues[i][dRunIdx] || '').trim() !== failedRunId) continue;
    matchingRows++;
    const v = dataValues[i][dExtractedIdx];
    const key = v instanceof Date && !isNaN(v.getTime()) ? String(v.getTime()) : 'INVALID:' + String(v || '');
    dataExtracted[key] = (dataExtracted[key] || 0) + 1;
  }
  const dataKeys = Object.keys(dataExtracted);
  const dataISO = dataKeys.map(function(k){ return /^\d+$/.test(k) ? new Date(Number(k)).toISOString() : k; });

  let snapshotMeta = {SnapshotFileId:expectedSnapshotId, Opened:false};
  try {
    const snapshot = SpreadsheetApp.openById(expectedSnapshotId);
    const metaSheet = snapshot.getSheetByName(QBO_GENERAL_LEDGER_SNAPSHOT_METADATA_SHEET);
    if (!metaSheet) throw new Error('METADATA_SHEET_MISSING');
    const mv = metaSheet.getDataRange().getValues();
    const meta = {};
    for (let i = 1; i < mv.length; i++) meta[String(mv[i][0] || '').trim()] = mv[i][1];
    const metaAt = meta.ExtractedAt;
    snapshotMeta = {
      SnapshotFileId:expectedSnapshotId, Opened:true,
      ArtifactContract:String(meta.ArtifactContract || ''), ExtractRunId:String(meta.ExtractRunId || ''),
      SnapshotMetadataExtractedAtType:Object.prototype.toString.call(metaAt),
      SnapshotMetadataExtractedAtISO:metaAt instanceof Date && !isNaN(metaAt.getTime()) ? metaAt.toISOString() : '',
      ReportStartDate:qboGeneralLedgerDateText_(meta.ReportStartDate), ReportEndDate:qboGeneralLedgerDateText_(meta.ReportEndDate),
      RowCount:Number(meta.RowCount || 0)
    };
  } catch (e) {
    snapshotMeta = {SnapshotFileId:expectedSnapshotId, Opened:false, Error:String(e && e.message || e)};
  }

  const protections = registry.getProtections(SpreadsheetApp.ProtectionType.RANGE).map(function(p){
    const r = p.getRange();
    return {A1:r.getA1Notation(), Description:String(p.getDescription() || ''), WarningOnly:p.isWarningOnly()};
  });
  const sheetProtections = registry.getProtections(SpreadsheetApp.ProtectionType.SHEET).map(function(p){
    return {Description:String(p.getDescription() || ''), WarningOnly:p.isWarningOnly()};
  });

  const failed = comparedRegistryCells[2];
  const evidenceISO = dataISO.length === 1 && !/^INVALID:/.test(dataISO[0]) ? dataISO[0] : '';
  const metadataISO = snapshotMeta.Opened ? snapshotMeta.SnapshotMetadataExtractedAtISO : '';
  const result = {
    Version:'1.5.222', Status:'DIAGNOSTIC_COMPLETE', Writes_To_GL_Production:0,
    SpreadsheetId:spreadsheet.getId(), SpreadsheetName:spreadsheet.getName(),
    SpreadsheetLocale:spreadsheet.getSpreadsheetLocale(), SpreadsheetTimeZone:spreadsheet.getSpreadsheetTimeZone(),
    RegistrySheet:registry.getName(), RegistryLastRow:registry.getLastRow(), RegistryLastColumn:registry.getLastColumn(),
    ComparedRegistryExtractedAtCells:comparedRegistryCells,
    RangeProtections:protections, SheetProtections:sheetProtections,
    FailedRunId:failedRunId, DataRowsMatching:matchingRows,
    DataRowsExtractedAtUniqueCount:dataKeys.length, DataRowsExtractedAtISO:dataISO,
    SnapshotMetadata:snapshotMeta,
    SnapshotMetadataExtractedAt:metadataISO,
    DataRowsAndSnapshotMetadataAgree:!!evidenceISO && !!metadataISO && evidenceISO === metadataISO,
    FailedRegistryExtractedAtBlank:!!failed && failed.Present && failed.Display === ''
  };
  safeLog_('[GL REPORT] | V1.5.222 LIVE REGISTRY DIAGNOSTIC | ' + JSON.stringify(result));
  return result;
}

/**
 * v1.5.225 compact read-only diagnostic for the failed a98b registry timestamp.
 * Emits decisive fields in separate log records to avoid Apps Script log truncation.
 */
function testQboGeneralLedgerLiveRegistryV1225Contract() {
  const checks = [];
  function check(name, passed) { checks.push({name:name, passed:!!passed}); }
  const src = diagnoseQboGeneralLedgerLiveRegistryV1225ForFailedA98b.toString();
  check('diagnostic has zero-argument operator wrapper', typeof diagnoseQboGeneralLedgerLiveRegistryV1225ForFailedA98b === 'function' && diagnoseQboGeneralLedgerLiveRegistryV1225ForFailedA98b.length === 0);
  check('diagnostic is fixed to failed a98b run', src.indexOf('a98b060b-ac45-4c05-a2b0-5c8670b5fc3f') >= 0);
  check('diagnostic compares three registry runs', src.indexOf('1be5e167-35cc-4130-8c29-1ef8004146cc') >= 0 && src.indexOf('8e6119f0-969c-4b03-8bde-b78a12df850d') >= 0);
  check('diagnostic reads failed run data rows', src.indexOf('DataRowsExtractedAt') >= 0);
  check('diagnostic reads V2 metadata', src.indexOf('SpreadsheetApp.openById(expectedSnapshotId)') >= 0 && src.indexOf('QBO_GENERAL_LEDGER_SNAPSHOT_METADATA_SHEET') >= 0 && src.indexOf('ExtractedAt') >= 0);
  check('diagnostic reports evidence agreement', src.indexOf('DataRowsAndSnapshotMetadataAgree') >= 0);
  check('diagnostic reports protections', src.indexOf('RangeProtections') >= 0 && src.indexOf('SheetProtections') >= 0);
  check('diagnostic does not invoke GL export', src.indexOf('exportQboGeneralLedgerForPeriod') < 0);
  check('diagnostic contains no production setValue', src.indexOf('.setValue(') < 0 && src.indexOf('.setValues(') < 0);
  check('diagnostic emits compact separate logs', src.indexOf('V1.5.225 FAILED CELL') >= 0 && src.indexOf('V1.5.225 EVIDENCE') >= 0);
  const passed = checks.filter(function(c){return c.passed;}).length;
  const result = {Version:'1.5.225', Status:passed===checks.length?'PASS':'FAIL', Test_Count:checks.length, Passed:passed, Checks:checks};
  safeLog_('[GL REPORT] | V1.5.225 CONTRACT | ' + JSON.stringify(result));
  if (passed !== checks.length) throw new Error('GL_V1_5_225_CONTRACT_FAILED');
  return result;
}

function diagnoseQboGeneralLedgerLiveRegistryV1225ForFailedA98b() {
  const failedRunId = 'a98b060b-ac45-4c05-a2b0-5c8670b5fc3f';
  const preFilingRunId = '1be5e167-35cc-4130-8c29-1ef8004146cc';
  const recoveredV2RunId = '8e6119f0-969c-4b03-8bde-b78a12df850d';
  const expectedSnapshotId = '1WZlwdTGfKkGTVDavikRyaCkkgeEm4kPjyaXLLkDUP_4';
  const spreadsheet = getQboGeneralLedgerReportSpreadsheet_();
  const registry = spreadsheet.getSheetByName(QBO_GENERAL_LEDGER_REPORT.RUNS_SHEET);
  const data = spreadsheet.getSheetByName(QBO_GENERAL_LEDGER_REPORT.DATA_SHEET);
  if (!registry || !data) throw new Error('GL_V1225_REQUIRED_SHEET_MISSING');

  const registryValues = registry.getDataRange().getValues();
  const registryDisplay = registry.getDataRange().getDisplayValues();
  const headers = registryDisplay[0].map(function(v){ return String(v || '').trim(); });
  const runIdx = headers.indexOf('ExtractRunId');
  const extractedIdx = headers.indexOf('ExtractedAt');
  if (runIdx < 0 || extractedIdx < 0) throw new Error('GL_V1225_REGISTRY_COLUMNS_MISSING');

  function cellDiag(runId) {
    let rowNumber = 0;
    for (let i=1;i<registryValues.length;i++) if (String(registryValues[i][runIdx]||'').trim()===runId) { rowNumber=i+1; break; }
    if (!rowNumber) return {ExtractRunId:runId,Present:false};
    const cell=registry.getRange(rowNumber,extractedIdx+1), raw=cell.getValue();
    return {ExtractRunId:runId,Present:true,RegistryRow:rowNumber,RawType:Object.prototype.toString.call(raw),IsDate:raw instanceof Date&&!isNaN(raw.getTime()),ISO:raw instanceof Date&&!isNaN(raw.getTime())?raw.toISOString():'',Display:cell.getDisplayValue(),NumberFormat:cell.getNumberFormat(),Formula:cell.getFormula(),Note:cell.getNote(),HasDataValidation:!!cell.getDataValidation(),MergedRangeCount:cell.getMergedRanges().length};
  }

  const legacy=cellDiag(preFilingRunId), recovered=cellDiag(recoveredV2RunId), failed=cellDiag(failedRunId);
  const dataValues=data.getDataRange().getValues();
  const dh=dataValues[0].map(function(v){return String(v||'').trim();});
  const dr=dh.indexOf('ExtractRunId'), de=dh.indexOf('ExtractedAt');
  if (dr<0||de<0) throw new Error('GL_V1225_DATA_COLUMNS_MISSING');
  let count=0; const unique={};
  for (let i=1;i<dataValues.length;i++) {
    if (String(dataValues[i][dr]||'').trim()!==failedRunId) continue;
    count++; const v=dataValues[i][de]; const k=v instanceof Date&&!isNaN(v.getTime())?String(v.getTime()):'INVALID:'+String(v||''); unique[k]=(unique[k]||0)+1;
  }
  const keys=Object.keys(unique);
  const dataISO=keys.map(function(k){return /^\d+$/.test(k)?new Date(Number(k)).toISOString():k;});

  let metaISO='', meta={Opened:false,SnapshotFileId:expectedSnapshotId};
  try {
    const ss=SpreadsheetApp.openById(expectedSnapshotId), ms=ss.getSheetByName(QBO_GENERAL_LEDGER_SNAPSHOT_METADATA_SHEET);
    if (!ms) throw new Error('METADATA_SHEET_MISSING');
    const mv=ms.getDataRange().getValues(), m={}; for (let i=1;i<mv.length;i++) m[String(mv[i][0]||'').trim()]=mv[i][1];
    const at=m.ExtractedAt; metaISO=at instanceof Date&&!isNaN(at.getTime())?at.toISOString():'';
    meta={Opened:true,SnapshotFileId:expectedSnapshotId,ArtifactContract:String(m.ArtifactContract||''),ExtractRunId:String(m.ExtractRunId||''),ExtractedAtISO:metaISO,RowCount:Number(m.RowCount||0),ReportStartDate:qboGeneralLedgerDateText_(m.ReportStartDate),ReportEndDate:qboGeneralLedgerDateText_(m.ReportEndDate)};
  } catch(e) { meta={Opened:false,SnapshotFileId:expectedSnapshotId,Error:String(e&&e.message||e)}; }

  const rangeProtections=registry.getProtections(SpreadsheetApp.ProtectionType.RANGE).map(function(p){return {A1:p.getRange().getA1Notation(),Description:String(p.getDescription()||''),WarningOnly:p.isWarningOnly()};});
  const sheetProtections=registry.getProtections(SpreadsheetApp.ProtectionType.SHEET).map(function(p){return {Description:String(p.getDescription()||''),WarningOnly:p.isWarningOnly()};});
  const evidenceISO=dataISO.length===1&&!/^INVALID:/.test(dataISO[0])?dataISO[0]:'';
  const agree=!!evidenceISO&&!!metaISO&&evidenceISO===metaISO;

  safeLog_('[GL REPORT] | V1.5.225 REGISTRY CONTEXT | '+JSON.stringify({SpreadsheetId:spreadsheet.getId(),SpreadsheetName:spreadsheet.getName(),Locale:spreadsheet.getSpreadsheetLocale(),TimeZone:spreadsheet.getSpreadsheetTimeZone(),RegistryLastRow:registry.getLastRow(),RegistryLastColumn:registry.getLastColumn()}));
  safeLog_('[GL REPORT] | V1.5.225 LEGACY CELL | '+JSON.stringify(legacy));
  safeLog_('[GL REPORT] | V1.5.225 RECOVERED CELL | '+JSON.stringify(recovered));
  safeLog_('[GL REPORT] | V1.5.225 FAILED CELL | '+JSON.stringify(failed));
  safeLog_('[GL REPORT] | V1.5.225 EVIDENCE | '+JSON.stringify({FailedRunId:failedRunId,DataRowsMatching:count,DataRowsExtractedAtUniqueCount:keys.length,DataRowsExtractedAtISO:dataISO,SnapshotMetadata:meta,DataRowsAndSnapshotMetadataAgree:agree}));
  safeLog_('[GL REPORT] | V1.5.225 PROTECTIONS | '+JSON.stringify({RangeProtections:rangeProtections,SheetProtections:sheetProtections}));
  const result={Version:'1.5.225',Status:'DIAGNOSTIC_COMPLETE',Writes_To_GL_Production:0,FailedRegistryExtractedAtBlank:failed.Present&&failed.Display==='',DataRowsAndSnapshotMetadataAgree:agree};
  safeLog_('[GL REPORT] | V1.5.225 RESULT | '+JSON.stringify(result));
  return result;
}


/**
 * v1.5.226 contract for the atomic GL registry writer and controlled a98b recovery.
 * This test is read-only and does not invoke a GL acquisition.
 */
function testQboGeneralLedgerRegistryAtomicWriteV1226Contract() {
  const checks = [];
  function check(name, passed) { checks.push({name:name, passed:!!passed}); }
  const appendSrc = appendQboGeneralLedgerRun_.toString();
  const recoverySrc = recoverQboGeneralLedgerRegistryExtractedAtV1226ForFailedA98b.toString();
  check('registry writer writes ExtractedAt in initial row setValues', /writeRow\[1\]\s*=\s*extractedAt/.test(appendSrc) && /setValues\(\[writeRow\]\)/.test(appendSrc));
  check('registry writer no longer performs second-stage ExtractedAt setValue', appendSrc.indexOf('extractedAtCell.setValue') < 0);
  check('registry writer formats timestamp after atomic persistence', /setNumberFormat\('yyyy-mm-dd hh:mm:ss'\)/.test(appendSrc));
  check('registry writer flushes and verifies persisted timestamp', /SpreadsheetApp\.flush\(\)/.test(appendSrc) && /GL_RUN_REGISTRY_EXTRACTED_AT_WRITE_MISMATCH/.test(appendSrc));
  check('recovery has zero-argument operator wrapper', recoverQboGeneralLedgerRegistryExtractedAtV1226ForFailedA98b.length === 0);
  check('recovery is fixed to exact failed run and V2 snapshot', recoverySrc.indexOf('a98b060b-ac45-4c05-a2b0-5c8670b5fc3f') >= 0 && recoverySrc.indexOf('1WZlwdTGfKkGTVDavikRyaCkkgeEm4kPjyaXLLkDUP_4') >= 0);
  check('recovery requires exact live workbook identity', recoverySrc.indexOf('1FrWoVQtVS_nPAncFxPeCOs1wmre-Scf_8zvjBw4zf_k') >= 0);
  check('recovery proves GL rows and V2 metadata before write', recoverySrc.indexOf('GL_V1226_EVIDENCE_TIMESTAMP_MISMATCH') >= 0 && recoverySrc.indexOf('validateQboGeneralLedgerRunSnapshotV2_') >= 0);
  check('recovery writes only registry ExtractedAt cell', /getRange\(registryRow, 2\)/.test(recoverySrc) && /extractedAtCell\.setValue\(recoveredAt\)/.test(recoverySrc));
  check('recovery verifies exact stored timestamp after write', recoverySrc.indexOf('GL_V1226_RECOVERY_WRITE_VERIFY_FAILED') >= 0);
  check('recovery refuses nonblank registry timestamp', recoverySrc.indexOf('GL_V1226_REGISTRY_EXTRACTED_AT_NOT_BLANK') >= 0);
  check('recovery does not invoke GL export', recoverySrc.indexOf('exportQboGeneralLedgerReport') < 0 && recoverySrc.indexOf('runQboGeneralLedger') < 0);
  const passed = checks.filter(function(c){return c.passed;}).length;
  const result = {Version:'1.5.226',Status:passed===checks.length?'PASS':'FAIL',Test_Count:checks.length,Passed:passed,Checks:checks};
  safeLog_('[GL REPORT] | V1.5.226 CONTRACT | ' + JSON.stringify(result));
  if (passed !== checks.length) throw new Error('GL_V1_5_226_CONTRACT_FAILED');
  return result;
}

/**
 * Controlled one-cell recovery for the a98b V2 run.
 * Preconditions prove the timestamp independently from the persisted GL rows and
 * immutable V2 metadata. The only production write is registry column B for the
 * exact existing run row. This does not create a snapshot or a registry run.
 */
function recoverQboGeneralLedgerRegistryExtractedAtV1226ForFailedA98b() {
  const expectedWorkbookId = '1FrWoVQtVS_nPAncFxPeCOs1wmre-Scf_8zvjBw4zf_k';
  const runId = 'a98b060b-ac45-4c05-a2b0-5c8670b5fc3f';
  const snapshotId = '1WZlwdTGfKkGTVDavikRyaCkkgeEm4kPjyaXLLkDUP_4';
  const expectedStart = '2026-09-01';
  const expectedEnd = '2026-09-30';
  const expectedRowCount = 2215;
  const expectedISO = '2026-10-04T06:17:00.941Z';

  const spreadsheet = getQboGeneralLedgerReportSpreadsheet_();
  if (spreadsheet.getId() !== expectedWorkbookId) throw new Error('GL_V1226_LIVE_WORKBOOK_ID_MISMATCH');
  const registry = spreadsheet.getSheetByName(QBO_GENERAL_LEDGER_REPORT.RUNS_SHEET);
  const data = spreadsheet.getSheetByName(QBO_GENERAL_LEDGER_REPORT.DATA_SHEET);
  if (!registry || !data) throw new Error('GL_V1226_REQUIRED_SHEET_MISSING');

  const registryValues = registry.getDataRange().getValues();
  const registryHeaders = registryValues[0].map(function(v){ return String(v || '').trim(); });
  const runIdx = registryHeaders.indexOf('ExtractRunId');
  const snapshotIdx = registryHeaders.indexOf('SnapshotFileId');
  const contractIdx = registryHeaders.indexOf('SnapshotArtifactContract');
  const startIdx = registryHeaders.indexOf('ReportStartDate');
  const endIdx = registryHeaders.indexOf('ReportEndDate');
  const rowCountIdx = registryHeaders.indexOf('RowCount');
  if ([runIdx,snapshotIdx,contractIdx,startIdx,endIdx,rowCountIdx].some(function(i){return i<0;})) throw new Error('GL_V1226_REGISTRY_COLUMNS_MISSING');

  const matches = [];
  for (let i=1;i<registryValues.length;i++) if (String(registryValues[i][runIdx] || '').trim() === runId) matches.push(i+1);
  if (matches.length !== 1) throw new Error('GL_V1226_REGISTRY_RUN_CARDINALITY_INVALID: count=' + matches.length);
  const registryRow = matches[0];
  const registryRecord = registryValues[registryRow-1];
  if (String(registryRecord[snapshotIdx] || '').trim() !== snapshotId) throw new Error('GL_V1226_REGISTRY_SNAPSHOT_ID_MISMATCH');
  if (String(registryRecord[contractIdx] || '').trim() !== QBO_GENERAL_LEDGER_SNAPSHOT_ARTIFACT_CONTRACT_V2) throw new Error('GL_V1226_REGISTRY_ARTIFACT_CONTRACT_MISMATCH');
  if (qboGeneralLedgerDateText_(registryRecord[startIdx]) !== expectedStart || qboGeneralLedgerDateText_(registryRecord[endIdx]) !== expectedEnd) throw new Error('GL_V1226_REGISTRY_PERIOD_MISMATCH');
  if (Number(registryRecord[rowCountIdx]) !== expectedRowCount) throw new Error('GL_V1226_REGISTRY_ROW_COUNT_MISMATCH');

  const extractedAtCell = registry.getRange(registryRow, 2);
  const prior = extractedAtCell.getValue();
  if ((prior instanceof Date && !isNaN(prior.getTime())) || String(extractedAtCell.getDisplayValue() || '').trim() !== '') throw new Error('GL_V1226_REGISTRY_EXTRACTED_AT_NOT_BLANK');

  const dataValues = data.getDataRange().getValues();
  const dataHeaders = dataValues[0].map(function(v){return String(v || '').trim();});
  const dataRunIdx = dataHeaders.indexOf('ExtractRunId');
  const dataAtIdx = dataHeaders.indexOf('ExtractedAt');
  if (dataRunIdx < 0 || dataAtIdx < 0) throw new Error('GL_V1226_DATA_COLUMNS_MISSING');
  const times = {};
  let dataRowCount = 0;
  for (let i=1;i<dataValues.length;i++) {
    if (String(dataValues[i][dataRunIdx] || '').trim() !== runId) continue;
    dataRowCount++;
    const at = dataValues[i][dataAtIdx];
    if (!(at instanceof Date) || isNaN(at.getTime())) throw new Error('GL_V1226_DATA_EXTRACTED_AT_INVALID');
    times[String(at.getTime())] = true;
  }
  const timeKeys = Object.keys(times);
  if (dataRowCount !== expectedRowCount || timeKeys.length !== 1) throw new Error('GL_V1226_DATA_EVIDENCE_CARDINALITY_INVALID');
  const recoveredAt = new Date(Number(timeKeys[0]));
  if (recoveredAt.toISOString() !== expectedISO) throw new Error('GL_V1226_DATA_EXTRACTED_AT_UNEXPECTED');

  const snapshot = SpreadsheetApp.openById(snapshotId);
  const metadataSheet = snapshot.getSheetByName(QBO_GENERAL_LEDGER_SNAPSHOT_METADATA_SHEET);
  if (!metadataSheet) throw new Error('GL_V1226_METADATA_SHEET_MISSING');
  const metadataValues = metadataSheet.getDataRange().getValues();
  const meta = {};
  for (let i=1;i<metadataValues.length;i++) meta[String(metadataValues[i][0] || '').trim()] = metadataValues[i][1];
  const metaAt = meta.ExtractedAt;
  if (String(meta.ArtifactContract || '') !== QBO_GENERAL_LEDGER_SNAPSHOT_ARTIFACT_CONTRACT_V2 || String(meta.ExtractRunId || '') !== runId) throw new Error('GL_V1226_METADATA_IDENTITY_MISMATCH');
  if (qboGeneralLedgerDateText_(meta.ReportStartDate) !== expectedStart || qboGeneralLedgerDateText_(meta.ReportEndDate) !== expectedEnd || Number(meta.RowCount) !== expectedRowCount) throw new Error('GL_V1226_METADATA_SCOPE_MISMATCH');
  if (!(metaAt instanceof Date) || isNaN(metaAt.getTime()) || metaAt.toISOString() !== expectedISO || metaAt.getTime() !== recoveredAt.getTime()) throw new Error('GL_V1226_EVIDENCE_TIMESTAMP_MISMATCH');
  validateQboGeneralLedgerRunSnapshotV2_(snapshotId, runId, expectedStart, expectedEnd, expectedRowCount, recoveredAt);

  extractedAtCell.setValue(recoveredAt);
  extractedAtCell.setNumberFormat('yyyy-mm-dd hh:mm:ss');
  SpreadsheetApp.flush();
  const stored = extractedAtCell.getValue();
  if (!(stored instanceof Date) || isNaN(stored.getTime()) || stored.getTime() !== recoveredAt.getTime()) throw new Error('GL_V1226_RECOVERY_WRITE_VERIFY_FAILED');

  const result = {Version:'1.5.226',Status:'RECOVERED',ExtractRunId:runId,RegistryRow:registryRow,SnapshotFileId:snapshotId,EvidenceRowCount:dataRowCount,RecoveredExtractedAtISO:recoveredAt.toISOString(),StoredExtractedAtISO:stored.toISOString(),Writes_Performed:1};
  safeLog_('[GL REPORT] | V1.5.226 A98B RECOVERY | ' + JSON.stringify(result));
  return result;
}
