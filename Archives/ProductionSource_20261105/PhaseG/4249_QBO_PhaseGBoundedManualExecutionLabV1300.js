/** V1300 manual bounded integrated lab; isolated synthetic data only. No triggers. */
const QBO_PG300_BOUNDED_KEY_='QBO_PG300_LAB_BOUNDED_CONFIG';
function setupQboPg300BoundedLab(){
 const p=PropertiesService.getScriptProperties();
 if(p.getProperty(QBO_PG300_BOUNDED_KEY_))throw Error('BOUNDED_LAB_ALREADY_EXISTS');
 const root=DriveApp.createFolder('QBO_PG300_BOUNDED_LAB_'+Utilities.getUuid());
 const ledger=root.createFolder('ledger'),stage=root.createFolder('stage');
 const bucketFolderIds=Array.from({length:16},(_,b)=>root.createFolder('bucket_'+('0'+b).slice(-2)).getId());
 const suffix=Utilities.getUuid().replace(/-/g,'');
 const cfg={isolated:true,rootId:root.getId(),ledgerFolderId:ledger.getId(),stageFolderId:stage.getId(),bucketFolderIds,
 stateKey:'QBO_PG300_LAB_BOUNDED_STATE_'+suffix,journalKey:'QBO_PG300_LAB_BOUNDED_JOURNAL_'+suffix,ledgerPointerPrefix:'QBO_PG300_LAB_BOUNDED_LEDGER_'+suffix,owner:'BOUNDED_'+suffix,claim:null};
 p.setProperty(QBO_PG300_BOUNDED_KEY_,JSON.stringify(cfg));
 qboPg300BoundedIo_().writeState({status:'STAGING',fileCursor:0,rows:0,chunk:1,ownerEpoch:0,lease:null});
 console.log('[PHASE G V1300] | BOUNDED_SETUP | '+JSON.stringify({status:'READY',isolated:true,rootId:cfg.rootId}));
}
function qboPg300BoundedCfg_(){const raw=PropertiesService.getScriptProperties().getProperty(QBO_PG300_BOUNDED_KEY_);if(!raw)throw Error('BOUNDED_LAB_NOT_SETUP');const cfg=JSON.parse(raw);if(!cfg.isolated||!cfg.stateKey.startsWith('QBO_PG300_LAB_'))throw Error('BOUNDED_ISOLATION');return cfg;}
function qboPg300BoundedIo_(){const cfg=qboPg300BoundedCfg_();return qboPg300AdapterCreateIsolated_(Object.assign({},cfg,{properties:PropertiesService.getScriptProperties(),lock:LockService.getScriptLock()}));}
function qboPg300BoundedSource_(){const payloads=Array.from({length:16},(_,b)=>({version:'1.5.274',bucket:b,chunk:1,rows:1,hash:'BOUNDED_HASH_'+b,entries:[['BOUNDED_'+b,'SYNTHETIC','synthetic']]}));return {cursor:0,chunk:1,files:1,rows:16,digest:'BOUNDED_SYNTHETIC_DIGEST',payloads,hashes:payloads.map(p=>p.hash)};}
function qboPg300BoundedSaveClaim_(claim){const p=PropertiesService.getScriptProperties(),cfg=qboPg300BoundedCfg_();if(cfg.claim)throw Error('BOUNDED_CLAIM_ALREADY_SAVED');cfg.claim=claim;p.setProperty(QBO_PG300_BOUNDED_KEY_,JSON.stringify(cfg));}
function startQboPg300BoundedLab(){
 const cfg=qboPg300BoundedCfg_();if(cfg.claim)throw Error('BOUNDED_ALREADY_STARTED');const io=qboPg300BoundedIo_(),src=qboPg300BoundedSource_();
 const claim=qboPg300Claim_(io,0,cfg.owner);qboPg300BoundedSaveClaim_(claim);
 qboPg300Intent_(io,claim,cfg.owner,src);
 console.log('[PHASE G V1300] | BOUNDED_START | '+JSON.stringify({status:'INTENT_DURABLE',epoch:claim.epoch,chunk:claim.chunk,isolated:true}));
}
function runNextQboPg300BoundedBucket(){
 const cfg=qboPg300BoundedCfg_();if(!cfg.claim)throw Error('BOUNDED_NOT_STARTED');
 const io=qboPg300BoundedIo_(),src=qboPg300BoundedSource_(),s=io.readState();
 if(s.fileCursor!==0||s.chunk!==1)throw Error('BOUNDED_ALREADY_COMMITTED');
 const l=io.readLedger(1);if(!l||l.entries.length!==16)throw Error('BOUNDED_LEDGER_MISSING');
 const b=l.entries.findIndex(e=>e.phase!=='PUBLISHED');
 if(b<0){console.log('[PHASE G V1300] | BOUNDED_BUCKET | '+JSON.stringify({status:'ALL_16_PUBLISHED',next:'verifyQboPg300BoundedBeforeCommit'}));return;}
 const t=Date.now();const result=qboPg300PublishBucket_(io,cfg.claim,cfg.owner,src,b);
 console.log('[PHASE G V1300] | BOUNDED_BUCKET | '+JSON.stringify({status:'PASS',bucket:b,elapsedMs:Date.now()-t,reused:result.reused,remaining:15-b,isolated:true}));
}
function verifyQboPg300BoundedBeforeCommit(){
 const io=qboPg300BoundedIo_(),src=qboPg300BoundedSource_(),s=io.readState(),j=io.readJournal(),l=io.readLedger(1);
 if(s.fileCursor!==0||s.chunk!==1||!j||j.phase!=='STAGING'||!l||l.entries.length!==16)throw Error('BOUNDED_PRECOMMIT_STATE');
 let count=0;for(let b=0;b<16;b++){const fs=io.listFinal(b,1),st=io.listStage(b,1);if(fs.length!==1||st.length!==0||l.entries[b].phase!=='PUBLISHED'||l.entries[b].finalId!==fs[0].id)throw Error('BOUNDED_PRECOMMIT_ARTIFACT_'+b);io.verifyFile(fs[0],src.payloads[b]);count++;}
 console.log('[PHASE G V1300] | BOUNDED_PRECOMMIT | '+JSON.stringify({status:'VERIFIED',finalCount:count,cursor:s.fileCursor,journalPresent:true,isolated:true}));
}
function commitQboPg300BoundedLab(){
 verifyQboPg300BoundedBeforeCommit();const cfg=qboPg300BoundedCfg_(),io=qboPg300BoundedIo_(),src=qboPg300BoundedSource_();
 const next=JSON.parse(JSON.stringify(io.readState()));next.fileCursor=1;next.rows=16;next.chunk=2;next.status='HALTED_REVIEW_REQUIRED';next.lease=null;
 const committed=qboPg300Commit_(io,cfg.claim,cfg.owner,src,next);
 console.log('[PHASE G V1300] | BOUNDED_COMMIT | '+JSON.stringify({status:committed.status,cursor:committed.cursor,journalPresent:!!io.readJournal(),isolated:true}));
}
function finalizeQboPg300BoundedLab(){
 const io=qboPg300BoundedIo_(),src=qboPg300BoundedSource_();
 const result=qboPg300Finalize_(io,src);
 console.log('[PHASE G V1300] | BOUNDED_FINALIZE | '+JSON.stringify({status:result.status,journalPresent:!!io.readJournal(),workerResumed:false,isolated:true}));
}
function inspectQboPg300BoundedLab(){
 const io=qboPg300BoundedIo_(),s=io.readState(),j=io.readJournal(),l=io.readLedger(1);
 const phases=l?l.entries.reduce((a,e)=>(a[e.phase]=(a[e.phase]||0)+1,a),{}):{};
 console.log('[PHASE G V1300] | BOUNDED_INSPECT | '+JSON.stringify({readOnly:true,cursor:s.fileCursor,rows:s.rows,chunk:s.chunk,journalPresent:!!j,phases,isolated:true,workerResumed:false}));
}
