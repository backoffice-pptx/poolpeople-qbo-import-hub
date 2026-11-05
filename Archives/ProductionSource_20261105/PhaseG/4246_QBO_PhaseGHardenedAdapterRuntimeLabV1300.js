/** V1300 isolated hardened-adapter runtime lab. Never uses production keys. */
const QBO_PG300_LAB_KEY_='QBO_PG300_LAB_RUNTIME_CONFIG';
function setupQboPg300HardenedAdapterLab(){
 const p=PropertiesService.getScriptProperties();
 if(p.getProperty(QBO_PG300_LAB_KEY_))throw Error('LAB_ALREADY_EXISTS_INSPECT_FIRST');
 const root=DriveApp.createFolder('QBO_PG300_ADAPTER_LAB_'+Utilities.getUuid());
 const ledger=root.createFolder('ledger'),stage=root.createFolder('stage');
 const buckets=Array.from({length:16},(_,b)=>root.createFolder('bucket_'+b).getId());
 const tag=Utilities.getUuid().replace(/-/g,'');
 const cfg={isolated:true,rootId:root.getId(),ledgerFolderId:ledger.getId(),stageFolderId:stage.getId(),bucketFolderIds:buckets,
 stateKey:'QBO_PG300_LAB_'+tag+'_STATE',journalKey:'QBO_PG300_LAB_'+tag+'_JOURNAL',ledgerPointerPrefix:'QBO_PG300_LAB_'+tag+'_POINTER'};
 p.setProperty(QBO_PG300_LAB_KEY_,JSON.stringify(cfg));
 console.log('[PHASE G V1300] | SETUP | '+JSON.stringify({status:'READY',rootId:cfg.rootId,isolated:true,productionWrites:0}));
}
function qboPg300LabCfg_(){const raw=PropertiesService.getScriptProperties().getProperty(QBO_PG300_LAB_KEY_);if(!raw)throw Error('LAB_NOT_SETUP');return JSON.parse(raw);}
function qboPg300LabIo_(){const cfg=qboPg300LabCfg_();return qboPg300AdapterCreateIsolated_(Object.assign({},cfg,{properties:PropertiesService.getScriptProperties(),lock:LockService.getScriptLock()}));}
function qboPg300LabLedger_(chunk){return {version:'1.5.300',chunk,cursor:801,sourceDigest:'synthetic-'+chunk,entries:Array.from({length:16},(_,b)=>({bucket:b,phase:'INTENT',hash:'hash-'+b,stageId:null,finalId:null}))};}
function runQboPg300HardenedAdapterLab(){
 const io=qboPg300LabIo_(),cfg=qboPg300LabCfg_(),p=PropertiesService.getScriptProperties(),results=[];
 function check(name,fn){try{const detail=fn();results.push({name,status:'PASS',detail:detail||null});}catch(e){results.push({name,status:'FAIL',error:String(e)});}}
 check('IMMUTABLE_GENERATION_POINTER_READBACK',()=>{io.writeLedger(3001,qboPg300LabLedger_(3001));const l=io.readLedger(3001);if(!l||l.entries.length!==16)throw Error('NO_READBACK');return {entries:16};});
 check('SECOND_GENERATION_RETAINS_HISTORY',()=>{const l=io.readLedger(3001);l.entries[0].phase='STAGED';io.writeLedger(3001,l);if(io.readLedger(3001).entries[0].phase!=='STAGED')throw Error('POINTER_NOT_ADVANCED');const it=DriveApp.getFolderById(cfg.ledgerFolderId).getFiles(),files=[];while(it.hasNext()){const f=it.next();if(f.getName().indexOf('ledger_003001_gen_')===0)files.push(f.getId());}if(files.length!==2)throw Error('EXPECTED_TWO_GENERATIONS_'+files.length);return {generations:2};});
 check('ORPHAN_WITHOUT_POINTER_HALTS',()=>{DriveApp.getFolderById(cfg.ledgerFolderId).createFile('ledger_003002_gen_orphan.json','{}',MimeType.PLAIN_TEXT);try{io.readLedger(3002);}catch(e){if(String(e).indexOf('UNREFERENCED_LEDGER_GENERATION_REVIEW')>=0)return 'fail_closed';throw e;}throw Error('ORPHAN_NOT_REJECTED');});
 check('CORRUPT_POINTER_HALTS',()=>{const k=cfg.ledgerPointerPrefix+'_3001',original=p.getProperty(k);try{p.setProperty(k,'{broken');try{io.readLedger(3001);}catch(e){if(String(e).indexOf('INVALID_LEDGER_POINTER')>=0)return 'fail_closed';throw e;}throw Error('BAD_POINTER_ACCEPTED');}finally{p.setProperty(k,original);}});
 check('STAGING_NAME_IN_FINAL_BUCKET_DETECTED',()=>{const name='stage_b00_chunk_003003.json';const f=DriveApp.getFolderById(cfg.bucketFolderIds[0]).createFile(name,'{}',MimeType.PLAIN_TEXT);const found=io.listStage(0,3003);if(found.length!==1||found[0].id!==f.getId())throw Error('STAGE_NOT_FOUND');return {stageCount:1};});
 check('NO_PRODUCTION_KEYS_IN_CONFIG',()=>{if(![cfg.stateKey,cfg.journalKey,cfg.ledgerPointerPrefix].every(x=>x.indexOf('QBO_PG300_LAB_')===0))throw Error('UNSAFE_KEYS');return 'isolated';});
 console.log('[PHASE G V1300] | HARDENED_ADAPTER_RUNTIME | '+JSON.stringify({version:'1.5.300',isolated:true,passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status==='FAIL').length,results,rootId:cfg.rootId,productionCheckpointWrites:0,productionTriggerChanges:0,cleanupPerformed:false,workerResumed:false}));
}
function inspectQboPg300HardenedAdapterLab(){const io=qboPg300LabIo_(),cfg=qboPg300LabCfg_(),l=io.readLedger(3001);console.log('[PHASE G V1300] | INSPECT | '+JSON.stringify({readOnly:true,rootId:cfg.rootId,ledgerEntries:l.entries.length,firstEntryPhase:l.entries[0].phase,productionWrites:0}));}
