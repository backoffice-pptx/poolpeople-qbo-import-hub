/** V1.5.276 reusable, fail-closed V1274 STAGING journal recovery.
 * Source is the immutable V1271 index; never modifies index, partitions or exports.
 * Run preview before recovery. Recovery is retryable after partial artifact writes,
 * checkpoint-save/journal-delete interruption, and trigger/state-transition interruption.
 */
const QBO_PG276_=Object.freeze({V:'1.5.276',MAX_FILES:10,B:16});
function qboPg276Lock_(fn){const lock=LockService.getScriptLock();if(!lock.tryLock(10000))throw Error('V1276_LOCK_BUSY');try{return fn();}finally{lock.releaseLock();}}
function qboPg276Context_(){
 const p=qboPg274P_(),s=qboPg274S_(),raw=p.getProperty(QBO_PG274_.KEY+'_JOURNAL'),j=raw?JSON.parse(raw):null;
 if(!s||s.status!=='HALTED_REVIEW_REQUIRED'||s.lease||qboPg274Triggers_().length)throw Error('V1276_NOT_QUIESCENT_HALTED');
 if(!j||j.phase!=='STAGING'||!Number.isSafeInteger(j.cursor)||!Number.isSafeInteger(j.chunk)||!Number.isSafeInteger(j.files)||!Number.isSafeInteger(j.rows)||j.files<1||j.files>QBO_PG276_.MAX_FILES||j.rows<1)throw Error('V1276_BAD_STAGING_JOURNAL');
 if(!Array.isArray(s.bucketFolders)||s.bucketFolders.length!==16||!s.iteratorToken||!s.indexFolderId||!s.auditFolderId)throw Error('V1276_MISSING_AUTHORITY');
 if(j.cursor<0||j.chunk<0||j.cursor+j.files>QBO_PG274_.N)throw Error('V1276_BAD_JOURNAL_BOUNDS');
 const a=qboPg274Gate_();if(a.indexFolderId!==s.indexFolderId)throw Error('V1276_INDEX_AUTHORITY_CHANGED');
 const before=s.fileCursor===j.cursor&&s.chunk===j.chunk;
 const after=s.fileCursor===j.cursor+j.files&&s.chunk===j.chunk+1;
 if(!before&&!after)throw Error('V1276_CHECKPOINT_JOURNAL_DIVERGED');
 if(!Number.isSafeInteger(s.rows)||s.rows<0||s.rows>QBO_PG274_.ROWS)throw Error('V1276_BAD_ROW_CHECKPOINT');
 if(after){
  if(s.rows<j.rows||s.rows-j.rows<0||s.recoveryVersion!==QBO_PG276_.V||!s.recoveryJournal||JSON.stringify(s.recoveryJournal)!==JSON.stringify(j)||!Array.isArray(s.recoverySourceFileIds)||s.recoverySourceFileIds.length!==j.files||!s.recoveryIteratorTokenBefore)throw Error('V1276_POST_COMMIT_NOT_OWNED');
 }
 return {p,s,j,raw,phase:before?'PRECOMMIT':'POSTCOMMIT'};
}
function qboPg276Reconstruct_(c){
 const token=c.phase==='PRECOMMIT'?c.s.iteratorToken:c.s.recoveryIteratorTokenBefore;
 const it=DriveApp.continueFileIterator(token),rows=Array.from({length:16},()=>[]),ids=[];
 for(let i=0;i<c.j.files;i++){
  if(!it.hasNext())throw Error('V1276_INDEX_ITERATOR_EXHAUSTED');
  const f=it.next(),x=JSON.parse(f.getBlob().getDataAsString());
  if(x.version!=='1.5.271'||!Array.isArray(x.entries)||x.rows!==x.entries.length||qboPg271Hash_(JSON.stringify(x.entries))!==x.payloadHash)throw Error('V1276_INDEX_INVALID '+f.getId());
  for(const e of x.entries){if(!Array.isArray(e)||typeof e[0]!=='string'||!e[0])throw Error('V1276_INDEX_ENTRY_INVALID '+f.getId());rows[qboPg274Bucket_(e[0])].push([e[0],f.getId(),e[2]]);}
  ids.push(f.getId());
 }
 if(rows.reduce((a,b)=>a+b.length,0)!==c.j.rows)throw Error('V1276_RECONSTRUCTED_ROWS_MISMATCH');
 const nextToken=it.getContinuationToken();
 if(c.phase==='POSTCOMMIT'&&(JSON.stringify(ids)!==JSON.stringify(c.s.recoverySourceFileIds)||nextToken!==c.s.iteratorToken))throw Error('V1276_POSTCOMMIT_ITERATOR_MISMATCH');
 return {rows,ids,nextToken,hasNext:it.hasNext()};
}
function qboPg276Artifacts_(c,r){
 const out=[];
 for(let b=0;b<16;b++){
  const dir=qboPg274Folder_(c.s,b),name='chunk_'+('000000'+c.j.chunk).slice(-6)+'.json';
  const expected={version:QBO_PG274_.V,bucket:b,chunk:c.j.chunk,rows:r.rows[b].length,hash:qboPg274Hash_(r.rows[b]),entries:r.rows[b]};
  const f=qboPg274File_(dir,name);
  if(f){qboPg274Check_(f,expected);const actual=JSON.parse(f.getBlob().getDataAsString());if(JSON.stringify(actual.entries)!==JSON.stringify(expected.entries))throw Error('V1276_EXACT_PAYLOAD_MISMATCH '+b);}
  out.push({bucket:b,dir,name,expected,exists:!!f});
 }
 return out;
}
function qboPg276CheckState_(c){const now=qboPg274S_();if(c.p.getProperty(QBO_PG274_.KEY+'_JOURNAL')!==c.raw||now.status!=='HALTED_REVIEW_REQUIRED'||now.lease||qboPg274Triggers_().length||now.fileCursor!==c.s.fileCursor||now.rows!==c.s.rows||now.chunk!==c.s.chunk||now.iteratorToken!==c.s.iteratorToken)throw Error('V1276_CONCURRENT_CHANGE');return now;}
/** No writes; source-derived comparison, including exact entries for existing artifacts. */
function previewQboPhaseGJournalRecoveryV1276(){return qboPg276Lock_(()=>{
 const c=qboPg276Context_(),r=qboPg276Reconstruct_(c),a=qboPg276Artifacts_(c,r);
 const out={version:QBO_PG276_.V,status:'PREVIEW_SOURCE_MATCHED',phase:c.phase,committedCursor:c.s.fileCursor,committedRows:c.s.rows,committedChunk:c.s.chunk,journal:c.j,sourceFileIds:r.ids,sourceRows:r.rows.reduce((n,x)=>n+x.length,0),verifiedExisting:a.filter(x=>x.exists).length,missingBuckets:a.filter(x=>!x.exists).map(x=>x.bucket),expectedRowsByBucket:a.map(x=>x.expected.rows),expectedAfter:{cursor:c.j.cursor+c.j.files,rows:(c.phase==='PRECOMMIT'?c.s.rows:c.s.rows-c.j.rows)+c.j.rows,chunk:c.j.chunk+1},mutationPerformed:false};
 console.log('[PHASE G UNIQUE V1276] | PREVIEW | '+JSON.stringify(out));return out;
});}
/** Controlled, idempotent staging recovery. No automatic execution. */
function recoverQboPhaseGJournalV1276(){return qboPg276Lock_(()=>{
 let c=qboPg276Context_(),r=qboPg276Reconstruct_(c),a=qboPg276Artifacts_(c,r);
 if(c.phase==='PRECOMMIT'){
  for(const x of a)if(!x.exists){const f=x.dir.createFile(x.name,JSON.stringify(x.expected),MimeType.PLAIN_TEXT);qboPg274Check_(f,x.expected);}
  // Verify every bucket again, including full exact source payload equality.
  a=qboPg276Artifacts_(c,r);if(a.some(x=>!x.exists))throw Error('V1276_MISSING_AFTER_WRITE');
  const fresh=qboPg276CheckState_(c);
  fresh.fileCursor+=c.j.files;fresh.rows+=c.j.rows;fresh.chunk++;fresh.iteratorToken=r.nextToken;
  fresh.recoveryIteratorTokenBefore=c.s.iteratorToken;fresh.recoveryVersion=QBO_PG276_.V;fresh.recoveryJournal=c.j;fresh.recoverySourceFileIds=r.ids;fresh.recoveredAt=new Date().toISOString();fresh.updatedAt=fresh.recoveredAt;fresh.lastError='';
  // Commit checkpoint first. Journal intentionally remains for safe postcommit retry.
  qboPg274Save_(fresh);
  const check=qboPg274S_();if(check.fileCursor!==fresh.fileCursor||check.rows!==fresh.rows||check.chunk!==fresh.chunk||check.iteratorToken!==fresh.iteratorToken||check.recoveryVersion!==QBO_PG276_.V)throw Error('V1276_CHECKPOINT_READBACK');
  c=qboPg276Context_();if(c.phase!=='POSTCOMMIT')throw Error('V1276_POSTCOMMIT_GATE');
  r=qboPg276Reconstruct_(c);a=qboPg276Artifacts_(c,r);if(a.some(x=>!x.exists))throw Error('V1276_POSTCOMMIT_ARTIFACT_MISSING');
 }else if(a.some(x=>!x.exists))throw Error('V1276_POSTCOMMIT_ARTIFACT_MISSING');
 qboPg276CheckState_(c);
 c.p.deleteProperty(QBO_PG274_.KEY+'_JOURNAL');
 if(c.p.getProperty(QBO_PG274_.KEY+'_JOURNAL'))throw Error('V1276_JOURNAL_DELETE_FAILED');
 // Keep HALTED until trigger exists; if interrupted after deletion, use rearm helper.
 ScriptApp.newTrigger(QBO_PG274_.HANDLER).timeBased().everyMinutes(5).create();
 const ts=qboPg274Triggers_();if(ts.length!==1)throw Error('V1276_TRIGGER_COUNT_UNEXPECTED '+ts.length);
 const ready=qboPg274S_();if(ready.status!=='HALTED_REVIEW_REQUIRED'||ready.lease||ready.fileCursor!==c.s.fileCursor||ready.rows!==c.s.rows||ready.chunk!==c.s.chunk)throw Error('V1276_READY_STATE_CHANGED');
 ready.status=(ready.fileCursor===QBO_PG274_.N?'CHECKING':'STAGING');ready.updatedAt=new Date().toISOString();qboPg274Save_(ready);
 const out={status:ready.status,cursor:ready.fileCursor,rows:ready.rows,chunk:ready.chunk,recoveryVersion:QBO_PG276_.V,journalRemoved:!c.p.getProperty(QBO_PG274_.KEY+'_JOURNAL'),triggerCount:qboPg274Triggers_().length};
 console.log('[PHASE G UNIQUE V1276] | RESUMED | '+JSON.stringify(out));return out;
});}
/** Read-only diagnosis of a post-commit interruption with no journal. */
function inspectQboPhaseGRecoveryRearmV1276(){const s=qboPg274S_(),p=qboPg274P_(),o={status:s?.status,cursor:s?.fileCursor,rows:s?.rows,chunk:s?.chunk,recoveryVersion:s?.recoveryVersion,journalPresent:!!p.getProperty(QBO_PG274_.KEY+'_JOURNAL'),leasePresent:!!s?.lease,triggerCount:qboPg274Triggers_().length};console.log('[PHASE G UNIQUE V1276] | REARM_INSPECT | '+JSON.stringify(o));return o;}
/** Re-arm only after journal is cleared and a V1276 checkpoint is already committed.
 * Handles crash between journal deletion, trigger creation and status transition.
 */
function rearmQboPhaseGAfterRecoveryV1276(){return qboPg276Lock_(()=>{
 const s=qboPg274S_(),p=qboPg274P_();if(!s||s.status!=='HALTED_REVIEW_REQUIRED'||s.lease||p.getProperty(QBO_PG274_.KEY+'_JOURNAL')||s.recoveryVersion!==QBO_PG276_.V||!s.recoveryJournal||s.fileCursor!==s.recoveryJournal.cursor+s.recoveryJournal.files||s.chunk!==s.recoveryJournal.chunk+1||s.rows<s.recoveryJournal.rows)throw Error('V1276_REARM_GATE');
 if(qboPg274Triggers_().length>1)throw Error('V1276_MULTIPLE_TRIGGERS');
 if(qboPg274Triggers_().length===0)ScriptApp.newTrigger(QBO_PG274_.HANDLER).timeBased().everyMinutes(5).create();
 if(qboPg274Triggers_().length!==1)throw Error('V1276_REARM_TRIGGER_FAILED');
 s.status=s.fileCursor===QBO_PG274_.N?'CHECKING':'STAGING';s.updatedAt=new Date().toISOString();qboPg274Save_(s);
 const out={status:s.status,cursor:s.fileCursor,rows:s.rows,chunk:s.chunk,triggerCount:qboPg274Triggers_().length};console.log('[PHASE G UNIQUE V1276] | REARMED | '+JSON.stringify(out));return out;
});}
