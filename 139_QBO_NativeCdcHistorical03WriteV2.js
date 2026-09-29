/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 139_QBO_NativeCdcHistorical03WriteV2.js
 * Version     : 1.5.118
 *
 * CONTROLLED 03-ONLY reconstruction after v1.5.117 exact 61/61 modern
 * identity reconciliation. 02a/02b are preconditions and are never written.
 * No 05/06/payload/property/trigger/State Application writes.
 */
const QBO_NCDC_03_WRITE_1_5_118=Object.freeze({
 VERSION:'QBO_NATIVE_CDC_HISTORICAL_03_WRITE_V1_5_118',
 SS:'1JQ3s7fbOvSySmXVx5LuZhDogN2eMFekNAlU5Q6Tx4x0',
 A:'02a_CDC_Run_Attempts_V2',B:'02b_CDC_Committed_Runs_V2',E:'03_Native_CDC_Events_V2'
});
const QBO_NCDC_03_HEADERS_1_5_118 = [
'NativeCdcEventId','CdcRunId','CdcAttemptId','SourceId','EntityRunId','EntityType',
'EvidenceIndex','EntityId','Operation','QboStatus','DeletedFlag','QboSyncToken',
'QboCreateTime','QboLastUpdatedTime','ObservedAt','SourceChangeTime','SparseFlag',
'EvidenceFileId','EvidenceFileName','EvidenceHash','EvidenceHashType','RequestStartedAt',
'RequestCompletedAt','QboResponseTime','RawEntityHash','EvidenceStatus','EligibilityStatus',
'EligibilityReason','AcquisitionClassification','EvidenceCreatedAt','RegistrationMode',
'RegisteredAt'
];


function writeQboNativeCdcHistorical03ReconstructionV2(){
 const C=QBO_NCDC_03_WRITE_1_5_118;
 const cand=previewQboNativeCdcHistoricalReconstructionV2();
 qboNcdc118AssertCandidate_(cand);
 const ss=SpreadsheetApp.openById(C.SS);
 const a=qboNcdc118Read_(ss,C.A), b=qboNcdc118Read_(ss,C.B), before=qboNcdc118Read_(ss,C.E);
 qboNcdc118AssertParents_(a,b);
 qboNcdc118AssertModernBefore_(before,cand.observations);

 // Candidate construction is the expensive operation. Lock covers only the
 // small controlled sheet mutation and immediate verification.
 const lock=LockService.getScriptLock(); lock.waitLock(30000);
 try{
   const sh=ss.getSheetByName(C.E); if(!sh)throw new Error('Missing '+C.E);
   // Recheck 03 under lock before mutation.
   qboNcdc118AssertModernBefore_(qboNcdc118Read_(ss,C.E),cand.observations);
   const rows=cand.observations.map(r=>QBO_NCDC_03_HEADERS_1_5_118.map(h=>r[h]===undefined?'':r[h]));
   sh.clearContents();
   sh.getRange(1,1,1,QBO_NCDC_03_HEADERS_1_5_118.length).setValues([QBO_NCDC_03_HEADERS_1_5_118]);
   if(rows.length)sh.getRange(2,1,rows.length,QBO_NCDC_03_HEADERS_1_5_118.length).setValues(rows);
   SpreadsheetApp.flush();
   const gate=qboNcdc118Gate_(ss,cand);
   if(!gate.valid)throw new Error('POST_WRITE_GATE_A_FAILED '+JSON.stringify(gate));
   const out={version:C.VERSION,status:'SUCCESS',writeScope:'03_ONLY',
     before03Count:before.length,after03Count:gate.rowCount,postWriteGateA:gate,
     controls:{writes02a:false,writes02b:false,writes05:false,writes06:false,
       writesPayloads:false,writesProperties:false,writesTriggers:false,writesStateApplication:false}};
   console.log('[NCDC 03 WRITE 1.5.118] | SUMMARY | '+JSON.stringify(out)); return out;
 }finally{lock.releaseLock();}
}
function qboNcdc118AssertCandidate_(c){
 const s=c.summary||{},g=s.modernIdentityGate||{};
 const ok=s.status==='READY_FOR_CONTROLLED_WRITE' &&
  s.candidate02aAttemptCount===41 && s.candidate02bCommittedRunCount===32 &&
  s.candidate03ObservationCount===955 && s.candidate03EligibleCount===955 &&
  s.candidate03IneligibleCount===0 && s.initialLookbackObservationCount===894 &&
  s.findingCount===0 && g.valid===true && g.candidateModernCount===61 &&
  g.existingModernCount===61 && g.exactEventIdentityMatchCount===61 &&
  g.candidateOnlyCount===0 && g.existingOnlyCount===0;
 if(!ok)throw new Error('CANDIDATE_GATE_FAILED '+JSON.stringify(s));
}
function qboNcdc118AssertParents_(a,b){
 if(a.length!==41||qboNcdc118UniqueCount_(a,'CdcAttemptId')!==41)throw new Error('02A_PRECONDITION_FAILED');
 if(b.length!==32||qboNcdc118UniqueCount_(b,'CdcRunId')!==32)throw new Error('02B_PRECONDITION_FAILED');
 const ai={};a.forEach(r=>ai[String(r.CdcAttemptId||'')]=r);
 b.forEach(r=>{const p=ai[String(r.CdcAttemptId||'')];if(!p)throw new Error('02B_PARENT_MISSING '+r.CdcRunId);
   if(String(r.WatermarkCommitted).toLowerCase()!=='true')throw new Error('02B_NOT_COMMITTED '+r.CdcRunId);
   if(String(p.AcquisitionStatus)!=='SUCCESS')throw new Error('02A_PARENT_NOT_SUCCESS '+r.CdcRunId);});
}
function qboNcdc118AssertModernBefore_(existing,candidate){
 if(existing.length!==61)throw new Error('EXPECTED_61_EXISTING_03 actual='+existing.length);
 const e={};existing.forEach(r=>e[String(r.NativeCdcEventId||'')]=1);
 const modern=candidate.filter(r=>String(r.SourceId||'').split('|').length===4);
 if(modern.length!==61)throw new Error('EXPECTED_61_MODERN_CANDIDATE');
 modern.forEach(r=>{if(!e[String(r.NativeCdcEventId||'')])throw new Error('MODERN_IDENTITY_NOT_PRESERVED '+r.NativeCdcEventId);});
}
function qboNcdc118Gate_(ss,c){
 const C=QBO_NCDC_03_WRITE_1_5_118,a=qboNcdc118Read_(ss,C.A),b=qboNcdc118Read_(ss,C.B),e=qboNcdc118Read_(ss,C.E),f=[];
 const ids={};e.forEach(r=>{const id=String(r.NativeCdcEventId||'');if(!id||ids[id])f.push('DUPLICATE_OR_BLANK_EVENT '+id);ids[id]=1;});
 const br={};b.forEach(r=>br[String(r.CdcRunId||'')]=1);
 e.forEach(r=>{if(!br[String(r.CdcRunId||'')])f.push('MISSING_02B_PARENT '+r.NativeCdcEventId);});
 const initial=e.filter(r=>String(r.AcquisitionClassification)==='INITIAL_LOOKBACK').length;
 const incr=e.filter(r=>String(r.AcquisitionClassification)==='INCREMENTAL').length;
 const eligible=e.filter(r=>String(r.EligibilityStatus)==='ELIGIBLE').length;
 const candidateIds={};c.observations.forEach(r=>candidateIds[String(r.NativeCdcEventId||'')]=1);
 const exact=e.filter(r=>candidateIds[String(r.NativeCdcEventId||'')]).length;
 const valid=a.length===41&&b.length===32&&e.length===955&&Object.keys(ids).length===955&&
  initial===894&&incr===61&&eligible===955&&exact===955&&f.length===0;
 return {valid:valid,rowCount:e.length,uniqueEventCount:Object.keys(ids).length,initialLookbackCount:initial,
   incrementalCount:incr,eligibleCount:eligible,exactCandidateIdentityCount:exact,
   parent02aCount:a.length,parent02bCount:b.length,findings:f};
}
function qboNcdc118Read_(ss,n){const s=ss.getSheetByName(n);if(!s||s.getLastRow()<2)return[];const v=s.getRange(1,1,s.getLastRow(),s.getLastColumn()).getValues(),h=v[0].map(x=>String(x||'').trim());return v.slice(1).filter(r=>r.some(x=>String(x==null?'':x).trim()!=='')).map(r=>{const o={};h.forEach((k,i)=>{if(k)o[k]=r[i]});return o});}
function qboNcdc118UniqueCount_(r,k){const x={};r.forEach(a=>{if(a[k]!==''&&a[k]!=null)x[String(a[k])]=1});return Object.keys(x).length;}
