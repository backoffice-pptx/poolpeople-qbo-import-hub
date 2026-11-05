/** V1286 isolated checkpoint contract tests. No production state writes. */
function testQboDailyV1285IntegrationV1286() {
  var q = DAILY_QBO_QUEUE_PROPERTIES;
  var data = {};
  var fake = {getProperty:function(k){return Object.prototype.hasOwnProperty.call(data,k)?data[k]:null;}};
  var claim = {runId:'V1286_TEST_RUN',index:3,exportKey:'INVOICES',token:'V1286_TEST_TOKEN'};
  data[q.RUN_ID]=claim.runId;data[q.INDEX]='3';data[q.ACTIVE_TOKEN]=claim.token;
  data[q.ACTIVE_INDEX]='3';data[q.ACTIVE_EXPORT_KEY]=claim.exportKey;
  var passed=0;
  function ok(v,msg){if(!v)throw new Error('V1286 TEST FAIL '+msg);passed++;}
  function rejects(fn,msg){var threw=false;try{fn();}catch(e){threw=true;}ok(threw,msg);}
  qboDailyV1284AssertClaim_(fake,claim);ok(true,'valid ownership');
  var changes=[
    [q.RUN_ID,'OTHER_RUN','run ID'],[q.INDEX,'4','queue index'],
    [q.ACTIVE_TOKEN,'OTHER_TOKEN','token'],[q.ACTIVE_INDEX,'4','active index'],
    [q.ACTIVE_EXPORT_KEY,'CUSTOMERS','export key']
  ];
  changes.forEach(function(c){var prior=data[c[0]];data[c[0]]=c[1];
    rejects(function(){qboDailyV1284AssertClaim_(fake,claim);},c[2]);data[c[0]]=prior;});
  rejects(function(){qboDailyV1284AssertClaim_(fake,{runId:claim.runId,index:3,exportKey:'INVOICES',token:''});},'missing token');
  rejects(function(){qboDailyV1284AssertClaim_(fake,{runId:claim.runId,index:3.5,exportKey:'INVOICES',token:claim.token});},'fractional index');
  ok(qboDailyV1284Parse_('')===null,'empty checkpoint');
  rejects(function(){qboDailyV1284Parse_('{broken');},'invalid JSON');
  rejects(function(){qboDailyV1284Parse_('{"schema":1}');},'missing checkpoint fields');
  var cp={schema:1,runId:claim.runId,index:3,exportKey:'INVOICES',token:claim.token,sequence:0,phase:'CLAIMED'};
  ok(qboDailyV1284Parse_(JSON.stringify(cp)).phase==='CLAIMED','valid claim checkpoint');
  cp.phase='EXPORT_STARTED';cp.sequence=1;
  ok(qboDailyV1284Parse_(JSON.stringify(cp)).sequence===1,'valid export started checkpoint');
  cp.sequence=-1;rejects(function(){qboDailyV1284Parse_(JSON.stringify(cp));},'negative sequence');
  cp.sequence=1;cp.index=-1;rejects(function(){qboDailyV1284Parse_(JSON.stringify(cp));},'negative index');
  var out={version:'1.5.286-test',readOnly:true,casesPassed:passed,productionMutations:0,
    actualSchedulerClaimAcquisitionTested:false,actualCheckpointPersistenceTested:false,
    exporterWriteFencingEnabled:false,automaticRecoveryEnabled:false};
  console.log('[DAILY V1286] | ISOLATED TEST PASS | '+JSON.stringify(out));return out;
}
function previewQboDailyV1285IntegrationV1286() {
  var p=PropertiesService.getScriptProperties(),q=DAILY_QBO_QUEUE_PROPERTIES;
  var raw=p.getProperty(QBO_DAILY_V1284_KEY),cp=null,parseError='';
  try {cp=qboDailyV1284Parse_(raw);}catch(e){parseError=String(e);}
  var out={version:'1.5.286-preview',readOnly:true,
    paused:p.getProperty(QBO_DAILY_V1279_PAUSE_KEY)==='true',
    runId:p.getProperty(q.RUN_ID)||'',activeClaimPresent:!!p.getProperty(q.ACTIVE_TOKEN),
    checkpointPresent:!!raw,checkpointPhase:cp?cp.phase:null,checkpointParseError:parseError,
    continuationTriggers:ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='runNextScheduledQboExport';}).length,
    integrationCallSitesExpected:['CLAIMED','EXPORT_STARTED'],
    callSitesVerifiedByRuntime:false,automaticRecoveryEnabled:false,
    decision:'READ_ONLY_NO_RECOVERY_AUTHORIZED'};
  console.log('[DAILY V1286] | READ_ONLY | '+JSON.stringify(out));return out;
}
