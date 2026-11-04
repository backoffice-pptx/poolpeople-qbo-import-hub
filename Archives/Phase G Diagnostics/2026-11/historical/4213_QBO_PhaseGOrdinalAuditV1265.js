/** App 50 v1.5.265 — checkpoint-bound, parameterless, read-only-to-production ordinal source audit.
 * Audit state alone is persisted in dedicated, chunked Script Properties. No production locks/triggers/writes.
 * Fresh audit: frozen P_00 ObservationIds + identity metadata at initialization.
 * Existing V1262-V1264 left unchanged. Baseline chunks are SHA-256 verified;
 * baseline manifest is published only after all chunks are written.
 */
const QBO_PHASE_G_ORDINAL_AUDIT_V1265_ = Object.freeze({
 VERSION:'1.5.265',STATE_KEY:'QBO_PHASE_G_ORDINAL_SOURCE_AUDIT_V1265_STATE',
 BASELINE_KEY:'QBO_PHASE_G_ORDINAL_SOURCE_AUDIT_V1265_BASELINE',
 BASELINE_CHUNK_PREFIX:'QBO_PG_ORD_AUDIT_V1265_CHUNK_',CHUNK_CHARS:3000,MAX_CHUNKS:80,
 PHASE_KEY:'QBO_PHASE_G_GLOBAL_TIE_V1219_STATE',
 WORKBOOK:'1VmeTHHViWSW981U82cWikbZrUT_aiymh2LVDWtUknnI',
 HEADERS:['EntityType','EntityId','ObservedAt','ObservationId','SourceType','SourceRunId','SourceUnitId','PayloadOrdinal','SourceOperation','AdmissionStatus'],
 BATCH:80,RUNTIME_MS:85000,MAX_SAMPLES:30,MAX_PROPERTY_BYTES:8500
});
function qboPhaseGOrdinalV1265Props_(){return PropertiesService.getScriptProperties();}
function qboPhaseGOrdinalV1265Baseline_(){
 const C=QBO_PHASE_G_ORDINAL_AUDIT_V1265_,p=qboPhaseGOrdinalV1265Props_();
 const authority=JSON.parse(p.getProperty(C.PHASE_KEY)||'null');
 if(!authority||authority.workbookId!==C.WORKBOOK)throw Error('V1265_AUTHORITY_MISMATCH');
 const sh=SpreadsheetApp.openById(C.WORKBOOK).getSheetByName('P_00');
 if(!sh||JSON.stringify(sh.getRange(1,1,1,10).getDisplayValues()[0])!==JSON.stringify(C.HEADERS))throw Error('V1265_HEADERS');
 const end=sh.getLastRow(),targets=[];const seen=Object.create(null);
 for(let first=2;first<=end;first+=500){
  sh.getRange(first,1,Math.min(500,end-first+1),10).getDisplayValues().forEach(function(r,i){
   if(String(r[7]).trim()!=='')return;
   const id=String(r[3]);if(!id||seen[id])throw Error('V1265_INVALID_OR_DUPLICATE_OBSERVATION '+id);
   seen[id]=true;targets.push([id,String(r[4]),String(r[6]),String(r[5]),String(r[0]),String(r[1]),first+i]);
  });
 }
 if(!targets.length)throw Error('V1265_NO_TARGETS');
 const baseline={version:C.VERSION,partition:'P_00',capturedAt:new Date().toISOString(),
  phaseRunId:authority.runId,manifestCursor:authority.manifestCursor,
  inFlightManifestBase:authority.inFlightManifestBase||'',lastRow:end,targets:targets};
 const serialized=JSON.stringify(baseline);
 // Baseline is stored in verified chunks; no single-property size assumption.
 if(serialized.length>C.CHUNK_CHARS*C.MAX_CHUNKS)throw Error('V1265_BASELINE_EXCEEDS_CHUNK_CAPACITY');
 return baseline;
}
/** Store immutable baseline in multiple small Script Properties, then publish manifest last. */
function qboPhaseGOrdinalV1265SaveBaseline_(baseline){
 const C=QBO_PHASE_G_ORDINAL_AUDIT_V1265_,p=qboPhaseGOrdinalV1265Props_();
 if(p.getProperty(C.BASELINE_KEY))throw Error('V1265_BASELINE_ALREADY_PUBLISHED');
 const raw=JSON.stringify(baseline),parts=[];
 for(let i=0;i<raw.length;i+=C.CHUNK_CHARS)parts.push(raw.slice(i,i+C.CHUNK_CHARS));
 if(parts.length>C.MAX_CHUNKS)throw Error('V1265_TOO_MANY_CHUNKS');
 const digest=Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,raw));
 for(let i=0;i<parts.length;i++)p.setProperty(C.BASELINE_CHUNK_PREFIX+i,parts[i]);
 // Publication last: any interrupted writes remain untrusted and are overwritten on retry.
 p.setProperty(C.BASELINE_KEY,JSON.stringify({version:C.VERSION,count:parts.length,digest:digest,targets:baseline.targets.length,capturedAt:baseline.capturedAt}));
}
function qboPhaseGOrdinalV1265LoadBaseline_(){
 const C=QBO_PHASE_G_ORDINAL_AUDIT_V1265_,p=qboPhaseGOrdinalV1265Props_();
 const manifest=JSON.parse(p.getProperty(C.BASELINE_KEY)||'null');
 if(!manifest)return null;
 if(manifest.version!==C.VERSION||!Number.isInteger(manifest.count)||manifest.count<1||manifest.count>C.MAX_CHUNKS)throw Error('V1265_BASELINE_MANIFEST_INVALID');
 let raw='';for(let i=0;i<manifest.count;i++){
  const chunk=p.getProperty(C.BASELINE_CHUNK_PREFIX+i);
  if(chunk===null)throw Error('V1265_BASELINE_CHUNK_MISSING '+i);
  raw+=chunk;
 }
 const digest=Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,raw));
 if(digest!==manifest.digest)throw Error('V1265_BASELINE_DIGEST_MISMATCH');
 const baseline=JSON.parse(raw);
 if(baseline.version!==C.VERSION||baseline.targets.length!==manifest.targets)throw Error('V1265_BASELINE_CONTENT_MISMATCH');
 return baseline;
}
/** Select in the Apps Script Run menu; call repeatedly until status COMPLETE. */
function runQboPhaseGOrdinalAuditV1265(){
 const C=QBO_PHASE_G_ORDINAL_AUDIT_V1265_,p=qboPhaseGOrdinalV1265Props_();
 let state=JSON.parse(p.getProperty(C.STATE_KEY)||'null');
 let baseline=qboPhaseGOrdinalV1265LoadBaseline_();
 if(state&&state.version!==C.VERSION)throw Error('V1265_STATE_VERSION');
 if(baseline&&baseline.version!==C.VERSION)throw Error('V1265_BASELINE_VERSION');
 if(Boolean(state)!==Boolean(baseline))throw Error('V1265_PARTIAL_INITIALIZATION');
 if(state&&state.status==='COMPLETE'){console.log('[PHASE G ORDINAL V1265] | ALREADY_COMPLETE | '+JSON.stringify(state));return state;}
 if(!state){
  baseline=qboPhaseGOrdinalV1265Baseline_();
  state={version:C.VERSION,status:'RUNNING',targets:baseline.targets.length,
   baselineCapturedAt:baseline.capturedAt,baselineManifestCursor:baseline.manifestCursor,
   baselineLastRow:baseline.lastRow,batches:0,shardsScanned:0,recordsScanned:0,
   matches:0,sourceOrdinalBlank:0,sourceOrdinalZero:0,sourceOrdinalOther:0,
   sourceOrdinalMissingProperty:0,sourceOrdinalNull:0,sourceOrdinalEmptyString:0,
   identityMismatches:0,duplicateMatches:0,matchSamples:[],mismatchSamples:[],
   nextToken:'',startedAt:new Date().toISOString()};
  // Publish verified baseline before state. Partial chunk writes are safely overwritten on retry.
  qboPhaseGOrdinalV1265SaveBaseline_(baseline);p.setProperty(C.STATE_KEY,JSON.stringify(state));
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
  if(!/\.json$/.test(name)||/\.lookup\.json$/.test(name))throw Error('V1265_UNEXPECTED_SHARD_FILE '+name);
  const body=qboObsIndexV192ReadJson_(file.getId());
  const records=body&&body.stableBody&&body.stableBody.records;
  if(!Array.isArray(records))throw Error('V1265_SHARD_SCHEMA '+name);
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
 console.log('[PHASE G ORDINAL V1265] | '+state.status+' | '+JSON.stringify(state));return state;
}
function inspectQboPhaseGOrdinalAuditV1265(){
 const C=QBO_PHASE_G_ORDINAL_AUDIT_V1265_,p=qboPhaseGOrdinalV1265Props_();
 const s=JSON.parse(p.getProperty(C.STATE_KEY)||'null'),b=qboPhaseGOrdinalV1265LoadBaseline_();
 const out={state:s||{status:'NOT_STARTED'},baseline:b?{capturedAt:b.capturedAt,manifestCursor:b.manifestCursor,lastRow:b.lastRow,targets:b.targets.length}:null};
 console.log('[PHASE G ORDINAL V1265] | INSPECT | '+JSON.stringify(out));return out;
}
