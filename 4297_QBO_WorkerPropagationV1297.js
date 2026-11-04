/** V1297 — invocation-scoped immutable identity propagation.
 * This is a scoped context, NOT full mutation-boundary fencing.
 * Non-scheduled/manual exporters preserve their previous lease context behavior.
 */
var QBO_V1297_ACTIVE_CONTEXT_ = null;
function qboV1297IdentityFromClaim_(claim) {
  if (!claim || !claim.runId || !claim.exportKey || !claim.token ||
      !Number.isInteger(claim.index) || claim.index < 0)
    throw new Error('V1297_INCOMPLETE_WORKER_CLAIM');
  return Object.freeze({runId:String(claim.runId),exportKey:String(claim.exportKey),
    workerToken:String(claim.token),index:claim.index});
}
function qboV1297WithWorkerContext_(claim, callback) {
  if (typeof callback !== 'function') throw new Error('V1297_CALLBACK_REQUIRED');
  if (QBO_V1297_ACTIVE_CONTEXT_ !== null) throw new Error('V1297_NESTED_WORKER_CONTEXT');
  const context=qboV1297IdentityFromClaim_(claim);
  QBO_V1297_ACTIVE_CONTEXT_=context;
  try { return callback(); } finally { QBO_V1297_ACTIVE_CONTEXT_=null; }
}
function qboV1297GetLeaseContext_() {
  const ctx=QBO_V1297_ACTIVE_CONTEXT_;
  if (ctx) return {runId:ctx.runId,exportKey:ctx.exportKey,
    workerToken:ctx.workerToken,index:ctx.index,source:'IMMUTABLE_INVOCATION_V1297'};
  return getQboSchedulerLeaseContext_();
}
function testQboWorkerPropagationV1297() {
  let n=0;const ok=(x)=>{if(!x)throw Error('V1297_TEST_'+n);n++;};
  const c={runId:'r',exportKey:'INVOICES',token:'t',index:21};
  const result=qboV1297WithWorkerContext_(c,()=>{
    const x=qboV1297GetLeaseContext_();
    ok(x.runId==='r');ok(x.workerToken==='t');ok(x.index===21);
    ok(x.source==='IMMUTABLE_INVOCATION_V1297');
    let nested=false;try{qboV1297WithWorkerContext_(c,()=>{});}catch(e){nested=true;}
    ok(nested);return 1;
  });ok(result===1);ok(QBO_V1297_ACTIVE_CONTEXT_===null);
  let failed=false;try{qboV1297WithWorkerContext_(c,()=>{throw Error('TEST');});}catch(e){failed=true;}
  ok(failed);ok(QBO_V1297_ACTIVE_CONTEXT_===null);
  let invalid=false;try{qboV1297IdentityFromClaim_({...c,token:''});}catch(e){invalid=true;}
  ok(invalid);
  console.log('[DAILY V1297] | TEST PASS | '+JSON.stringify({version:'1.5.297',casesPassed:n,
    mutations:0,invocationScopedIdentityIntegrated:true,mutationBoundaryWorkerFencingIntegrated:false,
    automaticRecoveryEnabled:false}));
}
function previewQboWorkerPropagationV1297() {
  const p=PropertiesService.getScriptProperties();
  const x={version:'1.5.297',readOnly:true,
    paused:p.getProperty('QBO_DAILY_V1279_PAUSED')==='true'||p.getProperty('QBO_DAILY_V1279_PAUSE')==='true',
    invocationScopedIdentityIntegrated:true,leaseMetadataUsesInvocationContext:true,
    activeExecutionContextPresent:QBO_V1297_ACTIVE_CONTEXT_!==null,
    mutationBoundaryWorkerFencingIntegrated:false,abandonedLeaseCleanupAuthorized:false,
    automaticRecoveryEnabled:false};
  console.log('[DAILY V1297] | READ_ONLY | '+JSON.stringify(x));return x;
}
