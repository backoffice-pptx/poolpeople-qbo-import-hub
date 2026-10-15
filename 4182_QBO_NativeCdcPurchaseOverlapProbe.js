/** v1.5.235. One controlled Purchase CDC GET, saved as separate Drive evidence.
 * Does not certify coverage, change cycle state/watermark, or enable workers. */
function probeQboNativeCdcPurchaseOverlapV1235() {
 const cycle='20261009T1630Z|71b42ef0-3f3e-4648-a540-918a0c2d4668',sourceId='15RkTgxtT1xbN9gk_nIlkKTtkYG-tW0Mf',sourceHash='a371c3232b7812afd07d72d052fbbaa5311e17d14ae4eb95ed183bd3a95142f5';
 const p=PropertiesService.getScriptProperties(),key=QBO_NATIVE_CDC_PRODUCTION.WATERMARK_PROPERTY_KEY,watermark='2026-09-14T10:38:54.152Z';
 const check=function(){const s=qboNativeCdcReadState_();if(!qboNativeCdcIsPaused_()||!qboNativeCdcV1233CaptureOnly_()||!s||s.cycleId!==cycle||s.status!=='FAILED'||s.watermarkCommitted||p.getProperty(key)!==watermark||ScriptApp.getProjectTriggers().some(function(t){return [QBO_NATIVE_CDC_PRODUCTION.TRIGGER_HANDLERS.START,QBO_NATIVE_CDC_PRODUCTION.TRIGGER_HANDLERS.NEXT].indexOf(t.getHandlerFunction())>=0;}))throw new Error('V1235_PAUSED_BOUNDARY_NOT_EXACT');return s;};
 const state=check(),raw=DriveApp.getFileById(sourceId).getBlob().getDataAsString('UTF-8');if(qboNativeCdcSha256_(raw)!==sourceHash)throw new Error('V1235_SOURCE_CHANGED');
 const source=JSON.parse(raw),rows=qboNativeCdcProductionExtractEntities_(source,'Purchase'),boundary=qboNativeCdcPurchaseOverlapBoundaryV1235_(rows),since=new Date(boundary.maxLiveTimeMs-1000);
 qboNativeCdcV1233RequireWindow_(since.toISOString());
 const startedAt=new Date().toISOString(),response=qboNativeCdcRequestEntity_('Purchase',since,getConfig_().minorVersion),finishedAt=new Date().toISOString();
 // Save every response, including faulted/saturated results, before interpreting it.
 const evidence={version:'1.5.235',purpose:'PURCHASE_OVERLAP_PROBE_NOT_CERTIFIED',cycleId:cycle,sourceEvidenceFileId:sourceId,sourcePayloadSha256:sourceHash,changedSince:since.toISOString(),requestStartedAt:startedAt,requestCompletedAt:finishedAt,response:response};
 const text=JSON.stringify(evidence,null,2),file=DriveApp.getFolderById(state.runFolderId).createFile('purchase_overlap_probe_v1235_'+Utilities.getUuid()+'.json',text,'application/json');
 if(qboNativeCdcSha256_(file.getBlob().getDataAsString('UTF-8'))!==qboNativeCdcSha256_(text))throw new Error('V1235_PROBE_EVIDENCE_VERIFY_FAILED');
 const result=qboNativeCdcPurchaseResponseSummaryV1234_(response),known=Object.create(null);rows.forEach(function(r){if(r&&r.Id!=null)known[String(r.Id)]=true;});
 let overlappingRows=0,newRows=0;qboNativeCdcProductionExtractEntities_(response,'Purchase').forEach(function(r){if(known[String(r.Id)])overlappingRows++;else newRows++;});
 result.version='1.5.235';result.mode='CONTROLLED_ACQUISITION_PROBE';result.changedSince=since.toISOString();result.sourceMaxLiveUpdatedTime=new Date(boundary.maxLiveTimeMs).toISOString();result.sourceRowsAtMaxLiveTime=boundary.rowsAtMaxLiveTime;result.overlappingIdRows=overlappingRows;result.previouslyUnseenIdRows=newRows;result.probeEvidenceFileId=file.getId();result.probeEvidenceSha256=qboNativeCdcSha256_(text);result.completenessCertified=false;result.watermarkAdvanced=false;result.ingestionAuthorized=false;
 try{check();result.boundaryStillExact=true;}catch(e){result.boundaryStillExact=false;result.boundaryError=String(e.message||e);}
 console.log('[NATIVE CDC PURCHASE V1235] | PROBE_SAVED | '+JSON.stringify(result));return result;
}
function qboNativeCdcPurchaseOverlapBoundaryV1235_(rows){
 let max=-Infinity,ties=0;rows.forEach(function(row){if(!row||typeof row!=='object')throw new Error('V1235_INVALID_SOURCE_ROW');if(String(row.status||'').toLowerCase()==='deleted')return;const time=Date.parse(row.MetaData&&row.MetaData.LastUpdatedTime);if(!isFinite(time))throw new Error('V1235_LIVE_TIMESTAMP_MISSING');if(time>max){max=time;ties=1;}else if(time===max)ties++;});if(!isFinite(max))throw new Error('V1235_NO_LIVE_BOUNDARY');return {maxLiveTimeMs:max,rowsAtMaxLiveTime:ties};
}
