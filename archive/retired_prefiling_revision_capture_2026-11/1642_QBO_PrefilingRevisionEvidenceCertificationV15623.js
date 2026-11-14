/** v1.5.623: read-only persisted-evidence certification for revision capture.
 * Does not invoke QBO, export, change checkpoints, or release an in-flight request.
 */
const QBO_REVISION_EVIDENCE_CERT_V15623=Object.freeze({
 VERSION:'1.5.623',
 str(v){return String(v===null||v===undefined?'':v).trim();},
 sheetRows(ss,name,required){
  const sh=ss.getSheetByName(name);if(!sh)throw Error('REV623_SHEET_MISSING_'+name);
  const a=sh.getDataRange().getValues(),h=(a.shift()||[]).map(x=>this.str(x));
  required.forEach(k=>{if(h.indexOf(k)<0)throw Error('REV623_HEADER_MISSING_'+name+'_'+k);});
  return a.map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]])));
 },
 unique(rows,label){if(rows.length!==1)throw Error('REV623_'+label+'_COUNT_'+rows.length);return rows[0];},
 certify(controlId,requestId){
  const s=QBO_REVISION_CAPTURE_V15621.select(QBO_REVISION_CAPTURE_V15621.open(controlId),requestId);
  const r=s.entry.data,st=x=>this.str(x),start=s.start,end=s.end,period=start.slice(0,7).replace('-','');
  const findings=[],result={Version:this.VERSION,Read_Only:true,Production_Writes:0,Revision_ID:r.Revision_ID,Revision_Request_ID:r.Revision_Request_ID,Request_Status:r.Request_Status,Period_Key:r.Period_Key,Findings:findings,Certified:false};
  if(st(r.Period_Key)!==period.slice(2))throw Error('REV623_PERIOD_KEY_MISMATCH');
  if(st(r.GL_ExtractRunId)||st(r.GL_SnapshotFileId)){
   if(!st(r.GL_ExtractRunId)||!st(r.GL_SnapshotFileId))throw Error('REV623_GL_PARTIAL_CHECKPOINT');
   const gl=getQboGeneralLedgerReportSpreadsheet_();
   const matches=this.sheetRows(gl,QBO_GENERAL_LEDGER_REPORT.RUNS_SHEET,['ExtractRunId','SnapshotFileId','ReportStartDate','ReportEndDate','ReportBasis'])
    .filter(x=>st(x.ExtractRunId)===st(r.GL_ExtractRunId));
   const record=this.unique(matches,'GL_RUN');
   if(st(record.SnapshotFileId)!==st(r.GL_SnapshotFileId)||qboGeneralLedgerDateText_(record.ReportStartDate)!==start||qboGeneralLedgerDateText_(record.ReportEndDate)!==end||st(record.ReportBasis)!=='Cash')throw Error('REV623_GL_REGISTRY_LINEAGE_MISMATCH');
   const snapshot=SpreadsheetApp.openById(st(r.GL_SnapshotFileId));
   const glRows=this.sheetRows(snapshot,QBO_GENERAL_LEDGER_REPORT.DATA_SHEET,['ExtractRunId','ReportStartDate','ReportEndDate']);
   if(!glRows.length||glRows.some(x=>st(x.ExtractRunId)!==st(r.GL_ExtractRunId)||qboGeneralLedgerDateText_(x.ReportStartDate)!==start||qboGeneralLedgerDateText_(x.ReportEndDate)!==end))throw Error('REV623_GL_SNAPSHOT_CONTENT_MISMATCH');
   findings.push({Family:'GL',Certified:true,RunId:st(r.GL_ExtractRunId),SnapshotFileId:st(r.GL_SnapshotFileId)});
  }else findings.push({Family:'GL',Certified:false,Reason:'NOT_CHECKPOINTED'});
  const families=[
   {name:'TSD',run:'Taxable_Sales_Detail_Snapshot_Run_ID',file:'Taxable_Sales_Detail_Workbook_File_ID',seq:'Taxable_Sales_Detail_Snapshot_Sequence',workbook:qboTsdGetWorkbook_,sheet:QBO_TAXABLE_SALES_DETAIL.SNAPSHOT_SHEET,log:QBO_TAXABLE_SALES_DETAIL.LOG_SHEET,runHeader:'Snapshot_Run_ID',seqHeader:'Snapshot_Sequence',source:''},
   {name:'RECOGNITION',run:'Sales_Tax_Recognition_Snapshot_Run_ID',file:'Sales_Tax_Recognition_Workbook_File_ID',seq:'Sales_Tax_Recognition_Snapshot_Sequence',workbook:qboStrGetWorkbook_,sheet:QBO_SALES_TAX_RECOGNITION.SNAPSHOT_SHEET,log:QBO_SALES_TAX_RECOGNITION.LOG_SHEET,runHeader:'Snapshot_Run_ID',seqHeader:'Snapshot_Sequence',source:'Source_GL_Extract_Run_ID'}
  ];
  families.forEach(f=>{
   if(!st(r[f.run])&&!st(r[f.file])){findings.push({Family:f.name,Certified:false,Reason:'NOT_CHECKPOINTED'});return;}
   if(!st(r[f.run])||!st(r[f.file])||!st(r[f.seq]))throw Error('REV623_'+f.name+'_PARTIAL_CHECKPOINT');
   const ss=f.workbook();if(ss.getId()!==st(r[f.file]))throw Error('REV623_'+f.name+'_WORKBOOK_ID_MISMATCH');
   const rows=this.sheetRows(ss,f.sheet,['Period_Key',f.runHeader,f.seqHeader].concat(f.source?[f.source]:[]))
    .filter(x=>st(x.Period_Key)===period&&st(x[f.runHeader])===st(r[f.run]));
   const logRows=this.sheetRows(ss,f.log,['Snapshot_Run_ID','Period_Key','Status','Row_Count','Period_Start','Period_End'])
    .filter(x=>st(x.Snapshot_Run_ID)===st(r[f.run])&&st(x.Period_Key)===period&&st(x.Status)==='SUCCESS');
   const success=this.unique(logRows,f.name+'_SUCCESS_LOG');
   if(Number(success.Row_Count)!==rows.length)throw Error('REV623_'+f.name+'_ROW_COUNT_MISMATCH');
   if(st(success.Period_Start)!==start||st(success.Period_End)!==end)throw Error('REV623_'+f.name+'_LOG_PERIOD_MISMATCH');
   if(rows.some(x=>st(x[f.seqHeader])!==st(r[f.seq])))throw Error('REV623_'+f.name+'_SEQUENCE_MISMATCH');
   if(f.source){
    if(st(r.Sales_Tax_Recognition_Source_GL_ExtractRunId)!==st(r.GL_ExtractRunId))throw Error('REV623_RECOGNITION_CHECKPOINT_GL_MISMATCH');
    if(rows.some(x=>st(x[f.source])!==st(r.GL_ExtractRunId)))throw Error('REV623_RECOGNITION_ROW_GL_MISMATCH');
   }
   findings.push({Family:f.name,Certified:true,RunId:st(r[f.run]),Sequence:st(r[f.seq]),SnapshotRows:rows.length});
  });
  result.Certified=findings.length===3&&findings.every(x=>x.Certified);
  result.Status=result.Certified?'ALL_THREE_FAMILIES_CERTIFIED':'PARTIAL_EVIDENCE_CERTIFICATION';
  result.Safe_To_Start_Revision_Capture=false;
  return result;
 }
});
function certifyQboPrefilingRevisionEvidenceV15623(controlSpreadsheetId,revisionRequestId){const r=QBO_REVISION_EVIDENCE_CERT_V15623.certify(controlSpreadsheetId,revisionRequestId);console.log('[REV623 APP50] | CERTIFY | '+JSON.stringify(r));return r;}
