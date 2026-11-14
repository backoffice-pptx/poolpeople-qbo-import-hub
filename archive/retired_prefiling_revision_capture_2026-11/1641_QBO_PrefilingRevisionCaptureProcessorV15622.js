/** v1.5.622: explicitly selected revision capture. No legacy ledger mutation.
 * Export-in-flight states are fail-closed: after a hard termination, operators
 * must reconcile the external export before resuming (never silently duplicate).
 */
const QBO_REVISION_CAPTURE_PROCESSOR_V15622 = Object.freeze({
 VERSION:'1.5.622',
 stages:Object.freeze([
  {name:'GL',run:'GL_ExtractRunId',file:'GL_SnapshotFileId'},
  {name:'TSD',run:'Taxable_Sales_Detail_Snapshot_Run_ID',file:'Taxable_Sales_Detail_Workbook_File_ID'},
  {name:'RECOGNITION',run:'Sales_Tax_Recognition_Snapshot_Run_ID',file:'Sales_Tax_Recognition_Workbook_File_ID'}
 ]),
 nonempty(v){return String(v===null||v===undefined?'':v).trim();},
 verify(s){
  const r=s.entry.data;
  if(!this.nonempty(r.Revision_ID)||!this.nonempty(r.Revision_Request_ID))throw Error('REV622_IDENTITY_MISSING');
  if(!['REQUESTED','FAILED','CAPTURING','COMPLETE'].includes(this.nonempty(r.Request_Status)))throw Error('REV622_REQUEST_STATUS_UNSUPPORTED');
  if(this.nonempty(r.Request_Status)==='CAPTURING')throw Error('REV622_IN_FLIGHT_REQUIRES_OPERATOR_RECONCILIATION');
  for(const x of this.stages){
   const hasRun=!!this.nonempty(r[x.run]),hasFile=!!this.nonempty(r[x.file]);
   if(hasRun!==hasFile)throw Error('REV622_PARTIAL_CHECKPOINT_'+x.name);
  }
  if(this.nonempty(r.Taxable_Sales_Detail_Snapshot_Run_ID)&&!this.nonempty(r.GL_ExtractRunId))throw Error('REV622_TSD_WITHOUT_GL');
  if(this.nonempty(r.Sales_Tax_Recognition_Snapshot_Run_ID)&&!this.nonempty(r.Taxable_Sales_Detail_Snapshot_Run_ID))throw Error('REV622_RECOGNITION_WITHOUT_TSD');
  if(this.nonempty(r.Sales_Tax_Recognition_Snapshot_Run_ID)&&this.nonempty(r.Sales_Tax_Recognition_Source_GL_ExtractRunId)!==this.nonempty(r.GL_ExtractRunId))throw Error('REV622_RECOGNITION_GL_MISMATCH');
  if(this.nonempty(r.Request_Status)==='COMPLETE'&&!this.stages.every(x=>this.nonempty(r[x.run])&&this.nonempty(r[x.file])))throw Error('REV622_INCOMPLETE_MARKED_COMPLETE');
  return r;
 },
 preview(controlId,requestId){
  const s=QBO_REVISION_CAPTURE_V15621.select(QBO_REVISION_CAPTURE_V15621.open(controlId),requestId),r=this.verify(s);
  return {Version:this.VERSION,Status:r.Request_Status==='COMPLETE'?'REVISION_CAPTURE_ALREADY_COMPLETE':'REVISION_CAPTURE_EXECUTION_ELIGIBLE',Read_Only:true,Production_Writes:0,Revision_ID:r.Revision_ID,Revision_Request_ID:r.Revision_Request_ID,Period_Key:r.Period_Key,Request_Status:r.Request_Status,Checkpoints:this.stages.map(x=>({Family:x.name,Complete:!!this.nonempty(r[x.run])})),Safe_To_Start_Revision_Capture:false};
 },
 execute(controlId,requestId){
  if(!this.nonempty(controlId)||!this.nonempty(requestId))throw Error('REV622_EXPLICIT_IDS_REQUIRED');
  const lock=LockService.getScriptLock();if(!lock.tryLock(30000))throw Error('REV622_WORKER_LOCK_BUSY');
  try{
   const s=QBO_REVISION_CAPTURE_V15621.select(QBO_REVISION_CAPTURE_V15621.open(controlId),requestId),r=this.verify(s);
   if(r.Request_Status==='COMPLETE')return {Version:this.VERSION,Status:'ALREADY_COMPLETE',Revision_ID:r.Revision_ID,Revision_Request_ID:r.Revision_Request_ID,Production_Writes:0};
   const start=s.start,end=s.end;
   const save=()=>{r.Last_Updated_At=new Date();QBO_REVISION_CAPTURE_V15621.checkpoint(s.sheet,s.entry);};
   let writes=0;
   // Explicit durable marker BEFORE each external export. A crash cannot safely
   // retry an uncertain export; manual reconciliation is required instead.
   const stage=(label,fn,apply)=>{
    r.Request_Status='CAPTURING';r.Error_Code='REV622_IN_FLIGHT_'+label;r.Error_Message='External export may be in progress; reconcile before retry if interrupted';
    if(!r.Processing_Started_At)r.Processing_Started_At=new Date();save();writes++;
    let result;
    try{result=fn();apply(result);r.Request_Status='FAILED';r.Error_Code='';r.Error_Message='';save();writes++;}
    catch(e){
     // Retain CAPTURING if result is uncertain, even on synchronous failure.
     // A failed export may have created external artifacts before throwing.
     r.Error_Message=String(e&&e.message||e).slice(0,450);save();writes++;
     throw e;
    }
    return result;
   };
   if(!this.nonempty(r.GL_ExtractRunId))stage('GL',()=>exportQboGeneralLedgerForPeriod(start,end),v=>{
    if(!v||!this.nonempty(v.extractRunId)||!this.nonempty(v.snapshotFileId))throw Error('REV622_GL_RESULT_INCOMPLETE');
    r.GL_ExtractRunId=v.extractRunId;r.GL_SnapshotFileId=v.snapshotFileId;
   });
   if(!this.nonempty(r.Taxable_Sales_Detail_Snapshot_Run_ID))stage('TSD',()=>exportQboTaxableSalesDetailForPeriod(start,end),v=>{
    if(!v||!this.nonempty(v.runId)||!this.nonempty(v.spreadsheetId))throw Error('REV622_TSD_RESULT_INCOMPLETE');
    r.Taxable_Sales_Detail_Snapshot_Run_ID=v.runId;r.Taxable_Sales_Detail_Workbook_File_ID=v.spreadsheetId;r.Taxable_Sales_Detail_Snapshot_Sequence=v.snapshotSequence;
   });
   if(!this.nonempty(r.Sales_Tax_Recognition_Snapshot_Run_ID))stage('RECOGNITION',()=>exportQboSalesTaxRecognitionForPeriod(start,end,this.nonempty(r.GL_ExtractRunId)),v=>{
    if(!v||!this.nonempty(v.runId)||!this.nonempty(v.spreadsheetId)||this.nonempty(v.sourceGlExtractRunId)!==this.nonempty(r.GL_ExtractRunId))throw Error('REV622_RECOGNITION_RESULT_OR_LINEAGE_INVALID');
    r.Sales_Tax_Recognition_Snapshot_Run_ID=v.runId;r.Sales_Tax_Recognition_Workbook_File_ID=v.spreadsheetId;r.Sales_Tax_Recognition_Snapshot_Sequence=v.snapshotSequence;r.Sales_Tax_Recognition_Source_GL_ExtractRunId=v.sourceGlExtractRunId;
   });
   this.verify(Object.assign({},s,{entry:{data:Object.assign({},r,{Request_Status:'FAILED'})}}));
   r.Request_Status='COMPLETE';r.Completed_At=new Date();r.Error_Code='';r.Error_Message='';save();writes++;
   return {Version:this.VERSION,Status:'REVISION_CAPTURE_COMPLETE',Revision_ID:r.Revision_ID,Revision_Request_ID:r.Revision_Request_ID,Production_Writes:writes,GL_ExtractRunId:r.GL_ExtractRunId,Taxable_Sales_Detail_Snapshot_Run_ID:r.Taxable_Sales_Detail_Snapshot_Run_ID,Sales_Tax_Recognition_Snapshot_Run_ID:r.Sales_Tax_Recognition_Snapshot_Run_ID};
  }finally{lock.releaseLock();}
 }
});
function previewQboPrefilingRevisionCaptureV15622(controlSpreadsheetId,revisionRequestId){const r=QBO_REVISION_CAPTURE_PROCESSOR_V15622.preview(controlSpreadsheetId,revisionRequestId);console.log('[REV622 APP50] | PREVIEW | '+JSON.stringify(r));return r;}
function processQboPrefilingRevisionCaptureV15622(controlSpreadsheetId,revisionRequestId){const r=QBO_REVISION_CAPTURE_PROCESSOR_V15622.execute(controlSpreadsheetId,revisionRequestId);console.log('[REV622 APP50] | EXECUTE | '+JSON.stringify(r));return r;}
