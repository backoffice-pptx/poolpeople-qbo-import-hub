/** App 50 v1.5.261 — read-only Phase G blank PayloadOrdinal trace.
 * Inventory the exact row identities for blank ordinals; no assertion of source contract compliance.
 * Run traceQboPhaseGBlankPayloadOrdinalsV1261(0) for P_00, then other partitions.
 */
const QBO_PHASE_G_ORDINAL_TRACE_V1261_=Object.freeze({VERSION:'1.5.261',KEY:'QBO_PHASE_G_GLOBAL_TIE_V1219_STATE',WORKBOOK:'1VmeTHHViWSW981U82cWikbZrUT_aiymh2LVDWtUknnI',HEADERS:['EntityType','EntityId','ObservedAt','ObservationId','SourceType','SourceRunId','SourceUnitId','PayloadOrdinal','SourceOperation','AdmissionStatus'],CHUNK:400,MAX_SAMPLES:80});
function traceQboPhaseGBlankPayloadOrdinalsV1261(partition){
 const C=QBO_PHASE_G_ORDINAL_TRACE_V1261_,part=partition===undefined?0:Number(partition);
 if(!Number.isInteger(part)||part<0||part>63)throw Error('V1261_PARTITION_RANGE');
 const state=JSON.parse(PropertiesService.getScriptProperties().getProperty(C.KEY)||'null');
 if(!state||state.workbookId!==C.WORKBOOK)throw Error('V1261_AUTHORITY_MISMATCH');
 const name='P_'+('0'+part).slice(-2),sheet=SpreadsheetApp.openById(C.WORKBOOK).getSheetByName(name);
 if(!sheet)throw Error('V1261_MISSING_SHEET '+name);
 if(JSON.stringify(sheet.getRange(1,1,1,10).getDisplayValues()[0])!==JSON.stringify(C.HEADERS))throw Error('V1261_HEADERS');
 const result={version:C.VERSION,mode:'READ_ONLY',verdict:'SOURCE_EVIDENCE_REVIEW_REQUIRED',partition:name,manifestCursor:state.manifestCursor,rowsScanned:0,blankOrdinalCount:0,bySource:{},byEntity:{},bySourceUnit:{},samples:[],sampleTruncated:false,controls:{writes:false,checkpointMutated:false,triggersMutated:false}};
 const last=sheet.getLastRow();
 for(let start=2;start<=last;start+=C.CHUNK){
  const rows=sheet.getRange(start,1,Math.min(C.CHUNK,last-start+1),10).getDisplayValues();
  rows.forEach((r,i)=>{
   result.rowsScanned++;
   if(String(r[7]).trim()!=='')return;
   result.blankOrdinalCount++;
   const source=String(r[4]),entity=String(r[0]),unit=source+'|'+String(r[5])+'|'+String(r[6]);
   result.bySource[source]=(result.bySource[source]||0)+1;
   result.byEntity[entity]=(result.byEntity[entity]||0)+1;
   result.bySourceUnit[unit]=(result.bySourceUnit[unit]||0)+1;
   if(result.samples.length<C.MAX_SAMPLES)result.samples.push({sheetRow:start+i,entityType:r[0],entityId:r[1],observedAt:r[2],observationId:r[3],sourceType:r[4],sourceRunId:r[5],sourceUnitId:r[6],sourceOperation:r[8],admissionStatus:r[9]});
   else result.sampleTruncated=true;
  });
 }
 const units=Object.entries(result.bySourceUnit);
 result.sourceUnitSummary={distinct:units.length,multiRowUnits:units.filter(x=>x[1]>1).length,maximumRowsPerUnit:units.reduce((n,x)=>Math.max(n,x[1]),0)};
 // Avoid large logs: include only units with multiple blank ordinal rows, max 20.
 result.multiRowUnitSamples=units.filter(x=>x[1]>1).slice(0,20).map(x=>({sourceUnit:x[0],rows:x[1]}));
 delete result.bySourceUnit;
 console.log('[PHASE G ORDINAL TRACE V1261] | READ_ONLY | '+JSON.stringify(result));return result;
}
