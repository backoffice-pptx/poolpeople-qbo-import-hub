/** v1.5.624. One external export per invocation. Does not call v1.5.622 execute.
 * A CAPTURING marker is durable before any export; ambiguous failures require
 * manual reconciliation. No automated retry, no rewriting original evidence.
 */
const QBO_REVISION_CONTROLLED_V15624 = Object.freeze({
 VERSION:'1.5.624',
 str(v){return String(v===null||v===undefined?'':v).trim();},
 load(controlId,requestId){
  const s=QBO_REVISION_CAPTURE_V15621.select(QBO_REVISION_CAPTURE_V15621.open(controlId),requestId);
  const r=s.entry.data;
  if(!['REQUESTED','FAILED','CAPTURING','COMPLETE'].includes(this.str(r.Request_Status)))throw Error('REV624_BAD_REQUEST_STATUS');
  const cert=QBO_REVISION_EVIDENCE_CERT_V15623.certify(controlId,requestId);
  return {s,r,cert};
 },
 save(s){QBO_REVISION_CAPTURE_V15621.checkpoint(s.sheet,s.entry);SpreadsheetApp.flush();},
 family(r){
  if(!this.str(r.GL_ExtractRunId))return 'GL';
  if(!this.str(r.Taxable_Sales_Detail_Snapshot_Run_ID))return 'TSD';
  if(!this.str(r.Sales_Tax_Recognition_Snapshot_Run_ID))return 'RECOGNITION';
  return 'COMPLETE';
 },
 checkPrevious(cert,next){
  const order=['GL','TSD','RECOGNITION'];
  for(let i=0;i<order.indexOf(next);i++){
   const f=cert.Findings.find(x=>x.Family===order[i]);
   if(!f||!f.Certified)throw Error('REV624_PREVIOUS_CHECKPOINT_UNCERTIFIED_'+order[i]);
  }
 },
 preview(controlId,requestId){
  const x=this.load(controlId,requestId),next=this.family(x.r);
  return {Version:this.VERSION,Status:x.r.Request_Status,Revision_ID:x.r.Revision_ID,Revision_Request_ID:x.r.Revision_Request_ID,Next_Family:next,Certification:x.cert.Findings,Read_Only:true,Production_Writes:0,Safe_To_Start_Revision_Capture:false};
 },
 executeOne(controlId,requestId){
  if(!this.str(controlId)||!this.str(requestId))throw Error('REV624_EXPLICIT_IDS_REQUIRED');
  const lock=LockService.getScriptLock();if(!lock.tryLock(30000))throw Error('REV624_LOCK_BUSY');
  try{
   const x=this.load(controlId,requestId),s=x.s,r=x.r,next=this.family(r);
   if(this.str(r.Request_Status)==='CAPTURING')throw Error('REV624_IN_FLIGHT_MANUAL_RECOVERY_REQUIRED');
   if(this.str(r.Request_Status)==='COMPLETE'){
    if(!x.cert.Certified)throw Error('REV624_COMPLETE_UNCERTIFIED');
    return {Version:this.VERSION,Status:'ALREADY_COMPLETE',Production_Writes:0};
   }
   this.checkPrevious(x.cert,next);
   if(next==='COMPLETE'){
    if(!x.cert.Certified)throw Error('REV624_FINAL_CERTIFICATION_FAILED');
    r.Request_Status='COMPLETE';r.Completed_At=new Date();r.Error_Code='';r.Error_Message='';this.save(s);
    return {Version:this.VERSION,Status:'REVISION_CAPTURE_COMPLETE',Production_Writes:1,Certification:x.cert.Findings};
   }
   // Existing incomplete checkpoints may not be overwritten.
   if(x.cert.Findings.some(f=>f.Family===next&&f.Reason!=='NOT_CHECKPOINTED'))throw Error('REV624_UNCERTAIN_NEXT_CHECKPOINT');
   r.Request_Status='CAPTURING';r.Error_Code='REV624_IN_FLIGHT_'+next;
   r.Error_Message='Do not retry automatically; reconcile export evidence first';
   if(!r.Processing_Started_At)r.Processing_Started_At=new Date();
   this.save(s);
   let v;
   try{
    if(next==='GL'){
     v=exportQboGeneralLedgerForPeriod(s.start,s.end);
     if(!v||!this.str(v.extractRunId)||!this.str(v.snapshotFileId))throw Error('REV624_GL_RETURN_INCOMPLETE');
     r.GL_ExtractRunId=v.extractRunId;r.GL_SnapshotFileId=v.snapshotFileId;
    }else if(next==='TSD'){
     v=exportQboTaxableSalesDetailForPeriod(s.start,s.end);
     if(!v||!this.str(v.runId)||!this.str(v.spreadsheetId)||!this.str(v.snapshotSequence))throw Error('REV624_TSD_RETURN_INCOMPLETE');
     r.Taxable_Sales_Detail_Snapshot_Run_ID=v.runId;
     r.Taxable_Sales_Detail_Workbook_File_ID=v.spreadsheetId;
     r.Taxable_Sales_Detail_Snapshot_Sequence=v.snapshotSequence;
    }else{
     v=exportQboSalesTaxRecognitionForPeriod(s.start,s.end,this.str(r.GL_ExtractRunId));
     if(!v||!this.str(v.runId)||!this.str(v.spreadsheetId)||!this.str(v.snapshotSequence)||this.str(v.sourceGlExtractRunId)!==this.str(r.GL_ExtractRunId))throw Error('REV624_RECOGNITION_RETURN_OR_LINEAGE_INVALID');
     r.Sales_Tax_Recognition_Snapshot_Run_ID=v.runId;
     r.Sales_Tax_Recognition_Workbook_File_ID=v.spreadsheetId;
     r.Sales_Tax_Recognition_Snapshot_Sequence=v.snapshotSequence;
     r.Sales_Tax_Recognition_Source_GL_ExtractRunId=v.sourceGlExtractRunId;
    }
    // Preserve in-flight marker until evidence is independently certified.
    this.save(s);
    const certified=QBO_REVISION_EVIDENCE_CERT_V15623.certify(controlId,requestId);
    const f=certified.Findings.find(z=>z.Family===next);
    if(!f||!f.Certified)throw Error('REV624_NEW_EVIDENCE_UNCERTIFIED_'+next);
    r.Request_Status='FAILED'; // resumable checkpointed state; next invocation advances
    r.Error_Code='';r.Error_Message='';this.save(s);
    return {Version:this.VERSION,Status:'FAMILY_CERTIFIED_NEXT_INVOCATION_REQUIRED',Family:next,Revision_Request_ID:r.Revision_Request_ID,Production_Writes:3,Certification:f};
   }catch(e){
    r.Request_Status='CAPTURING';r.Error_Code='REV624_UNCERTAIN_'+next;
    r.Error_Message=String(e&&e.message||e).slice(0,450);
    this.save(s);throw e;
   }
  }finally{lock.releaseLock();}
 },
 // Explicitly block in-flight recovery until an independently validated
 // candidate-evidence reconciliation path is implemented.
 recover(){throw Error('REV624_MANUAL_RECOVERY_NOT_IMPLEMENTED_DO_NOT_RETRY_EXPORT');}

});
function previewQboPrefilingControlledCaptureV15624(controlSpreadsheetId,revisionRequestId){const v=QBO_REVISION_CONTROLLED_V15624.preview(controlSpreadsheetId,revisionRequestId);console.log('[REV624 APP50] | PREVIEW | '+JSON.stringify(v));return v;}
function runOneQboPrefilingControlledCaptureV15624(controlSpreadsheetId,revisionRequestId){const v=QBO_REVISION_CONTROLLED_V15624.executeOne(controlSpreadsheetId,revisionRequestId);console.log('[REV624 APP50] | ONE_FAMILY | '+JSON.stringify(v));return v;}
