/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3806_QBO_NativeCdcHistoricalChronologyDiagnostic.js
 * Version     : 1.5.201
 *
 * READ ONLY.
 *
 * Reconciles the exact historical Native CDC population already persisted in
 * 06 / Change Payload / logical 07 against governed 03_Native_CDC_Events_V2.
 *
 * Primary question:
 *   For each of the 58 historical Native CDC observations, does 07 ObservedAt
 *   equal the exact governed 03 ObservedAt, and is that 03 ObservedAt based on
 *   entity requestCompletedAt or the governed committed-run runCompletedAt
 *   fallback?
 */
const QBO_NCDC_CHRONOLOGY_V201_=Object.freeze({
  VERSION:'1.5.201',
  SHEET03:'03_Native_CDC_Events_V2',
  EXPECTED_06_ARTIFACTS:24,
  EXPECTED_OBSERVATIONS:58,
  EXPECTED_V197_RUN_ID:'OBS_INDEX_GLOBAL_ID_V197|431424dd-b788-4b78-b670-c77528552ca5',
  V197_STATE_KEY:'QBO_OBS_INDEX_GLOBAL_ID_V197_STATE'
});

function auditQboHistoricalNativeCdcChronologyV201(){
  const C=QBO_NCDC_CHRONOLOGY_V201_;
  qboNcdcChronologyV201RequireV197_();

  const ss=getQboStateCaptureSpreadsheet_();
  const sheet=ss.getSheetByName(C.SHEET03);
  if(!sheet) throw new Error('NCDC_CHRONOLOGY_V201_03_MISSING');
  const rows03=qboNcdcChronologyV201ReadSheet_(sheet);
  const byEvent=Object.create(null), bySourceEntity=Object.create(null);
  rows03.forEach(function(r){
    const eid=String(r.NativeCdcEventId||'');
    if(eid){
      if(byEvent[eid]) throw new Error('NCDC_CHRONOLOGY_V201_DUPLICATE_03_EVENT '+eid);
      byEvent[eid]=r;
    }
    const k=String(r.SourceId||'')+'|'+String(r.EntityId||'');
    if(!bySourceEntity[k]) bySourceEntity[k]=[];
    bySourceEntity[k].push(r);
  });

  const all=qboPayloadArtifactReadRows_(), targets=[];
  all.forEach(function(a,cursor){
    if(String(a.SourceType||'').trim().toUpperCase()==='NATIVE_CDC') targets.push({artifact:a,artifactCursor:cursor});
  });
  const declared=targets.reduce(function(n,x){return n+Number(x.artifact.ObservationCount||0);},0);
  if(targets.length!==C.EXPECTED_06_ARTIFACTS||declared!==C.EXPECTED_OBSERVATIONS)
    throw new Error('NCDC_CHRONOLOGY_V201_POPULATION_GATE_FAILED artifacts='+targets.length+' observations='+declared);

  const payloads=[];
  targets.forEach(function(x){
    const a=x.artifact, env=qboNcdcChronologyV201ReadJson_(String(a.PayloadFileId||''));
    if(!env||!env.stableBody) throw new Error('NCDC_CHRONOLOGY_V201_PAYLOAD_ENVELOPE_INVALID '+a.PayloadFileId);
    const actual=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(env.stableBody));
    if(actual!==String(a.PayloadShardHash||'')||String(env.shardHash||'')!==String(a.PayloadShardHash||''))
      throw new Error('NCDC_CHRONOLOGY_V201_PAYLOAD_HASH_MISMATCH '+a.PayloadFileId);
    const ps=Array.isArray(env.stableBody.payloads)?env.stableBody.payloads:[];
    if(ps.length!==Number(a.ObservationCount||0)||ps.length!==Number(a.PayloadCount||0))
      throw new Error('NCDC_CHRONOLOGY_V201_PAYLOAD_COUNT_MISMATCH '+a.PayloadFileId);
    ps.forEach(function(p,ordinal){payloads.push({artifact:a,artifactCursor:x.artifactCursor,payload:p,payloadOrdinal:ordinal});});
  });
  if(payloads.length!==C.EXPECTED_OBSERVATIONS) throw new Error('NCDC_CHRONOLOGY_V201_PAYLOAD_POPULATION_MISMATCH '+payloads.length);

  // v200's locator is generic: exact ObservationId search across all legacy
  // shards plus exact post-conversion artifact candidates. Reuse only that
  // validated read-only locator; no webhook semantics are involved.
  if(typeof qboWebhookChronologyV200ReadPhysical07_!=='function')
    throw new Error('NCDC_CHRONOLOGY_V201_VALIDATED_07_LOCATOR_MISSING');
  const index=qboWebhookChronologyV200ReadPhysical07_(payloads);

  const details=[], classes=Object.create(null);
  let source03Missing=0, source03Ambiguous=0, lineageMismatch=0, indexPayloadMismatch=0;
  let requestCompletedBasis=0, runCompletedFallbackBasis=0, invalidBasis=0;

  payloads.forEach(function(x){
    const p=x.payload||{}, se=p.sourceEvidence||{};
    const oid=String(p.observationId||''), rec=index[oid]||null;
    const sourceId=String(x.artifact.IngestionSourceId||'');
    const entityId=String(p.entityId||'');
    const sourceObservationId=String(p.sourceObservationId||'');
    let r03=byEvent[sourceObservationId]||null;

    if(!r03){
      const c=bySourceEntity[sourceId+'|'+entityId]||[];
      if(c.length===1) r03=c[0];
      else if(c.length===0) source03Missing++;
      else source03Ambiguous++;
    }

    const observed07=rec?String(rec.ObservedAt||''):'';
    const payloadObserved=String(p.observedAt||'');
    const observed03=r03?String(r03.ObservedAt||''):'';
    const requestCompleted=r03?String(r03.RequestCompletedAt||''):'';
    const sourceChangeTime=r03?String(r03.SourceChangeTime||''):'';
    const qboResponseTime=r03?String(r03.QboResponseTime||''):'';
    const evidenceFileId=r03?String(r03.EvidenceFileId||''):'';
    const artifactEvidence=String(x.artifact.EvidenceFileId||'');

    if(rec&&observed07!==payloadObserved) indexPayloadMismatch++;
    if(r03&&artifactEvidence&&evidenceFileId&&artifactEvidence!==evidenceFileId) lineageMismatch++;

    let basis='INVALID';
    if(r03&&requestCompleted&&observed03===requestCompleted){basis='REQUEST_COMPLETED_AT';requestCompletedBasis++;}
    else if(r03&&!requestCompleted&&observed03){basis='RUN_COMPLETED_AT_FALLBACK';runCompletedFallbackBasis++;}
    else invalidBasis++;

    let cls='';
    if(!rec) cls='INDEX_RECORD_MISSING';
    else if(observed07!==payloadObserved) cls='INDEX_PAYLOAD_OBSERVED_AT_MISMATCH';
    else if(!r03) cls='SOURCE_03_EVENT_NOT_FOUND_OR_AMBIGUOUS';
    else if(observed07!==observed03) cls='INDEX_OBSERVED_AT_MISMATCH_03';
    else if(basis==='REQUEST_COMPLETED_AT') cls='MATCHES_03_REQUEST_COMPLETED_AT';
    else if(basis==='RUN_COMPLETED_AT_FALLBACK') cls='MATCHES_03_RUN_COMPLETED_AT_FALLBACK';
    else cls='03_OBSERVED_AT_BASIS_INVALID';
    classes[cls]=(classes[cls]||0)+1;

    details.push({
      observationId:oid, sourceObservationId:sourceObservationId, ingestionSourceId:sourceId,
      entityType:String(p.entityType||''), entityId:entityId, operation:String(p.operation||''),
      current07ObservedAt:observed07, payloadObservedAt:payloadObserved, source03ObservedAt:observed03,
      requestCompletedAt:requestCompleted, observedAtBasis:basis, sourceChangeTime:sourceChangeTime,
      qboResponseTime:qboResponseTime, admissionStatus:rec?String(rec.AdmissionStatus||''):'',
      artifactEvidenceFileId:artifactEvidence, source03EvidenceFileId:evidenceFileId,
      artifactCursor:x.artifactCursor, payloadOrdinal:x.payloadOrdinal, classification:cls
    });
  });

  const chronologyMismatchCount=details.filter(function(d){
    return d.classification!=='MATCHES_03_REQUEST_COMPLETED_AT' &&
           d.classification!=='MATCHES_03_RUN_COMPLETED_AT_FALLBACK';
  }).length;

  const summary={
    version:C.VERSION, operation:'HISTORICAL_NATIVE_CDC_CHRONOLOGY_DIAGNOSTIC', readOnly:true,
    sourceAuthority:'03_NATIVE_CDC_EVENTS_V2_BACKED_BY_IMMUTABLE_COMMITTED_NATIVE_CDC_EVIDENCE',
    prerequisiteV197RunId:C.EXPECTED_V197_RUN_ID,
    nativeCdc06ArtifactCount:targets.length, nativeCdcPayloadObservationCount:payloads.length,
    physical07ObservationCount:Object.keys(index).length,
    source03TotalRowCount:rows03.length,
    requestCompletedAtBasisObservationCount:requestCompletedBasis,
    runCompletedAtFallbackObservationCount:runCompletedFallbackBasis,
    invalidObservedAtBasisCount:invalidBasis,
    source03MissingCount:source03Missing, source03AmbiguousCount:source03Ambiguous,
    evidenceFileLineageMismatchCount:lineageMismatch,
    indexPayloadObservedAtMismatchCount:indexPayloadMismatch,
    chronologyMismatchCount:chronologyMismatchCount,
    classifications:classes,
    populationReconciles:targets.length===24&&payloads.length===58&&Object.keys(index).length===58,
    controls:{workbookWrites:false,driveWrites:false,scriptPropertiesWrites:false,triggerMutations:false,stateApplicationWrites:false}
  };
  console.log('[NATIVE CDC CHRONOLOGY V201] | SUMMARY | '+JSON.stringify(summary));
  console.log('[NATIVE CDC CHRONOLOGY V201] | DETAILS | '+JSON.stringify(details));
  return {summary:summary,details:details};
}

function qboNcdcChronologyV201RequireV197_(){
  const C=QBO_NCDC_CHRONOLOGY_V201_;
  const raw=PropertiesService.getScriptProperties().getProperty(C.V197_STATE_KEY);
  if(!raw) throw new Error('NCDC_CHRONOLOGY_V201_V197_STATE_MISSING');
  let s;try{s=JSON.parse(raw);}catch(e){throw new Error('NCDC_CHRONOLOGY_V201_V197_STATE_INVALID_JSON');}
  if(String(s.runId||'')!==C.EXPECTED_V197_RUN_ID||
     String(s.status||'')!=='COMPLETE_PENDING_DEEP_LINEAGE_CHRONOLOGY_RECONCILIATION'||
     Number(s.scannedObservationCount||0)!==734858||
     Number(s.distinctObservationCount||0)!==734858||
     Number(s.duplicateObservationIdCount||0)!==0)
    throw new Error('NCDC_CHRONOLOGY_V201_V197_GATE_FAILED '+JSON.stringify(s));
}

function qboNcdcChronologyV201ReadSheet_(sheet){
  const v=sheet.getDataRange().getValues();
  if(!v.length)return[];
  const h=v[0].map(String), out=[];
  for(let i=1;i<v.length;i++){
    if(v[i].every(function(x){return x===''||x===null;}))continue;
    const o={};h.forEach(function(k,j){o[k]=v[i][j];});out.push(o);
  }
  return out;
}

function qboNcdcChronologyV201ReadJson_(fileId){
  if(!fileId)throw new Error('NCDC_CHRONOLOGY_V201_FILE_ID_MISSING');
  const t=DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8');
  try{return JSON.parse(t);}catch(e){throw new Error('NCDC_CHRONOLOGY_V201_INVALID_JSON fileId='+fileId);}
}
