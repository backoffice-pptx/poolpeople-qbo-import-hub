/**
 * Module  : 4041_QBO_FullExportObservationCountPostApplyReconciliation.js
 * Version : 1.5.162
 * Purpose : Read-only post-apply reconciliation for the completed historical
 *           FULL_EXPORT ObservationCount migration.
 *
 * Operator:
 *   reconcileQboFullExportObservationCountPostApplyV162()
 *
 * Contract:
 *   - frozen preview remains the population authority;
 *   - every applicable run-history count is re-read physically;
 *   - every existing 01_Sources row is re-read physically;
 *   - each physical count is independently re-derived from THAT ROW'S OWN
 *     immutable MasterBackup using manifest.entitySheetName;
 *   - missing-source exclusions remain absent;
 *   - the three stranded lineage-conflict rows are validated against their
 *     own source MasterBackups, not the run-history MasterBackups.
 *
 * SAFETY: read-only. No production writes, locks, leases, checkpoint mutation,
 *         source creation, lineage rewrite, or trigger mutation.
 */
function reconcileQboFullExportObservationCountPostApplyV162() {
  const C=QBO_FE_OBS_HIST_APPLY_, p=PropertiesService.getScriptProperties();
  const st=JSON.parse(p.getProperty(C.APPLY_STATE_KEY)||'null');
  if(!st) throw new Error('Apply state missing.');
  if(st.applyRunId!=='FE_OBS_HIST_APPLY_6051dd21-ae18-4bf5-827f-3588e04b761d' ||
     st.status!=='COMPLETE' || Number(st.cursor)!==341)
    throw new Error('Completed governed apply state not present.');

  qboFeObsApplyRequireDailyPaused_();

  const ps=qboFeObsApplyLoadPreview_();
  if(st.previewRunId!==ps.previewRunId || Number(ps.candidateCount)!==341)
    throw new Error('Frozen preview identity changed.');

  const hs=qboFeObsApplyOpenRunHistory_().getSheetByName(C.HISTORY_SHEET);
  const ss=qboFeObsApplyOpenStateCapture_().getSheetByName(C.SOURCE_SHEET);
  if(!hs||!ss) throw new Error('Required target sheet missing.');
  const hm=qboFeObsApplyHeaderMap_(hs), sm=qboFeObsApplyHeaderMap_(ss);
  qboFeObsApplyRequire_(hm,['RunId','ExportKey','Status','MasterBackupFileId','MasterBackupFileName','ObservationCount'],C.HISTORY_SHEET);
  qboFeObsApplyRequire_(sm,['SourceId','SourceRunId','ExportKey','MasterBackupFileId','MasterBackupFileName','ObservationCount'],C.SOURCE_SHEET);

  const out={
    version:'1.5.162',
    operation:'READ_ONLY_POST_APPLY_OBSERVATIONCOUNT_RECONCILIATION',
    applyRunId:st.applyRunId,
    previewRunId:st.previewRunId,
    candidateCount:341,
    checkedCandidates:0,
    historyApplicable:0,
    historyCountMatchesOwnMasterBackup:0,
    sourcePresent:0,
    sourceCountMatchesOwnMasterBackup:0,
    sourceMissingExpected:0,
    controlledTestMissingSourceExclusions:0,
    strandedRunMissingSourceExclusions:0,
    strandedRunLineageConflictRows:0,
    lineageConflictRowsVerifiedAgainstOwnMasterBackup:0,
    findings:[],
    safety:{
      productionWritesPerformed:false,
      locksAcquired:false,
      workbookWriteLeaseAcquired:false,
      checkpointMutationPerformed:false,
      sourceCreationPerformed:false,
      lineageRewritePerformed:false,
      triggerMutationPerformed:false
    },
    valid:false
  };

  for(let i=0;i<341;i++){
    const rr=p.getProperty(C.PREVIEW_RESULT_PREFIX+st.previewRunId+'_'+i);
    if(!rr){out.findings.push({candidate:i,type:'FROZEN_RESULT_MISSING'});continue;}
    const r=JSON.parse(rr), frozenRun=qboFeObsApplyFrozenRunId_(r);
    out.checkedCandidates++;

    if(r.kind==='RUN_HISTORY'){
      out.historyApplicable++;
      try{
        const hr=qboFeObsApplyReadRow_(hs,Number(r.historyRow),hm);
        qboFeObsApplyAssertHistoryIdentity_(hr,r);
        const hd=qboFeObsHistDerive_(String(r.exportKey||''),String(hr.MasterBackupFileId||'').trim(),String(hr.MasterBackupFileName||'').trim());
        if(!hd.valid){
          out.findings.push({candidate:i,side:'HISTORY',type:'MASTER_BACKUP_DERIVATION_FAILED',detail:hd});
        }else if(qboFeObsApplyNullable_(hr.ObservationCount)!==Number(hd.observationCount)){
          out.findings.push({candidate:i,side:'HISTORY',type:'OBSERVATIONCOUNT_MISMATCH',physical:qboFeObsApplyNullable_(hr.ObservationCount),derived:Number(hd.observationCount)});
        }else out.historyCountMatchesOwnMasterBackup++;
      }catch(e){out.findings.push({candidate:i,side:'HISTORY',type:'VALIDATION_ERROR',detail:String(e&&e.message||e)});}
    }

    const rows=qboFeObsApplyFindSourceRows_(ss,sm,r.sourceId);
    if(r.sourceDisposition==='SOURCE_MISSING'){
      if(rows.length!==0){
        out.findings.push({candidate:i,side:'SOURCE',type:'EXPECTED_MISSING_SOURCE_NOW_PRESENT',cardinality:rows.length});
      }else{
        out.sourceMissingExpected++;
        if(frozenRun.indexOf('STATE_CAPTURE_AUTOREG_TEST_')===0) out.controlledTestMissingSourceExclusions++;
        else if(frozenRun===C.STRANDED_RUN_ID) out.strandedRunMissingSourceExclusions++;
        else out.findings.push({candidate:i,side:'SOURCE',type:'UNCLASSIFIED_EXPECTED_MISSING_SOURCE'});
      }
      continue;
    }

    if(rows.length!==1){
      out.findings.push({candidate:i,side:'SOURCE',type:'SOURCE_CARDINALITY_MISMATCH',cardinality:rows.length});
      continue;
    }
    out.sourcePresent++;
    const sr=rows[0];
    if(sr.rowNumber!==Number(r.sourceRow)||sr.SourceRunId!==frozenRun||sr.ExportKey!==String(r.exportKey||'')){
      out.findings.push({candidate:i,side:'SOURCE',type:'SOURCE_CORE_IDENTITY_MISMATCH'});
      continue;
    }

    const lineageMatch=sr.MasterBackupFileId===String(r.masterBackupFileId||'') &&
                       sr.MasterBackupFileName===String(r.masterBackupFileName||'');
    const isGovernedConflict=frozenRun===C.STRANDED_RUN_ID &&
      C.LINEAGE_CONFLICT_EXPORT_KEYS.indexOf(String(r.exportKey||''))>=0;

    if(!lineageMatch){
      if(!isGovernedConflict){
        out.findings.push({candidate:i,side:'SOURCE',type:'UNEXPECTED_LINEAGE_MISMATCH',
          sourceMasterBackupFileId:sr.MasterBackupFileId,
          sourceMasterBackupFileName:sr.MasterBackupFileName});
        continue;
      }
      out.strandedRunLineageConflictRows++;
    }

    const sd=qboFeObsHistDerive_(String(r.exportKey||''),sr.MasterBackupFileId,sr.MasterBackupFileName);
    if(!sd.valid){
      out.findings.push({candidate:i,side:'SOURCE',type:'OWN_MASTER_BACKUP_DERIVATION_FAILED',detail:sd});
      continue;
    }
    if(qboFeObsApplyNullable_(sr.ObservationCount)!==Number(sd.observationCount)){
      out.findings.push({candidate:i,side:'SOURCE',type:'OBSERVATIONCOUNT_MISMATCH_OWN_MASTER_BACKUP',
        physical:qboFeObsApplyNullable_(sr.ObservationCount),derived:Number(sd.observationCount)});
      continue;
    }
    out.sourceCountMatchesOwnMasterBackup++;
    if(!lineageMatch && isGovernedConflict) out.lineageConflictRowsVerifiedAgainstOwnMasterBackup++;
  }

  out.findingCount=out.findings.length;
  out.valid=
    out.checkedCandidates===341 &&
    out.historyApplicable===315 &&
    out.historyCountMatchesOwnMasterBackup===315 &&
    out.sourcePresent===337 &&
    out.sourceCountMatchesOwnMasterBackup===337 &&
    out.sourceMissingExpected===4 &&
    out.controlledTestMissingSourceExclusions===2 &&
    out.strandedRunMissingSourceExclusions===2 &&
    out.strandedRunLineageConflictRows===3 &&
    out.lineageConflictRowsVerifiedAgainstOwnMasterBackup===3 &&
    out.findingCount===0;

  console.log(JSON.stringify(out,null,2));
  return out;
}
