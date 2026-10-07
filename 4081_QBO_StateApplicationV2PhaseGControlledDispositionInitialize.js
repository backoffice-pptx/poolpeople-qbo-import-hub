/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 4081_QBO_StateApplicationV2PhaseGControlledDispositionInitialize.js
 * Version     : 1.5.216
 * Purpose     : Verify the v1.5.214 immutable legacy-V2 disposition manifest,
 *               clear only legacy V2 rows with resumable per-sheet checkpoints,
 *               retire abandoned legacy rebuild/migration properties, and
 *               initialize a NEW Phase G replay run. Replay remains disabled.
 * ============================================================================
 */
const QBO_PHASE_G_INIT_V1215_=Object.freeze({
  VERSION:'1.5.216',
  HIST07_KEY:'QBO_FINAL_HIST07_V202_STATE',
  REQUIRED_HIST07_STATUS:'COMPLETE_HISTORICAL_07_TRUST_CERTIFIED',
  REQUIRED_HIST07_RUN:'FINAL_HIST07_V202|2a2db396-f66b-4d89-a902-22f4c9149d36',
  EXPECTED_HIST07_LOGICAL:734858,
  MANIFEST_STATE_KEY:'QBO_PHASE_G_V1214_MANIFEST_STATE',
  MANIFEST_SPREADSHEET_ID:'1iurUV4Rxr0_yF2VolUUicQ2tZRZHY202YPNjmIuulgQ',
  MANIFEST_TOKEN:'01487f322d1fcba00a7f761f14ae908a958e06c7fa4a514fce6b38a3544e2e54',
  DISPOSITION_STATE_KEY:'QBO_PHASE_G_V1215_DISPOSITION_STATE',
  REPLAY_STATE_KEY:'QBO_PHASE_G_V1215_REPLAY_STATE',
  LEGACY_HANDLERS:Object.freeze(['runNextQboCanonicalV2Rebuild','watchQboCanonicalV2Rebuild']),
  LEGACY_REBUILD_KEYS:Object.freeze([
    'QBO_CANONICAL_V2_REBUILD_RUN_ID','QBO_CANONICAL_V2_REBUILD_STATUS',
    'QBO_CANONICAL_V2_REBUILD_EXPORT_INDEX','QBO_CANONICAL_V2_REBUILD_SOURCE_INDEX',
    'QBO_CANONICAL_V2_REBUILD_STARTED_AT','QBO_CANONICAL_V2_REBUILD_LAST_PROGRESS_AT',
    'QBO_CANONICAL_V2_REBUILD_LAST_HEARTBEAT_AT','QBO_CANONICAL_V2_REBUILD_WORKER_LEASE_TOKEN',
    'QBO_CANONICAL_V2_REBUILD_WORKER_LEASE_EXPIRES_AT','QBO_CANONICAL_V2_REBUILD_LAST_ERROR'
  ]),
  SHEETS:Object.freeze({
    '10_Snapshot_Records':Object.freeze({versionHeader:'SnapshotRecordVersion',version:'SNAPSHOT_RECORD_V2',idHeader:'SnapshotRecordId',count:22493,idFingerprint:'c75319e244fc20ca21bed960441aeccb3f33da3f12fd01cab2765dc8531878d3',rowFingerprint:'ee539c973e2dde942deec594478a718404dcedc0620a99a6906e16561ebef9b1'}),
    '11_Change_Records':Object.freeze({versionHeader:'ChangeRecordVersion',version:'CHANGE_RECORD_V2',idHeader:'ChangeRecordId',count:2255,idFingerprint:'e92e93b42c546e29902eff51b02c9d29a068b07bf5ed7f6a3874ffbdd4ec34ff',rowFingerprint:'9d9dc4ab91b2860f2675e23eee974788271fe3ed30ef900d2a95ff50a104e54b'}),
    '12_Change_Detail':Object.freeze({versionHeader:'ChangeDetailVersion',version:'CHANGE_DETAIL_V2',idHeader:'ChangeDetailId',count:7210,idFingerprint:'37595a989b87220c3449726dcecc3970c44a7d98fcd922b53ad9cca5c3217ecd',rowFingerprint:'40852cdf574a0b141012f90176c6138f26950da32133e70e1f8d6ce1d0862b46'})
  })
});

function controlledDisposeInitializeQboStateApplicationV2PhaseGV1215(){
  const C=QBO_PHASE_G_INIT_V1215_, props=PropertiesService.getScriptProperties();
  qboPhaseG1215RequireHist07_(props); qboPhaseG1215RequireNoLegacyTriggers_(); qboPhaseG1215VerifyManifest_(props);
  let d=qboPhaseG1215Json_(props.getProperty(C.DISPOSITION_STATE_KEY));
  const priorReplay=qboPhaseG1215Json_(props.getProperty(C.REPLAY_STATE_KEY));
  if(priorReplay&&priorReplay.status==='INITIALIZED_REPLAY_DISABLED'){
    qboPhaseG1215VerifyAllCleared_(getQboStateCaptureSpreadsheet_());
    console.log('[PHASE G INIT V1215] | ALREADY_INITIALIZED | '+JSON.stringify(priorReplay)); return priorReplay;
  }
  if(!d){
    const ss=getQboStateCaptureSpreadsheet_(); qboPhaseG1215VerifyAllExact_(ss);
    d={version:C.VERSION,status:'DISPOSING',startedAt:new Date().toISOString(),manifestSpreadsheetId:C.MANIFEST_SPREADSHEET_ID,verificationToken:C.MANIFEST_TOKEN,historical07RunId:C.REQUIRED_HIST07_RUN,sheets:{}};
    Object.keys(C.SHEETS).forEach(function(n){d.sheets[n]='PENDING';});
    props.setProperty(C.DISPOSITION_STATE_KEY,JSON.stringify(d));
  }
  if(d.status!=='DISPOSING'&&d.status!=='DISPOSED') throw new Error('PHASE_G_V1215_INVALID_DISPOSITION_STATUS '+d.status);
  const ss=getQboStateCaptureSpreadsheet_();
  Object.keys(C.SHEETS).forEach(function(name){
    if(d.sheets[name]==='CLEARED'){qboPhaseG1215RequireZeroV2_(ss,name);return;}
    qboPhaseG1215VerifyOneExact_(ss,name);
    const deleted=qboPhaseG1215DeleteOnlyV2_(ss,name);
    if(deleted!==C.SHEETS[name].count)throw new Error('PHASE_G_V1215_DELETE_COUNT_MISMATCH sheet='+name+' deleted='+deleted);
    qboPhaseG1215RequireZeroV2_(ss,name); d.sheets[name]='CLEARED'; d.lastProgressAt=new Date().toISOString(); props.setProperty(C.DISPOSITION_STATE_KEY,JSON.stringify(d));
    console.log('[PHASE G INIT V1215] | SHEET_CLEARED | '+JSON.stringify({sheet:name,deletedV2Rows:deleted}));
  });
  qboPhaseG1215VerifyAllCleared_(ss);
  qboPhaseG1215RetireLegacyProperties_(props);
  d.status='DISPOSED'; d.completedAt=new Date().toISOString(); d.totalLegacyV2RowsCleared=31958; props.setProperty(C.DISPOSITION_STATE_KEY,JSON.stringify(d));
  const now=new Date().toISOString(), replay={version:C.VERSION,status:'INITIALIZED_REPLAY_DISABLED',phase:'PHASE_G',runId:'PHASE_G_V2_REPLAY|'+Utilities.getUuid(),initializedAt:now,historical07RunId:C.REQUIRED_HIST07_RUN,authority:'GOVERNED_LOGICAL_07_OBSERVATION_POPULATION_ORDERED_BY_OBSERVED_AT',expectedLogicalObservationCount:C.EXPECTED_HIST07_LOGICAL,observationCursor:0,processedObservationCount:0,lastObservedAt:'',lastObservationId:'',manifestSpreadsheetId:C.MANIFEST_SPREADSHEET_ID,manifestVerificationToken:C.MANIFEST_TOKEN,legacyV2RowsCleared:31958,replayAuthorized:false,replayWorkerEnabled:false,nextAction:'VALIDATE_EMPTY_V2_AND_DESIGN_OBSERVATION_LED_REPLAY_WORKER'};
  props.setProperty(C.REPLAY_STATE_KEY,JSON.stringify(replay));
  console.log('[PHASE G INIT V1215] | INITIALIZED_REPLAY_DISABLED | '+JSON.stringify(replay)); return replay;
}

function qboPhaseG1215RequireHist07_(props){const C=QBO_PHASE_G_INIT_V1215_;let s=qboPhaseG1215Json_(props.getProperty(C.HIST07_KEY));if(!s||s.status!==C.REQUIRED_HIST07_STATUS||s.runId!==C.REQUIRED_HIST07_RUN||Number(s.logicalObservationCount)!==C.EXPECTED_HIST07_LOGICAL||Number(s.identityMismatchCount)!==0||!(s.webhookGate&&s.webhookGate.passed===true)||!(s.cdcGate&&s.cdcGate.passed===true))throw new Error('PHASE_G_V1215_HISTORICAL_07_AUTHORITY_NOT_EXACT');}
function qboPhaseG1215RequireNoLegacyTriggers_(){const C=QBO_PHASE_G_INIT_V1215_,f=ScriptApp.getProjectTriggers().filter(function(t){return C.LEGACY_HANDLERS.indexOf(String(t.getHandlerFunction()||''))>=0;});if(f.length)throw new Error('PHASE_G_V1215_LEGACY_TRIGGER_ACTIVE count='+f.length);}
function qboPhaseG1215VerifyManifest_(props){
  const C=QBO_PHASE_G_INIT_V1215_,s=qboPhaseG1215Json_(props.getProperty(C.MANIFEST_STATE_KEY));
  if(!s||s.status!=='MANIFEST_PRESERVED'||s.manifestSpreadsheetId!==C.MANIFEST_SPREADSHEET_ID||s.verificationToken!==C.MANIFEST_TOKEN||s.historical07RunId!==C.REQUIRED_HIST07_RUN||Number(s.totalLegacyV2Rows)!==31958)throw new Error('PHASE_G_V1216_MANIFEST_POINTER_NOT_EXACT');
  const ms=SpreadsheetApp.openById(C.MANIFEST_SPREADSHEET_ID),sh=ms.getSheetByName('00_Summary');if(!sh)throw new Error('PHASE_G_V1216_MANIFEST_SUMMARY_MISSING');
  const vals=sh.getDataRange().getValues(),m={};vals.forEach(function(r){m[String(r[0]||'')]=r[1];});
  const dispositionFalse=(m.DispositionAuthorized===false||String(m.DispositionAuthorized||'').trim().toUpperCase()==='FALSE');
  if(String(m.VerificationToken||'')!==C.MANIFEST_TOKEN||!dispositionFalse||String(m.Historical07RunId||'')!==C.REQUIRED_HIST07_RUN||Number(m.TotalLegacyV2Rows)!==31958)throw new Error('PHASE_G_V1216_MANIFEST_SUMMARY_NOT_EXACT');
  const manifestNames={'10_Snapshot_Records':'V2_Snapshot_Records','11_Change_Records':'V2_Change_Records','12_Change_Detail':'V2_Change_Detail'};
  Object.keys(C.SHEETS).forEach(function(sourceName){
    const spec=C.SHEETS[sourceName],e=ms.getSheetByName(manifestNames[sourceName]);if(!e)throw new Error('PHASE_G_V1216_MANIFEST_DETAIL_MISSING '+sourceName);
    const lr=e.getLastRow();if(lr<1)throw new Error('PHASE_G_V1216_MANIFEST_DETAIL_EMPTY '+sourceName);
    const rows=lr>1?e.getRange(2,1,lr-1,4).getValues():[],rec=[];
    rows.forEach(function(r){if(String(r[0]||'')===sourceName)rec.push({rowNumber:Number(r[1]),id:String(r[2]||''),rowHash:String(r[3]||'')});});
    const idFp=qboPhaseG1215Sha_(rec.map(function(x){return x.id;}).sort().join('\n'));
    const rowFp=qboPhaseG1215Sha_(rec.map(function(x){return x.rowNumber+'|'+x.id+'|'+x.rowHash;}).join('\n'));
    if(rec.length!==spec.count||idFp!==spec.idFingerprint||rowFp!==spec.rowFingerprint)throw new Error('PHASE_G_V1216_MANIFEST_DETAIL_NOT_EXACT sheet='+sourceName+' count='+rec.length+' idFp='+idFp+' rowFp='+rowFp);
  });
}
function qboPhaseG1215VerifyAllExact_(ss){Object.keys(QBO_PHASE_G_INIT_V1215_.SHEETS).forEach(function(n){qboPhaseG1215VerifyOneExact_(ss,n);});}
function qboPhaseG1215VerifyOneExact_(ss,name){const C=QBO_PHASE_G_INIT_V1215_,spec=C.SHEETS[name],p=qboPhaseG1215Population_(ss,name,spec);if(p.count!==spec.count||p.idFingerprint!==spec.idFingerprint||p.rowFingerprint!==spec.rowFingerprint)throw new Error('PHASE_G_V1215_LIVE_POPULATION_DRIFT sheet='+name+' count='+p.count+' idFp='+p.idFingerprint+' rowFp='+p.rowFingerprint);}
function qboPhaseG1215Population_(ss,name,spec){const sh=ss.getSheetByName(name);if(!sh)throw new Error('PHASE_G_V1215_SHEET_MISSING '+name);const lr=sh.getLastRow(),lc=sh.getLastColumn(),vals=sh.getRange(1,1,lr,lc).getValues(),h=vals[0].map(function(v){return String(v||'').trim();}),vi=h.indexOf(spec.versionHeader),ii=h.indexOf(spec.idHeader);if(vi<0||ii<0)throw new Error('PHASE_G_V1215_HEADER_MISSING '+name);const rec=[];for(let r=1;r<vals.length;r++)if(String(vals[r][vi]||'')===spec.version)rec.push({rowNumber:r+1,id:String(vals[r][ii]||''),rowHash:qboPhaseG1215Sha_(qboPhaseG1215Stable_(vals[r]))});const ids=rec.map(function(x){return x.id;}).sort();return{count:rec.length,idFingerprint:qboPhaseG1215Sha_(ids.join('\n')),rowFingerprint:qboPhaseG1215Sha_(rec.map(function(x){return x.rowNumber+'|'+x.id+'|'+x.rowHash;}).join('\n')),rows:rec.map(function(x){return x.rowNumber;})};}
function qboPhaseG1215DeleteOnlyV2_(ss,name){const spec=QBO_PHASE_G_INIT_V1215_.SHEETS[name],p=qboPhaseG1215Population_(ss,name,spec),sh=ss.getSheetByName(name),rows=p.rows.slice().sort(function(a,b){return b-a;}),blocks=[];if(rows.length){let hi=rows[0],lo=hi;for(let i=1;i<rows.length;i++){if(rows[i]===lo-1)lo=rows[i];else{blocks.push([lo,hi]);hi=lo=rows[i];}}blocks.push([lo,hi]);}blocks.forEach(function(b){sh.deleteRows(b[0],b[1]-b[0]+1);});return rows.length;}
function qboPhaseG1215RequireZeroV2_(ss,name){const spec=QBO_PHASE_G_INIT_V1215_.SHEETS[name],p=qboPhaseG1215Population_(ss,name,spec);if(p.count!==0)throw new Error('PHASE_G_V1215_EXPECTED_ZERO_V2 sheet='+name+' count='+p.count);}
function qboPhaseG1215VerifyAllCleared_(ss){Object.keys(QBO_PHASE_G_INIT_V1215_.SHEETS).forEach(function(n){qboPhaseG1215RequireZeroV2_(ss,n);});}
function qboPhaseG1215RetireLegacyProperties_(props){const C=QBO_PHASE_G_INIT_V1215_,keys=C.LEGACY_REBUILD_KEYS.slice();props.getKeys().forEach(function(k){if(String(k).indexOf('QBO_CANONICAL_MIGRATION_CURSOR_V1|')===0)keys.push(String(k));});keys.forEach(function(k){props.deleteProperty(k);});}
function qboPhaseG1215Json_(v){try{return JSON.parse(v||'null');}catch(e){return null;}}
function qboPhaseG1215Stable_(v){if(v===null||v===undefined)return'null';if(v instanceof Date)return JSON.stringify(v.toISOString());if(Array.isArray(v))return'['+v.map(qboPhaseG1215Stable_).join(',')+']';if(typeof v==='object'){const ks=Object.keys(v).sort();return'{'+ks.map(function(k){return JSON.stringify(k)+':'+qboPhaseG1215Stable_(v[k]);}).join(',')+'}';}return JSON.stringify(v);}
function qboPhaseG1215Sha_(v){const b=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(v||''),Utilities.Charset.UTF_8);return b.map(function(x){return('0'+((x+256)%256).toString(16)).slice(-2);}).join('');}
