/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 4060_QBO_ObservationIndexLegacySheetShardMigration.js
 * Version     : 1.5.176
 * Purpose     : Controlled, bounded, resumable migration of the already-
 *               validated legacy 07_Observation_Index rows into immutable
 *               logical-07 Drive JSON shards.
 *
 * SCOPE:
 *   - Migrates ONLY the durable legacy-sheet checkpoint population.
 *   - Does NOT resume the historical 06 -> 07 backfill.
 *   - Does NOT delete/change legacy 07 rows.
 *   - Does NOT enable State Application.
 *
 * COMMIT:
 *   shard -> manifest -> lookup segment -> checkpoint.
 *   A deterministic file name + content hash makes retry reconciliation
 *   idempotent if execution stops between durable writes and checkpoint.
 */
const QBO_OBS_INDEX_LEGACY_SHARD_MIGRATION_V175_ = Object.freeze({
  VERSION:'1.5.175',
  STATE_KEY:'QBO_OBS_INDEX_LEGACY_SHARD_MIGRATION_V175_STATE',
  ROWS_PER_SHARD:2000,
  MAX_SHARDS_PER_EXECUTION:8,
  RUNTIME_BUDGET_MS:210000,
  CONTINUATION_HANDLER:'qboObservationIndexLegacyShardMigrationV175Continuation_',
  SHARD_SCHEMA:'QBO_OBSERVATION_INDEX_SHARD_V1',
  MANIFEST_SCHEMA:'QBO_OBSERVATION_INDEX_MANIFEST_V1',
  LOOKUP_SCHEMA:'QBO_OBSERVATION_INDEX_LOOKUP_SEGMENT_V1'
});

function startQboObservationIndexLegacyShardMigrationV175() {
  const existing=qboObsIndexV175LoadState_();
  if (existing && existing.status==='RUNNING') {
    throw new Error('OBS_INDEX_V175_ALREADY_RUNNING runId='+existing.runId);
  }

  const pre=preflightQboObservationIndexShardMigrationV173();
  if (!pre.valid) throw new Error('OBS_INDEX_V175_PREFLIGHT_INVALID '+JSON.stringify(pre.findings||[]));
  const storage=validateQboObservationIndexShardStorageV174();
  if (!storage.valid) throw new Error('OBS_INDEX_V175_STORAGE_INVALID '+JSON.stringify(storage.findings||[]));

  const target=Number(pre.migrationBoundary.alreadyValidatedObservationCount||0);
  if (!(target>0)) throw new Error('OBS_INDEX_V175_INVALID_TARGET '+target);

  const state={
    version:'1.5.175',
    status:'RUNNING',
    runId:'OBS_INDEX_SHARD_MIGRATION_V175|'+Utilities.getUuid(),
    sourceSheet:QBO_OBSERVATION_INDEX_CONTRACT_.SHEET_NAME,
    targetObservationCount:target,
    rowCursor:0,
    migratedObservationCount:0,
    shardCount:0,
    manifestCount:0,
    lookupSegmentCount:0,
    reconciledShardCount:0,
    startedAt:new Date().toISOString(),
    lastProgressAt:new Date().toISOString(),
    completedAt:'',
    error:''
  };
  qboObsIndexV175SaveState_(state);
  qboObsIndexV175DeleteContinuations_();
  console.log('[OBSERVATION INDEX SHARD MIGRATION V175] | STARTED | '+JSON.stringify(state));
  return qboObservationIndexLegacyShardMigrationV175Worker_();
}

function qboObservationIndexLegacyShardMigrationV175Continuation_() {
  return qboObservationIndexLegacyShardMigrationV175Worker_();
}

function recoverQboObservationIndexLegacyShardMigrationV175() {
  const state=qboObsIndexV175LoadState_();
  if (!state) throw new Error('OBS_INDEX_V175_STATE_MISSING');
  if (state.status==='COMPLETED') return state;
  state.status='RUNNING';
  state.error='';
  state.lastProgressAt=new Date().toISOString();
  qboObsIndexV175SaveState_(state);
  qboObsIndexV175DeleteContinuations_();
  qboObsIndexV175ScheduleContinuation_();
  console.log('[OBSERVATION INDEX SHARD MIGRATION V175] | RECOVERED | '+JSON.stringify(state));
  return state;
}

function qboObservationIndexLegacyShardMigrationV175Worker_() {
  const cfg=QBO_OBS_INDEX_LEGACY_SHARD_MIGRATION_V175_;
  const started=Date.now();
  let state=qboObsIndexV175LoadState_();
  if (!state || state.status!=='RUNNING') return state;

  try {
    const ss=getQboStateCaptureSpreadsheet_();
    const sh=ss.getSheetByName(QBO_OBSERVATION_INDEX_CONTRACT_.SHEET_NAME);
    if (!sh) throw new Error('OBS_INDEX_V175_SOURCE_SHEET_MISSING');

    const headers=QBO_OBSERVATION_INDEX_CONTRACT_.HEADERS.slice();
    const schema=validateQboObservationIndexPhysicalSchemaV169_(sh,headers);
    // v1.5.169's internal schema helper is a findings-oriented validator.
    // An empty findings array is success even when the helper does not expose
    // a top-level `valid` boolean. Do not convert undefined `valid` to failure.
    const schemaFindings=(schema && Array.isArray(schema.findings)) ? schema.findings : [];
    if (schemaFindings.length>0) {
      throw new Error('OBS_INDEX_V175_SOURCE_SCHEMA_INVALID '+JSON.stringify(schemaFindings));
    }

    const physicalRows=Math.max(0,sh.getLastRow()-1);
    if (physicalRows!==Number(state.targetObservationCount)) {
      throw new Error('OBS_INDEX_V175_SOURCE_ROW_COUNT_CHANGED physical='+physicalRows+
        ' target='+state.targetObservationCount);
    }

    const folders=qboObsIndexV175ResolveFolders_();
    let shardsThisExecution=0;

    while (state.rowCursor<state.targetObservationCount &&
           shardsThisExecution<cfg.MAX_SHARDS_PER_EXECUTION &&
           (Date.now()-started)<cfg.RUNTIME_BUDGET_MS) {
      const startCursor=Number(state.rowCursor);
      const count=Math.min(cfg.ROWS_PER_SHARD,state.targetObservationCount-startCursor);
      const values=qboObsIndexV175SpreadsheetRetry_(function(){
        return sh.getRange(startCursor+2,1,count,headers.length).getValues();
      });

      const records=values.map(function(row){
        const o={};
        for(let i=0;i<headers.length;i++) o[headers[i]]=qboObsIndexV175Cell_(row[i]);
        return o;
      });

      qboObsIndexV175ValidateRecords_(records,startCursor);
      const result=qboObsIndexV175CommitShard_(folders,state.runId,startCursor,records);

      state.rowCursor=startCursor+count;
      state.migratedObservationCount=state.rowCursor;
      state.shardCount=Number(state.shardCount||0)+1;
      state.manifestCount=Number(state.manifestCount||0)+1;
      state.lookupSegmentCount=Number(state.lookupSegmentCount||0)+1;
      if(result.reconciled) state.reconciledShardCount=Number(state.reconciledShardCount||0)+1;
      state.lastProgressAt=new Date().toISOString();
      qboObsIndexV175SaveState_(state);
      shardsThisExecution++;
    }

    if(state.rowCursor>=state.targetObservationCount){
      const final=qboObsIndexV175FinalReconciliation_(state,folders);
      if(!final.valid) throw new Error('OBS_INDEX_V175_FINAL_RECONCILIATION_FAILED '+JSON.stringify(final.findings));
      state.status='COMPLETED';
      state.completedAt=new Date().toISOString();
      state.lastProgressAt=state.completedAt;
      qboObsIndexV175SaveState_(state);
      qboObsIndexV175DeleteContinuations_();
      console.log('[OBSERVATION INDEX SHARD MIGRATION V175] | COMPLETED | '+JSON.stringify(state));
      console.log('[OBSERVATION INDEX SHARD MIGRATION V175] | RECONCILIATION | '+JSON.stringify(final));
      return state;
    }

    qboObsIndexV175DeleteContinuations_();
    qboObsIndexV175ScheduleContinuation_();
    console.log('[OBSERVATION INDEX SHARD MIGRATION V175] | PROGRESS | '+JSON.stringify(state));
    return state;
  } catch(err) {
    state.status='FAILED';
    state.error=String(err&&err.message?err.message:err);
    state.lastProgressAt=new Date().toISOString();
    qboObsIndexV175SaveState_(state);
    qboObsIndexV175DeleteContinuations_();
    console.error('[OBSERVATION INDEX SHARD MIGRATION V175] | FAILED | '+JSON.stringify(state));
    throw err;
  }
}

function qboObsIndexV175CommitShard_(folders,runId,startCursor,records){
  const end=startCursor+records.length;
  const shardName='qbo_observation_index_shard_'+qboObsIndexV175Pad_(startCursor,9)+'_'+qboObsIndexV175Pad_(end,9)+'.json';
  const manifestName=shardName.replace('.json','.manifest.json');
  const lookupName=shardName.replace('.json','.lookup.json');

  const observationIds=records.map(function(r){return String(r.ObservationId||'');});
  const stableBody={
    schemaVersion:QBO_OBS_INDEX_LEGACY_SHARD_MIGRATION_V175_.SHARD_SCHEMA,
    migrationRunId:runId,
    sourceKind:'LEGACY_07_SHEET_VALIDATED_CHECKPOINT',
    sourceSheet:QBO_OBSERVATION_INDEX_CONTRACT_.SHEET_NAME,
    recordCursorStart:startCursor,
    recordCursorEndExclusive:end,
    observationCount:records.length,
    observationIds:observationIds,
    records:records
  };
  const shardHash=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(stableBody));
  const envelope={stableBody:stableBody,shardHash:shardHash};

  const shardFile=qboObsIndexV175CreateOrVerifyJson_(
    folders.shards,shardName,envelope,function(existing){
      return existing && existing.shardHash===shardHash &&
        existing.stableBody &&
        Number(existing.stableBody.recordCursorStart)===startCursor &&
        Number(existing.stableBody.recordCursorEndExclusive)===end;
    });

  const entityMap={};
  records.forEach(function(r,i){
    const key=String(r.EntityType||'')+'|'+String(r.EntityId||'');
    if(!entityMap[key]) entityMap[key]={entityType:String(r.EntityType||''),entityId:String(r.EntityId||''),ordinals:[],minObservedAt:String(r.ObservedAt||''),maxObservedAt:String(r.ObservedAt||'')};
    const e=entityMap[key];
    e.ordinals.push(i);
    const oa=String(r.ObservedAt||'');
    if(oa<e.minObservedAt) e.minObservedAt=oa;
    if(oa>e.maxObservedAt) e.maxObservedAt=oa;
  });
  const entries=Object.keys(entityMap).sort().map(function(k){return entityMap[k];});

  const lookupStable={
    schemaVersion:QBO_OBS_INDEX_LEGACY_SHARD_MIGRATION_V175_.LOOKUP_SCHEMA,
    shardFileId:shardFile.file.getId(),
    shardFileName:shardName,
    shardHash:shardHash,
    entityCount:entries.length,
    entries:entries
  };
  const lookupHash=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(lookupStable));
  const lookupEnvelope={stableBody:lookupStable,lookupHash:lookupHash};
  const lookupFile=qboObsIndexV175CreateOrVerifyJson_(
    folders.lookup,lookupName,lookupEnvelope,function(existing){
      return existing && existing.lookupHash===lookupHash &&
        existing.stableBody && existing.stableBody.shardHash===shardHash;
    });

  const manifestStable={
    schemaVersion:QBO_OBS_INDEX_LEGACY_SHARD_MIGRATION_V175_.MANIFEST_SCHEMA,
    migrationRunId:runId,
    recordCursorStart:startCursor,
    recordCursorEndExclusive:end,
    observationCount:records.length,
    firstObservationId:observationIds[0]||'',
    lastObservationId:observationIds[observationIds.length-1]||'',
    shardFileId:shardFile.file.getId(),
    shardFileName:shardName,
    shardHash:shardHash,
    lookupFileId:lookupFile.file.getId(),
    lookupFileName:lookupName,
    lookupHash:lookupHash,
    entityCount:entries.length
  };
  const manifestHash=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(manifestStable));
  const manifestEnvelope={stableBody:manifestStable,manifestHash:manifestHash};
  const manifestFile=qboObsIndexV175CreateOrVerifyJson_(
    folders.manifests,manifestName,manifestEnvelope,function(existing){
      return existing && existing.manifestHash===manifestHash &&
        existing.stableBody && existing.stableBody.shardHash===shardHash &&
        existing.stableBody.lookupHash===lookupHash;
    });

  return {
    reconciled:shardFile.existed||lookupFile.existed||manifestFile.existed,
    shardFileId:shardFile.file.getId(),
    manifestFileId:manifestFile.file.getId(),
    lookupFileId:lookupFile.file.getId()
  };
}

function qboObsIndexV175CreateOrVerifyJson_(folder,name,obj,verify){
  // v1.5.184: Drive service failures are retryable; identity/hash conflicts are not.
  // Every attempt re-lists by deterministic name before create. This handles an
  // ambiguous createFile() service failure without blindly creating a duplicate.
  let last=null;
  for(let attempt=1;attempt<=QBO_OBS_INDEX_DRIVE_RETRY_V184_.MAX_ATTEMPTS;attempt++){
    try{
      const it=folder.getFilesByName(name);
      if(it.hasNext()){
        const file=it.next();
        if(it.hasNext()) throw new Error('OBS_INDEX_V175_DUPLICATE_FILE name='+name);
        const existing=JSON.parse(file.getBlob().getDataAsString('UTF-8'));
        if(!verify(existing)) throw new Error('OBS_INDEX_V175_EXISTING_FILE_CONFLICT name='+name);
        return {file:file,existed:true};
      }
      const blob=Utilities.newBlob(JSON.stringify(obj),'application/json',name);
      return {file:folder.createFile(blob),existed:false};
    }catch(e){
      if(!qboObsIndexV184IsTransientDriveError_(e)) throw e;
      last=e;
      if(attempt<QBO_OBS_INDEX_DRIVE_RETRY_V184_.MAX_ATTEMPTS)
        Utilities.sleep(QBO_OBS_INDEX_DRIVE_RETRY_V184_.BASE_DELAY_MS*Math.pow(2,attempt-1));
    }
  }
  throw last;
}

const QBO_OBS_INDEX_DRIVE_RETRY_V184_=Object.freeze({
  MAX_ATTEMPTS:4,
  BASE_DELAY_MS:1000
});
function qboObsIndexV184IsTransientDriveError_(e){
  return /Service error:\s*Drive/i.test(String(e&&e.message?e.message:e));
}
function qboObsIndexV184DriveReadRetry_(fn){
  let last=null;
  for(let attempt=1;attempt<=QBO_OBS_INDEX_DRIVE_RETRY_V184_.MAX_ATTEMPTS;attempt++){
    try{return fn();}
    catch(e){
      if(!qboObsIndexV184IsTransientDriveError_(e)) throw e;
      last=e;
      if(attempt<QBO_OBS_INDEX_DRIVE_RETRY_V184_.MAX_ATTEMPTS)
        Utilities.sleep(QBO_OBS_INDEX_DRIVE_RETRY_V184_.BASE_DELAY_MS*Math.pow(2,attempt-1));
    }
  }
  throw last;
}

function qboObsIndexV175ValidateRecords_(records,startCursor){
  const seen={};
  records.forEach(function(r,i){
    const row=startCursor+i;
    ['ObservationId','EntityType','EntityId','ObservedAt','PayloadFileId','PayloadShardHash'].forEach(function(k){
      if(!String(r[k]||'')) throw new Error('OBS_INDEX_V175_REQUIRED_FIELD_MISSING field='+k+' cursor='+row);
    });
    const id=String(r.ObservationId);
    if(seen[id]) throw new Error('OBS_INDEX_V175_DUPLICATE_OBSERVATION_ID_WITHIN_SHARD id='+id);
    seen[id]=true;
  });
}

function qboObsIndexV175FinalReconciliation_(state,folders){
  const findings=[];
  const manifests=qboObsIndexV175ListJsonFiles_(folders.manifests,'.manifest.json');
  let count=0;
  const ids={};
  manifests.forEach(function(file){
    const m=JSON.parse(file.getBlob().getDataAsString('UTF-8'));
    const b=m.stableBody||{};
    count+=Number(b.observationCount||0);
    const sf=DriveApp.getFileById(String(b.shardFileId||''));
    const s=JSON.parse(sf.getBlob().getDataAsString('UTF-8'));
    const actual=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(s.stableBody));
    if(actual!==String(b.shardHash||'')) findings.push('SHARD_HASH_MISMATCH manifest='+file.getName());
    (s.stableBody.observationIds||[]).forEach(function(id){
      id=String(id||'');
      if(ids[id]) findings.push('DUPLICATE_OBSERVATION_ID '+id);
      ids[id]=true;
    });
  });
  if(count!==Number(state.targetObservationCount)) findings.push('MANIFEST_OBSERVATION_COUNT_MISMATCH actual='+count+' expected='+state.targetObservationCount);
  const distinct=Object.keys(ids).length;
  if(distinct!==Number(state.targetObservationCount)) findings.push('DISTINCT_OBSERVATION_COUNT_MISMATCH actual='+distinct+' expected='+state.targetObservationCount);
  return {
    version:'1.5.175',
    operation:'OBSERVATION_INDEX_LEGACY_SHARD_FINAL_RECONCILIATION',
    manifestFileCount:manifests.length,
    manifestObservationCount:count,
    distinctObservationIdCount:distinct,
    expectedObservationCount:Number(state.targetObservationCount),
    legacy07RowsPreserved:true,
    legacy07AuthorityRetired:false,
    historicalBackfillResumed:false,
    findingCount:findings.length,
    findings:findings,
    valid:findings.length===0
  };
}

function qboObsIndexV175ResolveFolders_(){
  const c=QBO_OBSERVATION_INDEX_PHYSICAL_V173_;
  const parent=qboResolveGovernedFolderAsset_(c.GOVERNED_PARENT_ASSET_KEY,c.GOVERNED_PARENT_EXPECTED_TYPE,c.ENVIRONMENT);
  return {
    shards:qboObservationIndexV174RequireSingleChildFolder_(parent,c.SHARD_FOLDER_NAME,false).folder,
    manifests:qboObservationIndexV174RequireSingleChildFolder_(parent,c.MANIFEST_FOLDER_NAME,false).folder,
    lookup:qboObservationIndexV174RequireSingleChildFolder_(parent,c.LOOKUP_FOLDER_NAME,false).folder
  };
}

function qboObsIndexV175ListJsonFiles_(folder,suffix){
  const out=[],it=folder.getFiles();
  while(it.hasNext()){
    const f=it.next();
    if(String(f.getName()).slice(-suffix.length)===suffix) out.push(f);
  }
  return out;
}

function qboObsIndexV175Cell_(v){
  if(v instanceof Date) return v.toISOString();
  if(v===null||v===undefined) return '';
  return v;
}
function qboObsIndexV175Pad_(n,w){return String(n).padStart(w,'0');}
function qboObsIndexV175LoadState_(){
  const s=PropertiesService.getScriptProperties().getProperty(QBO_OBS_INDEX_LEGACY_SHARD_MIGRATION_V175_.STATE_KEY);
  return s?JSON.parse(s):null;
}
function qboObsIndexV175SaveState_(s){
  PropertiesService.getScriptProperties().setProperty(QBO_OBS_INDEX_LEGACY_SHARD_MIGRATION_V175_.STATE_KEY,JSON.stringify(s));
}
function qboObsIndexV175DeleteContinuations_(){
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction()===QBO_OBS_INDEX_LEGACY_SHARD_MIGRATION_V175_.CONTINUATION_HANDLER) ScriptApp.deleteTrigger(t);
  });
}
function qboObsIndexV175ScheduleContinuation_(){
  ScriptApp.newTrigger(QBO_OBS_INDEX_LEGACY_SHARD_MIGRATION_V175_.CONTINUATION_HANDLER).timeBased().after(60000).create();
}
function qboObsIndexV175SpreadsheetRetry_(fn){
  let last=null;
  for(let i=0;i<3;i++){
    try{return fn();}catch(err){
      last=err;
      const msg=String(err&&err.message?err.message:err);
      if(msg.indexOf('Service Spreadsheets failed')<0 && msg.indexOf('Internal error')<0) throw err;
      Utilities.sleep(1000*(i+1));
    }
  }
  throw last;
}
