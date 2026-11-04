/** V1295: lease-token checks at exporter framework mutation boundaries.
 * Checks do not prove original Apps Script execution termination or protect
 * inside one long-running SpreadsheetApp call. No automatic takeover enabled.
 */
function qboV1295LeaseDecision_(raw, token) {
  if (!raw) return false;
  try {
    const x=JSON.parse(raw);
    return !!(x && x.token && String(x.token)===String(token));
  } catch(e) {return false;}
}
function qboV1295AssertLeaseOwned_(leaseKey, token, boundary) {
  const raw=PropertiesService.getScriptProperties().getProperty(leaseKey);
  if (!qboV1295LeaseDecision_(raw,token)) {
    const e=new Error('V1295_WRITE_LEASE_OWNERSHIP_LOST boundary='+boundary);
    e.code='QBO_WRITE_LEASE_OWNERSHIP_LOST';
    throw e;
  }
  return true;
}
function testQboWriteBoundariesV1295() {
  let n=0; const ok=x=>{if(!x)throw new Error('V1295_TEST_FAILED_'+n);n++};
  ok(qboV1295LeaseDecision_(JSON.stringify({token:'a'}),'a'));
  ok(!qboV1295LeaseDecision_(JSON.stringify({token:'a'}),'b'));
  ok(!qboV1295LeaseDecision_(null,'a'));
  ok(!qboV1295LeaseDecision_('{','a'));
  ok(!qboV1295LeaseDecision_(JSON.stringify({}),'a'));
  console.log('[DAILY V1295] | TEST PASS | '+JSON.stringify({version:'1.5.295',casesPassed:n,mutations:0,automaticRecoveryEnabled:false,fullWorkerFencingIntegrated:false}));
}
function previewQboWriteBoundariesV1295() {
  const p=PropertiesService.getScriptProperties().getProperties();
  const keys=Object.keys(p).filter(k=>k.indexOf('QBO_EXPORT_WRITE_LEASE_')===0);
  const result={version:'1.5.295',readOnly:true,leaseCount:keys.length,leaseKeys:keys.slice(0,10),
    boundaryGuardIntegrated:true,fullWorkerFencingIntegrated:false,
    automaticRecoveryEnabled:false,recoveryAuthorized:false};
  console.log('[DAILY V1295] | READ_ONLY | '+JSON.stringify(result));return result;
}
