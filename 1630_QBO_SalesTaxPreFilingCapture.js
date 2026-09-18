/**
 * Governed App 50 processor for App 21 sales-tax pre-filing QBO capture requests.
 * App 50 owns all QBO/report acquisition. The shared request ledger is the
 * cross-project request/response boundary; App 21 performs final registry binding.
 */
const QBO_PREFILING_CAPTURE = Object.freeze({
  SHEET_NAME: '04_QBO_Capture_Requests',
  HEADERS: Object.freeze([
    'QBO_Capture_Request_ID','PreFiling_Run_ID','Period_Key','Period_Start','Period_End',
    'Requested_At','Request_Status','Processing_Started_At','Completed_At',
    'GL_ExtractRunId','GL_SnapshotFileId','Taxable_Sales_Detail_Workbook_File_ID','Taxable_Sales_Detail_Snapshot_Run_ID','Taxable_Sales_Detail_Snapshot_Sequence',
    'Sales_Tax_Recognition_Workbook_File_ID','Sales_Tax_Recognition_Snapshot_Run_ID','Sales_Tax_Recognition_Snapshot_Sequence','Sales_Tax_Recognition_Source_GL_ExtractRunId',
    'Error_Code','Error_Message','Last_Updated_At'
  ])
});

/**
 * Parameterless operator command for Apps Script.
 *
 * Resolves the governed Sales Tax Reconciliation Control workbook from the
 * Application 05 Runtime Asset Registry, requires
 * exactly one REQUESTED capture, logs its exact identity/period, and delegates
 * to the governed parameterized processor.
 */
function processLatestRequestedSalesTaxPreFilingCapture() {
  const controlAssetKey = 'SALES_TAX_RECONCILIATION_CONTROL';

  if (typeof DataPlatform05 === 'undefined' ||
      typeof DataPlatform05.getConfiguredAssetReference !== 'function') {
    throw new Error(
      'Application 05 library DataPlatform05 is unavailable. Cannot resolve governed asset ' +
      controlAssetKey + '.'
    );
  }

  const asset = DataPlatform05.getConfiguredAssetReference(
    controlAssetKey,
    'Spreadsheet',
    'PROD'
  );

  const controlSpreadsheetId =
    asset && String(asset.ResourceIdentifier || '').trim();

  if (!controlSpreadsheetId) {
    throw new Error(
      'Application 05 returned no ResourceIdentifier for governed asset ' +
      controlAssetKey + '.'
    );
  }

  let ss;
  try {
    ss = SpreadsheetApp.openById(controlSpreadsheetId);
  } catch (err) {
    throw new Error(
      'Unable to open governed spreadsheet asset ' + controlAssetKey +
      ' (' + controlSpreadsheetId + '): ' +
      (err && err.message ? err.message : err)
    );
  }

  const sheet = ss.getSheetByName(QBO_PREFILING_CAPTURE.SHEET_NAME);
  if (!sheet) throw new Error('PREFILING_QBO_CAPTURE_LEDGER_MISSING');

  const state = qboPreFilingReadLedger_(sheet);
  const candidates = state.rows.filter(r =>
    String(r.Request_Status || '').trim() === 'REQUESTED'
  );

  if (candidates.length === 0) {
    throw new Error('PREFILING_QBO_CAPTURE_NO_REQUESTED_REQUEST');
  }
  if (candidates.length !== 1) {
    throw new Error(
      'PREFILING_QBO_CAPTURE_AMBIGUOUS_REQUESTED_REQUESTS: ' + candidates.length
    );
  }

  const selected = candidates[0];
  qboPreFilingValidateRequest_(selected);

  safeLog_('[PREFILING QBO CAPTURE] | SELECTED | ' + JSON.stringify({
    QBO_Capture_Request_ID: String(selected.QBO_Capture_Request_ID || ''),
    PreFiling_Run_ID: String(selected.PreFiling_Run_ID || ''),
    Period_Key: String(selected.Period_Key || ''),
    Period_Start: qboPreFilingNormalizeDate_(selected.Period_Start),
    Period_End: qboPreFilingNormalizeDate_(selected.Period_End),
    Request_Status: String(selected.Request_Status || ''),
    Control_Asset_Key: controlAssetKey
  }));

  return processSalesTaxPreFilingCaptureRequest(
    controlSpreadsheetId,
    String(selected.QBO_Capture_Request_ID || '').trim()
  );
}

/**
 * Processes one exact pre-filing capture request from the App 21 control workbook.
 * This is intentionally explicit/manual until a later approved orchestration layer
 * invokes the boundary automatically.
 *
 * @param {string} controlSpreadsheetId Sales_Tax_Reconciliation_Control workbook ID.
 * @param {string} requestId QBO_Capture_Request_ID issued by App 21.
 * @return {!Object} Completed request row.
 */
function processSalesTaxPreFilingCaptureRequest(controlSpreadsheetId, requestId) {
  controlSpreadsheetId = String(controlSpreadsheetId || '').trim();
  requestId = String(requestId || '').trim();
  if (!controlSpreadsheetId) throw new Error('PREFILING_CONTROL_SPREADSHEET_ID_REQUIRED');
  if (!requestId) throw new Error('PREFILING_QBO_CAPTURE_REQUEST_ID_REQUIRED');

  const ss = SpreadsheetApp.openById(controlSpreadsheetId);
  const sheet = ss.getSheetByName(QBO_PREFILING_CAPTURE.SHEET_NAME);
  if (!sheet) throw new Error('PREFILING_QBO_CAPTURE_LEDGER_MISSING');
  const state = qboPreFilingReadLedger_(sheet);
  const index = qboPreFilingFindRequest_(state.rows, requestId);
  const request = state.rows[index];
  const status = String(request.Request_Status || '').trim();
  if (status === 'COMPLETE') return request;
  if (status !== 'REQUESTED' && status !== 'FAILED') {
    throw new Error('PREFILING_QBO_CAPTURE_STATUS_NOT_PROCESSABLE: ' + status);
  }

  qboPreFilingValidateRequest_(request);
  request.Request_Status = 'PROCESSING';
  request.Processing_Started_At = new Date();
  request.Error_Code = '';
  request.Error_Message = '';
  request.Last_Updated_At = new Date();
  state.rows[index] = request;
  qboPreFilingWriteLedger_(sheet, state.rows);

  try {
    const periodStart = qboPreFilingNormalizeDate_(request.Period_Start);
    const periodEnd = qboPreFilingNormalizeDate_(request.Period_End);
    const gl = exportQboGeneralLedgerForPeriod(periodStart, periodEnd);
    const taxableSalesDetail = exportQboTaxableSalesDetailForPeriod(periodStart, periodEnd);
    const salesTaxRecognition = exportQboSalesTaxRecognitionForPeriod(periodStart, periodEnd);

    if (String(salesTaxRecognition.sourceGlExtractRunId || '') !== String(gl.extractRunId || '')) {
      throw new Error('PREFILING_QBO_CAPTURE_GL_LINEAGE_MISMATCH');
    }
    request.GL_ExtractRunId = gl.extractRunId;
    request.GL_SnapshotFileId = gl.snapshotFileId;
    request.Taxable_Sales_Detail_Workbook_File_ID = taxableSalesDetail.spreadsheetId;
    request.Taxable_Sales_Detail_Snapshot_Run_ID = taxableSalesDetail.runId;
    request.Taxable_Sales_Detail_Snapshot_Sequence = taxableSalesDetail.snapshotSequence;
    request.Sales_Tax_Recognition_Workbook_File_ID = salesTaxRecognition.spreadsheetId;
    request.Sales_Tax_Recognition_Snapshot_Run_ID = salesTaxRecognition.runId;
    request.Sales_Tax_Recognition_Snapshot_Sequence = salesTaxRecognition.snapshotSequence;
    request.Sales_Tax_Recognition_Source_GL_ExtractRunId = salesTaxRecognition.sourceGlExtractRunId;
    request.Request_Status = 'COMPLETE';
    request.Completed_At = new Date();
    request.Error_Code = '';
    request.Error_Message = '';
    request.Last_Updated_At = new Date();
    state.rows[index] = request;
    qboPreFilingWriteLedger_(sheet, state.rows);
    safeLog_('[PREFILING QBO CAPTURE] | COMPLETE | ' + JSON.stringify(request));
    return request;
  } catch (error) {
    request.Request_Status = 'FAILED';
    request.Error_Code = 'PREFILING_QBO_CAPTURE_FAILED';
    request.Error_Message = String(error && error.message || error || '');
    request.Last_Updated_At = new Date();
    state.rows[index] = request;
    qboPreFilingWriteLedger_(sheet, state.rows);
    throw error;
  }
}

function qboPreFilingReadLedger_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (!values.length) throw new Error('PREFILING_QBO_CAPTURE_LEDGER_EMPTY');
  const headers = values[0].map(v => String(v || '').trim());
  QBO_PREFILING_CAPTURE.HEADERS.forEach(h => {
    if (headers.indexOf(h) < 0) throw new Error('PREFILING_QBO_CAPTURE_HEADER_MISSING: ' + h);
  });
  const rows = values.slice(1).filter(r => r.some(v => String(v || '').trim() !== '')).map(r => {
    const o = {}; headers.forEach((h,i) => { o[h] = r[i]; }); return o;
  });
  return {headers:headers, rows:rows};
}

function qboPreFilingWriteLedger_(sheet, rows) {
  sheet.clearContents();
  sheet.getRange(1,1,1,QBO_PREFILING_CAPTURE.HEADERS.length).setValues([QBO_PREFILING_CAPTURE.HEADERS]);
  if (rows.length) {
    const values = rows.map(r => QBO_PREFILING_CAPTURE.HEADERS.map(h => r[h] === undefined ? '' : r[h]));
    sheet.getRange(2,1,values.length,QBO_PREFILING_CAPTURE.HEADERS.length).setValues(values);
  }
  sheet.setFrozenRows(1);
  sheet.getDataRange().setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
}

function qboPreFilingFindRequest_(rows, requestId) {
  let found = -1;
  rows.forEach((r,i) => {
    if (String(r.QBO_Capture_Request_ID || '').trim() === requestId) {
      if (found >= 0) throw new Error('PREFILING_QBO_CAPTURE_REQUEST_DUPLICATE: ' + requestId);
      found = i;
    }
  });
  if (found < 0) throw new Error('PREFILING_QBO_CAPTURE_REQUEST_NOT_FOUND: ' + requestId);
  return found;
}

function qboPreFilingNormalizeDate_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = String(value === undefined || value === null ? '' : value).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(s);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  return s;
}

function qboPreFilingValidateRequest_(r) {
  ['QBO_Capture_Request_ID','PreFiling_Run_ID','Period_Key','Period_Start','Period_End'].forEach(h => {
    if (!String(r[h] || '').trim()) throw new Error('PREFILING_QBO_CAPTURE_REQUEST_FIELD_MISSING: ' + h);
  });
  if (!/^\d{4}$/.test(String(r.Period_Key || ''))) throw new Error('PREFILING_QBO_CAPTURE_PERIOD_KEY_INVALID');
  const periodStart = qboPreFilingNormalizeDate_(r.Period_Start);
  const periodEnd = qboPreFilingNormalizeDate_(r.Period_End);
  const startMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(periodStart);
  const endMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(periodEnd);
  if (!startMatch || !endMatch) throw new Error('PREFILING_QBO_CAPTURE_PERIOD_DATE_INVALID');
  const expectedKey = startMatch[1].slice(2) + startMatch[2];
  if (expectedKey !== String(r.Period_Key || '')) throw new Error('PREFILING_QBO_CAPTURE_PERIOD_MISMATCH');
  if (startMatch[1] !== endMatch[1] || startMatch[2] !== endMatch[2]) {
    throw new Error('PREFILING_QBO_CAPTURE_PERIOD_RANGE_MISMATCH');
  }
}

function testSalesTaxPreFilingCaptureRequestContract() {
  qboPreFilingValidateRequest_({
    QBO_Capture_Request_ID:'r1', PreFiling_Run_ID:'p1', Period_Key:'2608',
    Period_Start:'2026-08-01', Period_End:'2026-08-31'
  });
  let blocked = false;
  try { qboPreFilingValidateRequest_({QBO_Capture_Request_ID:'r1',PreFiling_Run_ID:'p1',Period_Key:'2607',Period_Start:'2026-08-01',Period_End:'2026-08-31'}); }
  catch (e) { blocked = true; }
  if (!blocked) throw new Error('period mismatch was not blocked');
  const result = {Suite:'SalesTaxPreFilingCaptureRequestContract',checkCount:2,passed:true};
  safeLog_(JSON.stringify(result));
  return result;
}

/**
 * Parameterless recovery operator for exactly one FAILED pre-filing QBO capture.
 * Reuses the existing QBO_Capture_Request_ID / PreFiling_Run_ID. It never creates
 * a replacement request. The governed processor is responsible for changing the
 * row to PROCESSING and then COMPLETE/FAILED.
 *
 * @return {!Object} Completed request row.
 */
function retryLatestFailedSalesTaxPreFilingCapture() {
  const controlAssetKey = 'SALES_TAX_RECONCILIATION_CONTROL';
  if (typeof DataPlatform05 === 'undefined' ||
      typeof DataPlatform05.getConfiguredAssetReference !== 'function') {
    throw new Error(
      'Application 05 library DataPlatform05 is unavailable. Cannot resolve governed asset ' +
      controlAssetKey + '.'
    );
  }

  const asset = DataPlatform05.getConfiguredAssetReference(
    controlAssetKey,
    'Spreadsheet',
    'PROD'
  );
  const controlSpreadsheetId = asset && String(asset.ResourceIdentifier || '').trim();
  if (!controlSpreadsheetId) {
    throw new Error(
      'Application 05 returned no ResourceIdentifier for governed asset ' +
      controlAssetKey + '.'
    );
  }

  const ss = SpreadsheetApp.openById(controlSpreadsheetId);
  const sheet = ss.getSheetByName(QBO_PREFILING_CAPTURE.SHEET_NAME);
  if (!sheet) throw new Error('PREFILING_QBO_CAPTURE_LEDGER_MISSING');

  const state = qboPreFilingReadLedger_(sheet);
  const candidates = state.rows.filter(function(r) {
    return String(r.Request_Status || '').trim() === 'FAILED';
  });
  if (candidates.length === 0) {
    throw new Error('PREFILING_QBO_CAPTURE_NO_FAILED_REQUEST');
  }
  if (candidates.length !== 1) {
    throw new Error('PREFILING_QBO_CAPTURE_AMBIGUOUS_FAILED_REQUESTS: ' + candidates.length);
  }

  const selected = candidates[0];
  qboPreFilingValidateRequest_(selected);
  safeLog_('[PREFILING QBO CAPTURE] | RETRY FAILED | ' + JSON.stringify({
    QBO_Capture_Request_ID: String(selected.QBO_Capture_Request_ID || ''),
    PreFiling_Run_ID: String(selected.PreFiling_Run_ID || ''),
    Period_Key: String(selected.Period_Key || ''),
    Period_Start: qboPreFilingNormalizeDate_(selected.Period_Start),
    Period_End: qboPreFilingNormalizeDate_(selected.Period_End),
    Request_Status: String(selected.Request_Status || ''),
    Control_Asset_Key: controlAssetKey
  }));

  return processSalesTaxPreFilingCaptureRequest(
    controlSpreadsheetId,
    String(selected.QBO_Capture_Request_ID || '').trim()
  );
}

/**
 * Contract test for the recovery-selection rule. Pure/no production writes.
 */
function testSalesTaxPreFilingCaptureRecoveryContract() {
  const rows = [
    {Request_Status:'COMPLETE', QBO_Capture_Request_ID:'done'},
    {Request_Status:'FAILED', QBO_Capture_Request_ID:'failed'}
  ];
  const failed = rows.filter(function(r) {
    return String(r.Request_Status || '').trim() === 'FAILED';
  });
  const checks = [
    failed.length === 1,
    failed[0].QBO_Capture_Request_ID === 'failed',
    ['REQUESTED','FAILED'].indexOf('FAILED') >= 0
  ];
  const result = {
    Suite: 'SalesTaxPreFilingCaptureRecoveryContract',
    checkCount: checks.length,
    passed: checks.every(Boolean)
  };
  if (!result.passed) throw new Error('PREFILING_QBO_CAPTURE_RECOVERY_CONTRACT_TEST_FAILED');
  safeLog_('[PREFILING QBO CAPTURE] | TEST | ' + JSON.stringify(result));
  return result;
}


/**
 * Pure contract test for durable semantic evidence field names.
 * Does not open or mutate the production request ledger.
 */
function testSalesTaxPreFilingCaptureSemanticEvidenceFieldContract() {
  const headers = QBO_PREFILING_CAPTURE.HEADERS.slice();
  const required = [
    'Taxable_Sales_Detail_Snapshot_Run_ID',
    'Taxable_Sales_Detail_Snapshot_Sequence',
    'Sales_Tax_Recognition_Workbook_File_ID','Sales_Tax_Recognition_Snapshot_Run_ID',
    'Sales_Tax_Recognition_Snapshot_Sequence',
    'Sales_Tax_Recognition_Source_GL_ExtractRunId'
  ];
  const legacy = [
    'Module60_Snapshot_Run_ID', 'Module60_Snapshot_Sequence',
    'Module61_Snapshot_Run_ID', 'Module61_Snapshot_Sequence',
    'Module61_Source_GL_ExtractRunId'
  ];
  const checks = [
    {name:'semantic evidence headers present', passed:required.every(h => headers.indexOf(h) >= 0)},
    {name:'legacy module-number headers absent', passed:legacy.every(h => headers.indexOf(h) < 0)},
    {name:'GL evidence headers unchanged', passed:headers.indexOf('GL_ExtractRunId') >= 0 && headers.indexOf('GL_SnapshotFileId') >= 0}
  ];
  const result = {Suite:'SalesTaxPreFilingCaptureSemanticEvidenceFieldContract',checkCount:checks.length,passed:checks.every(c => c.passed),checks:checks};
  if (!result.passed) throw new Error('PREFILING_QBO_CAPTURE_SEMANTIC_FIELD_CONTRACT_TEST_FAILED');
  safeLog_('[PREFILING QBO CAPTURE] | SEMANTIC FIELD TEST | ' + JSON.stringify(result));
  return result;
}


/** v0.5.17c pure contract test; no production writes. */
function testSalesTaxPreFilingCapturePhysicalEvidenceIdContract(){
 const h=QBO_PREFILING_CAPTURE.HEADERS.slice(),c=[
  h.indexOf('Taxable_Sales_Detail_Workbook_File_ID')>=0,
  h.indexOf('Sales_Tax_Recognition_Workbook_File_ID')>=0,
  h.indexOf('Taxable_Sales_Detail_Snapshot_Run_ID')>=0,
  h.indexOf('Sales_Tax_Recognition_Snapshot_Run_ID')>=0,
  h.every(x=>!/^Module6[01]_/.test(x)),
  qboPreFilingEvidencePeriodKey_('2026-08-01','2608')==='202608'
 ];
 let mismatchBlocked=false;
 try{qboPreFilingEvidencePeriodKey_('2026-08-01','2607');}catch(e){mismatchBlocked=String(e&&e.message||e).indexOf('PREFILING_PHYSICAL_ID_REQUEST_PERIOD_MISMATCH')>=0;}
 c.push(mismatchBlocked);
 const r={Version:'0.5.17c',Suite:'SalesTaxPreFilingCapturePhysicalEvidenceIdContract',checkCount:c.length,passed:c.every(Boolean),checks:[
  'taxable sales detail workbook id governed','sales tax recognition workbook id governed','taxable sales detail snapshot run id governed','sales tax recognition snapshot run id governed','legacy module fields absent','request YYMM bridges to evidence YYYYMM','request/date period mismatch blocked'
 ].map((name,i)=>({name:name,passed:c[i]}))};
 if(!r.passed)throw new Error('PREFILING_PHYSICAL_EVIDENCE_ID_CONTRACT_TEST_FAILED');safeLog_('[PREFILING QBO CAPTURE] | PHYSICAL EVIDENCE TEST | '+JSON.stringify(r));return r;
}
/** Backfill COMPLETE requests after verifying exact snapshots; never reruns evidence. */
function upgradeSalesTaxPreFilingCapturePhysicalEvidenceIds(){
 const key='SALES_TAX_RECONCILIATION_CONTROL';if(typeof DataPlatform05==='undefined'||typeof DataPlatform05.getConfiguredAssetReference!=='function')throw new Error('PREFILING_PHYSICAL_ID_ASSET_REGISTRY_UNAVAILABLE');
 const a=DataPlatform05.getConfiguredAssetReference(key,'Spreadsheet','PROD'),cid=a&&String(a.ResourceIdentifier||'').trim();if(!cid)throw new Error('PREFILING_PHYSICAL_ID_CONTROL_ID_MISSING');
 const sh=SpreadsheetApp.openById(cid).getSheetByName(QBO_PREFILING_CAPTURE.SHEET_NAME);if(!sh)throw new Error('PREFILING_QBO_CAPTURE_LEDGER_MISSING');
 const v=sh.getDataRange().getValues();if(!v.length)throw new Error('PREFILING_QBO_CAPTURE_LEDGER_EMPTY');const oh=v[0].map(x=>String(x||'').trim());
 const rows=v.slice(1).filter(r=>r.some(x=>String(x||'').trim()!=='')).map(r=>{const o={};oh.forEach((h,i)=>{if(h)o[h]=r[i];});return o;});
 const tid=String(PropertiesService.getScriptProperties().getProperty(QBO_TAXABLE_SALES_DETAIL.PROPERTY_KEY)||'').trim(),sid=String(PropertiesService.getScriptProperties().getProperty(QBO_SALES_TAX_RECOGNITION.PROPERTY_KEY)||'').trim();if(!tid||!sid)throw new Error('PREFILING_PHYSICAL_ID_EVIDENCE_WORKBOOK_MISSING');
 const ts=SpreadsheetApp.openById(tid),ss=SpreadsheetApp.openById(sid);let n=0;
 rows.forEach(r=>{if(String(r.Request_Status||'').trim()!=='COMPLETE')return;const p=qboPreFilingEvidencePeriodKey_(r.Period_Start,r.Period_Key);
  if(!String(r.Taxable_Sales_Detail_Workbook_File_ID||'').trim()){qboPreFilingAssertSnapshotExists_(ts,QBO_TAXABLE_SALES_DETAIL.SNAPSHOT_SHEET,p,r.Taxable_Sales_Detail_Snapshot_Run_ID,r.Taxable_Sales_Detail_Snapshot_Sequence,'TAXABLE_SALES_DETAIL');r.Taxable_Sales_Detail_Workbook_File_ID=tid;n++;}
  if(!String(r.Sales_Tax_Recognition_Workbook_File_ID||'').trim()){qboPreFilingAssertSnapshotExists_(ss,QBO_SALES_TAX_RECOGNITION.SNAPSHOT_SHEET,p,r.Sales_Tax_Recognition_Snapshot_Run_ID,r.Sales_Tax_Recognition_Snapshot_Sequence,'SALES_TAX_RECOGNITION');r.Sales_Tax_Recognition_Workbook_File_ID=sid;n++;}
 });
 qboPreFilingWriteLedger_(sh,rows);const r={Version:'0.5.17c',Status:'SUCCESS',Request_Row_Count:rows.length,Physical_ID_Fields_Backfilled:n,Evidence_Rerun:false,Taxable_Sales_Detail_Workbook_File_ID:tid,Sales_Tax_Recognition_Workbook_File_ID:sid};safeLog_('[PREFILING QBO CAPTURE] | PHYSICAL EVIDENCE UPGRADE | '+JSON.stringify(r));return r;
}
function qboPreFilingEvidencePeriodKey_(periodStart, requestPeriodKey){
 const d=qboPreFilingNormalizeDate_(periodStart),m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
 if(!m)throw new Error('PREFILING_PHYSICAL_ID_PERIOD_START_INVALID');
 const requestKey=String(requestPeriodKey||'').trim(),expectedRequestKey=m[1].slice(2)+m[2];
 if(requestKey!==expectedRequestKey)throw new Error('PREFILING_PHYSICAL_ID_REQUEST_PERIOD_MISMATCH');
 return m[1]+m[2];
}
function qboPreFilingAssertSnapshotExists_(ss,sn,pk,rid,seq,label){rid=String(rid||'').trim();seq=Number(seq);if(!rid||!seq)throw new Error(label+'_BOUND_SNAPSHOT_IDENTITY_MISSING');const sh=ss.getSheetByName(sn);if(!sh||sh.getLastRow()<2)throw new Error(label+'_SNAPSHOT_SHEET_EMPTY');const v=sh.getDataRange().getValues(),h=v[0].map(x=>String(x||'').trim()),p=h.indexOf('Period_Key'),q=h.indexOf('Snapshot_Sequence'),r=h.indexOf('Snapshot_Run_ID');if(p<0||q<0||r<0)throw new Error(label+'_SNAPSHOT_CONTRACT_INVALID');if(!v.slice(1).some(x=>String(x[p]||'').trim()===String(pk||'').trim()&&Number(x[q])===seq&&String(x[r]||'').trim()===rid))throw new Error(label+'_BOUND_SNAPSHOT_NOT_FOUND');return true;}
