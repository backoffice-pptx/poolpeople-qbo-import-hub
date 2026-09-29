/**
 * Module  : 4037_QBO_FullExportObservationCountApplyRecoveryStateDiagnostic.js
 * Version : 1.5.157
 * Purpose : Read-only physical-state diagnostic for candidates 216-218 after
 *           the v1.5.155 fail-closed stop and v1.5.156 recovery refusal.
 *
 * Operator:
 *   diagnoseQboFullExportObservationCountApplyRecoveryStateV157()
 *
 * Safety: no production writes, locks, workbook write lease, trigger mutation,
 *         apply-state mutation, or source creation.
 */
const QBO_FE_OBS_RECOVERY_DIAG_ = Object.freeze({
  VERSION:'1.5.157',
  PREVIEW_STATE_KEY:'QBO_FE_OBS_HIST_PREVIEW_V148_STATE',
  PREVIEW_RESULT_PREFIX:'QBO_FE_OBS_HIST_PREVIEW_V148_RESULT_',
  APPLY_STATE_KEY:'QBO_FE_OBS_HIST_APPLY_V155_STATE',
  HISTORY_SHEET:'QBO_ExportRunHistory',
  SOURCE_SHEET:'01_Sources',
  TARGETS:Object.freeze([216,217,218])
});

function diagnoseQboFullExportObservationCountApplyRecoveryStateV157() {
  const C=QBO_FE_OBS_RECOVERY_DIAG_, p=PropertiesService.getScriptProperties();
  const psRaw=p.getProperty(C.PREVIEW_STATE_KEY);
  const asRaw=p.getProperty(C.APPLY_STATE_KEY);
  if(!psRaw)throw new Error('Frozen preview state missing.');
  if(!asRaw)throw new Error('Apply state missing.');
  const ps=JSON.parse(psRaw), as=JSON.parse(asRaw);

  const hs=qboFeObsRDiagOpenRunHistory_().getSheetByName(C.HISTORY_SHEET);
  const ss=qboFeObsRDiagOpenStateCapture_().getSheetByName(C.SOURCE_SHEET);
  const hm=qboFeObsRDiagMap_(hs), sm=qboFeObsRDiagMap_(ss);
  qboFeObsRDiagReq_(hm,['RunId','ExportKey','Status','MasterBackupFileId','MasterBackupFileName','ObservationCount'],C.HISTORY_SHEET);
  qboFeObsRDiagReq_(sm,['SourceId','SourceRunId','ExportKey','MasterBackupFileId','MasterBackupFileName','ObservationCount'],C.SOURCE_SHEET);

  const results=C.TARGETS.map(function(i){
    const raw=p.getProperty(C.PREVIEW_RESULT_PREFIX+ps.previewRunId+'_'+i);
    if(!raw)return {candidateIndex:i,error:'MISSING_FROZEN_RESULT'};
    const r=JSON.parse(raw);
    const runId=String(r.runId||r.sourceRunId||'').trim();
    const hr=qboFeObsRDiagRow_(hs,Number(r.historyRow),hm);
    const src=qboFeObsRDiagFind_(ss,sm,String(r.sourceId||''));
    return {
      candidateIndex:i,
      frozen:{
        runId:runId, exportKey:String(r.exportKey||''),
        sourceId:String(r.sourceId||''),
        historyRow:Number(r.historyRow), sourceRow:Number(r.sourceRow),
        masterBackupFileId:String(r.masterBackupFileId||''),
        masterBackupFileName:String(r.masterBackupFileName||''),
        derivedObservationCount:Number(r.derivedObservationCount),
        historyDisposition:r.historyDisposition,
        sourceDisposition:r.sourceDisposition
      },
      currentHistory:{
        runId:String(hr.RunId||'').trim(),
        exportKey:String(hr.ExportKey||'').trim(),
        status:String(hr.Status||'').trim(),
        masterBackupFileId:String(hr.MasterBackupFileId||'').trim(),
        masterBackupFileName:String(hr.MasterBackupFileName||'').trim(),
        observationCount:qboFeObsRDiagNullable_(hr.ObservationCount),
        identityMatchesFrozen:
          String(hr.RunId||'').trim()===runId &&
          String(hr.ExportKey||'').trim()===String(r.exportKey||'') &&
          String(hr.MasterBackupFileId||'').trim()===String(r.masterBackupFileId||'') &&
          String(hr.MasterBackupFileName||'').trim()===String(r.masterBackupFileName||'')
      },
      currentSourceRows:src.map(function(x){
        return {
          rowNumber:x.rowNumber,
          sourceId:x.SourceId, sourceRunId:x.SourceRunId, exportKey:x.ExportKey,
          masterBackupFileId:x.MasterBackupFileId,
          masterBackupFileName:x.MasterBackupFileName,
          observationCount:qboFeObsRDiagNullable_(x.ObservationCount),
          rowMatchesFrozen:x.rowNumber===Number(r.sourceRow),
          coreIdentityMatchesFrozen:x.SourceRunId===runId && x.ExportKey===String(r.exportKey||''),
          lineageMatchesFrozen:
            x.MasterBackupFileId===String(r.masterBackupFileId||'') &&
            x.MasterBackupFileName===String(r.masterBackupFileName||''),
          observationCountEqualsFrozenDerived:
            qboFeObsRDiagNullable_(x.ObservationCount)===Number(r.derivedObservationCount)
        };
      }),
      exactSourceIdMatchCount:src.length
    };
  });

  const out={
    version:C.VERSION,
    operation:'READ_ONLY_APPLY_RECOVERY_PHYSICAL_STATE_DIAGNOSTIC',
    sourcePreview:{previewRunId:ps.previewRunId,frozenAt:ps.frozenAt,status:ps.status},
    persistedApplyState:{
      version:as.version,applyRunId:as.applyRunId,cursor:as.cursor,status:as.status,
      historyWrites:as.historyWrites,sourceWrites:as.sourceWrites,
      controlledTestMissingSourceExclusions:as.controlledTestMissingSourceExclusions,
      strandedRunMissingSourceExclusions:as.strandedRunMissingSourceExclusions,
      strandedRunLineageConflictExclusions:as.strandedRunLineageConflictExclusions,
      error:as.error,failedAt:as.failedAt
    },
    results:results,
    safety:{
      productionWritesPerformed:false,applyStateMutationPerformed:false,
      locksAcquired:false,workbookWriteLeaseAcquired:false,
      triggerMutationPerformed:false,sourceCreationPerformed:false,
      masterBackupsReopened:false
    }
  };
  console.log(JSON.stringify(out,null,2)); return out;
}
function qboFeObsRDiagMap_(sh){
  if(!sh)throw new Error('Required sheet missing.');
  const h=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0],m={};
  h.forEach(function(v,i){const k=String(v||'').trim();if(k)m[k]=i;});return m;
}
function qboFeObsRDiagReq_(m,a,n){a.forEach(function(k){if(m[k]===undefined)throw new Error(n+' missing '+k);});}
function qboFeObsRDiagRow_(sh,row,m){
  const v=sh.getRange(row,1,1,sh.getLastColumn()).getValues()[0],o={};
  Object.keys(m).forEach(function(k){o[k]=v[m[k]];});return o;
}
function qboFeObsRDiagFind_(sh,m,id){
  const n=sh.getLastRow();if(n<2)return[];
  const a=sh.getRange(2,1,n-1,sh.getLastColumn()).getValues(),out=[];
  for(let i=0;i<a.length;i++){
    if(String(a[i][m.SourceId]||'').trim()===id)out.push({
      rowNumber:i+2,
      SourceId:String(a[i][m.SourceId]||'').trim(),
      SourceRunId:String(a[i][m.SourceRunId]||'').trim(),
      ExportKey:String(a[i][m.ExportKey]||'').trim(),
      MasterBackupFileId:String(a[i][m.MasterBackupFileId]||'').trim(),
      MasterBackupFileName:String(a[i][m.MasterBackupFileName]||'').trim(),
      ObservationCount:a[i][m.ObservationCount]
    });
  }
  return out;
}
function qboFeObsRDiagNullable_(v){
  if(v===''||v===null||v===undefined)return null;
  const n=Number(v); return Number.isFinite(n)?n:String(v);
}
function qboFeObsRDiagOpenRunHistory_(){
  if(typeof getQboRunHistorySpreadsheet_==='function')return getQboRunHistorySpreadsheet_();
  if(typeof openQboRunHistorySpreadsheet_==='function')return openQboRunHistorySpreadsheet_();
  if(typeof QBO_RUN_HISTORY_CONFIG!=='undefined'&&QBO_RUN_HISTORY_CONFIG.SPREADSHEET_ID)return SpreadsheetApp.openById(QBO_RUN_HISTORY_CONFIG.SPREADSHEET_ID);
  if(typeof QBO_RUN_HISTORY!=='undefined'&&QBO_RUN_HISTORY.SPREADSHEET_ID)return SpreadsheetApp.openById(QBO_RUN_HISTORY.SPREADSHEET_ID);
  throw new Error('Unable to resolve run-history workbook.');
}
function qboFeObsRDiagOpenStateCapture_(){
  if(typeof getQboStateCaptureSpreadsheet_==='function')return getQboStateCaptureSpreadsheet_();
  if(typeof openQboStateCaptureSpreadsheet_==='function')return openQboStateCaptureSpreadsheet_();
  if(typeof QBO_STATE_CAPTURE_CONFIG!=='undefined'&&QBO_STATE_CAPTURE_CONFIG.SPREADSHEET_ID)return SpreadsheetApp.openById(QBO_STATE_CAPTURE_CONFIG.SPREADSHEET_ID);
  if(typeof QBO_STATE_CAPTURE!=='undefined'&&QBO_STATE_CAPTURE.SPREADSHEET_ID)return SpreadsheetApp.openById(QBO_STATE_CAPTURE.SPREADSHEET_ID);
  throw new Error('Unable to resolve State Capture workbook.');
}
