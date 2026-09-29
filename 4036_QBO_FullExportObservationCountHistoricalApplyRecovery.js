/**
 * Module  : 4036_QBO_FullExportObservationCountHistoricalApplyRecovery.js
 * Version : 1.5.159
 * Purpose : One-time controlled recovery from the v1.5.155 fail-closed stop at
 *           candidate 216, plus corrected stranded-run lineage classification.
 *
 * Operator:
 *   recoverQboFullExportObservationCountHistoricalApplyV159()
 *
 * Preconditions are intentionally exact. This function refuses to act unless
 * the persisted v1.5.155 apply state is the known failed state at cursor 216.
 *
 * After recovery:
 *   - candidate 216 is checkpointed as a governed lineage-conflict exclusion;
 *   - the already committed history write is NOT rewritten or recounted;
 *   - persisted state becomes RUNNING at cursor 217 and version 1.5.156;
 *   - subsequent continue calls use the patched v1.5.155 worker configuration
 *     by replacing the worker entry point below.
 *
 * IMPORTANT: deploy this file together with patched 4035 from this package.
 */

function recoverQboFullExportObservationCountHistoricalApplyV159() {
  const C=QBO_FE_OBS_HIST_APPLY_, p=PropertiesService.getScriptProperties();
  let st=JSON.parse(p.getProperty(C.APPLY_STATE_KEY)||'null');
  if(!st)throw new Error('Apply state missing.');

  const EXPECTED_RUN='FE_OBS_HIST_APPLY_6051dd21-ae18-4bf5-827f-3588e04b761d';
  const EXPECTED_ERROR='Unrecognized source lineage drift candidate 216';
  const EXPECTED_KEYS=['DEPOSITS','CREDIT_MEMOS','JOURNAL_ENTRIES'];

  if(st.applyRunId!==EXPECTED_RUN || st.status!=='FAILED' || Number(st.cursor)!==216 ||
     String(st.error||'')!==EXPECTED_ERROR || Number(st.historyWrites)!==217 ||
     Number(st.sourceWrites)!==215 || Number(st.controlledTestMissingSourceExclusions)!==1 ||
     Number(st.strandedRunLineageConflictExclusions)!==0)
    throw new Error('Persisted apply state does not match the exact governed v1.5.155 recovery precondition.');

  qboFeObsApplyRequireDailyPaused_();
  const ps=qboFeObsApplyLoadPreview_();
  if(st.previewRunId!==ps.previewRunId)throw new Error('Frozen preview identity changed.');

  const hs=qboFeObsApplyOpenRunHistory_().getSheetByName(C.HISTORY_SHEET);
  const ss=qboFeObsApplyOpenStateCapture_().getSheetByName(C.SOURCE_SHEET);
  const hm=qboFeObsApplyHeaderMap_(hs), sm=qboFeObsApplyHeaderMap_(ss);

  for(let i=216;i<=218;i++){
    const rr=p.getProperty(C.PREVIEW_RESULT_PREFIX+st.previewRunId+'_'+i);
    if(!rr)throw new Error('Frozen candidate '+i+' missing.');
    const r=JSON.parse(rr), frozenRun=String(r.runId||r.sourceRunId||'').trim();
    if(frozenRun!==C.STRANDED_RUN_ID || String(r.exportKey||'')!==EXPECTED_KEYS[i-216])
      throw new Error('Candidate '+i+' is not the governed stranded-run lineage-conflict exception.');

    const hr=qboFeObsApplyReadRow_(hs,Number(r.historyRow),hm);
    qboFeObsApplyAssertHistoryIdentity_(hr,r);
    const hv=qboFeObsApplyNullable_(hr.ObservationCount);
    if(hv===null){
      qboFeObsApplyWriteVerify_(hs,Number(r.historyRow),hm.ObservationCount+1,Number(r.derivedObservationCount));
      st.historyWrites++;
    }else if(hv!==Number(r.derivedObservationCount)){
      throw new Error('Candidate '+i+' history ObservationCount drift.');
    }

    const rows=qboFeObsApplyFindSourceRows_(ss,sm,r.sourceId);
    if(rows.length!==1)throw new Error('Candidate '+i+' source cardinality changed.');
    const sr=rows[0];
    if(sr.rowNumber!==Number(r.sourceRow) || sr.SourceRunId!==frozenRun || sr.ExportKey!==String(r.exportKey||''))
      throw new Error('Candidate '+i+' source core identity changed.');
    if(sr.MasterBackupFileId===String(r.masterBackupFileId||'') && sr.MasterBackupFileName===String(r.masterBackupFileName||''))
      throw new Error('Candidate '+i+' no longer has the governed lineage conflict.');
    if(qboFeObsApplyNullable_(sr.ObservationCount)!==Number(r.derivedObservationCount))
      throw new Error('Candidate '+i+' source ObservationCount does not match the independently supported count.');
  }

  // No 01_Sources mutation. The three existing source rows retain their own immutable lineage.
  st.version='1.5.159';
  st.status='RUNNING';
  st.cursor=219;
  st.strandedRunLineageConflictExclusions=3;
  st.error=null;
  st.failedAt=null;
  st.lastProgressAt=new Date().toISOString();
  st.recoveredFrom={version:'1.5.155',failedCursor:216,failure:EXPECTED_ERROR,recoveryVersion:'1.5.159',
    recoveredAt:new Date().toISOString(),candidates:[216,217,218],sourceRowsRewritten:false,sourceLineageRewritten:false};
  p.setProperty(C.APPLY_STATE_KEY,JSON.stringify(st));
  console.log(JSON.stringify(st,null,2));
  return st;
}
