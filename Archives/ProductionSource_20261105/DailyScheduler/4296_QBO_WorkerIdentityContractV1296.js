/** V1296 — fail-closed immutable worker identity contract, design-only.
 * Does NOT bind execution identity to exporter calls or change write paths.
 */
const QBO_V1296_VERSION='1.5.296';
function qboV1296IdentityDecision_(identity, claim, lease) {
  if (!identity || !claim || !lease) return 'BLOCK_MISSING_EVIDENCE';
  const fields=['runId','exportKey','workerToken'];
  for (let i=0;i<fields.length;i++) {
    const f=fields[i];
    if (!identity[f] || !claim[f] || !lease[f]) return 'BLOCK_INCOMPLETE_IDENTITY';
    if (String(identity[f])!==String(claim[f]) || String(identity[f])!==String(lease[f]))
      return 'BLOCK_IDENTITY_MISMATCH';
  }
  if (!Number.isInteger(identity.index) || identity.index<0 ||
      !Number.isInteger(claim.index) || claim.index!==identity.index)
    return 'BLOCK_POSITION_MISMATCH';
  if (!lease.token || !identity.leaseToken || lease.token!==identity.leaseToken)
    return 'BLOCK_LEASE_TOKEN_MISMATCH';
  return 'IDENTITY_CONSISTENT_NOT_LIVENESS_PROOF';
}
function testQboWorkerIdentityContractV1296() {
  let count=0;
  const expect=(actual,want)=>{if(actual!==want)throw new Error('V1296_TEST_FAILED_'+count+': '+actual);count++;};
  const i={runId:'run',exportKey:'INVOICES',workerToken:'worker',index:21,leaseToken:'lease'};
  const c={runId:'run',exportKey:'INVOICES',workerToken:'worker',index:21};
  const l={runId:'run',exportKey:'INVOICES',workerToken:'worker',token:'lease'};
  expect(qboV1296IdentityDecision_(i,c,l),'IDENTITY_CONSISTENT_NOT_LIVENESS_PROOF');
  expect(qboV1296IdentityDecision_(null,c,l),'BLOCK_MISSING_EVIDENCE');
  expect(qboV1296IdentityDecision_(i,null,l),'BLOCK_MISSING_EVIDENCE');
  expect(qboV1296IdentityDecision_(i,c,null),'BLOCK_MISSING_EVIDENCE');
  expect(qboV1296IdentityDecision_({...i,workerToken:'stale'},c,l),'BLOCK_IDENTITY_MISMATCH');
  expect(qboV1296IdentityDecision_(i,{...c,runId:'other'},l),'BLOCK_IDENTITY_MISMATCH');
  expect(qboV1296IdentityDecision_(i,c,{...l,exportKey:'ITEMS'}),'BLOCK_IDENTITY_MISMATCH');
  expect(qboV1296IdentityDecision_({...i,index:20},c,l),'BLOCK_POSITION_MISMATCH');
  expect(qboV1296IdentityDecision_(i,c,{...l,token:'other'}),'BLOCK_LEASE_TOKEN_MISMATCH');
  expect(qboV1296IdentityDecision_({...i,leaseToken:''},c,l),'BLOCK_LEASE_TOKEN_MISMATCH');
  expect(qboV1296IdentityDecision_(i,{...c,workerToken:''},l),'BLOCK_INCOMPLETE_IDENTITY');
  console.log('[DAILY V1296] | TEST PASS | '+JSON.stringify({version:QBO_V1296_VERSION,casesPassed:count,mutations:0,liveWorkerBindingIntegrated:false,automaticRecoveryEnabled:false}));
}
function previewQboWorkerIdentityContractV1296() {
  const p=PropertiesService.getScriptProperties();
  const active=p.getProperty('QBO_DAILY_EXPORT_ACTIVE_TOKEN')||'';
  const result={version:QBO_V1296_VERSION,readOnly:true,
    paused:p.getProperty('QBO_DAILY_V1279_PAUSED')==='true' || p.getProperty('QBO_DAILY_V1279_PAUSE')==='true',
    activeClaimPresent:!!active,
    immutableExecutionContextIntegrated:false,
    leaseWorkerBindingIntegrated:false,
    mutationBoundaryWorkerFencingIntegrated:false,
    abandonedLeaseCleanupAuthorized:false,
    automaticRecoveryEnabled:false,
    decision:'DESIGN_CONTRACT_ONLY_NO_MUTATION'};
  console.log('[DAILY V1296] | READ_ONLY | '+JSON.stringify(result));return result;
}
