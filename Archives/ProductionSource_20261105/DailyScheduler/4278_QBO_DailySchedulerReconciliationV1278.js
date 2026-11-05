/** App 50 V1278 — read-only daily scheduler reconciliation.
 * No property writes, trigger operations, workbook writes, exporter calls,
 * or recovery/finalization actions. Review output before any repair.
 */
function previewQboDailySchedulerReconciliationV1278() {
  var props = PropertiesService.getScriptProperties();
  var keys = DAILY_QBO_QUEUE_PROPERTIES;
  var runId = String(props.getProperty(keys.RUN_ID) || '');
  var rawIndex = props.getProperty(keys.INDEX);
  var failed = Number(props.getProperty(keys.FAILED_COUNT) || '0');
  var active = getActiveDailyQboWorkerState_(props);
  var ss = getQboRunHistorySpreadsheet_();
  var runSheet = ss.getSheetByName(QBO_RUN_HISTORY.RUNS_SHEET);
  var expSheet = ss.getSheetByName(QBO_RUN_HISTORY.EXPORTS_SHEET);
  var statusSheet = ss.getSheetByName(QBO_RUN_HISTORY.STATUS_SHEET);
  if (!runSheet || !expSheet || !statusSheet) throw new Error('Run-history schema missing a required sheet.');
  var runRows = runSheet.getDataRange().getValues();
  var exportRows = expSheet.getDataRange().getValues();
  var statusRows = statusSheet.getDataRange().getValues();
  var selectedRunId = runId || '4363b654-e07a-4578-971b-1fe6198e6828';
  var run = null, attempts = [], latest = {}, completed = {};
  for (var i=1;i<runRows.length;i++) {
    if (String(runRows[i][0])===selectedRunId) run = {row:i+1,status:String(runRows[i][3]),total:Number(runRows[i][4]),completed:Number(runRows[i][5]),failed:Number(runRows[i][6]),position:Number(runRows[i][7]),currentExport:String(runRows[i][8]||''),lastUpdated:String(runRows[i][9]||'')};
  }
  for (var j=1;j<exportRows.length;j++) {
    var r=exportRows[j];
    if (String(r[0])!==selectedRunId) continue;
    var a={row:j+1,position:Number(r[1]),exportKey:String(r[2]),status:String(r[6]),snapshotId:String(r[9]||''),snapshotName:String(r[10]||''),observationCount:r[11]};
    attempts.push(a); latest[a.exportKey]=a;
    if(a.status==='COMPLETE' && a.snapshotId && a.snapshotName && r[11]!=='' && r[11]!==null) completed[a.exportKey]=true;
  }
  var statusInvoice=null;
  for(var k=1;k<statusRows.length;k++) if(String(statusRows[k][0])==='INVOICES') statusInvoice={runId:String(statusRows[k][2]||''),status:String(statusRows[k][5]||''),completedAt:String(statusRows[k][4]||'')};
  var expected=DAILY_QBO_EXPORT_ORDER.slice();
  var missing=expected.filter(function(key){return !completed[key];});
  var now=Date.now();
  var triggerSummary=ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()===DAILY_QBO_TRIGGER_HANDLERS.NEXT;}).map(function(t){return {handler:t.getHandlerFunction(),id:t.getUniqueId()};});
  var result={version:'1.5.278-preview',readOnly:true,selectedRunId:selectedRunId,queue:{runId:runId,index:rawIndex,failedCount:failed,active:active?{index:active.index,exportKey:active.exportKey,startedAt:active.startedAt,ageMs:active.startedAtMs?now-active.startedAtMs:null,tokenPresent:!!active.token}:null},history:run,expectedExports:expected.length,completedWithMetadata:Object.keys(completed).length,missingCompletedEvidence:missing,invoiceAttempts:attempts.filter(function(a){return a.exportKey==='INVOICES';}),latestInvoiceAttempt:latest.INVOICES||null,latestInvoiceStatus:statusInvoice,nextTriggers:triggerSummary,assessment:(missing.length===0 && run && run.status==='RUNNING')?'HISTORY_RUNNING_ALL_EXPORTS_HAVE_COMPLETION_EVIDENCE':'REQUIRES_REVIEW',safeToAutoFinalize:false};
  console.log('[DAILY SCHEDULER V1278] | READ_ONLY | '+JSON.stringify(result));
  return result;
}
