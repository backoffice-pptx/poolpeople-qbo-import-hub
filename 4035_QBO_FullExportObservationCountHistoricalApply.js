/**
 * Module  : 4035_QBO_FullExportObservationCountHistoricalApply.js
 * Version : 1.5.156
 * Patch   : Correct stranded-run lineage-conflict recognition by using the
 *           frozen preview's sourceRunId/runId compatibility and preserve
 *           controlled recovery state.
 *
 * Operators:
 *   startQboFullExportObservationCountHistoricalApply()
 *   continueQboFullExportObservationCountHistoricalApply()
 *   statusQboFullExportObservationCountHistoricalApply()
 */
const QBO_FE_OBS_HIST_APPLY_ = Object.freeze({
  VERSION:'1.5.156',
  PREVIEW_STATE_KEY:'QBO_FE_OBS_HIST_PREVIEW_V148_STATE',
  PREVIEW_RESULT_PREFIX:'QBO_FE_OBS_HIST_PREVIEW_V148_RESULT_',
  APPLY_STATE_KEY:'QBO_FE_OBS_HIST_APPLY_V155_STATE',
  HISTORY_SHEET:'QBO_ExportRunHistory',
  SOURCE_SHEET:'01_Sources',
  MAX_CANDIDATES_PER_EXECUTION:40,
  MAX_RUNTIME_MS:210000,
  STRANDED_RUN_ID:'9ff6e204-18d8-4f81-b965-7749429886b3',
  LINEAGE_CONFLICT_EXPORT_KEYS:Object.freeze(['DEPOSITS','CREDIT_MEMOS','JOURNAL_ENTRIES'])
});

function startQboFullExportObservationCountHistoricalApply() {
  const C=QBO_FE_OBS_HIST_APPLY_, p=PropertiesService.getScriptProperties();
  if(p.getProperty(C.APPLY_STATE_KEY))throw new Error('Apply state already exists. Use continue/status; do not refreeze.');
  const ps=qboFeObsApplyLoadPreview_();
  const state={version:C.VERSION,operation:'CONTROLLED_HISTORICAL_OBSERVATIONCOUNT_APPLY',
    applyRunId:'FE_OBS_HIST_APPLY_'+Utilities.getUuid(),previewRunId:ps.previewRunId,previewFrozenAt:ps.frozenAt,
    candidateCount:Number(ps.candidateCount),cursor:0,status:'RUNNING',historyWrites:0,sourceWrites:0,
    historyAlreadyMatches:0,sourceAlreadyMatches:0,controlledTestMissingSourceExclusions:0,
    strandedRunMissingSourceExclusions:0,strandedRunLineageConflictExclusions:0,
    startedAt:new Date().toISOString(),lastProgressAt:null,completedAt:null,error:null};
  p.setProperty(C.APPLY_STATE_KEY,JSON.stringify(state)); return qboFeObsApplyWorker_();
}
function continueQboFullExportObservationCountHistoricalApply(){return qboFeObsApplyWorker_();}
function statusQboFullExportObservationCountHistoricalApply(){
  const raw=PropertiesService.getScriptProperties().getProperty(QBO_FE_OBS_HIST_APPLY_.APPLY_STATE_KEY);
  const out=raw?JSON.parse(raw):{status:'NOT_STARTED',version:QBO_FE_OBS_HIST_APPLY_.VERSION};
  console.log(JSON.stringify(out,null,2));return out;
}
function qboFeObsApplyWorker_(){
  const C=QBO_FE_OBS_HIST_APPLY_,p=PropertiesService.getScriptProperties();
  let st=JSON.parse(p.getProperty(C.APPLY_STATE_KEY)||'null');
  if(!st)throw new Error('Apply not started.');
  if(st.status==='COMPLETE'){console.log(JSON.stringify(st,null,2));return st;}
  if(st.status==='FAILED')throw new Error('Apply is FAILED: '+st.error);
  const ps=qboFeObsApplyLoadPreview_();
  if(st.previewRunId!==ps.previewRunId||st.candidateCount!==Number(ps.candidateCount))return qboFeObsApplyFail_(st,'Frozen preview identity changed.');
  qboFeObsApplyRequireDailyPaused_();
  const hs=qboFeObsApplyOpenRunHistory_().getSheetByName(C.HISTORY_SHEET),ss=qboFeObsApplyOpenStateCapture_().getSheetByName(C.SOURCE_SHEET);
  if(!hs||!ss)return qboFeObsApplyFail_(st,'Required target sheet missing.');
  const hm=qboFeObsApplyHeaderMap_(hs),sm=qboFeObsApplyHeaderMap_(ss);
  qboFeObsApplyRequire_(hm,['RunId','ExportKey','Status','MasterBackupFileId','MasterBackupFileName','ObservationCount'],C.HISTORY_SHEET);
  qboFeObsApplyRequire_(sm,['SourceId','SourceRunId','ExportKey','MasterBackupFileId','MasterBackupFileName','ObservationCount'],C.SOURCE_SHEET);
  const started=Date.now(),stop=Math.min(st.candidateCount,st.cursor+C.MAX_CANDIDATES_PER_EXECUTION);
  try{
    while(st.cursor<stop&&Date.now()-started<C.MAX_RUNTIME_MS){
      const i=st.cursor,rr=p.getProperty(C.PREVIEW_RESULT_PREFIX+st.previewRunId+'_'+i);
      if(!rr)throw new Error('Missing frozen result candidate '+i);
      const r=JSON.parse(rr), frozenRun=qboFeObsApplyFrozenRunId_(r);

      if(r.kind==='RUN_HISTORY'){
        const row=qboFeObsApplyReadRow_(hs,Number(r.historyRow),hm);qboFeObsApplyAssertHistoryIdentity_(row,r);
        const hv=qboFeObsApplyNullable_(row.ObservationCount);
        if(r.historyDisposition==='PROPOSE_WRITE'){
          if(hv===null){qboFeObsApplyWriteVerify_(hs,Number(r.historyRow),hm.ObservationCount+1,Number(r.derivedObservationCount));st.historyWrites++;}
          else if(hv===Number(r.derivedObservationCount)){st.historyAlreadyMatches++;}
          else throw new Error('History ObservationCount drift candidate '+i);
        }else if(r.historyDisposition==='ALREADY_MATCHES'){
          if(hv!==Number(r.derivedObservationCount))throw new Error('History prior match drift candidate '+i);st.historyAlreadyMatches++;
        }
      }

      if(r.sourceDisposition==='SOURCE_MISSING'){
        if(qboFeObsApplyFindSourceRows_(ss,sm,r.sourceId).length)throw new Error('Excluded missing source now present candidate '+i);
        if(frozenRun.indexOf('STATE_CAPTURE_AUTOREG_TEST_')===0)st.controlledTestMissingSourceExclusions++;
        else if(frozenRun===C.STRANDED_RUN_ID)st.strandedRunMissingSourceExclusions++;
        else throw new Error('Unclassified missing source candidate '+i);
      }else if(r.sourceDisposition==='PROPOSE_WRITE'||r.sourceDisposition==='ALREADY_MATCHES'){
        const rows=qboFeObsApplyFindSourceRows_(ss,sm,r.sourceId);
        if(rows.length!==1)throw new Error('Source cardinality drift candidate '+i);
        const sr=rows[0];
        if(sr.rowNumber!==Number(r.sourceRow)||sr.SourceRunId!==frozenRun||sr.ExportKey!==String(r.exportKey||''))throw new Error('Source core identity drift candidate '+i);
        const lineageMatch=sr.MasterBackupFileId===String(r.masterBackupFileId||'')&&sr.MasterBackupFileName===String(r.masterBackupFileName||'');
        if(!lineageMatch){
          if(frozenRun===C.STRANDED_RUN_ID&&C.LINEAGE_CONFLICT_EXPORT_KEYS.indexOf(String(r.exportKey||''))>=0&&r.sourceDisposition==='PROPOSE_WRITE'&&qboFeObsApplyNullable_(sr.ObservationCount)===null){
            st.strandedRunLineageConflictExclusions++;
          }else throw new Error('Unrecognized source lineage drift candidate '+i);
        }else{
          const sv=qboFeObsApplyNullable_(sr.ObservationCount);
          if(r.sourceDisposition==='PROPOSE_WRITE'){
            if(sv===null){qboFeObsApplyWriteVerify_(ss,sr.rowNumber,sm.ObservationCount+1,Number(r.derivedObservationCount));st.sourceWrites++;}
            else if(sv===Number(r.derivedObservationCount)){st.sourceAlreadyMatches++;}
            else throw new Error('Source ObservationCount drift candidate '+i);
          }else{
            if(sv!==Number(r.derivedObservationCount))throw new Error('Source prior match drift candidate '+i);st.sourceAlreadyMatches++;
          }
        }
      }
      st.cursor=i+1;st.lastProgressAt=new Date().toISOString();p.setProperty(C.APPLY_STATE_KEY,JSON.stringify(st));
    }
    if(st.cursor>=st.candidateCount){qboFeObsApplyValidateFinal_(st);st.status='COMPLETE';st.completedAt=new Date().toISOString();p.setProperty(C.APPLY_STATE_KEY,JSON.stringify(st));}
    console.log(JSON.stringify(st,null,2));return st;
  }catch(e){st.status='FAILED';st.error=String(e&&e.message?e.message:e);st.failedAt=new Date().toISOString();p.setProperty(C.APPLY_STATE_KEY,JSON.stringify(st));console.log(JSON.stringify(st,null,2));throw e;}
}
function qboFeObsApplyFrozenRunId_(r){return String(r.runId||r.sourceRunId||'').trim();}
function qboFeObsApplyValidateFinal_(st){
  const historyCovered=st.historyWrites+st.historyAlreadyMatches,sourceCovered=st.sourceWrites+st.sourceAlreadyMatches;
  if(historyCovered!==315)throw new Error('Final history coverage mismatch: '+historyCovered);
  if(sourceCovered!==334)throw new Error('Final source coverage mismatch: '+sourceCovered);
  if(st.controlledTestMissingSourceExclusions!==2)throw new Error('Controlled-test exclusion mismatch.');
  if(st.strandedRunMissingSourceExclusions!==2)throw new Error('Stranded missing-source exclusion mismatch.');
  if(st.strandedRunLineageConflictExclusions!==3)throw new Error('Stranded lineage-conflict exclusion mismatch.');
}
function qboFeObsApplyLoadPreview_(){const C=QBO_FE_OBS_HIST_APPLY_,raw=PropertiesService.getScriptProperties().getProperty(C.PREVIEW_STATE_KEY);if(!raw)throw new Error('Frozen preview state missing.');const s=JSON.parse(raw);if(s.status!=='COMPLETE'||Number(s.processedCount)!==Number(s.candidateCount))throw new Error('Frozen preview not COMPLETE.');return s;}
function qboFeObsApplyWriteVerify_(sh,row,col,value){const cell=sh.getRange(row,col),before=qboFeObsApplyNullable_(cell.getValue());if(before!==null&&before!==value)throw new Error('Target cell changed before write '+sh.getName()+'!R'+row+'C'+col);if(before===null){cell.setValue(value);SpreadsheetApp.flush();}const after=qboFeObsApplyNullable_(cell.getValue());if(after!==value)throw new Error('Post-write verification failed '+sh.getName()+'!R'+row+'C'+col);}
function qboFeObsApplyHeaderMap_(sh){const a=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0],m={};a.forEach(function(x,i){const h=String(x||'').trim();if(h)m[h]=i;});return m;}
function qboFeObsApplyReadRow_(sh,row,m){const v=sh.getRange(row,1,1,sh.getLastColumn()).getValues()[0],o={};Object.keys(m).forEach(function(k){o[k]=v[m[k]];});return o;}
function qboFeObsApplyAssertHistoryIdentity_(x,r){if(String(x.RunId||'').trim()!==qboFeObsApplyFrozenRunId_(r)||String(x.ExportKey||'').trim()!==String(r.exportKey||'')||String(x.Status||'').trim().toUpperCase()!=='COMPLETE'||String(x.MasterBackupFileId||'').trim()!==String(r.masterBackupFileId||'')||String(x.MasterBackupFileName||'').trim()!==String(r.masterBackupFileName||''))throw new Error('Run-history identity drift candidate '+qboFeObsApplyFrozenRunId_(r)+'|'+r.exportKey);}
function qboFeObsApplyFindSourceRows_(sh,m,id){const last=sh.getLastRow();if(last<2)return[];const vals=sh.getRange(2,1,last-1,sh.getLastColumn()).getValues(),out=[];for(let i=0;i<vals.length;i++)if(String(vals[i][m.SourceId]||'').trim()===String(id||'')){out.push({rowNumber:i+2,SourceRunId:String(vals[i][m.SourceRunId]||'').trim(),ExportKey:String(vals[i][m.ExportKey]||'').trim(),MasterBackupFileId:String(vals[i][m.MasterBackupFileId]||'').trim(),MasterBackupFileName:String(vals[i][m.MasterBackupFileName]||'').trim(),ObservationCount:vals[i][m.ObservationCount]});}return out;}
function qboFeObsApplyNullable_(v){return v===''||v===null||v===undefined?null:Number(v);}
function qboFeObsApplyRequire_(m,a,n){a.forEach(function(h){if(m[h]===undefined)throw new Error(n+' missing '+h);});}
function qboFeObsApplyFail_(st,msg){st.status='FAILED';st.error=msg;st.failedAt=new Date().toISOString();PropertiesService.getScriptProperties().setProperty(QBO_FE_OBS_HIST_APPLY_.APPLY_STATE_KEY,JSON.stringify(st));throw new Error(msg);}
function qboFeObsApplyRequireDailyPaused_(){let x=null;if(typeof getQboPipelineStatus==='function')x=getQboPipelineStatus('DAILY_FULL_EXPORT');else if(typeof getQboPipelineStatus_==='function')x=getQboPipelineStatus_('DAILY_FULL_EXPORT');else if(typeof qboGetPipelineStatus_==='function')x=qboGetPipelineStatus_('DAILY_FULL_EXPORT');else throw new Error('Governed DAILY_FULL_EXPORT status authority unavailable; refusing production apply.');const text=JSON.stringify(x||{});if(text.indexOf('PAUSED')<0||text.indexOf('ADMINISTRATIVELY_PAUSED_IDLE')<0)throw new Error('DAILY_FULL_EXPORT is not governed-paused idle; refusing production apply.');}
function qboFeObsApplyOpenRunHistory_(){if(typeof getQboRunHistorySpreadsheet_==='function')return getQboRunHistorySpreadsheet_();if(typeof openQboRunHistorySpreadsheet_==='function')return openQboRunHistorySpreadsheet_();if(typeof QBO_RUN_HISTORY_CONFIG!=='undefined'&&QBO_RUN_HISTORY_CONFIG.SPREADSHEET_ID)return SpreadsheetApp.openById(QBO_RUN_HISTORY_CONFIG.SPREADSHEET_ID);if(typeof QBO_RUN_HISTORY!=='undefined'&&QBO_RUN_HISTORY.SPREADSHEET_ID)return SpreadsheetApp.openById(QBO_RUN_HISTORY.SPREADSHEET_ID);throw new Error('Unable to resolve run-history workbook.');}
function qboFeObsApplyOpenStateCapture_(){if(typeof getQboStateCaptureSpreadsheet_==='function')return getQboStateCaptureSpreadsheet_();if(typeof openQboStateCaptureSpreadsheet_==='function')return openQboStateCaptureSpreadsheet_();if(typeof QBO_STATE_CAPTURE_CONFIG!=='undefined'&&QBO_STATE_CAPTURE_CONFIG.SPREADSHEET_ID)return SpreadsheetApp.openById(QBO_STATE_CAPTURE_CONFIG.SPREADSHEET_ID);if(typeof QBO_STATE_CAPTURE!=='undefined'&&QBO_STATE_CAPTURE.SPREADSHEET_ID)return SpreadsheetApp.openById(QBO_STATE_CAPTURE.SPREADSHEET_ID);throw new Error('Unable to resolve State Capture workbook.');}
