/** App 50 V1258 — read-only checkpoint authority and pending handoff reconciliation.
 * Uses existing state-capture spreadsheet; does NOT provision sheets, register work,
 * read/change payloads, modify Script Properties, schedule triggers or advance watermarks.
 */
function inspectQboNativeCdcCheckpointAuthorityV1258() {
  var p=PropertiesService.getScriptProperties(), cfg=QBO_NATIVE_CDC_PRODUCTION;
  var queue=qboNativeCdcReadIngestionHandoffQueue_();
  var state=qboNativeCdcReadState_();
  var rawMode=p.getProperty('QBO_NATIVE_CDC_CAPTURE_ONLY_V1233');
  var mode=null;
  try {mode=rawMode?JSON.parse(rawMode):null;} catch(e){mode={parseError:String(e)};}
  var out={version:'1.5.258',mode:'READ_ONLY',verdict:'REVIEW_REQUIRED',
    authority:{productionWatermarkPropertyKey:cfg.WATERMARK_PROPERTY_KEY,
      productionWatermark:p.getProperty(cfg.WATERMARK_PROPERTY_KEY)||'',
      handoffQueuePropertyKey:cfg.INGESTION_HANDOFF_PROPERTY_KEY,
      pendingCount:queue.length,
      captureOnlyEnabled:!!(mode&&mode.enabled===true),
      captureOnlyInitialWatermark:mode&&mode.initialWatermark||'',
      cycleStatePropertyKey:cfg.STATE_PROPERTY_KEY,
      cycleState:state?{cycleId:state.cycleId,status:state.status,windowStart:state.windowStart,
        windowEnd:state.windowEnd,watermarkCommitted:state.watermarkCommitted,
        committedWatermark:state.committedWatermark,manifestFileId:state.manifestFileId}:null},
    forwardControl:{sheetName:'05_Forward_Ingestion_Control',exists:false,headerValid:false,
      matchedPendingSourceRows:0},handoffs:[],
    findings:[],controls:{writes:false,ingestionAuthorized:false,watermarkAdvanced:false,phaseGUntouched:true}};
  // The getter only opens the existing configured spreadsheet; do NOT use EnsureSheet.
  var book=getQboStateCaptureSpreadsheet_();
  var sheet=book.getSheetByName('05_Forward_Ingestion_Control');
  var idx={};
  if(sheet){
    out.forwardControl.exists=true;
    var width=sheet.getLastColumn();
    var headers=width?sheet.getRange(1,1,1,width).getDisplayValues()[0]:[];
    headers.forEach(function(h,i){idx[String(h)]=i;});
    var needed=['IngestionSourceId','SourceType','SourceRunId','EntityType','ProcessingStatus'];
    out.forwardControl.headerValid=needed.every(function(h){return Object.prototype.hasOwnProperty.call(idx,h);});
    out.forwardControl.rowCount=Math.max(0,sheet.getLastRow()-1);
    if(!out.forwardControl.headerValid)out.findings.push('FORWARD_CONTROL_HEADERS_MISSING');
  } else out.findings.push('FORWARD_CONTROL_SHEET_NOT_FOUND');
  // Only inspect the exact queued cycles; bounded row scan and compact aggregates.
  var matches={};queue.forEach(function(q){matches[String(q.cycleId)]=[];});
  if(sheet&&out.forwardControl.headerValid){
    var n=Math.max(0,sheet.getLastRow()-1),step=300;
    for(var offset=0;offset<n;offset+=step){
      var values=sheet.getRange(offset+2,1,Math.min(step,n-offset),sheet.getLastColumn()).getDisplayValues();
      values.forEach(function(v){
        if(v[idx.SourceType]!=='NATIVE_CDC')return;
        var cycle=String(v[idx.SourceRunId]||'');
        if(!Object.prototype.hasOwnProperty.call(matches,cycle))return;
        matches[cycle].push({entity:String(v[idx.EntityType]||''),status:String(v[idx.ProcessingStatus]||''),sourceId:String(v[idx.IngestionSourceId]||'')});
      });
    }
  }
  queue.forEach(function(q){
    var id=String(q.cycleId),item={cycleId:id,manifestFileId:String(q.manifestFileId),
      registrationRows:(matches[id]||[]).length,registrationStatuses:{},registeredEntities:[],
      manifest:{},findings:[]};
    (matches[id]||[]).forEach(function(r){item.registrationStatuses[r.status]=(item.registrationStatuses[r.status]||0)+1;item.registeredEntities.push(r.entity);});
    try{
      var file=DriveApp.getFileById(String(q.manifestFileId));
      var m=JSON.parse(file.getBlob().getDataAsString('UTF-8'));
      var evidence=Array.isArray(m.entityEvidence)?m.entityEvidence:[];
      item.manifest={cycleId:String(m.cycleId||''),status:String(m.status||''),
        watermarkCommitted:m.watermarkCommitted===true,committedWatermark:String(m.committedWatermark||''),
        windowStart:String(m.windowStart||''),windowEnd:String(m.windowEnd||''),
        entityEvidenceCount:evidence.length,successfulEvidenceCount:evidence.filter(function(e){return e&&e.status==='SUCCESS'&&e.evidenceFileId;}).length};
      if(item.manifest.cycleId!==id)item.findings.push('MANIFEST_CYCLE_ID_MISMATCH');
      if(item.manifest.status!=='SUCCESS'||!item.manifest.watermarkCommitted)item.findings.push('HANDOFF_MANIFEST_NOT_COMMITTED');
    }catch(e){item.findings.push('MANIFEST_READ_ERROR:'+String(e&&e.message||e).slice(0,180));}
    if(item.registrationRows===0)item.findings.push('NO_MATCHING_FORWARD_CONTROL_ROWS');
    out.forwardControl.matchedPendingSourceRows+=item.registrationRows;
    out.handoffs.push(item);
  });
  if(out.authority.productionWatermark!==out.authority.captureOnlyInitialWatermark&&out.authority.captureOnlyEnabled)
    out.findings.push('PRODUCTION_WATERMARK_DIFFERS_FROM_CAPTURE_ONLY_ACTIVATION');
  if(out.handoffs.some(function(h){return h.findings.length;}))out.findings.push('PENDING_HANDOFFS_REQUIRE_DISPOSITION');
  out.verdict=out.findings.length?'REVIEW_REQUIRED':'AUTHORITIES_IDENTIFIED_PENDING_POLICY_REVIEW';
  console.log('[NATIVE CDC CHECKPOINT AUTHORITY V1258] | READ_ONLY | '+JSON.stringify(out));
  return out;
}
