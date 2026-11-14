/** v1.5.625 — read-only, source-grounded recovery preflight.
 * Never clears CAPTURING, changes checkpoint fields, or launches exports.
 * Candidate identity must be supplied explicitly by the operator.
 */
const QBO_REVISION_RECOVERY_PREFLIGHT_V15625 = Object.freeze({
 VERSION:'1.5.625',
 str(v){return String(v===null||v===undefined?'':v).trim();},
 date(v){return v instanceof Date?v.getTime():new Date(v).getTime();},
 rows(ss,name,headers){
  const sh=ss.getSheetByName(name);if(!sh)throw Error('REV625_SHEET_MISSING_'+name);
  const data=sh.getDataRange().getValues(),head=(data.shift()||[]).map(x=>this.str(x));
  headers.forEach(h=>{if(!head.includes(h))throw Error('REV625_HEADER_MISSING_'+name+'_'+h);});
  return data.map(a=>Object.fromEntries(head.map((h,i)=>[h,a[i]])));
 },
 exactlyOne(rows,code){if(rows.length!==1)throw Error('REV625_'+code+'_COUNT_'+rows.length);return rows[0];},
 candidate(controlId,requestId,family,runId,fileId,sequence){
  const s=QBO_REVISION_CAPTURE_V15621.select(QBO_REVISION_CAPTURE_V15621.open(controlId),requestId);
  const r=s.entry.data,st=x=>this.str(x),period=s.start.slice(0,7).replace('-','');
  if(st(r.Request_Status)!=='CAPTURING')throw Error('REV625_NOT_IN_FLIGHT');
  if(!['GL','TSD','RECOGNITION'].includes(family))throw Error('REV625_UNKNOWN_FAMILY');
  if(st(r.Error_Code).indexOf(family)<0)throw Error('REV625_IN_FLIGHT_FAMILY_MISMATCH');
  if(!st(runId)||!st(fileId))throw Error('REV625_EXPLICIT_CANDIDATE_IDENTITIES_REQUIRED');
  const since=this.date(r.Processing_Started_At);
  if(!Number.isFinite(since))throw Error('REV625_PROCESSING_START_NOT_DURABLE');
  let proof={};
  if(family==='GL'){
   if(st(r.GL_ExtractRunId)||st(r.GL_SnapshotFileId))throw Error('REV625_GL_ALREADY_CHECKPOINTED');
   const gl=getQboGeneralLedgerReportSpreadsheet_();
   const runs=this.rows(gl,QBO_GENERAL_LEDGER_REPORT.RUNS_SHEET,['ExtractRunId','SnapshotFileId','ReportStartDate','ReportEndDate','ReportBasis','ExtractedAt','RowCount','SnapshotArtifactContract']);
   const matches=runs.filter(x=>qboGeneralLedgerDateText_(x.ReportStartDate)===s.start&&qboGeneralLedgerDateText_(x.ReportEndDate)===s.end&&this.date(x.ExtractedAt)>=since);
   const row=this.exactlyOne(matches,'GL_CANDIDATES_SINCE_START');
   if(st(row.ExtractRunId)!==st(runId)||st(row.SnapshotFileId)!==st(fileId)||st(row.ReportBasis)!=='Cash'||st(row.SnapshotArtifactContract)!=='GL_RUN_SNAPSHOT_V2')throw Error('REV625_GL_IDENTITY_OR_BASIS_MISMATCH');
   const snap=SpreadsheetApp.openById(st(fileId));
   const meta=this.rows(snap,'00_Metadata',['Field','Value']);
   const m=Object.fromEntries(meta.map(x=>[st(x.Field),x.Value]));
   if(st(m.ArtifactContract)!=='GL_RUN_SNAPSHOT_V2'||st(m.ExtractRunId)!==st(runId)||st(m.ReportBasis)!=='Cash'||st(m.ReportStartDate)!==s.start||st(m.ReportEndDate)!==s.end)throw Error('REV625_GL_METADATA_MISMATCH');
   const detail=this.rows(snap,QBO_GENERAL_LEDGER_REPORT.DATA_SHEET,['ExtractRunId','ReportStartDate','ReportEndDate']);
   if(detail.length!==Number(row.RowCount)||detail.length!==Number(m.RowCount)||detail.some(x=>st(x.ExtractRunId)!==st(runId)||qboGeneralLedgerDateText_(x.ReportStartDate)!==s.start||qboGeneralLedgerDateText_(x.ReportEndDate)!==s.end))throw Error('REV625_GL_SNAPSHOT_MISMATCH');
   proof={RowCount:detail.length,ArtifactContract:st(m.ArtifactContract)};
  }else{
   if(!st(sequence))throw Error('REV625_SNAPSHOT_SEQUENCE_REQUIRED');
   const tsd=family==='TSD',workbook=tsd?qboTsdGetWorkbook_():qboStrGetWorkbook_(),cfg=tsd?QBO_TAXABLE_SALES_DETAIL:QBO_SALES_TAX_RECOGNITION;
   if(workbook.getId()!==st(fileId))throw Error('REV625_WORKBOOK_ID_MISMATCH');
   if(st(r[tsd?'Taxable_Sales_Detail_Snapshot_Run_ID':'Sales_Tax_Recognition_Snapshot_Run_ID']))throw Error('REV625_ALREADY_CHECKPOINTED');
   const logs=this.rows(workbook,cfg.LOG_SHEET,['Snapshot_Run_ID','Period_Key','Period_Start','Period_End','Status','Row_Count',tsd?'Report_AsOf_DateTime':'Derived_At']);
   const timeField=tsd?'Report_AsOf_DateTime':'Derived_At';
   const candidates=logs.filter(x=>st(x.Period_Key)===period&&st(x.Period_Start)===s.start&&st(x.Period_End)===s.end&&this.date(x[timeField])>=since);
   const row=this.exactlyOne(candidates,family+'_CANDIDATES_SINCE_START');
   if(st(row.Snapshot_Run_ID)!==st(runId)||st(row.Status)!=='SUCCESS')throw Error('REV625_'+family+'_LOG_MISMATCH');
   const data=this.rows(workbook,cfg.SNAPSHOT_SHEET,['Period_Key','Snapshot_Run_ID','Snapshot_Sequence'].concat(tsd?[]:['Source_GL_Extract_Run_ID']));
   const selected=data.filter(x=>st(x.Period_Key)===period&&st(x.Snapshot_Run_ID)===st(runId));
   if(selected.length!==Number(row.Row_Count)||selected.some(x=>st(x.Snapshot_Sequence)!==st(sequence)))throw Error('REV625_'+family+'_SNAPSHOT_MISMATCH');
   if(!tsd){
    if(!st(r.GL_ExtractRunId)||st(r.Sales_Tax_Recognition_Source_GL_ExtractRunId))throw Error('REV625_RECOGNITION_GL_CHECKPOINT_STATE_INVALID');
    if(selected.some(x=>st(x.Source_GL_Extract_Run_ID)!==st(r.GL_ExtractRunId)))throw Error('REV625_RECOGNITION_GL_LINEAGE_MISMATCH');
    const logGl=this.rows(workbook,cfg.LOG_SHEET,['Snapshot_Run_ID','Source_GL_Extract_Run_ID']).filter(x=>st(x.Snapshot_Run_ID)===st(runId));
    if(st(this.exactlyOne(logGl,'RECOGNITION_GL_LOG').Source_GL_Extract_Run_ID)!==st(r.GL_ExtractRunId))throw Error('REV625_RECOGNITION_LOG_GL_MISMATCH');
   }
   proof={RowCount:selected.length,Sequence:st(sequence)};
  }
  return {Version:this.VERSION,Status:'RECOVERY_CANDIDATE_EVIDENCE_MATCHED',Read_Only:true,Production_Writes:0,Revision_ID:r.Revision_ID,Revision_Request_ID:r.Revision_Request_ID,Family:family,Candidate_Run_ID:st(runId),Candidate_File_ID:st(fileId),Proof:proof,Recovery_Released:false,Safe_To_Start_Revision_Capture:false};
 }
});
function previewQboPrefilingRevisionRecoveryCandidateV15625(controlSpreadsheetId,revisionRequestId,family,candidateRunId,candidateFileId,candidateSequence){
 const result=QBO_REVISION_RECOVERY_PREFLIGHT_V15625.candidate(controlSpreadsheetId,revisionRequestId,family,candidateRunId,candidateFileId,candidateSequence);
 console.log('[REV625 APP50] | RECOVERY PREFLIGHT | '+JSON.stringify(result));return result;
}
