/**
 * Module  : 4034_QBO_FullExportObservationCountHistoricalRevisedApplyGate.js
 * Version : 1.5.154
 * Purpose : Read-only revised controlled-apply gate after classification of
 *           three stranded-run 01 lineage conflicts.
 *
 * Operator:
 *   validateQboFullExportObservationCountHistoricalRevisedApplyGate()
 *
 * Expected controlled apply:
 *   314 run-history writes
 *   333 existing 01 source writes
 *   647 total cell writes
 *
 * Recognized source exclusions:
 *   2 controlled-test missing sources
 *   2 stranded-run missing sources
 *   3 stranded-run source-lineage conflicts
 *
 * Safety: no production writes, locks, leases, trigger mutation, source
 * creation, or MasterBackup reopening.
 */
const QBO_FE_OBS_HIST_REVISED_GATE_ = Object.freeze({
  VERSION:'1.5.154',
  PREVIEW_STATE_KEY:'QBO_FE_OBS_HIST_PREVIEW_V148_STATE',
  PREVIEW_RESULT_PREFIX:'QBO_FE_OBS_HIST_PREVIEW_V148_RESULT_',
  HISTORY_SHEET:'QBO_ExportRunHistory',
  SOURCE_SHEET:'01_Sources',
  STRANDED_RUN_ID:'9ff6e204-18d8-4f81-b965-7749429886b3',
  LINEAGE_CONFLICT_EXPORT_KEYS:Object.freeze([
    'DEPOSITS','CREDIT_MEMOS','JOURNAL_ENTRIES'
  ])
});

function validateQboFullExportObservationCountHistoricalRevisedApplyGate() {
  const C=QBO_FE_OBS_HIST_REVISED_GATE_;
  const p=PropertiesService.getScriptProperties();
  const raw=p.getProperty(C.PREVIEW_STATE_KEY);
  if(!raw)throw new Error('Frozen historical preview state not found.');
  const st=JSON.parse(raw);
  if(st.status!=='COMPLETE'||Number(st.processedCount)!==Number(st.candidateCount))
    throw new Error('Frozen historical preview must be COMPLETE.');

  const hs=qboFeObsRevOpenRunHistory_().getSheetByName(C.HISTORY_SHEET);
  const ss=qboFeObsRevOpenStateCapture_().getSheetByName(C.SOURCE_SHEET);
  const h=qboFeObsRevRead_(hs), s=qboFeObsRevRead_(ss);
  qboFeObsRevRequire_(h.map,['RunId','ExportKey','Status','MasterBackupFileId','MasterBackupFileName','ObservationCount'],C.HISTORY_SHEET);
  qboFeObsRevRequire_(s.map,['SourceId','SourceRunId','ExportKey','MasterBackupFileId','MasterBackupFileName','ObservationCount'],C.SOURCE_SHEET);

  const bySource={};
  s.rows.forEach(function(x){
    const id=String(x.values[s.map.SourceId]||'').trim();
    if(id){if(!bySource[id])bySource[id]=[];bySource[id].push(x);}
  });

  const c={
    frozenCandidates:Number(st.candidateCount), checkedCandidates:0,
    historyWrites:0, sourceWrites:0,
    historyAlreadyMatches:0, sourceAlreadyMatches:0,
    controlledTestMissingSourceExclusions:0,
    strandedRunMissingSourceExclusions:0,
    strandedRunLineageConflictExclusions:0,
    unknownExclusions:0, blockedOrDrifted:0
  };
  const exclusions=[], findings=[];

  for(let i=0;i<Number(st.processedCount);i++){
    const rr=p.getProperty(C.PREVIEW_RESULT_PREFIX+st.previewRunId+'_'+i);
    if(!rr){c.blockedOrDrifted++;findings.push({candidateIndex:i,type:'MISSING_FROZEN_RESULT'});continue;}
    const r=JSON.parse(rr); c.checkedCandidates++;

    // Exact run-history authority must still be stable.
    if(r.kind==='RUN_HISTORY'){
      const row=h.byRow[Number(r.historyRow)];
      if(!row ||
         String(row[h.map.RunId]||'').trim()!==String(r.runId||'') ||
         String(row[h.map.ExportKey]||'').trim()!==String(r.exportKey||'') ||
         String(row[h.map.Status]||'').trim().toUpperCase()!=='COMPLETE' ||
         String(row[h.map.MasterBackupFileId]||'').trim()!==String(r.masterBackupFileId||'') ||
         String(row[h.map.MasterBackupFileName]||'').trim()!==String(r.masterBackupFileName||'')){
        c.blockedOrDrifted++; findings.push({candidateIndex:i,type:'RUN_HISTORY_IDENTITY_DRIFT',runId:r.runId,exportKey:r.exportKey}); continue;
      }
      const hv=qboFeObsRevNullable_(row[h.map.ObservationCount]);
      if(r.historyDisposition==='PROPOSE_WRITE'){
        if(hv===null)c.historyWrites++;
        else {c.blockedOrDrifted++;findings.push({candidateIndex:i,type:'HISTORY_TARGET_VALUE_DRIFT',runId:r.runId,exportKey:r.exportKey,currentValue:hv});continue;}
      } else if(r.historyDisposition==='ALREADY_MATCHES'){
        if(hv===Number(r.derivedObservationCount))c.historyAlreadyMatches++;
        else {c.blockedOrDrifted++;findings.push({candidateIndex:i,type:'HISTORY_ALREADY_MATCH_DRIFT',runId:r.runId,exportKey:r.exportKey});continue;}
      }
    }

    if(r.sourceDisposition==='SOURCE_MISSING'){
      const rows=bySource[String(r.sourceId||'')]||[];
      if(rows.length){c.blockedOrDrifted++;findings.push({candidateIndex:i,type:'EXCLUDED_SOURCE_NOW_PRESENT',sourceId:r.sourceId});continue;}
      const run=String(r.runId||'');
      if(run.indexOf('STATE_CAPTURE_AUTOREG_TEST_')===0){
        c.controlledTestMissingSourceExclusions++;
        exclusions.push({candidateIndex:i,classification:'CONTROLLED_TEST_SOURCE_MISSING',runId:run,exportKey:r.exportKey,sourceId:r.sourceId,observationCount:r.derivedObservationCount});
      }else if(run===C.STRANDED_RUN_ID){
        c.strandedRunMissingSourceExclusions++;
        exclusions.push({candidateIndex:i,classification:'STRANDED_RUN_SOURCE_MISSING_ELIGIBILITY_REVIEW_REQUIRED',runId:run,exportKey:r.exportKey,sourceId:r.sourceId,observationCount:r.derivedObservationCount});
      }else{
        c.unknownExclusions++; findings.push({candidateIndex:i,type:'UNCLASSIFIED_MISSING_SOURCE',sourceId:r.sourceId});
      }
      continue;
    }

    if(r.sourceDisposition==='PROPOSE_WRITE'||r.sourceDisposition==='ALREADY_MATCHES'){
      const rows=bySource[String(r.sourceId||'')]||[];
      if(rows.length!==1){
        c.blockedOrDrifted++;findings.push({candidateIndex:i,type:'SOURCE_IDENTITY_CARDINALITY_DRIFT',sourceId:r.sourceId,currentCount:rows.length});continue;
      }
      const sr=rows[0], v=sr.values;
      const coreMatch=
        sr.rowNumber===Number(r.sourceRow) &&
        String(v[s.map.SourceRunId]||'').trim()===String(r.runId||'') &&
        String(v[s.map.ExportKey]||'').trim()===String(r.exportKey||'');
      if(!coreMatch){
        c.blockedOrDrifted++;findings.push({candidateIndex:i,type:'SOURCE_CORE_IDENTITY_DRIFT',sourceId:r.sourceId});continue;
      }

      const lineageMatch=
        String(v[s.map.MasterBackupFileId]||'').trim()===String(r.masterBackupFileId||'') &&
        String(v[s.map.MasterBackupFileName]||'').trim()===String(r.masterBackupFileName||'');

      if(!lineageMatch){
        if(String(r.runId||'')===C.STRANDED_RUN_ID &&
           C.LINEAGE_CONFLICT_EXPORT_KEYS.indexOf(String(r.exportKey||''))>=0 &&
           r.sourceDisposition==='PROPOSE_WRITE' &&
           qboFeObsRevNullable_(v[s.map.ObservationCount])===null){
          c.strandedRunLineageConflictExclusions++;
          exclusions.push({
            candidateIndex:i,
            classification:'STRANDED_RUN_SOURCE_LINEAGE_CONFLICT_ELIGIBILITY_REVIEW_REQUIRED',
            runId:r.runId,exportKey:r.exportKey,sourceId:r.sourceId,
            frozenMasterBackupFileId:r.masterBackupFileId,
            currentMasterBackupFileId:String(v[s.map.MasterBackupFileId]||'').trim(),
            observationCount:r.derivedObservationCount,
            sourceWriteProposed:false
          });
          continue;
        }
        c.blockedOrDrifted++;findings.push({candidateIndex:i,type:'UNRECOGNIZED_SOURCE_LINEAGE_DRIFT',sourceId:r.sourceId});continue;
      }

      const sv=qboFeObsRevNullable_(v[s.map.ObservationCount]);
      if(r.sourceDisposition==='PROPOSE_WRITE'){
        if(sv===null)c.sourceWrites++;
        else {c.blockedOrDrifted++;findings.push({candidateIndex:i,type:'SOURCE_TARGET_VALUE_DRIFT',sourceId:r.sourceId,currentValue:sv});}
      }else{
        if(sv===Number(r.derivedObservationCount))c.sourceAlreadyMatches++;
        else {c.blockedOrDrifted++;findings.push({candidateIndex:i,type:'SOURCE_ALREADY_MATCH_DRIFT',sourceId:r.sourceId});}
      }
    }
  }

  const expected={
    historyWrites:314, sourceWrites:333,
    historyAlreadyMatches:1, sourceAlreadyMatches:1,
    controlledTestMissingSourceExclusions:2,
    strandedRunMissingSourceExclusions:2,
    strandedRunLineageConflictExclusions:3,
    proposedCellWrites:647
  };
  const proposed=c.historyWrites+c.sourceWrites;
  const exact=
    c.historyWrites===expected.historyWrites &&
    c.sourceWrites===expected.sourceWrites &&
    c.historyAlreadyMatches===expected.historyAlreadyMatches &&
    c.sourceAlreadyMatches===expected.sourceAlreadyMatches &&
    c.controlledTestMissingSourceExclusions===expected.controlledTestMissingSourceExclusions &&
    c.strandedRunMissingSourceExclusions===expected.strandedRunMissingSourceExclusions &&
    c.strandedRunLineageConflictExclusions===expected.strandedRunLineageConflictExclusions &&
    proposed===expected.proposedCellWrites;

  const out={
    version:C.VERSION,
    operation:'READ_ONLY_REVISED_HISTORICAL_OBSERVATIONCOUNT_APPLY_GATE',
    sourcePreview:{previewRunId:st.previewRunId,previewVersion:st.version,frozenAt:st.frozenAt,status:st.status},
    expected:expected,
    observed:c,
    proposedCellWrites:proposed,
    exclusions:exclusions,
    findings:findings,
    safety:{productionWritesPerformed:false,locksAcquired:false,workbookWriteLeaseAcquired:false,triggerMutationPerformed:false,masterBackupsReopened:false,missingSourceCreationAllowed:false,lineageRewriteAllowed:false},
    validForControlledApply:c.checkedCandidates===c.frozenCandidates&&c.blockedOrDrifted===0&&c.unknownExclusions===0&&findings.length===0&&exact
  };
  console.log(JSON.stringify(out,null,2)); return out;
}
function qboFeObsRevRead_(sh){
  if(!sh)throw new Error('Required sheet not found.');
  const v=sh.getDataRange().getValues(),m={},rows=[],byRow={};
  v[0].forEach(function(x,i){const h=String(x||'').trim();if(h)m[h]=i;});
  for(let i=1;i<v.length;i++){rows.push({rowNumber:i+1,values:v[i]});byRow[i+1]=v[i];}
  return {map:m,rows:rows,byRow:byRow};
}
function qboFeObsRevRequire_(m,a,n){a.forEach(function(h){if(m[h]===undefined)throw new Error(n+' missing '+h);});}
function qboFeObsRevNullable_(v){return v===''||v===null||v===undefined?null:Number(v);}
function qboFeObsRevOpenRunHistory_(){
  if(typeof getQboRunHistorySpreadsheet_==='function')return getQboRunHistorySpreadsheet_();
  if(typeof openQboRunHistorySpreadsheet_==='function')return openQboRunHistorySpreadsheet_();
  if(typeof QBO_RUN_HISTORY_CONFIG!=='undefined'&&QBO_RUN_HISTORY_CONFIG.SPREADSHEET_ID)return SpreadsheetApp.openById(QBO_RUN_HISTORY_CONFIG.SPREADSHEET_ID);
  if(typeof QBO_RUN_HISTORY!=='undefined'&&QBO_RUN_HISTORY.SPREADSHEET_ID)return SpreadsheetApp.openById(QBO_RUN_HISTORY.SPREADSHEET_ID);
  throw new Error('Unable to resolve run-history workbook.');
}
function qboFeObsRevOpenStateCapture_(){
  if(typeof getQboStateCaptureSpreadsheet_==='function')return getQboStateCaptureSpreadsheet_();
  if(typeof openQboStateCaptureSpreadsheet_==='function')return openQboStateCaptureSpreadsheet_();
  if(typeof QBO_STATE_CAPTURE_CONFIG!=='undefined'&&QBO_STATE_CAPTURE_CONFIG.SPREADSHEET_ID)return SpreadsheetApp.openById(QBO_STATE_CAPTURE_CONFIG.SPREADSHEET_ID);
  if(typeof QBO_STATE_CAPTURE!=='undefined'&&QBO_STATE_CAPTURE.SPREADSHEET_ID)return SpreadsheetApp.openById(QBO_STATE_CAPTURE.SPREADSHEET_ID);
  throw new Error('Unable to resolve State Capture workbook.');
}
