/** App 50 V1282 — read-only recovery decision contract. No mutations.
 * Relies on installed V1278 reconciliation and V1281 liveness preview.
 * IMPORTANT: Apps Script cannot prove an execution has stopped from a claim age.
 */
function qboDailyV1282Decide_(s) {
  if (!s.paused) return 'BLOCK_NOT_PAUSED';
  if (s.activeClaim) return 'BLOCK_ACTIVE_CLAIM_LIVENESS_UNVERIFIED';
  if (s.continuations !== 0) return 'BLOCK_CONTINUATION_PRESENT';
  if (s.runId && !s.history) return 'BLOCK_MISSING_RUN_HISTORY';
  if (s.runId && s.history.status === 'COMPLETE') return 'BLOCK_QUEUE_HISTORY_CONFLICT';
  if (!s.runId && s.history && s.history.status === 'COMPLETE') return 'IDLE_COMPLETE_NO_ACTION';
  if (!s.runId) return 'IDLE_NO_ACTION';
  if (s.history.status !== 'RUNNING') return 'BLOCK_UNEXPECTED_RUN_STATUS';
  if (s.failed !== 0) return 'BLOCK_FAILED_EXPORTS_REQUIRE_REVIEW';
  if (s.missing.length) return 'REVIEW_MISSING_COMPLETION_EVIDENCE';
  if (s.history.total !== s.expected || s.history.completed > s.expected) return 'BLOCK_HISTORY_COUNT_MISMATCH';
  return 'CANDIDATE_RECONCILE_ONLY_MANUAL_EXECUTION_VERIFICATION_REQUIRED';
}
function previewQboDailyRecoveryContractV1282() {
  var base = previewQboDailySchedulerReconciliationV1278();
  var props = PropertiesService.getScriptProperties();
  var paused = props.getProperty(QBO_DAILY_V1279_PAUSE_KEY) === 'true';
  var active = getActiveDailyQboWorkerState_(props);
  var state = {
    paused: paused, runId: base.queue.runId, activeClaim: !!active,
    continuations: base.nextTriggers.length, history: base.history,
    failed: base.queue.failedCount, missing: base.missingCompletedEvidence,
    expected: base.expectedExports
  };
  var out = {
    version:'1.5.282-preview',readOnly:true,
    decision:qboDailyV1282Decide_(state),runId:base.selectedRunId,
    paused:paused,activeClaimPresent:!!active,
    executionLivenessVerified:false,continuationTriggers:state.continuations,
    historyStatus:base.history ? base.history.status : null,
    historyCompleted:base.history ? base.history.completed : null,
    expectedExports:base.expectedExports,
    missingCompletedEvidence:base.missingCompletedEvidence,
    nextStep:'NO_AUTOMATIC_RETRY_OR_FINALIZATION_AUTHORIZED'
  };
  console.log('[DAILY V1282] | READ_ONLY | '+JSON.stringify(out));
  return out;
}
function testQboDailyRecoveryDecisionV1282() {
  var base={paused:true,runId:'R',activeClaim:false,continuations:0,
    history:{status:'RUNNING',total:22,completed:21},failed:0,missing:[],expected:22};
  var cases=[
    [{},'CANDIDATE_RECONCILE_ONLY_MANUAL_EXECUTION_VERIFICATION_REQUIRED'],
    [{paused:false},'BLOCK_NOT_PAUSED'],
    [{activeClaim:true},'BLOCK_ACTIVE_CLAIM_LIVENESS_UNVERIFIED'],
    [{continuations:1},'BLOCK_CONTINUATION_PRESENT'],
    [{history:null},'BLOCK_MISSING_RUN_HISTORY'],
    [{history:{status:'COMPLETE',total:22,completed:22}},'BLOCK_QUEUE_HISTORY_CONFLICT'],
    [{runId:'',history:{status:'COMPLETE',total:22,completed:22}},'IDLE_COMPLETE_NO_ACTION'],
    [{runId:'',history:null},'IDLE_NO_ACTION'],
    [{failed:1},'BLOCK_FAILED_EXPORTS_REQUIRE_REVIEW'],
    [{missing:['INVOICES']},'REVIEW_MISSING_COMPLETION_EVIDENCE'],
    [{history:{status:'RUNNING',total:21,completed:21}},'BLOCK_HISTORY_COUNT_MISMATCH']
  ];
  cases.forEach(function(test,i){
    var s=Object.assign({},base,test[0]);
    var actual=qboDailyV1282Decide_(s);
    if(actual!==test[1]) throw new Error('V1282 case '+i+' expected '+test[1]+' got '+actual);
  });
  var out={version:'1.5.282-test',readOnly:true,casesPassed:cases.length,mutations:0};
  console.log('[DAILY V1282] | TEST PASS | '+JSON.stringify(out));
  return out;
}
