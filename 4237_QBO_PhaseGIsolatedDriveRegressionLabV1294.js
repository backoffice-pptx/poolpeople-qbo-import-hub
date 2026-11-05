/** V1294 isolated Apps Script Drive/Properties regression lab. No production Phase G references. */
const PG1294 = Object.freeze({V:'1.5.294',PREFIX:'QBO_PG_V1294_LAB_',BUCKETS:16});
function pg1294Assert_(x,m){if(!x)throw Error('V1294_'+m);}
function pg1294Get_(f,n){const it=f.getFilesByName(n),a=[];while(it.hasNext())a.push(it.next());return a;}
function pg1294Payload_(bucket,chunk,entries){return {version:PG1294.V,bucket:bucket,chunk:chunk,rows:entries.length,entries:entries};}
function pg1294Validate_(file,expected){let p;try{p=JSON.parse(file.getBlob().getDataAsString());}catch(e){throw Error('V1294_UNREADABLE');}pg1294Assert_(p.version===expected.version&&p.bucket===expected.bucket&&p.chunk===expected.chunk&&p.rows===expected.rows&&JSON.stringify(p.entries)===JSON.stringify(expected.entries),'PAYLOAD_MISMATCH');return p;}
function pg1294Error_(fn,fragment){let err='';try{fn();}catch(e){err=String(e.message||e);}pg1294Assert_(err.indexOf(fragment)>=0,'EXPECTED_ERROR_'+fragment+'_'+err);}
function pg1294State_(key){return JSON.parse(PropertiesService.getScriptProperties().getProperty(key)||'null');}
function pg1294Put_(key,v){PropertiesService.getScriptProperties().setProperty(key,JSON.stringify(v));}
function pg1294Publish_(dir,key,expected,crashAt){
  const s=pg1294State_(key);pg1294Assert_(s&&s.epoch===1,'OWNERSHIP');
  const final='chunk_000085.json',staging='staging_'+s.runId+'.json';
  const finals=pg1294Get_(dir,final);pg1294Assert_(finals.length<=1,'DUPLICATE_FINAL');
  if(finals.length===1){pg1294Validate_(finals[0],expected);pg1294Put_(key,Object.assign({},s,{phase:'PUBLISHED',finalId:finals[0].getId()}));return {reused:true,id:finals[0].getId()};}
  const staged=pg1294Get_(dir,staging);pg1294Assert_(staged.length<=1,'DUPLICATE_STAGING');
  if(staged.length===1&&(!s.stageId||s.stageId!==staged[0].getId()))throw Error('V1294_ORPHAN_REVIEW_REQUIRED');
  let f=staged[0];
  if(!f){f=dir.createFile(staging,JSON.stringify(expected),MimeType.PLAIN_TEXT);if(crashAt==='CREATE')throw Error('V1294_SIMULATED_CRASH_CREATE');pg1294Put_(key,Object.assign({},s,{phase:'STAGED',stageId:f.getId()}));}
  pg1294Validate_(f,expected);if(crashAt==='VERIFY')throw Error('V1294_SIMULATED_CRASH_VERIFY');
  // Recheck under the test lock; real Drive rename is not an atomic transaction.
  pg1294Assert_(pg1294Get_(dir,final).length===0,'FINAL_RACE');
  f.setName(final);if(crashAt==='RENAME')throw Error('V1294_SIMULATED_CRASH_RENAME');
  pg1294Put_(key,Object.assign({},pg1294State_(key),{phase:'PUBLISHED',finalId:f.getId()}));return {reused:false,id:f.getId()};
}
function runQboPhaseGIsolatedDriveRegressionV1294(){
 const lock=LockService.getScriptLock();pg1294Assert_(lock.tryLock(1000),'LAB_LOCK_BUSY');
 const props=PropertiesService.getScriptProperties();const runId=Utilities.getUuid(),keyPrefix=PG1294.PREFIX+runId+'_';
 const root=DriveApp.createFolder('QBO_PG_V1294_ISOLATED_'+runId),results=[];
 function test(name,fn){try{const details=fn()||{};results.push({name,status:'PASS',details});}catch(e){results.push({name,status:'FAIL',error:String(e&&e.stack||e)});}}
 function scenario(tag){const dir=root.createFolder(tag),key=keyPrefix+tag;pg1294Put_(key,{runId:runId,epoch:1,phase:'INTENT',checkpoint:791,journal:'STAGING'});return {dir,key,expected:pg1294Payload_(0,85,[{id:'synthetic-'+tag,value:1}])};}
 try{
 test('NORMAL_PUBLICATION_AND_REGISTRY',()=>{const x=scenario('normal'),r=pg1294Publish_(x.dir,x.key,x.expected);pg1294Assert_(pg1294State_(x.key).finalId===r.id,'REGISTRY');return {finalCount:pg1294Get_(x.dir,'chunk_000085.json').length};});
 test('IDEMPOTENT_REUSE',()=>{const x=scenario('reuse');const a=pg1294Publish_(x.dir,x.key,x.expected),b=pg1294Publish_(x.dir,x.key,x.expected);pg1294Assert_(b.reused&&a.id===b.id,'REUSE');});
 test('CHUNK85_EMPTY_DUPLICATE_FINAL_HALTS',()=>{const x=scenario('chunk85');x.dir.createFile('chunk_000085.json','',MimeType.PLAIN_TEXT);x.dir.createFile('chunk_000085.json',JSON.stringify(x.expected),MimeType.PLAIN_TEXT);pg1294Error_(()=>pg1294Publish_(x.dir,x.key,x.expected),'DUPLICATE_FINAL');pg1294Assert_(pg1294State_(x.key).checkpoint===791,'CHECKPOINT_CHANGED');});
 test('EMPTY_FINAL_HALTS',()=>{const x=scenario('empty');x.dir.createFile('chunk_000085.json','',MimeType.PLAIN_TEXT);pg1294Error_(()=>pg1294Publish_(x.dir,x.key,x.expected),'UNREADABLE');});
 test('MISMATCHED_FINAL_HALTS',()=>{const x=scenario('mismatch');x.dir.createFile('chunk_000085.json',JSON.stringify(pg1294Payload_(0,85,[{id:'wrong'}])),MimeType.PLAIN_TEXT);pg1294Error_(()=>pg1294Publish_(x.dir,x.key,x.expected),'PAYLOAD_MISMATCH');});
 test('CRASH_AFTER_CREATE_ORPHAN_HALTS',()=>{const x=scenario('create');pg1294Error_(()=>pg1294Publish_(x.dir,x.key,x.expected,'CREATE'),'SIMULATED_CRASH_CREATE');pg1294Error_(()=>pg1294Publish_(x.dir,x.key,x.expected),'ORPHAN_REVIEW_REQUIRED');});
 test('CRASH_AFTER_VERIFY_REUSES_STAGING',()=>{const x=scenario('verify');pg1294Error_(()=>pg1294Publish_(x.dir,x.key,x.expected,'VERIFY'),'SIMULATED_CRASH_VERIFY');const a=pg1294State_(x.key).stageId,b=pg1294Publish_(x.dir,x.key,x.expected);pg1294Assert_(a===b.id,'STAGE_ID_CHANGED');});
 test('CRASH_AFTER_RENAME_RECONCILES_FINAL',()=>{const x=scenario('rename');pg1294Error_(()=>pg1294Publish_(x.dir,x.key,x.expected,'RENAME'),'SIMULATED_CRASH_RENAME');pg1294Assert_(pg1294State_(x.key).phase!=='PUBLISHED','PREMATURE_REGISTRY');const b=pg1294Publish_(x.dir,x.key,x.expected);pg1294Assert_(b.reused&&pg1294State_(x.key).phase==='PUBLISHED','FINAL_RECONCILE');});
 test('CHECKPOINT_JOURNAL_RESTART_SEPARATION',()=>{const x=scenario('separation');pg1294Publish_(x.dir,x.key,x.expected);const s=pg1294State_(x.key);pg1294Assert_(s.checkpoint===791&&s.journal==='STAGING'&&s.trigger===undefined,'MUTATED_COMMIT_STATE');});
 test('STALE_EPOCH_REJECTED',()=>{const x=scenario('stale');pg1294Put_(x.key,Object.assign({},pg1294State_(x.key),{epoch:2}));pg1294Error_(()=>pg1294Publish_(x.dir,x.key,x.expected),'OWNERSHIP');});
 }finally{lock.releaseLock();}
 const passed=results.filter(x=>x.status==='PASS').length,failed=results.length-passed;
 const report={version:PG1294.V,isolated:true,rootFolderId:root.getId(),runId:runId,passed,failed,results,productionCheckpointWrites:0,productionTriggerChanges:0,cleanupPerformed:false,realHardTerminationTested:false,realConcurrentExecutionsTested:false};
 console.log('[PHASE G V1294] | ISOLATED_DRIVE_REGRESSION | '+JSON.stringify(report));return report;
}
