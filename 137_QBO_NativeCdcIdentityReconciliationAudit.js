/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 137_QBO_NativeCdcIdentityReconciliationAudit.js
 * Version     : 1.5.115
 *
 * READ-ONLY diagnostic after the guarded v1.5.114 write aborted on an
 * unexpected existing 03 NativeCdcEventId.
 *
 * Purpose:
 *  1. Establish the exact post-abort row/key state of 02a / 02b / 03.
 *  2. Compare the validated v1.5.113 955-observation candidate population
 *     with the existing 03 population.
 *  3. Reconcile observations by source-independent evidence identity rather
 *     than by NativeCdcEventId alone.
 *  4. Determine whether modern existing event IDs differ only because they
 *     preserve the four-part Native CDC source identity:
 *       NATIVE_CDC|<CycleBucket>|<CycleUuid>|<EntityType>
 *
 * NO WRITES.
 */

const QBO_NCDC_ID_RECON_1_5_115 = Object.freeze({
  VERSION:'QBO_NATIVE_CDC_IDENTITY_RECONCILIATION_V1_5_115',
  STATE_CAPTURE_SPREADSHEET_ID:'1JQ3s7fbOvSySmXVx5LuZhDogN2eMFekNAlU5Q6Tx4x0',
  SHEET02A:'02a_CDC_Run_Attempts_V2',
  SHEET02B:'02b_CDC_Committed_Runs_V2',
  SHEET03:'03_Native_CDC_Events_V2'
});

function auditQboNativeCdcIdentityReconciliationV2() {
  const C=QBO_NCDC_ID_RECON_1_5_115;
  const candidate=previewQboNativeCdcHistoricalReconstructionV2();
  const ss=SpreadsheetApp.openById(C.STATE_CAPTURE_SPREADSHEET_ID);

  const a=qboNcdc115Read_(ss,C.SHEET02A);
  const b=qboNcdc115Read_(ss,C.SHEET02B);
  const existing=qboNcdc115Read_(ss,C.SHEET03);
  const cand=candidate.observations || [];
  const findings=[];

  const exactExisting=qboNcdc115Index_(existing,'NativeCdcEventId');
  const exactCandidate=qboNcdc115Index_(cand,'NativeCdcEventId');

  let exactMatches=0;
  let candidateMissingByExact=0;
  cand.forEach(r=>{
    if(exactExisting[String(r.NativeCdcEventId||'')]) exactMatches++;
    else candidateMissingByExact++;
  });

  let existingMissingByExact=0;
  existing.forEach(r=>{
    if(!exactCandidate[String(r.NativeCdcEventId||'')]) existingMissingByExact++;
  });

  // Evidence identity deliberately excludes NativeCdcEventId / SourceId / run-id
  // representation. It uses immutable evidence file + entity observation facts.
  const cByEvidence=qboNcdc115Group_(cand,qboNcdc115EvidenceKey_);
  const eByEvidence=qboNcdc115Group_(existing,qboNcdc115EvidenceKey_);

  let evidenceOneToOne=0, evidenceCandidateOnly=0, evidenceExistingOnly=0, evidenceAmbiguous=0;
  const idMappings=[];
  const keys={};
  Object.keys(cByEvidence).forEach(k=>keys[k]=true);
  Object.keys(eByEvidence).forEach(k=>keys[k]=true);

  Object.keys(keys).forEach(k=>{
    const cc=cByEvidence[k]||[], ee=eByEvidence[k]||[];
    if(cc.length===1 && ee.length===1){
      evidenceOneToOne++;
      if(String(cc[0].NativeCdcEventId)!==String(ee[0].NativeCdcEventId)){
        idMappings.push({
          evidenceKey:k,
          candidateNativeCdcEventId:String(cc[0].NativeCdcEventId||''),
          existingNativeCdcEventId:String(ee[0].NativeCdcEventId||''),
          candidateCdcRunId:String(cc[0].CdcRunId||''),
          existingCdcRunId:String(ee[0].CdcRunId||''),
          entityType:String(ee[0].EntityType||cc[0].EntityType||''),
          entityId:String(ee[0].EntityId||cc[0].EntityId||''),
          operation:String(ee[0].Operation||cc[0].Operation||'')
        });
      }
    } else if(cc.length && !ee.length) evidenceCandidateOnly += cc.length;
    else if(ee.length && !cc.length) evidenceExistingOnly += ee.length;
    else if(cc.length || ee.length) {
      evidenceAmbiguous++;
      findings.push({code:'AMBIGUOUS_EVIDENCE_IDENTITY',key:k,candidateCount:cc.length,existingCount:ee.length});
    }
  });

  const existingSourceShapes=qboNcdc115SourceShapeCounts_(existing);
  const candidateSourceShapes=qboNcdc115SourceShapeCounts_(cand);

  const summary={
    version:C.VERSION,
    status:findings.length?'ACTION_REQUIRED':'EVIDENCE_RECONCILED',
    readOnly:true,
    postAbortState:{
      sheet02aRowCount:a.length,
      sheet02aUniqueAttemptCount:qboNcdc115UniqueCount_(a,'CdcAttemptId'),
      sheet02bRowCount:b.length,
      sheet02bUniqueRunCount:qboNcdc115UniqueCount_(b,'CdcRunId'),
      sheet03RowCount:existing.length,
      sheet03UniqueEventCount:qboNcdc115UniqueCount_(existing,'NativeCdcEventId')
    },
    candidateState:{
      attemptCount:candidate.summary.candidate02aAttemptCount,
      committedRunCount:candidate.summary.candidate02bCommittedRunCount,
      observationCount:cand.length
    },
    exactEventIdentity:{
      exactMatchCount:exactMatches,
      candidateNotExistingByExactId:candidateMissingByExact,
      existingNotCandidateByExactId:existingMissingByExact
    },
    evidenceIdentity:{
      oneToOneMatchCount:evidenceOneToOne,
      candidateOnlyObservationCount:evidenceCandidateOnly,
      existingOnlyObservationCount:evidenceExistingOnly,
      ambiguousEvidenceKeyCount:evidenceAmbiguous,
      differingEventIdMappingCount:idMappings.length
    },
    sourceIdShapes:{
      existing:existingSourceShapes,
      candidate:candidateSourceShapes
    },
    findingCount:findings.length,
    controls:{
      writes02a:false,writes02b:false,writes03:false,writes05:false,writes06:false,
      writesPayloads:false,writesProperties:false,writesTriggers:false
    }
  };

  console.log('[NCDC ID RECON 1.5.115] | SUMMARY | '+JSON.stringify(summary));
  console.log('[NCDC ID RECON 1.5.115] | EVENT ID MAPPINGS | '+JSON.stringify(idMappings));
  console.log('[NCDC ID RECON 1.5.115] | FINDINGS | '+JSON.stringify(findings));
  return {summary:summary,eventIdMappings:idMappings,findings:findings};
}

function qboNcdc115EvidenceKey_(r) {
  // Prefer immutable evidence file identity + entity facts. EvidenceIndex is
  // included when available, but entity identity protects against differing
  // historical index conventions.
  return [
    String(r.EvidenceFileId||''),
    String(r.EntityType||''),
    String(r.EntityId||''),
    String(r.Operation||''),
    String(r.QboSyncToken||''),
    String(r.QboLastUpdatedTime||'')
  ].join('|');
}

function qboNcdc115SourceShapeCounts_(rows) {
  const o={FOUR_PART_MODERN:0,THREE_PART_OR_LEGACY:0,OTHER:0,BLANK:0};
  rows.forEach(r=>{
    const s=String(r.SourceId||'');
    if(!s){o.BLANK++;return;}
    const p=s.split('|');
    if(p[0]==='NATIVE_CDC' && p.length===4) o.FOUR_PART_MODERN++;
    else if(p[0]==='NATIVE_CDC' && p.length===3) o.THREE_PART_OR_LEGACY++;
    else o.OTHER++;
  });
  return o;
}

function qboNcdc115Read_(ss,name) {
  const sh=ss.getSheetByName(name);
  if(!sh || sh.getLastRow()<2) return [];
  const vals=sh.getRange(1,1,sh.getLastRow(),sh.getLastColumn()).getValues();
  const h=vals[0].map(v=>String(v||'').trim());
  return vals.slice(1).filter(r=>r.some(v=>String(v==null?'':v).trim()!=='')).map(r=>{
    const o={}; h.forEach((k,i)=>{if(k)o[k]=r[i];}); return o;
  });
}
function qboNcdc115Index_(rows,col) {
  const o={}; rows.forEach(r=>{const k=String(r[col]||'');if(k)o[k]=(o[k]||0)+1;}); return o;
}
function qboNcdc115Group_(rows,keyFn) {
  const o={}; rows.forEach(r=>{const k=keyFn(r);(o[k]||(o[k]=[])).push(r);}); return o;
}
function qboNcdc115UniqueCount_(rows,col) {
  const o={}; rows.forEach(r=>{const k=String(r[col]||'');if(k)o[k]=true;}); return Object.keys(o).length;
}
