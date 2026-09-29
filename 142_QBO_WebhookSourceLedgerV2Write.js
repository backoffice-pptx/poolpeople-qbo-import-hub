/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 142_QBO_WebhookSourceLedgerV2Write.js
 * Version     : 1.5.122
 * Purpose     : Controlled exact rebuild of 04_Webhook_Events_V2 from the
 *               v1.5.119 source preview plus v1.5.120 capture reconciliation.
 *
 * WRITE SCOPE: 04_Webhook_Events_V2 only.
 */
const QBO_WEBHOOK_04_WRITE_1_5_121 = Object.freeze({
  VERSION:'QBO_WEBHOOK_SOURCE_LEDGER_V2_WRITE_1_5_122',
  SHEET_NAME:'04_Webhook_Events_V2',
  EXPECTED_EVENTS:91,
  EXPECTED_RECEIPTS:88,
  EXPECTED_CAPTURE_REQUIRED:89,
  EXPECTED_CAPTURE_PRESENT:1,
  EXPECTED_CAPTURE_MISSING:88,
  EXPECTED_DELETE:2,
  EXPECTED_EMAILED:15
});

function writeQboWebhookSourceLedgerV2() {
  const C=QBO_WEBHOOK_04_WRITE_1_5_121;
  const preview=previewQboWebhookSourceLedgerV2();
  if (!preview || !preview.summary ||
      preview.summary.status!=='READY_FOR_CONTROLLED_WRITE' ||
      Number(preview.summary.candidate04EventCount)!==C.EXPECTED_EVENTS ||
      Number(preview.summary.uniqueReceiptCount)!==C.EXPECTED_RECEIPTS ||
      Number(preview.summary.targetedCaptureRequiredCount)!==C.EXPECTED_CAPTURE_REQUIRED ||
      Number(preview.summary.deleteEventCount)!==C.EXPECTED_DELETE ||
      Number((preview.summary.eventOperationCounts||{}).EMAILED||0)!==C.EXPECTED_EMAILED ||
      Number(preview.summary.findingCount||0)!==0) {
    throw new Error('WEBHOOK_04_WRITE_PREVIEW_GATE_FAILED '+JSON.stringify(preview.summary||{}));
  }

  const recon=auditQboWebhookTargetedCaptureReconciliationV2();
  if (!recon || !recon.summary ||
      recon.summary.status!=='RECONCILIATION_COMPLETE' ||
      Number(recon.summary.capturePresentValidCount)!==C.EXPECTED_CAPTURE_PRESENT ||
      Number(recon.summary.captureMissingCount)!==C.EXPECTED_CAPTURE_MISSING ||
      Number(recon.summary.captureInvalidCount)!==0 ||
      Number(recon.summary.findingCount||0)!==0) {
    throw new Error('WEBHOOK_04_WRITE_CAPTURE_GATE_FAILED '+JSON.stringify(recon.summary||{}));
  }

  const detailByEvent=Object.create(null);
  (recon.details||[]).forEach(function(d){ detailByEvent[String(d.WebhookEventId||'')]=d; });

  const rows=preview.events.map(function(src){
    const r=Object.assign({},src);
    const d=detailByEvent[String(r.WebhookEventId||'')] || {};
    const op=String(r.EventOperation||'').toUpperCase();

    if (op==='DELETE') {
      r.TargetedCaptureRequired=false;
      r.TargetedCaptureFileId='';
      r.TargetedCaptureFileName='';
      r.TargetedCaptureAt='';
      r.TargetedCaptureRawEntityHash='';
      r.TargetedCaptureStatus='NOT_REQUIRED';
    } else if (String(d.status||'')==='PRESENT_VALID') {
      r.TargetedCaptureRequired=true;
      r.TargetedCaptureFileId=String(d.captureFileId||'');
      r.TargetedCaptureFileName=String(d.captureFileName||'');
      r.TargetedCaptureAt=String(d.capturedAt||'');
      r.TargetedCaptureRawEntityHash=String(d.rawEntityHash||'');
      r.TargetedCaptureStatus='PRESENT_VALID';
    } else {
      r.TargetedCaptureRequired=true;
      r.TargetedCaptureFileId='';
      r.TargetedCaptureFileName='';
      r.TargetedCaptureAt='';
      r.TargetedCaptureRawEntityHash='';
      r.TargetedCaptureStatus='MISSING_HISTORICAL_CAPTURE';
    }
    r.RegistrationMode='HISTORICAL_BACKFILL';
    r.RegisteredAt=new Date().toISOString();
    return r;
  });

  qboWebhook121ValidateRows_(rows);

  const ss=getQboStateCaptureSpreadsheet_();
  let sheet=ss.getSheetByName(C.SHEET_NAME);
  if (!sheet) sheet=ss.insertSheet(C.SHEET_NAME);

  // Controlled exact rebuild. Refuse an unknown/non-V2 schema rather than
  // silently overwriting it.
  const lastCol=sheet.getLastColumn();
  const lastRow=sheet.getLastRow();
  if (lastRow>0 && lastCol>0) {
    const existingHeaders=sheet.getRange(1,1,1,lastCol).getValues()[0].map(String);
    const expected=QBO_WEBHOOK_04_HEADERS_1_5_119;
    const exact=existingHeaders.length===expected.length &&
      expected.every(function(h,i){return existingHeaders[i]===h;});
    const blank=existingHeaders.every(function(h){return !String(h||'').trim();});
    if (!exact && !blank) {
      throw new Error('WEBHOOK_04_EXISTING_SCHEMA_NOT_V2 existing='+JSON.stringify(existingHeaders));
    }
  }

  sheet.clearContents();
  sheet.getRange(1,1,1,QBO_WEBHOOK_04_HEADERS_1_5_119.length)
    .setValues([QBO_WEBHOOK_04_HEADERS_1_5_119]);

  const values=rows.map(function(r){
    return QBO_WEBHOOK_04_HEADERS_1_5_119.map(function(h){
      const v=r[h];
      return v===undefined || v===null ? '' : v;
    });
  });
  if (values.length) sheet.getRange(2,1,values.length,QBO_WEBHOOK_04_HEADERS_1_5_119.length).setValues(values);
  SpreadsheetApp.flush();

  const gate=qboWebhook121PostWriteGate_(sheet,rows);
  if (!gate.valid) throw new Error('WEBHOOK_04_POST_WRITE_GATE_FAILED '+JSON.stringify(gate));

  const summary={
    version:C.VERSION,status:'SUCCESS',writeScope:'04_ONLY',
    after04Count:gate.rowCount,postWriteGateA:gate,
    controls:{writes05:false,writes06:false,writesPayloads:false,writesDrive:false,
      writesProperties:false,writesTriggers:false,writesStateApplication:false}
  };
  console.log('[WEBHOOK 04 WRITE 1.5.121] | SUMMARY | '+JSON.stringify(summary));
  return summary;
}

function qboWebhook121ValidateRows_(rows){
  const C=QBO_WEBHOOK_04_WRITE_1_5_121, ids=Object.create(null), receiptCounts=Object.create(null), findings=[];
  rows.forEach(function(r){
    const id=String(r.WebhookEventId||'');
    if (!id) findings.push({code:'MISSING_EVENT_ID'});
    if (ids[id]) findings.push({code:'DUPLICATE_EVENT_ID',id:id});
    ids[id]=true;
    const rid=String(r.WebhookReceiptId||'');
    receiptCounts[rid]=(receiptCounts[rid]||0)+1;
  });
  rows.forEach(function(r){
    const actual=receiptCounts[String(r.WebhookReceiptId||'')]||0;
    if (Number(r.ReceiptEventCount)!==actual)
      findings.push({code:'RECEIPT_COUNT_MISMATCH',receiptId:r.WebhookReceiptId,declared:r.ReceiptEventCount,actual:actual});
  });
  const present=rows.filter(r=>r.TargetedCaptureStatus==='PRESENT_VALID').length;
  const missing=rows.filter(r=>r.TargetedCaptureStatus==='MISSING_HISTORICAL_CAPTURE').length;
  const nr=rows.filter(r=>r.TargetedCaptureStatus==='NOT_REQUIRED').length;
  const emailed=rows.filter(r=>r.EventOperation==='EMAILED').length;
  if(rows.length!==C.EXPECTED_EVENTS) findings.push({code:'EVENT_COUNT',actual:rows.length});
  if(Object.keys(receiptCounts).length!==C.EXPECTED_RECEIPTS) findings.push({code:'RECEIPT_COUNT',actual:Object.keys(receiptCounts).length});
  if(present!==C.EXPECTED_CAPTURE_PRESENT) findings.push({code:'CAPTURE_PRESENT',actual:present});
  if(missing!==C.EXPECTED_CAPTURE_MISSING) findings.push({code:'CAPTURE_MISSING',actual:missing});
  if(nr!==C.EXPECTED_DELETE) findings.push({code:'CAPTURE_NOT_REQUIRED',actual:nr});
  if(emailed!==C.EXPECTED_EMAILED) findings.push({code:'EMAILED_COUNT',actual:emailed});
  if(findings.length) throw new Error('WEBHOOK_04_ROW_GATE_FAILED '+JSON.stringify(findings));
}

function qboWebhook121PostWriteGate_(sheet,candidates){
  const headers=sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(String);
  const values=sheet.getLastRow()>1 ? sheet.getRange(2,1,sheet.getLastRow()-1,headers.length).getValues() : [];
  const idx={};headers.forEach((h,i)=>idx[h]=i);
  const ids=Object.create(null), receipts=Object.create(null), findings=[];
  let eligible=0,emailed=0,deletes=0,present=0,missing=0,notRequired=0;
  values.forEach(function(v){
    const id=String(v[idx.WebhookEventId]||'');
    if(ids[id]) findings.push({code:'DUPLICATE_EVENT_ID',id:id});
    ids[id]=true;
    const rid=String(v[idx.WebhookReceiptId]||'');
    receipts[rid]=(receipts[rid]||0)+1;
    if(String(v[idx.EligibilityStatus])==='ELIGIBLE') eligible++;
    if(String(v[idx.EventOperation])==='EMAILED') emailed++;
    if(String(v[idx.EventOperation])==='DELETE') deletes++;
    const cs=String(v[idx.TargetedCaptureStatus]||'');
    if(cs==='PRESENT_VALID') present++;
    else if(cs==='MISSING_HISTORICAL_CAPTURE') missing++;
    else if(cs==='NOT_REQUIRED') notRequired++;
  });
  values.forEach(function(v){
    const rid=String(v[idx.WebhookReceiptId]||'');
    if(Number(v[idx.ReceiptEventCount])!==Number(receipts[rid]||0))
      findings.push({code:'RECEIPT_EVENT_COUNT_MISMATCH',receiptId:rid});
  });
  const candidateIds=Object.create(null);candidates.forEach(r=>candidateIds[String(r.WebhookEventId)]=true);
  const exact=Object.keys(candidateIds).filter(id=>ids[id]).length;
  const C=QBO_WEBHOOK_04_WRITE_1_5_121;
  if(values.length!==C.EXPECTED_EVENTS) findings.push({code:'ROW_COUNT',actual:values.length});
  if(Object.keys(receipts).length!==C.EXPECTED_RECEIPTS) findings.push({code:'UNIQUE_RECEIPTS',actual:Object.keys(receipts).length});
  if(Object.keys(ids).length!==C.EXPECTED_EVENTS) findings.push({code:'UNIQUE_EVENTS',actual:Object.keys(ids).length});
  if(exact!==C.EXPECTED_EVENTS) findings.push({code:'EXACT_CANDIDATE_IDENTITY',actual:exact});
  if(eligible!==C.EXPECTED_EVENTS) findings.push({code:'ELIGIBLE_COUNT',actual:eligible});
  if(emailed!==C.EXPECTED_EMAILED) findings.push({code:'EMAILED_COUNT',actual:emailed});
  if(deletes!==C.EXPECTED_DELETE) findings.push({code:'DELETE_COUNT',actual:deletes});
  if(present!==C.EXPECTED_CAPTURE_PRESENT) findings.push({code:'CAPTURE_PRESENT',actual:present});
  if(missing!==C.EXPECTED_CAPTURE_MISSING) findings.push({code:'CAPTURE_MISSING',actual:missing});
  if(notRequired!==C.EXPECTED_DELETE) findings.push({code:'CAPTURE_NOT_REQUIRED',actual:notRequired});
  return {valid:findings.length===0,rowCount:values.length,uniqueReceiptCount:Object.keys(receipts).length,
    uniqueEventCount:Object.keys(ids).length,eligibleCount:eligible,emailedCount:emailed,deleteCount:deletes,
    capturePresentValidCount:present,captureMissingHistoricalCount:missing,captureNotRequiredCount:notRequired,
    exactCandidateIdentityCount:exact,findings:findings};
}
