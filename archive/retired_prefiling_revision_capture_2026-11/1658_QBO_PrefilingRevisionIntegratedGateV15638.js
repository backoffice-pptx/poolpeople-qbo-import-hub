/** v1.5.636 — October 2026 scoped production release candidate.
 * Exact revision/request/period scope, one family per explicit invocation,
 * independent v1.5.635 evidence certification and recovery hardening.
 * DO NOT RUN production entry points before operator approves release preview.
 */
const QBO_REVISION_INTEGRATED_V15638 = Object.freeze({
 VERSION:'1.5.638',
 // Scoped production authorization: ONLY the exact October 2026 revision.
 PRODUCTION_RELEASED:true,
 AUTHORIZED_REVISION_ID:'8ec4ff53-00e4-4d10-9eaf-c9a15d7e1af5',
 AUTHORIZED_REQUEST_ID:'fe715efe-b1a6-4e42-8bfc-884c6be10f82',
 AUTHORIZED_PERIOD_KEY:'2610',
 AUTHORIZED_CONTROL_ASSET:'SALES_TAX_RECONCILIATION_CONTROL',
 str(v){return String(v===null||v===undefined?'':v).trim();},
 assertScope(z){
  const r=z.r,x=z.x;
  if(this.str(r.Revision_ID)!==this.AUTHORIZED_REVISION_ID||
     this.str(r.Revision_Request_ID)!==this.AUTHORIZED_REQUEST_ID||
     this.str(r.Period_Key)!==this.AUTHORIZED_PERIOD_KEY||
     this.str(x.requestId)!==this.AUTHORIZED_REQUEST_ID)
   throw Error('REV636_UNAUTHORIZED_REVISION_SCOPE');
  // Registry resolution is deliberately inherited from the v1.5.627 selector.
  // Verify the selected request is the sole exact authorized revision.
  if(this.str(z.s.start)!=='2026-10-01'||this.str(z.s.end)!=='2026-10-31')
   throw Error('REV636_UNAUTHORIZED_PERIOD_DATES');
  return true;
 },
 order:['GL','TSD','RECOGNITION'],
 resolve(){return QBO_REVISION_REGISTRY_DIAGNOSTICS_V15627.resolve();},
 load(){
  const x=this.resolve();
  const s=QBO_REVISION_CAPTURE_V15621.select(QBO_REVISION_CAPTURE_V15621.open(x.controlId),x.requestId);
  const cert=QBO_REVISION_HARDENING_V15638.certify(x.controlId,x.requestId);
  const z={x,s,r:s.entry.data,cert};this.assertScope(z);return z;
 },
 next(r){
  if(!this.str(r.GL_ExtractRunId))return 'GL';
  if(!this.str(r.Taxable_Sales_Detail_Snapshot_Run_ID))return 'TSD';
  if(!this.str(r.Sales_Tax_Recognition_Snapshot_Run_ID))return 'RECOGNITION';
  return 'COMPLETE';
 },
 gate(){
  const z=this.load(),r=z.r,next=this.next(r),status=this.str(r.Request_Status);
  const previous=this.order.slice(0,this.order.indexOf(next));
  const findings=z.cert.Findings;
  const priorCertified=previous.every(f=>findings.some(x=>x.Family===f&&x.Certified));
  const nextFinding=findings.find(f=>f.Family===next);
  const nextClear=next==='COMPLETE'||!!(nextFinding&&!nextFinding.Certified&&nextFinding.Reason==='NOT_CHECKPOINTED');
  const ready=status==='REQUESTED'||status==='FAILED';
  const eligible=ready&&priorCertified&&nextClear&&next!=='COMPLETE';
  return {Version:this.VERSION,Status:'RELEASE_GATE_PREVIEW',Read_Only:true,Production_Writes:0,
   Revision_ID:r.Revision_ID,Revision_Request_ID:r.Revision_Request_ID,Period_Key:r.Period_Key,
   Request_Status:status,Next_Family:next,Prior_Checkpoints_Certified:priorCertified,
   Next_Checkpoint_Unwritten:nextClear,Request_Eligible:eligible,
   Authorized_Revision_Scope:true,Authorized_Revision_ID:this.AUTHORIZED_REVISION_ID,
   Production_Release_Enabled:this.PRODUCTION_RELEASED,
   Safe_To_Start_Revision_Capture:eligible&&this.PRODUCTION_RELEASED,
   Certification:findings};
 },
 save(s){QBO_REVISION_CAPTURE_V15621.checkpoint(s.sheet,s.entry);SpreadsheetApp.flush();},
 executeOne(confirmation){
  if(confirmation!=='CONFIRM_ONE_REVISION_EXPORT')throw Error('REV631_EXPLICIT_EXPORT_CONFIRMATION_REQUIRED');
  if(!this.PRODUCTION_RELEASED)throw Error('REV631_PRODUCTION_RELEASE_NOT_APPROVED');
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(30000))throw Error('REV631_LOCK_BUSY');
  try{
   const z=this.load(),r=z.r,s=z.s,next=this.next(r);
   if(!['REQUESTED','FAILED'].includes(this.str(r.Request_Status)))throw Error('REV631_REQUEST_NOT_RESUMABLE');
   if(next==='COMPLETE')throw Error('REV631_NO_EXPORT_PENDING');
   for(const f of this.order.slice(0,this.order.indexOf(next)))
    if(!z.cert.Findings.some(x=>x.Family===f&&x.Certified))throw Error('REV631_PREVIOUS_NOT_CERTIFIED_'+f);
   const nf=z.cert.Findings.find(x=>x.Family===next);
   if(!nf||nf.Reason!=='NOT_CHECKPOINTED')throw Error('REV631_NEXT_CHECKPOINT_NOT_EMPTY');
   r.Request_Status='CAPTURING';r.Error_Code='REV631_IN_FLIGHT_'+next;
   r.Error_Message='Uncertain external write; operator must reconcile before retry';
   r.Processing_Started_At=new Date();this.save(s);
   try{
    let v;
    if(next==='GL'){
     v=exportQboGeneralLedgerForPeriod(s.start,s.end);
     if(!v||!this.str(v.extractRunId)||!this.str(v.snapshotFileId))throw Error('REV631_GL_RESULT_INCOMPLETE');
     r.GL_ExtractRunId=v.extractRunId;r.GL_SnapshotFileId=v.snapshotFileId;
    }else if(next==='TSD'){
     v=exportQboTaxableSalesDetailForPeriod(s.start,s.end);
     if(!v||!this.str(v.runId)||!this.str(v.spreadsheetId)||!this.str(v.snapshotSequence))throw Error('REV631_TSD_RESULT_INCOMPLETE');
     r.Taxable_Sales_Detail_Snapshot_Run_ID=v.runId;
     r.Taxable_Sales_Detail_Workbook_File_ID=v.spreadsheetId;
     r.Taxable_Sales_Detail_Snapshot_Sequence=v.snapshotSequence;
    }else{
     v=exportQboSalesTaxRecognitionForPeriod(s.start,s.end,this.str(r.GL_ExtractRunId));
     if(!v||!this.str(v.runId)||!this.str(v.spreadsheetId)||!this.str(v.snapshotSequence)||this.str(v.sourceGlExtractRunId)!==this.str(r.GL_ExtractRunId))throw Error('REV631_RECOGNITION_RESULT_OR_LINEAGE_INVALID');
     r.Sales_Tax_Recognition_Snapshot_Run_ID=v.runId;
     r.Sales_Tax_Recognition_Workbook_File_ID=v.spreadsheetId;
     r.Sales_Tax_Recognition_Snapshot_Sequence=v.snapshotSequence;
     r.Sales_Tax_Recognition_Source_GL_ExtractRunId=v.sourceGlExtractRunId;
    }
    // Persist identities before certification. CAPTURING remains until proven.
    this.save(s);
    const certified=QBO_REVISION_HARDENING_V15638.certify(z.x.controlId,z.x.requestId);
    if(!certified.Findings.some(x=>x.Family===next&&x.Certified))throw Error('REV631_NEW_SNAPSHOT_NOT_CERTIFIED_'+next);
    r.Request_Status='FAILED';r.Error_Code='';r.Error_Message='';this.save(s);
    return {Version:this.VERSION,Status:'ONE_FAMILY_CERTIFIED',Family:next,
     Revision_Request_ID:r.Revision_Request_ID,Production_Writes:3,Next_Family:this.next(r)};
   }catch(e){
    r.Request_Status='CAPTURING';r.Error_Code='REV631_UNCERTAIN_'+next;
    r.Error_Message=String(e&&e.message||e).slice(0,450);this.save(s);throw e;
   }
  }finally{lock.releaseLock();}
 },
 finalize(confirmation){
  if(confirmation!=='CONFIRM_REVISION_CAPTURE_COMPLETE')throw Error('REV631_FINALIZE_CONFIRMATION_REQUIRED');
  if(!this.PRODUCTION_RELEASED)throw Error('REV631_PRODUCTION_RELEASE_NOT_APPROVED');
  const lock=LockService.getScriptLock();if(!lock.tryLock(30000))throw Error('REV631_LOCK_BUSY');
  try{
   const z=this.load(),r=z.r;
   if(this.next(r)!=='COMPLETE'||!z.cert.Certified||!['FAILED','REQUESTED'].includes(this.str(r.Request_Status)))throw Error('REV631_FINALIZATION_GATE_FAILED');
   r.Request_Status='COMPLETE';r.Completed_At=new Date();r.Error_Code='';r.Error_Message='';this.save(z.s);
   return {Version:this.VERSION,Status:'REVISION_CAPTURE_COMPLETE',Revision_Request_ID:r.Revision_Request_ID,Production_Writes:1};
  }finally{lock.releaseLock();}
 }
});
function previewRegistryQboPrefilingIntegratedGateV15638(){
 const result=QBO_REVISION_INTEGRATED_V15638.gate();
 console.log('[REV638 APP50] | RELEASE GATE | '+JSON.stringify(result));return result;
}
// No parameterless export function is provided: production requires explicit confirmation.
function runOneQboPrefilingIntegratedCaptureV15638(confirmation){
 const result=QBO_REVISION_INTEGRATED_V15638.executeOne(confirmation);
 console.log('[REV638 APP50] | ONE FAMILY | '+JSON.stringify(result));return result;
}
function finalizeQboPrefilingIntegratedCaptureV15638(confirmation){
 const result=QBO_REVISION_INTEGRATED_V15638.finalize(confirmation);
 console.log('[REV638 APP50] | FINALIZE | '+JSON.stringify(result));return result;
}
