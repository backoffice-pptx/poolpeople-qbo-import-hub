/**
 * 4042A_QBO_FullExportObservationCountPostApplyQuotaPatch.js
 * Version 1.5.165
 * Overrides the v1.5.163 worker to stop storing successful per-candidate result
 * properties. Aggregate state/checkpoint remains authoritative.
 */
function qboFeObsPostReconV163Worker_(){
  const R=QBO_FE_OBS_POST_RECON_V163_,C=QBO_FE_OBS_HIST_APPLY_,p=PropertiesService.getScriptProperties();
  let st=JSON.parse(p.getProperty(R.STATE_KEY)||'null');
  if(!st)throw new Error('v1.5.163 reconciliation not started.');
  if(st.status==='COMPLETE'){console.log(JSON.stringify(st,null,2));return st;}
  if(st.status==='FAILED')throw new Error('v1.5.163 reconciliation is FAILED: '+st.error);
  qboFeObsPostReconV163RequireApply_(); qboFeObsApplyRequireDailyPaused_();

  const hs=qboFeObsApplyOpenRunHistory_().getSheetByName(C.HISTORY_SHEET);
  const ss=qboFeObsApplyOpenStateCapture_().getSheetByName(C.SOURCE_SHEET);
  if(!hs||!ss)throw new Error('Required target sheet missing.');
  const hm=qboFeObsApplyHeaderMap_(hs),sm=qboFeObsApplyHeaderMap_(ss);
  qboFeObsApplyRequire_(hm,['RunId','ExportKey','Status','MasterBackupFileId','MasterBackupFileName','ObservationCount'],C.HISTORY_SHEET);
  qboFeObsApplyRequire_(sm,['SourceId','SourceRunId','ExportKey','MasterBackupFileId','MasterBackupFileName','ObservationCount'],C.SOURCE_SHEET);

  const started=Date.now(),stop=Math.min(st.candidateCount,st.cursor+R.MAX_CANDIDATES_PER_EXECUTION);
  try{
    while(st.cursor<stop&&Date.now()-started<R.MAX_RUNTIME_MS){
      const i=st.cursor,rr=p.getProperty(C.PREVIEW_RESULT_PREFIX+st.previewRunId+'_'+i);
      if(!rr)throw new Error('Missing frozen result candidate '+i);
      const r=JSON.parse(rr),res=qboFeObsPostReconV163CheckCandidate_(i,r,hs,hm,ss,sm);

      st.checkedCandidates++;
      if(res.historyApplicable)st.historyApplicable++;
      if(res.historyCountMatchesOwnMasterBackup)st.historyCountMatchesOwnMasterBackup++;
      if(res.sourcePresent)st.sourcePresent++;
      if(res.sourceCountMatchesOwnMasterBackup)st.sourceCountMatchesOwnMasterBackup++;
      if(res.sourceMissingExpected)st.sourceMissingExpected++;
      if(res.controlledTestMissingSourceExclusion)st.controlledTestMissingSourceExclusions++;
      if(res.strandedRunMissingSourceExclusion)st.strandedRunMissingSourceExclusions++;
      if(res.strandedRunLineageConflictRow)st.strandedRunLineageConflictRows++;
      if(res.lineageConflictRowVerifiedAgainstOwnMasterBackup)st.lineageConflictRowsVerifiedAgainstOwnMasterBackup++;
      st.findingCount+=res.findings.length;
      if(res.findings.length)console.error('[OBSCOUNT POST RECON FINDING] candidate='+i+' '+JSON.stringify(res.findings));

      st.cursor=i+1;st.lastProgressAt=new Date().toISOString();st.version='1.5.165';
      p.setProperty(R.STATE_KEY,JSON.stringify(st));
    }
    if(st.cursor>=st.candidateCount){
      qboFeObsPostReconV163ValidateFinal_(st);
      st.status='COMPLETE';st.completedAt=new Date().toISOString();p.setProperty(R.STATE_KEY,JSON.stringify(st));
    }
    console.log(JSON.stringify(st,null,2));return st;
  }catch(e){
    st.status='FAILED';st.error=String(e&&e.message?e.message:e);st.failedAt=new Date().toISOString();
    try{p.setProperty(R.STATE_KEY,JSON.stringify(st));}catch(ignore){}
    console.log(JSON.stringify(st,null,2));throw e;
  }
}
