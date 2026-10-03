/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3807_QBO_FinalHistorical07TrustCertification.js
 * Version     : 1.5.203
 *
 * Final historical logical-07 trust certification.
 *
 * Evidence mutations: NONE.
 * Audit-only mutations:
 *   - dedicated temporary certification spreadsheet containing ObservationIds;
 *   - bounded Script Property checkpoint;
 *   - one-time continuation trigger.
 *
 * Proof chain:
 *   06 + immutable Change Payloads
 *     -> exact source-specific chronology
 *     -> exact payload ObservationId population
 *     -> exact set equality to the already globally-unique v197 physical-07 set
 *     -> v200 historical Webhook chronology
 *     -> v201 historical Native CDC chronology.
 */
const QBO_FINAL_HIST07_V202_=Object.freeze({
  VERSION:'1.5.204',
  STATE_KEY:'QBO_FINAL_HIST07_V202_STATE',
  HANDLER:'qboFinalHistorical07V202Continuation_',
  DELAY_MS:60000,
  RUNTIME_MS:135000,
  MAX_ARTIFACTS:12,
  PREFIXES:'0123456789abcdef'.split(''),
  V197_KEY:'QBO_OBS_INDEX_GLOBAL_ID_V197_STATE',
  V197_RUN:'OBS_INDEX_GLOBAL_ID_V197|431424dd-b788-4b78-b670-c77528552ca5',
  EXPECTED_06_ARTIFACTS:3455,
  EXPECTED_PHYSICAL_OBSERVATIONS:734913,
  EXPECTED_LOGICAL07:734858,
  EXPECTED_EXCLUDED_ARTIFACTS:1,
  EXPECTED_EXCLUDED_OBSERVATIONS:55,
  EXPECTED_FULL_ARTIFACTS:3409,
  EXPECTED_FULL_OBSERVATIONS:734779,
  EXPECTED_CDC_ARTIFACTS:24,
  EXPECTED_CDC_OBSERVATIONS:58,
  EXPECTED_WEBHOOK_ARTIFACTS:21,
  EXPECTED_WEBHOOK_OBSERVATIONS:21
});

function startQboFinalHistorical07TrustCertificationV202(){
  const C=QBO_FINAL_HIST07_V202_;
  const prior=qboFinalHist07V202Load_();
  if(prior&&['COLLECTING','COMPARING','WEBHOOK_GATE','CDC_GATE'].indexOf(String(prior.status))>=0)
    throw new Error('FINAL_HIST07_V202_ALREADY_RUNNING');
  qboFinalHist07V202DeleteTriggers_();
  const v197=qboFinalHist07V202RequireV197_();
  if(typeof auditQboHistoricalWebhookChronologyV200!=='function')
    throw new Error('FINAL_HIST07_V202_V200_REQUIRED');
  if(typeof auditQboHistoricalNativeCdcChronologyV201!=='function')
    throw new Error('FINAL_HIST07_V202_V201_REQUIRED');

  const artifacts=qboPayloadArtifactReadRows_();
  if(artifacts.length!==C.EXPECTED_06_ARTIFACTS)
    throw new Error('FINAL_HIST07_V202_06_ARTIFACT_COUNT '+artifacts.length);

  const folders=qboObsIndexV175ResolveFolders_();
  const ss=SpreadsheetApp.create('QBO Final Historical 07 Trust Certification V202');
  const file=DriveApp.getFileById(ss.getId());
  const pit=folders.manifests.getParents();
  if(pit.hasNext())file.moveTo(pit.next());
  const first=ss.getSheets()[0]; first.setName('P_0'); first.getRange(1,1).setValue('ObservationId');
  for(let i=1;i<C.PREFIXES.length;i++){
    const sh=ss.insertSheet('P_'+C.PREFIXES[i]); sh.getRange(1,1).setValue('ObservationId');
  }

  const s={
    version:C.VERSION,status:'COLLECTING',runId:'FINAL_HIST07_V202|'+Utilities.getUuid(),
    prerequisiteV197RunId:C.V197_RUN,v197WorkbookId:String(v197.workbookId||''),
    auditWorkbookId:ss.getId(),artifactCursor:0,artifactCount:artifacts.length,
    physicalObservationCount:0,logicalObservationCount:0,
    fullExportArtifactCount:0,fullExportObservationCount:0,
    nativeCdcArtifactCount:0,nativeCdcObservationCount:0,
    webhookArtifactCount:0,webhookObservationCount:0,
    excludedArtifactCount:0,excludedObservationCount:0,
    payloadHashFailureCount:0,payloadCountFailureCount:0,
    fullExportChronologyFailureCount:0,fullExportLineageFailureCount:0,
    prefixCounts:qboFinalHist07V202ZeroPrefixes_(),
    comparisonPrefixIndex:0,identityMismatchCount:0,identityMismatchSamples:[],
    webhookGate:null,cdcGate:null,
    startedAt:new Date().toISOString(),lastProgressAt:'',completedAt:'',error:'',continuationTriggerId:''
  };
  qboFinalHist07V202Save_(s);
  console.log('[FINAL HISTORICAL 07 V202] | STARTED | '+JSON.stringify(qboFinalHist07V202Public_(s)));
  qboFinalHistorical07V202Worker_();
}

function qboFinalHistorical07V202Continuation_(){
  qboFinalHist07V202DeleteTriggers_();
  qboFinalHistorical07V202Worker_();
}

function qboFinalHistorical07V202Worker_(){
  const s=qboFinalHist07V202Load_();
  if(!s||['COLLECTING','COMPARING','WEBHOOK_GATE','CDC_GATE'].indexOf(String(s.status))<0)
    throw new Error('FINAL_HIST07_V202_NOT_RUNNING');
  const committed=JSON.parse(JSON.stringify(s));
  try{
    qboFinalHist07V202RequireV197_();
    if(s.status==='COLLECTING')qboFinalHist07V202Collect_(s);
    else if(s.status==='COMPARING')qboFinalHist07V202Compare_(s);
    else if(s.status==='WEBHOOK_GATE')qboFinalHist07V202Webhook_(s);
    else qboFinalHist07V202Cdc_(s);
  }catch(e){
    const msg=String(e&&e.message?e.message:e);
    if(qboFinalHist07V203IsTransientSpreadsheetError_(msg)){
      Object.keys(s).forEach(function(k){delete s[k];});
      Object.keys(committed).forEach(function(k){s[k]=committed[k];});
      s.version=QBO_FINAL_HIST07_V202_.VERSION;s.status='RECOVERY_REQUIRED';s.error=msg;
      s.lastProgressAt=new Date().toISOString();s.continuationTriggerId='';
      qboFinalHist07V202Save_(s);qboFinalHist07V202DeleteTriggers_();
      console.log('[FINAL HISTORICAL 07 V203] | RECOVERY_REQUIRED | '+JSON.stringify(qboFinalHist07V202Public_(s)));
      throw e;
    }
    s.status='FAILED';s.error=msg;s.lastProgressAt=new Date().toISOString();
    qboFinalHist07V202Save_(s);qboFinalHist07V202DeleteTriggers_();
    console.log('[FINAL HISTORICAL 07 V203] | FAILED | '+JSON.stringify(qboFinalHist07V202Public_(s)));
    throw e;
  }
}

function qboFinalHist07V202Collect_(s){
  const C=QBO_FINAL_HIST07_V202_, artifacts=qboPayloadArtifactReadRows_();
  if(artifacts.length!==C.EXPECTED_06_ARTIFACTS)throw new Error('FINAL_HIST07_V202_06_CHANGED');
  const fullMap=qboObservationIndexV172FullExportObservedAtMap_();
  const auditSs=SpreadsheetApp.openById(String(s.auditWorkbookId));
  const batches={};C.PREFIXES.forEach(function(p){batches[p]=[];});
  const started=Date.now();let done=0,obsThis=0;

  while(s.artifactCursor<artifacts.length&&done<C.MAX_ARTIFACTS&&Date.now()-started<C.RUNTIME_MS){
    const cursor=s.artifactCursor,a=artifacts[cursor];
    const sourceType=String(a.SourceType||'').trim().toUpperCase();
    const obs=Number(a.ObservationCount||0), pc=Number(a.PayloadCount||0);
    s.physicalObservationCount+=obs;

    if(qboObservationIndexV182IsGovernedControlledTestOrphan_(a,fullMap)){
      const x=qboObservationIndexV182VerifyControlledTestOrphan_(a,cursor);
      if(Number(x.observationCount)!==obs)throw new Error('FINAL_HIST07_V202_EXCLUSION_COUNT cursor='+cursor);
      s.excludedArtifactCount++;s.excludedObservationCount+=obs;
      s.artifactCursor++;done++;continue;
    }

    const env=qboFinalHist07V202ReadJson_(String(a.PayloadFileId||''));
    if(!env||!env.stableBody)throw new Error('FINAL_HIST07_V202_PAYLOAD_ENVELOPE cursor='+cursor);
    const stableHash=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(env.stableBody));
    if(stableHash!==String(a.PayloadShardHash||'')||String(env.shardHash||'')!==String(a.PayloadShardHash||'')){
      s.payloadHashFailureCount++;throw new Error('FINAL_HIST07_V202_PAYLOAD_HASH cursor='+cursor);
    }
    const payloads=Array.isArray(env.stableBody.payloads)?env.stableBody.payloads:[];
    const ids=Array.isArray(env.stableBody.observationIds)?env.stableBody.observationIds:[];
    if(obs!==pc||payloads.length!==obs||ids.length!==obs||Number(env.stableBody.observationCount||0)!==obs){
      s.payloadCountFailureCount++;throw new Error('FINAL_HIST07_V202_PAYLOAD_COUNT cursor='+cursor);
    }

    if(sourceType.indexOf('FULL_EXPORT')===0){
      s.fullExportArtifactCount++;s.fullExportObservationCount+=obs;
      const sourceId=String(a.IngestionSourceId||''), expected=String(fullMap[sourceId]||'');
      if(!expected){s.fullExportLineageFailureCount++;throw new Error('FINAL_HIST07_V202_FULL_SOURCE_MISSING '+sourceId);}
      payloads.forEach(function(p,i){
        if(String(p&&p.observationId||'')!==String(ids[i]||''))throw new Error('FINAL_HIST07_V202_ID_VECTOR cursor='+cursor+' ordinal='+i);
        if(String(p&&p.sourceId||sourceId)!==sourceId&&String(p&&p.sourceId||''))
          {s.fullExportLineageFailureCount++;throw new Error('FINAL_HIST07_V202_FULL_SOURCE_ID cursor='+cursor+' ordinal='+i);}
        const actual=qboObservationIndexV172Iso_(p&&p.observedAt);
        if(actual!==expected){s.fullExportChronologyFailureCount++;throw new Error('FINAL_HIST07_V202_FULL_CHRONOLOGY cursor='+cursor+' ordinal='+i);}
      });
    }else if(sourceType==='NATIVE_CDC'){
      s.nativeCdcArtifactCount++;s.nativeCdcObservationCount+=obs;
    }else if(sourceType==='WEBHOOK'){
      s.webhookArtifactCount++;s.webhookObservationCount+=obs;
    }else throw new Error('FINAL_HIST07_V202_UNKNOWN_SOURCE_TYPE '+sourceType);

    payloads.forEach(function(p,i){
      const id=String(p&&p.observationId||'');
      if(id!==String(ids[i]||''))throw new Error('FINAL_HIST07_V202_ID_VECTOR cursor='+cursor+' ordinal='+i);
      const m=/^OBS\|([0-9a-f]{64})$/i.exec(id);
      if(!m)throw new Error('FINAL_HIST07_V202_ID_FORMAT '+id);
      const prefix=m[1].charAt(0).toLowerCase();
      batches[prefix].push([id]);s.prefixCounts[prefix]=Number(s.prefixCounts[prefix]||0)+1;
      s.logicalObservationCount++;obsThis++;
    });

    s.artifactCursor++;done++;
  }

  C.PREFIXES.forEach(function(p){
    const rows=batches[p];if(!rows.length)return;
    const sh=auditSs.getSheetByName('P_'+p);sh.getRange(sh.getLastRow()+1,1,rows.length,1).setValues(rows);
  });
  SpreadsheetApp.flush();s.lastProgressAt=new Date().toISOString();

  if(s.artifactCursor===artifacts.length){
    qboFinalHist07V202CollectGate_(s);
    s.status='COMPARING';s.comparisonPrefixIndex=0;
  }
  qboFinalHist07V202Save_(s);qboFinalHist07V202Schedule_(s);
  console.log('[FINAL HISTORICAL 07 V202] | COLLECTION_PROGRESS | '+JSON.stringify(Object.assign(qboFinalHist07V202Public_(s),{invocationArtifacts:done,invocationLogicalObservations:obsThis})));
}

function qboFinalHist07V202CollectGate_(s){
  const C=QBO_FINAL_HIST07_V202_;
  const checks=[
    ['physicalObservationCount',C.EXPECTED_PHYSICAL_OBSERVATIONS],
    ['logicalObservationCount',C.EXPECTED_LOGICAL07],
    ['excludedArtifactCount',C.EXPECTED_EXCLUDED_ARTIFACTS],
    ['excludedObservationCount',C.EXPECTED_EXCLUDED_OBSERVATIONS],
    ['fullExportArtifactCount',C.EXPECTED_FULL_ARTIFACTS],
    ['fullExportObservationCount',C.EXPECTED_FULL_OBSERVATIONS],
    ['nativeCdcArtifactCount',C.EXPECTED_CDC_ARTIFACTS],
    ['nativeCdcObservationCount',C.EXPECTED_CDC_OBSERVATIONS],
    ['webhookArtifactCount',C.EXPECTED_WEBHOOK_ARTIFACTS],
    ['webhookObservationCount',C.EXPECTED_WEBHOOK_OBSERVATIONS]
  ];
  checks.forEach(function(x){if(Number(s[x[0]])!==x[1])throw new Error('FINAL_HIST07_V202_COUNT '+x[0]+'='+s[x[0]]+' expected='+x[1]);});
  if(Number(s.payloadHashFailureCount||0)||Number(s.payloadCountFailureCount||0)||
     Number(s.fullExportChronologyFailureCount||0)||Number(s.fullExportLineageFailureCount||0))
    throw new Error('FINAL_HIST07_V202_COLLECTION_FAILURE_COUNTER');
  const sum=QBO_FINAL_HIST07_V202_.PREFIXES.reduce(function(n,p){return n+Number(s.prefixCounts[p]||0);},0);
  if(sum!==C.EXPECTED_LOGICAL07)throw new Error('FINAL_HIST07_V202_PREFIX_SUM '+sum);
}

function qboFinalHist07V202Compare_(s){
  const C=QBO_FINAL_HIST07_V202_,a=SpreadsheetApp.openById(String(s.auditWorkbookId)),
        b=SpreadsheetApp.openById(String(s.v197WorkbookId));
  const started=Date.now();let n=0;
  while(s.comparisonPrefixIndex<C.PREFIXES.length&&Date.now()-started<C.RUNTIME_MS){
    const p=C.PREFIXES[s.comparisonPrefixIndex],sa=a.getSheetByName('P_'+p),sb=b.getSheetByName('P_'+p);
    if(!sa||!sb)throw new Error('FINAL_HIST07_V202_PREFIX_SHEET '+p);
    const na=Math.max(0,sa.getLastRow()-1),nb=Math.max(0,sb.getLastRow()-1);
    const aa=na?sa.getRange(2,1,na,1).getValues().map(function(r){return String(r[0]||'');}):[];
    const bb=nb?sb.getRange(2,1,nb,1).getValues().map(function(r){return String(r[0]||'');}):[];
    aa.sort();bb.sort();
    if(aa.length!==bb.length){
      s.identityMismatchCount+=Math.abs(aa.length-bb.length);
      if(s.identityMismatchSamples.length<25)s.identityMismatchSamples.push({prefix:p,payloadCount:aa.length,indexCount:bb.length});
    }else{
      for(let i=0;i<aa.length;i++)if(aa[i]!==bb[i]){
        s.identityMismatchCount++;
        if(s.identityMismatchSamples.length<25)s.identityMismatchSamples.push({prefix:p,ordinal:i,payloadId:aa[i],indexId:bb[i]});
      }
    }
    s.comparisonPrefixIndex++;n++;s.lastProgressAt=new Date().toISOString();qboFinalHist07V202Save_(s);
  }
  if(s.comparisonPrefixIndex===C.PREFIXES.length){
    if(Number(s.identityMismatchCount)!==0)throw new Error('FINAL_HIST07_V202_IDENTITY_SET_MISMATCH '+JSON.stringify(s.identityMismatchSamples));
    s.status='WEBHOOK_GATE';qboFinalHist07V202Save_(s);
  }
  qboFinalHist07V202Schedule_(s);
  console.log('[FINAL HISTORICAL 07 V202] | IDENTITY_PROGRESS | '+JSON.stringify(Object.assign(qboFinalHist07V202Public_(s),{invocationPrefixes:n})));
}

function qboFinalHist07V202Webhook_(s){
  const r=auditQboHistoricalWebhookChronologyV200(),x=r&&r.summary?r.summary:{};
  const ok=Number(x.webhook06ArtifactCount)===21&&Number(x.webhookPayloadObservationCount)===21&&
    Number(x.physical07ObservationCount)===21&&Number(x.chronologyMismatchCount)===0&&
    Number(x.receiptValidationFailureCount)===0&&Number(x.eventIdentityFailureCount)===0&&
    x.populationReconciles===true;
  if(!ok)throw new Error('FINAL_HIST07_V202_WEBHOOK_GATE '+JSON.stringify(x));
  s.webhookGate={
    artifactCount:x.webhook06ArtifactCount,observationCount:x.webhookPayloadObservationCount,
    deleteObservationCount:x.deleteObservationCount,nonDeleteObservationCount:x.nonDeleteObservationCount,
    chronologyMismatchCount:x.chronologyMismatchCount,passed:true
  };
  s.status='CDC_GATE';s.lastProgressAt=new Date().toISOString();qboFinalHist07V202Save_(s);
  qboFinalHist07V202Schedule_(s);
  console.log('[FINAL HISTORICAL 07 V202] | WEBHOOK_GATE_PASSED | '+JSON.stringify(s.webhookGate));
}

function qboFinalHist07V202Cdc_(s){
  const C=QBO_FINAL_HIST07_V202_,r=auditQboHistoricalNativeCdcChronologyV201(),x=r&&r.summary?r.summary:{};
  const ok=Number(x.nativeCdc06ArtifactCount)===24&&Number(x.nativeCdcPayloadObservationCount)===58&&
    Number(x.physical07ObservationCount)===58&&Number(x.requestCompletedAtBasisObservationCount)===58&&
    Number(x.runCompletedAtFallbackObservationCount)===0&&Number(x.invalidObservedAtBasisCount)===0&&
    Number(x.source03MissingCount)===0&&Number(x.source03AmbiguousCount)===0&&
    Number(x.indexPayloadObservedAtMismatchCount)===0&&Number(x.chronologyMismatchCount)===0&&
    x.populationReconciles===true;
  if(!ok)throw new Error('FINAL_HIST07_V202_CDC_GATE '+JSON.stringify(x));
  s.cdcGate={
    artifactCount:x.nativeCdc06ArtifactCount,observationCount:x.nativeCdcPayloadObservationCount,
    requestCompletedAtBasisObservationCount:x.requestCompletedAtBasisObservationCount,
    runCompletedAtFallbackObservationCount:x.runCompletedAtFallbackObservationCount,
    chronologyMismatchCount:x.chronologyMismatchCount,passed:true
  };
  qboFinalHist07V202CollectGate_(s);
  if(Number(s.identityMismatchCount)!==0||Number(s.comparisonPrefixIndex)!==16)
    throw new Error('FINAL_HIST07_V202_IDENTITY_NOT_COMPLETE');
  s.status='COMPLETE_HISTORICAL_07_TRUST_CERTIFIED';s.completedAt=new Date().toISOString();
  s.lastProgressAt=s.completedAt;s.continuationTriggerId='';s.error='';
  qboFinalHist07V202Save_(s);qboFinalHist07V202DeleteTriggers_();
  console.log('[FINAL HISTORICAL 07 V202] | CERTIFICATION_COMPLETE | '+JSON.stringify(qboFinalHist07V202Public_(s)));
}

/**
 * Recover the existing v202/v203 certification workbook after a collection-write failure.
 * The workbook is the durable commit record. Replay is read-only and stops at the earliest
 * artifact boundary whose logical ObservationId population exactly equals the workbook.
 */
function recoverQboFinalHistorical07TrustCertificationV203(){
  const C=QBO_FINAL_HIST07_V202_, failed=qboFinalHist07V202Load_();
  if(!failed||['FAILED','RECOVERY_REQUIRED'].indexOf(String(failed.status))<0)
    throw new Error('FINAL_HIST07_V203_RECOVERY_REQUIRES_FAILED_STATE');
  if(!String(failed.auditWorkbookId||''))throw new Error('FINAL_HIST07_V203_RECOVERY_WORKBOOK_MISSING');
  qboFinalHist07V202DeleteTriggers_();qboFinalHist07V202RequireV197_();

  const artifacts=qboPayloadArtifactReadRows_();
  if(artifacts.length!==C.EXPECTED_06_ARTIFACTS)throw new Error('FINAL_HIST07_V203_06_CHANGED');
  const auditSs=SpreadsheetApp.openById(String(failed.auditWorkbookId));
  const durable={},targetCounts={};let targetTotal=0;
  C.PREFIXES.forEach(function(p){
    const sh=auditSs.getSheetByName('P_'+p);if(!sh)throw new Error('FINAL_HIST07_V203_PREFIX_SHEET '+p);
    const n=Math.max(0,sh.getLastRow()-1);
    durable[p]=n?sh.getRange(2,1,n,1).getValues().map(function(r){return String(r[0]||'');}):[];
    targetCounts[p]=n;targetTotal+=n;
  });

  const fullMap=qboObservationIndexV172FullExportObservedAtMap_();
  const r={
    version:C.VERSION,status:'COLLECTING',runId:String(failed.runId||''),
    prerequisiteV197RunId:C.V197_RUN,v197WorkbookId:String(failed.v197WorkbookId||''),
    auditWorkbookId:String(failed.auditWorkbookId),artifactCursor:0,artifactCount:artifacts.length,
    physicalObservationCount:0,logicalObservationCount:0,
    fullExportArtifactCount:0,fullExportObservationCount:0,nativeCdcArtifactCount:0,nativeCdcObservationCount:0,
    webhookArtifactCount:0,webhookObservationCount:0,excludedArtifactCount:0,excludedObservationCount:0,
    payloadHashFailureCount:0,payloadCountFailureCount:0,fullExportChronologyFailureCount:0,fullExportLineageFailureCount:0,
    prefixCounts:qboFinalHist07V202ZeroPrefixes_(),comparisonPrefixIndex:0,identityMismatchCount:0,identityMismatchSamples:[],
    webhookGate:null,cdcGate:null,startedAt:String(failed.startedAt||new Date().toISOString()),lastProgressAt:'',completedAt:'',error:'',continuationTriggerId:''
  };
  const replay={};C.PREFIXES.forEach(function(p){replay[p]=[];});

  while(r.artifactCursor<artifacts.length){
    const before=JSON.parse(JSON.stringify(r)),lens={};C.PREFIXES.forEach(function(p){lens[p]=replay[p].length;});
    qboFinalHist07V203ReplayArtifact_(r,artifacts[r.artifactCursor],r.artifactCursor,fullMap,replay);
    let exceeds=false,mismatch='';
    C.PREFIXES.forEach(function(p){
      if(mismatch||exceeds)return;
      if(replay[p].length>targetCounts[p]){exceeds=true;return;}
      for(let i=lens[p];i<replay[p].length;i++)if(replay[p][i]!==durable[p][i]){mismatch='prefix='+p+' ordinal='+i;break;}
    });
    if(mismatch)throw new Error('FINAL_HIST07_V203_RECOVERY_DURABLE_MISMATCH '+mismatch);
    if(exceeds){
      Object.keys(r).forEach(function(k){delete r[k];});Object.keys(before).forEach(function(k){r[k]=before[k];});
      C.PREFIXES.forEach(function(p){replay[p].length=lens[p];});break;
    }
    r.artifactCursor++;
    if(r.logicalObservationCount===targetTotal)break;
  }

  // Any rows beyond this fully verified artifact boundary came from the failed invocation.
  // Remove only that uncommitted tail so the workbook and checkpoint become aligned again.
  let trimmed=0;
  C.PREFIXES.forEach(function(p){
    const keep=replay[p].length,have=targetCounts[p],sh=auditSs.getSheetByName('P_'+p);
    if(have<keep)throw new Error('FINAL_HIST07_V203_RECOVERY_PREFIX_UNDERFLOW '+p);
    if(have>keep){sh.getRange(keep+2,1,have-keep,1).clearContent();trimmed+=have-keep;}
  });
  SpreadsheetApp.flush();

  r.lastProgressAt=new Date().toISOString();qboFinalHist07V202Save_(r);qboFinalHist07V202Schedule_(r);
  console.log('[FINAL HISTORICAL 07 V203] | RECOVERED | '+JSON.stringify(Object.assign(qboFinalHist07V202Public_(r),{durableLogicalObservationCount:targetTotal,recoveredLogicalObservationCount:r.logicalObservationCount,trimmedUncommittedRows:trimmed})));
  return qboFinalHist07V202Public_(r);
}

function qboFinalHist07V203ReplayArtifact_(s,a,cursor,fullMap,replay){
  const sourceType=String(a.SourceType||'').trim().toUpperCase(),obs=Number(a.ObservationCount||0),pc=Number(a.PayloadCount||0);
  s.physicalObservationCount+=obs;
  if(qboObservationIndexV182IsGovernedControlledTestOrphan_(a,fullMap)){
    const x=qboObservationIndexV182VerifyControlledTestOrphan_(a,cursor);
    if(Number(x.observationCount)!==obs)throw new Error('FINAL_HIST07_V203_EXCLUSION_COUNT cursor='+cursor);
    s.excludedArtifactCount++;s.excludedObservationCount+=obs;return;
  }
  const env=qboFinalHist07V202ReadJson_(String(a.PayloadFileId||''));
  if(!env||!env.stableBody)throw new Error('FINAL_HIST07_V203_PAYLOAD_ENVELOPE cursor='+cursor);
  const stableHash=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(env.stableBody));
  if(stableHash!==String(a.PayloadShardHash||'')||String(env.shardHash||'')!==String(a.PayloadShardHash||''))
    throw new Error('FINAL_HIST07_V203_PAYLOAD_HASH cursor='+cursor);
  const payloads=Array.isArray(env.stableBody.payloads)?env.stableBody.payloads:[],ids=Array.isArray(env.stableBody.observationIds)?env.stableBody.observationIds:[];
  if(obs!==pc||payloads.length!==obs||ids.length!==obs||Number(env.stableBody.observationCount||0)!==obs)
    throw new Error('FINAL_HIST07_V203_PAYLOAD_COUNT cursor='+cursor);
  if(sourceType.indexOf('FULL_EXPORT')===0){
    s.fullExportArtifactCount++;s.fullExportObservationCount+=obs;
    const sourceId=String(a.IngestionSourceId||''),expected=String(fullMap[sourceId]||'');
    if(!expected)throw new Error('FINAL_HIST07_V203_FULL_SOURCE_MISSING '+sourceId);
    payloads.forEach(function(p,i){
      if(String(p&&p.observationId||'')!==String(ids[i]||''))throw new Error('FINAL_HIST07_V203_ID_VECTOR cursor='+cursor+' ordinal='+i);
      if(String(p&&p.sourceId||sourceId)!==sourceId&&String(p&&p.sourceId||''))throw new Error('FINAL_HIST07_V203_FULL_SOURCE_ID cursor='+cursor+' ordinal='+i);
      if(qboObservationIndexV172Iso_(p&&p.observedAt)!==expected)throw new Error('FINAL_HIST07_V203_FULL_CHRONOLOGY cursor='+cursor+' ordinal='+i);
    });
  }else if(sourceType==='NATIVE_CDC'){s.nativeCdcArtifactCount++;s.nativeCdcObservationCount+=obs;}
  else if(sourceType==='WEBHOOK'){s.webhookArtifactCount++;s.webhookObservationCount+=obs;}
  else throw new Error('FINAL_HIST07_V203_UNKNOWN_SOURCE_TYPE '+sourceType);
  payloads.forEach(function(p,i){
    const id=String(p&&p.observationId||'');if(id!==String(ids[i]||''))throw new Error('FINAL_HIST07_V203_ID_VECTOR cursor='+cursor+' ordinal='+i);
    const m=/^OBS\|([0-9a-f]{64})$/i.exec(id);if(!m)throw new Error('FINAL_HIST07_V203_ID_FORMAT '+id);
    const prefix=m[1].charAt(0).toLowerCase();replay[prefix].push(id);s.prefixCounts[prefix]++;s.logicalObservationCount++;
  });
}

function qboFinalHist07V203IsTransientSpreadsheetError_(msg){
  msg=String(msg||'');
  return /Service Spreadsheets failed|Service invoked too many times|Internal error|Backend Error|Timed out/i.test(msg);
}

function statusQboFinalHistorical07TrustCertificationV202(){
  const s=qboFinalHist07V202Load_(),o=s?qboFinalHist07V202Public_(s):{version:'1.5.203',status:'NOT_STARTED'};
  console.log('[FINAL HISTORICAL 07 V202] | STATUS | '+JSON.stringify(o));return o;
}
/**
 * v1.5.204 recovery for a committed certification checkpoint stranded only
 * because Apps Script failed while creating the next continuation trigger.
 * This path deliberately does NOT reconstruct/trim workbook rows (v203 owns
 * torn-write recovery).  It requires the durable prefix-sheet row counts to
 * equal the saved committed prefixCounts exactly before resuming.
 */
function resumeQboFinalHistorical07AfterSchedulingFailureV204(){
  const s=qboFinalHist07V202Load_();
  if(!s)throw new Error('FINAL_HIST07_V204_STATE_MISSING');
  if(String(s.runId||'')!=='FINAL_HIST07_V202|2a2db396-f66b-4d89-a902-22f4c9149d36')
    throw new Error('FINAL_HIST07_V204_RUN_MISMATCH '+String(s.runId||''));
  if(String(s.status||'')!=='FAILED'&&String(s.status||'')!=='CONTINUATION_REQUIRED')
    throw new Error('FINAL_HIST07_V204_NOT_SCHEDULING_STRANDED status='+String(s.status||''));
  const msg=String(s.error||'');
  if(String(s.status||'')==='FAILED'&&!qboFinalHist07V204IsSchedulingError_(msg))
    throw new Error('FINAL_HIST07_V204_NOT_SCHEDULING_FAILURE '+msg);
  qboFinalHist07V202RequireV197_();
  qboFinalHist07V204VerifyCommittedPrefixCounts_(s);
  qboFinalHist07V202DeleteTriggers_();
  s.version=QBO_FINAL_HIST07_V202_.VERSION;
  s.status=qboFinalHist07V204ResumeStatus_(s);
  s.error='';s.continuationTriggerId='';s.lastProgressAt=new Date().toISOString();
  qboFinalHist07V202Save_(s);
  qboFinalHist07V202Schedule_(s);
  console.log('[FINAL HISTORICAL 07 V204] | SCHEDULING_RECOVERED | '+JSON.stringify(qboFinalHist07V202Public_(s)));
}
function qboFinalHist07V204ResumeStatus_(s){
  if(Number(s.artifactCursor||0)<Number(s.artifactCount||0))return 'COLLECTING';
  if(Number(s.comparisonPrefixIndex||0)<QBO_FINAL_HIST07_V202_.PREFIXES.length)return 'COMPARING';
  if(!s.webhookGate)return 'WEBHOOK_GATE';
  if(!s.cdcGate)return 'CDC_GATE';
  throw new Error('FINAL_HIST07_V204_NO_RESUMABLE_PHASE');
}
function qboFinalHist07V204VerifyCommittedPrefixCounts_(s){
  const ss=SpreadsheetApp.openById(String(s.auditWorkbookId||''));
  let durable=0,expected=0;
  QBO_FINAL_HIST07_V202_.PREFIXES.forEach(function(p){
    const sh=ss.getSheetByName('P_'+p);
    if(!sh)throw new Error('FINAL_HIST07_V204_PREFIX_SHEET_MISSING '+p);
    const actual=Math.max(0,sh.getLastRow()-1),want=Number(s.prefixCounts&&s.prefixCounts[p]||0);
    durable+=actual;expected+=want;
    if(actual!==want)throw new Error('FINAL_HIST07_V204_PREFIX_COUNT_MISMATCH prefix='+p+' durable='+actual+' checkpoint='+want);
  });
  if(durable!==Number(s.logicalObservationCount||0)||expected!==Number(s.logicalObservationCount||0))
    throw new Error('FINAL_HIST07_V204_LOGICAL_COUNT_MISMATCH durable='+durable+' checkpointPrefixes='+expected+' logical='+Number(s.logicalObservationCount||0));
}
function qboFinalHist07V204IsSchedulingError_(msg){
  msg=String(msg||'');
  return /server error occurred|ScriptApp|trigger/i.test(msg);
}
function qboFinalHist07V202RequireV197_(){
  const C=QBO_FINAL_HIST07_V202_,raw=PropertiesService.getScriptProperties().getProperty(C.V197_KEY);
  if(!raw)throw new Error('FINAL_HIST07_V202_V197_MISSING');
  const s=JSON.parse(raw);
  if(String(s.runId||'')!==C.V197_RUN||String(s.status||'')!=='COMPLETE_PENDING_DEEP_LINEAGE_CHRONOLOGY_RECONCILIATION'||
     Number(s.scannedObservationCount)!==C.EXPECTED_LOGICAL07||Number(s.distinctObservationCount)!==C.EXPECTED_LOGICAL07||
     Number(s.duplicateObservationIdCount||0)!==0||Number(s.evaluationPrefixIndex)!==16||!String(s.workbookId||''))
    throw new Error('FINAL_HIST07_V202_V197_GATE');
  return s;
}
function qboFinalHist07V202ReadJson_(id){
  const t=DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8');
  try{return JSON.parse(t);}catch(e){throw new Error('FINAL_HIST07_V202_JSON fileId='+id);}
}
function qboFinalHist07V202ZeroPrefixes_(){const o={};QBO_FINAL_HIST07_V202_.PREFIXES.forEach(function(p){o[p]=0;});return o;}
function qboFinalHist07V202Load_(){const v=PropertiesService.getScriptProperties().getProperty(QBO_FINAL_HIST07_V202_.STATE_KEY);return v?JSON.parse(v):null;}
function qboFinalHist07V202Save_(s){PropertiesService.getScriptProperties().setProperty(QBO_FINAL_HIST07_V202_.STATE_KEY,JSON.stringify(s));}
function qboFinalHist07V202Schedule_(s){
  qboFinalHist07V202DeleteTriggers_();
  let last=null;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const t=ScriptApp.newTrigger(QBO_FINAL_HIST07_V202_.HANDLER).timeBased().after(QBO_FINAL_HIST07_V202_.DELAY_MS).create();
      s.continuationTriggerId=String(t.getUniqueId()||'');s.error='';qboFinalHist07V202Save_(s);return;
    }catch(e){
      last=e;
      console.warn('[FINAL HISTORICAL 07 V204] | TRIGGER_CREATE_RETRY | attempt='+attempt+' | '+String(e&&e.message?e.message:e));
      if(attempt<3)Utilities.sleep(2000*attempt);
    }
  }
  s.status='CONTINUATION_REQUIRED';s.continuationTriggerId='';
  s.error='CONTINUATION_SCHEDULE_FAILED: '+String(last&&last.message?last.message:last);
  s.lastProgressAt=new Date().toISOString();qboFinalHist07V202Save_(s);
  console.log('[FINAL HISTORICAL 07 V204] | CONTINUATION_REQUIRED | '+JSON.stringify(qboFinalHist07V202Public_(s)));
}
function qboFinalHist07V202DeleteTriggers_(){
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction()===QBO_FINAL_HIST07_V202_.HANDLER){
      try{ScriptApp.deleteTrigger(t);}catch(e){console.warn('[FINAL HISTORICAL 07 V202] | TRIGGER_DELETE_WARNING | '+String(e&&e.message?e.message:e));}
    }
  });
}
function qboFinalHist07V202Public_(s){
  return {
    version:s.version,status:s.status,runId:s.runId,prerequisiteV197RunId:s.prerequisiteV197RunId,
    artifactCursor:s.artifactCursor,artifactCount:s.artifactCount,
    physicalObservationCount:s.physicalObservationCount,logicalObservationCount:s.logicalObservationCount,
    fullExportArtifactCount:s.fullExportArtifactCount,fullExportObservationCount:s.fullExportObservationCount,
    nativeCdcArtifactCount:s.nativeCdcArtifactCount,nativeCdcObservationCount:s.nativeCdcObservationCount,
    webhookArtifactCount:s.webhookArtifactCount,webhookObservationCount:s.webhookObservationCount,
    excludedArtifactCount:s.excludedArtifactCount,excludedObservationCount:s.excludedObservationCount,
    payloadHashFailureCount:s.payloadHashFailureCount,payloadCountFailureCount:s.payloadCountFailureCount,
    fullExportChronologyFailureCount:s.fullExportChronologyFailureCount,fullExportLineageFailureCount:s.fullExportLineageFailureCount,
    comparisonPrefixIndex:s.comparisonPrefixIndex,identityMismatchCount:s.identityMismatchCount,
    identityMismatchSamples:s.identityMismatchSamples,webhookGate:s.webhookGate,cdcGate:s.cdcGate,
    auditWorkbookId:s.auditWorkbookId,v197WorkbookId:s.v197WorkbookId,
    startedAt:s.startedAt,lastProgressAt:s.lastProgressAt,completedAt:s.completedAt,error:s.error,
    continuationTriggerId:s.continuationTriggerId
  };
}
