/** V1302 — read-only production property reader verification.
 * No production claims, leases, or export destinations are mutated.
 */
const QBO_V1302_KEYS_ = Object.freeze({
  runId:'QBO_DAILY_EXPORT_RUN_ID',
  token:'QBO_DAILY_EXPORT_ACTIVE_TOKEN',
  index:'QBO_DAILY_EXPORT_ACTIVE_INDEX',
  exportKey:'QBO_DAILY_EXPORT_ACTIVE_EXPORT_KEY'
});
function qboV1302Contract_(registry, keys) {
  return registry.RUN_ID===keys.runId && registry.ACTIVE_TOKEN===keys.token &&
    registry.ACTIVE_INDEX===keys.index && registry.ACTIVE_EXPORT_KEY===keys.exportKey;
}
function qboV1302ReadClaim_(reader) {
  const k=QBO_V1302_KEYS_;
  const raw=reader.getProperty(k.index);
  return {runId:reader.getProperty(k.runId)||'',
    workerToken:reader.getProperty(k.token)||'',
    exportKey:reader.getProperty(k.exportKey)||'',
    index:raw===null||raw===''?null:Number(raw)};
}
function testQboProductionPropertyReaderV1302() {
  let n=0;function eq(a,b){if(a!==b)throw Error('V1302_TEST_'+n+': '+a+' != '+b);n++;}
  eq(qboV1302Contract_(DAILY_QBO_QUEUE_PROPERTIES,QBO_V1302_KEYS_),true);
  const map={};const reader={getProperty:k=>Object.prototype.hasOwnProperty.call(map,k)?map[k]:null};
  const empty=qboV1302ReadClaim_(reader);
  eq(empty.index,null);eq(empty.workerToken,'');
  const ctx={runId:'test',workerToken:'w',exportKey:'INVOICES',index:21};
  const lease={...ctx,token:'lease'};
  eq(qboV1298Decision_(ctx,empty,lease,'lease'),'BLOCK_SCHEDULER_OWNER');
  eq(qboV1298Decision_(ctx,ctx,lease,'wrong'),'BLOCK_LEASE');
  for(const [k,v] of Object.entries({[QBO_V1302_KEYS_.runId]:'test',
    [QBO_V1302_KEYS_.token]:'w',[QBO_V1302_KEYS_.exportKey]:'INVOICES',
    [QBO_V1302_KEYS_.index]:'21'}))map[k]=v;
  const populated=qboV1302ReadClaim_(reader);
  eq(qboV1298Decision_(ctx,populated,lease,'lease'),'SCHEDULED_BOUNDARY_CONSISTENT');
  map[QBO_V1302_KEYS_.token]='stale';
  eq(qboV1298Decision_(ctx,qboV1302ReadClaim_(reader),lease,'lease'),'BLOCK_SCHEDULER_OWNER');
  eq(qboV1298Decision_(null,null,lease,'lease'),'MANUAL_EXPORT_LEASE_ONLY');
  console.log('[DAILY V1302] | TEST PASS | '+JSON.stringify({version:'1.5.302',casesPassed:n,mutations:0,actualProductionReaderInvoked:false,automaticRecoveryEnabled:false}));
}
function previewQboProductionPropertyReaderV1302() {
  const p=PropertiesService.getScriptProperties();
  const contract=qboV1302Contract_(DAILY_QBO_QUEUE_PROPERTIES,QBO_V1302_KEYS_);
  const claim=qboV1302ReadClaim_(p);
  const hasAny=!!(claim.runId||claim.workerToken||claim.exportKey||claim.index!==null);
  const emptyDecision=qboV1298Decision_(
    {runId:'synthetic',workerToken:'synthetic',exportKey:'INVOICES',index:0},
    claim,{runId:'synthetic',workerToken:'synthetic',exportKey:'INVOICES',index:0,token:'synthetic'},'synthetic');
  const result={version:'1.5.302',readOnly:true,
    schedulerKeyContractMatches:contract,actualProductionPropertyReaderInvoked:true,
    activeClaimPresent:!!claim.workerToken,anySchedulerClaimEvidencePresent:hasAny,
    absentOrMismatchedClaimRejected:emptyDecision==='BLOCK_SCHEDULER_OWNER',
    testOverrideNotUsed:true,productionPropertiesModified:false,
    productionExportWrites:0,automaticRecoveryEnabled:false,recoveryAuthorized:false};
  if(!contract)throw Error('V1302_PROPERTY_KEY_CONTRACT_MISMATCH');
  if(!result.absentOrMismatchedClaimRejected)throw Error('V1302_UNEXPECTED_SYNTHETIC_MATCH');
  console.log('[DAILY V1302] | READ_ONLY | '+JSON.stringify(result));return result;
}
