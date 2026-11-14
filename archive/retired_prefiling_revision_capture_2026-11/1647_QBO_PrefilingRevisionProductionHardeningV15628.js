/** v1.5.628: corrected evidence certification and controlled in-flight recovery.
 * Replaces the v1.5.623 certifier when explicitly called by v1.5.628 entry points.
 * No automatic export starts. Only recoverConfirmed() writes, after explicit proof.
 */
const QBO_REVISION_HARDENING_V15628 = Object.freeze({
 VERSION:'1.5.628',
 str(v){return String(v===null||v===undefined?'':v).trim();},
 date(v){const n=v instanceof Date?v.getTime():new Date(v).getTime();return Number.isFinite(n)?n:NaN;},
 rows(ss,name,required){
  const sh=ss.getSheetByName(name);if(!sh)throw Error('REV628_SHEET_MISSING_'+name);
  const data=sh.getDataRange().getValues(),head=(data.shift()||[]).map(x=>this.str(x));
  required.forEach(h=>{if(head.indexOf(h)<0)throw Error('REV628_HEADER_MISSING_'+name+'_'+h);});
  return data.map(row=>Object.fromEntries(head.map((h,i)=>[h,row[i]])));
 },
 one(a,code){if(a.length!==1)throw Error('REV628_'+code+'_COUNT_'+a.length);return a[0];},
 metadata(ss){const rows=this.rows(ss,'00_Metadata',['Field','Value']);return Object.fromEntries(rows.map(r=>[this.str(r.Field),r.Value]));},
 load(controlId,requestId){return QBO_REVISION_CAPTURE_V15621.select(QBO_REVISION_CAPTURE_V15621.open(controlId),requestId);},
 period(s){return s.start.slice(0,7).replace('-','');},
 glProof(s,runId,fileId){
  const st=v=>this.str(v),gl=getQboGeneralLedgerReportSpreadsheet_();
  const reg=this.one(this.rows(gl,QBO_GENERAL_LEDGER_REPORT.RUNS_SHEET,
   ['ExtractRunId','SnapshotFileId','ReportStartDate','ReportEndDate','ReportBasis','RowCount','ExtractedAt','SnapshotArtifactContract'])
   .filter(x=>st(x.ExtractRunId)===st(runId)),'GL_RUN');
  if(st(reg.SnapshotFileId)!==st(fileId)||qboGeneralLedgerDateText_(reg.ReportStartDate)!==s.start||qboGeneralLedgerDateText_(reg.ReportEndDate)!==s.end||st(reg.ReportBasis)!=='Cash'||st(reg.SnapshotArtifactContract)!=='GL_RUN_SNAPSHOT_V2')throw Error('REV628_GL_REGISTRY_MISMATCH');
  const ss=SpreadsheetApp.openById(st(fileId)),m=this.metadata(ss);
  if(st(m.ArtifactContract)!=='GL_RUN_SNAPSHOT_V2'||st(m.ExtractRunId)!==st(runId)||st(m.ReportBasis)!=='Cash'||qboGeneralLedgerDateText_(m.ReportStartDate)!==s.start||qboGeneralLedgerDateText_(m.ReportEndDate)!==s.end)throw Error('REV628_GL_METADATA_MISMATCH');
  const data=this.rows(ss,QBO_GENERAL_LEDGER_REPORT.DATA_SHEET,['ExtractRunId','ReportStartDate','ReportEndDate','ReportBasis']);
  if(data.length!==Number(reg.RowCount)||data.length!==Number(m.RowCount)||data.some(x=>st(x.ExtractRunId)!==st(runId)||qboGeneralLedgerDateText_(x.ReportStartDate)!==s.start||qboGeneralLedgerDateText_(x.ReportEndDate)!==s.end||st(x.ReportBasis)!=='Cash'))throw Error('REV628_GL_SNAPSHOT_CONTENT_MISMATCH');
  if(this.date(m.ExtractedAt)!==this.date(reg.ExtractedAt))throw Error('REV628_GL_EXTRACTED_AT_MISMATCH');
  return {Family:'GL',Certified:true,RunId:st(runId),FileId:st(fileId),RowCount:data.length,ExtractedAt:reg.ExtractedAt};
 },
 familyProof(s,family,runId,fileId,seq,expectedGl){
  const st=v=>this.str(v),tsd=family==='TSD';if(!tsd&&family!=='RECOGNITION')throw Error('REV628_BAD_FAMILY');
  if(!st(seq)||!Number.isInteger(Number(seq))||Number(seq)<1)throw Error('REV628_SEQUENCE_REQUIRED');
  const ss=tsd?qboTsdGetWorkbook_():qboStrGetWorkbook_(),cfg=tsd?QBO_TAXABLE_SALES_DETAIL:QBO_SALES_TAX_RECOGNITION;
  if(ss.getId()!==st(fileId))throw Error('REV628_WORKBOOK_ID_MISMATCH');
  const period=this.period(s),log=this.one(this.rows(ss,cfg.LOG_SHEET,
   ['Snapshot_Run_ID','Period_Key','Period_Start','Period_End','Status','Row_Count'].concat(tsd?['Report_AsOf_DateTime']:['Derived_At','Source_GL_Extract_Run_ID']))
   .filter(x=>st(x.Snapshot_Run_ID)===st(runId)),'LOG_'+family);
  if(st(log.Period_Key)!==period||st(log.Period_Start)!==s.start||st(log.Period_End)!==s.end||st(log.Status)!=='SUCCESS')throw Error('REV628_'+family+'_LOG_MISMATCH');
  const snapshot=this.rows(ss,cfg.SNAPSHOT_SHEET,['Period_Key','Snapshot_Run_ID','Snapshot_Sequence'].concat(tsd?[]:['Source_GL_Extract_Run_ID']));
  const selected=snapshot.filter(x=>st(x.Snapshot_Run_ID)===st(runId));
  if(selected.length!==Number(log.Row_Count)||selected.some(x=>st(x.Period_Key)!==period||st(x.Snapshot_Sequence)!==st(seq)))throw Error('REV628_'+family+'_SNAPSHOT_MISMATCH');
  // Zero-row TSD/Recognition exports do not persist run/sequence rows, and the
  // success log has no sequence field. Their sequence cannot be independently
  // certified; fail closed rather than treating the log as sufficient proof.
  if(selected.length===0)throw Error('REV628_'+family+'_ZERO_ROW_SEQUENCE_NOT_CERTIFIABLE');
  if(snapshot.some(x=>st(x.Period_Key)===period&&st(x.Snapshot_Sequence)===st(seq)&&st(x.Snapshot_Run_ID)!==st(runId)))throw Error('REV628_'+family+'_SEQUENCE_COLLISION');
  if(!tsd){
   if(!st(expectedGl)||st(log.Source_GL_Extract_Run_ID)!==st(expectedGl)||selected.some(x=>st(x.Source_GL_Extract_Run_ID)!==st(expectedGl)))throw Error('REV628_RECOGNITION_GL_LINEAGE_MISMATCH');
  }
  return {Family:family,Certified:true,RunId:st(runId),FileId:st(fileId),Sequence:Number(seq),RowCount:selected.length,LoggedAt:log[tsd?'Report_AsOf_DateTime':'Derived_At']};
 },
 certify(controlId,requestId){
  const s=this.load(controlId,requestId),r=s.entry.data,st=v=>this.str(v),findings=[];
  if(st(r.Period_Key)!==this.period(s).slice(2))throw Error('REV628_PERIOD_KEY_MISMATCH');
  const specs=[['GL','GL_ExtractRunId','GL_SnapshotFileId',''],['TSD','Taxable_Sales_Detail_Snapshot_Run_ID','Taxable_Sales_Detail_Workbook_File_ID','Taxable_Sales_Detail_Snapshot_Sequence'],['RECOGNITION','Sales_Tax_Recognition_Snapshot_Run_ID','Sales_Tax_Recognition_Workbook_File_ID','Sales_Tax_Recognition_Snapshot_Sequence']];
  specs.forEach(([f,run,file,seq])=>{
   const vals=[r[run],r[file]].concat(seq?[r[seq]]:[]).map(st);
   if(vals.every(x=>!x)){findings.push({Family:f,Certified:false,Reason:'NOT_CHECKPOINTED'});return;}
   if(vals.some(x=>!x))throw Error('REV628_PARTIAL_CHECKPOINT_'+f);
   findings.push(f==='GL'?this.glProof(s,r[run],r[file]):this.familyProof(s,f,r[run],r[file],r[seq],r.GL_ExtractRunId));
  });
  if(findings[2].Certified&&(!findings[0].Certified||!findings[1].Certified||st(r.Sales_Tax_Recognition_Source_GL_ExtractRunId)!==st(r.GL_ExtractRunId)))throw Error('REV628_RECOGNITION_CHECKPOINT_CHAIN_INVALID');
  const all=findings.every(x=>x.Certified);
  return {Version:this.VERSION,Status:all?'ALL_THREE_FAMILIES_CERTIFIED':'PARTIAL_EVIDENCE_CERTIFICATION',Read_Only:true,Production_Writes:0,Revision_ID:r.Revision_ID,Revision_Request_ID:r.Revision_Request_ID,Request_Status:r.Request_Status,Findings:findings,Certified:all,Safe_To_Start_Revision_Capture:false};
 },
 recoverPreview(controlId,requestId,family,runId,fileId,seq){
  const s=this.load(controlId,requestId),r=s.entry.data,st=v=>this.str(v);
  if(st(r.Request_Status)!=='CAPTURING'||st(r.Error_Code).indexOf(family)<0)throw Error('REV628_NOT_MATCHING_IN_FLIGHT_FAMILY');
  const next=!st(r.GL_ExtractRunId)?'GL':!st(r.Taxable_Sales_Detail_Snapshot_Run_ID)?'TSD':!st(r.Sales_Tax_Recognition_Snapshot_Run_ID)?'RECOGNITION':'COMPLETE';
  if(family!==next)throw Error('REV628_RECOVERY_FAMILY_NOT_NEXT');
  if(!st(runId)||!st(fileId))throw Error('REV628_EXPLICIT_CANDIDATE_REQUIRED');
  const since=this.date(r.Processing_Started_At);if(!Number.isFinite(since))throw Error('REV628_MISSING_DURABLE_START');
  const proof=family==='GL'?this.glProof(s,runId,fileId):this.familyProof(s,family,runId,fileId,seq,r.GL_ExtractRunId);
  const timestamp=this.date(family==='GL'?proof.ExtractedAt:proof.LoggedAt);
  if(!Number.isFinite(timestamp)||timestamp<since)throw Error('REV628_CANDIDATE_PREDATES_REQUEST');
  // Reject other candidate runs since the in-flight marker; cannot infer which export belongs to this request.
  let competing;
  if(family==='GL'){
   competing=this.rows(getQboGeneralLedgerReportSpreadsheet_(),QBO_GENERAL_LEDGER_REPORT.RUNS_SHEET,['ExtractRunId','ExtractedAt','ReportStartDate','ReportEndDate'])
    .filter(x=>qboGeneralLedgerDateText_(x.ReportStartDate)===s.start&&qboGeneralLedgerDateText_(x.ReportEndDate)===s.end&&this.date(x.ExtractedAt)>=since);
  }else{
   const cfg=family==='TSD'?QBO_TAXABLE_SALES_DETAIL:QBO_SALES_TAX_RECOGNITION,ss=family==='TSD'?qboTsdGetWorkbook_():qboStrGetWorkbook_(),time=family==='TSD'?'Report_AsOf_DateTime':'Derived_At';
   competing=this.rows(ss,cfg.LOG_SHEET,['Snapshot_Run_ID','Period_Key','Period_Start','Period_End',time])
    .filter(x=>st(x.Period_Key)===this.period(s)&&st(x.Period_Start)===s.start&&st(x.Period_End)===s.end&&this.date(x[time])>=since);
  }
  if(competing.length!==1||st(competing[0][family==='GL'?'ExtractRunId':'Snapshot_Run_ID'])!==st(runId))throw Error('REV628_AMBIGUOUS_RECOVERY_CANDIDATES_'+competing.length);
  return {Version:this.VERSION,Status:'RECOVERY_CANDIDATE_CERTIFIED',Read_Only:true,Production_Writes:0,Revision_ID:r.Revision_ID,Revision_Request_ID:r.Revision_Request_ID,Family:family,Proof:proof,Recovery_Released:false,Safe_To_Start_Revision_Capture:false};
 },
 recoverConfirmed(controlId,requestId,family,runId,fileId,seq,confirmation){
  if(confirmation!=='CONFIRM_ATTACH_EXISTING_EVIDENCE_NO_EXPORT')throw Error('REV628_OPERATOR_CONFIRMATION_REQUIRED');
  const lock=LockService.getScriptLock();if(!lock.tryLock(30000))throw Error('REV628_LOCK_BUSY');
  try{
   const p=this.recoverPreview(controlId,requestId,family,runId,fileId,seq),s=this.load(controlId,requestId),r=s.entry.data;
   if(family==='GL'){r.GL_ExtractRunId=runId;r.GL_SnapshotFileId=fileId;}
   else if(family==='TSD'){r.Taxable_Sales_Detail_Snapshot_Run_ID=runId;r.Taxable_Sales_Detail_Workbook_File_ID=fileId;r.Taxable_Sales_Detail_Snapshot_Sequence=seq;}
   else {r.Sales_Tax_Recognition_Snapshot_Run_ID=runId;r.Sales_Tax_Recognition_Workbook_File_ID=fileId;r.Sales_Tax_Recognition_Snapshot_Sequence=seq;r.Sales_Tax_Recognition_Source_GL_ExtractRunId=r.GL_ExtractRunId;}
   // A single row write is the only mutation. Keep status CAPTURING until
   // independent re-certification passes, then release to resumable FAILED.
   QBO_REVISION_CAPTURE_V15621.checkpoint(s.sheet,s.entry);SpreadsheetApp.flush();
   const cert=this.certify(controlId,requestId),matched=cert.Findings.find(x=>x.Family===family);
   if(!matched||!matched.Certified)throw Error('REV628_RECOVERED_CHECKPOINT_NOT_CERTIFIED_MANUAL_REVIEW');
   r.Request_Status='FAILED';r.Error_Code='';r.Error_Message='';
   QBO_REVISION_CAPTURE_V15621.checkpoint(s.sheet,s.entry);SpreadsheetApp.flush();
   return {Version:this.VERSION,Status:'EXISTING_EVIDENCE_ATTACHED_AND_CERTIFIED',Revision_Request_ID:r.Revision_Request_ID,Family:family,Production_Writes:2,No_Export_Invoked:true,Proof:p.Proof};
  }finally{lock.releaseLock();}
 }
});
function certifyRegistryQboPrefilingRevisionV15628(){const x=QBO_REVISION_REGISTRY_DIAGNOSTICS_V15627.resolve();const v=QBO_REVISION_HARDENING_V15628.certify(x.controlId,x.requestId);console.log('[REV628 APP50] | CERTIFY | '+JSON.stringify(v));return v;}
function previewQboPrefilingRecoveryV15628(controlId,requestId,family,runId,fileId,sequence){const v=QBO_REVISION_HARDENING_V15628.recoverPreview(controlId,requestId,family,runId,fileId,sequence);console.log('[REV628 APP50] | RECOVERY PREVIEW | '+JSON.stringify(v));return v;}
function attachConfirmedQboPrefilingRecoveryV15628(controlId,requestId,family,runId,fileId,sequence,confirmation){const v=QBO_REVISION_HARDENING_V15628.recoverConfirmed(controlId,requestId,family,runId,fileId,sequence,confirmation);console.log('[REV628 APP50] | RECOVERY ATTACH | '+JSON.stringify(v));return v;}
