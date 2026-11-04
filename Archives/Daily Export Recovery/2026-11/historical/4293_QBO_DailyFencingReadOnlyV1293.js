/** V1293 read-only liveness and write-fencing preflight.
 * This diagnostic does NOT claim that Apps Script execution liveness is knowable
 * from Script Properties or that a lease proves an execution has terminated.
 */
const QBO_DAILY_V1293_VERSION = '1.5.293';
function qboDailyV1293Decision_(x) {
  if (x.activeClaim || x.checkpointPresent || x.queuePresent)
    return 'HOLD_ACTIVE_OR_UNRECONCILED';
  if (x.leaseCount > 0) return 'HOLD_LEASE_EVIDENCE';
  return 'IDLE_NOT_RECOVERY_AUTHORIZATION';
}
function testQboDailyFencingReadOnlyV1293() {
  let n=0;
  function eq(a,b){if(a!==b)throw new Error('V1293 test '+(n+1));n++;}
  const base={activeClaim:false,checkpointPresent:false,queuePresent:false,leaseCount:0};
  eq(qboDailyV1293Decision_(base),'IDLE_NOT_RECOVERY_AUTHORIZATION');
  eq(qboDailyV1293Decision_({...base,activeClaim:true}),'HOLD_ACTIVE_OR_UNRECONCILED');
  eq(qboDailyV1293Decision_({...base,checkpointPresent:true}),'HOLD_ACTIVE_OR_UNRECONCILED');
  eq(qboDailyV1293Decision_({...base,queuePresent:true}),'HOLD_ACTIVE_OR_UNRECONCILED');
  eq(qboDailyV1293Decision_({...base,leaseCount:1}),'HOLD_LEASE_EVIDENCE');
  eq(qboDailyV1293Decision_({...base,activeClaim:true,leaseCount:1}),'HOLD_ACTIVE_OR_UNRECONCILED');
  console.log('[DAILY V1293] | TEST PASS | '+JSON.stringify({version:QBO_DAILY_V1293_VERSION,casesPassed:n,mutations:0,automaticRecoveryEnabled:false}));
}
function previewQboDailyFencingReadOnlyV1293() {
  const p=PropertiesService.getScriptProperties();
  const all=p.getProperties();
  const leases=Object.keys(all).filter(k=>k.indexOf('QBO_EXPORT_WRITE_LEASE_')===0).map(k=>{
    let obj=null,parseError=false;
    try{obj=JSON.parse(all[k]);}catch(e){parseError=true;}
    return {keySuffix:k.substring('QBO_EXPORT_WRITE_LEASE_'.length),parseError:parseError,
      sheetName:obj?String(obj.sheetName||''):'',runIdPresent:!!(obj&&obj.runId),
      workerTokenPresent:!!(obj&&obj.workerToken),
      expiredByClock:!!(obj&&Number(obj.expiresAt||0)<=Date.now()),
      // Expiration alone is NOT proof of terminated execution.
      executionStoppedVerified:false};
  });
  const cpRaw=all.QBO_DAILY_V1284_CHECKPOINT_V1||'';
  const state={activeClaim:!!all.QBO_DAILY_EXPORT_ACTIVE_TOKEN,
    checkpointPresent:!!cpRaw,queuePresent:!!all.QBO_DAILY_EXPORT_RUN_ID,leaseCount:leases.length};
  const result={version:QBO_DAILY_V1293_VERSION,readOnly:true,
    paused:all.QBO_DAILY_V1279_PAUSED==='true',...state,
    leaseEvidence:leases.slice(0,30),leaseEvidenceTruncated:leases.length>30,
    decision:qboDailyV1293Decision_(state),executionLivenessVerified:false,
    exporterWriteFencingIntegrated:false,automaticRecoveryEnabled:false,
    recoveryAuthorized:false,
    sourceReviewFindings:[
      'Workbook leases use fixed expiresAt and can be replaced after expiry',
      'The workbook lease callback has no generation check before each Sheets mutation',
      'Lease scheduler context is read from global Script Properties, not bound to the caller token',
      'No external Apps Script execution termination attestation is available here'
    ]};
  console.log('[DAILY V1293] | READ_ONLY | '+JSON.stringify(result));
  return result;
}
