/** V1303 preflight only: NO production property mutations. */
const QBO_V1303_VERSION_='1.5.303';
function qboV1303Classify_(s) {
  const blockers=[];
  if(!s.paused)blockers.push('SCHEDULER_NOT_PAUSED');
  if(s.runId)blockers.push('QUEUE_RUN_PRESENT');
  if(s.queueIndex!==null)blockers.push('QUEUE_INDEX_PRESENT');
  if(s.activeToken||s.activeKey||s.activeIndex!==null)blockers.push('ACTIVE_CLAIM_EVIDENCE');
  if(s.checkpointPresent)blockers.push('CHECKPOINT_PRESENT');
  if(s.leaseCount)blockers.push('WORKBOOK_LEASES_PRESENT');
  if(!s.keyContract)blockers.push('PROPERTY_KEY_CONTRACT_MISMATCH');
  return {eligibleForDesignReview:blockers.length===0,blockers,
    mutationAuthorized:false,executionLivenessVerified:false};
}
function qboV1303Snapshot_(){
 const p=PropertiesService.getScriptProperties(), k=DAILY_QBO_QUEUE_PROPERTIES;
 const props=p.getProperties();
 const rawIndex=p.getProperty(k.INDEX),rawActive=p.getProperty(k.ACTIVE_INDEX);
 return {paused:p.getProperty(QBO_DAILY_V1279_PAUSE_KEY)==='true',
   runId:p.getProperty(k.RUN_ID)||'',queueIndex:rawIndex===null?null:rawIndex,
   activeToken:p.getProperty(k.ACTIVE_TOKEN)||'',
   activeKey:p.getProperty(k.ACTIVE_EXPORT_KEY)||'',
   activeIndex:rawActive===null?null:rawActive,
   checkpointPresent:!!p.getProperty('QBO_DAILY_V1284_CHECKPOINT_V1'),
   leaseCount:Object.keys(props).filter(x=>x.startsWith('QBO_EXPORT_WRITE_LEASE_')).length,
   keyContract:qboV1302Contract_(k,QBO_V1302_KEYS_)};
}
function previewQboControlledWorkerPreflightV1303(){
 const s=qboV1303Snapshot_(),d=qboV1303Classify_(s);
 const result={version:QBO_V1303_VERSION_,readOnly:true,paused:s.paused,
   queuePresent:!!s.runId||s.queueIndex!==null,
   activeClaimPresent:!!s.activeToken||!!s.activeKey||s.activeIndex!==null,
   checkpointPresent:s.checkpointPresent,leaseCount:s.leaseCount,
   keyContract:s.keyContract,blockers:d.blockers,
   eligibleForDesignReview:d.eligibleForDesignReview,
   mutationAuthorized:false,productionPropertiesModified:false,
   executionLivenessVerified:false,automaticRecoveryEnabled:false};
 console.log('[DAILY V1303] | READ_ONLY | '+JSON.stringify(result));return result;
}
function testQboControlledWorkerPreflightV1303(){
 let n=0;function eq(a,b){if(a!==b)throw Error('V1303_TEST_'+n);n++;}
 const idle={paused:true,runId:'',queueIndex:null,activeToken:'',activeKey:'',
 activeIndex:null,checkpointPresent:false,leaseCount:0,keyContract:true};
 eq(qboV1303Classify_(idle).eligibleForDesignReview,true);
 for(const patch of [{paused:false},{runId:'r'},{queueIndex:'0'},
 {activeToken:'t'},{activeKey:'INVOICES'},{activeIndex:'0'},
 {checkpointPresent:true},{leaseCount:1},{keyContract:false}])
 eq(qboV1303Classify_({...idle,...patch}).eligibleForDesignReview,false);
 eq(qboV1303Classify_(idle).mutationAuthorized,false);
 console.log('[DAILY V1303] | TEST PASS | '+JSON.stringify({version:QBO_V1303_VERSION_,casesPassed:n,mutations:0,automaticRecoveryEnabled:false}));
}
