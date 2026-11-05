/** V1300 read-only profiler for the completed BOUNDED lab. No writes or triggers. */
function profileQboPg300BoundedLabReadOnly(){
 const cfg=qboPg300BoundedCfg_();
 if(cfg.isolated!==true||!cfg.stateKey.startsWith('QBO_PG300_LAB_')||!cfg.ledgerPointerPrefix.startsWith('QBO_PG300_LAB_'))throw Error('PROFILE_ISOLATION_REQUIRED');
 const p=PropertiesService.getScriptProperties(), chunk=1;
 const t=()=>Date.now(), results=[];
 function timed(name,fn){const start=t(),value=fn();results.push({name,ms:t()-start});return value;}
 const s=timed('state_property_read',()=>JSON.parse(p.getProperty(cfg.stateKey)));
 const j=timed('journal_property_read',()=>p.getProperty(cfg.journalKey));
 const ptr=timed('ledger_pointer_read',()=>JSON.parse(p.getProperty(cfg.ledgerPointerPrefix+'_'+chunk)));
 const ledgerFolder=DriveApp.getFolderById(cfg.ledgerFolderId);
 const generations=timed('ledger_folder_enumeration',()=>{const it=ledgerFolder.getFiles(),out=[];while(it.hasNext()){const f=it.next();out.push({id:f.getId(),name:f.getName(),size:f.getSize()});}return out;});
 const latest=timed('head_generation_blob_read',()=>DriveApp.getFileById(ptr.id).getBlob().getDataAsString());
 const io=timed('adapter_construction',()=>qboPg300BoundedIo_());
 const ledger=timed('adapter_readLedger_full_custody',()=>io.readLedger(chunk));
 const finals=timed('list_16_final_files',()=>cfg.bucketFolderIds.map((_,b)=>io.listFinal(b,chunk).length));
 const stages=timed('list_16_stage_files',()=>cfg.bucketFolderIds.map((_,b)=>io.listStage(b,chunk).length));
 const head=JSON.parse(latest);
 const sizes=generations.map(x=>x.size);
 const out={version:'1.5.300-profile',readOnly:true,isolated:true,rootId:cfg.rootId,checkpoint:{cursor:s.fileCursor,rows:s.rows,chunk:s.chunk},journalPresent:!!j,ledger:{generationCount:generations.length,headSequence:ptr.sequence,headBytes:latest.length,totalBytes:sizes.reduce((a,b)=>a+b,0),minBytes:Math.min.apply(null,sizes),maxBytes:Math.max.apply(null,sizes),entries:ledger.entries.length,published:ledger.entries.filter(e=>e.phase==='PUBLISHED').length},finalCount:finals.reduce((a,b)=>a+b,0),stageCount:stages.reduce((a,b)=>a+b,0),timings:results,productionWrites:0,triggerChanges:0};
 console.log('[PHASE G V1300] | BOUNDED_PROFILE_READ_ONLY | '+JSON.stringify(out));
 return out;
}
