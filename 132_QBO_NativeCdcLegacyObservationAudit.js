/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 132_QBO_NativeCdcLegacyObservationAudit.js
 * Version     : 1.5.110
 *
 * READ-ONLY: parse the two committed pre-CycleId Native CDC runs and prove
 * entity-level observation population directly from immutable CDCResponse files.
 */
const QBO_NCDC_LEGACY_OBS_AUDIT_V1_5_110 = Object.freeze({
  VERSION: 'QBO_NATIVE_CDC_LEGACY_OBSERVATION_AUDIT_V1_5_110',
  COMMITTED_RUN_FOLDER_IDS: [
    '14Mp3FGhOXgF8OEc7cwbDNR6lhNBsmjVj',
    '1kn5sfZak1nxCHXAQCbj8J6cVtAkh3Sxq'
  ]
});

function auditQboNativeCdcLegacyObservations() {
  const C = QBO_NCDC_LEGACY_OBS_AUDIT_V1_5_110;
  const runs = C.COMMITTED_RUN_FOLDER_IDS.map(function(id) {
    return qboNcdc110AuditRun_(DriveApp.getFolderById(id));
  });

  const totalParsed = runs.reduce(function(n,r){return n+r.parsedObservationCount;},0);
  const totalManifest = runs.reduce(function(n,r){return n+r.manifest.returnedEntityCount;},0);
  const totalLive = runs.reduce(function(n,r){return n+r.liveCount;},0);
  const totalDeleted = runs.reduce(function(n,r){return n+r.deletedCount;},0);
  const allReconcile = runs.every(function(r){
    return r.parsedObservationCount === r.manifest.returnedEntityCount &&
           r.liveCount === r.manifest.liveEntityCount &&
           r.deletedCount === r.manifest.deletedEntityCount &&
           r.entityFileCount === 20 &&
           r.parseErrorCount === 0;
  });

  const summary = {
    version:C.VERSION,
    status:allReconcile ? 'VALID' : 'ACTION_REQUIRED',
    readOnly:true,
    committedLegacyRunCount:runs.length,
    entityEvidenceFileCount:runs.reduce(function(n,r){return n+r.entityFileCount;},0),
    parsedObservationCount:totalParsed,
    manifestReturnedEntityCount:totalManifest,
    liveCount:totalLive,
    deletedCount:totalDeleted,
    parseErrorCount:runs.reduce(function(n,r){return n+r.parseErrorCount;},0),
    allRunsReconcileManifest:allReconcile,
    controls:{mutatesDrive:false,mutatesWorkbook:false,mutatesProperties:false,mutatesTriggers:false}
  };
  console.log('[NATIVE CDC LEGACY OBS] | SUMMARY | '+JSON.stringify(summary));

  runs.forEach(function(r){
    console.log('[NATIVE CDC LEGACY OBS] | RUN | '+JSON.stringify({
      cdcRunId:r.cdcRunId, folderId:r.folderId, folderName:r.folderName,
      manifest:r.manifest, entityFileCount:r.entityFileCount,
      parsedObservationCount:r.parsedObservationCount,
      liveCount:r.liveCount, deletedCount:r.deletedCount,
      minObservedAt:r.minObservedAt, maxObservedAt:r.maxObservedAt,
      distinctObservedAtCount:r.distinctObservedAtCount,
      timestampSources:r.timestampSources,
      operationCounts:r.operationCounts,
      entityCounts:r.entityCounts,
      parseErrorCount:r.parseErrorCount
    }));
    if (r.parseErrors.length) {
      console.log('[NATIVE CDC LEGACY OBS] | ERRORS | '+JSON.stringify({
        cdcRunId:r.cdcRunId, errors:r.parseErrors
      }));
    }
  });
  return {summary:summary,runs:runs};
}

function qboNcdc110AuditRun_(folder) {
  const files=[], it=folder.getFiles();
  while(it.hasNext()) files.push(it.next());

  const mf=files.filter(function(f){return /^manifest\.json$/i.test(f.getName());});
  if(mf.length!==1) throw new Error('Expected exactly one manifest in '+folder.getName());
  const manifest=JSON.parse(mf[0].getBlob().getDataAsString('UTF-8'));
  const cdcRunId=String(manifest.cdcRunId||'').trim();
  if(!cdcRunId) throw new Error('Manifest missing cdcRunId in '+folder.getName());

  const entityFiles=files.filter(function(f){return /^cdc_.+\.json$/i.test(f.getName());});
  const entityCounts={}, operationCounts={}, tsSources={}, observedTimes={};
  let parsed=0, live=0, deleted=0, minTs='', maxTs='', parseErrors=[];

  entityFiles.forEach(function(f){
    try {
      const obj=JSON.parse(f.getBlob().getDataAsString('UTF-8'));
      const entityType=f.getName().replace(/^cdc_/i,'').replace(/\.json$/i,'');
      const observations=qboNcdc110ExtractCdcEntities_(obj,entityType);
      entityCounts[entityType]=observations.length;

      observations.forEach(function(o){
        parsed++;
        const deletedFlag=qboNcdc110IsDeleted_(o.entity,o.status);
        if(deletedFlag) deleted++; else live++;
        const op=deletedFlag?'DELETE':'UPSERT';
        operationCounts[op]=(operationCounts[op]||0)+1;

        const ts=qboNcdc110ResolveObservedAt_(obj,o.entity,manifest);
        tsSources[ts.source]=(tsSources[ts.source]||0)+1;
        if(ts.value) {
          observedTimes[ts.value]=true;
          if(!minTs || ts.value<minTs) minTs=ts.value;
          if(!maxTs || ts.value>maxTs) maxTs=ts.value;
        }
      });
    } catch(e) {
      parseErrors.push({fileId:f.getId(),fileName:f.getName(),error:String(e&&e.message?e.message:e)});
    }
  });

  return {
    cdcRunId:cdcRunId,
    folderId:folder.getId(), folderName:folder.getName(),
    manifest:{
      status:String(manifest.status||''),
      watermarkCommitted:manifest.watermarkCommitted===true,
      runStartedAt:String(manifest.runStartedAt||''),
      runCompletedAt:String(manifest.runCompletedAt||''),
      windowStart:String(manifest.windowStart||''),
      windowEnd:String(manifest.windowEnd||''),
      returnedEntityCount:Number(manifest.returnedEntityCount||0),
      liveEntityCount:Number(manifest.liveEntityCount||0),
      deletedEntityCount:Number(manifest.deletedEntityCount||0)
    },
    entityFileCount:entityFiles.length,
    parsedObservationCount:parsed, liveCount:live, deletedCount:deleted,
    minObservedAt:minTs,maxObservedAt:maxTs,
    distinctObservedAtCount:Object.keys(observedTimes).length,
    timestampSources:tsSources, operationCounts:operationCounts,
    entityCounts:entityCounts,
    parseErrorCount:parseErrors.length, parseErrors:parseErrors
  };
}

function qboNcdc110ExtractCdcEntities_(obj, expectedType) {
  const out=[];
  const resp=obj && obj.CDCResponse;
  if(!Array.isArray(resp)) return out;

  resp.forEach(function(block){
    if(!block || typeof block!=='object') return;
    const qr=block.QueryResponse;
    if(!qr || typeof qr!=='object') return;

    Object.keys(qr).forEach(function(k){
      if(k==='startPosition'||k==='maxResults'||k==='totalCount') return;
      const arr=Array.isArray(qr[k]) ? qr[k] : [];
      arr.forEach(function(entity){
        out.push({entityType:k||expectedType,entity:entity,status:qr.status||block.status||''});
      });
    });
  });
  return out;
}

function qboNcdc110IsDeleted_(entity,status) {
  if(String(status||'').toLowerCase()==='deleted') return true;
  if(!entity || typeof entity!=='object') return false;
  if(entity.Deleted===true || entity.deleted===true) return true;
  if(String(entity.status||entity.Status||'').toLowerCase()==='deleted') return true;
  return false;
}

function qboNcdc110ResolveObservedAt_(fileObj,entity,manifest) {
  // Evidence-first chronology. We report the source actually available rather
  // than substituting QBO LastUpdatedTime for observation time.
  const t=fileObj && fileObj.time;
  if(typeof t==='string' && t) return {value:t,source:'CDC_FILE_TIME'};
  if(t && typeof t==='object') {
    const candidates=[
      ['requestCompletedAt',t.requestCompletedAt],
      ['completedAt',t.completedAt],
      ['responseAt',t.responseAt],
      ['end',t.end],
      ['timestamp',t.timestamp]
    ];
    for(let i=0;i<candidates.length;i++){
      if(candidates[i][1]) return {value:String(candidates[i][1]),source:'CDC_FILE_TIME.'+candidates[i][0]};
    }
  }
  if(manifest.runCompletedAt) return {value:String(manifest.runCompletedAt),source:'MANIFEST_RUN_COMPLETED_FALLBACK'};
  return {value:'',source:'MISSING'};
}
