/** App 50 v1.5.260 — Phase G partition column-domain inventory, strictly read-only.
 * Run auditQboPhaseGColumnDomainsV1260(0) ... (63), one partition per call.
 * This is a discovery audit: source-dependent nullability requires separate certification.
 */
const QBO_PHASE_G_DOMAIN_V1260_=Object.freeze({VERSION:'1.5.260',KEY:'QBO_PHASE_G_GLOBAL_TIE_V1219_STATE',WORKBOOK:'1VmeTHHViWSW981U82cWikbZrUT_aiymh2LVDWtUknnI',HEADERS:['EntityType','EntityId','ObservedAt','ObservationId','SourceType','SourceRunId','SourceUnitId','PayloadOrdinal','SourceOperation','AdmissionStatus'],CHUNK:500,SAMPLE:8});
function auditQboPhaseGColumnDomainsV1260(partition){
 const C=QBO_PHASE_G_DOMAIN_V1260_,part=partition===undefined?0:Number(partition);
 if(!Number.isInteger(part)||part<0||part>63)throw new Error('V1260_PARTITION_MUST_BE_0_TO_63');
 const state=JSON.parse(PropertiesService.getScriptProperties().getProperty(C.KEY)||'null');
 if(!state||state.workbookId!==C.WORKBOOK)throw new Error('V1260_UNEXPECTED_PHASE_G_AUTHORITY');
 const wb=SpreadsheetApp.openById(C.WORKBOOK),name='P_'+('0'+part).slice(-2),sh=wb.getSheetByName(name);
 if(!sh)throw new Error('V1260_MISSING_PARTITION '+name);
 const hdr=sh.getRange(1,1,1,10).getDisplayValues()[0];
 if(JSON.stringify(hdr)!==JSON.stringify(C.HEADERS))throw new Error('V1260_HEADER_MISMATCH '+name);
 const result={version:C.VERSION,mode:'READ_ONLY',verdict:'INVENTORY_NOT_CERTIFICATION',partition:name,checkpointManifestCursor:state.manifestCursor,checkpointStatus:state.status,rows:0,blankCounts:{},invalidCounts:{},blankBySourceAndAdmission:{},domainValues:{},samples:[],controls:{writes:false,checkpointMutated:false,phaseGTriggersMutated:false}};
 C.HEADERS.forEach(k=>{result.blankCounts[k]=0;result.invalidCounts[k]=0;});
 const last=sh.getLastRow();
 for(let start=2;start<=last;start+=C.CHUNK){
  const rows=sh.getRange(start,1,Math.min(C.CHUNK,last-start+1),10).getDisplayValues();
  rows.forEach((r,i)=>{
   result.rows++;const source=r[4]||'(BLANK)',admission=r[9]||'(BLANK)',group=source+' | '+admission;
   if(!result.blankBySourceAndAdmission[group])result.blankBySourceAndAdmission[group]={rows:0,blanks:{}};
   const g=result.blankBySourceAndAdmission[group];g.rows++;
   for(let c=0;c<10;c++){
    const k=C.HEADERS[c],v=String(r[c]).trim();
    if(!v){result.blankCounts[k]++;g.blanks[k]=(g.blanks[k]||0)+1;}
    if([4,8,9].indexOf(c)>=0){const d=result.domainValues[k]||(result.domainValues[k]={});d[v||'(BLANK)']=(d[v||'(BLANK)']||0)+1;}
    let invalid=false;
    if([0,1,2,3,4,9].indexOf(c)>=0&&!v)invalid=true;
    if(c===2&&v&&isNaN(Date.parse(v)))invalid=true;
    if(c===7&&v&&!/^(0|[1-9][0-9]*)$/.test(v))invalid=true;
    if(c===9&&v&&!['ADMITTED','EVIDENCE_EXCEPTION','BLOCKED'].includes(v))invalid=true;
    if(invalid){result.invalidCounts[k]++;if(result.samples.length<C.SAMPLE)result.samples.push({row:start+i,column:k,value:v,sourceType:source,admissionStatus:admission});}
   }
  });
 }
 result.blankBySourceAndAdmission=Object.keys(result.blankBySourceAndAdmission).sort().map(k=>({group:k,rows:result.blankBySourceAndAdmission[k].rows,blanks:result.blankBySourceAndAdmission[k].blanks}));
 console.log('[PHASE G DOMAIN V1260] | READ_ONLY | '+JSON.stringify(result));return result;
}
