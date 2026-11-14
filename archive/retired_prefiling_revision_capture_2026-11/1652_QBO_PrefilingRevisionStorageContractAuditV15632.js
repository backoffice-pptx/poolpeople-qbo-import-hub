/** v1.5.632: read-only production storage contract inspection. No ensure/migrate/export. */
const QBO_REVISION_STORAGE_AUDIT_V15632 = Object.freeze({
 VERSION:'1.5.632',
 text(v){return String(v===null||v===undefined?'':v).trim();},
 inspectFamily(family,ss,cfg,expected){
  const log=ss.getSheetByName(cfg.LOG_SHEET),snap=ss.getSheetByName(cfg.SNAPSHOT_SHEET);
  if(!log||!snap)throw Error('REV632_MISSING_SHEET_'+family);
  const old=expected.slice(0,-1),w=Math.max(log.getLastColumn(),expected.length);
  const h=log.getLastRow()?log.getRange(1,1,1,w).getValues()[0].map(this.text):[];
  const eq=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
  const current=eq(h.slice(0,expected.length),expected)&&h.slice(expected.length).every(v=>!v);
  const legacy=eq(h.slice(0,old.length),old)&&!h[old.length]&&h.slice(expected.length).every(v=>!v);
  let extraNonempty=0;
  if(legacy&&log.getLastRow()>1)extraNonempty=log.getRange(2,expected.length,log.getLastRow()-1,1).getValues().filter(r=>r[0]!==''&&r[0]!==null).length;
  const schema=log.getLastRow()===0?'EMPTY_NEW':current?'CURRENT':legacy&&extraNonempty===0?'LEGACY_APPEND_COMPATIBLE':'INCOMPATIBLE';
  const sh=snap.getLastRow()?snap.getRange(1,1,1,Math.max(snap.getLastColumn(),3)).getValues()[0].map(this.text):[];
  const required=['Period_Key','Snapshot_Sequence','Snapshot_Run_ID'];
  const missing=required.filter(x=>sh.indexOf(x)<0);
  let duplicateSequences=0,invalidSequences=0,zeroRowLogCount=0,unsequencedSuccess=0;
  if(current&&log.getLastRow()>1){
   const data=log.getRange(2,1,log.getLastRow()-1,expected.length).getValues();
   const ix=n=>expected.indexOf(n),seen={};
   data.forEach(r=>{
    if(this.text(r[ix('Status')])!=='SUCCESS')return;
    const p=this.text(r[ix('Period_Key')]),q=this.text(r[ix('Snapshot_Sequence')]),run=this.text(r[ix('Snapshot_Run_ID')]);
    if(Number(r[ix('Row_Count')])===0)zeroRowLogCount++;
    if(!q){unsequencedSuccess++;return;}
    if(!Number.isInteger(Number(q))||Number(q)<1)invalidSequences++;
    const k=p+'|'+q;
    if(seen[k]&&seen[k]!==run)duplicateSequences++;
    seen[k]=run;
   });
  }
  return {Family:family,Workbook_ID:ss.getId(),Log_Schema:schema,Log_Row_Count:Math.max(0,log.getLastRow()-1),Snapshot_Header_Missing:missing,Legacy_Extra_Column_Data_Rows:extraNonempty,Successful_Zero_Row_Logs:zeroRowLogCount,Unsequenced_Success_Logs:unsequencedSuccess,Invalid_Sequences:invalidSequences,Conflicting_Log_Sequences:duplicateSequences,Schema_Compatible:['EMPTY_NEW','CURRENT','LEGACY_APPEND_COMPATIBLE'].includes(schema)&&!missing.length&&extraNonempty===0&&invalidSequences===0&&duplicateSequences===0};
 },
 run(){
  // Resolve through the governed registry, not Script Properties or user-supplied IDs.
  const selection=QBO_REVISION_REGISTRY_DIAGNOSTICS_V15627.resolve();
  const tsd=this.inspectFamily('TSD',qboTsdGetWorkbook_(),QBO_TAXABLE_SALES_DETAIL,QBO_REV631_TSD_LOG_HEADERS);
  const rec=this.inspectFamily('RECOGNITION',qboStrGetWorkbook_(),QBO_SALES_TAX_RECOGNITION,QBO_STR_LOG_HEADERS);
  return {Version:this.VERSION,Status:tsd.Schema_Compatible&&rec.Schema_Compatible?'STORAGE_SCHEMA_COMPATIBLE':'STORAGE_SCHEMA_BLOCKED',Read_Only:true,Production_Writes:0,Asset_Key:'SALES_TAX_RECONCILIATION_CONTROL',Revision_Request_ID:selection.requestId,Findings:[tsd,rec],Zero_Row_Export_Execution_Tested:false,Recovery_Write_Tested:false,Safe_To_Start_Revision_Capture:false};
 }
});
function auditRegistryQboPrefilingStorageContractV15632(){
 const result=QBO_REVISION_STORAGE_AUDIT_V15632.run();
 console.log('[REV632 APP50] | STORAGE AUDIT | '+JSON.stringify(result));
 return result;
}
