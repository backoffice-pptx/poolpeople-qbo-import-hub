/** v1.5.234. Read-only saved Purchase response diagnostic. No QBO calls or writes. */
function inspectQboNativeCdcPurchaseResponseV1234() {
  const expectedCycle='20261009T1630Z|71b42ef0-3f3e-4648-a540-918a0c2d4668', expectedManifest='1aHjFuyh2cxNDpgJgyjHK3YMoAv7e1U_A';
  const state=qboNativeCdcReadState_();
  if(!qboNativeCdcIsPaused_())throw new Error('V1234_REQUIRES_ACQUISITION_PAUSED');
  if(!state||state.cycleId!==expectedCycle||state.manifestFileId!==expectedManifest||state.status!=='FAILED'||state.watermarkCommitted)throw new Error('V1234_FAILED_BOUNDARY_CHANGED');
  const manifestText=DriveApp.getFileById(expectedManifest).getBlob().getDataAsString('UTF-8'),manifest=JSON.parse(manifestText);
  if(manifest.cycleId!==expectedCycle||manifest.status!=='FAILED'||manifest.watermarkCommitted)throw new Error('V1234_MANIFEST_BOUNDARY_CHANGED');
  const files=DriveApp.getFolderById(state.runFolderId).getFilesByName(QBO_NATIVE_CDC_PRODUCTION.ENTITY_FILE_PREFIX+'Purchase.json');
  if(!files.hasNext())throw new Error('V1234_PURCHASE_EVIDENCE_MISSING');
  const file=files.next();if(files.hasNext())throw new Error('V1234_PURCHASE_EVIDENCE_DUPLICATED');
  const raw=file.getBlob().getDataAsString('UTF-8'),response=JSON.parse(raw),out=qboNativeCdcPurchaseResponseSummaryV1234_(response);
  out.version='1.5.234';out.mode='READ_ONLY';out.cycleId=expectedCycle;out.windowStart=state.windowStart;out.windowEnd=state.windowEnd;
  out.durableWatermark=PropertiesService.getScriptProperties().getProperty(QBO_NATIVE_CDC_PRODUCTION.WATERMARK_PROPERTY_KEY);
  out.manifestFileId=expectedManifest;out.manifestSha256=qboNativeCdcSha256_(manifestText);out.evidenceFileId=file.getId();out.payloadSha256=qboNativeCdcSha256_(raw);
  out.productionPaused=true;out.recoveryAuthorized=false;out.completenessCertified=false;
  console.log('[NATIVE CDC PURCHASE V1234] | READ_ONLY | '+JSON.stringify(out));return out;
}
function qboNativeCdcPurchaseResponseSummaryV1234_(response) {
  const array=x=>x==null?[]:(Array.isArray(x)?x:[x]),groups=[],seen=Object.create(null);let total=0,live=0,deleted=0,missingId=0,duplicateOccurrences=0,minTime='',maxTime='';
  array(response&&response.CDCResponse).forEach(function(cdc,ci){array(cdc&&cdc.QueryResponse).forEach(function(q,qi){
    const rows=array(q&&q.Purchase),group={cdcIndex:ci,queryIndex:qi,keys:Object.keys(q||{}),startPosition:q&&q.startPosition,maxResults:q&&q.maxResults,totalCount:q&&q.totalCount,returned:rows.length,live:0,deleted:0,nonObjectRows:0,hasFault:!!(q&&(q.Fault||q.Error))};
    rows.forEach(function(row){total++;if(!row||typeof row!=='object'){group.nonObjectRows++;return;}const isDeleted=String(row.status||'').toLowerCase()==='deleted';if(isDeleted){deleted++;group.deleted++;}else{live++;group.live++;}
      const id=String(row.Id==null?'':row.Id);if(!id)missingId++;else{if(seen[id])duplicateOccurrences++;seen[id]=(seen[id]||0)+1;}
      const stamp=row.MetaData&&row.MetaData.LastUpdatedTime;if(stamp&&!isNaN(Date.parse(stamp))){const iso=new Date(stamp).toISOString();if(!minTime||iso<minTime)minTime=iso;if(!maxTime||iso>maxTime)maxTime=iso;}
    });groups.push(group);
  });});
  return {rootKeys:Object.keys(response||{}),responseTime:response&&response.time,rootFault:!!(response&&(response.Fault||response.Error)),cdcGroupCount:array(response&&response.CDCResponse).length,groups:groups,totalPurchaseRows:total,livePurchaseRows:live,deletedPurchaseRows:deleted,uniquePurchaseIds:Object.keys(seen).length,duplicateIdOccurrences:duplicateOccurrences,missingIdRows:missingId,minLastUpdatedTime:minTime,maxLastUpdatedTime:maxTime};
}
