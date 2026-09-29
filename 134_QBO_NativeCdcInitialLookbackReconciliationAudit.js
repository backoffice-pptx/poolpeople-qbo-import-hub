/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 134_QBO_NativeCdcInitialLookbackReconciliationAudit.js
 * Version     : 1.5.112
 *
 * READ-ONLY reconciliation of the proven initial Native CDC lookback run:
 *   a993402a-abb5-4fbd-b3c7-e67ea26c364e
 *
 * This audit deliberately calls the 894 returned records SOURCE OBSERVATIONS,
 * not "changes". It establishes:
 *   1) exact entity-level population from immutable CDC response evidence;
 *   2) whether those observations are represented in current 03 V2;
 *   3) what Native CDC lineage exists in 05 and 06;
 *   4) whether 06 physical payload contents can be matched to the initial
 *      lookback observations by EntityType + EntityId.
 *
 * No writes.
 */
const QBO_NCDC_INITIAL_RECON_V1_5_112 = Object.freeze({
  VERSION: 'QBO_NATIVE_CDC_INITIAL_LOOKBACK_RECONCILIATION_V1_5_112',
  INITIAL_RUN_FOLDER_ID: '14Mp3FGhOXgF8OEc7cwbDNR6lhNBsmjVj',
  INITIAL_CDC_RUN_ID: 'a993402a-abb5-4fbd-b3c7-e67ea26c364e',
  STATE_CAPTURE_SPREADSHEET_ID: '1JQ3s7fbOvSySmXVx5LuZhDogN2eMFekNAlU5Q6Tx4x0',
  SHEET03: '03_Native_CDC_Events_V2',
  SHEET05: '05_Ingestion_Processing',
  SHEET06: '06_Payload_Artifacts'
});

function auditQboNativeCdcInitialLookbackReconciliation() {
  const C = QBO_NCDC_INITIAL_RECON_V1_5_112;
  const folder = DriveApp.getFolderById(C.INITIAL_RUN_FOLDER_ID);
  const source = qboNcdc112ReadInitialRun_(folder);

  const ss = SpreadsheetApp.openById(C.STATE_CAPTURE_SPREADSHEET_ID);
  const rows03 = qboNcdc112ReadSheet_(ss, C.SHEET03);
  const rows05 = qboNcdc112ReadSheet_(ss, C.SHEET05);
  const rows06 = qboNcdc112ReadSheet_(ss, C.SHEET06);

  const sourceKeys = {};
  source.observations.forEach(function(o) {
    sourceKeys[o.entityKey] = o;
  });

  const current03ForRun = rows03.filter(function(r) {
    return qboNcdc112Contains_(r.CdcRunId, C.INITIAL_CDC_RUN_ID) ||
           qboNcdc112Contains_(r.SourceId, C.INITIAL_CDC_RUN_ID) ||
           qboNcdc112Contains_(r.NativeCdcEventId, C.INITIAL_CDC_RUN_ID);
  });

  const native05 = rows05.filter(qboNcdc112IsNativeCdcRow_);
  const native06 = rows06.filter(qboNcdc112IsNativeCdcRow_);
  const exact05ForRun = native05.filter(function(r) {
    return qboNcdc112RowContains_(r, C.INITIAL_CDC_RUN_ID);
  });
  const exact06ForRun = native06.filter(function(r) {
    return qboNcdc112RowContains_(r, C.INITIAL_CDC_RUN_ID);
  });

  // Parse only Native CDC physical payload shards, not all 3,455 artifacts.
  const physical = qboNcdc112AuditNativePayloads_(native06, sourceKeys);

  const summary = {
    version: C.VERSION,
    status: source.reconcilesManifest ? 'EVIDENCE_RECONCILED' : 'ACTION_REQUIRED',
    readOnly: true,
    acquisitionClassification: 'INITIAL_LOOKBACK',
    cdcRunId: C.INITIAL_CDC_RUN_ID,
    source: {
      manifestReturnedEntityCount: source.manifestReturnedEntityCount,
      parsedObservationCount: source.observations.length,
      liveCount: source.liveCount,
      deletedCount: source.deletedCount,
      entityEvidenceFileCount: source.entityEvidenceFileCount,
      reconcilesManifest: source.reconcilesManifest,
      windowStart: source.windowStart,
      windowEnd: source.windowEnd
    },
    current03: {
      exactRunRowCount: current03ForRun.length,
      exactRunUniqueEntityKeyCount: qboNcdc112UniqueEntityKeysFromRows_(current03ForRun)
    },
    current05: {
      nativeCdcRowCount: native05.length,
      exactInitialRunRowCount: exact05ForRun.length,
      exactInitialRunObservationCount: qboNcdc112Sum_(exact05ForRun, 'ExpectedObservationCount'),
      sourceIds: qboNcdc112Distinct_(native05, 'IngestionSourceId')
    },
    current06: {
      nativeCdcArtifactCount: native06.length,
      nativeCdcObservationCount: qboNcdc112Sum_(native06, 'ObservationCount'),
      exactInitialRunArtifactCount: exact06ForRun.length,
      exactInitialRunObservationCount: qboNcdc112Sum_(exact06ForRun, 'ObservationCount'),
      sourceIds: qboNcdc112Distinct_(native06, 'IngestionSourceId')
    },
    physicalPayloadComparison: physical.summary,
    controls: {
      mutatesDrive: false,
      mutatesWorkbook: false,
      mutatesScriptProperties: false,
      mutatesTriggers: false,
      mutatesStateApplication: false
    }
  };

  console.log('[NCDC INITIAL RECON] | SUMMARY | ' + JSON.stringify(summary));
  console.log('[NCDC INITIAL RECON] | SOURCE ENTITY COUNTS | ' + JSON.stringify(source.entityCounts));
  console.log('[NCDC INITIAL RECON] | SOURCE DELETED COUNTS | ' + JSON.stringify(source.entityDeletedCounts));

  console.log('[NCDC INITIAL RECON] | 03 EXACT RUN | ' + JSON.stringify(
    current03ForRun.slice(0, 100).map(qboNcdc112Compact03_)
  ));
  console.log('[NCDC INITIAL RECON] | 05 NATIVE CDC | ' + JSON.stringify(
    native05.map(qboNcdc112Compact05_)
  ));
  console.log('[NCDC INITIAL RECON] | 06 NATIVE CDC | ' + JSON.stringify(
    native06.map(qboNcdc112Compact06_)
  ));

  if (physical.unmatchedPayloadExamples.length) {
    console.log('[NCDC INITIAL RECON] | PAYLOAD UNMATCHED EXAMPLES | ' +
      JSON.stringify(physical.unmatchedPayloadExamples.slice(0, 50)));
  }
  if (physical.matchedInitialExamples.length) {
    console.log('[NCDC INITIAL RECON] | INITIAL MATCH EXAMPLES | ' +
      JSON.stringify(physical.matchedInitialExamples.slice(0, 50)));
  }
  if (physical.parseErrors.length) {
    console.log('[NCDC INITIAL RECON] | PAYLOAD PARSE ERRORS | ' +
      JSON.stringify(physical.parseErrors));
  }

  return {summary: summary, source: source, physical: physical};
}

function qboNcdc112ReadInitialRun_(folder) {
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());

  const mf = files.filter(function(f){ return /^manifest\.json$/i.test(f.getName()); });
  if (mf.length !== 1) throw new Error('Expected exactly one manifest.');
  const m = JSON.parse(mf[0].getBlob().getDataAsString('UTF-8'));

  const observations = [];
  const entityCounts = {};
  const entityDeletedCounts = {};
  const entityFiles = files.filter(function(f){ return /^cdc_.+\.json$/i.test(f.getName()); });

  entityFiles.forEach(function(f) {
    const expectedType = f.getName().replace(/^cdc_/i,'').replace(/\.json$/i,'');
    const obj = JSON.parse(f.getBlob().getDataAsString('UTF-8'));
    const parsed = qboNcdc112ExtractCdc_(obj, expectedType, f);
    entityCounts[expectedType] = parsed.length;
    entityDeletedCounts[expectedType] = parsed.filter(function(o){return o.deleted;}).length;
    Array.prototype.push.apply(observations, parsed);
  });

  const live = observations.filter(function(o){return !o.deleted;}).length;
  const deleted = observations.length - live;
  const returned = Number(m.returnedEntityCount || 0);
  const manifestLive = Number(m.liveEntityCount || 0);
  const manifestDeleted = Number(m.deletedEntityCount || 0);

  return {
    cdcRunId: String(m.cdcRunId || ''),
    initialRun: m.initialRun === true,
    windowStart: String(m.windowStart || ''),
    windowEnd: String(m.windowEnd || ''),
    runStartedAt: String(m.runStartedAt || ''),
    runCompletedAt: String(m.runCompletedAt || ''),
    manifestReturnedEntityCount: returned,
    manifestLiveEntityCount: manifestLive,
    manifestDeletedEntityCount: manifestDeleted,
    entityEvidenceFileCount: entityFiles.length,
    observations: observations,
    liveCount: live,
    deletedCount: deleted,
    entityCounts: entityCounts,
    entityDeletedCounts: entityDeletedCounts,
    reconcilesManifest:
      entityFiles.length === 20 &&
      observations.length === returned &&
      live === manifestLive &&
      deleted === manifestDeleted
  };
}

function qboNcdc112ExtractCdc_(obj, expectedType, file) {
  const out = [];
  const cdc = obj && obj.CDCResponse;
  if (!Array.isArray(cdc)) return out;

  cdc.forEach(function(block, blockIndex) {
    const qrs = block && block.QueryResponse;
    if (!Array.isArray(qrs)) return;

    qrs.forEach(function(qr, queryIndex) {
      if (!qr || typeof qr !== 'object') return;
      const qboStatus = String(qr.status || qr.Status || '').trim();

      Object.keys(qr).forEach(function(k) {
        if (['startPosition','maxResults','totalCount','status','Status'].indexOf(k) >= 0) return;
        if (!Array.isArray(qr[k])) return;

        qr[k].forEach(function(entity, entityIndex) {
          const entityType = k || expectedType;
          const id = String(entity && (entity.Id || entity.id) || '').trim();
          const deleted = qboNcdc112Deleted_(entity, qboStatus);
          out.push({
            entityType: entityType,
            entityId: id,
            entityKey: entityType + '|' + id,
            deleted: deleted,
            qboStatus: qboStatus,
            syncToken: String(entity && (entity.SyncToken || entity.syncToken) || ''),
            qboLastUpdatedTime: String(
              entity && entity.MetaData && entity.MetaData.LastUpdatedTime || ''
            ),
            evidenceFileId: file.getId(),
            evidenceFileName: file.getName(),
            evidenceIndex: [blockIndex, queryIndex, entityIndex].join(':')
          });
        });
      });
    });
  });
  return out;
}

function qboNcdc112Deleted_(entity, status) {
  if (String(status || '').toLowerCase() === 'deleted') return true;
  if (!entity || typeof entity !== 'object') return false;
  if (entity.Deleted === true || entity.deleted === true) return true;
  return String(entity.status || entity.Status || '').toLowerCase() === 'deleted';
}

function qboNcdc112AuditNativePayloads_(rows06, sourceKeys) {
  let parsedFiles = 0, parsedLogical = 0, matchedInitial = 0;
  const matchedKeys = {}, payloadKeys = {}, parseErrors = [];
  const unmatchedPayloadExamples = [], matchedInitialExamples = [];

  rows06.forEach(function(r) {
    const fileId = String(r.PayloadFileId || '').trim();
    if (!fileId) return;
    try {
      const obj = JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8'));
      parsedFiles++;
      const logical = qboNcdc112ExtractPayloadObservations_(obj);
      parsedLogical += logical.length;

      logical.forEach(function(o) {
        if (!o.entityType || !o.entityId) return;
        const key = o.entityType + '|' + o.entityId;
        payloadKeys[key] = true;
        if (sourceKeys[key]) {
          matchedInitial++;
          matchedKeys[key] = true;
          if (matchedInitialExamples.length < 50) {
            matchedInitialExamples.push({
              entityKey:key,
              ingestionSourceId:String(r.IngestionSourceId||''),
              payloadFileId:fileId,
              payloadFileName:String(r.PayloadFileName||'')
            });
          }
        } else if (unmatchedPayloadExamples.length < 50) {
          unmatchedPayloadExamples.push({
            entityKey:key,
            ingestionSourceId:String(r.IngestionSourceId||''),
            payloadFileId:fileId,
            payloadFileName:String(r.PayloadFileName||'')
          });
        }
      });
    } catch (e) {
      parseErrors.push({
        payloadFileId:fileId,
        payloadFileName:String(r.PayloadFileName||''),
        error:String(e && e.message ? e.message : e)
      });
    }
  });

  return {
    summary: {
      nativeCdcArtifactRowsAttempted: rows06.length,
      parsedPhysicalFiles: parsedFiles,
      parsedLogicalObservations: parsedLogical,
      distinctPayloadEntityKeys: Object.keys(payloadKeys).length,
      logicalObservationsMatchingInitialEntityKeys: matchedInitial,
      distinctInitialEntityKeysMatched: Object.keys(matchedKeys).length,
      initialSourceDistinctEntityKeys: Object.keys(sourceKeys).length,
      parseErrorCount: parseErrors.length
    },
    matchedInitialExamples: matchedInitialExamples,
    unmatchedPayloadExamples: unmatchedPayloadExamples,
    parseErrors: parseErrors
  };
}

function qboNcdc112ExtractPayloadObservations_(obj) {
  const out = [];
  const seen = [];

  function walk(v, depth) {
    if (depth > 8 || v == null) return;
    if (Array.isArray(v)) {
      v.forEach(function(x){ walk(x, depth + 1); });
      return;
    }
    if (typeof v !== 'object') return;

    const et = String(v.EntityType || v.entityType || '').trim();
    let id = String(v.EntityId || v.entityId || '').trim();

    if (!id) {
      const obs = v.Observation || v.observation;
      if (obs && typeof obs === 'object') {
        id = String(obs.Id || obs.id || obs.EntityId || obs.entityId || '').trim();
      }
    }

    if (et && id) {
      const sig = et + '|' + id + '|' + depth;
      if (seen.indexOf(sig) < 0) {
        seen.push(sig);
        out.push({entityType:et,entityId:id});
      }
    }

    Object.keys(v).forEach(function(k){ walk(v[k], depth + 1); });
  }

  walk(obj, 0);
  return out;
}

function qboNcdc112ReadSheet_(ss, name) {
  const s = ss.getSheetByName(name);
  if (!s) return [];
  const lr=s.getLastRow(), lc=s.getLastColumn();
  if (lr < 2 || lc < 1) return [];
  const vals=s.getRange(1,1,lr,lc).getValues();
  const h=vals[0].map(function(x){return String(x||'').trim();});
  return vals.slice(1).filter(function(r){
    return r.some(function(v){return String(v==null?'':v).trim()!=='';});
  }).map(function(r){
    const o={}; h.forEach(function(k,i){if(k)o[k]=r[i];}); return o;
  });
}

function qboNcdc112IsNativeCdcRow_(r) {
  return [
    r.SourceType, r.IngestionSourceId, r.SourceRunId, r.SourceLedger
  ].some(function(v){ return /NATIVE[_ ]?CDC/i.test(String(v||'')); });
}

function qboNcdc112RowContains_(r, token) {
  return Object.keys(r).some(function(k){
    return qboNcdc112Contains_(r[k], token);
  });
}

function qboNcdc112Contains_(v, token) {
  return String(v==null?'':v).indexOf(token) >= 0;
}

function qboNcdc112Sum_(rows, col) {
  return rows.reduce(function(n,r){return n+(Number(r[col])||0);},0);
}

function qboNcdc112Distinct_(rows, col) {
  const m={};
  rows.forEach(function(r){
    const v=String(r[col]||'').trim();
    if(v)m[v]=true;
  });
  return Object.keys(m).sort();
}

function qboNcdc112UniqueEntityKeysFromRows_(rows) {
  const m={};
  rows.forEach(function(r){
    const et=String(r.EntityType||'').trim();
    const id=String(r.EntityId||'').trim();
    if(et&&id)m[et+'|'+id]=true;
  });
  return Object.keys(m).length;
}

function qboNcdc112Compact03_(r) {
  return {
    NativeCdcEventId:r.NativeCdcEventId||'',
    CdcRunId:r.CdcRunId||'',
    SourceId:r.SourceId||'',
    EntityType:r.EntityType||'',
    EntityId:r.EntityId||'',
    Operation:r.Operation||'',
    ObservedAt:r.ObservedAt||'',
    EligibilityStatus:r.EligibilityStatus||''
  };
}
function qboNcdc112Compact05_(r) {
  return {
    IngestionSourceId:r.IngestionSourceId||'',
    SourceType:r.SourceType||'',
    SourceRunId:r.SourceRunId||'',
    EntityType:r.EntityType||'',
    ExpectedObservationCount:r.ExpectedObservationCount||'',
    ProcessedObservationCount:r.ProcessedObservationCount||'',
    PayloadCount:r.PayloadCount||'',
    ShardCount:r.ShardCount||'',
    ProcessingStatus:r.ProcessingStatus||''
  };
}
function qboNcdc112Compact06_(r) {
  return {
    IngestionSourceId:r.IngestionSourceId||'',
    SourceType:r.SourceType||'',
    SourceRunId:r.SourceRunId||'',
    WorkUnitId:r.WorkUnitId||'',
    ObservationCount:r.ObservationCount||'',
    PayloadCount:r.PayloadCount||'',
    PayloadFileId:r.PayloadFileId||'',
    PayloadFileName:r.PayloadFileName||'',
    LineageStatus:r.LineageStatus||''
  };
}
