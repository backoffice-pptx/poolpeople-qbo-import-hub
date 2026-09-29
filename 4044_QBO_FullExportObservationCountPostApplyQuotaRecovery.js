/**
 * 4044_QBO_FullExportObservationCountPostApplyQuotaRecovery.js
 * Version 1.5.165
 * Narrow recovery from the exact Script Properties quota failure at cursor 207.
 *
 * Operator: recoverQboFullExportObservationCountPostApplyQuotaV165()
 */
function recoverQboFullExportObservationCountPostApplyQuotaV165(){
  const R=QBO_FE_OBS_POST_RECON_V163_,p=PropertiesService.getScriptProperties();
  qboFeObsApplyRequireDailyPaused_();
  let st=JSON.parse(p.getProperty(R.STATE_KEY)||'null');
  if(!st)throw new Error('Reconciliation state missing.');
  if(st.status!=='FAILED'||Number(st.cursor)!==207||Number(st.checkedCandidates)!==207||Number(st.findingCount)!==0)
    throw new Error('Recovery precondition mismatch.');
  if(String(st.error||'').indexOf('property storage quota')<0)
    throw new Error('Failure is not the governed Script Properties quota failure.');

  const prefix=R.RESULT_PREFIX+st.previewRunId+'_';
  const keys=Object.keys(p.getProperties()).filter(function(k){return k.indexOf(prefix)===0;});
  keys.forEach(function(k){p.deleteProperty(k);});
  const remaining=Object.keys(p.getProperties()).filter(function(k){return k.indexOf(prefix)===0;});
  if(remaining.length)throw new Error('Per-candidate result cleanup incomplete: '+remaining.length);

  st.version='1.5.165';st.status='RUNNING';st.error=null;st.failedAt=null;
  st.quotaRecovery={version:'1.5.165',recoveredAt:new Date().toISOString(),cursorPreserved:207,
    deletedPerCandidateResultProperties:keys.length,productionDataWritesPerformed:false,
    frozenPreviewPropertiesDeleted:false,aggregateCountersPreserved:true};
  p.setProperty(R.STATE_KEY,JSON.stringify(st));

  qboFeObsPostReconAutoV164ClearTriggers_();
  qboFeObsPostReconAutoV164EnsureSingleTrigger_();

  const out={version:'1.5.165',status:'RECOVERED_RUNNING',cursor:st.cursor,
    checkedCandidates:st.checkedCandidates,findingCount:st.findingCount,
    deletedPerCandidateResultProperties:keys.length,
    continuationTriggerCount:qboFeObsPostReconAutoV164Triggers_().length,
    safety:{productionDataWritesPerformed:false,frozenPreviewPropertiesDeleted:false,reconciliationRestarted:false}};
  console.log(JSON.stringify(out,null,2));return out;
}
