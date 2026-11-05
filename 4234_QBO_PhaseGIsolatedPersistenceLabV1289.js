/** V1289 isolated Apps Script persistence and Drive lab. No production state access.
 * Run runQboPhaseGIsolatedPersistenceLabV1289 once from the browser editor.
 * Uses a unique Script Properties prefix and new root Drive folder.
 * Intentionally leaves evidence folder and a small run summary property.
 */
const QBO_PG1289_ = Object.freeze({PREFIX:'QBO_PG1289_LAB_', VERSION:'1.5.289'});
function qboPg1289Assert_(x, m) { if (!x) throw Error('V1289_'+m); }
function qboPg1289Hash_(s) {
  const bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s,Utilities.Charset.UTF_8);
  return bytes.map(x=>('0'+(x<0?x+256:x).toString(16)).slice(-2)).join('');
}
function qboPg1289Files_(dir,name) {
  const it=dir.getFilesByName(name),a=[]; while(it.hasNext()) a.push(it.next()); return a;
}
function qboPg1289Read_(f,expected) {
  const raw=f.getBlob().getDataAsString();
  qboPg1289Assert_(raw.length>0,'EMPTY_ARTIFACT');
  qboPg1289Assert_(raw===expected,'PAYLOAD_MISMATCH');
  const x=JSON.parse(raw);
  qboPg1289Assert_(x.version===QBO_PG1289_.VERSION,'VERSION_MISMATCH');
  return x;
}
function qboPg1289Save_(p,key,record) {
  p.setProperty(key,JSON.stringify(record));
  const read=p.getProperty(key);
  qboPg1289Assert_(read===JSON.stringify(record),'REGISTRY_READBACK');
}
function qboPg1289Publish_(p,key,folder,payload,opts) {
  opts=opts||{};
  const raw=p.getProperty(key);
  qboPg1289Assert_(!!raw,'NO_INTENT');
  const rec=JSON.parse(raw);
  qboPg1289Assert_(rec.folderId===folder.getId(),'FOLDER_MISMATCH');
  qboPg1289Assert_(rec.hash===qboPg1289Hash_(payload),'SOURCE_MISMATCH');
  const finals=qboPg1289Files_(folder,rec.finalName);
  qboPg1289Assert_(finals.length<=1,'DUPLICATE_FINAL');
  if(finals.length===1) {
    qboPg1289Read_(finals[0],payload);
    qboPg1289Assert_(!rec.stagingId || rec.stagingId===finals[0].getId() || rec.phase==='INTENT','UNRESOLVED_STAGING');
    rec.phase='PUBLISHED'; rec.finalId=finals[0].getId(); qboPg1289Save_(p,key,rec);
    return {reused:true,finalId:rec.finalId};
  }
  let stage;
  if(rec.stagingId) {
    stage=DriveApp.getFileById(rec.stagingId);
    qboPg1289Assert_(stage.getName()===rec.stageName,'STAGING_NAME_CHANGED');
    const parents=stage.getParents();
    qboPg1289Assert_(parents.hasNext() && parents.next().getId()===folder.getId() && !parents.hasNext(),'STAGING_PARENT_CHANGED');
  } else {
    const orphans=qboPg1289Files_(folder,rec.stageName);
    qboPg1289Assert_(orphans.length===0,'UNREGISTERED_ORPHAN');
    stage=folder.createFile(rec.stageName,payload,MimeType.PLAIN_TEXT);
    if(opts.failAfterCreate) throw Error('V1289_INJECTED_AFTER_CREATE');
    rec.stagingId=stage.getId(); rec.phase='STAGED'; qboPg1289Save_(p,key,rec);
  }
  qboPg1289Read_(stage,payload);
  rec.phase='VERIFIED'; qboPg1289Save_(p,key,rec);
  if(opts.failAfterVerify) throw Error('V1289_INJECTED_AFTER_VERIFY');
  qboPg1289Assert_(qboPg1289Files_(folder,rec.finalName).length===0,'FINAL_APPEARED');
  stage.setName(rec.finalName);
  if(opts.failAfterRename) throw Error('V1289_INJECTED_AFTER_RENAME');
  const after=qboPg1289Files_(folder,rec.finalName);
  qboPg1289Assert_(after.length===1 && after[0].getId()===stage.getId(),'FINAL_PUBLICATION_AMBIGUOUS');
  qboPg1289Read_(after[0],payload);
  rec.phase='PUBLISHED'; rec.finalId=stage.getId(); qboPg1289Save_(p,key,rec);
  return {reused:false,finalId:rec.finalId};
}
function runQboPhaseGIsolatedPersistenceLabV1289() {
  const lock=LockService.getScriptLock();
  qboPg1289Assert_(lock.tryLock(1000),'SCRIPT_LOCK_BUSY');
  const p=PropertiesService.getScriptProperties();
  const runId=Utilities.getUuid(), prefix=QBO_PG1289_.PREFIX+runId+'_';
  const root=DriveApp.createFolder('QBO_PG_V1289_ISOLATED_'+runId);
  const results=[];
  function test(name,fn) {
    try { const details=fn()||{}; results.push({name,status:'PASS',details}); }
    catch(e) { results.push({name,status:'FAIL',error:String(e)}); }
  }
  function scenario(name) {
    const folder=root.createFolder(name);
    const key=prefix+name;
    const payload=JSON.stringify({version:QBO_PG1289_.VERSION,entries:[[name,'synthetic-source',1]]});
    const rec={phase:'INTENT',folderId:folder.getId(),finalName:'chunk_000001.json',stageName:'stage_'+runId+'_'+name+'.json',stagingId:null,finalId:null,hash:qboPg1289Hash_(payload)};
    qboPg1289Save_(p,key,rec);
    return {folder,key,payload};
  }
  try {
    test('NORMAL_PUBLICATION_AND_REGISTRY_READBACK',()=>{
      const s=scenario('normal'),a=qboPg1289Publish_(p,s.key,s.folder,s.payload);
      qboPg1289Assert_(JSON.parse(p.getProperty(s.key)).phase==='PUBLISHED','NOT_PUBLISHED');
      return a;
    });
    test('IDEMPOTENT_REUSE',()=>{
      const s=scenario('reuse'); qboPg1289Publish_(p,s.key,s.folder,s.payload);
      const a=qboPg1289Publish_(p,s.key,s.folder,s.payload);
      qboPg1289Assert_(a.reused && qboPg1289Files_(s.folder,'chunk_000001.json').length===1,'REUSE_FAILED'); return a;
    });
    test('CRASH_AFTER_VERIFY_RECOVERS',()=>{
      const s=scenario('verify');
      try { qboPg1289Publish_(p,s.key,s.folder,s.payload,{failAfterVerify:true}); }
      catch(e) { qboPg1289Assert_(String(e).includes('INJECTED_AFTER_VERIFY'),'WRONG_ERROR'); }
      return qboPg1289Publish_(p,s.key,s.folder,s.payload);
    });
    test('CRASH_AFTER_RENAME_RECOVERS',()=>{
      const s=scenario('rename');
      try { qboPg1289Publish_(p,s.key,s.folder,s.payload,{failAfterRename:true}); }
      catch(e) { qboPg1289Assert_(String(e).includes('INJECTED_AFTER_RENAME'),'WRONG_ERROR'); }
      return qboPg1289Publish_(p,s.key,s.folder,s.payload);
    });
    test('CRASH_AFTER_CREATE_HALTS_ON_ORPHAN',()=>{
      const s=scenario('orphan');
      try { qboPg1289Publish_(p,s.key,s.folder,s.payload,{failAfterCreate:true}); }
      catch(e) { qboPg1289Assert_(String(e).includes('INJECTED_AFTER_CREATE'),'WRONG_ERROR'); }
      let blocked=false;
      try { qboPg1289Publish_(p,s.key,s.folder,s.payload); }
      catch(e) { blocked=String(e).includes('UNREGISTERED_ORPHAN'); }
      qboPg1289Assert_(blocked,'ORPHAN_NOT_BLOCKED');
    });
    test('EMPTY_FINAL_HALTS',()=>{
      const s=scenario('empty');s.folder.createFile('chunk_000001.json','',MimeType.PLAIN_TEXT);
      let blocked=false;try { qboPg1289Publish_(p,s.key,s.folder,s.payload); } catch(e){blocked=String(e).includes('EMPTY_ARTIFACT');}
      qboPg1289Assert_(blocked,'EMPTY_NOT_BLOCKED');
    });
    test('DUPLICATE_FINAL_HALTS',()=>{
      const s=scenario('duplicate');
      s.folder.createFile('chunk_000001.json',s.payload,MimeType.PLAIN_TEXT);
      s.folder.createFile('chunk_000001.json',s.payload,MimeType.PLAIN_TEXT);
      let blocked=false;try { qboPg1289Publish_(p,s.key,s.folder,s.payload); } catch(e){blocked=String(e).includes('DUPLICATE_FINAL');}
      qboPg1289Assert_(blocked,'DUPLICATE_NOT_BLOCKED');
    });
    test('SOURCE_MISMATCH_HALTS',()=>{
      const s=scenario('mismatch');let blocked=false;
      try { qboPg1289Publish_(p,s.key,s.folder,s.payload+'changed'); } catch(e){blocked=String(e).includes('SOURCE_MISMATCH');}
      qboPg1289Assert_(blocked,'SOURCE_NOT_BLOCKED');
    });
    test('REGISTRY_PERSISTS_ACROSS_READS',()=>{
      const s=scenario('persist');const a=JSON.parse(p.getProperty(s.key));
      qboPg1289Assert_(a.phase==='INTENT' && a.folderId===s.folder.getId(),'PERSISTENCE_FAILED');
    });
  } finally { lock.releaseLock(); }
  const passed=results.filter(x=>x.status==='PASS').length;
  const out={version:QBO_PG1289_.VERSION,isolated:true,rootFolderId:root.getId(),runId,passed,failed:results.length-passed,results,productionCheckpointWrites:0,productionTriggerChanges:0,realConcurrentExecutionsTested:false,cleanupPerformed:false};
  // Lab properties are retained as evidence; no production keys are accessed.
  console.log('[PHASE G V1289] | ISOLATED_PERSISTENCE_TEST | '+JSON.stringify(out));
  return out;
}

