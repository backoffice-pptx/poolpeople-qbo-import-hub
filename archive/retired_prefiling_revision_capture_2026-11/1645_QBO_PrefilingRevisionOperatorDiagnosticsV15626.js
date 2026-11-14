/** v1.5.626 — parameterless, read-only operator diagnostics.
 * Configure Script Properties (not source code):
 * QBO_PREFILING_REVISION_CONTROL_SPREADSHEET_ID
 * QBO_PREFILING_REVISION_REQUEST_ID
 * The request must be unique and linked to exactly one registry revision.
 * No exports, ledger writes, or recovery releases are performed.
 */
const QBO_REVISION_OPERATOR_DIAGNOSTICS_V15626 = Object.freeze({
 VERSION:'1.5.626',
 CONTROL_PROPERTY:'QBO_PREFILING_REVISION_CONTROL_SPREADSHEET_ID',
 REQUEST_PROPERTY:'QBO_PREFILING_REVISION_REQUEST_ID',
 str(v){return String(v===null||v===undefined?'':v).trim();},
 resolve(){
  const props=PropertiesService.getScriptProperties();
  const controlId=this.str(props.getProperty(this.CONTROL_PROPERTY));
  const requestId=this.str(props.getProperty(this.REQUEST_PROPERTY));
  if(!controlId)throw Error('REV626_MISSING_SCRIPT_PROPERTY_'+this.CONTROL_PROPERTY);
  if(!requestId)throw Error('REV626_MISSING_SCRIPT_PROPERTY_'+this.REQUEST_PROPERTY);
  if(!/^[a-zA-Z0-9_-]{20,}$/.test(controlId))throw Error('REV626_INVALID_CONTROL_SPREADSHEET_ID');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))throw Error('REV626_INVALID_REVISION_REQUEST_ID');
  const ss=QBO_REVISION_CAPTURE_V15621.open(controlId);
  const selected=QBO_REVISION_CAPTURE_V15621.select(ss,requestId);
  if(this.str(selected.entry.data.Revision_Request_ID)!==requestId)throw Error('REV626_REQUEST_IDENTITY_MISMATCH');
  return {controlId,requestId,selected};
 },
 preview(){
  const ctx=this.resolve();
  const candidate=QBO_REVISION_CONTROLLED_V15624.preview(ctx.controlId,ctx.requestId);
  const r=ctx.selected.entry.data;
  return {Version:this.VERSION,Status:'READ_ONLY_REVISION_OPERATOR_PREVIEW',Read_Only:true,Production_Writes:0,
   Revision_ID:r.Revision_ID,Revision_Request_ID:r.Revision_Request_ID,Period_Key:r.Period_Key,
   Request_Status:r.Request_Status,Next_Family:candidate.Next_Family,
   Certification:candidate.Certification,Safe_To_Start_Revision_Capture:false};
 },
 certify(){
  const ctx=this.resolve();
  const result=QBO_REVISION_EVIDENCE_CERT_V15623.certify(ctx.controlId,ctx.requestId);
  return Object.assign({},result,{Operator_Diagnostic_Version:this.VERSION,Read_Only:true,Production_Writes:0,Safe_To_Start_Revision_Capture:false});
 }
});
function previewConfiguredQboPrefilingRevisionV15626(){
 const r=QBO_REVISION_OPERATOR_DIAGNOSTICS_V15626.preview();
 console.log('[REV626 APP50] | CONFIGURED PREVIEW | '+JSON.stringify(r));return r;
}
function certifyConfiguredQboPrefilingRevisionV15626(){
 const r=QBO_REVISION_OPERATOR_DIAGNOSTICS_V15626.certify();
 console.log('[REV626 APP50] | CONFIGURED CERTIFY | '+JSON.stringify(r));return r;
}
