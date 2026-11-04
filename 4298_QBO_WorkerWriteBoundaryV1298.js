/** V1298 — fail-closed scheduled worker boundary verification.
 * No automatic recovery or lease cleanup. Non-scheduled callers remain
 * protected by the workbook lease token but have no scheduler identity.
 */
function qboV1298Decision_(ctx, claim, lease, token) {
  if (!lease || lease.token !== token) return 'BLOCK_LEASE';
  if (!ctx) return 'MANUAL_EXPORT_LEASE_ONLY';
  if (!claim || !ctx.runId || !ctx.exportKey || !ctx.workerToken ||
      !Number.isInteger(ctx.index)) return 'BLOCK_CLAIM';
  if (ctx.runId !== claim.runId || ctx.exportKey !== claim.exportKey ||
      ctx.workerToken !== claim.workerToken || ctx.index !== claim.index)
    return 'BLOCK_SCHEDULER_OWNER';
  if (ctx.runId !== lease.runId || ctx.exportKey !== lease.exportKey ||
      ctx.workerToken !== lease.workerToken || ctx.index !== lease.index)
    return 'BLOCK_LEASE_IDENTITY';
  return 'SCHEDULED_BOUNDARY_CONSISTENT';
}
function qboV1298AssertWriteBoundary_(leaseKey, token, ctx, boundary, testPropertyReader) {
  // Production callers omit testPropertyReader; only an explicit test harness supplies it.
  const p=testPropertyReader || PropertiesService.getScriptProperties();
  let lease=null;
  try {lease=JSON.parse(p.getProperty(leaseKey)||'null');}catch(e){}
  const claim=ctx ? {
    runId:p.getProperty('QBO_DAILY_EXPORT_RUN_ID')||'',
    exportKey:p.getProperty('QBO_DAILY_EXPORT_ACTIVE_EXPORT_KEY')||'',
    workerToken:p.getProperty('QBO_DAILY_EXPORT_ACTIVE_TOKEN')||'',
    index:Number(p.getProperty('QBO_DAILY_EXPORT_ACTIVE_INDEX'))
  } : null;
  const decision=qboV1298Decision_(ctx,claim,lease,token);
  if (decision!=='SCHEDULED_BOUNDARY_CONSISTENT' &&
      decision!=='MANUAL_EXPORT_LEASE_ONLY') {
    throw new Error('V1298_WRITE_FENCE_'+decision+' boundary='+boundary);
  }
  return true;
}
function testQboWorkerWriteBoundaryV1298() {
  let n=0;const expect=(actual,want)=>{if(actual!==want)throw Error('V1298_TEST_'+n+': '+actual);n++;};
  const ctx={runId:'r',exportKey:'INVOICES',workerToken:'w',index:21};
  const lease={...ctx,token:'l'};
  expect(qboV1298Decision_(ctx,ctx,lease,'l'),'SCHEDULED_BOUNDARY_CONSISTENT');
  expect(qboV1298Decision_(ctx,ctx,lease,'wrong'),'BLOCK_LEASE');
  expect(qboV1298Decision_(ctx,null,lease,'l'),'BLOCK_CLAIM');
  expect(qboV1298Decision_(ctx,{...ctx,workerToken:'other'},lease,'l'),'BLOCK_SCHEDULER_OWNER');
  expect(qboV1298Decision_(ctx,ctx,{...lease,index:20},'l'),'BLOCK_LEASE_IDENTITY');
  expect(qboV1298Decision_(null,null,lease,'l'),'MANUAL_EXPORT_LEASE_ONLY');
  expect(qboV1298Decision_(ctx,ctx,null,'l'),'BLOCK_LEASE');
  console.log('[DAILY V1298] | TEST PASS | '+JSON.stringify({version:'1.5.298',casesPassed:n,mutations:0,liveWriteTested:false,automaticRecoveryEnabled:false}));
}
function previewQboWorkerWriteBoundaryV1298() {
  const p=PropertiesService.getScriptProperties();
  const keys=Object.keys(p.getProperties()).filter(k=>k.startsWith('QBO_EXPORT_WRITE_LEASE_'));
  const x={version:'1.5.298',readOnly:true,
    activeClaimPresent:!!p.getProperty('QBO_DAILY_EXPORT_ACTIVE_TOKEN'),
    leaseCount:keys.length,workerBoundaryGuardIntegrated:true,
    liveWriteTested:false,abandonedLeaseCleanupAuthorized:false,
    automaticRecoveryEnabled:false,recoveryAuthorized:false};
  console.log('[DAILY V1298] | READ_ONLY | '+JSON.stringify(x));return x;
}
