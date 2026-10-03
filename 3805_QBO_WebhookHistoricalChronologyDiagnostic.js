/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3805_QBO_WebhookHistoricalChronologyDiagnostic.js
 * Version     : 1.5.200
 *
 * READ ONLY.
 *
 * Repair of v1.5.198:
 *   Do not assume 04_Webhook_Events_V2 is physically present. Historical
 *   webhook payloads predate completion of that ledger. The immutable webhook
 *   receipt referenced by each payload/06 lineage is the source evidence
 *   authority for ReceivedAt and event identity.
 */
const QBO_WEBHOOK_CHRONOLOGY_DIAGNOSTIC_V200_ = Object.freeze({
  VERSION:'1.5.200',
  EXPECTED_WEBHOOK_06_ARTIFACTS:21,
  EXPECTED_WEBHOOK_OBSERVATIONS:21,
  EXPECTED_V197_RUN_ID:'OBS_INDEX_GLOBAL_ID_V197|431424dd-b788-4b78-b670-c77528552ca5',
  V197_STATE_KEY:'QBO_OBS_INDEX_GLOBAL_ID_V197_STATE',
  HISTORICAL_SHARD_START_CURSOR:1137
});

function auditQboHistoricalWebhookChronologyV200() {
  const C=QBO_WEBHOOK_CHRONOLOGY_DIAGNOSTIC_V200_;
  qboWebhookChronologyV200RequireV197_();

  const artifacts=qboPayloadArtifactReadRows_();
  const targets=[];
  artifacts.forEach(function(row,cursor){
    if(String(row.SourceType||'').trim().toUpperCase()==='WEBHOOK') {
      targets.push({artifact:row,artifactCursor:cursor});
    }
  });
  const declaredObs=targets.reduce(function(n,x){return n+Number(x.artifact.ObservationCount||0);},0);
  if(targets.length!==C.EXPECTED_WEBHOOK_06_ARTIFACTS ||
     declaredObs!==C.EXPECTED_WEBHOOK_OBSERVATIONS) {
    throw new Error('WEBHOOK_CHRONOLOGY_V200_POPULATION_GATE_FAILED artifacts='+targets.length+
      ' observations='+declaredObs);
  }

  const payloads=[];
  targets.forEach(function(x){
    const a=x.artifact, fileId=String(a.PayloadFileId||''), hash=String(a.PayloadShardHash||'');
    if(!fileId||!hash) throw new Error('WEBHOOK_CHRONOLOGY_V200_06_LINEAGE_INCOMPLETE cursor='+x.artifactCursor);
    const env=qboWebhookChronologyV200ReadJson_(fileId);
    if(!env||!env.stableBody) throw new Error('WEBHOOK_CHRONOLOGY_V200_PAYLOAD_ENVELOPE_INVALID fileId='+fileId);
    const actual=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(env.stableBody));
    if(actual!==hash||String(env.shardHash||'')!==hash) {
      throw new Error('WEBHOOK_CHRONOLOGY_V200_PAYLOAD_HASH_MISMATCH fileId='+fileId);
    }
    const rows=Array.isArray(env.stableBody.payloads)?env.stableBody.payloads:[];
    if(rows.length!==Number(a.ObservationCount||0)||rows.length!==Number(a.PayloadCount||0)) {
      throw new Error('WEBHOOK_CHRONOLOGY_V200_PAYLOAD_COUNT_MISMATCH fileId='+fileId);
    }
    rows.forEach(function(p,ordinal){
      payloads.push({artifact:a,artifactCursor:x.artifactCursor,payload:p,payloadOrdinal:ordinal});
    });
  });
  if(payloads.length!==C.EXPECTED_WEBHOOK_OBSERVATIONS) {
    throw new Error('WEBHOOK_CHRONOLOGY_V200_PAYLOAD_POPULATION_MISMATCH actual='+payloads.length);
  }

  const index=qboWebhookChronologyV200ReadPhysical07_(payloads);
  const receiptCache=Object.create(null);
  const details=[];
  const classes=Object.create(null);
  let evidenceFileMismatchCount=0, receiptValidationFailureCount=0, eventIdentityFailureCount=0;

  payloads.forEach(function(x){
    const p=x.payload||{}, se=p.sourceEvidence||{};
    const oid=String(p.observationId||''), rec=index[oid];
    const evidenceFileId=String(se.evidenceFileId||se.evidenceReference||'');
    const artifactEvidenceFileId=String(x.artifact.EvidenceFileId||'');
    if(artifactEvidenceFileId && evidenceFileId && artifactEvidenceFileId!==evidenceFileId) evidenceFileMismatchCount++;

    let cached=receiptCache[evidenceFileId];
    if(!cached) {
      const receipt=qboWebhookChronologyV200ReadJson_(evidenceFileId);
      const validation=qboWebhookForwardValidateReceipt_(receipt);
      cached=receiptCache[evidenceFileId]={receipt:receipt,validation:validation};
    }
    const v=cached.validation;
    if(!v||!v.valid) receiptValidationFailureCount++;

    const eventIndex=qboWebhookChronologyV200EventIndex_(p,x.artifact);
    const event=(v&&v.valid&&eventIndex>=0&&eventIndex<v.events.length)?v.events[eventIndex]:null;
    if(!event) eventIdentityFailureCount++;

    const operation=String((se.sourceOperation)||p.operation||'').toUpperCase();
    const observedAt=String(rec.ObservedAt||'');
    const payloadObservedAt=String(p.observedAt||'');
    const receivedAt=v&&v.valid?String(v.receivedAt||''):String(se.sourceReceivedAt||'');
    const capturedAt=String(p.rawEntityEvidence&&p.rawEntityEvidence.acquiredAt||'');
    const sourceChangeTime=String(p.sourceChangeTime||se.sourceChangeTime||'');
    const eventOperation=event?String(event.operation||'').toUpperCase():'';
    const eventEntityType=event?String(event.entityType||''):'';
    const eventEntityId=event?String(event.entityId||''):'';

    let cls='';
    if(!rec) cls='INDEX_RECORD_MISSING';
    else if(observedAt!==payloadObservedAt) cls='INDEX_PAYLOAD_OBSERVED_AT_MISMATCH';
    else if(!v||!v.valid) cls='RECEIPT_EVIDENCE_INVALID';
    else if(!event) cls='RECEIPT_EVENT_NOT_FOUND';
    else if(eventEntityType!==String(p.entityType||'')||eventEntityId!==String(p.entityId||'')) cls='RECEIPT_EVENT_ENTITY_MISMATCH';
    else if(operation==='DELETE' && eventOperation!=='DELETE') cls='RECEIPT_EVENT_OPERATION_MISMATCH';
    else if(operation==='DELETE') cls=observedAt===receivedAt?
      'DELETE_MATCHES_RECEIPT_RECEIVED_AT':'DELETE_OBSERVED_AT_MISMATCH_RECEIPT';
    else if(!capturedAt) cls='NON_DELETE_CAPTURED_AT_MISSING';
    else cls=observedAt===capturedAt?
      'NON_DELETE_MATCHES_TARGETED_CAPTURE_AT':'NON_DELETE_OBSERVED_AT_MISMATCH_CAPTURE';

    classes[cls]=(classes[cls]||0)+1;
    details.push({
      observationId:oid,
      ingestionSourceId:String(x.artifact.IngestionSourceId||''),
      sourceObservationId:String(p.sourceObservationId||''),
      receiptId:v&&v.valid?String(v.receiptId||''):String(se.receiptId||''),
      eventIndex:eventIndex,
      entityType:String(p.entityType||''),
      entityId:String(p.entityId||''),
      payloadOperation:String(p.operation||''),
      sourceOperation:operation,
      receiptEventOperation:eventOperation,
      current07ObservedAt:observedAt,
      payloadObservedAt:payloadObservedAt,
      receiptReceivedAt:receivedAt,
      targetedCaptureAt:capturedAt,
      sourceChangeTime:sourceChangeTime,
      receiptEventSourceChangeTime:event?String(event.sourceChangeTime||''):'',
      admissionStatus:String(rec.AdmissionStatus||''),
      receiptEvidenceFileId:evidenceFileId,
      payloadFileId:String(x.artifact.PayloadFileId||''),
      payloadOrdinal:x.payloadOrdinal,
      artifactCursor:x.artifactCursor,
      classification:cls
    });
  });

  details.sort(function(a,b){
    return String(a.receiptReceivedAt).localeCompare(String(b.receiptReceivedAt))||
      String(a.receiptId).localeCompare(String(b.receiptId))||
      Number(a.eventIndex)-Number(b.eventIndex);
  });

  const deleteCount=details.filter(function(d){return d.sourceOperation==='DELETE';}).length;
  const nonDeleteCount=details.length-deleteCount;
  const mismatchCount=details.filter(function(d){
    return /MISMATCH|MISSING|INVALID|NOT_FOUND/.test(String(d.classification||''));
  }).length;

  const summary={
    version:C.VERSION,
    operation:'HISTORICAL_WEBHOOK_CHRONOLOGY_DIAGNOSTIC',
    readOnly:true,
    sourceAuthority:'IMMUTABLE_WEBHOOK_RECEIPT_REFERENCED_BY_PAYLOAD_LINEAGE',
    prerequisiteV197RunId:C.EXPECTED_V197_RUN_ID,
    webhook06ArtifactCount:targets.length,
    webhookPayloadObservationCount:payloads.length,
    physical07ObservationCount:Object.keys(index).length,
    uniqueReceiptEvidenceFileCount:Object.keys(receiptCache).length,
    deleteObservationCount:deleteCount,
    nonDeleteObservationCount:nonDeleteCount,
    evidenceFileMismatchCount:evidenceFileMismatchCount,
    receiptValidationFailureCount:receiptValidationFailureCount,
    eventIdentityFailureCount:eventIdentityFailureCount,
    chronologyMismatchCount:mismatchCount,
    classifications:classes,
    populationReconciles:targets.length===21&&payloads.length===21&&Object.keys(index).length===21,
    controls:{workbookWrites:false,driveWrites:false,scriptPropertiesWrites:false,triggerMutations:false,stateApplicationWrites:false}
  };
  console.log('[WEBHOOK CHRONOLOGY V200] | SUMMARY | '+JSON.stringify(summary));
  console.log('[WEBHOOK CHRONOLOGY V200] | DETAILS | '+JSON.stringify(details));
  return {summary:summary,details:details};
}

function qboWebhookChronologyV200RequireV197_(){
  const C=QBO_WEBHOOK_CHRONOLOGY_DIAGNOSTIC_V200_;
  const raw=PropertiesService.getScriptProperties().getProperty(C.V197_STATE_KEY);
  if(!raw) throw new Error('WEBHOOK_CHRONOLOGY_V200_V197_STATE_MISSING');
  let s; try{s=JSON.parse(raw);}catch(e){throw new Error('WEBHOOK_CHRONOLOGY_V200_V197_STATE_INVALID_JSON');}
  if(String(s.runId||'')!==C.EXPECTED_V197_RUN_ID||
     String(s.status||'')!=='COMPLETE_PENDING_DEEP_LINEAGE_CHRONOLOGY_RECONCILIATION'||
     Number(s.scannedObservationCount||0)!==734858||
     Number(s.distinctObservationCount||0)!==734858||
     Number(s.duplicateObservationIdCount||0)!==0||
     Number(s.evaluationPrefixIndex||0)!==16) {
    throw new Error('WEBHOOK_CHRONOLOGY_V200_V197_GATE_FAILED state='+JSON.stringify(s));
  }
}

function qboWebhookChronologyV200EventIndex_(p,artifact){
  const sid=String(artifact.IngestionSourceId||'');
  let m=/\|EVENT\|(\d+)$/.exec(sid);
  if(m) return Number(m[1]);
  const so=String(p.sourceObservationId||'');
  m=/\|OBS\|(\d+)\|/.exec(so);
  if(m) return Number(m[1]);
  return -1;
}

function qboWebhookChronologyV200ReadPhysical07_(payloads){
  const wanted=Object.create(null);
  const historicalCursorNames=Object.create(null);
  payloads.forEach(function(x){
    wanted[String(x.payload.observationId||'')]=true;
    historicalCursorNames[String(Number(x.artifactCursor)).padStart(9,'0')]=true;
  });

  const folders=qboObsIndexV175ResolveFolders_();
  const it=folders.shards.getFiles();
  const out=Object.create(null);
  let legacyShardFilesRead=0, historicalCandidateShardFilesRead=0, otherShardFilesSkipped=0;

  while(it.hasNext()){
    const f=it.next(), name=String(f.getName()||'');
    const legacy=/^qbo_observation_index_shard_\d{9}_\d{9}\.json$/.test(name);
    const historical=/^qbo_observation_index_artifact_(\d{9})_[0-9a-f]{16}\.json$/.exec(name);

    let read=false;
    if(legacy){
      read=true;
      legacyShardFilesRead++;
    } else if(historical && historicalCursorNames[historical[1]]){
      read=true;
      historicalCandidateShardFilesRead++;
    } else {
      otherShardFilesSkipped++;
    }
    if(!read) continue;

    const env=qboWebhookChronologyV200ReadJson_(f.getId());
    const records=env&&env.stableBody&&Array.isArray(env.stableBody.records)?env.stableBody.records:[];
    records.forEach(function(r){
      const id=String(r&&r.ObservationId||'');
      if(!wanted[id]) return;
      if(out[id]) throw new Error('WEBHOOK_CHRONOLOGY_V200_DUPLICATE_07_ID '+id);
      out[id]=r;
    });
    if(Object.keys(out).length===Object.keys(wanted).length) break;
  }

  const missing=Object.keys(wanted).filter(function(id){return !out[id];});
  console.log('[WEBHOOK CHRONOLOGY V200] | 07 LOCATOR | '+JSON.stringify({
    wantedObservationCount:Object.keys(wanted).length,
    foundObservationCount:Object.keys(out).length,
    legacyShardFilesRead:legacyShardFilesRead,
    historicalCandidateShardFilesRead:historicalCandidateShardFilesRead,
    otherShardFilesSkipped:otherShardFilesSkipped,
    locatorRule:'ALL_LEGACY_SHARDS_PLUS_EXACT_POST_CONVERSION_ARTIFACT_CANDIDATES'
  }));
  if(missing.length) throw new Error(
    'WEBHOOK_CHRONOLOGY_V200_07_MISSING count='+missing.length+
    ' sample='+JSON.stringify(missing.slice(0,10))
  );
  return out;
}

function qboWebhookChronologyV200ReadJson_(fileId){
  if(!String(fileId||'')) throw new Error('WEBHOOK_CHRONOLOGY_V200_EVIDENCE_FILE_ID_MISSING');
  const text=DriveApp.getFileById(String(fileId)).getBlob().getDataAsString('UTF-8');
  try{return JSON.parse(text);}catch(e){
    throw new Error('WEBHOOK_CHRONOLOGY_V200_INVALID_JSON fileId='+fileId+' error='+(e&&e.message?e.message:e));
  }
}
