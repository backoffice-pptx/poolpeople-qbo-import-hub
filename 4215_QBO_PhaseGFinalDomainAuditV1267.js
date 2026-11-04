/** App 50 v1.5.267 — completed Phase G, read-only 64-partition domain inventory.
 * Writes only isolated audit Script Properties and its own time trigger.
 * Does NOT mutate Phase G, partition sheets, export scheduler, or source evidence.
 * Inventory is NOT immutable-source reconciliation or certification.
 */
const QBO_PG_DOMAIN_V1267_=Object.freeze({VERSION:'1.5.267',KEY:'QBO_PHASE_G_DOMAIN_V1267_STATE',PART_PREFIX:'QBO_PHASE_G_DOMAIN_V1267_P_',PHASE:'QBO_PHASE_G_GLOBAL_TIE_V1219_STATE',WB:'1VmeTHHViWSW981U82cWikbZrUT_aiymh2LVDWtUknnI',HANDLER:'qboPhaseGDomainAutoWorkerV1267',HEADERS:['EntityType','EntityId','ObservedAt','ObservationId','SourceType','SourceRunId','SourceUnitId','PayloadOrdinal','SourceOperation','AdmissionStatus'],CHUNK:750,PER_CALL:2,MAX_ERRORS:3});
function qboPgDomain267Props_(){return PropertiesService.getScriptProperties();}
function qboPgDomain267Triggers_(){return ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()===QBO_PG_DOMAIN_V1267_.HANDLER);}
function qboPgDomain267Remove_(){const t=qboPgDomain267Triggers_();t.forEach(x=>ScriptApp.deleteTrigger(x));return t.length;}
function qboPgDomain267Authority_(){const C=QBO_PG_DOMAIN_V1267_,s=JSON.parse(qboPgDomain267Props_().getProperty(C.PHASE)||'null');if(!s||s.status!=='COMPLETE_GLOBAL_EQUAL_TIME_DIAGNOSTIC'||s.workbookId!==C.WB||s.manifestCursor!==2418||s.manifestCount!==2418||s.partitionCursor!==64||s.observationCount!==734858||s.admittedCount!==734786||s.evidenceExceptionCount!==52||s.blockedCount!==20||s.writeJournalV1231)throw Error('V1267_PHASE_G_FINAL_AUTHORITY_CHANGED');return s;}
function qboPgDomain267Read_(){return JSON.parse(qboPgDomain267Props_().getProperty(QBO_PG_DOMAIN_V1267_.KEY)||'null');}
function qboPgDomain267Save_(s){qboPgDomain267Props_().setProperty(QBO_PG_DOMAIN_V1267_.KEY,JSON.stringify(s));}
function startQboPhaseGDomainAuditV1267(){
 const C=QBO_PG_DOMAIN_V1267_;qboPgDomain267Authority_();if(qboPgDomain267Read_())throw Error('V1267_EXISTING_AUDIT_USE_INSPECT_OR_RESUME');if(qboPgDomain267Triggers_().length)throw Error('V1267_EXISTING_TRIGGER');
 const s={version:C.VERSION,status:'RUNNING',nextPartition:0,completed:0,rows:0,errors:0,startedAt:new Date().toISOString(),lastError:''};qboPgDomain267Save_(s);
 ScriptApp.newTrigger(C.HANDLER).timeBased().everyMinutes(5).create();console.log('[PHASE G DOMAIN V1267] | STARTED | '+JSON.stringify({state:s,triggerCount:qboPgDomain267Triggers_().length}));return s;
}
function qboPgDomain267One_(wb,part){
 const C=QBO_PG_DOMAIN_V1267_,name='P_'+('0'+part).slice(-2),sh=wb.getSheetByName(name);if(!sh)throw Error('V1267_MISSING_PARTITION '+name);
 if(JSON.stringify(sh.getRange(1,1,1,10).getDisplayValues()[0])!==JSON.stringify(C.HEADERS))throw Error('V1267_HEADER_MISMATCH '+name);
 const result={partition:name,rows:0,blanks:Array(10).fill(0),invalid:Array(10).fill(0),sourceAdmission:{},sourceOperations:{},samples:[],lastRow:sh.getLastRow()};
 for(let start=2;start<=result.lastRow;start+=C.CHUNK){
  const data=sh.getRange(start,1,Math.min(C.CHUNK,result.lastRow-start+1),10).getDisplayValues();
  data.forEach((r,i)=>{result.rows++;const src=r[4]||'(BLANK)',ad=r[9]||'(BLANK)',key=src+' | '+ad;let g=result.sourceAdmission[key];if(!g)g=result.sourceAdmission[key]={rows:0,blanks:Array(10).fill(0)};g.rows++;const op=r[8]||'(BLANK)';result.sourceOperations[op]=(result.sourceOperations[op]||0)+1;
   for(let c=0;c<10;c++){const v=String(r[c]).trim();if(!v){result.blanks[c]++;g.blanks[c]++;}let bad=([0,1,2,3,4,9].includes(c)&&!v)||(c===2&&v&&isNaN(Date.parse(v)))||(c===7&&v&&!/^(0|[1-9][0-9]*)$/.test(v))||(c===9&&v&&!['ADMITTED','EVIDENCE_EXCEPTION','BLOCKED'].includes(v));if(bad){result.invalid[c]++;if(result.samples.length<8)result.samples.push({row:start+i,column:C.HEADERS[c],value:v,source:src,admission:ad});}}
  });
 }
 return result;
}
/** Parameterless manual worker; automation calls the same entrypoint. */
function qboPhaseGDomainAutoWorkerV1267(){
 const C=QBO_PG_DOMAIN_V1267_,p=qboPgDomain267Props_();let s=qboPgDomain267Read_();if(!s||s.status!=='RUNNING')return s;
 const now=Date.now();if(s.lease&&now-Date.parse(s.lease.at)<240000){console.log('[PHASE G DOMAIN V1267] | LEASE_SKIP');return s;}
 const token=Utilities.getUuid();s.lease={token:token,at:new Date(now).toISOString()};qboPgDomain267Save_(s);
 try{
  const authority=qboPgDomain267Authority_(),wb=SpreadsheetApp.openById(C.WB);let done=0;
  while(done<C.PER_CALL&&s.nextPartition<64){const part=s.nextPartition,r=qboPgDomain267One_(wb,part);if(r.rows!==authority.journaledRecoveryV1231.partitionRows[part])throw Error('V1267_PARTITION_COUNT_MISMATCH '+part+' '+r.rows);
   const key=C.PART_PREFIX+('0'+part).slice(-2);p.setProperty(key,JSON.stringify(r));
   s=qboPgDomain267Read_();if(!s.lease||s.lease.token!==token||s.nextPartition!==part)throw Error('V1267_LEASE_OR_CURSOR_CHANGED');s.nextPartition++;s.completed++;s.rows+=r.rows;s.errors=0;s.lease={token:token,at:new Date().toISOString()};s.updatedAt=new Date().toISOString();qboPgDomain267Save_(s);done++;
   console.log('[PHASE G DOMAIN V1267] | PARTITION | '+JSON.stringify({partition:r.partition,rows:r.rows,blanks:r.blanks,invalid:r.invalid,sourceAdmission:r.sourceAdmission,samples:r.samples}));
  }
  s=qboPgDomain267Read_();if(!s.lease||s.lease.token!==token)throw Error('V1267_LEASE_LOST');delete s.lease;
  if(s.nextPartition===64){if(s.rows!==authority.observationCount)throw Error('V1267_TOTAL_COUNT_MISMATCH '+s.rows);s.status='COMPLETE_INVENTORY_NOT_CERTIFIED';s.completedAt=new Date().toISOString();s.removedTriggers=qboPgDomain267Remove_();}qboPgDomain267Save_(s);
  console.log('[PHASE G DOMAIN V1267] | '+s.status+' | '+JSON.stringify(s));return s;
 }catch(e){s=qboPgDomain267Read_();if(s.lease&&s.lease.token===token){delete s.lease;s.errors=(s.errors||0)+1;s.lastError=String(e&&e.stack||e);if(s.errors>=C.MAX_ERRORS){s.status='HALTED_ERROR';s.removedTriggers=qboPgDomain267Remove_();}qboPgDomain267Save_(s);}console.error('[PHASE G DOMAIN V1267] | ERROR | '+String(e&&e.stack||e));throw e;}
}
function inspectQboPhaseGDomainAuditV1267(){const C=QBO_PG_DOMAIN_V1267_,p=qboPgDomain267Props_(),s=qboPgDomain267Read_();const totals={rows:0,blanks:Array(10).fill(0),invalid:Array(10).fill(0),sourceAdmission:{},sourceOperations:{}};for(let i=0;i<64;i++){const r=JSON.parse(p.getProperty(C.PART_PREFIX+('0'+i).slice(-2))||'null');if(!r)continue;totals.rows+=r.rows;for(let c=0;c<10;c++){totals.blanks[c]+=r.blanks[c];totals.invalid[c]+=r.invalid[c];}Object.keys(r.sourceAdmission).forEach(k=>{const g=r.sourceAdmission[k],a=totals.sourceAdmission[k]||(totals.sourceAdmission[k]={rows:0,blanks:Array(10).fill(0)});a.rows+=g.rows;for(let c=0;c<10;c++)a.blanks[c]+=g.blanks[c];});Object.keys(r.sourceOperations).forEach(k=>totals.sourceOperations[k]=(totals.sourceOperations[k]||0)+r.sourceOperations[k]);}const out={state:s,triggerCount:qboPgDomain267Triggers_().length,headers:C.HEADERS,totals:totals,verdict:'INVENTORY_ONLY_SOURCE_CONTRACT_NOT_CERTIFIED'};console.log('[PHASE G DOMAIN V1267] | INSPECT | '+JSON.stringify(out));return out;}
function stopQboPhaseGDomainAuditV1267(){const s=qboPgDomain267Read_();if(!s)throw Error('V1267_NOT_STARTED');s.status='STOPPED';delete s.lease;s.removedTriggers=qboPgDomain267Remove_();qboPgDomain267Save_(s);console.log('[PHASE G DOMAIN V1267] | STOPPED | '+JSON.stringify(s));return s;}
function resumeQboPhaseGDomainAuditV1267(){qboPgDomain267Authority_();const s=qboPgDomain267Read_();if(!s||!['STOPPED','HALTED_ERROR'].includes(s.status))throw Error('V1267_NOT_RESUMABLE');if(qboPgDomain267Triggers_().length)throw Error('V1267_TRIGGER_EXISTS');s.status='RUNNING';s.errors=0;delete s.lease;qboPgDomain267Save_(s);ScriptApp.newTrigger(QBO_PG_DOMAIN_V1267_.HANDLER).timeBased().everyMinutes(5).create();console.log('[PHASE G DOMAIN V1267] | RESUMED | '+JSON.stringify(s));return s;}
