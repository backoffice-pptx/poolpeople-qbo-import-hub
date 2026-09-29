/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 140_QBO_WebhookSourceLedgerV2Preview.js
 * Version     : 1.5.119
 * READ ONLY: reconstruct/verify candidate 04_Webhook_Events_V2 from immutable
 * webhook receipt evidence. No workbook, Drive, properties, triggers or payload writes.
 */
const QBO_WEBHOOK_04_PREVIEW_1_5_119=Object.freeze({
 VERSION:'QBO_WEBHOOK_SOURCE_LEDGER_V2_PREVIEW_1_5_119',
 EVIDENCE_FOLDER_ASSET_KEY:'QBO_WEBHOOK_EVIDENCE_FOLDER',
 EVIDENCE_FOLDER_EXPECTED_TYPE:'Folder', ENVIRONMENT:'PROD'
});
const QBO_WEBHOOK_04_HEADERS_1_5_119=[
'WebhookEventId','WebhookReceiptId','EventIndex','ReceivedAt','RealmId','EntityType',
'EntityId','EventOperation','QboLastUpdatedTime','SourceChangeTime','SignatureVerified',
'ReceiptEventCount','ReceiptFileId','ReceiptFileName','RawPayloadHash','RawPayloadHashType',
'ReceiptEvidenceStatus','DuplicateEvent','EligibilityStatus','EligibilityReason',
'TargetedCaptureRequired','TargetedCaptureFileId','TargetedCaptureFileName','TargetedCaptureAt',
'TargetedCaptureRawEntityHash','TargetedCaptureStatus','EvidenceCreatedAt','RegistrationMode','RegisteredAt'
];
function previewQboWebhookSourceLedgerV2(){
 const C=QBO_WEBHOOK_04_PREVIEW_1_5_119;
 const folder=qboResolveGovernedFolderAsset_(C.EVIDENCE_FOLDER_ASSET_KEY,C.EVIDENCE_FOLDER_EXPECTED_TYPE,C.ENVIRONMENT);
 const it=folder.getFiles(), rows=[], receipts=[], findings=[], eventIds=Object.create(null), receiptIds=Object.create(null);
 let files=0,valid=0,invalid=0,declared=0,duplicates=0;
 while(it.hasNext()){
  const f=it.next();files++;
  let receipt;
  try{receipt=JSON.parse(f.getBlob().getDataAsString('UTF-8'));}
  catch(e){invalid++;findings.push({code:'INVALID_JSON',fileId:f.getId(),fileName:f.getName()});continue;}
  const v=qboWebhookForwardValidateReceipt_(receipt);
  if(!v.valid){invalid++;findings.push({code:'INVALID_RECEIPT',fileId:f.getId(),fileName:f.getName(),reason:v.reason});continue;}
  valid++; declared+=v.events.length;
  if(receiptIds[v.receiptId])findings.push({code:'DUPLICATE_RECEIPT_ID',receiptId:v.receiptId,fileId:f.getId()});
  receiptIds[v.receiptId]=true;
  receipts.push({receiptId:v.receiptId,fileId:f.getId(),fileName:f.getName(),receivedAt:v.receivedAt,
    receiptEventCount:v.events.length,rawPayloadHash:v.rawPayloadSha256});
  v.events.forEach(function(e,i){
    const op=String(e.operation||'').trim().toUpperCase();
    const id='WEBHOOK|'+v.receiptId+'|EVENT|'+i;
    const dup=!!eventIds[id]; if(dup)duplicates++; eventIds[id]=true;
    const deleteOp=op==='DELETE';
    rows.push({
      WebhookEventId:id,WebhookReceiptId:v.receiptId,EventIndex:i,ReceivedAt:v.receivedAt,
      RealmId:String(e.realmId||''),EntityType:String(e.entityType||''),EntityId:String(e.entityId||''),
      EventOperation:op,QboLastUpdatedTime:String(e.sourceChangeTime||''),SourceChangeTime:String(e.sourceChangeTime||''),
      SignatureVerified:true,ReceiptEventCount:v.events.length,ReceiptFileId:f.getId(),ReceiptFileName:f.getName(),
      RawPayloadHash:v.rawPayloadSha256,RawPayloadHashType:'SHA-256',ReceiptEvidenceStatus:'VALID',
      DuplicateEvent:dup,EligibilityStatus:dup?'INELIGIBLE':'ELIGIBLE',
      EligibilityReason:dup?'DUPLICATE_EVENT':'SOURCE_EVENT_VALID',
      TargetedCaptureRequired:!deleteOp,TargetedCaptureFileId:'',TargetedCaptureFileName:'',
      TargetedCaptureAt:'',TargetedCaptureRawEntityHash:'',TargetedCaptureStatus:deleteOp?'NOT_REQUIRED':'REQUIRED_UNRESOLVED',
      EvidenceCreatedAt:v.receivedAt,RegistrationMode:'HISTORICAL_BACKFILL',RegisteredAt:''
    });
  });
 }
 rows.sort((a,b)=>String(a.ReceivedAt).localeCompare(String(b.ReceivedAt))||
   String(a.WebhookReceiptId).localeCompare(String(b.WebhookReceiptId))||Number(a.EventIndex)-Number(b.EventIndex));
 // receipt-level invariant: repeated ReceiptEventCount must equal rows reconstructed for receipt.
 const by={};rows.forEach(r=>(by[r.WebhookReceiptId]||(by[r.WebhookReceiptId]=[])).push(r));
 Object.keys(by).forEach(rid=>{const a=by[rid],n=a.length;
   a.forEach(r=>{if(Number(r.ReceiptEventCount)!==n)findings.push({code:'RECEIPT_EVENT_COUNT_MISMATCH',receiptId:rid,declared:r.ReceiptEventCount,actual:n});});
 });
 const summary={version:C.VERSION,mode:'PREVIEW_ONLY',status:findings.length?'ACTION_REQUIRED':'READY_FOR_CONTROLLED_WRITE',
   evidenceFileCount:files,validReceiptCount:valid,invalidReceiptCount:invalid,
   candidate04EventCount:rows.length,declaredReceiptEventTotal:declared,
   eligibleEventCount:rows.filter(r=>r.EligibilityStatus==='ELIGIBLE').length,
   ineligibleEventCount:rows.filter(r=>r.EligibilityStatus!=='ELIGIBLE').length,
   duplicateEventCount:duplicates,uniqueReceiptCount:Object.keys(receiptIds).length,
   uniqueEventIdCount:Object.keys(eventIds).length,
   targetedCaptureRequiredCount:rows.filter(r=>r.TargetedCaptureRequired===true).length,
   deleteEventCount:rows.filter(r=>r.EventOperation==='DELETE').length,
   eventEntityCounts:qboWebhook119Count_(rows,'EntityType'),eventOperationCounts:qboWebhook119Count_(rows,'EventOperation'),
   findingCount:findings.length,controls:{writes04:false,writes05:false,writes06:false,writesPayloads:false,
    writesProperties:false,writesTriggers:false,writesStateApplication:false}};
 console.log('[WEBHOOK 04 PREVIEW 1.5.119] | SUMMARY | '+JSON.stringify(summary));
 console.log('[WEBHOOK 04 PREVIEW 1.5.119] | FINDINGS | '+JSON.stringify(findings));
 return {summary:summary,receipts:receipts,events:rows,findings:findings};
}
function qboWebhook119Count_(rows,key){const o={};rows.forEach(r=>{const k=String(r[key]||'(blank)');o[k]=(o[k]||0)+1});return o;}
