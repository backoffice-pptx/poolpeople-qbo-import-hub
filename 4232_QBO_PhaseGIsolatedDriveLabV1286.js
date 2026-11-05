/** V1286 isolated Drive integration lab. NO production property/trigger access.
 * Explicit invocation creates a NEW root folder in My Drive and retains it as evidence.
 * No source files, checkpoint keys, bucket IDs or existing production folders referenced.
 */
const QBO_PG286_ = Object.freeze({V:'1.5.286',B:16,PREFIX:'QBO_PG_V1286_ISOLATED_TEST_'});
function qboPg286Assert_(ok,why){if(!ok)throw Error('V1286_ASSERT '+why);}
function qboPg286Files_(dir,name){const it=dir.getFilesByName(name),a=[];while(it.hasNext())a.push(it.next());return a;}
function qboPg286Name_(chunk){return 'chunk_'+('000000'+chunk).slice(-6)+'.json';}
function qboPg286Hash_(entries){return qboPg271Hash_(JSON.stringify(entries));}
function qboPg286Expected_(bucket,chunk,entries){return {version:'1.5.274',bucket,chunk,rows:entries.length,hash:qboPg286Hash_(entries),entries};}
function qboPg286Verify_(f,e){let x;try{x=JSON.parse(f.getBlob().getDataAsString());}catch(err){throw Error('V1286_BAD_JSON '+f.getId());}
 if(x.version!==e.version||x.bucket!==e.bucket||x.chunk!==e.chunk||x.rows!==e.rows||x.hash!==e.hash||!Array.isArray(x.entries)||qboPg286Hash_(x.entries)!==e.hash||JSON.stringify(x.entries)!==JSON.stringify(e.entries))throw Error('V1286_PAYLOAD_MISMATCH '+f.getId());return true;}
/** Fail closed on duplicates; never remove or automatically quarantine anything. */
function qboPg286Publish_(dir,e,options){options=options||{};const name=qboPg286Name_(e.chunk),prior=qboPg286Files_(dir,name);
 if(prior.length>1)throw Error('V1286_DUPLICATE_FINAL');
 if(prior.length===1){qboPg286Verify_(prior[0],e);return {status:'REUSED',id:prior[0].getId()};}
 // Staging file uses unique UUID and remains retained on failure.
 const tempName='_staging_'+name+'_'+Utilities.getUuid();
 const temp=dir.createFile(tempName,JSON.stringify(e),MimeType.PLAIN_TEXT);
 if(options.stop==='AFTER_CREATE')throw Error('V1286_INJECT_AFTER_CREATE');
 qboPg286Verify_(temp,e);
 if(options.stop==='AFTER_VERIFY')throw Error('V1286_INJECT_AFTER_VERIFY');
 if(qboPg286Files_(dir,name).length)throw Error('V1286_PUBLICATION_RACE');
 temp.setName(name);
 if(options.stop==='AFTER_RENAME')throw Error('V1286_INJECT_AFTER_RENAME');
 const final=qboPg286Files_(dir,name);
 if(final.length!==1||final[0].getId()!==temp.getId())throw Error('V1286_PUBLICATION_VISIBILITY');
 qboPg286Verify_(final[0],e);
 return {status:'PUBLISHED',id:temp.getId()};
}
/** Lab-only observations. Synthetic entries; no production data. */
function runQboPhaseGIsolatedDriveLabV1286(){
 const root=DriveApp.createFolder(QBO_PG286_.PREFIX+Utilities.getUuid());
 const results=[],buckets=[];
 function test(name,fn){try{const details=fn()||{};results.push({name,status:'PASS',details});}catch(e){results.push({name,status:'FAIL',error:String(e)});}}
 function expectFailure(fn,fragment){let msg='';try{fn();}catch(e){msg=String(e);}qboPg286Assert_(msg.indexOf(fragment)>=0,'expected '+fragment+' got '+msg);}
 try{
  for(let b=0;b<16;b++)buckets.push(root.createFolder('B_'+('0'+b).slice(-2)));
  const chunk=900001,entriesByBucket=Array.from({length:16},(_,b)=>[[`LAB_ID_${b}`,`LAB_SOURCE_${b}`,b]]);
  test('16_BUCKET_PUBLISH_AND_READBACK',()=>{const ids=[];for(let b=0;b<16;b++){const e=qboPg286Expected_(b,chunk,entriesByBucket[b]);const o=qboPg286Publish_(buckets[b],e);qboPg286Assert_(o.status==='PUBLISHED','publish '+b);ids.push(o.id);}return {count:ids.length};});
  test('16_BUCKET_REUSE_IDEMPOTENT',()=>{for(let b=0;b<16;b++){const e=qboPg286Expected_(b,chunk,entriesByBucket[b]);qboPg286Assert_(qboPg286Publish_(buckets[b],e).status==='REUSED','reuse '+b);}return {count:16};});
  test('EMPTY_FINAL_HALTS',()=>{const dir=root.createFolder('EMPTY_FINAL');dir.createFile(qboPg286Name_(chunk),'',MimeType.PLAIN_TEXT);expectFailure(()=>qboPg286Publish_(dir,qboPg286Expected_(0,chunk,entriesByBucket[0])),'BAD_JSON');});
  test('DUPLICATE_FINAL_HALTS',()=>{const dir=root.createFolder('DUPLICATE_FINAL'),name=qboPg286Name_(chunk);dir.createFile(name,'',MimeType.PLAIN_TEXT);dir.createFile(name,'',MimeType.PLAIN_TEXT);expectFailure(()=>qboPg286Publish_(dir,qboPg286Expected_(0,chunk,entriesByBucket[0])),'DUPLICATE_FINAL');qboPg286Assert_(qboPg286Files_(dir,name).length===2,'duplicates preserved');});
  test('MISMATCH_FINAL_HALTS',()=>{const dir=root.createFolder('MISMATCH_FINAL'),e=qboPg286Expected_(0,chunk,entriesByBucket[0]);dir.createFile(qboPg286Name_(chunk),JSON.stringify({...e,rows:999}),MimeType.PLAIN_TEXT);expectFailure(()=>qboPg286Publish_(dir,e),'PAYLOAD_MISMATCH');});
  test('CRASH_AFTER_CREATE_RETAINS_ORPHAN',()=>{const dir=root.createFolder('AFTER_CREATE'),e=qboPg286Expected_(0,chunk,entriesByBucket[0]);expectFailure(()=>qboPg286Publish_(dir,e,{stop:'AFTER_CREATE'}),'INJECT_AFTER_CREATE');qboPg286Assert_(qboPg286Files_(dir,qboPg286Name_(chunk)).length===0,'no final');qboPg286Assert_(dir.getFiles().hasNext(),'orphan preserved');});
  test('CRASH_AFTER_VERIFY_RETAINS_ORPHAN',()=>{const dir=root.createFolder('AFTER_VERIFY'),e=qboPg286Expected_(0,chunk,entriesByBucket[0]);expectFailure(()=>qboPg286Publish_(dir,e,{stop:'AFTER_VERIFY'}),'INJECT_AFTER_VERIFY');qboPg286Assert_(qboPg286Files_(dir,qboPg286Name_(chunk)).length===0,'no final');});
  test('CRASH_AFTER_RENAME_REUSES_FINAL',()=>{const dir=root.createFolder('AFTER_RENAME'),e=qboPg286Expected_(0,chunk,entriesByBucket[0]);expectFailure(()=>qboPg286Publish_(dir,e,{stop:'AFTER_RENAME'}),'INJECT_AFTER_RENAME');qboPg286Assert_(qboPg286Publish_(dir,e).status==='REUSED','recover by reuse');qboPg286Assert_(qboPg286Files_(dir,qboPg286Name_(chunk)).length===1,'one final');});
  test('EMPTY_STAGING_READBACK_HALTS',()=>{const dir=root.createFolder('EMPTY_STAGING'),e=qboPg286Expected_(0,chunk,entriesByBucket[0]);const f=dir.createFile('_staging_injected','',MimeType.PLAIN_TEXT);expectFailure(()=>qboPg286Verify_(f,e),'BAD_JSON');});
  test('CROSS_BUCKET_TOTAL',()=>{const total=entriesByBucket.reduce((n,x)=>n+x.length,0);qboPg286Assert_(total===16,'total');for(let b=0;b<16;b++)qboPg286Verify_(qboPg286Files_(buckets[b],qboPg286Name_(chunk))[0],qboPg286Expected_(b,chunk,entriesByBucket[b]));return {rows:total};});
 }finally{
  const out={version:QBO_PG286_.V,isolated:true,rootFolderId:root.getId(),rootFolderName:root.getName(),passed:results.filter(x=>x.status==='PASS').length,failed:results.filter(x=>x.status==='FAIL').length,results,productionPropertyWrites:0,productionTriggerChanges:0,cleanupPerformed:false};
  console.log('[PHASE G V1286] | ISOLATED_DRIVE_TEST | '+JSON.stringify(out));
 }
 return {rootFolderId:root.getId(),results};
}
