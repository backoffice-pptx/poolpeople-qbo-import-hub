/** V1.5.275 controlled recovery for V1274 staging journal at cursor 38 / chunk 5.
 * Preserve journal until all 16 source-derived artifacts and checkpoint are verified.
 * No writes to immutable source, V1271 index, Phase G, or daily exports.
 */
const QBO_PG275_=Object.freeze({V:'1.5.275',CURSOR:38,ROWS:76000,CHUNK:5,FILES:2,PENDING_ROWS:4000});
function qboPg275Assert_(){
 const s=qboPg274S_(),p=qboPg274P_(),raw=p.getProperty(QBO_PG274_.KEY+'_JOURNAL'),j=raw?JSON.parse(raw):null,c=QBO_PG275_;
 if(!s||s.status!=='HALTED_REVIEW_REQUIRED'||s.fileCursor!==c.CURSOR||s.rows!==c.ROWS||s.chunk!==c.CHUNK||!j||j.phase!=='STAGING'||j.cursor!==c.CURSOR||j.chunk!==c.CHUNK||j.files!==c.FILES||j.rows!==c.PENDING_ROWS)throw Error('V1275_UNEXPECTED_STATE_OR_JOURNAL');
 if(s.lease||qboPg274Triggers_().length)throw Error('V1275_WORKER_OR_TRIGGER_ACTIVE');
 if(!Array.isArray(s.bucketFolders)||s.bucketFolders.length!==16||!s.iteratorToken)throw Error('V1275_BAD_DESTINATION_OR_ITERATOR');
 const a=qboPg274Gate_();if(a.indexFolderId!==s.indexFolderId)throw Error('V1275_SOURCE_INDEX_CHANGED');
 return {s,j,raw};
}
function qboPg275Reconstruct_(s,j){
 const it=DriveApp.continueFileIterator(s.iteratorToken),rows=Array.from({length:16},()=>[]),ids=[];
 for(let i=0;i<j.files;i++){
  if(!it.hasNext())throw Error('V1275_SOURCE_ITERATOR_EXHAUSTED');
  const f=it.next(),x=JSON.parse(f.getBlob().getDataAsString());
  if(x.version!=='1.5.271'||!Array.isArray(x.entries)||x.rows!==x.entries.length||qboPg271Hash_(JSON.stringify(x.entries))!==x.payloadHash)throw Error('V1275_INDEX_FILE_INVALID '+f.getId());
  for(const e of x.entries){if(!Array.isArray(e)||typeof e[0]!=='string'||!e[0])throw Error('V1275_BAD_ID');rows[qboPg274Bucket_(e[0])].push([e[0],f.getId(),e[2]]);}
  ids.push(f.getId());
 }
 if(rows.reduce((n,r)=>n+r.length,0)!==j.rows)throw Error('V1275_SOURCE_ROW_MISMATCH');
 return {it,rows,ids};
}
function qboPg275Expected_(s,rows){
 const result=[];
 for(let b=0;b<16;b++){
  const name='chunk_'+('000000'+s.chunk).slice(-6)+'.json',dir=qboPg274Folder_(s,b),expected={version:QBO_PG274_.V,bucket:b,chunk:s.chunk,rows:rows[b].length,hash:qboPg274Hash_(rows[b]),entries:rows[b]},f=qboPg274File_(dir,name);
  if(f)qboPg274Check_(f,expected);
  result.push({b,name,dir,expected,exists:!!f});
 }
 return result;
}
/** Read-only, general purpose journal inspection. */
function inspectQboPhaseGGlobalIdentityJournalV1274(){
 const p=qboPg274P_(),s=qboPg274S_(),raw=p.getProperty(QBO_PG274_.KEY+'_JOURNAL'),j=raw?JSON.parse(raw):null;
 const out={status:s?.status,committedCursor:s?.fileCursor,committedRows:s?.rows,committedChunk:s?.chunk,journal:j,cursorDifference:s&&j&&typeof j.cursor==='number'?s.fileCursor-j.cursor:null,chunkDifference:s&&j&&typeof j.chunk==='number'?s.chunk-j.chunk:null,iteratorPresent:!!s?.iteratorToken,leasePresent:!!s?.lease,bucketFolderCount:s?.bucketFolders?.length,triggerCount:qboPg274Triggers_().length};
 console.log('[PHASE G UNIQUE V1274] | JOURNAL_DIAGNOSTIC | '+JSON.stringify(out));return out;
}
/** Read-only, generalized pending STAGING chunk artifact inspector. */
function inspectQboPhaseGPendingChunkV1275(){
 const p=qboPg274P_(),s=qboPg274S_(),raw=p.getProperty(QBO_PG274_.KEY+'_JOURNAL'),j=raw?JSON.parse(raw):null;
 if(!s||!j||j.phase!=='STAGING'||!Number.isInteger(j.chunk)||!Array.isArray(s.bucketFolders)||s.bucketFolders.length!==16)throw Error('V1275_NO_STAGING_JOURNAL');
 const out={status:s.status,committedCursor:s.fileCursor,committedRows:s.rows,pendingChunk:j.chunk,journalRows:j.rows,buckets:[],artifactRows:0,verified:0,missing:0,invalid:0};
 for(let b=0;b<16;b++){
  const name='chunk_'+('000000'+j.chunk).slice(-6)+'.json',dir=qboPg274Folder_(s,b);let f;
  try{f=qboPg274File_(dir,name);}catch(e){out.invalid++;out.buckets.push({bucket:b,status:'DUPLICATE_OR_READ_ERROR',error:String(e)});continue;}
  if(!f){out.missing++;out.buckets.push({bucket:b,status:'MISSING'});continue;}
  try{const x=JSON.parse(f.getBlob().getDataAsString()),ok=x.version===QBO_PG274_.V&&x.bucket===b&&x.chunk===j.chunk&&Array.isArray(x.entries)&&x.rows===x.entries.length&&qboPg274Hash_(x.entries)===x.hash&&x.entries.every(e=>Array.isArray(e)&&e.length===3&&typeof e[0]==='string'&&!!e[0]&&qboPg274Bucket_(e[0])===b);if(!ok)throw Error('STRUCTURE_HASH_OR_BUCKET');out.verified++;out.artifactRows+=x.rows;out.buckets.push({bucket:b,status:'VERIFIED',rows:x.rows});}catch(e){out.invalid++;out.buckets.push({bucket:b,status:'INVALID',error:String(e)});}
 }
 out.allPresentAndCountMatched=out.verified===16&&out.invalid===0&&out.artifactRows===j.rows;
 console.log('[PHASE G UNIQUE V1275] | PENDING_CHUNK | '+JSON.stringify(out));return out;
}
/** Preview reconstructs source and compares every existing artifact; no mutation. */
function previewQboPhaseGChunkRecoveryV1275(){
 const {s,j}=qboPg275Assert_(),r=qboPg275Reconstruct_(s,j),art=qboPg275Expected_(s,r.rows);
 const out={status:'PREVIEW_SOURCE_MATCHED',cursor:s.fileCursor,chunk:s.chunk,sourceFiles:r.ids,sourceRows:j.rows,verifiedExisting:art.filter(x=>x.exists).length,missingBuckets:art.filter(x=>!x.exists).map(x=>x.b),expectedRowsByBucket:art.map(x=>x.expected.rows),mutationPerformed:false};
 console.log('[PHASE G UNIQUE V1275] | PREVIEW | '+JSON.stringify(out));return out;
}
/** One-time, exact-incident controlled recovery. Run PREVIEW first. */
function recoverQboPhaseGChunkV1275(){
 const {s,j,raw}=qboPg275Assert_(),r=qboPg275Reconstruct_(s,j),art=qboPg275Expected_(s,r.rows);
 // Validate existing artifacts before writing anything; no journal deletion before checkpoint.
 for(const x of art){if(!x.exists){const f=x.dir.createFile(x.name,JSON.stringify(x.expected),MimeType.PLAIN_TEXT);qboPg274Check_(f,x.expected);}}
 for(const x of art){const f=qboPg274File_(x.dir,x.name);if(!f)throw Error('V1275_MISSING_AFTER_WRITE '+x.b);qboPg274Check_(f,x.expected);}
 const p=qboPg274P_(),fresh=qboPg274S_();
 if(p.getProperty(QBO_PG274_.KEY+'_JOURNAL')!==raw||fresh.status!=='HALTED_REVIEW_REQUIRED'||fresh.fileCursor!==s.fileCursor||fresh.rows!==s.rows||fresh.chunk!==s.chunk||fresh.lease||qboPg274Triggers_().length)throw Error('V1275_CONCURRENT_STATE_CHANGE');
 fresh.fileCursor+=j.files;fresh.rows+=j.rows;fresh.chunk++;fresh.iteratorToken=r.it.getContinuationToken();fresh.updatedAt=new Date().toISOString();fresh.recoveredAt=fresh.updatedAt;fresh.recoveryVersion=QBO_PG275_.V;fresh.recoveryJournal=j;fresh.recoverySourceFileIds=r.ids;fresh.lastError='';
 // First persist committed checkpoint. If interrupted here, journal remains and requires review.
 qboPg274Save_(fresh);
 const saved=qboPg274S_();if(saved.fileCursor!==40||saved.rows!==80000||saved.chunk!==6||saved.iteratorToken!==fresh.iteratorToken)throw Error('V1275_CHECKPOINT_READBACK');
 p.deleteProperty(QBO_PG274_.KEY+'_JOURNAL');
 // If trigger creation fails, state stays halted; safe manual rearm can be considered separately.
 const ready=qboPg274S_();if(ready.status!=='HALTED_REVIEW_REQUIRED'||p.getProperty(QBO_PG274_.KEY+'_JOURNAL'))throw Error('V1275_POST_COMMIT_GATE');
 ScriptApp.newTrigger(QBO_PG274_.HANDLER).timeBased().everyMinutes(5).create();
 ready.status='STAGING';ready.updatedAt=new Date().toISOString();qboPg274Save_(ready);
 const out={status:ready.status,cursor:ready.fileCursor,rows:ready.rows,chunk:ready.chunk,recoveryVersion:QBO_PG275_.V,triggerCount:qboPg274Triggers_().length,journalRemoved:!p.getProperty(QBO_PG274_.KEY+'_JOURNAL')};
 console.log('[PHASE G UNIQUE V1275] | RESUMED | '+JSON.stringify(out));return out;
}
