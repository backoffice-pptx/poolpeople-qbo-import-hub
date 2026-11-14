/** V1.5.302 — governed existing-evidence adoption. No period/run/snapshot literals. */
const QBO_CAPTURE_ADOPTION_V1302 = Object.freeze({version:'1.5.302'});
function qboCap302Assert_(ok,code){if(!ok)throw new Error('CAPTURE_V1302_'+code);}
function qboCap302Text_(v){return String(v===null||v===undefined?'':v).trim();}
function qboCap302Control_(){
  qboCap302Assert_(typeof DataPlatform05!=='undefined' && typeof DataPlatform05.getConfiguredAssetReference==='function','ASSET_LIBRARY_MISSING');
  const a=DataPlatform05.getConfiguredAssetReference('SALES_TAX_RECONCILIATION_CONTROL','Spreadsheet','PROD');
  qboCap302Assert_(a&&a.ResourceIdentifier,'CONTROL_ASSET_MISSING');
  const ss=SpreadsheetApp.openById(a.ResourceIdentifier), sh=ss.getSheetByName(QBO_PREFILING_CAPTURE.SHEET_NAME);
  qboCap302Assert_(sh,'LEDGER_MISSING');return {ss:ss,sh:sh};
}
function qboCap302WorkingRun_(ss){
  const sh=ss.getSheetByName('00_Control');qboCap302Assert_(sh,'WORKING_CONTROL_MISSING');
  const v=sh.getDataRange().getValues(),h=v[0].map(qboCap302Text_),k=h.indexOf('Setting'),val=h.indexOf('Value');
  qboCap302Assert_(k>=0&&val>=0,'WORKING_CONTROL_HEADERS');
  const found=v.slice(1).filter(r=>qboCap302Text_(r[k])==='PREFILING_WORKING_RUN_ID');
  qboCap302Assert_(found.length===1&&qboCap302Text_(found[0][val]),'WORKING_RUN_AMBIGUOUS');
  return qboCap302Text_(found[0][val]);
}
function qboCap302Rows_(sh,required){
  qboCap302Assert_(sh&&sh.getLastRow()>1,'SOURCE_SHEET_EMPTY');
  const v=sh.getDataRange().getValues(),h=v[0].map(qboCap302Text_);
  required.forEach(k=>qboCap302Assert_(h.indexOf(k)>=0,'HEADER_MISSING_'+k));
  return v.slice(1).map(r=>{const o={};h.forEach((k,i)=>o[k]=r[i]);return o;});
}
function qboCap302One_(items,label){qboCap302Assert_(items.length===1,label+'_CARDINALITY_'+items.length);return items[0];}
function qboCap302Period_(r){
  qboPreFilingValidateRequest_(r);
  const start=qboPreFilingNormalizeDate_(r.Period_Start),end=qboPreFilingNormalizeDate_(r.Period_End);
  const date=new Date(start+'T12:00:00Z');date.setUTCMonth(date.getUTCMonth()+1,0);
  const expected=Utilities.formatDate(date,'UTC','yyyy-MM-dd');
  qboCap302Assert_(end===expected,'PERIOD_NOT_FULL_MONTH');
  return {start:start,end:end,key:start.slice(0,7).replace('-','')};
}
function qboCap302Evidence_(r){
  const period=qboCap302Period_(r),glSs=getQboGeneralLedgerReportSpreadsheet_();
  const glRows=qboCap302Rows_(glSs.getSheetByName(QBO_GENERAL_LEDGER_REPORT.RUNS_SHEET),QBO_GENERAL_LEDGER_RUN_HEADERS);
  const glCandidates=glRows.filter(x=>qboGeneralLedgerDateText_(x.ReportStartDate)===period.start&&qboGeneralLedgerDateText_(x.ReportEndDate)===period.end&&qboCap302Text_(x.ReportBasis)==='Cash'&&qboCap302Text_(x.SnapshotArtifactContract)==='GL_RUN_SNAPSHOT_V2'&&x.ExtractedAt);
  const gl=qboCap302One_(glCandidates,'GL');
  qboCap302Assert_(qboCap302Text_(gl.SpreadsheetId)===glSs.getId(),'GL_WORKBOOK_ID');
  qboCap302Assert_(qboCap302Text_(gl.ExtractRunId)&&qboCap302Text_(gl.SnapshotFileId)&&Number(gl.RowCount)>0,'GL_IDENTITY');
  validateQboGeneralLedgerRunSnapshotV2_(gl.SnapshotFileId,gl.ExtractRunId,period.start,period.end,Number(gl.RowCount),gl.ExtractedAt);
  const tsdSs=qboTsdGetWorkbook_(),recSs=qboStrGetWorkbook_();
  const sources=[
    {label:'TSD',ss:tsdSs,log:QBO_TAXABLE_SALES_DETAIL.LOG_SHEET,snapshot:QBO_TAXABLE_SALES_DETAIL.SNAPSHOT_SHEET,run:'Snapshot_Run_ID',seq:'Snapshot_Sequence'},
    {label:'RECOGNITION',ss:recSs,log:QBO_SALES_TAX_RECOGNITION.LOG_SHEET,snapshot:QBO_SALES_TAX_RECOGNITION.SNAPSHOT_SHEET,run:'Snapshot_Run_ID',seq:'Snapshot_Sequence'}
  ];
  const chosen=sources.map(s=>{
    const logs=qboCap302Rows_(s.ss.getSheetByName(s.log),['Snapshot_Run_ID','Period_Key','Period_Start','Period_End','Status','Row_Count']);
    const candidates=logs.filter(x=>qboCap302Text_(x.Period_Key)===period.key&&qboCap302Text_(x.Status)==='SUCCESS');
    const log=qboCap302One_(candidates,s.label+'_LOG');
    qboCap302Assert_(qboGeneralLedgerDateText_(log.Period_Start)===period.start&&qboGeneralLedgerDateText_(log.Period_End)===period.end,s.label+'_LOG_PERIOD');
    const rows=qboCap302Rows_(s.ss.getSheetByName(s.snapshot),['Period_Key',s.run,s.seq]);
    const matches=rows.filter(x=>qboCap302Text_(x.Period_Key)===period.key&&qboCap302Text_(x[s.run])===qboCap302Text_(log.Snapshot_Run_ID));
    qboCap302Assert_(matches.length===Number(log.Row_Count)&&matches.length>0,s.label+'_SNAPSHOT_ROW_COUNT');
    const seqs=[...new Set(matches.map(x=>Number(x[s.seq])))];
    qboCap302Assert_(seqs.length===1&&Number.isInteger(seqs[0])&&seqs[0]>0,s.label+'_SEQUENCE');
    if(s.label==='RECOGNITION'){
      matches.forEach(x=>{
        qboCap302Assert_(qboCap302Text_(x.Source_GL_Extract_Run_ID)===qboCap302Text_(gl.ExtractRunId),'RECOGNITION_GL_LINEAGE');
        qboCap302Assert_(qboCap302Text_(x.Source_GL_Workbook_ID)===glSs.getId(),'RECOGNITION_GL_WORKBOOK');
        qboCap302Assert_(qboGeneralLedgerDateText_(x.Source_GL_Report_Start_Date)===period.start&&qboGeneralLedgerDateText_(x.Source_GL_Report_End_Date)===period.end,'RECOGNITION_GL_PERIOD');
        qboCap302Assert_(qboGeneralLedgerTimestampsMatchToSecond_(x.Source_GL_Extracted_At,gl.ExtractedAt),'RECOGNITION_GL_TIME');
      });
      qboCap302Assert_(qboCap302Text_(log.Source_GL_Extract_Run_ID)===qboCap302Text_(gl.ExtractRunId),'RECOGNITION_LOG_LINEAGE');
    }
    return {workbook:s.ss.getId(),run:qboCap302Text_(log.Snapshot_Run_ID),seq:seqs[0],rows:matches.length};
  });
  return {period:period,gl:{run:qboCap302Text_(gl.ExtractRunId),snapshot:qboCap302Text_(gl.SnapshotFileId),rows:Number(gl.RowCount)},tsd:chosen[0],recognition:chosen[1]};
}
function qboCap302Expected_(e){return {
  GL_ExtractRunId:e.gl.run,GL_SnapshotFileId:e.gl.snapshot,
  Taxable_Sales_Detail_Workbook_File_ID:e.tsd.workbook,Taxable_Sales_Detail_Snapshot_Run_ID:e.tsd.run,Taxable_Sales_Detail_Snapshot_Sequence:e.tsd.seq,
  Sales_Tax_Recognition_Workbook_File_ID:e.recognition.workbook,Sales_Tax_Recognition_Snapshot_Run_ID:e.recognition.run,Sales_Tax_Recognition_Snapshot_Sequence:e.recognition.seq,
  Sales_Tax_Recognition_Source_GL_ExtractRunId:e.gl.run
};}
function qboCap302Plan_(){
  const ctl=qboCap302Control_(),run=qboCap302WorkingRun_(ctl.ss),state=qboPreFilingReadLedger_(ctl.sh);
  const matches=state.rows.filter(r=>qboCap302Text_(r.PreFiling_Run_ID)===run&&qboCap302Text_(r.Capture_Context_Type)==='PREFILING');
  const r=qboCap302One_(matches,'WORKING_RUN_REQUEST');
  qboCap302Assert_(['REQUESTED','FAILED','COMPLETE'].indexOf(qboCap302Text_(r.Request_Status))>=0,'REQUEST_STATUS');
  const e=qboCap302Evidence_(r),expected=qboCap302Expected_(e);
  Object.keys(expected).forEach(k=>{
    const actual=qboCap302Text_(r[k]),want=qboCap302Text_(expected[k]);
    qboCap302Assert_(!actual||actual===want,'CONFLICT_'+k);
  });
  if(qboCap302Text_(r.Request_Status)==='COMPLETE'){
    qboCap302Assert_(Object.keys(expected).every(k=>qboCap302Text_(r[k])===qboCap302Text_(expected[k])),'COMPLETE_INCOMPLETE');
  }
  return {ctl:ctl,run:run,request:r,evidence:e,expected:expected,idempotent:qboCap302Text_(r.Request_Status)==='COMPLETE'};
}
function previewSelectedPreFilingCaptureEvidenceAdoptionV1302(){
  const p=qboCap302Plan_(),out={version:QBO_CAPTURE_ADOPTION_V1302.version,status:p.idempotent?'ALREADY_COMPLETE':'READY_TO_ADOPT',readOnly:true,productionWrites:0,requestId:p.request.QBO_Capture_Request_ID,workingRun:p.run,evidence:p.evidence};
  console.log('[CAPTURE V1302] | PREVIEW | '+JSON.stringify(out));return out;
}
function applySelectedPreFilingCaptureEvidenceAdoptionV1302(){
  const lock=LockService.getScriptLock();qboCap302Assert_(lock.tryLock(30000),'LOCK_UNAVAILABLE');
  try {
    const p=qboCap302Plan_();
    if(p.idempotent){const out={version:QBO_CAPTURE_ADOPTION_V1302.version,status:'ALREADY_COMPLETE',productionWrites:0};console.log('[CAPTURE V1302] | APPLY | '+JSON.stringify(out));return out;}
    const sh=p.ctl.sh,header=sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0].map(qboCap302Text_);
    const idIndex=header.indexOf('QBO_Capture_Request_ID');qboCap302Assert_(idIndex>=0,'LEDGER_ID_HEADER');
    const ids=sh.getRange(2,idIndex+1,sh.getLastRow()-1,1).getDisplayValues();
    const rows=ids.map((x,i)=>qboCap302Text_(x[0])===qboCap302Text_(p.request.QBO_Capture_Request_ID)?i+2:0).filter(Boolean);
    const row=qboCap302One_(rows,'LEDGER_PHYSICAL_ROW');
    // A single row update preserves unrelated requests and their formatting.
    const values=sh.getRange(row,1,1,header.length).getValues()[0];
    const current={};header.forEach((h,i)=>current[h]=values[i]);
    qboCap302Assert_(qboCap302Text_(current.Request_Status)===qboCap302Text_(p.request.Request_Status),'CONCURRENT_STATUS_CHANGE');
    Object.keys(p.expected).forEach(k=>qboCap302Assert_(!qboCap302Text_(current[k])||qboCap302Text_(current[k])===qboCap302Text_(p.expected[k]),'CONCURRENT_CONFLICT_'+k));
    const now=new Date();
    Object.assign(current,p.expected,{Request_Status:'COMPLETE',Processing_Started_At:current.Processing_Started_At||now,Completed_At:now,Error_Code:'',Error_Message:'',Last_Updated_At:now});
    sh.getRange(row,1,1,header.length).setValues([header.map(h=>current[h]===undefined?'':current[h])]);
    SpreadsheetApp.flush();
    const verify=sh.getRange(row,1,1,header.length).getValues()[0];
    const persisted={};header.forEach((h,i)=>persisted[h]=verify[i]);
    qboCap302Assert_(qboCap302Text_(persisted.Request_Status)==='COMPLETE','WRITE_STATUS_MISMATCH');
    Object.keys(p.expected).forEach(k=>qboCap302Assert_(qboCap302Text_(persisted[k])===qboCap302Text_(p.expected[k]),'WRITE_MISMATCH_'+k));
    const out={version:QBO_CAPTURE_ADOPTION_V1302.version,status:'ADOPTED_COMPLETE',productionWrites:1,requestId:p.request.QBO_Capture_Request_ID,workingRun:p.run,evidence:p.evidence};
    console.log('[CAPTURE V1302] | APPLY | '+JSON.stringify(out));return out;
  }finally{lock.releaseLock();}
}

function testPreFilingCaptureEvidenceAdoptionContractV1302(){
  const checks=[
    ['period full month',qboCap302Period_({QBO_Capture_Request_ID:'t',Capture_Context_Type:'PREFILING',Capture_Context_ID:'r',PreFiling_Run_ID:'r',Period_Key:'2610',Period_Start:'2026-10-01',Period_End:'2026-10-31'}).key==='202610'],
    ['no hardcoded production identities',!/(5d4081c3|47af4e13|31bea488|7ddfeee3|34322b81)/.test(qboCap302Plan_.toString()+qboCap302Evidence_.toString())],
    ['preview read-only',!/setValues|setValue|appendRow|clearContents/.test(previewSelectedPreFilingCaptureEvidenceAdoptionV1302.toString())],
    ['explicit guarded apply',/qboCap302Plan_\(\)/.test(applySelectedPreFilingCaptureEvidenceAdoptionV1302.toString())],
    ['GL lineage checked',/RECOGNITION_GL_LINEAGE/.test(qboCap302Evidence_.toString())],
    ['single row persistence',/getRange\(row,1,1,header.length\).setValues/.test(applySelectedPreFilingCaptureEvidenceAdoptionV1302.toString())]
  ];
  checks.forEach(c=>qboCap302Assert_(c[1],'TEST_'+c[0]));
  const out={version:'1.5.302',status:'PASS',casesPassed:checks.length,productionWrites:0};
  console.log('[CAPTURE V1302] | TEST | '+JSON.stringify(out));return out;
}
