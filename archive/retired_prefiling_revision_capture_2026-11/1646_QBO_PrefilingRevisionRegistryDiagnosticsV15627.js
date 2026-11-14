/** v1.5.627 — read-only registry-resolved operator diagnostics.
 * Supersedes v1.5.626 Script Property-based diagnostics.
 * No export, capture, recovery, or ledger mutation.
 */
const QBO_REVISION_REGISTRY_DIAGNOSTICS_V15627 = Object.freeze({
 VERSION:'1.5.627',
 ASSET_KEY:'SALES_TAX_RECONCILIATION_CONTROL',
 str(v){return String(v===null||v===undefined?'':v).trim();},
 resolve(){
  if(typeof DataPlatform05==='undefined'||typeof DataPlatform05.getConfiguredAssetReference!=='function')
   throw Error('REV627_RUNTIME_ASSET_REGISTRY_UNAVAILABLE');
  const asset=DataPlatform05.getConfiguredAssetReference(this.ASSET_KEY,'Spreadsheet','PROD');
  const controlId=this.str(asset&&asset.ResourceIdentifier);
  if(!controlId)throw Error('REV627_CONTROL_ASSET_NOT_CONFIGURED');
  const ss=QBO_REVISION_CAPTURE_V15621.open(controlId);
  const sheet=ss.getSheetByName(QBO_REVISION_CAPTURE_V15621.SHEET);
  const rows=QBO_REVISION_CAPTURE_V15621.rows(sheet);
  // COMPLETED requests are historical evidence, not active selections.
  // CAPTURING is included so an interrupted request is visible to operators.
  const active=rows.filter(x=>['REQUESTED','CAPTURING','FAILED'].includes(this.str(x.data.Request_Status)));
  if(active.length!==1)throw Error('REV627_ACTIVE_REQUEST_COUNT_'+active.length+'_EXPLICIT_SELECTION_REQUIRED');
  const requestId=this.str(active[0].data.Revision_Request_ID);
  const selected=QBO_REVISION_CAPTURE_V15621.select(ss,requestId);
  if(selected.entry.row!==active[0].row)throw Error('REV627_SELECTED_REQUEST_ROW_MISMATCH');
  return {controlId,requestId,selected};
 },
 preview(){
  const x=this.resolve();
  const p=QBO_REVISION_CONTROLLED_V15624.preview(x.controlId,x.requestId);
  return {Version:this.VERSION,Status:'READ_ONLY_REVISION_OPERATOR_PREVIEW',Read_Only:true,Production_Writes:0,
   Asset_Key:this.ASSET_KEY,Revision_ID:p.Revision_ID,Revision_Request_ID:p.Revision_Request_ID,
   Period_Key:x.selected.entry.data.Period_Key,Request_Status:p.Status,Next_Family:p.Next_Family,
   Certification:p.Certification,Safe_To_Start_Revision_Capture:false};
 },
 certify(){
  const x=this.resolve();
  const r=QBO_REVISION_EVIDENCE_CERT_V15623.certify(x.controlId,x.requestId);
  return Object.assign({},r,{Operator_Diagnostic_Version:this.VERSION,Read_Only:true,Production_Writes:0,Safe_To_Start_Revision_Capture:false});
 }
});
function previewRegistryQboPrefilingRevisionV15627(){
 const r=QBO_REVISION_REGISTRY_DIAGNOSTICS_V15627.preview();
 console.log('[REV627 APP50] | REGISTRY PREVIEW | '+JSON.stringify(r));return r;
}
function certifyRegistryQboPrefilingRevisionV15627(){
 const r=QBO_REVISION_REGISTRY_DIAGNOSTICS_V15627.certify();
 console.log('[REV627 APP50] | REGISTRY CERTIFY | '+JSON.stringify(r));return r;
}
