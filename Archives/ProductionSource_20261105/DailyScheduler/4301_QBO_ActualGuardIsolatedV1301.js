/** V1301: invoke the ACTUAL V1298 boundary guard against an injected,
 * isolated ownership reader and a dedicated Google Sheets test workbook.
 * Production scheduler keys are NEVER written by this harness.
 */
function previewQboActualGuardIsolatedV1301() {
  const p=PropertiesService.getScriptProperties();
  const result={version:'1.5.301',readOnly:true,
    activeProductionClaim:!!p.getProperty('QBO_DAILY_EXPORT_ACTIVE_TOKEN'),
    activeInvocationContext:QBO_V1297_ACTIVE_CONTEXT_!==null,
    testNamespaceKeys:Object.keys(p.getProperties()).filter(k=>k.indexOf('QBO_V1301_TEST_')===0).length,
    productionSchedulerKeysModified:false,automaticRecoveryEnabled:false};
  console.log('[DAILY V1301] | READ_ONLY | '+JSON.stringify(result));return result;
}
function runQboActualGuardIsolatedV1301() {
  const p=PropertiesService.getScriptProperties(),prefix='QBO_V1301_TEST_';
  if(p.getProperty('QBO_DAILY_EXPORT_ACTIVE_TOKEN') || QBO_V1297_ACTIVE_CONTEXT_!==null)
    throw Error('V1301_REFUSE_ACTIVE_PRODUCTION_WORKER');
  if(Object.keys(p.getProperties()).some(k=>k.indexOf(prefix)===0))
    throw Error('V1301_TEST_NAMESPACE_NOT_EMPTY');
  const claim={runId:'V1301_'+Utilities.getUuid(),exportKey:'V1301_TEST',index:0,token:Utilities.getUuid()};
  const leaseKey=prefix+'LEASE', claimKey=prefix+'CLAIM';
  const book=SpreadsheetApp.create('App50 V1301 Actual Guard Isolated '+new Date().toISOString());
  const sheet=book.getSheets()[0];sheet.setName('V1301_Guard');
  let checks=0;
  function assert(x,name){if(!x)throw Error('V1301_ASSERT_'+name);checks++;}
  try {
    p.setProperty(claimKey,JSON.stringify(claim));
    return qboV1297WithWorkerContext_(claim,function(){
      const ctx=qboV1297GetLeaseContext_();
      const lease={runId:ctx.runId,exportKey:ctx.exportKey,index:ctx.index,workerToken:ctx.workerToken,token:Utilities.getUuid()};
      p.setProperty(leaseKey,JSON.stringify(lease));
      // The same real V1298 function called by the exporter, but with
      // dependency-injected getProperty limited to the isolated test keys.
      const reader={getProperty:function(key){
        if(key===leaseKey)return p.getProperty(leaseKey);
        const raw=p.getProperty(claimKey),c=raw?JSON.parse(raw):null;
        if(!c)return null;
        if(key==='QBO_DAILY_EXPORT_RUN_ID')return c.runId;
        if(key==='QBO_DAILY_EXPORT_ACTIVE_EXPORT_KEY')return c.exportKey;
        if(key==='QBO_DAILY_EXPORT_ACTIVE_TOKEN')return c.token;
        if(key==='QBO_DAILY_EXPORT_ACTIVE_INDEX')return String(c.index);
        throw Error('V1301_UNEXPECTED_PROPERTY_'+key);
      }};
      function guarded(label){return qboV1298AssertWriteBoundary_(leaseKey,lease.token,ctx,label,reader);}
      assert(guarded('header')===true,'AUTH_HEADER');
      sheet.getRange(1,1,1,2).setValues([['Boundary','Result']]);
      assert(guarded('data')===true,'AUTH_DATA');
      sheet.getRange(2,1,1,2).setValues([['REAL_V1298_GUARD','PASS']]);
      SpreadsheetApp.flush();
      assert(sheet.getRange(2,1,1,2).getValues()[0][1]==='PASS','READBACK');
      function blocked(change,restore,label){
        change();let refused=false;
        try{guarded(label);}catch(e){refused=String(e.message).indexOf('V1298_WRITE_FENCE_')===0;}
        restore();assert(refused,label);
      }
      blocked(()=>p.setProperty(claimKey,JSON.stringify({...claim,token:'BAD'})),()=>p.setProperty(claimKey,JSON.stringify(claim)),'CLAIM_TOKEN');
      blocked(()=>p.setProperty(claimKey,JSON.stringify({...claim,runId:'BAD'})),()=>p.setProperty(claimKey,JSON.stringify(claim)),'CLAIM_RUN');
      blocked(()=>p.setProperty(claimKey,JSON.stringify({...claim,index:1})),()=>p.setProperty(claimKey,JSON.stringify(claim)),'CLAIM_INDEX');
      blocked(()=>p.setProperty(leaseKey,JSON.stringify({...lease,workerToken:'BAD'})),()=>p.setProperty(leaseKey,JSON.stringify(lease)),'LEASE_WORKER');
      blocked(()=>p.setProperty(leaseKey,JSON.stringify({...lease,token:'BAD'})),()=>p.setProperty(leaseKey,JSON.stringify(lease)),'LEASE_TOKEN');
      blocked(()=>p.deleteProperty(claimKey),()=>p.setProperty(claimKey,JSON.stringify(claim)),'MISSING_CLAIM');
      assert(guarded('after_restoration')===true,'RESTORED');
      const result={version:'1.5.301',status:'PASS',checksPassed:checks,
        isolatedWorkbookId:book.getId(),isolatedWorkbookUrl:book.getUrl(),
        actualV1298GuardInvoked:true,isolatedPropertyReaderInjected:true,
        productionSchedulerKeysModified:false,productionExportWrites:0,qboApiCalls:0,
        actualProductionPropertyReaderTested:false,automaticRecoveryEnabled:false};
      console.log('[DAILY V1301] | ISOLATED GUARD PASS | '+JSON.stringify(result));return result;
    });
  }finally{
    p.deleteProperty(claimKey);p.deleteProperty(leaseKey);
    console.log('[DAILY V1301] | CLEANUP | '+JSON.stringify({testNamespaceCleared:!p.getProperty(claimKey)&&!p.getProperty(leaseKey),isolatedWorkbookId:book.getId()}));
  }
}
