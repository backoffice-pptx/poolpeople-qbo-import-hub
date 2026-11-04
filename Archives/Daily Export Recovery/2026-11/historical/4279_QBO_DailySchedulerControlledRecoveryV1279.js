/** V1279 controlled daily-only pause and finalization. No Phase G mutation. */
function previewQboDailyV1279() {
  var p=PropertiesService.getScriptProperties(), k=DAILY_QBO_QUEUE_PROPERTIES;
  var runId=p.getProperty(k.RUN_ID)||'', active=getActiveDailyQboWorkerState_(p);
  var base=previewQboDailySchedulerReconciliationV1278();
  var out={version:'1.5.279',mode:'READ_ONLY',paused:p.getProperty(QBO_DAILY_V1279_PAUSE_KEY)==='true',runId:runId,
    activeTokenPresent:!!active,activeAgeMs:active&&active.startedAtMs?Date.now()-active.startedAtMs:null,
    completeEvidence:base.completedWithMetadata,missing:base.missingCompletedEvidence,
    latestInvoiceAttempt:base.latestInvoiceAttempt,continuationTriggers:base.nextTriggers.length};
  console.log('[DAILY V1279] | PREVIEW | '+JSON.stringify(out));return out;
}
/** Manual: suppress future claims; does not interrupt an in-flight exporter. */
function quiesceQboDailyV1279() {
  var lock=getDailyQboSchedulerLock_();lock.waitLock(30000);
  try {
    var p=PropertiesService.getScriptProperties();
    p.setProperty(QBO_DAILY_V1279_PAUSE_KEY,'true');
    deleteManagedNextQboTriggers_();
    console.warn('[DAILY V1279] | QUIESCED | runId='+String(p.getProperty(DAILY_QBO_QUEUE_PROPERTIES.RUN_ID)||'')+' | activeClaimPreserved=true');
  } finally {lock.releaseLock();}
}
/** Manual finalization: fail closed unless worker claim is absent and all evidence is stable. */
function finalizeQboDailyV1279() {
  var expected='4363b654-e07a-4578-971b-1fe6198e6828';
  var lock=getDailyQboSchedulerLock_();lock.waitLock(30000);
  try {
    var p=PropertiesService.getScriptProperties(),k=DAILY_QBO_QUEUE_PROPERTIES;
    if(p.getProperty(QBO_DAILY_V1279_PAUSE_KEY)!=='true') throw Error('Scheduler not paused');
    if(p.getProperty(k.RUN_ID)!==expected) throw Error('Unexpected run ID');
    if(String(p.getProperty(k.INDEX))!=='21') throw Error('Unexpected queue index');
    if(getActiveDailyQboWorkerState_(p)) throw Error('Active claim still present; do not force-clear');
    if(Number(p.getProperty(k.FAILED_COUNT)||0)!==0) throw Error('Failed count nonzero');
    var ss=getQboRunHistorySpreadsheet_(), rs=ss.getSheetByName(QBO_RUN_HISTORY.RUNS_SHEET),es=ss.getSheetByName(QBO_RUN_HISTORY.EXPORTS_SHEET);
    var rr=rs.getDataRange().getValues(),er=es.getDataRange().getValues(),run=null,completed={},latest={};
    for(var i=1;i<rr.length;i++)if(String(rr[i][0])===expected)run=rr[i];
    if(!run||String(run[3])!=='RUNNING'||Number(run[4])!==22||Number(run[6])!==0)throw Error('Unexpected run history');
    for(var j=1;j<er.length;j++)if(String(er[j][0])===expected){
      var r=er[j],key=String(r[2]);latest[key]=r;
      if(String(r[6])==='COMPLETE'&&r[9]&&r[10]&&r[11]!==''&&r[11]!==null)completed[key]=true;
    }
    var missing=DAILY_QBO_EXPORT_ORDER.filter(function(key){return !completed[key];});
    if(missing.length)throw Error('Missing completed exports: '+missing.join(','));
    if(!latest.INVOICES||String(latest.INVOICES[6])!=='COMPLETE')throw Error('Latest INVOICES attempt is not COMPLETE');
    if(ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()===DAILY_QBO_TRIGGER_HANDLERS.NEXT;}))throw Error('Continuation trigger exists');
    // Commit history first; if that fails, queue remains paused and intact.
    recordQboScheduledRunComplete_(expected,new Date(),22,0);
    clearDailyQboQueueState_();
    console.warn('[DAILY V1279] | FINALIZED | runId='+expected+' | exports=22 | paused=true');
  } finally {lock.releaseLock();}
}
/** Explicit later action, only after verifying final run and scheduler starter readiness. */
function unpauseQboDailyV1279() {
  var lock=getDailyQboSchedulerLock_();lock.waitLock(30000);
  try {
    var p=PropertiesService.getScriptProperties();
    if(p.getProperty(DAILY_QBO_QUEUE_PROPERTIES.RUN_ID))throw Error('Queue still initialized');
    p.deleteProperty(QBO_DAILY_V1279_PAUSE_KEY);
    console.warn('[DAILY V1279] | UNPAUSED | no triggers installed by this action');
  }finally{lock.releaseLock();}
}
