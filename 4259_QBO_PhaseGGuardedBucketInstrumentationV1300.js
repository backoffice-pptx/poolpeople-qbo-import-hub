/** V1300 single-bucket instrumented execution; isolated synthetic data; no triggers. */
function runQboPg300InstrumentedBucketV1300(){
 const tag='[PHASE G V1300] | GUARDED_BUCKET_PROFILE | ';
 const p=PropertiesService.getScriptProperties(), root=DriveApp.createFolder('QBO_PG300_PROFILE_'+Utilities.getUuid());
 const ledger=root.createFolder('ledger'),stage=root.createFolder('stage');
 const buckets=[];for(let b=0;b<16;b++)buckets.push(root.createFolder('bucket_'+('0'+b).slice(-2)).getId());
 const suffix=Utilities.getUuid().replace(/-/g,'');
 const cfg={isolated:true,ledgerFolderId:ledger.getId(),stageFolderId:stage.getId(),bucketFolderIds:buckets,
  stateKey:'QBO_PG300_LAB_PROFILE_STATE_'+suffix,journalKey:'QBO_PG300_LAB_PROFILE_JOURNAL_'+suffix,ledgerPointerPrefix:'QBO_PG300_LAB_PROFILE_LEDGER_'+suffix,
  properties:p,lock:LockService.getScriptLock()};
 const raw=qboPg300AdapterCreateIsolated_(cfg),stats={},sequence=[];
 const methods=['withLock','readState','writeState','readJournal','writeJournal','readLedger','writeLedger','listFinal','listStage','createStage','verifyFile','publishStage','now'];
 const io={};methods.forEach(function(name){if(typeof raw[name]!=='function')throw Error('MISSING_ADAPTER_METHOD_'+name);
  io[name]=function(){const t=Date.now();let success=false;try{const v=raw[name].apply(raw,arguments);success=true;return v;}
  finally{const ms=Date.now()-t;const s=stats[name]||(stats[name]={calls:0,ms:0,maxMs:0,failures:0});s.calls++;s.ms+=ms;s.maxMs=Math.max(s.maxMs,ms);if(!success)s.failures++;sequence.push({method:name,ms:ms,ok:success});}};
 });
 const payloads=Array.from({length:16},(_,b)=>({version:'1.5.274',bucket:b,chunk:1,rows:1,hash:'PROFILE_HASH_'+b,entries:[['PROFILE_'+b,'SYNTHETIC','synthetic']]}));
 const src={cursor:0,chunk:1,files:1,rows:16,digest:'PROFILE_SYNTHETIC_DIGEST',payloads:payloads,hashes:payloads.map(x=>x.hash)};
 let phase='INIT',claim=null,result=null,error=null;
 const t=Date.now();
 try{
  phase='INITIAL_STATE';io.writeState({status:'STAGING',fileCursor:0,rows:0,chunk:1,ownerEpoch:0,lease:null});
  phase='CLAIM';claim=qboPg300Claim_(io,0,'PROFILE_'+suffix);
  phase='INTENT';qboPg300Intent_(io,claim,'PROFILE_'+suffix,src);
  phase='PUBLISH_BUCKET_0';result=qboPg300PublishBucket_(io,claim,'PROFILE_'+suffix,src,0);
  phase='VERIFY';const l=io.readLedger(1),fs=io.listFinal(0,1);if(!l||l.entries[0].phase!=='PUBLISHED'||fs.length!==1)throw Error('PROFILE_POSTCHECK_FAILED');
  phase='COMPLETE';
 }catch(e){error={message:String(e),stack:String(e&&e.stack||'')};}
 const report={version:'1.5.300-bucket-profile',status:error?'FAIL':'PASS',isolated:true,rootId:root.getId(),phase,elapsedMs:Date.now()-t,
  bucket:0,artifactPublished:!error&&result&&!result.reused,stats,sequence,error,productionCheckpointWrites:0,productionTriggerChanges:0,workerResumed:false,cleanupPerformed:false};
 console.log(tag+JSON.stringify(report));if(error)throw Error('V1300_GUARDED_BUCKET_PROFILE_FAILED_'+phase);
 return report;
}
