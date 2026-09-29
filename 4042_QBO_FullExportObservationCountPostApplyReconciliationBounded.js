/**
 * Module  : 4042_QBO_FullExportObservationCountPostApplyReconciliationBounded.js
 * Version : 1.5.163
 * Purpose : Bounded/resumable read-only post-apply reconciliation for the
 *           completed historical FULL_EXPORT ObservationCount migration.
 *
 * Operators:
 *   startQboFullExportObservationCountPostApplyReconciliationV163()
 *   continueQboFullExportObservationCountPostApplyReconciliationV163()
 *   statusQboFullExportObservationCountPostApplyReconciliationV163()
 *
 * Execution:
 *   - max 12 frozen candidates per invocation;
 *   - conservative 150-second runtime budget;
 *   - checkpoint after every candidate;
 *   - immutable frozen preview remains population authority;
 *   - each applicable physical row is independently checked against THAT
 *     ROW'S OWN immutable MasterBackup via qboFeObsHistDerive_().
 *
 * SAFETY: production data is read-only. Only ScriptProperties diagnostic
 *         reconciliation state/result records are written.
 */
const QBO_FE_OBS_POST_RECON_V163_ = Object.freeze({
  VERSION:'1.5.163',
  STATE_KEY:'QBO_FE_OBS_POST_RECON_V163_STATE',
  RESULT_PREFIX:'QBO_FE_OBS_POST_RECON_V163_RESULT_',
  MAX_CANDIDATES_PER_EXECUTION:12,
  MAX_RUNTIME_MS:150000,
  EXPECTED_APPLY_RUN:'FE_OBS_HIST_APPLY_6051dd21-ae18-4bf5-827f-3588e04b761d',
  EXPECTED_CANDIDATES:341
});

function startQboFullExportObservationCountPostApplyReconciliationV163(){
  const R=QBO_FE_OBS_POST_RECON_V163_, p=PropertiesService.getScriptProperties();
  const prior=p.getProperty(R.STATE_KEY);
  if(prior){
    const x=JSON.parse(prior);
    if(x.status==='RUNNING') return qboFeObsPostReconV163Worker_();
    if(x.status==='COMPLETE'){console.log(JSON.stringify(x,null,2));return x;}
    throw new Error('v1.5.163 reconciliation state already exists with status '+x.status+'.');
  }
  const a=qboFeObsPostReconV163RequireApply_();
  const ps=qboFeObsApplyLoadPreview_();
  if(a.previewRunId!==ps.previewRunId||Number(ps.candidateCount)!==R.EXPECTED_CANDIDATES)
    throw new Error('Frozen preview identity changed.');
  const st={
    version:R.VERSION,operation:'READ_ONLY_BOUNDED_POST_APPLY_OBSERVATIONCOUNT_RECONCILIATION',
    applyRunId:a.applyRunId,previewRunId:a.previewRunId,candidateCount:R.EXPECTED_CANDIDATES,
    cursor:0,status:'RUNNING',checkedCandidates:0,historyApplicable:0,
    historyCountMatchesOwnMasterBackup:0,sourcePresent:0,sourceCountMatchesOwnMasterBackup:0,
    sourceMissingExpected:0,controlledTestMissingSourceExclusions:0,
    strandedRunMissingSourceExclusions:0,strandedRunLineageConflictRows:0,
    lineageConflictRowsVerifiedAgainstOwnMasterBackup:0,findingCount:0,
    startedAt:new Date().toISOString(),lastProgressAt:null,completedAt:null,error:null,failedAt:null,
    safety:{productionWritesPerformed:false,locksAcquired:false,workbookWriteLeaseAcquired:false,
      checkpointMutationPerformed:true,checkpointScope:'SCRIPT_PROPERTIES_DIAGNOSTIC_ONLY',
      sourceCreationPerformed:false,lineageRewritePerformed:false,triggerMutationPerformed:false}
  };
  p.setProperty(R.STATE_KEY,JSON.stringify(st));
  return qboFeObsPostReconV163Worker_();
}

function continueQboFullExportObservationCountPostApplyReconciliationV163(){
  return qboFeObsPostReconV163Worker_();
}

function statusQboFullExportObservationCountPostApplyReconciliationV163(){
  const R=QBO_FE_OBS_POST_RECON_V163_,raw=PropertiesService.getScriptProperties().getProperty(R.STATE_KEY);
  const out=raw?JSON.parse(raw):{version:R.VERSION,status:'NOT_STARTED'};
  console.log(JSON.stringify(out,null,2));return out;
}

function qboFeObsPostReconV163Worker_(){
  const R=QBO_FE_OBS_POST_RECON_V163_,C=QBO_FE_OBS_HIST_APPLY_,p=PropertiesService.getScriptProperties();
  let st=JSON.parse(p.getProperty(R.STATE_KEY)||'null');
  if(!st)throw new Error('v1.5.163 reconciliation not started.');
  if(st.status==='COMPLETE'){console.log(JSON.stringify(st,null,2));return st;}
  if(st.status==='FAILED')throw new Error('v1.5.163 reconciliation is FAILED: '+st.error);

  qboFeObsPostReconV163RequireApply_();
  qboFeObsApplyRequireDailyPaused_();

  const hs=qboFeObsApplyOpenRunHistory_().getSheetByName(C.HISTORY_SHEET);
  const ss=qboFeObsApplyOpenStateCapture_().getSheetByName(C.SOURCE_SHEET);
  if(!hs||!ss)throw new Error('Required target sheet missing.');
  const hm=qboFeObsApplyHeaderMap_(hs),sm=qboFeObsApplyHeaderMap_(ss);
  qboFeObsApplyRequire_(hm,['RunId','ExportKey','Status','MasterBackupFileId','MasterBackupFileName','ObservationCount'],C.HISTORY_SHEET);
  qboFeObsApplyRequire_(sm,['SourceId','SourceRunId','ExportKey','MasterBackupFileId','MasterBackupFileName','ObservationCount'],C.SOURCE_SHEET);

  const started=Date.now(),stop=Math.min(st.candidateCount,st.cursor+R.MAX_CANDIDATES_PER_EXECUTION);
  try{
    while(st.cursor<stop && Date.now()-started<R.MAX_RUNTIME_MS){
      const i=st.cursor,rr=p.getProperty(C.PREVIEW_RESULT_PREFIX+st.previewRunId+'_'+i);
      if(!rr)throw new Error('Missing frozen result candidate '+i);
      const r=JSON.parse(rr),res=qboFeObsPostReconV163CheckCandidate_(i,r,hs,hm,ss,sm);
      p.setProperty(R.RESULT_PREFIX+st.previewRunId+'_'+i,JSON.stringify(res));

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

      st.cursor=i+1;st.lastProgressAt=new Date().toISOString();
      p.setProperty(R.STATE_KEY,JSON.stringify(st));
    }

    if(st.cursor>=st.candidateCount){
      qboFeObsPostReconV163ValidateFinal_(st);
      st.status='COMPLETE';st.completedAt=new Date().toISOString();
      p.setProperty(R.STATE_KEY,JSON.stringify(st));
    }
    console.log(JSON.stringify(st,null,2));return st;
  }catch(e){
    st.status='FAILED';st.error=String(e&&e.message?e.message:e);st.failedAt=new Date().toISOString();
    p.setProperty(R.STATE_KEY,JSON.stringify(st));console.log(JSON.stringify(st,null,2));throw e;
  }
}

function qboFeObsPostReconV163CheckCandidate_(i,r,hs,hm,ss,sm){
  const C=QBO_FE_OBS_HIST_APPLY_,frozenRun=qboFeObsApplyFrozenRunId_(r);
  const z={candidate:i,historyApplicable:false,historyCountMatchesOwnMasterBackup:false,
    sourcePresent:false,sourceCountMatchesOwnMasterBackup:false,sourceMissingExpected:false,
    controlledTestMissingSourceExclusion:false,strandedRunMissingSourceExclusion:false,
    strandedRunLineageConflictRow:false,lineageConflictRowVerifiedAgainstOwnMasterBackup:false,findings:[]};

  if(r.kind==='RUN_HISTORY'){
    z.historyApplicable=true;
    const hr=qboFeObsApplyReadRow_(hs,Number(r.historyRow),hm);
    qboFeObsApplyAssertHistoryIdentity_(hr,r);
    const hd=qboFeObsHistDerive_(String(r.exportKey||''),String(hr.MasterBackupFileId||'').trim(),String(hr.MasterBackupFileName||'').trim());
    if(!hd.valid)z.findings.push({side:'HISTORY',type:'MASTER_BACKUP_DERIVATION_FAILED',detail:hd});
    else if(qboFeObsApplyNullable_(hr.ObservationCount)!==Number(hd.observationCount))
      z.findings.push({side:'HISTORY',type:'OBSERVATIONCOUNT_MISMATCH',physical:qboFeObsApplyNullable_(hr.ObservationCount),derived:Number(hd.observationCount)});
    else z.historyCountMatchesOwnMasterBackup=true;
  }

  const rows=qboFeObsApplyFindSourceRows_(ss,sm,r.sourceId);
  if(r.sourceDisposition==='SOURCE_MISSING'){
    if(rows.length!==0)z.findings.push({side:'SOURCE',type:'EXPECTED_MISSING_SOURCE_NOW_PRESENT',cardinality:rows.length});
    else{
      z.sourceMissingExpected=true;
      if(frozenRun.indexOf('STATE_CAPTURE_AUTOREG_TEST_')===0)z.controlledTestMissingSourceExclusion=true;
      else if(frozenRun===C.STRANDED_RUN_ID)z.strandedRunMissingSourceExclusion=true;
      else z.findings.push({side:'SOURCE',type:'UNCLASSIFIED_EXPECTED_MISSING_SOURCE'});
    }
    return z;
  }

  if(rows.length!==1){z.findings.push({side:'SOURCE',type:'SOURCE_CARDINALITY_MISMATCH',cardinality:rows.length});return z;}
  z.sourcePresent=true;
  const sr=rows[0];
  if(sr.rowNumber!==Number(r.sourceRow)||sr.SourceRunId!==frozenRun||sr.ExportKey!==String(r.exportKey||'')){
    z.findings.push({side:'SOURCE',type:'SOURCE_CORE_IDENTITY_MISMATCH'});return z;
  }

  const lineageMatch=sr.MasterBackupFileId===String(r.masterBackupFileId||'')&&sr.MasterBackupFileName===String(r.masterBackupFileName||'');
  const conflict=frozenRun===C.STRANDED_RUN_ID&&C.LINEAGE_CONFLICT_EXPORT_KEYS.indexOf(String(r.exportKey||''))>=0;
  if(!lineageMatch){
    if(!conflict){z.findings.push({side:'SOURCE',type:'UNEXPECTED_LINEAGE_MISMATCH'});return z;}
    z.strandedRunLineageConflictRow=true;
  }

  const sd=qboFeObsHistDerive_(String(r.exportKey||''),sr.MasterBackupFileId,sr.MasterBackupFileName);
  if(!sd.valid){z.findings.push({side:'SOURCE',type:'OWN_MASTER_BACKUP_DERIVATION_FAILED',detail:sd});return z;}
  if(qboFeObsApplyNullable_(sr.ObservationCount)!==Number(sd.observationCount)){
    z.findings.push({side:'SOURCE',type:'OBSERVATIONCOUNT_MISMATCH_OWN_MASTER_BACKUP',
      physical:qboFeObsApplyNullable_(sr.ObservationCount),derived:Number(sd.observationCount)});return z;
  }
  z.sourceCountMatchesOwnMasterBackup=true;
  if(!lineageMatch&&conflict)z.lineageConflictRowVerifiedAgainstOwnMasterBackup=true;
  return z;
}

function qboFeObsPostReconV163RequireApply_(){
  const C=QBO_FE_OBS_HIST_APPLY_,R=QBO_FE_OBS_POST_RECON_V163_;
  const raw=PropertiesService.getScriptProperties().getProperty(C.APPLY_STATE_KEY);
  if(!raw)throw new Error('Apply state missing.');
  const a=JSON.parse(raw);
  if(a.applyRunId!==R.EXPECTED_APPLY_RUN||a.status!=='COMPLETE'||Number(a.cursor)!==R.EXPECTED_CANDIDATES)
    throw new Error('Completed governed apply state not present.');
  return a;
}

function qboFeObsPostReconV163ValidateFinal_(st){
  const checks=[
    ['checkedCandidates',341],['historyApplicable',315],['historyCountMatchesOwnMasterBackup',315],
    ['sourcePresent',337],['sourceCountMatchesOwnMasterBackup',337],['sourceMissingExpected',4],
    ['controlledTestMissingSourceExclusions',2],['strandedRunMissingSourceExclusions',2],
    ['strandedRunLineageConflictRows',3],['lineageConflictRowsVerifiedAgainstOwnMasterBackup',3],
    ['findingCount',0]
  ];
  checks.forEach(function(x){if(Number(st[x[0]])!==x[1])throw new Error('Final reconciliation mismatch '+x[0]+': '+st[x[0]]+' expected '+x[1]);});
}
