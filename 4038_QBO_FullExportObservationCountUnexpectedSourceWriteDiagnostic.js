/**
 * Module  : 4038_QBO_FullExportObservationCountUnexpectedSourceWriteDiagnostic.js
 * Version : 1.5.158
 * Purpose : Read-only diagnostic for unexpected ObservationCount population
 *           around stranded-run 01_Sources rows after the v1.5.155 apply stop.
 *
 * Operator:
 *   diagnoseQboFullExportObservationCountUnexpectedSourceWritesV158()
 *
 * Reads:
 *   - persisted frozen preview results
 *   - persisted apply state
 *   - physical 01_Sources rows 237..243
 *   - physical run-history rows referenced by matching frozen candidates
 *
 * Safety: zero writes, zero state mutation, zero locks/leases/triggers.
 */
const QBO_FE_OBS_UNEXPECTED_WRITE_DIAG_ = Object.freeze({
  VERSION:'1.5.158',
  PREVIEW_STATE_KEY:'QBO_FE_OBS_HIST_PREVIEW_V148_STATE',
  PREVIEW_RESULT_PREFIX:'QBO_FE_OBS_HIST_PREVIEW_V148_RESULT_',
  APPLY_STATE_KEY:'QBO_FE_OBS_HIST_APPLY_V155_STATE',
  SOURCE_SHEET:'01_Sources',
  HISTORY_SHEET:'QBO_ExportRunHistory',
  SOURCE_ROW_START:237,
  SOURCE_ROW_END:243
});

function diagnoseQboFullExportObservationCountUnexpectedSourceWritesV158() {
  const C=QBO_FE_OBS_UNEXPECTED_WRITE_DIAG_, p=PropertiesService.getScriptProperties();
  const ps=JSON.parse(p.getProperty(C.PREVIEW_STATE_KEY)||'null');
  const ap=JSON.parse(p.getProperty(C.APPLY_STATE_KEY)||'null');
  if(!ps||!ap)throw new Error('Required frozen preview/apply state missing.');

  const ss=qboFeObsUWOpenStateCapture_().getSheetByName(C.SOURCE_SHEET);
  const hs=qboFeObsUWOpenRunHistory_().getSheetByName(C.HISTORY_SHEET);
  const sm=qboFeObsUWMap_(ss), hm=qboFeObsUWMap_(hs);
  qboFeObsUWReq_(sm,['SourceId','SourceRunId','ExportKey','MasterBackupFileId','MasterBackupFileName','ObservationCount'],C.SOURCE_SHEET);
  qboFeObsUWReq_(hm,['RunId','ExportKey','MasterBackupFileId','MasterBackupFileName','ObservationCount'],C.HISTORY_SHEET);

  const frozenBySourceId={};
  for(let i=0;i<Number(ps.processedCount);i++){
    const raw=p.getProperty(C.PREVIEW_RESULT_PREFIX+ps.previewRunId+'_'+i);
    if(!raw)continue;
    const r=JSON.parse(raw),sid=String(r.sourceId||'');
    if(sid)frozenBySourceId[sid]={candidateIndex:i,result:r};
  }

  const rows=[];
  for(let row=C.SOURCE_ROW_START;row<=C.SOURCE_ROW_END;row++){
    const sr=qboFeObsUWRow_(ss,row,sm);
    const sid=String(sr.SourceId||'').trim();
    const f=frozenBySourceId[sid]||null;
    let frozen=null,history=null;
    if(f){
      const r=f.result;
      frozen={
        candidateIndex:f.candidateIndex,
        runId:String(r.runId||r.sourceRunId||'').trim(),
        exportKey:String(r.exportKey||''),
        sourceRow:Number(r.sourceRow),
        historyRow:Number(r.historyRow),
        masterBackupFileId:String(r.masterBackupFileId||''),
        masterBackupFileName:String(r.masterBackupFileName||''),
        derivedObservationCount:Number(r.derivedObservationCount),
        sourceDisposition:r.sourceDisposition,
        historyDisposition:r.historyDisposition
      };
      if(Number(r.historyRow)){
        const hr=qboFeObsUWRow_(hs,Number(r.historyRow),hm);
        history={
          rowNumber:Number(r.historyRow),
          runId:String(hr.RunId||'').trim(),
          exportKey:String(hr.ExportKey||'').trim(),
          masterBackupFileId:String(hr.MasterBackupFileId||'').trim(),
          masterBackupFileName:String(hr.MasterBackupFileName||'').trim(),
          observationCount:qboFeObsUWNullable_(hr.ObservationCount)
        };
      }
    }
    rows.push({
      sourceRow:row,
      currentSource:{
        sourceId:sid,
        sourceRunId:String(sr.SourceRunId||'').trim(),
        exportKey:String(sr.ExportKey||'').trim(),
        masterBackupFileId:String(sr.MasterBackupFileId||'').trim(),
        masterBackupFileName:String(sr.MasterBackupFileName||'').trim(),
        observationCount:qboFeObsUWNullable_(sr.ObservationCount)
      },
      frozen:frozen,
      currentHistory:history,
      comparisons:frozen?{
        sourceRowMatchesFrozen:row===frozen.sourceRow,
        sourceCountEqualsFrozenDerived:qboFeObsUWNullable_(sr.ObservationCount)===frozen.derivedObservationCount,
        sourceLineageMatchesFrozen:
          String(sr.MasterBackupFileId||'').trim()===frozen.masterBackupFileId &&
          String(sr.MasterBackupFileName||'').trim()===frozen.masterBackupFileName,
        historyCountEqualsFrozenDerived:history?history.observationCount===frozen.derivedObservationCount:null
      }:null
    });
  }

  const out={
    version:C.VERSION,
    operation:'READ_ONLY_UNEXPECTED_SOURCE_OBSERVATIONCOUNT_WRITE_DIAGNOSTIC',
    sourcePreview:{previewRunId:ps.previewRunId,frozenAt:ps.frozenAt},
    persistedApplyState:{
      version:ap.version,applyRunId:ap.applyRunId,cursor:ap.cursor,status:ap.status,
      historyWrites:ap.historyWrites,sourceWrites:ap.sourceWrites,
      controlledTestMissingSourceExclusions:ap.controlledTestMissingSourceExclusions,
      strandedRunMissingSourceExclusions:ap.strandedRunMissingSourceExclusions,
      strandedRunLineageConflictExclusions:ap.strandedRunLineageConflictExclusions,
      error:ap.error,failedAt:ap.failedAt
    },
    inspectedSourceRowRange:{start:C.SOURCE_ROW_START,end:C.SOURCE_ROW_END},
    rows:rows,
    diagnosticNotes:[
      'This diagnostic does not infer writer provenance from cell values alone.',
      'Rows whose candidateIndex is greater than or equal to persisted cursor were not checkpointed by the apply worker.',
      'A populated count on an uncheckpointed row is evidence requiring separate provenance/code-path review.'
    ],
    safety:{
      productionWritesPerformed:false,
      applyStateMutationPerformed:false,
      locksAcquired:false,
      workbookWriteLeaseAcquired:false,
      triggerMutationPerformed:false,
      sourceCreationPerformed:false,
      masterBackupsReopened:false
    }
  };
  console.log(JSON.stringify(out,null,2)); return out;
}
function qboFeObsUWMap_(sh){
  if(!sh)throw new Error('Required sheet missing.');
  const a=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0],m={};
  a.forEach(function(v,i){const k=String(v||'').trim();if(k)m[k]=i;});return m;
}
function qboFeObsUWReq_(m,a,n){a.forEach(function(k){if(m[k]===undefined)throw new Error(n+' missing '+k);});}
function qboFeObsUWRow_(sh,row,m){
  const v=sh.getRange(row,1,1,sh.getLastColumn()).getValues()[0],o={};
  Object.keys(m).forEach(function(k){o[k]=v[m[k]];});return o;
}
function qboFeObsUWNullable_(v){
  if(v===''||v===null||v===undefined)return null;
  const n=Number(v);return Number.isFinite(n)?n:String(v);
}
function qboFeObsUWOpenRunHistory_(){
  if(typeof getQboRunHistorySpreadsheet_==='function')return getQboRunHistorySpreadsheet_();
  if(typeof openQboRunHistorySpreadsheet_==='function')return openQboRunHistorySpreadsheet_();
  if(typeof QBO_RUN_HISTORY_CONFIG!=='undefined'&&QBO_RUN_HISTORY_CONFIG.SPREADSHEET_ID)return SpreadsheetApp.openById(QBO_RUN_HISTORY_CONFIG.SPREADSHEET_ID);
  if(typeof QBO_RUN_HISTORY!=='undefined'&&QBO_RUN_HISTORY.SPREADSHEET_ID)return SpreadsheetApp.openById(QBO_RUN_HISTORY.SPREADSHEET_ID);
  throw new Error('Unable to resolve run-history workbook.');
}
function qboFeObsUWOpenStateCapture_(){
  if(typeof getQboStateCaptureSpreadsheet_==='function')return getQboStateCaptureSpreadsheet_();
  if(typeof openQboStateCaptureSpreadsheet_==='function')return openQboStateCaptureSpreadsheet_();
  if(typeof QBO_STATE_CAPTURE_CONFIG!=='undefined'&&QBO_STATE_CAPTURE_CONFIG.SPREADSHEET_ID)return SpreadsheetApp.openById(QBO_STATE_CAPTURE_CONFIG.SPREADSHEET_ID);
  if(typeof QBO_STATE_CAPTURE!=='undefined'&&QBO_STATE_CAPTURE.SPREADSHEET_ID)return SpreadsheetApp.openById(QBO_STATE_CAPTURE.SPREADSHEET_ID);
  throw new Error('Unable to resolve State Capture workbook.');
}
