/** v1.5.620. Read-only App 50 revision-capture compatibility preflight.
 * Does NOT change legacy dispatcher, accept revision requests, or export data.
 */
const QBO_REVISION_CAPTURE_CONTRACT_V15620=Object.freeze({
 VERSION:'1.5.620',REGISTRY_SHEET:'05_PreFiling_Evidence_Revisions',
 REGISTRY_HEADERS:['Revision_ID','Period_Key','Parent_PreFiling_Run_ID','Parent_Manifest_ID','Parent_Capture_Request_ID','Revision_Status','Revision_Request_ID','Replacement_Pairing_Evaluation_ID','Replacement_Liability_Summary_ID','Replacement_Liability_Detail_ID','GL_ExtractRunId','GL_SnapshotFileId','Taxable_Sales_Detail_Snapshot_Run_ID','Taxable_Sales_Detail_Workbook_File_ID','Sales_Tax_Recognition_Snapshot_Run_ID','Sales_Tax_Recognition_Workbook_File_ID','Sales_Tax_Recognition_Source_GL_ExtractRunId','Bank1_Reuse_Proof_ID','Superseding_Manifest_ID','Created_At','Updated_At','Completed_At','Error_Code','Error_Message'],
 inspect:function(controlSpreadsheetId){
   const ss=SpreadsheetApp.openById(String(controlSpreadsheetId||'').trim());
   const sh=ss.getSheetByName(this.REGISTRY_SHEET);
   const ledger=ss.getSheetByName(QBO_PREFILING_CAPTURE.SHEET_NAME);
   if(!ledger)throw Error('REV620_CAPTURE_LEDGER_MISSING');
   const capture=qboPreFilingReadLedger_(ledger);
   if(!sh)return {Version:this.VERSION,Status:'REGISTRY_NOT_INITIALIZED',Read_Only:true,Production_Writes:0,Safe_To_Start_Revision_Capture:false};
   const header=sh.getRange(1,1,1,this.REGISTRY_HEADERS.length).getValues()[0].map(x=>String(x||'').trim());
   if(JSON.stringify(header)!==JSON.stringify(this.REGISTRY_HEADERS))throw Error('REV620_REGISTRY_HEADER_DRIFT');
   const revisionCount=Math.max(0,sh.getLastRow()-1);
   return {Version:this.VERSION,Status:'CONTRACT_COMPATIBLE_CAPTURE_NOT_ENABLED',Read_Only:true,Production_Writes:0,Revision_Count:revisionCount,Capture_Ledger_Row_Count:capture.rows.length,Safe_To_Start_Revision_Capture:false};
 }
});
function inspectQboPrefilingRevisionCaptureContractV15620(controlSpreadsheetId){const r=QBO_REVISION_CAPTURE_CONTRACT_V15620.inspect(controlSpreadsheetId);console.log('[REV620 APP50] | READ_ONLY | '+JSON.stringify(r));return r;}
