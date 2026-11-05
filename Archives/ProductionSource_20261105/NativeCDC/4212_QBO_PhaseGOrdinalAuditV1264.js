/** App 50 v1.5.264 — checkpoint-bound, parameterless, read-only-to-production ordinal source audit.
 * Audit state alone is persisted in dedicated Script Properties. No production locks/triggers/writes.
 * Fresh audit: frozen P_00 ObservationIds + identity metadata at initialization.
 * Existing V1262/V1263 left unchanged. Script Properties per-value size is limited;
 * fail closed if the baseline is too large rather than silently truncating it.
 */
const QBO_PHASE_G_ORDINAL_AUDIT_V1264_ = Object.freeze({
 VERSION:'1.5.264',STATE_KEY:'QBO_PHASE_G_ORDINAL_SOURCE_AUDIT_V1264_STATE',
 BASELINE_KEY:'QBO_PHASE_G_ORDINAL_SOURCE_AUDIT_V1264_BASELINE',
 PHASE_KEY:'QBO_PHASE_G_GLOBAL_TIE_V1219_STATE',
 WORKBOOK:'1VmeTHHViWSW981U82cWikbZrUT_aiymh2LVDWtUknnI',
 HEADERS:['EntityType','EntityId','ObservedAt','ObservationId','SourceType','SourceRunId','SourceUnitId','PayloadOrdinal','SourceOperation','AdmissionStatus'],
 BATCH:80,RUNTIME_MS:85000,MAX_SAMPLES:30,MAX_PROPERTY_BYTES:8500
});
function qboPhaseGOrdinalV1264Props_(){return PropertiesService.getScriptProperties();}
function qboPhaseGOrdinalV1264Baseline_(){
 const C=QBO_PHASE_G_ORDINAL_AUDIT_V1264_,p=qboPhaseGOrdinalV1264Props_();
 const authority=JSON.parse(p.getProperty(C.PHASE_KEY)||'null');
 if(!authority||authority.workbookId!==C.WORKBOOK)throw Error('V1264_AUTHORITY_MISMATCH');
 const sh=SpreadsheetApp.openById(C.WORKBOOK).getSheetByName('P_00');
 if(!sh||JSON.stringify(sh.getRange(1,1,1,10).getDisplayValues()[0])!==JSON.stringify(C.HEADERS))throw Error('V1264_HEADERS');
 const end=sh.getLastRow(),targets=[];const seen=Object.create(null);
 for(let first=2;first<=end;first+=500){
  sh.getRange(first,1,Math.min(500,end-first+1),10).getDisplayValues().forEach(function(r,i){
   if(String(r[7]).trim()!=='')return;
   const id=String(r[3]);if(!id||seen[id])throw Error('V1264_INVALID_OR_DUPLICATE_OBSERVATION '+id);
   seen[id]=true;targets.push([id,String(r[4]),String(r[6]),String(r[5]),String(r[0]),String(r[1]),first+i]);
  });
 }
 if(!targets.length)throw Error('V1264_NO_TARGETS');
 const baseline={version:C.VERSION,partition:'P_00',capturedAt:new Date().toISOString(),
  phaseRunId:authority.runId,manifestCursor:authority.manifestCursor,
  inFlightManifestBase:authority.inFlightManifestBase||'',lastRow:end,targets:targets};
 const serialized=JSON.stringify(baseline);
 if(Utilities.newBlob(serialized).getBytes().length>C.MAX_PROPERTY_BYTES)throw Error('V1264_BASELINE_EXCEEDS_PROPERTY_LIMIT');
 return baseline;
}
/** Select in the Apps Script Run menu; call repeatedly until status COMPLETE. */
function runQboPhaseGOrdinalAuditV1264(){
 const C=QBO_PHASE_G_ORDINAL_AUDIT_V1264_,p=qboPhaseGOrdinalV1264Props_();
 let state=JSON.parse(p.getProperty(C.STATE_KEY)||'null');
 let baseline=JSON.parse(p.getProperty(C.BASELINE_KEY)||'null');
 if(state&&state.version!==C.VERSION)throw Error('V1264_STATE_VERSION');
 if(baseline&&baseline.version!==C.VERSION)throw Error('V1264_BASELINE_VERSION');
 if(Boolean(state)!==Boolean(baseline))throw Error('V1264_PARTIAL_INITIALIZATION');
 if(state&&state.status==='COMPLETE'){console.log('[PHASE G ORDINAL V1264] | ALREADY_COMPLETE | '+JSON.stringify(state));return state;}
 if(!state){
  baseline=qboPhaseGOrdinalV1264Baseline_();
  state={version:C.VERSION,status:'RUNNING',targets:baseline.targets.length,
   baselineCapturedAt:baseline.capturedAt,baselineManifestCursor:baseline.manifestCursor,
   baselineLastRow:baseline.lastRow,batches:0,shardsScanned:0,recordsScanned:0,
   matches:0,sourceOrdinalBlank:0,sourceOrdinalZero:0,sourceOrdinalOther:0,
   sourceOrdinalMissingProperty:0,sourceOrdinalNull:0,sourceOrdinalEmptyString:0,
   identityMismatches:0,duplicateMatches:0,matchSamples:[],mismatchSamples:[],
   nextToken:'',startedAt:new Date().toISOString()};
  // Baseline first, then state. On a partial initialization, fail closed for manual inspection.
  p.setProperty(C.BASELINE_KEY,JSON.stringify(baseline));p.setProperty(C.STATE_KEY,JSON.stringify(state));
 }
 const target=Object.create(null);baseline.targets.forEach(function(t){target[t[0]]=t;});
 const folder=qboObsIndexV175ResolveFolders_().shards;
 let it=state.nextToken?DriveApp.continueFileIterator(state.nextToken):folder.getFiles();
 const start=Date.now();const delta={shardsScanned:0,recordsScanned:0,matches:0,
  sourceOrdinalBlank:0,sourceOrdinalZero:0,sourceOrdinalOther:0,
  sourceOrdinalMissingProperty:0,sourceOrdinalNull:0,sourceOrdinalEmptyString:0,
  identityMismatches:0,duplicateMatches:0,matchSamples:[],mismatchSamples:[]};
 const seenInBatch=Object.create(null);
 while(it.hasNext()&&delta.shardsScanned<C.BATCH&&Date.now()-start<C.RUNTIME_MS){
  const file=it.next(),name=file.getName();
  if(!/\.json$/.test(name)||/\.lookup\.json$/.test(name))throw Error('V1264_UNEXPECTED_SHARD_FILE '+name);
  const body=qboObsIndexV192ReadJson_(file.getId());
  const records=body&&body.stableBody&&body.stableBody.records;
  if(!Array.isArray(records))throw Error('V1264_SHARD_SCHEMA '+name);
  delta.shardsScanned++;delta.recordsScanned+=records.length;
  records.forEach(function(r){
   const id=String(r.ObservationId||''),t=target[id];if(!t)return;
   delta.matches++;
   if(seenInBatch[id])delta.duplicateMatches++;seenInBatch[id]=true;
   const has=Object.prototype.hasOwnProperty.call(r,'PayloadOrdinal'),v=r.PayloadOrdinal;
   if(!has||v===undefined)delta.sourceOrdinalMissingProperty++;
   else if(v===null)delta.sourceOrdinalNull++;
   else if(v==='')delta.sourceOrdinalEmptyString++;
   else if(v===0||v==='0')delta.sourceOrdinalZero++;
   else delta.sourceOrdinalOther++;
   if(!has||v===undefined||v===null||v==='')delta.sourceOrdinalBlank++;
   const same=String(r.SourceType||'')===t[1]&&String(r.SourceUnitId||'')===t[2]&&
    String(r.SourceRunId||'')===t[3]&&String(r.EntityType||'')===t[4]&&String(r.EntityId||'')===t[5];
   if(!same){delta.identityMismatches++;if(delta.mismatchSamples.length<C.MAX_SAMPLES)
    delta.mismatchSamples.push({observationId:id,row:t[6],shard:name,reason:'SOURCE_IDENTITY_FIELDS_DIFFER'});}
   if(delta.matchSamples.length<C.MAX_SAMPLES)
    delta.matchSamples.push({observationId:id,row:t[6],shard:name,sourceOrdinal:!has?'MISSING_PROPERTY':v===null?'NULL':String(v),identityMatches:same});
  });
 }
 const more=it.hasNext(),nextToken=more?it.getContinuationToken():'';
 Object.keys(delta).forEach(function(k){
  if(Array.isArray(delta[k])){delta[k].forEach(function(x){if(state[k].length<C.MAX_SAMPLES)state[k].push(x);});}
  else state[k]+=delta[k];
 });
 state.batches++;state.nextToken=nextToken;state.lastProgressAt=new Date().toISOString();
 if(!more){state.status='COMPLETE';state.completedAt=state.lastProgressAt;
  state.verdict=state.matches!==state.targets?'TARGET_COVERAGE_MISMATCH':
   state.identityMismatches?'SOURCE_IDENTITY_MISMATCH':
   state.sourceOrdinalBlank===state.targets?'ALL_FROZEN_TARGET_SOURCE_ORDINALS_BLANK':
   'SOURCE_ORDINAL_VARIATION_REQUIRES_REVIEW';
 }
 // State checkpoint only after entire batch returns; re-running after a failed state write
 // replays the batch. This is intentional at-least-once behavior, not a production mutation.
 p.setProperty(C.STATE_KEY,JSON.stringify(state));
 console.log('[PHASE G ORDINAL V1264] | '+state.status+' | '+JSON.stringify(state));return state;
}
function inspectQboPhaseGOrdinalAuditV1264(){
 const C=QBO_PHASE_G_ORDINAL_AUDIT_V1264_,p=qboPhaseGOrdinalV1264Props_();
 const s=JSON.parse(p.getProperty(C.STATE_KEY)||'null'),b=JSON.parse(p.getProperty(C.BASELINE_KEY)||'null');
 const out={state:s||{status:'NOT_STARTED'},baseline:b?{capturedAt:b.capturedAt,manifestCursor:b.manifestCursor,lastRow:b.lastRow,targets:b.targets.length}:null};
 console.log('[PHASE G ORDINAL V1264] | INSPECT | '+JSON.stringify(out));return out;
}
