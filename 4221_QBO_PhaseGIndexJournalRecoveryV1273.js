function inspectQboPhaseGIndexJournalRecoveryV1272() {
  const p = PropertiesService.getScriptProperties();
  const key = 'QBO_PHASE_G_INDEX_V1272_STATE';

  const state = JSON.parse(p.getProperty(key) || 'null');
  const journal = JSON.parse(
    p.getProperty(key + '_JOURNAL') || 'null'
  );

  const out = {
    status: state?.status,
    committedCursor: state?.fileCursor,
    committedRows: state?.rows,
    journal: journal,
    cursorDifference:
      state && journal
        ? state.fileCursor - journal.cursor
        : null,
    iteratorPresent: !!state?.iteratorToken,
    leasePresent: !!state?.lease,
    partitionCount: state?.partitionCounts?.length,
    triggerCount: ScriptApp.getProjectTriggers()
      .filter(t =>
        t.getHandlerFunction() ===
        'qboPhaseGIndexIntegrityWorkerV1272'
      ).length
  };

  console.log(
    '[PHASE G INDEX V1272] | JOURNAL_DIAGNOSTIC | ' +
    JSON.stringify(out)
  );

  return out;
}

/** V1.5.273 — controlled recovery of V1272 stale post-commit journal. */
function resumeQboPhaseGIndexIntegrityAfterJournalV1273(){
 const P=PropertiesService.getScriptProperties(),K='QBO_PHASE_G_INDEX_V1272_STATE';
 const s=JSON.parse(P.getProperty(K)||'null'),j=JSON.parse(P.getProperty(K+'_JOURNAL')||'null');
 function fail(x){throw Error('V1273_'+x);}
 if(!s||s.version!=='1.5.272'||s.status!=='HALTED_REVIEW_REQUIRED'||s.fileCursor!==973||s.rows!==396581||s.indexFolderId!=='16Ltx_Rs4MrBH3jhToWm8olfzR2CX1aA-')fail('CHECKPOINT_UNEXPECTED');
 if(!j||j.cursor!==972||j.fileId!=='1LUtuxqgRj4XUPsrcWDIUxp2bJ9IFGiAO'||j.name!=='001445_qbo_observation_index_artifact_000002009_3a5e7ec67d894dd3.index.json')fail('JOURNAL_UNEXPECTED');
 if(s.lease||qboPg272Triggers_().length||!Array.isArray(s.partitionCounts)||s.partitionCounts.length!==64||s.partitionCounts.some(x=>!Number.isInteger(x)||x<0)||s.partitionCounts.reduce((a,b)=>a+b,0)!==s.rows)fail('STATE_OR_TRIGGER_UNSAFE');
 if(!String(s.lastError||'').includes('V1272_UNRESOLVED_JOURNAL'))fail('ERROR_UNEXPECTED');
 const v=qboPg272Gate_();if(v.indexFolderId!==s.indexFolderId)fail('SOURCE_GATE');
 const f=DriveApp.getFileById(j.fileId);if(f.getName()!==j.name||f.getParents().next().getId()!==s.indexFolderId)fail('FILE_IDENTITY');
 const o=JSON.parse(f.getBlob().getDataAsString());if(o.version!=='1.5.271'||!Array.isArray(o.entries)||o.rows!==o.entries.length||o.rows<1||qboPg271Hash_(JSON.stringify(o.entries))!==o.payloadHash)fail('FILE_HASH');
 const seen=Object.create(null),counts=Array(64).fill(0);
 o.entries.forEach((e,i)=>{if(!Array.isArray(e)||e.length!==3||typeof e[0]!=='string'||!e[0]||!Number.isInteger(e[1])||e[1]<0||e[1]>=64||e[2]!==i||seen[e[0]])fail('ENTRY');seen[e[0]]=true;counts[e[1]]++;});
 if(s.rows<o.rows||counts.some((n,i)=>s.partitionCounts[i]<n))fail('COUNTERS_INCONSISTENT');
 const it=DriveApp.continueFileIterator(s.iteratorToken);if(!it.hasNext())fail('ITERATOR_EXHAUSTED');const next=it.next();if(next.getId()===j.fileId)fail('ITERATOR_POINTS_TO_JOURNALED_FILE');
 // Verify stable state again immediately before the only recovery mutation.
 const now=JSON.parse(P.getProperty(K)||'null'),jj=JSON.parse(P.getProperty(K+'_JOURNAL')||'null');
 if(JSON.stringify(now)!==JSON.stringify(s)||JSON.stringify(jj)!==JSON.stringify(j)||qboPg272Triggers_().length)fail('CONCURRENT_CHANGE');
 P.deleteProperty(K+'_JOURNAL');
 s.status='RUNNING';s.lastError='';s.recoveredAt=new Date().toISOString();s.recoveryVersion='1.5.273';s.recoveryJournal=j;s.recoveryFileRows=o.rows;
 qboPg272Save_(s);
 ScriptApp.newTrigger(QBO_PG272_.HANDLER).timeBased().everyMinutes(5).create();
 const out={status:s.status,cursor:s.fileCursor,rows:s.rows,journalRemoved:!P.getProperty(K+'_JOURNAL'),triggerCount:qboPg272Triggers_().length,recoveryVersion:s.recoveryVersion};
 console.log('[PHASE G INDEX V1273] | RESUMED | '+JSON.stringify(out));return out;
}
