/** App 50 V1283: durable-checkpoint / ownership-fencing contract simulation.
 * ADDITIVE, READ-ONLY. No PropertiesService.setProperty, Sheets writes, triggers,
 * or exporter invocation. This does NOT make the existing scheduler recoverable.
 * State transitions are simulated as immutable input/output objects.
 */
function qboDailyV1283Transition_(state, event) {
  var s=JSON.parse(JSON.stringify(state));
  var e=event||{};
  function deny(reason){return {accepted:false,reason:reason,state:s};}
  function accept(action){return {accepted:true,action:action,state:s};}
  if(!s || !s.runId || !Number.isInteger(s.index) || s.index<0 || !Number.isInteger(s.total) || s.total<1) return deny('INVALID_STATE');
  if(e.runId!==s.runId) return deny('RUN_ID_MISMATCH');
  if(e.type==='CLAIM') {
    if(s.paused) return deny('PAUSED');
    if(s.active) return deny('ACTIVE_CLAIM_PRESENT');
    if(s.index>=s.total) return deny('ALREADY_AT_END');
    if(!e.token || !Number.isInteger(e.generation) || e.generation!==s.generation+1) return deny('INVALID_GENERATION');
    s.generation=e.generation;
    s.active={token:e.token,generation:e.generation,index:s.index,stage:'CLAIMED',checkpoint:0};
    return accept('CLAIMED');
  }
  if(e.type==='RELEASE') {
    if(!s.active) return deny('NO_ACTIVE_CLAIM');
    if(e.token!==s.active.token || e.generation!==s.active.generation) return deny('FENCED');
    if(!e.verifiedStopped) return deny('EXECUTION_STOP_NOT_VERIFIED');
    if(!s.paused) return deny('QUIESCENCE_REQUIRED');
    s.active=null;
    return accept('RELEASED_AFTER_VERIFIED_STOP');
  }
  if(!s.active) return deny('NO_ACTIVE_CLAIM');
  if(e.token!==s.active.token || e.generation!==s.active.generation || s.generation!==e.generation) return deny('FENCED');
  if(e.type==='CHECKPOINT') {
    if(!Number.isInteger(e.workUnit) || e.workUnit<=s.active.checkpoint) return deny('NON_MONOTONIC_CHECKPOINT');
    if(!e.durableEvidenceId) return deny('MISSING_DURABLE_EVIDENCE');
    s.active.checkpoint=e.workUnit;
    s.active.stage='CHECKPOINTED';
    s.active.evidenceId=e.durableEvidenceId;
    return accept('CHECKPOINT_ADVANCED');
  }
  if(e.type==='COMMIT_EXPORT') {
    if(e.index!==s.index || s.active.index!==s.index) return deny('POSITION_MISMATCH');
    if(!e.snapshotId || !e.historyComplete || !e.snapshotVerified) return deny('UNVERIFIED_COMPLETION');
    if(!e.writeLeaseReleased) return deny('WRITE_LEASE_NOT_RELEASED');
    s.completed=s.completed||{};
    if(s.completed[String(s.index)]) return deny('ALREADY_COMMITTED');
    s.completed[String(s.index)]={snapshotId:e.snapshotId,generation:e.generation};
    s.index++;
    s.active=null;
    return accept(s.index===s.total?'ALL_EXPORTS_COMMITTED':'EXPORT_COMMITTED');
  }
  return deny('UNKNOWN_EVENT');
}
function qboDailyV1283RecoveryDecision_(state,evidence) {
  var s=state, ev=evidence||{};
  if(!s.paused) return 'BLOCK_NOT_PAUSED';
  if(ev.continuationTriggers!==0) return 'BLOCK_CONTINUATIONS';
  if(s.active && !ev.executionStopVerified) return 'BLOCK_EXECUTION_LIVENESS_UNKNOWN';
  if(s.active && !ev.writeLeaseReleased) return 'BLOCK_WRITE_LEASE_UNKNOWN';
  if(!ev.historyReconciled) return 'BLOCK_HISTORY_NOT_RECONCILED';
  if(ev.conflictingSnapshots) return 'BLOCK_CONFLICTING_SNAPSHOTS';
  if(ev.completedEvidenceForCurrent && ev.snapshotVerified) return 'CANDIDATE_ADVANCE_WITHOUT_REEXPORT';
  if(ev.completedEvidenceForCurrent && !ev.snapshotVerified) return 'BLOCK_SNAPSHOT_UNVERIFIED';
  if(ev.partialWorkUnits && !ev.checkpointEvidenceVerified) return 'BLOCK_PARTIAL_CHECKPOINT_UNVERIFIED';
  return 'CANDIDATE_RETRY_AFTER_VERIFIED_STOP';
}
function testQboDailyCheckpointFencingV1283() {
  var s={runId:'R',index:21,total:22,generation:4,paused:false,active:null,completed:{}};
  var checks=0;
  function check(ok,label){checks++;if(!ok)throw Error('V1283 test '+checks+' '+label);}
  var claim=qboDailyV1283Transition_(s,{type:'CLAIM',runId:'R',token:'A',generation:5});
  check(claim.accepted,'claim');s=claim.state;
  check(!qboDailyV1283Transition_(s,{type:'CLAIM',runId:'R',token:'B',generation:6}).accepted,'no overlapping claim');
  check(!qboDailyV1283Transition_(s,{type:'CHECKPOINT',runId:'R',token:'OLD',generation:4,workUnit:1,durableEvidenceId:'E'}).accepted,'fenced old worker');
  var cp=qboDailyV1283Transition_(s,{type:'CHECKPOINT',runId:'R',token:'A',generation:5,workUnit:1,durableEvidenceId:'E'});
  check(cp.accepted,'checkpoint');s=cp.state;
  check(!qboDailyV1283Transition_(s,{type:'CHECKPOINT',runId:'R',token:'A',generation:5,workUnit:1,durableEvidenceId:'E'}).accepted,'monotonic');
  check(!qboDailyV1283Transition_(s,{type:'RELEASE',runId:'R',token:'A',generation:5,verifiedStopped:true}).accepted,'must pause');
  check(!qboDailyV1283Transition_(s,{type:'COMMIT_EXPORT',runId:'R',token:'A',generation:5,index:21,snapshotId:'S',historyComplete:true,snapshotVerified:true,writeLeaseReleased:false}).accepted,'lease guard');
  var commit=qboDailyV1283Transition_(s,{type:'COMMIT_EXPORT',runId:'R',token:'A',generation:5,index:21,snapshotId:'S',historyComplete:true,snapshotVerified:true,writeLeaseReleased:true});
  check(commit.accepted&&commit.action==='ALL_EXPORTS_COMMITTED'&&commit.state.index===22,'completion');
  check(!qboDailyV1283Transition_(commit.state,{type:'COMMIT_EXPORT',runId:'R',token:'A',generation:5,index:21,snapshotId:'S',historyComplete:true,snapshotVerified:true,writeLeaseReleased:true}).accepted,'idempotent');
  var b={paused:true,active:{token:'A'}};
  var e={continuationTriggers:0,executionStopVerified:false,writeLeaseReleased:true,historyReconciled:true};
  check(qboDailyV1283RecoveryDecision_(b,e)==='BLOCK_EXECUTION_LIVENESS_UNKNOWN','liveness');
  e.executionStopVerified=true;e.completedEvidenceForCurrent=true;e.snapshotVerified=true;
  check(qboDailyV1283RecoveryDecision_(b,e)==='CANDIDATE_ADVANCE_WITHOUT_REEXPORT','reconcile');
  e.conflictingSnapshots=true;
  check(qboDailyV1283RecoveryDecision_(b,e)==='BLOCK_CONFLICTING_SNAPSHOTS','conflict');
  var out={version:'1.5.283-test',readOnly:true,testsPassed:checks,mutations:0,automaticRecoveryEnabled:false};
  console.log('[DAILY V1283] | TEST PASS | '+JSON.stringify(out));return out;
}
function previewQboDailyCheckpointFencingV1283() {
  var props=PropertiesService.getScriptProperties();
  var paused=props.getProperty(QBO_DAILY_V1279_PAUSE_KEY)==='true';
  var runId=props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.RUN_ID)||'';
  var active=getActiveDailyQboWorkerState_(props);
  var triggers=ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()===DAILY_QBO_TRIGGER_HANDLERS.NEXT;}).length;
  var out={version:'1.5.283-preview',readOnly:true,paused:paused,runId:runId,activeClaimPresent:!!active,
    continuationTriggers:triggers,checkpointPersistenceInstalled:false,ownershipFencingIntegrated:false,
    executionLivenessVerified:false,automaticRecoveryEnabled:false,
    decision:!paused?'BLOCK_NOT_PAUSED':active?'BLOCK_ACTIVE_CLAIM':'DESIGN_ONLY_NO_MUTATION'};
  console.log('[DAILY V1283] | READ_ONLY | '+JSON.stringify(out));return out;
}
