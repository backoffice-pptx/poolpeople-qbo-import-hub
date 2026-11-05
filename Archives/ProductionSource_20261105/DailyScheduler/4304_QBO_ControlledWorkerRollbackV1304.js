/** V1304: non-mutating crash-safe test authorization contract.
 * Intentionally does NOT write production scheduler keys. Apps Script
 * termination can skip finally, so an in-process rollback is insufficient.
 */
const QBO_V1304_VERSION_='1.5.304';
function qboV1304Decision_(s){
 const blockers=[];
 if(!s.paused)blockers.push('NOT_PAUSED');
 if(s.queuePresent||s.claimPresent||s.checkpointPresent||s.leaseCount!==0)blockers.push('NOT_QUIESCENT');
 if(!s.keyContract)blockers.push('KEY_CONTRACT_MISMATCH');
 if(!s.independentExecutionTerminationProof)blockers.push('NO_INDEPENDENT_LIVENESS_ATTESTATION');
 if(!s.outOfBandRollbackReady)blockers.push('NO_OUT_OF_BAND_ROLLBACK');
 if(!s.triggerIsolationProven)blockers.push('TRIGGER_ISOLATION_UNPROVEN');
 return {blockers,designReviewEligible:blockers.filter(x=>x==='NOT_PAUSED'||x==='NOT_QUIESCENT'||x==='KEY_CONTRACT_MISMATCH').length===0,
   productionClaimMutationAuthorized:false,automaticRecoveryEnabled:false};
}
function qboV1304Snapshot_(){
 const s=qboV1303Snapshot_();
 return {paused:s.paused,queuePresent:!!s.runId||s.queueIndex!==null,
 claimPresent:!!s.activeToken||!!s.activeKey||s.activeIndex!==null,
 checkpointPresent:s.checkpointPresent,leaseCount:s.leaseCount,keyContract:s.keyContract,
 independentExecutionTerminationProof:false,outOfBandRollbackReady:false,triggerIsolationProven:false};
}
function previewQboControlledWorkerRollbackV1304(){
 const s=qboV1304Snapshot_(),d=qboV1304Decision_(s);
 const result={version:QBO_V1304_VERSION_,readOnly:true,...s,...d,
 productionPropertiesModified:false,exportWrites:0,automaticRecoveryEnabled:false};
 console.log('[DAILY V1304] | READ_ONLY | '+JSON.stringify(result));return result;
}
function testQboControlledWorkerRollbackV1304(){
 let n=0;
 const eq=(a,b)=>{if(a!==b)throw Error('V1304_TEST_'+n+': '+a+' expected '+b);n++;};
 const clean={paused:true,queuePresent:false,claimPresent:false,checkpointPresent:false,leaseCount:0,keyContract:true,
 independentExecutionTerminationProof:false,outOfBandRollbackReady:false,triggerIsolationProven:false};
 const d=qboV1304Decision_(clean);
 eq(d.designReviewEligible,true);eq(d.productionClaimMutationAuthorized,false);
 eq(d.blockers.includes('NO_INDEPENDENT_LIVENESS_ATTESTATION'),true);
 eq(d.blockers.includes('NO_OUT_OF_BAND_ROLLBACK'),true);
 eq(d.blockers.includes('TRIGGER_ISOLATION_UNPROVEN'),true);
 for(const patch of [{paused:false},{queuePresent:true},{claimPresent:true},{checkpointPresent:true},{leaseCount:1},{keyContract:false}]){
  const x=qboV1304Decision_({...clean,...patch});
  eq(x.designReviewEligible,false);eq(x.productionClaimMutationAuthorized,false);
 }
 const all={...clean,independentExecutionTerminationProof:true,outOfBandRollbackReady:true,triggerIsolationProven:true};
 eq(qboV1304Decision_(all).productionClaimMutationAuthorized,false);
 console.log('[DAILY V1304] | TEST PASS | '+JSON.stringify({version:QBO_V1304_VERSION_,casesPassed:n,mutations:0,productionClaimMutationAuthorized:false}));
}
