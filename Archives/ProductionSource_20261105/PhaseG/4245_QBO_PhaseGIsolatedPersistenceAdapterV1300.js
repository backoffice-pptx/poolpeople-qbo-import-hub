/** V1300 persistence adapter — DEVELOPMENT ONLY.
 * Deliberately has no production factory, trigger, or executable worker entrypoint.
 * Uses injected isolated property keys and folder IDs only. Do not deploy.
 * Requires 4243 guarded core; all ownership claims must use the same ScriptLock.
 */
const QBO_PG300_ADAPTER_=Object.freeze({V:'1.5.300',BUCKETS:16});
function qboPg300AdapterAssert_(ok,reason){if(!ok)throw Error('V1300_ADAPTER_'+reason);}
function qboPg300AdapterJson_(text,kind){if(!text)return null;try{return JSON.parse(text);}catch(e){throw Error('V1300_ADAPTER_INVALID_'+kind);}}
function qboPg300AdapterSingle_(folder,name){const it=folder.getFilesByName(name);if(!it.hasNext())return null;const f=it.next();qboPg300AdapterAssert_(!it.hasNext(),'DUPLICATE_'+name);return f;}
function qboPg300AdapterWriteFile_(folder,name,value){const bytes=JSON.stringify(value);let f=qboPg300AdapterSingle_(folder,name);if(!f)f=folder.createFile(name,bytes,MimeType.PLAIN_TEXT);else f.setContent(bytes);qboPg300AdapterAssert_(f.getBlob().getDataAsString()===bytes,'LEDGER_READBACK');return f;}
function qboPg300AdapterCreateIsolated_(cfg){
 qboPg300AdapterAssert_(cfg&&cfg.isolated===true&&cfg.properties&&cfg.lock&&cfg.ledgerFolderId&&cfg.stageFolderId,'ISOLATION_REQUIRED');
 qboPg300AdapterAssert_(typeof cfg.stateKey==='string'&&cfg.stateKey.indexOf('QBO_PG300_LAB_')===0,'STATE_KEY_NOT_LAB');
 qboPg300AdapterAssert_(typeof cfg.journalKey==='string'&&cfg.journalKey.indexOf('QBO_PG300_LAB_')===0,'JOURNAL_KEY_NOT_LAB');
 qboPg300AdapterAssert_(cfg.stateKey!==cfg.journalKey,'KEY_COLLISION');
 qboPg300AdapterAssert_(typeof cfg.ledgerPointerPrefix==='string'&&cfg.ledgerPointerPrefix.indexOf('QBO_PG300_LAB_')===0,'LEDGER_POINTER_NOT_LAB');
 qboPg300AdapterAssert_(Array.isArray(cfg.bucketFolderIds)&&cfg.bucketFolderIds.length===16&&new Set(cfg.bucketFolderIds).size===16,'BUCKET_FOLDERS');
 const p=cfg.properties, ledgerFolder=DriveApp.getFolderById(cfg.ledgerFolderId),stageFolder=DriveApp.getFolderById(cfg.stageFolderId);
 const buckets=cfg.bucketFolderIds.map(id=>DriveApp.getFolderById(id));
 const ledgerName=chunk=>'ledger_'+('000000'+chunk).slice(-6)+'.json';
 const ledgerPrefix=chunk=>ledgerName(chunk).replace('.json','_gen_');
 const pointerKey=chunk=>cfg.ledgerPointerPrefix+'_'+chunk;
 function ledgerDigest(value){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(value)).map(b=>('0'+(b&255).toString(16)).slice(-2)).join('');}
 function ledgerGenerationFiles(chunk){const prefix=ledgerPrefix(chunk),it=ledgerFolder.getFiles(),out=[];while(it.hasNext()){const f=it.next();if(f.getName().indexOf(prefix)===0)out.push(f);}return out;}
 // Every immutable generation is linked to its predecessor by file ID and monotonic sequence.
 // The current pointer must account for *all* generation files; an extra file is
 // a possible crash between create and pointer advance and requires review.
 function inspectGenerationCustody(chunk){
  const raw=p.getProperty(pointerKey(chunk)),files=ledgerGenerationFiles(chunk);
  if(!raw){qboPg300AdapterAssert_(files.length===0,'UNREFERENCED_LEDGER_GENERATION_REVIEW');return {ledger:null,head:null,sequence:0};}
  const ptr=qboPg300AdapterJson_(raw,'LEDGER_POINTER');
  qboPg300AdapterAssert_(ptr&&ptr.chunk===chunk&&ptr.id&&ptr.digest&&Number.isInteger(ptr.sequence)&&ptr.sequence>=1,'BAD_LEDGER_POINTER');
  const byId={};
  files.forEach(f=>{const id=f.getId();qboPg300AdapterAssert_(!byId[id],'DUPLICATE_LEDGER_ID');byId[id]=f;});
  const visited=new Set();let current=ptr.id,expectedSeq=ptr.sequence,head=null;
  while(current){
   qboPg300AdapterAssert_(!visited.has(current),'LEDGER_CUSTODY_CYCLE');
   const f=byId[current];qboPg300AdapterAssert_(!!f,'LEDGER_POINTER_FILE_MISSING');
   const g=qboPg300AdapterJson_(f.getBlob().getDataAsString(),'LEDGER_GENERATION');
   qboPg300AdapterAssert_(g&&g.chunk===chunk&&Array.isArray(g.entries)&&g.entries.length===16&&g.custody&&g.custody.sequence===expectedSeq,'LEDGER_CUSTODY_SEQUENCE');
   qboPg300AdapterAssert_(g.custody.parentId===null||typeof g.custody.parentId==='string','LEDGER_CUSTODY_PARENT');
   if(!head){head=g;qboPg300AdapterAssert_(ledgerDigest(g)===ptr.digest,'LEDGER_GENERATION_CORRUPT');}
   visited.add(current);current=g.custody.parentId;expectedSeq--;
   qboPg300AdapterAssert_(expectedSeq>=0,'LEDGER_CUSTODY_DEPTH');
  }
  qboPg300AdapterAssert_(expectedSeq===0,'LEDGER_CUSTODY_INCOMPLETE');
  qboPg300AdapterAssert_(visited.size===files.length,'UNREFERENCED_LEDGER_GENERATION_REVIEW');
  return {ledger:head,head:ptr.id,sequence:ptr.sequence};
 }
 function readLedgerGeneration(chunk){return inspectGenerationCustody(chunk).ledger;}
 function writeLedgerGeneration(chunk,ledger){
  qboPg300AdapterAssert_(ledger&&ledger.chunk===chunk&&Array.isArray(ledger.entries)&&ledger.entries.length===16,'BAD_LEDGER');
  const custody=inspectGenerationCustody(chunk);
  const next=JSON.parse(JSON.stringify(ledger));
  next.custody={sequence:custody.sequence+1,parentId:custody.head};
  const digest=ledgerDigest(next),name=ledgerPrefix(chunk)+Utilities.getUuid()+'.json';
  const bytes=JSON.stringify(next),f=ledgerFolder.createFile(name,bytes,MimeType.PLAIN_TEXT);
  qboPg300AdapterAssert_(f.getBlob().getDataAsString()===bytes,'LEDGER_GENERATION_READBACK');
  // Failure here leaves an unreferenced generation; the next read halts for review.
  p.setProperty(pointerKey(chunk),JSON.stringify({chunk,id:f.getId(),digest,sequence:next.custody.sequence}));
  qboPg300AdapterAssert_(inspectGenerationCustody(chunk).head===f.getId(),'LEDGER_POINTER_READBACK');
 }
 const finalName=chunk=>'chunk_'+('000000'+chunk).slice(-6)+'.json';
 const stageName=(bucket,chunk)=>'stage_b'+('0'+bucket).slice(-2)+'_chunk_'+('000000'+chunk).slice(-6)+'.json';
 function list(folder,name){const it=folder.getFilesByName(name),out=[];while(it.hasNext()){const f=it.next();out.push({id:f.getId(),file:f});}return out;}
 function fileObject(item){return item.file||DriveApp.getFileById(item.id);}
 return {
  now:()=>Date.now(),
  withLock(fn){qboPg300AdapterAssert_(cfg.lock.tryLock(30000),'LOCK_BUSY');try{return fn();}finally{cfg.lock.releaseLock();}},
  readState:()=>qboPg300AdapterJson_(p.getProperty(cfg.stateKey),'STATE'),
  writeState(s){qboPg300AdapterAssert_(s&&typeof s.fileCursor==='number'&&typeof s.chunk==='number','BAD_STATE');p.setProperty(cfg.stateKey,JSON.stringify(s));},
  readJournal:()=>qboPg300AdapterJson_(p.getProperty(cfg.journalKey),'JOURNAL'),
  writeJournal(j){qboPg300AdapterAssert_(j&&j.phase==='STAGING'&&Number.isInteger(j.cursor),'BAD_JOURNAL');p.setProperty(cfg.journalKey,JSON.stringify(j));},
  clearJournal(){p.deleteProperty(cfg.journalKey);},
  readLedger(chunk){return readLedgerGeneration(chunk);},
  writeLedger(chunk,ledger){writeLedgerGeneration(chunk,ledger);},
  listFinal(bucket,chunk){return list(buckets[bucket],finalName(chunk));},
  listStage(bucket,chunk){return list(stageFolder,stageName(bucket,chunk)).concat(list(buckets[bucket],stageName(bucket,chunk)));},
  createStage(bucket,chunk,payload){const name=stageName(bucket,chunk);qboPg300AdapterAssert_(list(stageFolder,name).length===0,'STAGE_EXISTS');const f=stageFolder.createFile(name,JSON.stringify(payload),MimeType.PLAIN_TEXT);return {id:f.getId(),file:f};},
  verifyFile(item,payload){const f=fileObject(item),actual=f.getBlob().getDataAsString();qboPg300AdapterAssert_(actual===JSON.stringify(payload),'PAYLOAD_MISMATCH');return true;},
  publishStage(item,bucket,chunk){const f=fileObject(item);qboPg300AdapterAssert_(list(buckets[bucket],finalName(chunk)).length===0,'FINAL_EXISTS');
   // Caller must hold the same lock used for all ownership claims/takeovers.
   // If interrupted after moveTo, the stage file already resides in this bucket.
   if(f.getParents().hasNext()&&f.getParents().next().getId()!==buckets[bucket].getId())f.moveTo(buckets[bucket]);
   f.setName(finalName(chunk));
   qboPg300AdapterAssert_(list(buckets[bucket],finalName(chunk)).length===1,'PUBLISH_READBACK');return {id:f.getId()};}
 };
}
/** Read-only contract inspection. Does not initialize or mutate lab/production. */
function qboPg300AdapterInspect_(io,chunk){const s=io.readState(),j=io.readJournal(),l=io.readLedger(chunk);return {state:s&&{status:s.status,fileCursor:s.fileCursor,rows:s.rows,chunk:s.chunk,ownerEpoch:s.ownerEpoch},journal:j,ledger:l&&{chunk:l.chunk,cursor:l.cursor,sourceDigest:l.sourceDigest,entries:l.entries.map(e=>({bucket:e.bucket,phase:e.phase,stageId:e.stageId,finalId:e.finalId}))}};}
