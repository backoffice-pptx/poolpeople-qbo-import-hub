/** V1287 isolated persistent Script Properties test. Does not modify production scheduler keys. */
const QBO_DAILY_V1287_TEST_KEY = 'QBO_DAILY_V1287_ISOLATED_TEST_V1';
const QBO_DAILY_V1287_VERSION = '1.5.287';
function qboDailyV1287Lock_() { return getDailyQboSchedulerLock_(); }
function qboDailyV1287ProductionFingerprint_(p) {
  const q=DAILY_QBO_QUEUE_PROPERTIES;
  return JSON.stringify({runId:p.getProperty(q.RUN_ID),index:p.getProperty(q.INDEX),token:p.getProperty(q.ACTIVE_TOKEN),activeIndex:p.getProperty(q.ACTIVE_INDEX),exportKey:p.getProperty(q.ACTIVE_EXPORT_KEY),paused:p.getProperty(QBO_DAILY_V1279_PAUSE_KEY),checkpoint:p.getProperty(QBO_DAILY_V1284_KEY)});
}
function qboDailyV1287AssertIdle_(p) {
  const q=DAILY_QBO_QUEUE_PROPERTIES;
  if(p.getProperty(QBO_DAILY_V1279_PAUSE_KEY)!=='true' || p.getProperty(q.RUN_ID) || p.getProperty(q.ACTIVE_TOKEN)) throw new Error('V1287_REQUIRES_PAUSED_IDLE_SCHEDULER');
}
function qboDailyV1287Parse_(raw) {
  if(!raw)return null;
  const x=JSON.parse(raw);
  if(!x || x.schema!==1 || x.runId!=='V1287_ISOLATED' || x.index!==0 || x.exportKey!=='TEST_ONLY' || !x.token || !Number.isInteger(x.sequence) || x.sequence<0 || !['CLAIMED','EXPORT_STARTED','SNAPSHOT_RECORDED'].includes(x.phase))throw new Error('V1287_MALFORMED_TEST_STATE');
  return x;
}
function qboDailyV1287Advance_(p, token, phase, snapshotId) {
  const prior=qboDailyV1287Parse_(p.getProperty(QBO_DAILY_V1287_TEST_KEY));
  const order={CLAIMED:0,EXPORT_STARTED:1,SNAPSHOT_RECORDED:2};
  if(prior && prior.token!==token)throw new Error('V1287_FENCED_TOKEN');
  if(prior && order[phase]<order[prior.phase])throw new Error('V1287_PHASE_REGRESSION');
  if(prior && order[phase]>order[prior.phase]+1)throw new Error('V1287_PHASE_SKIP');
  if(!prior && phase!=='CLAIMED')throw new Error('V1287_MUST_START_CLAIMED');
  const proof=snapshotId||'';
  if(phase==='SNAPSHOT_RECORDED' && !proof)throw new Error('V1287_MISSING_SNAPSHOT_PROOF');
  if(prior && order[phase]===order[prior.phase]) {
    if((prior.snapshotId||'')!==proof)throw new Error('V1287_REPLAY_CONFLICT');
    return prior;
  }
  const next={schema:1,runId:'V1287_ISOLATED',index:0,exportKey:'TEST_ONLY',token:token,sequence:prior?prior.sequence+1:0,phase:phase,snapshotId:proof};
  p.setProperty(QBO_DAILY_V1287_TEST_KEY,JSON.stringify(next));
  return next;
}
/** Step 1: isolated persistent write. Must subsequently call verify and cleanup. */
function beginQboDailyIsolatedPersistenceV1287() {
  const lock=qboDailyV1287Lock_();lock.waitLock(30000);
  try {
    const p=PropertiesService.getScriptProperties();qboDailyV1287AssertIdle_(p);
    if(p.getProperty(QBO_DAILY_V1287_TEST_KEY))throw new Error('V1287_TEST_STATE_ALREADY_EXISTS_USE_VERIFY_OR_CLEANUP');
    const before=qboDailyV1287ProductionFingerprint_(p);
    const token=Utilities.getUuid();
    const a=qboDailyV1287Advance_(p,token,'CLAIMED','');
    const b=qboDailyV1287Advance_(p,token,'EXPORT_STARTED','');
    if(a.sequence!==0||b.sequence!==1)throw new Error('V1287_SEQUENCE_ERROR');
    if(before!==qboDailyV1287ProductionFingerprint_(p))throw new Error('V1287_PRODUCTION_STATE_CHANGED');
    const out={version:QBO_DAILY_V1287_VERSION,status:'PERSISTED_AWAITING_SEPARATE_EXECUTION',testKey:QBO_DAILY_V1287_TEST_KEY,sequence:b.sequence,phase:b.phase,productionQueueUnchanged:true,automaticRecoveryEnabled:false};
    console.log('[DAILY V1287] | BEGIN | '+JSON.stringify(out));return out;
  }finally{lock.releaseLock();}
}
/** Step 2: verify cross-execution persistence and rejection behavior, then advance test record. */
function verifyQboDailyIsolatedPersistenceV1287() {
  const lock=qboDailyV1287Lock_();lock.waitLock(30000);
  try {
    const p=PropertiesService.getScriptProperties();qboDailyV1287AssertIdle_(p);
    const before=qboDailyV1287ProductionFingerprint_(p);
    const prior=qboDailyV1287Parse_(p.getProperty(QBO_DAILY_V1287_TEST_KEY));
    if(!prior||prior.phase!=='EXPORT_STARTED'||prior.sequence!==1)throw new Error('V1287_EXPECTED_PRIOR_EXECUTION_NOT_FOUND');
    let rejected=0;
    function expectReject(f){try{f();}catch(e){rejected++;return;}throw new Error('V1287_EXPECTED_REJECTION_MISSING');}
    expectReject(function(){qboDailyV1287Advance_(p,'WRONG_TOKEN','SNAPSHOT_RECORDED','test-only-evidence');});
    expectReject(function(){qboDailyV1287Advance_(p,prior.token,'CLAIMED','');});
    expectReject(function(){qboDailyV1287Advance_(p,prior.token,'SNAPSHOT_RECORDED','');});
    const next=qboDailyV1287Advance_(p,prior.token,'SNAPSHOT_RECORDED','TEST_ONLY_NOT_A_REAL_SNAPSHOT');
    const replay=qboDailyV1287Advance_(p,prior.token,'SNAPSHOT_RECORDED','TEST_ONLY_NOT_A_REAL_SNAPSHOT');
    if(next.sequence!==2||replay.sequence!==2)throw new Error('V1287_IDEMPOTENCY_ERROR');
    expectReject(function(){qboDailyV1287Advance_(p,prior.token,'SNAPSHOT_RECORDED','CONFLICT');});
    if(before!==qboDailyV1287ProductionFingerprint_(p))throw new Error('V1287_PRODUCTION_STATE_CHANGED');
    const out={version:QBO_DAILY_V1287_VERSION,status:'CROSS_EXECUTION_VERIFIED',sequence:next.sequence,phase:next.phase,rejectionsPassed:rejected,idempotentReplay:true,productionQueueUnchanged:true,cleanupRequired:true};
    console.log('[DAILY V1287] | VERIFY | '+JSON.stringify(out));return out;
  }finally{lock.releaseLock();}
}
/** Step 3: remove only isolated V1287 test key. Safe to call after partial failure. */
function cleanupQboDailyIsolatedPersistenceV1287() {
  const lock=qboDailyV1287Lock_();lock.waitLock(30000);
  try {
    const p=PropertiesService.getScriptProperties();
    const before=qboDailyV1287ProductionFingerprint_(p);
    const existed=!!p.getProperty(QBO_DAILY_V1287_TEST_KEY);
    p.deleteProperty(QBO_DAILY_V1287_TEST_KEY);
    if(before!==qboDailyV1287ProductionFingerprint_(p))throw new Error('V1287_PRODUCTION_STATE_CHANGED');
    const out={version:QBO_DAILY_V1287_VERSION,status:'CLEANED',testKeyRemoved:!p.getProperty(QBO_DAILY_V1287_TEST_KEY),testKeyPreviouslyPresent:existed,productionQueueUnchanged:true};
    console.log('[DAILY V1287] | CLEANUP | '+JSON.stringify(out));return out;
  }finally{lock.releaseLock();}
}
/** Read only: inspection without disclosing tokens. */
function previewQboDailyIsolatedPersistenceV1287() {
 const p=PropertiesService.getScriptProperties();const raw=p.getProperty(QBO_DAILY_V1287_TEST_KEY);
 let phase=null,sequence=null,parseError='';try{const x=qboDailyV1287Parse_(raw);if(x){phase=x.phase;sequence=x.sequence;}}catch(e){parseError=String(e.message);}
 const out={version:QBO_DAILY_V1287_VERSION,readOnly:true,testKeyPresent:!!raw,phase:phase,sequence:sequence,parseError:parseError,paused:p.getProperty(QBO_DAILY_V1279_PAUSE_KEY)==='true',automaticRecoveryEnabled:false};
 console.log('[DAILY V1287] | PREVIEW | '+JSON.stringify(out));return out;
}
