/** App 50 v1.5.262 — READ ONLY immutable observation-index shard trace.
 * Explicit batch continuation token, no script properties, writes, or triggers.
 * Pass the nextToken returned by the preceding run, or omit for first batch.
 */
const QBO_PHASE_G_ORDINAL_SOURCE_V1262_=Object.freeze({VERSION:'1.5.262',KEY:'QBO_PHASE_G_GLOBAL_TIE_V1219_STATE',WORKBOOK:'1VmeTHHViWSW981U82cWikbZrUT_aiymh2LVDWtUknnI',HEADERS:['EntityType','EntityId','ObservedAt','ObservationId','SourceType','SourceRunId','SourceUnitId','PayloadOrdinal','SourceOperation','AdmissionStatus'],BATCH:80,RUNTIME_MS:85000});
function traceQboPhaseGOrdinalSourceV1262(nextToken){
 const C=QBO_PHASE_G_ORDINAL_SOURCE_V1262_,state=JSON.parse(PropertiesService.getScriptProperties().getProperty(C.KEY)||'null');
 if(!state||state.workbookId!==C.WORKBOOK)throw Error('V1262_AUTHORITY_MISMATCH');
 const sh=SpreadsheetApp.openById(C.WORKBOOK).getSheetByName('P_00');
 if(!sh||JSON.stringify(sh.getRange(1,1,1,10).getDisplayValues()[0])!==JSON.stringify(C.HEADERS))throw Error('V1262_HEADERS');
 const target=Object.create(null),last=sh.getLastRow();let blanks=0;
 for(let start=2;start<=last;start+=500){const rows=sh.getRange(start,1,Math.min(500,last-start+1),10).getDisplayValues();rows.forEach((r,i)=>{if(String(r[7]).trim()!=='')return;blanks++;const id=String(r[3]);if(target[id])throw Error('V1262_DUPLICATE_TARGET_OBSERVATION '+id);target[id]={row:start+i,source:r[4],unit:r[6],run:r[5],entity:r[0],entityId:r[1]};});}
 if(blanks!==57)throw Error('V1262_TARGET_COUNT_CHANGED '+blanks);
 const folder=qboObsIndexV175ResolveFolders_().shards,it=nextToken?DriveApp.continueFileIterator(String(nextToken)):folder.getFiles(),startTime=Date.now();
 const out={version:C.VERSION,mode:'READ_ONLY',verdict:'PARTIAL_IMMUTABLE_SOURCE_SCAN',partition:'P_00',targets:blanks,shardsScanned:0,recordsScanned:0,matches:0,sourceOrdinalBlank:0,sourceOrdinalZero:0,sourceOrdinalOther:0,sourceOrdinalMissingProperty:0,sourceOrdinalNull:0,sourceOrdinalEmptyString:0,mismatches:[],matchSamples:[],nextToken:'',more:false,controls:{writes:false,checkpointMutated:false,triggersMutated:false}};
 while(it.hasNext()&&out.shardsScanned<C.BATCH&&Date.now()-startTime<C.RUNTIME_MS){
  const file=it.next(),name=file.getName();if(!/\.json$/.test(name)||/\.lookup\.json$/.test(name))throw Error('V1262_UNEXPECTED_SHARD_FILE '+name);
  const body=qboObsIndexV192ReadJson_(file.getId()),records=body&&body.stableBody&&body.stableBody.records;if(!Array.isArray(records))throw Error('V1262_SHARD_SCHEMA '+name);
  out.shardsScanned++;out.recordsScanned+=records.length;
  records.forEach(r=>{const id=String(r.ObservationId||'');const t=target[id];if(!t)return;out.matches++;
   const has=Object.prototype.hasOwnProperty.call(r,'PayloadOrdinal'),v=r.PayloadOrdinal;
   if(!has)out.sourceOrdinalMissingProperty++;else if(v===null)out.sourceOrdinalNull++;else if(v==='')out.sourceOrdinalEmptyString++;else if(v===0||v==='0')out.sourceOrdinalZero++;else if(v===undefined)out.sourceOrdinalMissingProperty++;else out.sourceOrdinalOther++;
   if(!has||v===null||v===undefined||v==='')out.sourceOrdinalBlank++;
   const same=String(r.SourceType||'')===String(t.source)&&String(r.SourceUnitId||'')===String(t.unit)&&String(r.SourceRunId||'')===String(t.run)&&String(r.EntityType||'')===String(t.entity)&&String(r.EntityId||'')===String(t.entityId);
   if(!same&&out.mismatches.length<8)out.mismatches.push({sheetRow:t.row,observationId:id,shard:name,reason:'SOURCE_IDENTITY_FIELDS_DIFFER'});
   if(out.matchSamples.length<8)out.matchSamples.push({sheetRow:t.row,shard:name,sourceOrdinal:!has?'MISSING_PROPERTY':v===null?'NULL':String(v),identityMatches:same});
  });
 }
 out.more=it.hasNext();if(out.more)out.nextToken=it.getContinuationToken();
 if(!out.more)out.verdict='SOURCE_SHARD_SCAN_FINISHED_REQUIRES_AGGREGATION';
 console.log('[PHASE G ORDINAL SOURCE V1262] | READ_ONLY | '+JSON.stringify(out));return out;
}
