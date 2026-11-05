/** V1300 custody cost instrumentation. Read-only; existing isolated bounded lab only. */
function profileQboPg300CustodyCostV1300(){
 const cfg=qboPg300BoundedCfg_();
 if(cfg.isolated!==true||!cfg.stateKey.startsWith('QBO_PG300_LAB_')||!cfg.ledgerPointerPrefix.startsWith('QBO_PG300_LAB_'))throw Error('CUSTODY_PROFILE_NOT_ISOLATED');
 const chunk=1,p=PropertiesService.getScriptProperties(),pointerKey=cfg.ledgerPointerPrefix+'_'+chunk;
 const ptr=JSON.parse(p.getProperty(pointerKey)||'null');if(!ptr||!ptr.id||!Number.isInteger(ptr.sequence))throw Error('CUSTODY_PROFILE_NO_HEAD');
 const prefix='ledger_'+('000000'+chunk).slice(-6)+'_gen_';
 const start=Date.now(),folder=DriveApp.getFolderById(cfg.ledgerFolderId),it=folder.getFiles(),files={};
 let enumerated=0,unrelated=0;
 while(it.hasNext()){const f=it.next();if(f.getName().indexOf(prefix)!==0){unrelated++;continue;}files[f.getId()]=f;enumerated++;}
 const enumerationMs=Date.now()-start;
 const timing={blobMs:0,parseMs:0,digestMs:0},visited=new Set();let current=ptr.id,seq=ptr.sequence,head=null;
 const hex=v=>Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(v)).map(b=>('0'+(b&255).toString(16)).slice(-2)).join('');
 while(current){
  if(visited.has(current)||!files[current])throw Error('CUSTODY_PROFILE_MISSING_OR_CYCLE');
  const a=Date.now(),raw=files[current].getBlob().getDataAsString();timing.blobMs+=Date.now()-a;
  const b=Date.now(),g=JSON.parse(raw);timing.parseMs+=Date.now()-b;
  if(g.chunk!==chunk||!g.custody||g.custody.sequence!==seq||!Array.isArray(g.entries)||g.entries.length!==16)throw Error('CUSTODY_PROFILE_BAD_GENERATION');
  if(!head){const c=Date.now();if(hex(g)!==ptr.digest)throw Error('CUSTODY_PROFILE_HEAD_DIGEST');timing.digestMs+=Date.now()-c;head=g;}
  visited.add(current);current=g.custody.parentId;seq--;
  if(seq<0)throw Error('CUSTODY_PROFILE_BAD_DEPTH');
 }
 if(seq!==0||visited.size!==enumerated)throw Error('CUSTODY_PROFILE_ORPHAN_OR_INCOMPLETE');
 const manualMs=Date.now()-start;
 const io=qboPg300BoundedIo_();
 const r=Date.now(),adapterLedger=io.readLedger(chunk),adapterMs=Date.now()-r;
 if(JSON.stringify(adapterLedger)!==JSON.stringify(head))throw Error('CUSTODY_PROFILE_ADAPTER_MISMATCH');
 const out={version:'1.5.300-custody-cost',readOnly:true,isolated:true,generations:enumerated,unrelatedFiles:unrelated,headSequence:ptr.sequence,enumerationMs,blobMs:timing.blobMs,parseMs:timing.parseMs,digestMs:timing.digestMs,manualFullCustodyMs:manualMs,adapterFullCustodyMs:adapterMs,otherManualMs:manualMs-enumerationMs-timing.blobMs-timing.parseMs-timing.digestMs,productionWrites:0,triggerChanges:0,workerResumed:false};
 console.log('[PHASE G V1300] | CUSTODY_COST_READ_ONLY | '+JSON.stringify(out));return out;
}
