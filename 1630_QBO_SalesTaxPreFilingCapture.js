/**
 * Governed App 50 processor for App 21 sales-tax QBO capture requests. Version 1.5.200.
 * App 50 owns all QBO/report acquisition. The shared request ledger is the
 * cross-project request/response boundary; App 21 performs final registry binding.
 */
const QBO_PREFILING_CAPTURE = Object.freeze({
  SHEET_NAME: '04_QBO_Capture_Requests',
  HEADERS: Object.freeze([
    'QBO_Capture_Request_ID','Capture_Context_Type','Capture_Context_ID','PreFiling_Run_ID','Period_Key','Period_Start','Period_End',
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
function processLatestRequestedSalesTaxQboCapture() {
  return processLatestRequestedSalesTaxPreFilingCapture();
}

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
    Capture_Context_Type: String(selected.Capture_Context_Type || ''),
    Capture_Context_ID: String(selected.Capture_Context_ID || ''),
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

    let gl;
    if (String(request.GL_ExtractRunId || '').trim() && String(request.GL_SnapshotFileId || '').trim()) {
      gl = {extractRunId:String(request.GL_ExtractRunId).trim(),snapshotFileId:String(request.GL_SnapshotFileId).trim()};
      safeLog_('[PREFILING QBO CAPTURE] | RESUME | GL checkpoint=' + gl.extractRunId);
    } else {
      gl = exportQboGeneralLedgerForPeriod(periodStart, periodEnd);
      request.GL_ExtractRunId = gl.extractRunId;
      request.GL_SnapshotFileId = gl.snapshotFileId;
      request.Last_Updated_At = new Date();
      state.rows[index] = request; qboPreFilingWriteLedger_(sheet, state.rows);
    }

    let taxableSalesDetail;
    if (String(request.Taxable_Sales_Detail_Snapshot_Run_ID || '').trim() && String(request.Taxable_Sales_Detail_Workbook_File_ID || '').trim()) {
      taxableSalesDetail = {runId:String(request.Taxable_Sales_Detail_Snapshot_Run_ID).trim(),spreadsheetId:String(request.Taxable_Sales_Detail_Workbook_File_ID).trim(),snapshotSequence:request.Taxable_Sales_Detail_Snapshot_Sequence};
      safeLog_('[PREFILING QBO CAPTURE] | RESUME | TAXABLE SALES DETAIL checkpoint=' + taxableSalesDetail.runId);
    } else {
      taxableSalesDetail = exportQboTaxableSalesDetailForPeriod(periodStart, periodEnd);
      request.Taxable_Sales_Detail_Workbook_File_ID = taxableSalesDetail.spreadsheetId;
      request.Taxable_Sales_Detail_Snapshot_Run_ID = taxableSalesDetail.runId;
      request.Taxable_Sales_Detail_Snapshot_Sequence = taxableSalesDetail.snapshotSequence;
      request.Last_Updated_At = new Date();
      state.rows[index] = request; qboPreFilingWriteLedger_(sheet, state.rows);
    }

    const salesTaxRecognition = exportQboSalesTaxRecognitionForPeriod(periodStart, periodEnd, gl.extractRunId);

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

function qboPreFilingCaptureContext_(r) {
  let type=String(r.Capture_Context_Type||'').trim().toUpperCase();
  let id=String(r.Capture_Context_ID||'').trim();
  const pre=String(r.PreFiling_Run_ID||'').trim();
  if(!type && pre){type='PREFILING';id=id||pre;}
  if(['PREFILING','CURRENT_ASOF'].indexOf(type)<0) throw new Error('QBO_CAPTURE_CONTEXT_TYPE_INVALID: '+type);
  if(!id) throw new Error('QBO_CAPTURE_CONTEXT_ID_REQUIRED');
  if(type==='PREFILING'){
    if(!pre) throw new Error('PREFILING_RUN_ID_REQUIRED');
    if(id!==pre) throw new Error('QBO_CAPTURE_CONTEXT_ID_MISMATCH');
  } else if(pre) throw new Error('CURRENT_ASOF_PREFILING_RUN_ID_FORBIDDEN');
  return {type:type,id:id};
}

function qboPreFilingValidateRequest_(r) {
  qboPreFilingCaptureContext_(r);
  ['QBO_Capture_Request_ID','Period_Key','Period_Start','Period_End'].forEach(h => {
    if (!String(r[h] || '').trim()) throw new Error('QBO_CAPTURE_REQUEST_FIELD_MISSING: ' + h);
  });
  if (!/^\d{4}$/.test(String(r.Period_Key || ''))) throw new Error('QBO_CAPTURE_PERIOD_KEY_INVALID');
  const periodStart=qboPreFilingNormalizeDate_(r.Period_Start),periodEnd=qboPreFilingNormalizeDate_(r.Period_End);
  const startMatch=/^(\d{4})-(\d{2})-(\d{2})$/.exec(periodStart),endMatch=/^(\d{4})-(\d{2})-(\d{2})$/.exec(periodEnd);
  if(!startMatch||!endMatch) throw new Error('QBO_CAPTURE_PERIOD_DATE_INVALID');
  const expectedKey=startMatch[1].slice(2)+startMatch[2];
  if(expectedKey!==String(r.Period_Key||'')) throw new Error('QBO_CAPTURE_PERIOD_MISMATCH');
  if(startMatch[1]!==endMatch[1]||startMatch[2]!==endMatch[2]) throw new Error('QBO_CAPTURE_PERIOD_RANGE_MISMATCH');
}

function testSalesTaxPreFilingCaptureRequestContract() {
  qboPreFilingValidateRequest_({
    QBO_Capture_Request_ID:'r1',Capture_Context_Type:'PREFILING',Capture_Context_ID:'p1',
    PreFiling_Run_ID:'p1',Period_Key:'2608',Period_Start:'2026-08-01',Period_End:'2026-08-31'
  });
  qboPreFilingValidateRequest_({
    QBO_Capture_Request_ID:'r2',Capture_Context_Type:'CURRENT_ASOF',Capture_Context_ID:'c1',
    PreFiling_Run_ID:'',Period_Key:'2607',Period_Start:'2026-07-01',Period_End:'2026-07-31'
  });
  let blocked=false;
  try{qboPreFilingValidateRequest_({QBO_Capture_Request_ID:'r3',Capture_Context_Type:'CURRENT_ASOF',Capture_Context_ID:'c1',PreFiling_Run_ID:'p1',Period_Key:'2607',Period_Start:'2026-07-01',Period_End:'2026-07-31'});}catch(e){blocked=true;}
  if(!blocked) throw new Error('CURRENT_ASOF_PREFILING_RUN_ID_WAS_NOT_BLOCKED');
  blocked=false;
  try{qboPreFilingValidateRequest_({QBO_Capture_Request_ID:'r4',Capture_Context_Type:'PREFILING',Capture_Context_ID:'p1',PreFiling_Run_ID:'p1',Period_Key:'2607',Period_Start:'2026-08-01',Period_End:'2026-08-31'});}catch(e){blocked=true;}
  if(!blocked) throw new Error('period mismatch was not blocked');
  const result={Version:'1.5.198',Suite:'SalesTaxCaptureRequestContextContract',checkCount:4,passed:true};
  safeLog_(JSON.stringify(result));return result;
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



/**
 * Governed recovery for the Sep 30 2607 CURRENT_ASOF capture interrupted after
 * GL and Taxable Sales Detail completed but before the Apps Script invocation
 * could persist the Taxable Sales Detail checkpoint / start Recognition.
 *
 * This wrapper is intentionally exact and one-time: it refuses a different
 * request/context/period, refuses conflicting checkpoints, verifies the exact
 * completed GL snapshot and Taxable Sales Detail snapshot evidence, binds only
 * those completed stages, then resumes the same request through the normal
 * processor. It creates no new request and does not recapture GL/TSD.
 */
function recover2607CurrentAsOfCaptureAfterSep30Interruption() {
  const requestId='be65656c-4a90-4f45-b4f9-fd2a399a7dcb';
  const contextId='71379c6e-4997-4a3e-84ae-ec879e873585';
  const glRunId='6c6c3ac1-9d72-4522-af43-84de13ba1e54';
  const glSnapshotFileId='1XsILlyOF5LJCGPVyZCahQL2Kl7w78VI5-rncU0SZ62g';
  const taxableWorkbookFileId='1va3zAyLnNAD1Z-_Lmw8vm0ATEVZ4HEbAB3kIVY5zqg8';
  const taxableRunId='bfad7336-e670-4132-93dc-818fe379c954';
  const taxableSequence=4;
  const controlAssetKey='SALES_TAX_RECONCILIATION_CONTROL';

  const asset=DataPlatform05.getConfiguredAssetReference(controlAssetKey,'Spreadsheet','PROD');
  const controlSpreadsheetId=String(asset && asset.ResourceIdentifier || '').trim();
  if(!controlSpreadsheetId) throw new Error('CURRENT_ASOF_RECOVERY_CONTROL_ASSET_MISSING');
  const ss=SpreadsheetApp.openById(controlSpreadsheetId);
  const sheet=ss.getSheetByName(QBO_PREFILING_CAPTURE.SHEET_NAME);
  if(!sheet) throw new Error('CURRENT_ASOF_RECOVERY_LEDGER_MISSING');
  const state=qboPreFilingReadLedger_(sheet);
  const index=qboPreFilingFindRequest_(state.rows,requestId);
  const request=state.rows[index];

  if(String(request.Capture_Context_Type||'').trim()!=='CURRENT_ASOF') throw new Error('CURRENT_ASOF_RECOVERY_CONTEXT_TYPE_MISMATCH');
  if(String(request.Capture_Context_ID||'').trim()!==contextId) throw new Error('CURRENT_ASOF_RECOVERY_CONTEXT_ID_MISMATCH');
  if(String(request.Period_Key||'').trim()!=='2607') throw new Error('CURRENT_ASOF_RECOVERY_PERIOD_MISMATCH');
  const status=String(request.Request_Status||'').trim();
  if(['PROCESSING','FAILED'].indexOf(status)<0) throw new Error('CURRENT_ASOF_RECOVERY_STATUS_NOT_ALLOWED: '+status);

  qboRecoveryAssertBlankOrExact_(request.GL_ExtractRunId,glRunId,'GL_ExtractRunId');
  qboRecoveryAssertBlankOrExact_(request.GL_SnapshotFileId,glSnapshotFileId,'GL_SnapshotFileId');
  qboRecoveryAssertBlankOrExact_(request.Taxable_Sales_Detail_Workbook_File_ID,taxableWorkbookFileId,'Taxable_Sales_Detail_Workbook_File_ID');
  qboRecoveryAssertBlankOrExact_(request.Taxable_Sales_Detail_Snapshot_Run_ID,taxableRunId,'Taxable_Sales_Detail_Snapshot_Run_ID');
  qboRecoveryAssertBlankOrExact_(request.Taxable_Sales_Detail_Snapshot_Sequence,taxableSequence,'Taxable_Sales_Detail_Snapshot_Sequence');
  if(String(request.Sales_Tax_Recognition_Snapshot_Run_ID||'').trim()) throw new Error('CURRENT_ASOF_RECOVERY_RECOGNITION_ALREADY_BOUND');

  const glFile=DriveApp.getFileById(glSnapshotFileId);
  if(!glFile || glFile.isTrashed()) throw new Error('CURRENT_ASOF_RECOVERY_GL_SNAPSHOT_NOT_AVAILABLE');
  const taxableFile=DriveApp.getFileById(taxableWorkbookFileId);
  if(!taxableFile || taxableFile.isTrashed()) throw new Error('CURRENT_ASOF_RECOVERY_TAXABLE_WORKBOOK_NOT_AVAILABLE');
  qboRecoveryAssertSnapshotIdentityAnywhere_(taxableWorkbookFileId,'202607',taxableRunId,taxableSequence);

  request.GL_ExtractRunId=glRunId;
  request.GL_SnapshotFileId=glSnapshotFileId;
  request.Taxable_Sales_Detail_Workbook_File_ID=taxableWorkbookFileId;
  request.Taxable_Sales_Detail_Snapshot_Run_ID=taxableRunId;
  request.Taxable_Sales_Detail_Snapshot_Sequence=taxableSequence;
  request.Request_Status='FAILED';
  request.Error_Code='RECOVERABLE_INTERRUPTION_AFTER_TAXABLE_SALES_DETAIL';
  request.Error_Message='Sep 30 invocation ended after GL and Taxable Sales Detail completed; exact completed-stage checkpoints recovered from execution evidence.';
  request.Last_Updated_At=new Date();
  state.rows[index]=request;
  qboPreFilingWriteLedger_(sheet,state.rows);

  safeLog_('[PREFILING QBO CAPTURE] | CURRENT_ASOF RECOVERY CHECKPOINTS BOUND | '+JSON.stringify({
    QBO_Capture_Request_ID:requestId,
    Capture_Context_ID:contextId,
    GL_ExtractRunId:glRunId,
    Taxable_Sales_Detail_Snapshot_Run_ID:taxableRunId,
    Taxable_Sales_Detail_Snapshot_Sequence:taxableSequence
  }));

  return processSalesTaxPreFilingCaptureRequest(controlSpreadsheetId,requestId);
}

function qboRecoveryAssertBlankOrExact_(actual,expected,label) {
  const a=String(actual===undefined||actual===null?'':actual).trim();
  const e=String(expected).trim();
  if(a && a!==e) throw new Error('CURRENT_ASOF_RECOVERY_CONFLICT_'+label+': '+a);
}

function qboRecoveryAssertSnapshotIdentityAnywhere_(spreadsheetId,periodKey,runId,sequence) {
  const ss=SpreadsheetApp.openById(spreadsheetId);
  const pk=String(periodKey||'').trim(), rid=String(runId||'').trim(), seq=Number(sequence);
  let found=false;
  ss.getSheets().some(sh=>{
    const values=sh.getDataRange().getValues();
    if(values.length<2) return false;
    const h=values[0].map(v=>String(v||'').trim());
    const p=h.indexOf('Period_Key'), r=h.indexOf('Snapshot_Run_ID'), q=h.indexOf('Snapshot_Sequence');
    if(p<0||r<0||q<0) return false;
    found=values.slice(1).some(row=>String(row[p]||'').trim()===pk && String(row[r]||'').trim()===rid && Number(row[q])===seq);
    return found;
  });
  if(!found) throw new Error('CURRENT_ASOF_RECOVERY_TAXABLE_SNAPSHOT_IDENTITY_NOT_FOUND');
  return true;
}

/**
 * One-time governed recovery for the Sep 18 failed August capture that completed
 * GL and Taxable Sales Detail before checkpoint persistence existed. It binds the
 * exact immutable artifacts from that failed execution, then delegates to the
 * normal FAILED-request retry path. Refuses any other request/state.
 */
function recoverSep18AugustPreFilingCaptureFromCompletedStages() {
  const requestId='cd45bd6d-fa6a-4a0a-80f9-898b17e53b5a';
  const controlAssetKey='SALES_TAX_RECONCILIATION_CONTROL';
  const asset=DataPlatform05.getConfiguredAssetReference(controlAssetKey,'Spreadsheet','PROD');
  const ss=SpreadsheetApp.openById(String(asset.ResourceIdentifier||'').trim());
  const sheet=ss.getSheetByName(QBO_PREFILING_CAPTURE.SHEET_NAME);
  const state=qboPreFilingReadLedger_(sheet);
  const index=qboPreFilingFindRequest_(state.rows,requestId);
  const request=state.rows[index];
  if(String(request.Request_Status||'').trim()!=='FAILED') throw new Error('PREFILING_RECOVERY_REQUEST_NOT_FAILED');
  if(String(request.PreFiling_Run_ID||'').trim()!=='60cbf469-b91e-4db1-b3e0-219c99e018be') throw new Error('PREFILING_RECOVERY_RUN_MISMATCH');
  if(String(request.Period_Key||'').trim()!=='2608') throw new Error('PREFILING_RECOVERY_PERIOD_MISMATCH');
  if(String(request.GL_ExtractRunId||'').trim()||String(request.Taxable_Sales_Detail_Snapshot_Run_ID||'').trim()) throw new Error('PREFILING_RECOVERY_CHECKPOINT_ALREADY_PRESENT');
  request.GL_ExtractRunId='990f81e7-e652-4249-b37a-fc57036a835d';
  request.GL_SnapshotFileId='1UNMPFZ6VAIe1uzkIOeIqDSYG-YnoGeW4viS7nwsvR1Q';
  request.Taxable_Sales_Detail_Workbook_File_ID='1va3zAyLnNAD1Z-_Lmw8vm0ATEVZ4HEbAB3kIVY5zqg8';
  request.Taxable_Sales_Detail_Snapshot_Run_ID='021db343-314f-4da2-b816-2b00c3da454b';
  request.Taxable_Sales_Detail_Snapshot_Sequence=3;
  request.Last_Updated_At=new Date();
  state.rows[index]=request; qboPreFilingWriteLedger_(sheet,state.rows);
  safeLog_('[PREFILING QBO CAPTURE] | RECOVERY CHECKPOINTS BOUND | request='+requestId);
  return retryLatestFailedSalesTaxPreFilingCapture();
}


/** v1.5.198 pure capture-context/header contract test; no production writes. */
function testSalesTaxCaptureContextHeaderContract() {
  const h=QBO_PREFILING_CAPTURE.HEADERS.slice();
  const checks=[
    h.indexOf('Capture_Context_Type')===1,
    h.indexOf('Capture_Context_ID')===2,
    h.indexOf('PreFiling_Run_ID')===3,
    h.length===23,
    qboPreFilingCaptureContext_({Capture_Context_Type:'PREFILING',Capture_Context_ID:'P1',PreFiling_Run_ID:'P1'}).type==='PREFILING',
    qboPreFilingCaptureContext_({Capture_Context_Type:'CURRENT_ASOF',Capture_Context_ID:'C1',PreFiling_Run_ID:''}).type==='CURRENT_ASOF'
  ];
  let blocked=false;try{qboPreFilingCaptureContext_({Capture_Context_Type:'CURRENT_ASOF',Capture_Context_ID:'C1',PreFiling_Run_ID:'P1'});}catch(e){blocked=true;}
  checks.push(blocked);
  const result={Version:'1.5.198',Suite:'SalesTaxCaptureContextHeaderContract',checkCount:checks.length,passed:checks.every(Boolean)};
  if(!result.passed)throw new Error('QBO_CAPTURE_CONTEXT_HEADER_CONTRACT_TEST_FAILED');
  safeLog_(JSON.stringify(result));return result;
}


/**
 * Read-only inspection of the completed 2607 CURRENT_ASOF capture.
 * Verifies the exact request identity, all persisted evidence bindings,
 * physical snapshot existence, and Recognition -> GL lineage. No writes.
 */
function inspect2607CurrentAsOfCompletedCapture() {
  const requestId = 'be65656c-4a90-4f45-b4f9-fd2a399a7dcb';
  const contextId = '71379c6e-4997-4a3e-84ae-ec879e873585';
  const asset = DataPlatform05.getConfiguredAssetReference('SALES_TAX_RECONCILIATION_CONTROL','Spreadsheet','PROD');
  const controlId = String(asset && asset.ResourceIdentifier || '').trim();
  if (!controlId) throw new Error('CURRENT_ASOF_INSPECT_CONTROL_ASSET_MISSING');
  const control = SpreadsheetApp.openById(controlId);
  const sheet = control.getSheetByName(QBO_PREFILING_CAPTURE.SHEET_NAME);
  if (!sheet) throw new Error('CURRENT_ASOF_INSPECT_LEDGER_MISSING');
  const state = qboPreFilingReadLedger_(sheet);
  const idx = qboPreFilingFindRequest_(state.rows, requestId);
  const r = state.rows[idx];
  if (String(r.Capture_Context_Type || '').trim() !== 'CURRENT_ASOF') throw new Error('CURRENT_ASOF_INSPECT_CONTEXT_TYPE_MISMATCH');
  if (String(r.Capture_Context_ID || '').trim() !== contextId) throw new Error('CURRENT_ASOF_INSPECT_CONTEXT_ID_MISMATCH');
  if (String(r.Period_Key || '').trim() !== '2607') throw new Error('CURRENT_ASOF_INSPECT_PERIOD_MISMATCH');
  if (String(r.Request_Status || '').trim() !== 'COMPLETE') throw new Error('CURRENT_ASOF_INSPECT_NOT_COMPLETE: ' + String(r.Request_Status || ''));

  const periodKey = qboPreFilingEvidencePeriodKey_(r.Period_Start, r.Period_Key);
  const glRun = String(r.GL_ExtractRunId || '').trim();
  const glFileId = String(r.GL_SnapshotFileId || '').trim();
  const tdFileId = String(r.Taxable_Sales_Detail_Workbook_File_ID || '').trim();
  const tdRun = String(r.Taxable_Sales_Detail_Snapshot_Run_ID || '').trim();
  const tdSeq = Number(r.Taxable_Sales_Detail_Snapshot_Sequence || 0);
  const recFileId = String(r.Sales_Tax_Recognition_Workbook_File_ID || '').trim();
  const recRun = String(r.Sales_Tax_Recognition_Snapshot_Run_ID || '').trim();
  const recSeq = Number(r.Sales_Tax_Recognition_Snapshot_Sequence || 0);
  const recGl = String(r.Sales_Tax_Recognition_Source_GL_ExtractRunId || '').trim();
  if (!glRun || !glFileId || !tdFileId || !tdRun || !tdSeq || !recFileId || !recRun || !recSeq || !recGl) {
    throw new Error('CURRENT_ASOF_INSPECT_COMPLETE_ROW_MISSING_EVIDENCE_BINDING');
  }
  if (recGl !== glRun) throw new Error('CURRENT_ASOF_INSPECT_RECOGNITION_GL_LINEAGE_MISMATCH');

  const glFile = DriveApp.getFileById(glFileId);
  if (!glFile || glFile.isTrashed()) throw new Error('CURRENT_ASOF_INSPECT_GL_SNAPSHOT_UNAVAILABLE');
  const tdFile = DriveApp.getFileById(tdFileId);
  if (!tdFile || tdFile.isTrashed()) throw new Error('CURRENT_ASOF_INSPECT_TAXABLE_WORKBOOK_UNAVAILABLE');
  const recFile = DriveApp.getFileById(recFileId);
  if (!recFile || recFile.isTrashed()) throw new Error('CURRENT_ASOF_INSPECT_RECOGNITION_WORKBOOK_UNAVAILABLE');

  const tdSs = SpreadsheetApp.openById(tdFileId);
  qboPreFilingAssertSnapshotExists_(tdSs,QBO_TAXABLE_SALES_DETAIL.SNAPSHOT_SHEET,periodKey,tdRun,tdSeq,'TAXABLE_SALES_DETAIL');
  const recSs = SpreadsheetApp.openById(recFileId);
  qboPreFilingAssertSnapshotExists_(recSs,QBO_SALES_TAX_RECOGNITION.SNAPSHOT_SHEET,periodKey,recRun,recSeq,'SALES_TAX_RECOGNITION');

  const result = {
    Version:'1.5.200', Status:'PASS', Read_Only:true, Mutation_Performed:false,
    QBO_Capture_Request_ID:requestId, Capture_Context_Type:'CURRENT_ASOF', Capture_Context_ID:contextId,
    Period_Key:String(r.Period_Key || ''), Request_Status:String(r.Request_Status || ''),
    Processing_Started_At:r.Processing_Started_At || '', Completed_At:r.Completed_At || '', Last_Updated_At:r.Last_Updated_At || '',
    GL:{ExtractRunId:glRun,SnapshotFileId:glFileId,Physical_File_Available:true},
    Taxable_Sales_Detail:{Workbook_File_ID:tdFileId,Snapshot_Run_ID:tdRun,Snapshot_Sequence:tdSeq,Physical_Snapshot_Verified:true},
    Sales_Tax_Recognition:{Workbook_File_ID:recFileId,Snapshot_Run_ID:recRun,Snapshot_Sequence:recSeq,Source_GL_ExtractRunId:recGl,Physical_Snapshot_Verified:true,GL_Lineage_Matches:true},
    Error_Code:String(r.Error_Code || ''), Error_Message:String(r.Error_Message || '')
  };
  safeLog_('[PREFILING QBO CAPTURE] | CURRENT_ASOF COMPLETE INSPECTION | ' + JSON.stringify(result));
  return result;
}
