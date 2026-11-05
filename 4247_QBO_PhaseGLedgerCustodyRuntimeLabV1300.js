/** Isolated runtime test only. Requires 4245. Creates new isolated folders and lab-only properties. */
function runQboPg300LedgerCustodyLab(){
 const id=Utilities.getUuid().replace(/-/g,'').slice(0,16),root=DriveApp.createFolder('QBO_PG300_CUSTODY_LAB_'+id),ledger=root.createFolder('ledger'),stage=root.createFolder('stage');
 const buckets=Array.from({length:16},(_,i)=>root.createFolder('bucket_'+i).getId());
 const prefix='QBO_PG300_LAB_CUSTODY_'+id,props=PropertiesService.getScriptProperties();
 const cfg={isolated:true,properties:props,lock:LockService.getScriptLock(),ledgerFolderId:ledger.getId(),stageFolderId:stage.getId(),bucketFolderIds:buckets,stateKey:prefix+'_STATE',journalKey:prefix+'_JOURNAL',ledgerPointerPrefix:prefix+'_PTR'};
 const io=qboPg300AdapterCreateIsolated_(cfg),chunk=85,entries=Array.from({length:16},(_,i)=>({bucket:i,phase:'INTENT'})),sample={chunk,entries};
 const results=[];function check(name,fn){try{fn();results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',error:String(e)});}}
 check('FIRST_GENERATION',()=>{io.writeLedger(chunk,sample);if(io.readLedger(chunk).custody.sequence!==1)throw Error('sequence1');});
 check('SECOND_GENERATION_HISTORY',()=>{io.writeLedger(chunk,sample);if(io.readLedger(chunk).custody.sequence!==2)throw Error('sequence2');});
 check('ORPHAN_AFTER_VALID_POINTER_HALTS',()=>{ledger.createFile('ledger_000085_gen_orphan_'+id+'.json',JSON.stringify(sample),MimeType.PLAIN_TEXT);let halted=false;try{io.readLedger(chunk);}catch(e){halted=String(e).indexOf('UNREFERENCED_LEDGER_GENERATION_REVIEW')>=0;}if(!halted)throw Error('orphan_not_rejected');});
 check('NO_PRODUCTION_KEYS',()=>{if(cfg.stateKey.indexOf('QBO_PG300_LAB_')!==0||cfg.journalKey.indexOf('QBO_PG300_LAB_')!==0)throw Error('keys');});
 const failed=results.filter(r=>r.status==='FAIL').length;
 const output={version:'1.5.300-custody',isolated:true,status:failed?'FAILED':'PASS',passed:results.length-failed,failed,rootId:root.getId(),results,productionCheckpointWrites:0,productionTriggerChanges:0,cleanupPerformed:false};
 console.log('[PHASE G V1300] | CUSTODY_RUNTIME | '+JSON.stringify(output));if(failed)throw Error('V1300_CUSTODY_TEST_FAILURE');return output;
}
