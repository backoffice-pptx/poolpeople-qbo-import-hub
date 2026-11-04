/** V1284 additive durable scheduler checkpoint store. No automatic recovery or export mutation. */
const QBO_DAILY_V1284_KEY = 'QBO_DAILY_V1284_CHECKPOINT_V1';
const QBO_DAILY_V1284_VERSION = '1.5.284';

function qboDailyV1284Parse_(raw) {
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (!value || value.schema !== 1 || !value.runId || !Number.isInteger(value.index) ||
      value.index < 0 || !value.exportKey || !value.token || !Number.isInteger(value.sequence) ||
      value.sequence < 0 || !value.phase) throw new Error('V1284 checkpoint malformed; fail closed');
  return value;
}
function qboDailyV1284AssertClaim_(props, claim) {
  if (!claim || !claim.token || !claim.runId || !Number.isInteger(claim.index) || !claim.exportKey)
    throw new Error('V1284 invalid claim');
  const q = DAILY_QBO_QUEUE_PROPERTIES;
  if (props.getProperty(q.RUN_ID) !== claim.runId ||
      Number(props.getProperty(q.INDEX)) !== claim.index ||
      props.getProperty(q.ACTIVE_TOKEN) !== claim.token ||
      Number(props.getProperty(q.ACTIVE_INDEX)) !== claim.index ||
      props.getProperty(q.ACTIVE_EXPORT_KEY) !== claim.exportKey)
    throw new Error('V1284 FENCED: scheduler claim differs; checkpoint not written');
}
/**
 * Optional, guarded checkpoint write for a live scheduler worker. Callers must
 * never use this as proof of execution termination or snapshot completeness.
 * Sequence must advance exactly one; replay of identical state is idempotent.
 * Must not be invoked while already holding getDailyQboSchedulerLock_().
 */
function qboDailyV1284Checkpoint_(claim, phase, evidence) {
  const allowed = ['CLAIMED', 'EXPORT_STARTED', 'SNAPSHOT_RECORDED', 'QUEUE_ADVANCED'];
  if (allowed.indexOf(phase) < 0) throw new Error('V1284 unknown phase');
  const lock = getDailyQboSchedulerLock_();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    qboDailyV1284AssertClaim_(props, claim);
    const prior = qboDailyV1284Parse_(props.getProperty(QBO_DAILY_V1284_KEY));
    if (prior && (prior.runId !== claim.runId || prior.index !== claim.index ||
                  prior.token !== claim.token)) {
      // New ownership may start a new checkpoint generation, but only if
      // the current claim is authoritative (checked above).
    }
    const same = prior && prior.runId === claim.runId && prior.index === claim.index && prior.token === claim.token;
    const priorPhase = same ? prior.phase : null;
    const order = {CLAIMED:0, EXPORT_STARTED:1, SNAPSHOT_RECORDED:2, QUEUE_ADVANCED:3};
    if (same && order[phase] < order[priorPhase]) throw new Error('V1284 phase regression');
    const proof = evidence && evidence.snapshotId ? String(evidence.snapshotId) : '';
    if (phase === 'SNAPSHOT_RECORDED' && !proof) throw new Error('V1284 snapshot ID required');
    if (same && order[phase] === order[priorPhase]) {
      if (String(prior.snapshotId || '') !== proof) throw new Error('V1284 non-idempotent replay');
      return prior;
    }
    if (same && order[phase] > order[priorPhase] + 1) throw new Error('V1284 phase skip');
    if (!same && phase !== 'CLAIMED') throw new Error('V1284 first phase must be CLAIMED');
    const value = {schema:1, version:QBO_DAILY_V1284_VERSION, runId:claim.runId,
      index:claim.index, exportKey:claim.exportKey, token:claim.token,
      sequence:same ? prior.sequence+1 : 0, phase:phase, snapshotId:proof,
      recordedAt:new Date().toISOString()};
    props.setProperty(QBO_DAILY_V1284_KEY, JSON.stringify(value));
    return value;
  } finally {lock.releaseLock();}
}
/** Read only: never authorizes recovery. */
function previewQboDailyCheckpointStoreV1284() {
  const props = PropertiesService.getScriptProperties();
  const q = DAILY_QBO_QUEUE_PROPERTIES;
  const cp = qboDailyV1284Parse_(props.getProperty(QBO_DAILY_V1284_KEY));
  const out = {version:QBO_DAILY_V1284_VERSION, readOnly:true,
    paused:props.getProperty(QBO_DAILY_V1279_PAUSE_KEY)==='true',
    queueRunId:props.getProperty(q.RUN_ID)||'', activeClaimPresent:!!props.getProperty(q.ACTIVE_TOKEN),
    checkpointPresent:!!cp, checkpoint:cp ? {runId:cp.runId,index:cp.index,exportKey:cp.exportKey,
      sequence:cp.sequence,phase:cp.phase,snapshotId:cp.snapshotId,recordedAt:cp.recordedAt} : null,
    schedulerIntegrationEnabled:false, exporterWriteFencingEnabled:false,
    automaticRecoveryEnabled:false, executionLivenessVerified:false,
    decision:'READ_ONLY_NO_RECOVERY_AUTHORIZED'};
  console.log('[DAILY V1284] | READ_ONLY | '+JSON.stringify(out));
  return out;
}
function testQboDailyCheckpointStoreV1284() {
  const p={}; const keys=DAILY_QBO_QUEUE_PROPERTIES;
  p[keys.RUN_ID]='run';p[keys.INDEX]='2';p[keys.ACTIVE_TOKEN]='token';
  p[keys.ACTIVE_INDEX]='2';p[keys.ACTIVE_EXPORT_KEY]='INVOICES';
  const fake={getProperty:function(k){return Object.prototype.hasOwnProperty.call(p,k)?p[k]:null;}};
  const claim={runId:'run',index:2,token:'token',exportKey:'INVOICES'};
  let passed=0;
  function yes(x){if(!x)throw new Error('V1284 test failed '+passed);passed++;}
  function fails(fn){let failed=false;try{fn();}catch(e){failed=true;}yes(failed);}
  qboDailyV1284AssertClaim_(fake,claim);yes(true);
  fails(function(){qboDailyV1284AssertClaim_(fake,{runId:'run',index:2,token:'other',exportKey:'INVOICES'});});
  fails(function(){qboDailyV1284AssertClaim_(fake,{runId:'other',index:2,token:'token',exportKey:'INVOICES'});});
  fails(function(){qboDailyV1284AssertClaim_(fake,{runId:'run',index:3,token:'token',exportKey:'INVOICES'});});
  fails(function(){qboDailyV1284Parse_('{"schema":1}');});
  yes(qboDailyV1284Parse_('')===null);
  yes(qboDailyV1284Parse_(JSON.stringify({schema:1,runId:'run',index:2,exportKey:'INVOICES',token:'token',sequence:0,phase:'CLAIMED'})).phase==='CLAIMED');
  console.log('[DAILY V1284] | TEST PASS | '+JSON.stringify({version:QBO_DAILY_V1284_VERSION,testsPassed:passed,mutations:0,automaticRecoveryEnabled:false}));
}
