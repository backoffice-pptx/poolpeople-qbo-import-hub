/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 144_QBO_PostFilingSalesTaxGlActivity.js
 * Version     : 1.5.193
 * Purpose     : Governed, narrow post-filing GL evidence capture for Texas
 *               sales-tax settlement activity without refreshing/replacing the
 *               frozen filing-basis General Ledger evidence.
 *
 * Evidence contract:
 *   - Server-side QBO scope:
 *       reports/GeneralLedger
 *       account = Texas Comptroller Payable QBO Account Id 221
 *       start_date = filing date (lower eligibility boundary)
 *       end_date = evidence capture date (or later governed end date)
 *       accounting_method = Cash
 *   - Local retained population:
 *       TransactionType exactly "Sales Tax Payment" OR
 *       TransactionType exactly "Sales Tax Adjustment"
 *   - The complete server response is NOT persisted. This intentionally avoids
 *     importing potentially drifted Invoice/Sales Receipt activity after the
 *     filing-basis evidence was frozen.
 *   - Capture metadata records server row count, retained row count, and
 *     excluded row count so the narrowing is auditable.
 *   - No amount, transaction id, memo, or expected-result filter is used.
 *   - Each successful capture creates a new immutable-by-contract spreadsheet;
 *     it never modifies QBO_GeneralLedger or its snapshots.
 *
 * Public API:
 *   captureQboPostFilingSalesTaxGlActivity(startDate, endDate, filingContext)
 *   captureQboPostFilingSalesTaxGlActivityForRequest(request)
 *   testQboPostFilingSalesTaxGlActivityContract()
 *
 * QBO impact: Read-only GET reports/GeneralLedger.
 * ============================================================================
 */

const QBO_POST_FILING_SALES_TAX_GL_VERSION = '1.5.193';
const QBO_POST_FILING_SALES_TAX_GL = Object.freeze({
  ACCOUNT_NAME: 'Texas Comptroller Payable',
  ACCOUNT_ID: '221',
  ACCOUNTING_METHOD: 'Cash',
  RETAINED_TRANSACTION_TYPES: Object.freeze([
    'Sales Tax Payment',
    'Sales Tax Adjustment'
  ]),
  EVIDENCE_TYPE: 'POST_FILING_GL_ACTIVITY',
  METADATA_SHEET: '00_Capture_Metadata',
  ACTIVITY_SHEET: '01_Post_Filing_GL_Activity'
});

const QBO_POST_FILING_SALES_TAX_GL_ACTIVITY_HEADERS = Object.freeze([
  'CaptureRunId','CapturedAt','EvidenceType','WindowStartDate','WindowEndDate',
  'ReportName','ReportBasis','AccountName','AccountId','Date','TransactionType',
  'TransactionId','Num','Name','NameId','MemoDescription','Split','SplitId',
  'Amount','Balance','RawRowJSON'
]);

/**
 * Captures narrow post-filing Texas sales-tax GL activity.
 * startDate is normally the filed-at calendar date. endDate is the evidence
 * capture date and may be later because QBO posting can occur after filing.
 *
 * @param {string} startDate yyyy-mm-dd inclusive.
 * @param {string} endDate yyyy-mm-dd inclusive.
 * @return {Object} immutable evidence artifact metadata.
 */
function captureQboPostFilingSalesTaxGlActivity(startDate, endDate, filingContext) {
  validateQboGeneralLedgerPeriod_(startDate, endDate);

  const cfg = getConfig_();
  const runId = Utilities.getUuid();
  const capturedAt = new Date();
  const query = [
    'start_date=' + encodeURIComponent(startDate),
    'end_date=' + encodeURIComponent(endDate),
    'accounting_method=' + encodeURIComponent(QBO_POST_FILING_SALES_TAX_GL.ACCOUNTING_METHOD),
    'account=' + encodeURIComponent(QBO_POST_FILING_SALES_TAX_GL.ACCOUNT_ID),
    'minorversion=' + encodeURIComponent(cfg.minorVersion)
  ].join('&');

  safeLog_(
    '[POST-FILING SALES TAX GL] START | run=' + runId +
    ' | window=' + startDate + '..' + endDate +
    ' | account=' + QBO_POST_FILING_SALES_TAX_GL.ACCOUNT_ID +
    ' | readOnlyQbo=true'
  );

  const report = qboGet_('reports/GeneralLedger?' + query);
  validateQboPostFilingSalesTaxGlResponse_(report, startDate, endDate);

  const header = report.Header || {};
  const flattened = [];
  flattenQboGeneralLedgerRows_(
    report.Rows && Array.isArray(report.Rows.Row) ? report.Rows.Row : [],
    0, '', '',
    {
      runId: runId,
      extractedAt: capturedAt,
      reportName: valueOrBlank_(header.ReportName),
      reportBasis: valueOrBlank_(header.ReportBasis),
      startDate: valueOrBlank_(header.StartPeriod) || startDate,
      endDate: valueOrBlank_(header.EndPeriod) || endDate
    },
    flattened
  );

  const idx = {};
  QBO_GENERAL_LEDGER_HEADERS.forEach(function(name, i) { idx[name] = i; });
  const dataRows = flattened.filter(function(row) {
    return String(row[idx.RowType] || '') === 'Data';
  });

  // Defense in depth: the server must have honored account=221. We refuse to
  // publish evidence if any returned data row belongs to another account.
  const outsideAccount = dataRows.filter(function(row) {
    return String(row[idx.GroupId] || '') !== QBO_POST_FILING_SALES_TAX_GL.ACCOUNT_ID;
  });
  if (outsideAccount.length) {
    throw new Error(
      'POST_FILING_GL_ACCOUNT_SCOPE_NOT_HONORED: QBO returned ' +
      outsideAccount.length + ' data row(s) outside Account Id ' +
      QBO_POST_FILING_SALES_TAX_GL.ACCOUNT_ID + '.'
    );
  }

  const retained = dataRows.filter(function(row) {
    return QBO_POST_FILING_SALES_TAX_GL.RETAINED_TRANSACTION_TYPES.indexOf(
      String(row[idx.TransactionType] || '')
    ) >= 0;
  });

  const evidenceRows = retained.map(function(row) {
    return [
      runId,
      capturedAt,
      QBO_POST_FILING_SALES_TAX_GL.EVIDENCE_TYPE,
      startDate,
      endDate,
      valueOrBlank_(header.ReportName),
      valueOrBlank_(header.ReportBasis),
      QBO_POST_FILING_SALES_TAX_GL.ACCOUNT_NAME,
      QBO_POST_FILING_SALES_TAX_GL.ACCOUNT_ID,
      row[idx.Date],
      row[idx.TransactionType],
      row[idx.TransactionId],
      row[idx.Num],
      row[idx.Name],
      row[idx.NameId],
      row[idx.MemoDescription],
      row[idx.Split],
      row[idx.SplitId],
      row[idx.Amount],
      row[idx.Balance],
      row[idx.RawRowJSON]
    ];
  });

  const artifact = writeQboPostFilingSalesTaxGlEvidence_(
    runId, capturedAt, startDate, endDate, header,
    dataRows.length, evidenceRows, filingContext || null
  );

  const result = {
    version: QBO_POST_FILING_SALES_TAX_GL_VERSION,
    evidenceType: QBO_POST_FILING_SALES_TAX_GL.EVIDENCE_TYPE,
    captureRunId: runId,
    capturedAt: capturedAt.toISOString(),
    windowStartDate: startDate,
    windowEndDate: endDate,
    accountName: QBO_POST_FILING_SALES_TAX_GL.ACCOUNT_NAME,
    accountId: QBO_POST_FILING_SALES_TAX_GL.ACCOUNT_ID,
    reportName: valueOrBlank_(header.ReportName),
    reportBasis: valueOrBlank_(header.ReportBasis),
    serverDataRowCount: dataRows.length,
    retainedRowCount: evidenceRows.length,
    excludedRowCount: dataRows.length - evidenceRows.length,
    retainedTransactionTypes: QBO_POST_FILING_SALES_TAX_GL.RETAINED_TRANSACTION_TYPES.slice(),
    evidenceSpreadsheetId: artifact.id,
    evidenceSpreadsheetName: artifact.name,
    evidenceSpreadsheetUrl: artifact.url,
    productionGeneralLedgerModified: false,
    periodKey: filingContext ? filingContext.periodKey : '',
    filingConfirmationId: filingContext ? filingContext.filingConfirmationId : '',
    filingRunId: filingContext ? filingContext.filingRunId : '',
    filingDateSource: filingContext ? filingContext.filingDateSource : ''
  };

  safeLog_('[POST-FILING SALES TAX GL] COMPLETE | ' + JSON.stringify(result));
  return result;
}

function validateQboPostFilingSalesTaxGlResponse_(report, startDate, endDate) {
  validateQboGeneralLedgerResponse_(report, startDate, endDate);
  const header = report.Header || {};
  if (header.ReportBasis && header.ReportBasis !== QBO_POST_FILING_SALES_TAX_GL.ACCOUNTING_METHOD) {
    throw new Error('POST_FILING_GL_UNEXPECTED_BASIS: ' + header.ReportBasis);
  }
}

function writeQboPostFilingSalesTaxGlEvidence_(runId, capturedAt, startDate, endDate, header, serverCount, evidenceRows, filingContext) {
  const stamp = Utilities.formatDate(capturedAt, Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  const name = 'QBO_Post_Filing_Sales_Tax_GL_' + startDate.replace(/-/g, '') +
    '_' + endDate.replace(/-/g, '') + '_ASOF_' + stamp + '_RUN_' + runId.substring(0, 8);
  const ss = SpreadsheetApp.create(name);
  const metadata = ss.getSheets()[0];
  metadata.setName(QBO_POST_FILING_SALES_TAX_GL.METADATA_SHEET);
  const activity = ss.insertSheet(QBO_POST_FILING_SALES_TAX_GL.ACTIVITY_SHEET);

  const metadataRows = [
    ['Field','Value'],
    ['Version',QBO_POST_FILING_SALES_TAX_GL_VERSION],
    ['Evidence_Type',QBO_POST_FILING_SALES_TAX_GL.EVIDENCE_TYPE],
    ['Capture_Run_ID',runId],
    ['Captured_At',capturedAt],
    ['Window_Start_Date',startDate],
    ['Window_End_Date',endDate],
    ['Period_Key',filingContext ? filingContext.periodKey : ''],
    ['Filing_Confirmation_ID',filingContext ? filingContext.filingConfirmationId : ''],
    ['Filing_Run_ID',filingContext ? filingContext.filingRunId : ''],
    ['Filing_Date_Source',filingContext ? filingContext.filingDateSource : ''],
    ['Report_Name',valueOrBlank_(header.ReportName)],
    ['Report_Basis',valueOrBlank_(header.ReportBasis)],
    ['Account_Name',QBO_POST_FILING_SALES_TAX_GL.ACCOUNT_NAME],
    ['Account_ID',QBO_POST_FILING_SALES_TAX_GL.ACCOUNT_ID],
    ['Server_Data_Row_Count',serverCount],
    ['Retained_Row_Count',evidenceRows.length],
    ['Excluded_Row_Count',serverCount - evidenceRows.length],
    ['Retained_Transaction_Types',QBO_POST_FILING_SALES_TAX_GL.RETAINED_TRANSACTION_TYPES.join(' | ')],
    ['Filter_By_Amount',false],
    ['Filter_By_Transaction_ID',false],
    ['Filter_By_Memo',false],
    ['Production_General_Ledger_Modified',false],
    ['Evidence_Contract','Server account/date scope; locally retain only QBO-returned Sales Tax Payment or Sales Tax Adjustment rows.']
  ];
  metadata.getRange(1,1,metadataRows.length,2).setValues(metadataRows);
  metadata.getDataRange().setWrap(false);

  activity.getRange(1,1,1,QBO_POST_FILING_SALES_TAX_GL_ACTIVITY_HEADERS.length)
    .setValues([QBO_POST_FILING_SALES_TAX_GL_ACTIVITY_HEADERS.slice()]);
  if (evidenceRows.length) {
    activity.getRange(2,1,evidenceRows.length,QBO_POST_FILING_SALES_TAX_GL_ACTIVITY_HEADERS.length)
      .setValues(evidenceRows);
  }
  activity.getDataRange().setWrap(false);
  SpreadsheetApp.flush();
  return {id:ss.getId(), name:ss.getName(), url:ss.getUrl()};
}


/**
 * App 50 acquisition boundary.
 *
 * App 50 does not resolve filing periods, filing confirmations, or App 21
 * workbook structures. The caller supplies the governed evidence window and
 * optional opaque lineage metadata.
 */
function captureQboPostFilingSalesTaxGlActivityForRequest(request) {
  if (!request || typeof request !== 'object') {
    throw new Error('POST_FILING_GL_REQUEST_REQUIRED');
  }

  const periodKey = String(request.periodKey || '').trim();
  const startDate = String(request.windowStartDate || '').trim();
  const endDate = String(request.windowEndDate || '').trim();

  if (!/^\d{4}$/.test(periodKey)) {
    throw new Error('POST_FILING_GL_INVALID_PERIOD_KEY: ' + periodKey);
  }
  validateQboGeneralLedgerPeriod_(startDate, endDate);

  const context = {
    periodKey: periodKey,
    filingConfirmationId: String(request.filingConfirmationId || '').trim(),
    filingRunId: String(request.filingRunId || '').trim(),
    filingDateSource: String(request.windowStartDateSource || 'CALLER_SUPPLIED').trim()
  };

  safeLog_(
    '[POST-FILING SALES TAX GL] REQUEST ACCEPTED | period=' + periodKey +
    ' | window=' + startDate + '..' + endDate +
    ' | boundaryOwner=CALLER' +
    ' | app21SchemaKnowledge=false'
  );

  return captureQboPostFilingSalesTaxGlActivity(startDate, endDate, context);
}

/** Read-only contract test; no QBO call and no Drive artifact. */
function testQboPostFilingSalesTaxGlActivityContract() {
  const checks = [];
  function check(name, ok, detail) {
    checks.push({name:name, pass:!!ok, detail:String(detail || '')});
  }
  check('ACCOUNT_ID_LOCKED', QBO_POST_FILING_SALES_TAX_GL.ACCOUNT_ID === '221', QBO_POST_FILING_SALES_TAX_GL.ACCOUNT_ID);
  check('ACCOUNT_NAME_LOCKED', QBO_POST_FILING_SALES_TAX_GL.ACCOUNT_NAME === 'Texas Comptroller Payable', QBO_POST_FILING_SALES_TAX_GL.ACCOUNT_NAME);
  check('CASH_BASIS', QBO_POST_FILING_SALES_TAX_GL.ACCOUNTING_METHOD === 'Cash', QBO_POST_FILING_SALES_TAX_GL.ACCOUNTING_METHOD);
  check('PAYMENT_RETAINED', QBO_POST_FILING_SALES_TAX_GL.RETAINED_TRANSACTION_TYPES.indexOf('Sales Tax Payment') >= 0, '');
  check('ADJUSTMENT_RETAINED', QBO_POST_FILING_SALES_TAX_GL.RETAINED_TRANSACTION_TYPES.indexOf('Sales Tax Adjustment') >= 0, '');
  check('ONLY_TWO_TYPES', QBO_POST_FILING_SALES_TAX_GL.RETAINED_TRANSACTION_TYPES.length === 2, QBO_POST_FILING_SALES_TAX_GL.RETAINED_TRANSACTION_TYPES.join('|'));
  check('SEPARATE_EVIDENCE_TYPE', QBO_POST_FILING_SALES_TAX_GL.EVIDENCE_TYPE === 'POST_FILING_GL_ACTIVITY', QBO_POST_FILING_SALES_TAX_GL.EVIDENCE_TYPE);
  check('NO_APP21_FILING_ASSET_KNOWLEDGE', !QBO_POST_FILING_SALES_TAX_GL.FILING_DATA_ASSET_KEY, 'caller owns filing source');
  check('NO_APP21_SHEET_KNOWLEDGE', !QBO_POST_FILING_SALES_TAX_GL.FILING_CONFIRMATIONS_SHEET, 'caller owns filing schema');

  const failed = checks.filter(function(x){return !x.pass;});
  const result = {version:QBO_POST_FILING_SALES_TAX_GL_VERSION, pass:failed.length===0, passed:checks.length-failed.length, total:checks.length, checks:checks};
  safeLog_('[POST-FILING SALES TAX GL CONTRACT] ' + JSON.stringify(result));
  if (failed.length) throw new Error('Post-filing sales tax GL contract failed: ' + failed.map(function(x){return x.name;}).join(', '));
  return result;
}

/**
 * Runtime validation wrapper for August 2026 only.
 *
 * TEST INPUTS:
 *   periodKey       = 2608
 *   windowStartDate = 2026-09-19
 *
 * These values validate App 50 acquisition only. They are not the production
 * filing-period resolver. Production App 21 must supply the governed request.
 */
function testCaptureQboPostFilingSalesTaxGlActivity2608() {
  const captureDate = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );

  return captureQboPostFilingSalesTaxGlActivityForRequest({
    periodKey: '2608',
    windowStartDate: '2026-09-19',
    windowEndDate: captureDate,
    windowStartDateSource: 'RUNTIME_TEST_INPUT'
  });
}

