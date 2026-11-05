/** V1291 read-only crash-boundary classification. No repair is authorized. */
const QBO_DAILY_V1291_VERSION='1.5.291';
function qboDailyV1291Classify_(s) {
  const cp=s.checkpoint, run=s.runId, index=s.index, token=s.activeToken;
  if (!run && !token) return {classification:cp?'IDLE_WITH_RETAINED_CHECKPOINT':'IDLE',recoveryAuthorized:false};
  if (!run || !Number.isInteger(index) || index<0 || index>22)
    return {classification:'INCOMPLETE_QUEUE_STATE',recoveryAuthorized:false};
  if (!cp) return {classification:token?'ACTIVE_WITHOUT_CHECKPOINT':'QUEUE_WITHOUT_CHECKPOINT',recoveryAuthorized:false};
  if (cp.runId!==run) return {classification:'CHECKPOINT_RUN_MISMATCH',recoveryAuthorized:false};
  if (!Number.isInteger(cp.index) || !cp.exportKey || !cp.token)
    return {classification:'MALFORMED_CHECKPOINT',recoveryAuthorized:false};
  if (token && cp.token!==token) return {classification:'OWNERSHIP_MISMATCH',recoveryAuthorized:false};
  if (cp.phase==='SNAPSHOT_RECORDED' && index===cp.index && token)
    return {classification:'SNAPSHOT_RECORDED_QUEUE_NOT_ADVANCED',recoveryAuthorized:false};
  if (cp.phase==='QUEUE_ADVANCED' && cp.nextIndex===cp.index+1) {
    if (index===cp.index && token) return {classification:'ADVANCE_CHECKPOINT_INDEX_NOT_ADVANCED',recoveryAuthorized:false};
    if (index===cp.nextIndex && token) return {classification:'QUEUE_ADVANCED_CLAIM_NOT_CLEARED',recoveryAuthorized:false};
    if (index===cp.nextIndex && !token) return {classification:index===22?'FINAL_EXPORT_ADVANCED_RUN_FINALIZATION_UNVERIFIED':'ADVANCED_CLAIM_CLEARED',recoveryAuthorized:false};
  }
  return {classification:'UNRECONCILED_OR_ACTIVE',recoveryAuthorized:false};
}
function previewQboDailyCrashBoundaryV1291() {
  const p=PropertiesService.getScriptProperties(),q=DAILY_QBO_QUEUE_PROPERTIES;
  const raw=p.getProperty(QBO_DAILY_V1284_KEY);
  let cp=null,err='';try{cp=qboDailyV1284Parse_(raw);}catch(e){err=String(e.message||e);}
  const ix=p.getProperty(q.INDEX);
  const state={runId:p.getProperty(q.RUN_ID)||'',index:ix===null?null:Number(ix),
    activeToken:p.getProperty(q.ACTIVE_TOKEN)||'',checkpoint:cp};
  const d=err?{classification:'CHECKPOINT_PARSE_ERROR',recoveryAuthorized:false}:qboDailyV1291Classify_(state);
  const result={version:QBO_DAILY_V1291_VERSION,readOnly:true,
    paused:p.getProperty(QBO_DAILY_V1279_PAUSE_KEY)==='true',
    runIdPresent:!!state.runId,queueIndex:state.index,activeClaimPresent:!!state.activeToken,
    checkpointPhase:cp?cp.phase:null,checkpointIndex:cp?cp.index:null,
    checkpointNextIndex:cp&&cp.nextIndex!==undefined?cp.nextIndex:null,
    checkpointParseError:err,classification:d.classification,recoveryAuthorized:false,
    completionHistoryVerified:false,executionLivenessVerified:false,
    exporterWriteFencingIntegrated:false,automaticRecoveryEnabled:false};
  console.log('[DAILY V1291] | READ_ONLY | '+JSON.stringify(result));return result;
}
function testQboDailyCrashBoundaryV1291() {
  let n=0;function check(s,expected){const actual=qboDailyV1291Classify_(s);if(actual.classification!==expected||actual.recoveryAuthorized!==false)throw Error('V1291 failed '+expected+' got '+actual.classification);n++;}
  const cp={schema:1,runId:'r',index:21,exportKey:'INVOICES',token:'t',phase:'SNAPSHOT_RECORDED',snapshotId:'snap'};
  const s={runId:'r',index:21,activeToken:'t',checkpoint:cp};
  check({runId:'',index:null,activeToken:'',checkpoint:null},'IDLE');
  check({runId:'',index:null,activeToken:'',checkpoint:cp},'IDLE_WITH_RETAINED_CHECKPOINT');
  check({...s,checkpoint:null},'ACTIVE_WITHOUT_CHECKPOINT');
  check({...s,checkpoint:{...cp,runId:'other'}},'CHECKPOINT_RUN_MISMATCH');
  check({...s,checkpoint:{...cp,token:'other'}},'OWNERSHIP_MISMATCH');
  check(s,'SNAPSHOT_RECORDED_QUEUE_NOT_ADVANCED');
  const advanced={...cp,phase:'QUEUE_ADVANCED',nextIndex:22};
  check({...s,checkpoint:advanced},'ADVANCE_CHECKPOINT_INDEX_NOT_ADVANCED');
  check({...s,index:22,checkpoint:advanced},'QUEUE_ADVANCED_CLAIM_NOT_CLEARED');
  check({...s,index:22,activeToken:'',checkpoint:advanced},'FINAL_EXPORT_ADVANCED_RUN_FINALIZATION_UNVERIFIED');
  check({...s,index:20,checkpoint:advanced},'UNRECONCILED_OR_ACTIVE');
  check({...s,runId:''},'INCOMPLETE_QUEUE_STATE');
  console.log('[DAILY V1291] | TEST PASS | '+JSON.stringify({version:QBO_DAILY_V1291_VERSION,casesPassed:n,mutations:0,automaticRecoveryEnabled:false}));
}
