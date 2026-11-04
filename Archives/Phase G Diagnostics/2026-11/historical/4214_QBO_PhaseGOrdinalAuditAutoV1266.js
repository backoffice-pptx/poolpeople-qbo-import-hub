/** App 50 v1.5.266 — V1265 audit-only automated continuation.
 * Installs ONE five-minute clock trigger, runs the existing resumable V1265 batch,
 * and removes ONLY its own trigger at completion or after three consecutive errors.
 * No Phase G production state, export scheduler, or source evidence is modified.
 */
const QBO_PG_ORD_AUTO_V1266_ = Object.freeze({
 VERSION:'1.5.266', HANDLER:'qboPhaseGOrdinalAuditAutoWorkerV1266',
 KEY:'QBO_PHASE_G_ORDINAL_AUDIT_AUTO_V1266',
 AUDIT_KEY:'QBO_PHASE_G_ORDINAL_SOURCE_AUDIT_V1265_STATE',
 MAX_ERRORS:3, INTERVAL_MINUTES:5, MAX_LEASE_AGE_MS:180000
});
function qboPgOrdAutoV1266Props_(){return PropertiesService.getScriptProperties();}
function qboPgOrdAutoV1266Triggers_(){
 const C=QBO_PG_ORD_AUTO_V1266_;
 return ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()===C.HANDLER);
}
function qboPgOrdAutoV1266Read_(){
 const C=QBO_PG_ORD_AUTO_V1266_,p=qboPgOrdAutoV1266Props_();
 return JSON.parse(p.getProperty(C.KEY)||'null')||{version:C.VERSION,status:'NOT_INSTALLED',runs:0,consecutiveErrors:0};
}
function qboPgOrdAutoV1266Save_(s){qboPgOrdAutoV1266Props_().setProperty(QBO_PG_ORD_AUTO_V1266_.KEY,JSON.stringify(s));}
function qboPgOrdAutoV1266RemoveTriggers_(){
 const ts=qboPgOrdAutoV1266Triggers_();ts.forEach(t=>ScriptApp.deleteTrigger(t));return ts.length;
}
/** Run once from Apps Script dropdown to install the audit-only continuation trigger. */
function startQboPhaseGOrdinalAuditAutoV1266(){
 const C=QBO_PG_ORD_AUTO_V1266_,p=qboPgOrdAutoV1266Props_();
 const audit=JSON.parse(p.getProperty(C.AUDIT_KEY)||'null');
 if(!audit||audit.version!=='1.5.265'||!['RUNNING','COMPLETE'].includes(audit.status))
  throw Error('V1266_REQUIRES_EXISTING_V1265_AUDIT');
 if(audit.status==='COMPLETE'){
  const removed=qboPgOrdAutoV1266RemoveTriggers_();
  const s={version:C.VERSION,status:'COMPLETE',runs:0,consecutiveErrors:0,removedTriggers:removed,updatedAt:new Date().toISOString()};
  qboPgOrdAutoV1266Save_(s);console.log('[PHASE G ORDINAL AUTO V1266] | ALREADY_COMPLETE | '+JSON.stringify(s));return s;
 }
 const existing=qboPgOrdAutoV1266Triggers_();
 if(existing.length>1)throw Error('V1266_MULTIPLE_TRIGGERS_REQUIRES_REVIEW');
 const s=qboPgOrdAutoV1266Read_();
 if(existing.length===0)ScriptApp.newTrigger(C.HANDLER).timeBased().everyMinutes(C.INTERVAL_MINUTES).create();
 s.version=C.VERSION;s.status='RUNNING';s.consecutiveErrors=0;s.updatedAt=new Date().toISOString();
 qboPgOrdAutoV1266Save_(s);
 console.log('[PHASE G ORDINAL AUTO V1266] | INSTALLED | '+JSON.stringify({state:s,triggerCount:qboPgOrdAutoV1266Triggers_().length,auditBatches:audit.batches,auditShards:audit.shardsScanned}));return s;
}
/** Trigger entrypoint. Do not manually invoke concurrently with V1265. */
function qboPhaseGOrdinalAuditAutoWorkerV1266(){
 const C=QBO_PG_ORD_AUTO_V1266_,p=qboPgOrdAutoV1266Props_();
 let s=qboPgOrdAutoV1266Read_();if(s.status!=='RUNNING')return;
 const now=Date.now(),lease=s.lease;
 // Conservative audit-only lease. The periodic trigger stays alive for recovery.
 // No shared Apps Script lock is taken, avoiding contention with Phase G.
 if(lease&&now-Date.parse(lease.at)<C.MAX_LEASE_AGE_MS){
  console.log('[PHASE G ORDINAL AUTO V1266] | LEASE_ACTIVE_SKIP | '+JSON.stringify(lease));return;
 }
 const token=Utilities.getUuid();s.lease={token:token,at:new Date(now).toISOString()};qboPgOrdAutoV1266Save_(s);
 try{
  const result=runQboPhaseGOrdinalAuditV1265();
  s=qboPgOrdAutoV1266Read_();
  if(!s.lease||s.lease.token!==token)throw Error('V1266_LEASE_OWNERSHIP_LOST');
  s.runs=(s.runs||0)+1;s.consecutiveErrors=0;s.lastAuditStatus=result.status;
  s.lastBatches=result.batches;s.lastShards=result.shardsScanned;s.lastMatches=result.matches;
  s.updatedAt=new Date().toISOString();delete s.lease;
  if(result.status==='COMPLETE'){
   s.status='COMPLETE';s.removedTriggers=qboPgOrdAutoV1266RemoveTriggers_();
  }
  qboPgOrdAutoV1266Save_(s);
  console.log('[PHASE G ORDINAL AUTO V1266] | '+s.status+' | '+JSON.stringify(s));return s;
 }catch(e){
  s=qboPgOrdAutoV1266Read_();
  if(s.lease&&s.lease.token===token){
   s.consecutiveErrors=(s.consecutiveErrors||0)+1;s.lastError=String(e&&e.stack||e);
   s.updatedAt=new Date().toISOString();delete s.lease;
   if(s.consecutiveErrors>=C.MAX_ERRORS){s.status='HALTED_ERROR';s.removedTriggers=qboPgOrdAutoV1266RemoveTriggers_();}
   qboPgOrdAutoV1266Save_(s);
  }
  console.error('[PHASE G ORDINAL AUTO V1266] | ERROR | '+String(e&&e.stack||e));throw e;
 }
}
/** Read-only status. */
function inspectQboPhaseGOrdinalAuditAutoV1266(){
 const C=QBO_PG_ORD_AUTO_V1266_,audit=JSON.parse(qboPgOrdAutoV1266Props_().getProperty(C.AUDIT_KEY)||'null');
 const out={automation:qboPgOrdAutoV1266Read_(),triggerCount:qboPgOrdAutoV1266Triggers_().length,
 audit:audit?{status:audit.status,batches:audit.batches,shardsScanned:audit.shardsScanned,recordsScanned:audit.recordsScanned,matches:audit.matches,targets:audit.targets,verdict:audit.verdict||''}:null};
 console.log('[PHASE G ORDINAL AUTO V1266] | INSPECT | '+JSON.stringify(out));return out;
}
/** Stop ONLY the V1266 trigger; V1265 audit state remains intact. */
function stopQboPhaseGOrdinalAuditAutoV1266(){
 const s=qboPgOrdAutoV1266Read_();s.status='STOPPED';s.removedTriggers=qboPgOrdAutoV1266RemoveTriggers_();
 s.updatedAt=new Date().toISOString();qboPgOrdAutoV1266Save_(s);
 console.log('[PHASE G ORDINAL AUTO V1266] | STOPPED | '+JSON.stringify(s));return s;
}
