/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 4080_QBO_StateApplicationV2PhaseGDispositionManifest.js
 * Version     : 1.5.214
 * Purpose     : Phase G controlled-disposition evidence preservation. Creates
 *               an immutable manifest of the exact legacy V2 output population
 *               and abandoned rebuild/migration Script Properties before any
 *               V2 rows or legacy state may be cleared.
 *
 * Safety contract:
 *   - Does NOT delete, clear, rewrite, or append State Application datasets.
 *   - Requires exact Final Historical 07 certification authority.
 *   - Requires no legacy Canonical V2 worker/watchdog trigger.
 *   - Requires the exact V2 population certified by v1.5.213 preflight.
 *   - Writes only a dedicated evidence spreadsheet plus one bounded pointer
 *     Script Property describing that preserved manifest.
 *   - Legacy module 95 remains NOT AUTHORIZED.
 * ============================================================================
 */
const QBO_PHASE_G_DISPOSITION_V1214_=Object.freeze({
  VERSION:'1.5.214',
  STATE_KEY:'QBO_PHASE_G_V1214_MANIFEST_STATE',
  HIST07_KEY:'QBO_FINAL_HIST07_V202_STATE',
  REQUIRED_HIST07_STATUS:'COMPLETE_HISTORICAL_07_TRUST_CERTIFIED',
  REQUIRED_HIST07_RUN:'FINAL_HIST07_V202|2a2db396-f66b-4d89-a902-22f4c9149d36',
  EXPECTED_HIST07_LOGICAL:734858,
  LEGACY_HANDLERS:Object.freeze(['runNextQboCanonicalV2Rebuild','watchQboCanonicalV2Rebuild']),
  LEGACY_REBUILD_KEYS:Object.freeze([
    'QBO_CANONICAL_V2_REBUILD_RUN_ID','QBO_CANONICAL_V2_REBUILD_STATUS',
    'QBO_CANONICAL_V2_REBUILD_EXPORT_INDEX','QBO_CANONICAL_V2_REBUILD_SOURCE_INDEX',
    'QBO_CANONICAL_V2_REBUILD_STARTED_AT','QBO_CANONICAL_V2_REBUILD_LAST_PROGRESS_AT',
    'QBO_CANONICAL_V2_REBUILD_LAST_HEARTBEAT_AT','QBO_CANONICAL_V2_REBUILD_WORKER_LEASE_TOKEN',
    'QBO_CANONICAL_V2_REBUILD_WORKER_LEASE_EXPIRES_AT','QBO_CANONICAL_V2_REBUILD_LAST_ERROR'
  ]),
  EXPECTED:Object.freeze({
    '10_Snapshot_Records':Object.freeze({versionHeader:'SnapshotRecordVersion',version:'SNAPSHOT_RECORD_V2',idHeader:'SnapshotRecordId',count:22493,fingerprint:'c75319e244fc20ca21bed960441aeccb3f33da3f12fd01cab2765dc8531878d3'}),
    '11_Change_Records':Object.freeze({versionHeader:'ChangeRecordVersion',version:'CHANGE_RECORD_V2',idHeader:'ChangeRecordId',count:2255,fingerprint:'e92e93b42c546e29902eff51b02c9d29a068b07bf5ed7f6a3874ffbdd4ec34ff'}),
    '12_Change_Detail':Object.freeze({versionHeader:'ChangeDetailVersion',version:'CHANGE_DETAIL_V2',idHeader:'ChangeDetailId',count:7210,fingerprint:'37595a989b87220c3449726dcecc3970c44a7d98fcd922b53ad9cca5c3217ecd'})
  })
});

function preserveQboStateApplicationV2PhaseGDispositionManifestV1214(){
  const C=QBO_PHASE_G_DISPOSITION_V1214_, props=PropertiesService.getScriptProperties();
  const prior=qboPhaseG1214LoadState_(props);
  if(prior&&prior.status==='MANIFEST_PRESERVED'){
    console.log('[PHASE G DISPOSITION V1214] | ALREADY_PRESERVED | '+JSON.stringify(prior));
    return prior;
  }
  const hist=qboPhaseG1214RequireHist07_(props);
  qboPhaseG1214RequireNoLegacyTriggers_();
  const stateSs=getQboStateCaptureSpreadsheet_();
  const populations=qboPhaseG1214ReadExactPopulations_(stateSs);
  const legacyProps=qboPhaseG1214LegacyProperties_(props);
  const createdAt=new Date().toISOString();
  const manifestSs=SpreadsheetApp.create('QBO Phase G Legacy V2 Disposition Manifest '+createdAt.replace(/[:.]/g,'-'));
  const manifestFile=DriveApp.getFileById(manifestSs.getId());
  const stateFile=DriveApp.getFileById(stateSs.getId()), parents=stateFile.getParents();
  if(parents.hasNext()) manifestFile.moveTo(parents.next());

  const first=manifestSs.getSheets()[0]; first.setName('00_Summary');
  qboPhaseG1214WriteRows_(first,[['Key','Value'],
    ['Version',C.VERSION],['Status','MANIFEST_PRESERVED'],['CreatedAt',createdAt],
    ['Historical07RunId',hist.runId],['Historical07LogicalObservationCount',hist.logicalObservationCount],
    ['StateApplicationSpreadsheetId',stateSs.getId()],['LegacyModule95Authorized','FALSE'],
    ['ReplayAuthority','GOVERNED_LOGICAL_07_OBSERVATION_POPULATION_ORDERED_BY_OBSERVED_AT'],
    ['TotalLegacyV2Rows',populations.totalCount]
  ]);

  const propSh=manifestSs.insertSheet('01_Legacy_Properties');
  qboPhaseG1214WriteRows_(propSh,[['PropertyKey','PropertyValue']].concat(legacyProps.map(function(x){return [x.key,x.value];})));

  const sheetResults={};
  Object.keys(C.EXPECTED).forEach(function(sheetName){
    const safe=sheetName.substring(0,30);
    const sh=manifestSs.insertSheet('V2_'+safe.substring(3));
    const rows=[['SourceSheet','SourceRowNumber','RecordId','RowHash']];
    populations.sheets[sheetName].records.forEach(function(r){rows.push([sheetName,r.rowNumber,r.id,r.rowHash]);});
    qboPhaseG1214WriteRows_(sh,rows);
    sheetResults[sheetName]={count:populations.sheets[sheetName].count,idFingerprint:populations.sheets[sheetName].idFingerprint,rowFingerprint:populations.sheets[sheetName].rowFingerprint};
  });

  const tokenMaterial={version:C.VERSION,historical07RunId:hist.runId,historical07LogicalObservationCount:hist.logicalObservationCount,stateApplicationSpreadsheetId:stateSs.getId(),legacyProperties:legacyProps,sheets:sheetResults,totalLegacyV2Rows:populations.totalCount};
  const verificationToken=qboPhaseG1214Sha256_(qboPhaseG1214Stable_(tokenMaterial));
  first.appendRow(['VerificationToken',verificationToken]);
  first.appendRow(['DispositionAuthorized','FALSE']);
  first.appendRow(['NextAction','VERIFY_MANIFEST_THEN_CONTROLLED_CLEAR_INITIALIZE']);

  const result={version:C.VERSION,status:'MANIFEST_PRESERVED',createdAt:createdAt,manifestSpreadsheetId:manifestSs.getId(),verificationToken:verificationToken,historical07RunId:hist.runId,stateApplicationSpreadsheetId:stateSs.getId(),totalLegacyV2Rows:populations.totalCount,sheets:sheetResults,legacyPropertyCount:legacyProps.length,legacyModule95Authorized:false,dispositionAuthorized:false,nextAction:'VERIFY_MANIFEST_THEN_CONTROLLED_CLEAR_INITIALIZE'};
  props.setProperty(C.STATE_KEY,JSON.stringify(result));
  console.log('[PHASE G DISPOSITION V1214] | MANIFEST_PRESERVED | '+JSON.stringify(result));
  return result;
}

function qboPhaseG1214RequireHist07_(props){
  const C=QBO_PHASE_G_DISPOSITION_V1214_; let s=null;
  try{s=JSON.parse(props.getProperty(C.HIST07_KEY)||'null');}catch(e){}
  if(!s||String(s.status)!==C.REQUIRED_HIST07_STATUS||String(s.runId)!==C.REQUIRED_HIST07_RUN||Number(s.logicalObservationCount)!==C.EXPECTED_HIST07_LOGICAL||Number(s.identityMismatchCount)!==0||!(s.webhookGate&&s.webhookGate.passed===true)||!(s.cdcGate&&s.cdcGate.passed===true)) throw new Error('PHASE_G_V1214_HISTORICAL_07_AUTHORITY_NOT_EXACT');
  return {runId:String(s.runId),logicalObservationCount:Number(s.logicalObservationCount),completedAt:String(s.completedAt||'')};
}
function qboPhaseG1214RequireNoLegacyTriggers_(){
  const handlers=QBO_PHASE_G_DISPOSITION_V1214_.LEGACY_HANDLERS;
  const found=ScriptApp.getProjectTriggers().filter(function(t){return handlers.indexOf(String(t.getHandlerFunction()||''))>=0;});
  if(found.length) throw new Error('PHASE_G_V1214_LEGACY_TRIGGER_ACTIVE count='+found.length);
}
function qboPhaseG1214LegacyProperties_(props){
  const C=QBO_PHASE_G_DISPOSITION_V1214_, keys=C.LEGACY_REBUILD_KEYS.slice();
  props.getKeys().forEach(function(k){if(String(k).indexOf('QBO_CANONICAL_MIGRATION_CURSOR_V1|')===0)keys.push(String(k));});
  keys.sort(); return keys.map(function(k){const v=props.getProperty(k);return {key:k,value:v===null?'':String(v)};});
}
function qboPhaseG1214ReadExactPopulations_(ss){
  const C=QBO_PHASE_G_DISPOSITION_V1214_, out={totalCount:0,sheets:{}};
  Object.keys(C.EXPECTED).forEach(function(name){
    const spec=C.EXPECTED[name], sh=ss.getSheetByName(name); if(!sh)throw new Error('PHASE_G_V1214_SHEET_MISSING '+name);
    const lr=sh.getLastRow(),lc=sh.getLastColumn(),vals=sh.getRange(1,1,lr,lc).getValues(),headers=vals[0].map(function(v){return String(v||'').trim();});
    const vi=headers.indexOf(spec.versionHeader),ii=headers.indexOf(spec.idHeader); if(vi<0||ii<0)throw new Error('PHASE_G_V1214_HEADER_MISSING '+name);
    const records=[];
    for(let r=1;r<vals.length;r++)if(String(vals[r][vi]||'')===spec.version){const id=String(vals[r][ii]||'');records.push({rowNumber:r+1,id:id,rowHash:qboPhaseG1214Sha256_(qboPhaseG1214Stable_(vals[r]))});}
    const ids=records.map(function(x){return x.id;}).sort(), fp=qboPhaseG1214Sha256_(ids.join('\n'));
    if(records.length!==spec.count||fp!==spec.fingerprint)throw new Error('PHASE_G_V1214_POPULATION_DRIFT sheet='+name+' count='+records.length+' fingerprint='+fp);
    const rowFp=qboPhaseG1214Sha256_(records.map(function(x){return x.rowNumber+'|'+x.id+'|'+x.rowHash;}).join('\n'));
    out.sheets[name]={count:records.length,idFingerprint:fp,rowFingerprint:rowFp,records:records}; out.totalCount+=records.length;
  });
  if(out.totalCount!==31958)throw new Error('PHASE_G_V1214_TOTAL_V2_COUNT '+out.totalCount);
  return out;
}
function qboPhaseG1214WriteRows_(sh,rows){if(!rows.length)return;sh.getRange(1,1,rows.length,rows[0].length).setValues(rows);sh.setFrozenRows(1);}
function qboPhaseG1214Stable_(v){
  if(v===null||v===undefined)return 'null';
  if(v instanceof Date)return JSON.stringify(v.toISOString());
  if(Array.isArray(v))return '['+v.map(qboPhaseG1214Stable_).join(',')+']';
  if(typeof v==='object'){const ks=Object.keys(v).sort();return '{'+ks.map(function(k){return JSON.stringify(k)+':'+qboPhaseG1214Stable_(v[k]);}).join(',')+'}';}
  return JSON.stringify(v);
}
function qboPhaseG1214Sha256_(v){const b=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(v||''),Utilities.Charset.UTF_8);return b.map(function(x){return('0'+((x+256)%256).toString(16)).slice(-2);}).join('');}
function qboPhaseG1214LoadState_(props){try{return JSON.parse(props.getProperty(QBO_PHASE_G_DISPOSITION_V1214_.STATE_KEY)||'null');}catch(e){return null;}}
