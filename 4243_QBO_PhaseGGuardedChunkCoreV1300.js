/** V1300 guarded chunk core. DEVELOPMENT ONLY. Not connected to production.
 * Dependency-injected persistence; no production entrypoint, triggers or writes.
 * Adapter contract: readState(), readJournal(), writeJournal(j),
 * readLedger(chunk), writeLedger(chunk,ledger), listFinal(bucket,chunk),
 * listStage(bucket,chunk), createStage(bucket,chunk,payload),
 * verifyFile(file,payload), publishStage(file,bucket,chunk),
 * writeState(state), clearJournal(), withLock(fn), now().
 * All adapter mutations must fence epoch under the SAME project ScriptLock.
 * Publication holds that lock through Drive rename/readback; measure and bound runtime.
 */
const QBO_PG300_=Object.freeze({VERSION:'1.5.300',BUCKETS:16});
function qboPg300Require_(ok,code){if(!ok)throw Error('V1300_'+code);}
function qboPg300Clone_(x){return JSON.parse(JSON.stringify(x));}
function qboPg300Claim_(io,expectedCursor,owner){return io.withLock(function(){
 const s=io.readState();qboPg300Require_(s&&s.fileCursor===expectedCursor,'CURSOR_CHANGED');
 qboPg300Require_(s.status==='STAGING','NOT_STAGING');
 qboPg300Require_(!s.lease||io.now()-Date.parse(s.lease.at)>240000,'ACTIVE_LEASE');
 const next=qboPg300Clone_(s);next.ownerEpoch=(s.ownerEpoch||0)+1;
 next.lease={token:owner,at:new Date(io.now()).toISOString(),epoch:next.ownerEpoch};
 io.writeState(next);return {epoch:next.ownerEpoch,cursor:next.fileCursor,chunk:next.chunk};
});}
function qboPg300Fence_(io,claim,owner){const s=io.readState();
 qboPg300Require_(s&&s.ownerEpoch===claim.epoch&&s.lease&&s.lease.token===owner&&s.lease.epoch===claim.epoch,'STALE_OWNER');
 qboPg300Require_(s.fileCursor===claim.cursor&&s.chunk===claim.chunk,'CHECKPOINT_CHANGED');return s;}
function qboPg300Intent_(io,claim,owner,source){return io.withLock(function(){
 qboPg300Fence_(io,claim,owner);
 qboPg300Require_(source&&source.chunk===claim.chunk&&source.cursor===claim.cursor&&source.payloads.length===16,'BAD_SOURCE');
 const existing=io.readJournal();
 const j={phase:'STAGING',cursor:source.cursor,chunk:source.chunk,files:source.files,rows:source.rows};
 if(existing)qboPg300Require_(JSON.stringify(existing)===JSON.stringify(j),'JOURNAL_CONFLICT');
 else io.writeJournal(j);
 let ledger=io.readLedger(source.chunk);
 if(!ledger){ledger={version:QBO_PG300_.VERSION,chunk:source.chunk,cursor:source.cursor,sourceDigest:source.digest,entries:Array.from({length:16},(_,b)=>({bucket:b,phase:'INTENT',hash:source.hashes[b],stageId:null,finalId:null}))};io.writeLedger(source.chunk,ledger);}
 qboPg300Require_(ledger.sourceDigest===source.digest&&ledger.entries.length===16,'LEDGER_SOURCE_CONFLICT');
 return qboPg300Clone_(ledger);
});}
function qboPg300PublishBucket_(io,claim,owner,source,b){
 qboPg300Require_(Number.isInteger(b)&&b>=0&&b<16,'BAD_BUCKET');
 // Lock only guards registry/fencing transitions. External Drive calls run outside lock;
 // each externally visible mutation requires another fence before and after.
 const snapshot=io.withLock(function(){qboPg300Fence_(io,claim,owner);const j=io.readJournal();
 qboPg300Require_(j&&j.phase==='STAGING'&&j.chunk===source.chunk&&j.cursor===source.cursor,'JOURNAL_CHANGED');
 const l=io.readLedger(source.chunk);qboPg300Require_(l&&l.sourceDigest===source.digest&&l.entries[b].hash===source.hashes[b],'LEDGER_CHANGED');return qboPg300Clone_(l.entries[b]);});
 const finals=io.listFinal(b,source.chunk),stages=io.listStage(b,source.chunk);
 qboPg300Require_(finals.length<=1&&stages.length<=1,'DUPLICATE_ARTIFACT');
 qboPg300Require_(!(finals.length&&stages.length),'FINAL_AND_STAGE');
 if(finals.length){io.verifyFile(finals[0],source.payloads[b]);
  io.withLock(function(){qboPg300Fence_(io,claim,owner);const l=io.readLedger(source.chunk);
   qboPg300Require_(!l.entries[b].finalId||l.entries[b].finalId===finals[0].id,'FINAL_ID_CONFLICT');
   l.entries[b]={bucket:b,phase:'PUBLISHED',hash:source.hashes[b],stageId:l.entries[b].stageId,finalId:finals[0].id};io.writeLedger(source.chunk,l);});
  return {bucket:b,reused:true};}
 // An unregistered stage is deliberately quarantined by HALT, never silently adopted.
 if(stages.length)qboPg300Require_(snapshot.stageId===stages[0].id,'ORPHAN_STAGE_REVIEW_REQUIRED');
 else qboPg300Require_(!snapshot.stageId,'REGISTERED_STAGE_MISSING');
 // Fail closed on unregistered create; no automatic deletion.
 let stage=stages[0];if(!stage){io.withLock(()=>qboPg300Fence_(io,claim,owner));stage=io.createStage(b,source.chunk,source.payloads[b]);
  io.withLock(function(){qboPg300Fence_(io,claim,owner);const l=io.readLedger(source.chunk);
   qboPg300Require_(l.entries[b].phase==='INTENT','STAGE_RACE');l.entries[b].phase='STAGED';l.entries[b].stageId=stage.id;io.writeLedger(source.chunk,l);});}
 io.verifyFile(stage,source.payloads[b]);
 io.withLock(function(){qboPg300Fence_(io,claim,owner);const l=io.readLedger(source.chunk);
  qboPg300Require_(l.entries[b].stageId===stage.id,'STAGE_ID_CHANGED');l.entries[b].phase='VERIFIED';io.writeLedger(source.chunk,l);});
 // CRITICAL: ownership takeover and the final-name Drive mutation share one
 // exclusive ScriptLock. The adapter MUST use the same lock for all claims,
 // takeovers and final-name mutations in this Apps Script project.
 io.withLock(function(){
  qboPg300Fence_(io,claim,owner);
  const before=io.listFinal(b,source.chunk);
  qboPg300Require_(before.length===0,'FINAL_RACE');
  const l=io.readLedger(source.chunk);
  qboPg300Require_(l&&l.entries[b].stageId===stage.id&&l.entries[b].phase==='VERIFIED','STAGE_FENCE_CHANGED');
  // A hard termination after publishStage leaves a final artifact and a
  // VERIFIED ledger; next invocation must reconcile, never blindly create.
  io.publishStage(stage,b,source.chunk);
  io.verifyFile(stage,source.payloads[b]);
  const after=io.listFinal(b,source.chunk);
  qboPg300Require_(after.length===1&&after[0].id===stage.id,'FINAL_COUNT');
  l.entries[b].phase='PUBLISHED';l.entries[b].finalId=stage.id;
  io.writeLedger(source.chunk,l);
 });
 return {bucket:b,reused:false};
}
function qboPg300Commit_(io,claim,owner,source,next){return io.withLock(function(){
 const s=qboPg300Fence_(io,claim,owner),j=io.readJournal(),l=io.readLedger(source.chunk);
 qboPg300Require_(j&&j.phase==='STAGING'&&j.cursor===source.cursor&&j.chunk===source.chunk,'JOURNAL_MISMATCH');
 qboPg300Require_(l&&l.entries.length===16&&l.entries.every(e=>e.phase==='PUBLISHED'&&e.finalId),'NOT_FULLY_PUBLISHED');
 for(let b=0;b<16;b++){const fs=io.listFinal(b,source.chunk);qboPg300Require_(fs.length===1&&fs[0].id===l.entries[b].finalId,'FINAL_CHANGED');io.verifyFile(fs[0],source.payloads[b]);}
 qboPg300Require_(next.fileCursor===s.fileCursor+source.files&&next.rows===s.rows+source.rows&&next.chunk===s.chunk+1,'BAD_NEXT_STATE');
 qboPg300Require_(next.ownerEpoch===claim.epoch,'EPOCH_MISMATCH');
 io.writeState(next); // journal deliberately retained until separate finalization
 return {status:'CHECKPOINT_COMMITTED_JOURNAL_PENDING',cursor:next.fileCursor};
});}
function qboPg300Finalize_(io,source){return io.withLock(function(){const s=io.readState(),j=io.readJournal();
 qboPg300Require_(j&&j.chunk===source.chunk&&j.cursor===source.cursor,'JOURNAL_MISSING');
 qboPg300Require_(s.fileCursor===source.cursor+source.files&&s.chunk===source.chunk+1,'CHECKPOINT_NOT_COMMITTED');
 const l=io.readLedger(source.chunk);qboPg300Require_(l&&l.entries.every(e=>e.phase==='PUBLISHED'),'LEDGER_INCOMPLETE');
 io.clearJournal();return {status:'JOURNAL_FINALIZED_NO_RESTART'};
});}
