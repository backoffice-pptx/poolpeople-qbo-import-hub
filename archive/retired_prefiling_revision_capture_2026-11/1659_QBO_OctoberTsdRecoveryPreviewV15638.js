/** v1.5.638 read-only diagnostic for the existing October TSD checkpoint. */
function previewOctoberTsdRecoveryV15638(){
 const x=QBO_REVISION_REGISTRY_DIAGNOSTICS_V15627.resolve();
 const s=QBO_REVISION_HARDENING_V15638.load(x.controlId,x.requestId);
 const r=s.entry.data;
 if(String(r.Revision_Request_ID)!=='fe715efe-b1a6-4e42-8bfc-884c6be10f82'||String(r.Period_Key)!=='2610')throw Error('REV638_WRONG_REQUEST');
 if(String(r.Taxable_Sales_Detail_Snapshot_Run_ID)!=='4b3e904a-a5cb-4b2f-b9b2-f2e059c3c9db'||Number(r.Taxable_Sales_Detail_Snapshot_Sequence)!==2)throw Error('REV638_WRONG_TSD_CHECKPOINT');
 const c=QBO_REVISION_HARDENING_V15638.certify(x.controlId,x.requestId);
 const p=QBO_REVISION_HARDENING_V15638.recoverPreview(x.controlId,x.requestId,'TSD',r.Taxable_Sales_Detail_Snapshot_Run_ID,r.Taxable_Sales_Detail_Workbook_File_ID,r.Taxable_Sales_Detail_Snapshot_Sequence);
 const out={Version:'1.5.638',Read_Only:true,Production_Writes:0,Certification:c,Recovery:p};
 console.log('[REV638 APP50] | TSD RECOVERY PREVIEW | '+JSON.stringify(out));return out;
}
