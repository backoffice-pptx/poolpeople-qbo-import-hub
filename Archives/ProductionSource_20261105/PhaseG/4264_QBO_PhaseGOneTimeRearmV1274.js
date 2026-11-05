/** V1274 one-time rearm, REVIEW ONLY. No production action until explicit authorization.
 * Requires original 4222 module. Never call startQboPhaseGGlobalIdentityV1274().
 */
const QBO_PG_REARM_4264 = Object.freeze({
  EXPECTED_STATUS:'HALTED_REVIEW_REQUIRED', EXPECTED_CURSOR:801,
  EXPECTED_ROWS:357301, EXPECTED_CHUNK:86, EXPECTED_BUCKET:0,
  EXPECTED_AUDIT:'1ThPawegYeoKZ0rWsKweO7f2baiBqyTbg',
  EXPECTED_INDEX:'16Ltx_Rs4MrBH3jhToWm8olfzR2CX1aA-',
  // Safety latch. Must be changed only after explicit production reactivation authorization.
  AUTHORIZED:true
});
function qboPg4264Check_(){
  const e=QBO_PG_REARM_4264,s=qboPg274S_(),p=qboPg274P_(),issues=[];
  if(!s)issues.push('STATE_MISSING');
  else {
    if(s.version!==QBO_PG274_.V)issues.push('VERSION');
    if(s.status!==e.EXPECTED_STATUS)issues.push('STATUS');
    if(s.fileCursor!==e.EXPECTED_CURSOR)issues.push('CURSOR');
    if(s.rows!==e.EXPECTED_ROWS)issues.push('ROWS');
    if(s.chunk!==e.EXPECTED_CHUNK)issues.push('CHUNK');
    if(s.bucketCursor!==e.EXPECTED_BUCKET)issues.push('BUCKET');
    if(s.indexFolderId!==e.EXPECTED_INDEX)issues.push('INDEX_FOLDER');
    if(s.auditFolderId!==e.EXPECTED_AUDIT)issues.push('AUDIT_FOLDER');
    if(typeof s.iteratorToken!=='string'||!s.iteratorToken)issues.push('ITERATOR_MISSING');
    if(s.lease)issues.push('LEASE_PRESENT');
  }
  if(p.getProperty(QBO_PG274_.KEY+'_JOURNAL'))issues.push('JOURNAL_PRESENT');
  if(qboPg274Triggers_().length!==0)issues.push('WORKER_TRIGGER_PRESENT');
  return {ok:issues.length===0,issues,state:s};
}
function previewQboPg4264OneTimeRearmV1274(){
  const c=qboPg4264Check_();
  const result={status:c.ok?'READY_FOR_AUTHORIZATION':'BLOCKED',issues:c.issues,
    cursor:c.state?.fileCursor,rows:c.state?.rows,chunk:c.state?.chunk,
    pendingJournal:!!qboPg274P_().getProperty(QBO_PG274_.KEY+'_JOURNAL'),
    triggerCount:qboPg274Triggers_().length,authorized:QBO_PG_REARM_4264.AUTHORIZED,
    stateMutations:0,triggerMutations:0,sourceBoundaryIndependentlyVerified:false};
  console.log('[PHASE G V1274] | ONE_TIME_REARM_PREVIEW | '+JSON.stringify(result));
  return result;
}
function applyQboPg4264OneTimeRearmV1274(){
  // Intentionally disabled until explicit production restart authorization.
  if(!QBO_PG_REARM_4264.AUTHORIZED)throw Error('REARM_NOT_AUTHORIZED');
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(10000))throw Error('REARM_LOCK_UNAVAILABLE');
  try {
    const c=qboPg4264Check_();
    if(!c.ok)throw Error('REARM_PREFLIGHT_BLOCKED '+c.issues.join(','));
    const a=qboPg274Gate_();
    if(a.indexFolderId!==c.state.indexFolderId)throw Error('REARM_INDEX_GATE_CHANGED');
    const p=qboPg274P_(),key=QBO_PG274_.KEY;
    const original=p.getProperty(key);
    if(!original)throw Error('REARM_STATE_DISAPPEARED');
    const before=JSON.parse(original);
    if(JSON.stringify(before)!==JSON.stringify(c.state))throw Error('REARM_STATE_CHANGED');
    // Install trigger while status remains HALTED. A premature invocation is inert.
    // Only after trigger count is verified is the state switched to STAGING.
    let triggerCreated=false;
    try {
      ScriptApp.newTrigger(QBO_PG274_.HANDLER).timeBased().everyMinutes(5).create();
      triggerCreated=true;
      if(qboPg274Triggers_().length!==1)throw Error('REARM_TRIGGER_COUNT_INVALID');
      if(p.getProperty(key)!==original)throw Error('REARM_STATE_CHANGED_DURING_TRIGGER');
      if(p.getProperty(key+'_JOURNAL'))throw Error('REARM_JOURNAL_APPEARED');
      const next=Object.assign({},before,{status:'STAGING'});
      qboPg274Save_(next);
      const verified=qboPg274S_();
      if(!verified||verified.status!=='STAGING'||
         JSON.stringify(Object.assign({},verified,{status:before.status}))!==JSON.stringify(before))
        throw Error('REARM_STATE_READBACK_MISMATCH');
      const out={status:'REARMED',cursor:verified.fileCursor,rows:verified.rows,
        chunk:verified.chunk,triggerCount:qboPg274Triggers_().length};
      console.log('[PHASE G V1274] | ONE_TIME_REARM | '+JSON.stringify(out));
      return out;
    }catch(err){
      // Fail closed: restore HALTED state before attempting trigger cleanup.
      // This ensures a leftover trigger cannot process the run after a rollback.
      const rollback=[];
      try {
        const current=qboPg274S_();
        if(current){
          current.status='HALTED_REVIEW_REQUIRED';
          qboPg274Save_(current);
        } else {
          p.setProperty(key,original);
        }
        const confirm=qboPg274S_();
        if(!confirm||confirm.status!=='HALTED_REVIEW_REQUIRED')
          throw Error('HALTED_STATE_NOT_CONFIRMED');
      }catch(e){rollback.push('HALT_RESTORE_FAILED:'+String(e));}
      try {qboPg274Remove_();}catch(e){rollback.push('TRIGGER_REMOVE_FAILED:'+String(e));}
      try {
        const remaining=qboPg274Triggers_().length;
        if(remaining!==0)rollback.push('TRIGGERS_REMAIN:'+remaining);
      }catch(e){rollback.push('TRIGGER_VERIFY_FAILED:'+String(e));}
      console.error('[PHASE G V1274] | REARM_ABORTED | '+JSON.stringify({
        error:String(err),triggerCreated:triggerCreated,rollbackIssues:rollback}));
      throw Error('REARM_ABORTED '+String(err)+(rollback.length?' ROLLBACK_UNCONFIRMED '+rollback.join(';'):' ROLLBACK_VERIFIED'));
    }
  }finally{lock.releaseLock();}
}
