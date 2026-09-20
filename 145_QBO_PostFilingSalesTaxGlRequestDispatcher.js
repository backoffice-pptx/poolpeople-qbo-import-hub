/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 145_QBO_PostFilingSalesTaxGlRequestDispatcher.js
 * Version     : 1.5.194
 * Purpose     : Governed request-queue transport for POST_FILING_GL_ACTIVITY.
 *
 * Boundary:
 *   - App 50 does NOT know App 21 workbook/sheet schemas.
 *   - Caller owns Period_Key, filing date, and opaque filing lineage.
 *   - App 50 owns QBO acquisition and immutable evidence publication.
 *   - Application 05 is used only to resolve the governed queue asset.
 *
 * Public:
 *   bootstrapQboPostFilingGlRequestQueue()
 *   testQboPostFilingGlRequestQueueContract()
 *   dispatchNextQboPostFilingGlRequest()
 * ============================================================================ */

const QBO_POST_FILING_GL_QUEUE_VERSION = '1.5.194';

const QBO_POST_FILING_GL_QUEUE = Object.freeze({
  ASSET_KEY: 'QBO_POST_FILING_GL_REQUEST_QUEUE',
  ASSET_TYPE: 'Spreadsheet',
  ENVIRONMENT: 'PROD',
  SHEET_NAME: '01_Requests',
  STATUS_PENDING: 'PENDING',
  STATUS_RUNNING: 'RUNNING',
  STATUS_COMPLETE: 'COMPLETE',
  STATUS_FAILED: 'FAILED'
});

const QBO_POST_FILING_GL_QUEUE_HEADERS = Object.freeze([
  'Request_ID',
  'Requested_At',
  'Requested_By_Application',
  'Period_Key',
  'Window_Start_Date',
  'Window_End_Date',
  'Filing_Confirmation_ID',
  'Filing_Run_ID',
  'Window_Start_Date_Source',
  'Request_Status',
  'Claimed_At',
  'Completed_At',
  'Capture_Run_ID',
  'Evidence_Spreadsheet_ID',
  'Evidence_Spreadsheet_Name',
  'Server_Data_Row_Count',
  'Retained_Row_Count',
  'Excluded_Row_Count',
  'Error_Message'
]);

/**
 * One-time bootstrap. Creates the queue workbook only.
 * It intentionally does NOT mutate the Application 05 asset registry.
 *
 * @return {!Object}
 */
function bootstrapQboPostFilingGlRequestQueue() {
  const ss = SpreadsheetApp.create('QBO_Post_Filing_GL_Request_Queue');
  const sheet = ss.getSheets()[0];
  sheet.setName(QBO_POST_FILING_GL_QUEUE.SHEET_NAME);
  sheet.getRange(1, 1, 1, QBO_POST_FILING_GL_QUEUE_HEADERS.length)
      .setValues([QBO_POST_FILING_GL_QUEUE_HEADERS.slice()]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, QBO_POST_FILING_GL_QUEUE_HEADERS.length)
      .setFontWeight('bold');
  sheet.getDataRange().setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);

  const result = {
    version: QBO_POST_FILING_GL_QUEUE_VERSION,
    assetKey: QBO_POST_FILING_GL_QUEUE.ASSET_KEY,
    assetType: QBO_POST_FILING_GL_QUEUE.ASSET_TYPE,
    environment: QBO_POST_FILING_GL_QUEUE.ENVIRONMENT,
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    sheetName: sheet.getName(),
    registryMutationPerformed: false
  };

  console.log('[POST-FILING GL QUEUE] BOOTSTRAP COMPLETE | ' + JSON.stringify(result));
  return result;
}

/**
 * Read-only structural contract test.
 *
 * @return {!Object}
 */
function testQboPostFilingGlRequestQueueContract() {
  const checks = [];
  function check(name, passed, detail) {
    checks.push({name:name, passed:!!passed, detail:String(detail || '')});
    if (!passed) throw new Error('POST_FILING_GL_QUEUE_CONTRACT_FAIL: ' + name + ' | ' + detail);
  }

  check('ASSET_KEY',
      QBO_POST_FILING_GL_QUEUE.ASSET_KEY === 'QBO_POST_FILING_GL_REQUEST_QUEUE',
      QBO_POST_FILING_GL_QUEUE.ASSET_KEY);
  check('ASSET_TYPE',
      QBO_POST_FILING_GL_QUEUE.ASSET_TYPE === 'Spreadsheet',
      QBO_POST_FILING_GL_QUEUE.ASSET_TYPE);
  check('ENVIRONMENT',
      QBO_POST_FILING_GL_QUEUE.ENVIRONMENT === 'PROD',
      QBO_POST_FILING_GL_QUEUE.ENVIRONMENT);
  check('ACQUISITION_API_AVAILABLE',
      typeof captureQboPostFilingSalesTaxGlActivityForRequest === 'function',
      typeof captureQboPostFilingSalesTaxGlActivityForRequest);
  check('NO_APP21_SCHEMA_CONSTANT',
      typeof QBO_POST_FILING_GL_QUEUE.FILING_CONFIRMATIONS_SHEET === 'undefined',
      'App 50 must not know App 21 filing sheet');
  check('REQUEST_WINDOW_REQUIRED',
      QBO_POST_FILING_GL_QUEUE_HEADERS.indexOf('Window_Start_Date') >= 0 &&
      QBO_POST_FILING_GL_QUEUE_HEADERS.indexOf('Window_End_Date') >= 0,
      'caller-supplied evidence window');
  check('OPAQUE_LINEAGE_SUPPORTED',
      QBO_POST_FILING_GL_QUEUE_HEADERS.indexOf('Filing_Confirmation_ID') >= 0 &&
      QBO_POST_FILING_GL_QUEUE_HEADERS.indexOf('Filing_Run_ID') >= 0,
      'opaque caller lineage');

  const result = {version:QBO_POST_FILING_GL_QUEUE_VERSION, passed:checks.length, checks:checks};
  console.log('[POST-FILING GL QUEUE] CONTRACT PASS | ' + JSON.stringify(result));
  return result;
}

/**
 * Claims and executes the oldest pending request.
 *
 * Lock scope is limited to queue claim/update. QBO acquisition occurs outside
 * the script lock so this dispatcher does not recreate the prior long-lock
 * contention problem.
 *
 * @return {!Object}
 */
function dispatchNextQboPostFilingGlRequest() {
  const claimed = qboPostFilingGlClaimNextRequest_();
  if (!claimed) {
    const idle = {version:QBO_POST_FILING_GL_QUEUE_VERSION, status:'IDLE', pendingRequestFound:false};
    console.log('[POST-FILING GL QUEUE] DISPATCH IDLE | no pending request');
    return idle;
  }

  console.log(
    '[POST-FILING GL QUEUE] CLAIMED | request=' + claimed.requestId +
    ' | period=' + claimed.periodKey +
    ' | window=' + claimed.windowStartDate + '..' + claimed.windowEndDate
  );

  try {
    const capture = captureQboPostFilingSalesTaxGlActivityForRequest({
      periodKey: claimed.periodKey,
      windowStartDate: claimed.windowStartDate,
      windowEndDate: claimed.windowEndDate,
      filingConfirmationId: claimed.filingConfirmationId,
      filingRunId: claimed.filingRunId,
      windowStartDateSource: claimed.windowStartDateSource
    });

    qboPostFilingGlFinishRequest_(claimed, capture, null);

    const result = {
      version: QBO_POST_FILING_GL_QUEUE_VERSION,
      status: QBO_POST_FILING_GL_QUEUE.STATUS_COMPLETE,
      requestId: claimed.requestId,
      captureRunId: capture.captureRunId,
      evidenceSpreadsheetId: capture.evidenceSpreadsheetId,
      serverDataRowCount: capture.serverDataRowCount,
      retainedRowCount: capture.retainedRowCount,
      excludedRowCount: capture.excludedRowCount
    };
    console.log('[POST-FILING GL QUEUE] DISPATCH COMPLETE | ' + JSON.stringify(result));
    return result;
  } catch (err) {
    qboPostFilingGlFinishRequest_(claimed, null, err);
    throw err;
  }
}

function qboPostFilingGlClaimNextRequest_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ctx = qboPostFilingGlOpenQueue_();
    const values = ctx.sheet.getDataRange().getValues();
    if (values.length < 2) return null;

    const idx = qboPostFilingGlHeaderIndex_(values[0]);
    qboPostFilingGlRequireHeaders_(idx);

    for (let r = 1; r < values.length; r++) {
      const status = String(values[r][idx.Request_Status] || '').trim().toUpperCase();
      if (status !== QBO_POST_FILING_GL_QUEUE.STATUS_PENDING) continue;

      const request = qboPostFilingGlParseRequest_(values[r], idx, r + 1, ctx);
      qboPostFilingGlValidateRequest_(request);

      const now = new Date();
      ctx.sheet.getRange(request.rowNumber, idx.Request_Status + 1)
          .setValue(QBO_POST_FILING_GL_QUEUE.STATUS_RUNNING);
      ctx.sheet.getRange(request.rowNumber, idx.Claimed_At + 1).setValue(now);
      SpreadsheetApp.flush();
      return request;
    }
    return null;
  } finally {
    lock.releaseLock();
  }
}

function qboPostFilingGlFinishRequest_(claimed, capture, error) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ctx = qboPostFilingGlOpenQueue_();
    const values = ctx.sheet.getDataRange().getValues();
    const idx = qboPostFilingGlHeaderIndex_(values[0]);
    qboPostFilingGlRequireHeaders_(idx);

    let rowNumber = 0;
    for (let r = 1; r < values.length; r++) {
      if (String(values[r][idx.Request_ID] || '').trim() === claimed.requestId) {
        rowNumber = r + 1;
        break;
      }
    }
    if (!rowNumber) throw new Error('POST_FILING_GL_REQUEST_NOT_FOUND_ON_FINISH: ' + claimed.requestId);

    const status = error ? QBO_POST_FILING_GL_QUEUE.STATUS_FAILED : QBO_POST_FILING_GL_QUEUE.STATUS_COMPLETE;
    const set = function(header, value) {
      ctx.sheet.getRange(rowNumber, idx[header] + 1).setValue(value);
    };

    set('Request_Status', status);
    set('Completed_At', new Date());

    if (capture) {
      set('Capture_Run_ID', capture.captureRunId || '');
      set('Evidence_Spreadsheet_ID', capture.evidenceSpreadsheetId || '');
      set('Evidence_Spreadsheet_Name', capture.evidenceSpreadsheetName || '');
      set('Server_Data_Row_Count', capture.serverDataRowCount);
      set('Retained_Row_Count', capture.retainedRowCount);
      set('Excluded_Row_Count', capture.excludedRowCount);
      set('Error_Message', '');
    } else {
      set('Error_Message', error && error.message ? error.message : String(error));
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

function qboPostFilingGlOpenQueue_() {
  if (typeof DataPlatform05 === 'undefined' ||
      typeof DataPlatform05.getConfiguredAssetReference !== 'function') {
    throw new Error('POST_FILING_GL_QUEUE_APP05_UNAVAILABLE');
  }

  const asset = DataPlatform05.getConfiguredAssetReference(
      QBO_POST_FILING_GL_QUEUE.ASSET_KEY,
      QBO_POST_FILING_GL_QUEUE.ASSET_TYPE,
      QBO_POST_FILING_GL_QUEUE.ENVIRONMENT
  );
  const id = asset && String(asset.ResourceIdentifier || '').trim();
  if (!id) throw new Error('POST_FILING_GL_QUEUE_ASSET_ID_MISSING');

  const ss = SpreadsheetApp.openById(id);
  const sheet = ss.getSheetByName(QBO_POST_FILING_GL_QUEUE.SHEET_NAME);
  if (!sheet) throw new Error('POST_FILING_GL_QUEUE_SHEET_MISSING: ' + QBO_POST_FILING_GL_QUEUE.SHEET_NAME);
  return {spreadsheet:ss, sheet:sheet, asset:asset};
}

function qboPostFilingGlHeaderIndex_(headers) {
  const idx = {};
  headers.forEach(function(h, i) { idx[String(h || '').trim()] = i; });
  return idx;
}

function qboPostFilingGlRequireHeaders_(idx) {
  QBO_POST_FILING_GL_QUEUE_HEADERS.forEach(function(h) {
    if (typeof idx[h] !== 'number') throw new Error('POST_FILING_GL_QUEUE_HEADER_MISSING: ' + h);
  });
}

function qboPostFilingGlParseRequest_(row, idx, rowNumber, ctx) {
  return {
    rowNumber: rowNumber,
    queueSpreadsheetId: ctx.spreadsheet.getId(),
    requestId: String(row[idx.Request_ID] || '').trim(),
    periodKey: String(row[idx.Period_Key] || '').trim(),
    windowStartDate: qboPostFilingGlDateCellToIso_(row[idx.Window_Start_Date]),
    windowEndDate: qboPostFilingGlDateCellToIso_(row[idx.Window_End_Date]),
    filingConfirmationId: String(row[idx.Filing_Confirmation_ID] || '').trim(),
    filingRunId: String(row[idx.Filing_Run_ID] || '').trim(),
    windowStartDateSource: String(row[idx.Window_Start_Date_Source] || '').trim()
  };
}

function qboPostFilingGlValidateRequest_(request) {
  if (!request.requestId) throw new Error('POST_FILING_GL_REQUEST_ID_MISSING');
  if (!/^\d{4}$/.test(request.periodKey)) {
    throw new Error('POST_FILING_GL_REQUEST_PERIOD_INVALID: ' + request.periodKey);
  }
  validateQboGeneralLedgerPeriod_(request.windowStartDate, request.windowEndDate);
}

function qboPostFilingGlDateCellToIso_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  throw new Error('POST_FILING_GL_REQUEST_DATE_INVALID: ' + text);
}
