/** App 50 v1.5.269 — narrowly scoped, one-time V1268 Drive-error recovery.
 * Changes ONLY V1268 audit state and its continuation trigger. No Phase G or export writes.
 * Install alongside 4216; run resumeQboPhaseGSourceCensusAfterDriveV1269 once.
 */
function resumeQboPhaseGSourceCensusAfterDriveV1269(){
  const C=QBO_PG_SRC268_,p=PropertiesService.getScriptProperties();
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(1000))throw Error('V1269_AUDIT_RECOVERY_LOCK_BUSY');
  try{
    qboPg268Guard_();
    const s=qboPg268Get_();
    if(!s||s.version!=='1.5.268'||s.status!=='HALTED_REVIEW_REQUIRED')throw Error('V1269_NOT_EXPECTED_HALTED_STATE');
    if(s.manifestCursor!==452||s.manifestCount!==2418||s.rows!==107642||s.admitted!==107634||s.exceptions!==8||s.blocked!==0)throw Error('V1269_CHECKPOINT_MISMATCH');
    if(s.errors!==1||!/Service error: Drive/.test(s.lastError||'')||!/qboPhaseG1217Single_/.test(s.lastError||''))throw Error('V1269_NOT_EXPECTED_DRIVE_FAILURE');
    if(s.lease)throw Error('V1269_ACTIVE_LEASE');
    if(!s.iteratorToken)throw Error('V1269_MISSING_ITERATOR_TOKEN');
    if(p.getProperty(C.KEY+'_JOURNAL')!==null)throw Error('V1269_PENDING_JOURNAL_REVIEW_REQUIRED');
    if(qboPg268Triggers_().length!==0)throw Error('V1269_EXISTING_WORKER_TRIGGER');
    const a=qboPg268Empty_(-1);
    for(let i=0;i<64;i++){
      const k=C.PART+('0'+i).slice(-2),raw=p.getProperty(k);
      if(raw){const part=JSON.parse(raw);if(part.partition!==i)throw Error('V1269_PARTITION_KEY_MISMATCH_'+i);qboPg268Merge_(a,part);}
    }
    if(a.rows!==s.rows||a.admitted!==s.admitted||a.exceptions!==s.exceptions||a.blocked!==s.blocked||a.invalid!==0||a.ordinalZero!==452||a.ordinalEmpty!==0||a.ordinalNull!==0||a.ordinalMissing!==0||a.ordinalOther!==107190||a.sourceRunEmpty!==67812||a.sourceRunMissing!==0)throw Error('V1269_PARTITION_CENSUS_NOT_RECONCILED');
    if(!a.bySource.FULL_EXPORT_LEGACY||a.bySource.FULL_EXPORT_LEGACY.rows!==67812||a.bySource.FULL_EXPORT_LEGACY.ordinalZero!==283||!a.bySource.FULL_EXPORT||a.bySource.FULL_EXPORT.rows!==39830||a.bySource.FULL_EXPORT.ordinalZero!==169||Object.keys(a.bySource).length!==2)throw Error('V1269_SOURCE_BREAKDOWN_MISMATCH');
    // Ensure the iterator can be restored before modifying any audit state.
    const it=DriveApp.continueFileIterator(s.iteratorToken);
    if(!it.hasNext())throw Error('V1269_ITERATOR_EXHAUSTED');
    const trigger=ScriptApp.newTrigger(C.HANDLER).timeBased().everyMinutes(5).create();
    try{
      s.status='RUNNING';s.recoveredAt=new Date().toISOString();s.recoveryVersion='1.5.269';
      s.recoveryReason='TRANSIENT_DRIVE_SERVICE_ERROR_AFTER_452_COMMITTED_MANIFESTS';
      s.previousError=s.lastError;s.lastError='';s.removedTriggers=0;
      qboPg268Set_(s);
    }catch(e){ScriptApp.deleteTrigger(trigger);throw e;}
    console.log('[PHASE G SOURCE V1269] | RESUMED | '+JSON.stringify({cursor:s.manifestCursor,rows:s.rows,admitted:s.admitted,exceptions:s.exceptions,blocked:s.blocked,ordinalZero:a.ordinalZero,triggerCount:qboPg268Triggers_().length,recoveryVersion:s.recoveryVersion}));
    return {status:s.status,manifestCursor:s.manifestCursor,rows:s.rows,triggerCount:qboPg268Triggers_().length};
  }finally{lock.releaseLock();}
}
