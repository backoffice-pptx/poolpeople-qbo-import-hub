/** V1300 source bridge — read-only, development only.
 * Builds a deterministic chunk from the CURRENT V1274 iterator checkpoint.
 * No checkpoint writes, trigger changes, artifact publication or recovery.
 * Requires 4222 V1274 and 4219 V1271 hash functions in the same project.
 */
const QBO_PG300_BRIDGE_=Object.freeze({V:'1.5.300',PER:10,BUCKETS:16});
function qboPg300BuildSourceFromV1274_(state){
 if(!state||state.status!=='STAGING'||!state.indexFolderId||!state.iteratorToken||!Array.isArray(state.bucketFolders)||state.bucketFolders.length!==16)throw Error('V1300_SOURCE_STATE_INVALID');
 const it=DriveApp.continueFileIterator(state.iteratorToken);
 const entries=Array.from({length:16},()=>[]),files=[];
 for(let n=0;n<QBO_PG300_BRIDGE_.PER&&it.hasNext();n++){
  const file=it.next(),raw=file.getBlob().getDataAsString(),index=JSON.parse(raw);
  if(index.version!=='1.5.271'||!Array.isArray(index.entries)||index.rows!==index.entries.length||qboPg271Hash_(JSON.stringify(index.entries))!==index.payloadHash)throw Error('V1300_INDEX_INVALID '+file.getId());
  files.push({id:file.getId(),payloadHash:index.payloadHash,rows:index.rows});
  for(const entry of index.entries){
   if(!Array.isArray(entry)||typeof entry[0]!=='string'||!entry[0])throw Error('V1300_BAD_SOURCE_ENTRY '+file.getId());
   entries[qboPg274Bucket_(entry[0])].push([entry[0],file.getId(),entry[2]]);
  }
 }
 if(!files.length)throw Error('V1300_EMPTY_SOURCE_CHUNK');
 const payloads=entries.map((e,b)=>({version:QBO_PG274_.V,bucket:b,chunk:state.chunk,rows:e.length,hash:qboPg274Hash_(e),entries:e}));
 const hashes=payloads.map(p=>p.hash),rows=payloads.reduce((a,p)=>a+p.rows,0);
 const source={cursor:state.fileCursor,chunk:state.chunk,files:files.length,rows,sourceFileEvidence:files,hashes,payloads,
  digest:qboPg271Hash_(JSON.stringify({cursor:state.fileCursor,chunk:state.chunk,files,hashes})),
  nextIteratorToken:it.getContinuationToken()};
 return source;
}
/** Read-only cross-check: source evidence vs existing V1274 journal.
 * Deliberately does not accept a different journal shape or mutate it.
 */
function qboPg300ValidateJournalShape_(source,journal){
 if(!journal||journal.phase!=='STAGING'||journal.cursor!==source.cursor||journal.chunk!==source.chunk||journal.files!==source.files||journal.rows!==source.rows)throw Error('V1300_JOURNAL_SOURCE_MISMATCH');
 return true;
}
/** Verify exact bytes of each final artifact, not only its metadata/hash.
 * No Drive writes. Throws on duplicate or missing final names.
 */
function qboPg300VerifyFinalChunkReadOnly_(state,source){
 if(!state||!source||source.chunk!==state.chunk||source.cursor!==state.fileCursor)throw Error('V1300_SOURCE_CHECKPOINT_MISMATCH');
 const results=[];
 for(let b=0;b<16;b++){
  const folder=qboPg274Folder_(state,b),name='chunk_'+('000000'+source.chunk).slice(-6)+'.json';
  const files=folder.getFilesByName(name);
  if(!files.hasNext())throw Error('V1300_FINAL_MISSING '+b);
  const f=files.next();if(files.hasNext())throw Error('V1300_FINAL_DUPLICATE '+b);
  const expected=source.payloads[b],actual=JSON.parse(f.getBlob().getDataAsString());
  qboPg274Check_(f,expected);
  if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('V1300_FINAL_EXACT_MISMATCH '+b);
  results.push({bucket:b,id:f.getId(),rows:expected.rows,hash:expected.hash});
 }
 return {status:'EXACT_SOURCE_ARTIFACT_MATCH',chunk:source.chunk,sourceFiles:source.files,rows:source.rows,artifacts:results};
}
