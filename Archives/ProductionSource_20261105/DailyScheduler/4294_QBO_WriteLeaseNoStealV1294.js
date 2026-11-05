/** V1294 read-only check. No lease clearing is authorized. */
function testQboWriteLeaseNoStealV1294() {
  const source = tryAcquireExportWriteLease_.toString();
  if (source.indexOf('if (raw)') < 0 ||
      source.indexOf('return false;', source.indexOf('if (raw)')) < 0 ||
      source.indexOf('Number(existing.expiresAt || 0) > now') >= 0) {
    throw new Error('V1294_LEASE_NO_STEAL_GUARD_MISSING');
  }
  console.log('[DAILY V1294] | TEST PASS | '+JSON.stringify({version:'1.5.294',
    casesPassed:3,mutations:0,expiredLeaseTakeoverDisabled:true,
    mutationBoundaryFencingIntegrated:false,automaticRecoveryEnabled:false}));
}
function previewQboWriteLeaseNoStealV1294() {
  const props=PropertiesService.getScriptProperties().getProperties();
  const keys=Object.keys(props).filter(k=>k.indexOf('QBO_EXPORT_WRITE_LEASE_')===0);
  const result={version:'1.5.294',readOnly:true,leaseCount:keys.length,
    leaseKeys:keys.slice(0,30),leaseKeysTruncated:keys.length>30,
    expiredLeaseTakeoverDisabled:true,mutationBoundaryFencingIntegrated:false,
    automaticRecoveryEnabled:false,recoveryAuthorized:false};
  console.log('[DAILY V1294] | READ_ONLY | '+JSON.stringify(result));
  return result;
}
