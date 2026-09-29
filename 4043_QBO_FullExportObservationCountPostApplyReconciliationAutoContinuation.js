/**
 * Module  : 4043_QBO_FullExportObservationCountPostApplyReconciliationAutoContinuation.js
 * Version : 1.5.164
 * Purpose : Adds one-chain automatic continuation to the already-running
 *           v1.5.163 bounded/read-only post-apply reconciliation.
 *
 * IMPORTANT:
 *   - Does NOT reset or replace v1.5.163 state.
 *   - Existing cursor/progress (currently 24+) remains authoritative.
 *   - Each worker invocation still uses the v1.5.163 12-candidate /
 *     150-second bounded worker.
 *   - At most one continuation trigger for this reconciliation is retained.
 *   - When reconciliation reaches COMPLETE, continuation triggers are removed.
 *
 * Operator:
 *   enableQboFullExportObservationCountPostApplyAutoContinuationV164()
 *
 * Trigger worker:
 *   qboFullExportObservationCountPostApplyAutoContinuationV164()
 */

const QBO_FE_OBS_POST_RECON_AUTO_V164_ = Object.freeze({
  VERSION:'1.5.164',
  HANDLER:'qboFullExportObservationCountPostApplyAutoContinuationV164',
  DELAY_MS:60000
});

function enableQboFullExportObservationCountPostApplyAutoContinuationV164(){
  const A=QBO_FE_OBS_POST_RECON_AUTO_V164_;
  const st=qboFeObsPostReconAutoV164State_();
  qboFeObsApplyRequireDailyPaused_();

  if(st.status==='COMPLETE'){
    qboFeObsPostReconAutoV164ClearTriggers_();
    console.log(JSON.stringify({
      version:A.VERSION,status:'ALREADY_COMPLETE',cursor:st.cursor,candidateCount:st.candidateCount,
      continuationTriggerCount:0
    },null,2));
    return st;
  }
  if(st.status!=='RUNNING') throw new Error('v1.5.163 reconciliation must be RUNNING; current status='+st.status);

  qboFeObsPostReconAutoV164EnsureSingleTrigger_();
  const out={
    version:A.VERSION,status:'AUTO_CONTINUATION_ENABLED',
    reconciliationVersion:st.version,cursor:st.cursor,candidateCount:st.candidateCount,
    nextHandler:A.HANDLER,delayMs:A.DELAY_MS,
    continuationTriggerCount:qboFeObsPostReconAutoV164Triggers_().length,
    safety:{productionDataWritesPerformed:false,reconciliationStateReset:false}
  };
  console.log(JSON.stringify(out,null,2));
  return out;
}

function qboFullExportObservationCountPostApplyAutoContinuationV164(){
  const A=QBO_FE_OBS_POST_RECON_AUTO_V164_;
  // Consume this invocation's one-shot trigger before scheduling another.
  qboFeObsPostReconAutoV164ClearTriggers_();

  let st=qboFeObsPostReconAutoV164State_();
  qboFeObsApplyRequireDailyPaused_();

  if(st.status==='COMPLETE'){
    console.log(JSON.stringify({version:A.VERSION,status:'COMPLETE_NO_CONTINUATION',cursor:st.cursor},null,2));
    return st;
  }
  if(st.status!=='RUNNING') throw new Error('Reconciliation is not runnable; status='+st.status);

  st=continueQboFullExportObservationCountPostApplyReconciliationV163();

  if(st.status==='RUNNING'){
    qboFeObsPostReconAutoV164EnsureSingleTrigger_();
  }else if(st.status==='COMPLETE'){
    qboFeObsPostReconAutoV164ClearTriggers_();
  }else{
    throw new Error('Unexpected reconciliation status after worker: '+st.status);
  }

  console.log(JSON.stringify({
    version:A.VERSION,status:st.status,cursor:st.cursor,candidateCount:st.candidateCount,
    findingCount:st.findingCount,
    continuationTriggerCount:qboFeObsPostReconAutoV164Triggers_().length
  },null,2));
  return st;
}

function qboFeObsPostReconAutoV164State_(){
  const R=QBO_FE_OBS_POST_RECON_V163_;
  const raw=PropertiesService.getScriptProperties().getProperty(R.STATE_KEY);
  if(!raw) throw new Error('v1.5.163 reconciliation state not found.');
  return JSON.parse(raw);
}

function qboFeObsPostReconAutoV164Triggers_(){
  const h=QBO_FE_OBS_POST_RECON_AUTO_V164_.HANDLER;
  return ScriptApp.getProjectTriggers().filter(function(t){
    return t.getHandlerFunction()===h;
  });
}

function qboFeObsPostReconAutoV164ClearTriggers_(){
  qboFeObsPostReconAutoV164Triggers_().forEach(function(t){ScriptApp.deleteTrigger(t);});
}

function qboFeObsPostReconAutoV164EnsureSingleTrigger_(){
  const A=QBO_FE_OBS_POST_RECON_AUTO_V164_, ts=qboFeObsPostReconAutoV164Triggers_();
  if(ts.length===1) return;
  ts.forEach(function(t){ScriptApp.deleteTrigger(t);});
  ScriptApp.newTrigger(A.HANDLER).timeBased().after(A.DELAY_MS).create();
}
