/** V1300 isolated full-path integration exercise. NEVER production. */
const QBO_PG300_FULLLAB_KEY_='QBO_PG300_LAB_INTEGRATED_CONFIG';
function setupQboPg300IntegratedLab(){
 const props=PropertiesService.getScriptProperties();
 if(props.getProperty(QBO_PG300_FULLLAB_KEY_))throw Error('V1300_LAB_ALREADY_CONFIGURED');
 const root=DriveApp.createFolder('QBO_PG300_INTEGRATED_LAB_'+Utilities.getUuid());
 const ledger=root.createFolder('ledger'),stage=root.createFolder('stage');
 const bucketFolderIds=Array.from({length:16},(_,b)=>root.createFolder('bucket_'+('0'+b).slice(-2)).getId());
 const suffix=Utilities.getUuid().replace(/-/g,'');
 const cfg={isolated:true,rootId:root.getId(),ledgerFolderId:ledger.getId(),stageFolderId:stage.getId(),bucketFolderIds,
 stateKey:'QBO_PG300_LAB_STATE_'+suffix,journalKey:'QBO_PG300_LAB_JOURNAL_'+suffix,ledgerPointerPrefix:'QBO_PG300_LAB_LEDGER_'+suffix};
 props.setProperty(QBO_PG300_FULLLAB_KEY_,JSON.stringify(cfg));
 const io=qboPg300IntegratedIo_();
 io.writeState({status:'STAGING',fileCursor:0,rows:0,chunk:1,ownerEpoch:0,lease:null});
 console.log('[PHASE G V1300] | INTEGRATED_SETUP | '+JSON.stringify({status:'READY',rootId:cfg.rootId,isolated:true}));
}
function qboPg300IntegratedIo_(){
 const props=PropertiesService.getScriptProperties(),raw=props.getProperty(QBO_PG300_FULLLAB_KEY_);
 if(!raw)throw Error('V1300_LAB_NOT_SETUP');
 const cfg=JSON.parse(raw);
 if(!cfg.isolated||!cfg.rootId||!cfg.stateKey.startsWith('QBO_PG300_LAB_'))throw Error('V1300_ISOLATION_GATE');
 return qboPg300AdapterCreateIsolated_(Object.assign({},cfg,{properties:props,lock:LockService.getScriptLock()}));
}
function qboPg300IntegratedSource_(){
 const payloads=Array.from({length:16},(_,b)=>({version:'1.5.274',bucket:b,chunk:1,rows:1,hash:'SYNTHETIC_HASH_'+b,entries:[['SYNTHETIC_'+b,'SYNTHETIC_FILE','synthetic']]}));
 return {cursor:0,chunk:1,files:1,rows:16,digest:'SYNTHETIC_SOURCE_DIGEST',payloads,hashes:payloads.map(p=>p.hash)};
}
function runQboPg300IntegratedLab(){
 const io=qboPg300IntegratedIo_(),source=qboPg300IntegratedSource_(),owner='INTEGRATED_LAB_'+Utilities.getUuid();
 const claim=qboPg300Claim_(io,0,owner);
 qboPg300Intent_(io,claim,owner,source);
 for(let b=0;b<16;b++){
  const result=qboPg300PublishBucket_(io,claim,owner,source,b);
  console.log('[PHASE G V1300] | INTEGRATED_BUCKET | '+JSON.stringify(result));
 }
 const next=JSON.parse(JSON.stringify(io.readState()));
 next.fileCursor=1;next.rows=16;next.chunk=2;next.status='HALTED_REVIEW_REQUIRED';next.lease=null;
 const committed=qboPg300Commit_(io,claim,owner,source,next);
 const journalBefore=!!io.readJournal();
 if(!journalBefore)throw Error('V1300_JOURNAL_LOST_BEFORE_FINALIZE');
 const finalized=qboPg300Finalize_(io,source);
 console.log('[PHASE G V1300] | INTEGRATED_RUN | '+JSON.stringify({status:'PASS',committed,finalized,journalBefore,productionWrites:0,workerResumed:false}));
}
function inspectQboPg300IntegratedLab(){
 const io=qboPg300IntegratedIo_(),state=io.readState(),source=qboPg300IntegratedSource_();
 const ledger=io.readLedger(1),counts=[];
 for(let b=0;b<16;b++){
  const fs=io.listFinal(b,1);if(fs.length!==1)throw Error('V1300_FINAL_COUNT_'+b);
  io.verifyFile(fs[0],source.payloads[b]);counts.push(fs.length);
 }
 if(state.fileCursor!==1||state.rows!==16||state.chunk!==2||io.readJournal()||ledger.entries.some(e=>e.phase!=='PUBLISHED'))throw Error('V1300_FINAL_STATE_INVALID');
 console.log('[PHASE G V1300] | INTEGRATED_INSPECT | '+JSON.stringify({status:'ISOLATED_INTEGRATED_VERIFIED',readOnly:true,finalCount:counts.reduce((a,b)=>a+b,0),cursor:state.fileCursor,rows:state.rows,chunk:state.chunk,journalPresent:false,productionWrites:0,workerResumed:false}));
}
