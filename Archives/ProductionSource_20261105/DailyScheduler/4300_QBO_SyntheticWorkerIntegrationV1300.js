/** V1300: isolated synthetic scheduled-worker decision + Sheets write test.
 * Uses test-only namespace and a new workbook; NEVER writes production scheduler
 * claim keys or calls the real scheduled-worker write callback.
 */
function previewQboSyntheticWorkerIntegrationV1300() {
  const p=PropertiesService.getScriptProperties();
  const x={version:'1.5.300',readOnly:true,
    activeProductionClaim:!!p.getProperty('QBO_DAILY_EXPORT_ACTIVE_TOKEN'),
    invocationContextPresent:QBO_V1297_ACTIVE_CONTEXT_!==null,
    testKeys:Object.keys(p.getProperties()).filter(k=>k.indexOf('QBO_V1300_TEST_')===0).length,
    testWorkbookCreated:false,productionExportWrites:0,automaticRecoveryEnabled:false};
  console.log('[DAILY V1300] | READ_ONLY | '+JSON.stringify(x));return x;
}
function runQboSyntheticWorkerIntegrationV1300() {
  const p=PropertiesService.getScriptProperties(), prefix='QBO_V1300_TEST_';
  if(p.getProperty('QBO_DAILY_EXPORT_ACTIVE_TOKEN') || QBO_V1297_ACTIVE_CONTEXT_!==null)
    throw Error('V1300_REFUSE_ACTIVE_PRODUCTION_WORKER');
  if(Object.keys(p.getProperties()).some(k=>k.indexOf(prefix)===0))
    throw Error('V1300_TEST_NAMESPACE_NOT_EMPTY');
  const runId='V1300_'+Utilities.getUuid();
  const claim={runId:runId,exportKey:'V1300_SYNTHETIC',index:0,token:Utilities.getUuid()};
  const book=SpreadsheetApp.create('App50 V1300 Synthetic Worker Test '+new Date().toISOString());
  const sheet=book.getSheets()[0];sheet.setName('V1300_Test');
  const key=prefix+'CLAIM',leaseKey=prefix+'LEASE';
  let checks=0,mutations=0;
  function assert(x,label){if(!x)throw Error('V1300_ASSERT_'+label);checks++;}
  try {
    p.setProperty(key,JSON.stringify(claim));mutations++;
    return qboV1297WithWorkerContext_(claim,function(){
      const ctx=qboV1297GetLeaseContext_();
      assert(ctx.runId===claim.runId&&ctx.workerToken===claim.token&&ctx.index===0,'IMMUTABLE_CONTEXT');
      const lease={runId:ctx.runId,exportKey:ctx.exportKey,workerToken:ctx.workerToken,index:ctx.index,token:Utilities.getUuid()};
      p.setProperty(leaseKey,JSON.stringify(lease));mutations++;
      function decision(boundary){
        const c=JSON.parse(p.getProperty(key)||'null');
        const l=JSON.parse(p.getProperty(leaseKey)||'null');
        const mapped=c?{runId:c.runId,exportKey:c.exportKey,workerToken:c.token,index:c.index}:null;
        const d=qboV1298Decision_(ctx,mapped,l,lease.token);
        if(d!=='SCHEDULED_BOUNDARY_CONSISTENT')throw Error('V1300_FENCE_'+d+'_'+boundary);
      }
      decision('before_header');sheet.getRange(1,1,1,2).setValues([['Case','Result']]);
      decision('before_data');sheet.getRange(2,1,1,2).setValues([['SYNTHETIC_SCHEDULED','PASS']]);
      SpreadsheetApp.flush();
      assert(sheet.getRange(2,1,1,2).getValues()[0][1]==='PASS','REAL_WRITE_READBACK');
      function blocked(mutate,restore,label){
        mutate();let rejected=false;
        try{decision(label);}catch(e){rejected=String(e.message).indexOf('V1300_FENCE_')===0;}
        restore();assert(rejected,label);
      }
      blocked(()=>p.setProperty(key,JSON.stringify({...claim,token:'OTHER'})),()=>p.setProperty(key,JSON.stringify(claim)),'TOKEN_MISMATCH');
      blocked(()=>p.setProperty(key,JSON.stringify({...claim,runId:'OTHER'})),()=>p.setProperty(key,JSON.stringify(claim)),'RUN_MISMATCH');
      blocked(()=>p.setProperty(key,JSON.stringify({...claim,index:1})),()=>p.setProperty(key,JSON.stringify(claim)),'POSITION_MISMATCH');
      blocked(()=>p.setProperty(leaseKey,JSON.stringify({...lease,workerToken:'OTHER'})),()=>p.setProperty(leaseKey,JSON.stringify(lease)),'LEASE_OWNER_MISMATCH');
      blocked(()=>p.setProperty(leaseKey,JSON.stringify({...lease,token:'OTHER'})),()=>p.setProperty(leaseKey,JSON.stringify(lease)),'LEASE_TOKEN_MISMATCH');
      decision('after_negative_cases');
      const result={version:'1.5.300',status:'PASS',checksPassed:checks,
        isolatedWorkbookId:book.getId(),isolatedWorkbookUrl:book.getUrl(),
        syntheticNamespaceUsed:true,productionSchedulerKeysModified:false,
        productionExportWrites:0,qboApiCalls:0,
        realScheduledWorkerGuardTested:false,
        injectedScheduledDecisionAndWriteTested:true,automaticRecoveryEnabled:false};
      console.log('[DAILY V1300] | ISOLATED SYNTHETIC PASS | '+JSON.stringify(result));return result;
    });
  }finally{
    p.deleteProperty(key);p.deleteProperty(leaseKey);
    console.log('[DAILY V1300] | CLEANUP | '+JSON.stringify({testNamespaceCleared:!p.getProperty(key)&&!p.getProperty(leaseKey),isolatedWorkbookId:book.getId()}));
  }
}
