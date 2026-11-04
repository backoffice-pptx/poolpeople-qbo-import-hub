/** V1290: fail-closed successful-export queue advancement checkpoint.
 * Invoked ONLY while getDailyQboSchedulerLock_() is already held.
 * Does not independently establish exporter write fencing or liveness.
 */
const QBO_DAILY_V1290_VERSION = '1.5.290';
function qboDailyV1290AdvanceDecision_(cp, claim, nextIndex) {
  if (!claim || !claim.runId || !claim.token || !claim.exportKey ||
      !Number.isInteger(claim.index) || nextIndex !== claim.index + 1)
    throw new Error('V1290_INVALID_ADVANCEMENT');
  if (!cp || cp.schema !== 1 || cp.runId !== claim.runId ||
      cp.index !== claim.index || cp.token !== claim.token ||
      cp.exportKey !== claim.exportKey || cp.phase !== 'SNAPSHOT_RECORDED' ||
      !cp.snapshotId || !Number.isInteger(cp.sequence))
    throw new Error('V1290_SNAPSHOT_CHECKPOINT_NOT_VERIFIED');
  return {schema:1,version:QBO_DAILY_V1290_VERSION,
    runId:claim.runId,index:claim.index,exportKey:claim.exportKey,
    token:claim.token,sequence:cp.sequence+1,phase:'QUEUE_ADVANCED',
    snapshotId:cp.snapshotId,nextIndex:nextIndex};
}
function qboDailyV1290CommitAdvanceUnderLock_(props, claim, nextIndex) {
  // Caller holds the scheduler lock and has checked current token.
  qboDailyV1284AssertClaim_(props, claim);
  const cp=qboDailyV1284Parse_(props.getProperty(QBO_DAILY_V1284_KEY));
  const next=qboDailyV1290AdvanceDecision_(cp,claim,nextIndex);
  next.recordedAt=new Date().toISOString();
  props.setProperty(QBO_DAILY_V1284_KEY,JSON.stringify(next));
  // Read-after-write verification. Queue is NOT advanced if this fails.
  const persisted=qboDailyV1284Parse_(props.getProperty(QBO_DAILY_V1284_KEY));
  if (!persisted || persisted.phase!=='QUEUE_ADVANCED' ||
      persisted.runId!==claim.runId || persisted.token!==claim.token ||
      persisted.nextIndex!==nextIndex || persisted.snapshotId!==next.snapshotId)
    throw new Error('V1290_CHECKPOINT_DURABILITY_UNVERIFIED');
  return persisted;
}
function testQboDailyQueueAdvanceV1290() {
  let n=0;
  function ok(v){if(!v)throw new Error('V1290 test failed '+n);n++;}
  function rejects(f){let threw=false;try{f();}catch(e){threw=true;}ok(threw);}
  const c={runId:'r',index:21,token:'t',exportKey:'INVOICES'};
  const cp={schema:1,runId:'r',index:21,token:'t',exportKey:'INVOICES',
    phase:'SNAPSHOT_RECORDED',snapshotId:'snapshot',sequence:2};
  const x=qboDailyV1290AdvanceDecision_(cp,c,22);
  ok(x.phase==='QUEUE_ADVANCED');ok(x.nextIndex===22);ok(x.sequence===3);
  ok(x.snapshotId==='snapshot');
  rejects(()=>qboDailyV1290AdvanceDecision_(null,c,22));
  rejects(()=>qboDailyV1290AdvanceDecision_({...cp,token:'other'},c,22));
  rejects(()=>qboDailyV1290AdvanceDecision_({...cp,phase:'EXPORT_STARTED'},c,22));
  rejects(()=>qboDailyV1290AdvanceDecision_({...cp,snapshotId:''},c,22));
  rejects(()=>qboDailyV1290AdvanceDecision_(cp,c,23));
  rejects(()=>qboDailyV1290AdvanceDecision_(cp,{...c,runId:'other'},22));
  console.log('[DAILY V1290] | TEST PASS | '+JSON.stringify({
    version:QBO_DAILY_V1290_VERSION,casesPassed:n,mutations:0,
    liveAdvanceTested:false,automaticRecoveryEnabled:false}));
}
function previewQboDailyQueueAdvanceV1290() {
  const p=PropertiesService.getScriptProperties(),q=DAILY_QBO_QUEUE_PROPERTIES;
  const raw=p.getProperty(QBO_DAILY_V1284_KEY);
  let cp=null,parseError='';
  try{cp=qboDailyV1284Parse_(raw);}catch(e){parseError=String(e.message||e);}
  const result={version:QBO_DAILY_V1290_VERSION,readOnly:true,
    paused:p.getProperty(QBO_DAILY_V1279_PAUSE_KEY)==='true',
    runId:p.getProperty(q.RUN_ID)||'',activeClaimPresent:!!p.getProperty(q.ACTIVE_TOKEN),
    checkpointPhase:cp?cp.phase:null,checkpointNextIndex:cp&&cp.nextIndex!==undefined?cp.nextIndex:null,
    checkpointParseError:parseError,automaticRecoveryEnabled:false,
    exporterWriteFencingIntegrated:false,decision:'READ_ONLY_NO_MUTATION'};
  console.log('[DAILY V1290] | READ_ONLY | '+JSON.stringify(result));
  return result;
}
