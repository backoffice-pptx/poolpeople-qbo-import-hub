/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 135_QBO_NativeCdcHistoricalReconstructionV2.js
 * Version     : 1.5.117
 *
 * Controlled Native CDC historical reconstruction PREVIEW.
 *
 * IMPORTANT:
 * - v1.5.113 is intentionally PREVIEW-ONLY.
 * - It does not write 02a, 02b, 03, 05, 06, payloads, properties, or triggers.
 * - It derives the candidate reconstruction from immutable Native CDC Drive evidence.
 *
 * Locked architecture:
 *   02a_CDC_Run_Attempts_V2   = all governed attempts
 *   02b_CDC_Committed_Runs_V2 = committed subset
 *   03_Native_CDC_Events_V2   = observations from committed runs
 *
 * Historical special cases:
 * - 106c71f8-042e-44e5-a6b1-30a746dd731f:
 *     FAILED_UNCOMMITTED INITIAL_LOOKBACK; empty folder; terminal failure proven
 *     separately by Apps Script execution history. No 03 observations.
 * - a993402a-abb5-4fbd-b3c7-e67ea26c364e:
 *     COMMITTED_SUCCESS INITIAL_LOOKBACK; 894 observations.
 * - a9ab03b8-0c9f-49a8-8780-92c58078d5e4:
 *     COMMITTED_SUCCESS INCREMENTAL; zero observations.
 *
 * Source operation never asserts a State Application transition:
 *   03 source operation != 11 State Change.
 */

const QBO_NCDC_HIST_RECON_1_5_113 = Object.freeze({
  VERSION: 'QBO_NATIVE_CDC_HISTORICAL_RECONSTRUCTION_V1_5_117',
  STATE_CAPTURE_SPREADSHEET_ID: '1JQ3s7fbOvSySmXVx5LuZhDogN2eMFekNAlU5Q6Tx4x0',
  SHEET03: '03_Native_CDC_Events_V2',
  NATIVE_CDC_ROOT_ID: '1wuIk1bYM2hu78M7KcsXhAlmP39O8wh99',
  FAILED_INITIAL_ATTEMPT_UUID: '106c71f8-042e-44e5-a6b1-30a746dd731f',
  INITIAL_COMMITTED_RUN_ID: 'a993402a-abb5-4fbd-b3c7-e67ea26c364e',
  FIRST_INCREMENTAL_RUN_ID: 'a9ab03b8-0c9f-49a8-8780-92c58078d5e4'
});

function previewQboNativeCdcHistoricalReconstructionV2() {
  const C = QBO_NCDC_HIST_RECON_1_5_113;
  const root = DriveApp.getFolderById(C.NATIVE_CDC_ROOT_ID);
  const candidates = [];
  qboNcdc113WalkFolders_(root, 0, candidates);

  const attempts = [];
  const committed = [];
  const observations = [];
  const findings = [];

  candidates.forEach(function(c) {
    const manifestFile = qboNcdc113FindManifest_(c.folder);
    const manifest = manifestFile ? qboNcdc113ReadJson_(manifestFile, findings) : null;
    const folderIdentity = qboNcdc113FolderIdentity_(c.folder.getName());

    if (!manifest && !folderIdentity.uuid) return;

    const attempt = qboNcdc113BuildAttempt_(c, manifestFile, manifest, folderIdentity, findings);
    if (!attempt) return;
    attempts.push(attempt);

    if (attempt.WatermarkCommitted === true && attempt.AcquisitionStatus === 'SUCCESS') {
      const cr = qboNcdc113BuildCommitted_(attempt);
      committed.push(cr);

      const obs = qboNcdc113ReadCommittedObservations_(c.folder, manifest, attempt, findings);
      Array.prototype.push.apply(observations, obs);
    }
  });

  attempts.sort(qboNcdc113AttemptSort_);
  committed.sort(qboNcdc113RunSort_);
  observations.sort(qboNcdc113ObservationSort_);

  // v1.5.117 gate: all already-established modern 03 identities must be
  // reproduced exactly before any controlled 03 reconstruction is allowed.
  const modernIdentityGate = qboNcdc117ModernIdentityGate_(observations, findings);

  const attemptIds = qboNcdc113DuplicateValues_(attempts.map(function(r){return r.CdcAttemptId;}));
  const committedIds = qboNcdc113DuplicateValues_(committed.map(function(r){return r.CdcRunId;}));
  const eventIds = qboNcdc113DuplicateValues_(observations.map(function(r){return r.NativeCdcEventId;}));

  if (attemptIds.length) findings.push({code:'DUPLICATE_ATTEMPT_ID', values:attemptIds});
  if (committedIds.length) findings.push({code:'DUPLICATE_COMMITTED_RUN_ID', values:committedIds});
  if (eventIds.length) findings.push({code:'DUPLICATE_EVENT_ID', values:eventIds});

  const committedById = {};
  committed.forEach(function(r){committedById[r.CdcRunId]=r;});
  observations.forEach(function(r) {
    if (!committedById[r.CdcRunId]) {
      findings.push({code:'03_WITHOUT_02B', NativeCdcEventId:r.NativeCdcEventId, CdcRunId:r.CdcRunId});
    }
  });

  const summary = {
    version: C.VERSION,
    mode: 'PREVIEW_ONLY',
    status: findings.length ? 'ACTION_REQUIRED' : 'READY_FOR_CONTROLLED_WRITE',
    candidate02aAttemptCount: attempts.length,
    candidate02bCommittedRunCount: committed.length,
    candidate03ObservationCount: observations.length,
    candidate03EligibleCount: observations.filter(function(r){return r.EligibilityStatus==='ELIGIBLE';}).length,
    candidate03IneligibleCount: observations.filter(function(r){return r.EligibilityStatus!=='ELIGIBLE';}).length,
    initialLookbackObservationCount: observations.filter(function(r){
      return r.CdcRunId===C.INITIAL_COMMITTED_RUN_ID;
    }).length,
    firstIncrementalObservationCount: observations.filter(function(r){
      return r.CdcRunId===C.FIRST_INCREMENTAL_RUN_ID;
    }).length,
    failedInitialAttemptPresent: attempts.some(function(r){
      return r.CdcAttemptId===C.FAILED_INITIAL_ATTEMPT_UUID &&
             r.AcquisitionStatus==='FAILED' &&
             r.WatermarkCommitted===false;
    }),
    acquisitionClassifications: qboNcdc113Count_(attempts, 'AcquisitionClassification'),
    attemptStatuses: qboNcdc113Count_(attempts, 'AcquisitionStatus'),
    committedClassifications: qboNcdc113Count_(committed, 'AcquisitionClassification'),
    observationEntityCounts: qboNcdc113Count_(observations, 'EntityType'),
    modernIdentityGate: modernIdentityGate,
    findingCount: findings.length,
    controls: {
      writes02a:false, writes02b:false, writes03:false, writes05:false, writes06:false,
      writesPayloads:false, writesProperties:false, writesTriggers:false
    }
  };

  console.log('[NCDC HIST RECON 1.5.117] | SUMMARY | ' + JSON.stringify(summary));
  console.log('[NCDC HIST RECON 1.5.117] | 02A LEGACY | ' + JSON.stringify(
    attempts.filter(function(r){
      return [C.FAILED_INITIAL_ATTEMPT_UUID,C.INITIAL_COMMITTED_RUN_ID,C.FIRST_INCREMENTAL_RUN_ID]
        .indexOf(r.CdcAttemptId)>=0 || [C.INITIAL_COMMITTED_RUN_ID,C.FIRST_INCREMENTAL_RUN_ID]
        .indexOf(r.CdcRunId)>=0;
    })
  ));
  console.log('[NCDC HIST RECON 1.5.117] | 02B LEGACY | ' + JSON.stringify(
    committed.filter(function(r){
      return [C.INITIAL_COMMITTED_RUN_ID,C.FIRST_INCREMENTAL_RUN_ID].indexOf(r.CdcRunId)>=0;
    })
  ));
  console.log('[NCDC HIST RECON 1.5.117] | FINDINGS | ' + JSON.stringify(findings));

  return {summary:summary, attempts:attempts, committed:committed, observations:observations, findings:findings};
}

function qboNcdc113WalkFolders_(folder, depth, out) {
  if (depth > 8) return;
  const name = folder.getName();
  if (/^QBO_Native_CDC_(Run|Cycle)_/i.test(name)) out.push({folder:folder, depth:depth});
  const it = folder.getFolders();
  while (it.hasNext()) qboNcdc113WalkFolders_(it.next(), depth+1, out);
}

function qboNcdc113FindManifest_(folder) {
  const it=folder.getFiles();
  const matches=[];
  while(it.hasNext()){
    const f=it.next();
    if (/manifest/i.test(f.getName()) && /\.json$/i.test(f.getName())) matches.push(f);
  }
  return matches.length===1 ? matches[0] : null;
}

function qboNcdc113ReadJson_(file, findings) {
  try { return JSON.parse(file.getBlob().getDataAsString('UTF-8')); }
  catch(e) {
    findings.push({code:'INVALID_JSON', fileId:file.getId(), fileName:file.getName(), error:String(e)});
    return null;
  }
}

function qboNcdc113FolderIdentity_(name) {
  const uuidMatch=String(name).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  const legacyTs=String(name).match(/(\d{8}_\d{6}_\d{3})/);
  const cycleBucket=String(name).match(/(\d{8}T\d{4}Z)/);
  return {
    uuid:uuidMatch?uuidMatch[1]:'',
    legacyTimestampToken:legacyTs?legacyTs[1]:'',
    cycleBucket:cycleBucket?cycleBucket[1]:''
  };
}

function qboNcdc113BuildAttempt_(c, mf, m, fi, findings) {
  const C=QBO_NCDC_HIST_RECON_1_5_113;
  const folder=c.folder;
  const uuid=fi.uuid;
  const manifestRunId=m ? String(m.cdcRunId || m.CdcRunId || '').trim() : '';
  const cycleId=m ? String(m.cycleId || m.CycleId || '').trim() : '';
  let runId=manifestRunId || cycleId || '';
  let attemptId=runId || uuid;

  // Modern manifests may use cycleId as the actual run identity while legacy uses UUID cdcRunId.
  if (!attemptId) return null;

  let initial = m ? (m.initialRun === true || String(m.initialRun).toLowerCase()==='true') : false;
  let acquisition = initial ? 'INITIAL_LOOKBACK' : 'INCREMENTAL';
  let status = m ? String(m.status || m.Status || '').toUpperCase() : 'UNRESOLVED';
  let wmCommitted = m ? (m.watermarkCommitted === true || String(m.watermarkCommitted).toLowerCase()==='true') : false;

  if (uuid===C.FAILED_INITIAL_ATTEMPT_UUID && !m) {
    initial=true;
    acquisition='INITIAL_LOOKBACK';
    status='FAILED';
    wmCommitted=false;
  }

  if (status==='COMPLETED') status='SUCCESS';
  if (!status) status='UNRESOLVED';

  const runStarted = m ? String(m.runStartedAt || '') : qboNcdc113LegacyTsIso_(fi.legacyTimestampToken);
  const runCompleted = m ? String(m.runCompletedAt || '') : '';

  return {
    CdcAttemptId:attemptId,
    CdcRunId:runId,
    AttemptIdentityBasis:manifestRunId ? 'MANIFEST_CDC_RUN_ID' :
      (cycleId ? 'MANIFEST_CYCLE_ID' : 'IMMUTABLE_FOLDER_NAME_UUID'),
    AcquisitionClassification:acquisition,
    SourceAcquisitionType:'NATIVE_CDC',
    RunStartedAt:runStarted,
    RunCompletedAt:runCompleted,
    WindowStart:m?String(m.windowStart||''):'',
    WindowEnd:m?String(m.windowEnd||''):'',
    InitialRun:initial,
    InitialLookbackDays:m?(Number(m.initialLookbackDays)||0):0,
    OverlapMinutes:m?(Number(m.overlapMinutes)||0):0,
    PriorSuccessfulWatermark:m?String(m.priorSuccessfulWatermark||''):'',
    EntityTypesRequested:m?qboNcdc113EntityTypes_(m.entityTypesRequested):'',
    CompletedEntityCount:m?qboNcdc113CompletedEntityCount_(m):0,
    ReturnedEntityCount:m?(Number(m.returnedEntityCount)||0):0,
    LiveEntityCount:m?(Number(m.liveEntityCount)||0):0,
    DeletedEntityCount:m?(Number(m.deletedEntityCount)||0):0,
    AcquisitionStatus:status,
    WatermarkCommitted:wmCommitted,
    CommittedWatermark:m?String(m.committedWatermark||''):'',
    ManifestFileId:mf?mf.getId():'',
    ManifestFileName:mf?mf.getName():'',
    ManifestHash:mf?qboNcdc113Sha256_(mf.getBlob().getBytes()):'',
    RunFolderId:folder.getId(),
    RunFolderName:folder.getName(),
    MinorVersion:m?String(m.minorVersion||''):'',
    CodeVersion:m?String(m.version||m.codeVersion||''):'',
    EvidenceCreatedAt:runCompleted || runStarted,
    RegistrationMode:'HISTORICAL_BACKFILL',
    RegisteredAt:''
  };
}

function qboNcdc113BuildCommitted_(a) {
  return {
    CdcRunId:a.CdcRunId,
    CdcAttemptId:a.CdcAttemptId,
    AcquisitionClassification:a.AcquisitionClassification,
    SourceAcquisitionType:a.SourceAcquisitionType,
    RunStartedAt:a.RunStartedAt,
    RunCompletedAt:a.RunCompletedAt,
    WindowStart:a.WindowStart,
    WindowEnd:a.WindowEnd,
    InitialRun:a.InitialRun,
    InitialLookbackDays:a.InitialLookbackDays,
    OverlapMinutes:a.OverlapMinutes,
    PriorSuccessfulWatermark:a.PriorSuccessfulWatermark,
    CommittedWatermark:a.CommittedWatermark,
    WatermarkCommitted:true,
    EntityTypesRequested:a.EntityTypesRequested,
    CompletedEntityCount:a.CompletedEntityCount,
    ReturnedEntityCount:a.ReturnedEntityCount,
    LiveEntityCount:a.LiveEntityCount,
    DeletedEntityCount:a.DeletedEntityCount,
    ManifestFileId:a.ManifestFileId,
    ManifestFileName:a.ManifestFileName,
    ManifestHash:a.ManifestHash,
    RunFolderId:a.RunFolderId,
    RunFolderName:a.RunFolderName,
    MinorVersion:a.MinorVersion,
    CodeVersion:a.CodeVersion,
    EvidenceCreatedAt:a.EvidenceCreatedAt,
    RegistrationMode:a.RegistrationMode,
    RegisteredAt:''
  };
}

function qboNcdc113ReadCommittedObservations_(folder, manifest, attempt, findings) {
  if (!manifest) return [];
  const files=[];
  const it=folder.getFiles();
  while(it.hasNext()){
    const f=it.next();
    if (/^cdc_.+\.json$/i.test(f.getName())) files.push(f);
  }

  const out=[];
  files.forEach(function(f){
    const expected=f.getName().replace(/^cdc_/i,'').replace(/\.json$/i,'');
    const obj=qboNcdc113ReadJson_(f,findings);
    if(!obj)return;
    const meta=qboNcdc117EntityMeta_(manifest, expected, f);
    const raw=qboNcdc113ExtractCdc_(obj,expected,meta);
    raw.forEach(function(x,index){
      const op=x.deleted?'DELETE':'UPSERT';
      const sourceId='NATIVE_CDC|' + attempt.CdcRunId + '|' + x.entityType;
      const eventId=sourceId + '|OBS|' + index + '|' + x.entityId + '|' + op;
      const complete=x.deleted || !!x.entity;
      out.push({
        NativeCdcEventId:eventId,
        CdcRunId:attempt.CdcRunId,
        CdcAttemptId:attempt.CdcAttemptId,
        SourceId:sourceId,
        EntityRunId:attempt.CdcRunId + '|' + x.entityType,
        EntityType:x.entityType,
        EvidenceIndex:index,
        EntityId:x.entityId,
        Operation:op,
        QboStatus:x.qboStatus,
        DeletedFlag:x.deleted,
        QboSyncToken:x.syncToken,
        QboCreateTime:x.createTime,
        QboLastUpdatedTime:x.lastUpdatedTime,
        ObservedAt:x.requestCompletedAt || x.observedAt || attempt.RunCompletedAt,
        SourceChangeTime:x.lastUpdatedTime,
        SparseFlag:x.sparse,
        EvidenceFileId:f.getId(),
        EvidenceFileName:f.getName(),
        EvidenceHash:qboNcdc113Sha256_(f.getBlob().getBytes()),
        EvidenceHashType:'SHA-256',
        RequestStartedAt:x.requestStartedAt,
        RequestCompletedAt:x.requestCompletedAt,
        QboResponseTime:x.responseTime,
        RawEntityHash:x.entity?qboNcdc113Sha256Text_(JSON.stringify(x.entity)):'',
        EvidenceStatus:'VALID',
        EligibilityStatus:complete?'ELIGIBLE':'INELIGIBLE',
        EligibilityReason:x.deleted?'DELETE_TOMBSTONE':
          (complete?'COMPLETE_SOURCE_OBSERVATION':'INCOMPLETE_NON_DELETE_SOURCE_OBSERVATION'),
        AcquisitionClassification:attempt.AcquisitionClassification,
        EvidenceCreatedAt:qboNcdc117FileCreatedAt_(f),
        RegistrationMode:'HISTORICAL_BACKFILL',
        RegisteredAt:''
      });
    });
  });

  if (out.length !== Number(attempt.ReturnedEntityCount||0)) {
    findings.push({
      code:'COMMITTED_OBSERVATION_COUNT_MISMATCH',
      CdcRunId:attempt.CdcRunId,
      manifestReturnedEntityCount:Number(attempt.ReturnedEntityCount||0),
      parsedObservationCount:out.length
    });
  }
  return out;
}

function qboNcdc113ExtractCdc_(obj, expectedType, meta) {
  const out=[];
  const topTime=String(obj && obj.time || '');
  const cdc=obj && obj.CDCResponse;
  if(!Array.isArray(cdc))return out;
  cdc.forEach(function(block){
    const qrs=block && block.QueryResponse;
    if(!Array.isArray(qrs))return;
    qrs.forEach(function(qr){
      if(!qr||typeof qr!=='object')return;
      const qboStatus=String(qr.status||qr.Status||'');
      Object.keys(qr).forEach(function(k){
        if(['startPosition','maxResults','totalCount','status','Status'].indexOf(k)>=0)return;
        if(!Array.isArray(qr[k]))return;
        qr[k].forEach(function(entity){
          const et=k||expectedType;
          const id=String(entity && (entity.Id||entity.id)||'').trim();
          const entityStatus=String(entity && (entity.status||entity.Status)||'');
          const deleted=String(qboStatus).toLowerCase()==='deleted' ||
            entityStatus.toLowerCase()==='deleted' ||
            !!(entity && (entity.Deleted===true || entity.deleted===true));
          out.push({
            entityType:et, entityId:id, entity:entity||null, deleted:deleted,
            qboStatus:entityStatus || qboStatus,
            syncToken:String(entity && (entity.SyncToken||entity.syncToken)||''),
            createTime:String(entity && entity.MetaData && entity.MetaData.CreateTime||''),
            lastUpdatedTime:String(entity && entity.MetaData && entity.MetaData.LastUpdatedTime||''),
            sparse:!!(entity && entity.sparse===true),
            observedAt:topTime,
            requestStartedAt:String(meta && meta.requestStartedAt || ''),
            requestCompletedAt:String(meta && meta.requestCompletedAt || ''),
            responseTime:String(meta && meta.qboResponseTime || topTime || '')
          });
        });
      });
    });
  });
  return out;
}

function qboNcdc113EntityTypes_(v) {
  if(Array.isArray(v))return v.join(',');
  return String(v||'');
}
function qboNcdc113CompletedEntityCount_(m) {
  if(Array.isArray(m.entityTypesSucceeded)) return m.entityTypesSucceeded.length;
  if(m.completedEntityCount!=null)return Number(m.completedEntityCount)||0;
  return 0;
}
function qboNcdc113LegacyTsIso_(token) {
  const m=String(token||'').match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_(\d{3})$/);
  if(!m)return '';
  return m[1]+'-'+m[2]+'-'+m[3]+'T'+m[4]+':'+m[5]+':'+m[6]+'.'+m[7]+'Z';
}
function qboNcdc113Sha256_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes)
    .map(function(b){return ('0'+((b<0?b+256:b).toString(16))).slice(-2);}).join('');
}
function qboNcdc113Sha256Text_(s) {
  return qboNcdc113Sha256_(Utilities.newBlob(String(s),'application/json').getBytes());
}
function qboNcdc113DuplicateValues_(arr) {
  const n={},d={};
  arr.forEach(function(v){if(!v)return;n[v]=(n[v]||0)+1;if(n[v]>1)d[v]=true;});
  return Object.keys(d).sort();
}
function qboNcdc113Count_(rows,col) {
  const o={}; rows.forEach(function(r){const k=String(r[col]||'');o[k]=(o[k]||0)+1;}); return o;
}
function qboNcdc113AttemptSort_(a,b){return String(a.RunStartedAt).localeCompare(String(b.RunStartedAt));}
function qboNcdc113RunSort_(a,b){return String(a.RunStartedAt).localeCompare(String(b.RunStartedAt));}
function qboNcdc113ObservationSort_(a,b){
  return String(a.ObservedAt).localeCompare(String(b.ObservedAt)) ||
    String(a.EntityType).localeCompare(String(b.EntityType)) ||
    String(a.EntityId).localeCompare(String(b.EntityId));
}


function qboNcdc117EntityMeta_(manifest, entityType, file) {
  const rows=manifest && Array.isArray(manifest.entityEvidence) ? manifest.entityEvidence : [];
  const fileId=file.getId(), fileName=file.getName();
  for(let i=0;i<rows.length;i++){
    const m=rows[i]||{};
    if(String(m.evidenceFileId||'')===fileId) return m;
  }
  for(let i=0;i<rows.length;i++){
    const m=rows[i]||{};
    if(String(m.evidenceFileName||'')===fileName) return m;
  }
  for(let i=0;i<rows.length;i++){
    const m=rows[i]||{};
    if(String(m.entity||m.entityType||'')===String(entityType||'')) return m;
  }
  return {};
}

function qboNcdc117FileCreatedAt_(file) {
  try { return file.getDateCreated().toISOString(); } catch(ignore) { return ''; }
}

function qboNcdc117ModernIdentityGate_(observations, findings) {
  const C=QBO_NCDC_HIST_RECON_1_5_113;
  const candidate=observations.filter(function(r){
    return String(r.SourceId||'').split('|').length===4;
  });
  let existing=[];
  try {
    const ss=SpreadsheetApp.openById(C.STATE_CAPTURE_SPREADSHEET_ID);
    const sh=ss.getSheetByName(C.SHEET03);
    if(sh && sh.getLastRow()>=2){
      const v=sh.getRange(1,1,sh.getLastRow(),sh.getLastColumn()).getValues();
      const h=v[0].map(function(x){return String(x||'').trim();});
      const ix=h.indexOf('NativeCdcEventId');
      const sx=h.indexOf('SourceId');
      if(ix<0 || sx<0) throw new Error('03 required identity columns missing');
      existing=v.slice(1).filter(function(r){return String(r[ix]||'').trim()!=='';})
        .filter(function(r){return String(r[sx]||'').split('|').length===4;})
        .map(function(r){return String(r[ix]||'');});
    }
  } catch(e) {
    findings.push({code:'MODERN_IDENTITY_GATE_READ_ERROR',error:String(e)});
  }
  const c={}; candidate.forEach(function(r){c[String(r.NativeCdcEventId||'')]=true;});
  const e={}; existing.forEach(function(id){e[id]=true;});
  const candidateOnly=Object.keys(c).filter(function(id){return !e[id];});
  const existingOnly=Object.keys(e).filter(function(id){return !c[id];});
  const exact=Object.keys(c).filter(function(id){return e[id];}).length;
  const gate={
    candidateModernCount:candidate.length,
    existingModernCount:existing.length,
    exactEventIdentityMatchCount:exact,
    candidateOnlyCount:candidateOnly.length,
    existingOnlyCount:existingOnly.length,
    valid:candidate.length===61 && existing.length===61 && exact===61 &&
      candidateOnly.length===0 && existingOnly.length===0
  };
  if(!gate.valid) findings.push({
    code:'MODERN_EVENT_IDENTITY_GATE_FAILED',
    gate:gate,
    candidateOnly:candidateOnly,
    existingOnly:existingOnly
  });
  return gate;
}
