/** App 50 / Phase G v1.5.229. Read-only evidence; never authorizes recovery. */
function inspectQboPhaseGInFlightV1229Part1(){return qboPhaseG1229Inspect_(0);}
function inspectQboPhaseGInFlightV1229Part2(){return qboPhaseG1229Inspect_(8);}
function inspectQboPhaseGInFlightV1229Part3(){return qboPhaseG1229Inspect_(16);}
function inspectQboPhaseGInFlightV1229Part4(){return qboPhaseG1229Inspect_(24);}
function inspectQboPhaseGInFlightV1229Part5(){return qboPhaseG1229Inspect_(32);}
function inspectQboPhaseGInFlightV1229Part6(){return qboPhaseG1229Inspect_(40);}
function inspectQboPhaseGInFlightV1229Part7(){return qboPhaseG1229Inspect_(48);}
function inspectQboPhaseGInFlightV1229Part8(){return qboPhaseG1229Inspect_(56);}
function qboPhaseG1229Guard_(raw){
  const s=JSON.parse(raw||'null');
  const expected={version:'1.5.221',status:'BUILDING_GLOBAL_PARTITIONS',runId:'PHASE_G_GLOBAL_TIE_V1219|f8717a54-3a18-476a-8fa0-4f27a8c03f92',workbookId:'1VmeTHHViWSW981U82cWikbZrUT_aiymh2LVDWtUknnI',manifestCursor:1735,manifestCount:2418,observationCount:405455,admittedCount:405427,evidenceExceptionCount:28,blockedCount:0,partitionCursor:0,inFlightManifestBase:'qbo_observation_index_artifact_000001719_f92f2a2e178ce0c5',inFlightObservationCount:250,lastProgressAt:'2026-10-07T08:37:36.793Z',error:'',completedAt:''};
  if(!s)throw new Error('V1229_STATE_MISSING');
  Object.keys(expected).forEach(function(k){if(s[k]!==expected[k])throw new Error('V1229_CHECKPOINT_CHANGED '+k);});
  if(!s.iteratorToken)throw new Error('V1229_ITERATOR_TOKEN_MISSING');
  return s;
}
function qboPhaseG1229Compare_(expected,actual){
  const counts=Object.create(null);let found=0,exact=0,mismatch=0,duplicate=0;
  actual.forEach(function(row){const id=String(row[3]||'');if(!Object.prototype.hasOwnProperty.call(expected,id))return;found++;counts[id]=(counts[id]||0)+1;if(counts[id]>1)duplicate++;
    if(JSON.stringify(row.map(function(v){return String(v);}))===JSON.stringify(expected[id]))exact++;else mismatch++;
  });
  return {expected:Object.keys(expected).length,found:found,exact:exact,missing:Object.keys(expected).filter(function(id){return !counts[id];}).length,mismatchedRows:mismatch,duplicateRows:duplicate};
}
function qboPhaseG1229Inspect_(start){
  if(!Number.isInteger(start)||start<0||start>56||start%8)throw new Error('V1229_INVALID_RANGE');
  const key='QBO_PHASE_G_GLOBAL_TIE_V1219_STATE',p=PropertiesService.getScriptProperties(),raw=p.getProperty(key),s=qboPhaseG1229Guard_(raw);
  const handler='qboPhaseGGlobalEqualTimeV1219Continuation_';
  if(ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()===handler;}))throw new Error('V1229_CONTINUATION_PRESENT');
  const folders=qboObsIndexV175ResolveFolders_(),base=s.inFlightManifestBase;
  const mf=qboPhaseG1217Single_(folders.manifests,base+'.manifest.json'),sf=qboPhaseG1217Single_(folders.shards,base+'.json'),lf=qboPhaseG1217Single_(folders.lookup,base+'.lookup.json');
  const m=qboObsIndexV192ReadJson_(mf.getId()),body=qboObsIndexV192ReadJson_(sf.getId()),lk=qboObsIndexV192ReadJson_(lf.getId());
  qboPhaseG1217VerifyTriplet_(m,body,lk,mf,sf,lf);
  const records=body.stableBody.records||[],delta=qboPhaseG1220AdmissionCounts_(records);
  if(delta.total!==250)throw new Error('V1229_SOURCE_COUNT_CHANGED');
  const ids=Object.create(null),expected=Object.create(null),fields=['EntityType','EntityId','ObservedAt','ObservationId','SourceType','SourceRunId','SourceUnitId','PayloadOrdinal','SourceOperation','AdmissionStatus'];
  records.forEach(function(r){const id=String(r.ObservationId||'');if(!id||ids[id])throw new Error('V1229_SOURCE_ID_EMPTY_OR_DUPLICATE');ids[id]=true;
    expected[id]={partition:qboPhaseG1219Hash_(String(r.EntityType||'')+'\u001f'+String(r.EntityId||''))%64,row:fields.map(function(k){return String(r[k]||'');})};
  });
  // Continue a fresh iterator handle only; do not advance or replace the stored token.
  const it=DriveApp.continueFileIterator(String(s.iteratorToken));
  if(!it.hasNext()||it.next().getId()!==mf.getId())throw new Error('V1229_ITERATOR_NEXT_MANIFEST_MISMATCH');
  const wb=SpreadsheetApp.openById(s.workbookId),out={version:'1.5.229',mode:'READ_ONLY',runId:s.runId,manifestCursor:s.manifestCursor,manifestBase:base,sourceAdmissionCounts:delta,partitionStart:start,partitionEnd:start+7,partitions:[],recoveryAuthorized:false,committedPopulationCertified:false};
  console.log('[PHASE G INFLIGHT V1229] | START | '+JSON.stringify(out));
  for(let b=start;b<start+8;b++){
    const name='P_'+String(b).padStart(2,'0'),sh=wb.getSheetByName(name);if(!sh)throw new Error('V1229_PARTITION_MISSING '+name);
    if(JSON.stringify(sh.getRange(1,1,1,10).getValues()[0])!==JSON.stringify(fields))throw new Error('V1229_HEADER_CHANGED '+name);
    const lr=sh.getLastRow(),rows=lr>1?sh.getRange(2,1,lr-1,10).getValues():[],wanted=Object.create(null);
    Object.keys(expected).forEach(function(id){if(expected[id].partition===b)wanted[id]=expected[id].row;});
    const detail=Object.assign({partition:name,totalPhysicalRows:rows.length,wrongPartitionInFlightRows:rows.filter(function(row){const id=String(row[3]||'');return !!expected[id]&&expected[id].partition!==b;}).length},qboPhaseG1229Compare_(wanted,rows));
    out.partitions.push(detail);console.log('[PHASE G INFLIGHT V1229] | PARTITION | '+JSON.stringify(detail));
  }
  if(p.getProperty(key)!==raw||ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()===handler;}))throw new Error('V1229_STATE_OR_TRIGGER_CHANGED_DURING_READ');
  console.log('[PHASE G INFLIGHT V1229] | READ_COMPLETE | '+JSON.stringify(out));return out;
}
