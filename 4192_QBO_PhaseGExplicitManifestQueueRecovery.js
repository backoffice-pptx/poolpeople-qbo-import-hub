/** v1.5.250 (durable audit identity remains v1.5.245). Audit exact committed membership, then replace ONLY expired-iterator dependence.
 * Before activation: writes private audit files/workbook and removes stranded Phase G trigger.
 * After activation: existing journaled worker retains its source/tail/counter guards. */
const QBO_PHASE_G_QUEUE_V1245_=Object.freeze({KEY:'QBO_PHASE_G_EXPLICIT_QUEUE_V1245_POINTER',HANDLER:'qboPhaseGExplicitQueueAuditV1245Continuation_',BASE_CURSOR:1955,BASE_COUNT:457008,BASE_ADMITTED:456976,BASE_EXCEPTION:32,INFLIGHT:'qbo_observation_index_artifact_000001499_1c9e07c7550451dc',MANIFEST:'1LwZM8xYeGqc6JabY4d5iZ2FIuUMV-tPe',SHARD:'070089cbb70740314a7676ef7b1b8e3000b421b54a705ee38dea33987dab8f5b',SLOT:19,AUDIT_COUNT:405205,AUDIT_CURSOR:1735,AUDIT_WB:'1DPyxkECiFOTuE06tF4Hhnp0Lhd_W33jtim8PGEdk_7k'});
function qboPhaseG1245Log_(kind,value){console.log('[PHASE G EXPLICIT QUEUE V1245] | '+kind+' | '+JSON.stringify(value));}
function qboPhaseG1245Lock_(fn){const lock=LockService.getUserLock();if(!lock.tryLock(1000))throw Error('V1245_BUSY_RETRY_LATER');try{return fn();}finally{lock.releaseLock();}}
function qboPhaseG1245Boundary_(raw){
 const C=QBO_PHASE_G_QUEUE_V1245_,s=JSON.parse(raw||'null');qboPhaseG1231Require_(s);qboPhaseG1219RequireAuthority_();
 const j=s.writeJournalV1231,r=s.journaledRecoveryV1231;
 if(s.status!=='BUILDING_GLOBAL_PARTITIONS'||s.manifestCursor!==C.BASE_CURSOR||s.manifestCount!==2418||s.observationCount!==C.BASE_COUNT||s.admittedCount!==C.BASE_ADMITTED||s.evidenceExceptionCount!==C.BASE_EXCEPTION||s.blockedCount!==0||s.partitionCursor!==0||s.explicitManifestQueueV1245||!r.firstManifestCommitted||!r.continueAfterFirst||r.auditWorkbookId!==C.AUDIT_WB||!j||j.base!==C.INFLIGHT||j.manifestId!==C.MANIFEST||j.shardHash!==C.SHARD||j.slotCursor!==C.SLOT||j.slots.length!==64||s.inFlightManifestBase!==C.INFLIGHT||s.inFlightObservationCount!==250||j.manifestCursor!==s.manifestCursor||j.observationCount!==s.observationCount||j.admittedCount!==s.admittedCount||j.exceptionCount!==32||j.blockedCount!==0||JSON.stringify(j.delta)!==JSON.stringify({total:250,admitted:250,exception:0,blocked:0}))throw Error('V1245_FROZEN_BOUNDARY_NOT_EXACT');
 return s;
}
function qboPhaseG1245Persist_(file,value){const raw=JSON.stringify(value);file.setContent(raw);if(file.getBlob().getDataAsString('UTF-8')!==raw)throw Error('V1245_PRIVATE_CHECKPOINT_READBACK');}
function qboPhaseG1245Read_(){
 const ptr=JSON.parse(PropertiesService.getScriptProperties().getProperty(QBO_PHASE_G_QUEUE_V1245_.KEY)||'null');if(!ptr)throw Error('V1245_START_REQUIRED');
 const f=DriveApp.getFileById(ptr.stateFileId),state=JSON.parse(f.getBlob().getDataAsString('UTF-8'));
 if(state.version!=='1.5.245'||state.folderId!==ptr.folderId||state.baseCursor!==1955||state.baseGlobalHash!==qboNativeCdcSha256_(state.frozenGlobalRaw))throw Error('V1245_PRIVATE_IDENTITY_INVALID');
 return {file:f,state:state,folder:DriveApp.getFolderById(ptr.folderId)};
}
function qboPhaseG1245Frozen_(state){const raw=PropertiesService.getScriptProperties().getProperty(QBO_PHASE_G_RECOVERY_V1231_.GLOBAL);if(raw!==state.frozenGlobalRaw)throw Error('V1245_GLOBAL_CHANGED_DURING_AUDIT');qboPhaseG1245Boundary_(raw);if(ScriptApp.getProjectTriggers().some(t=>[QBO_PHASE_G_RECOVERY_V1231_.HANDLER,QBO_PHASE_G_GLOBAL_TIE_V1219_.HANDLER].indexOf(t.getHandlerFunction())>=0))throw Error('V1245_PHASE_G_TRIGGER_DURING_AUDIT');return JSON.parse(raw);}
function qboPhaseG1245File_(folder,name){const it=folder.getFilesByName(name);if(!it.hasNext())return null;const f=it.next();if(it.hasNext())throw Error('V1245_DUPLICATE_PRIVATE_FILE '+name);return f;}
function qboPhaseG1245Source_(id,base){let used=false;return qboPhaseG1231Source_({hasNext:()=>!used,next:()=>{if(used)throw Error('V1245_SINGLE_SOURCE_EXHAUSTED');used=true;return DriveApp.getFileById(id);},getContinuationToken:()=>''},base);}
function qboPhaseG1245AuditBase_(){
 const C=QBO_PHASE_G_QUEUE_V1245_,a=JSON.parse(PropertiesService.getScriptProperties().getProperty(QBO_PHASE_G_RECOVERY_V1231_.AUDIT_KEY)||'null');
 if(!a||a.status!=='COMPLETE_AUDIT_FINDINGS'||a.workbookId!==C.AUDIT_WB||a.runId!==QBO_PHASE_G_RECOVERY_V1231_.AUDIT_RUN||a.globalHash!==QBO_PHASE_G_RECOVERY_V1231_.GLOBAL_HASH||a.manifestCursor!==1735||a.manifestCount!==1735||a.partitionCursor!==64||a.rowCount!==405205||a.admitted!==405177||a.exception!==28||a.blocked!==0||a.differenceRows!==0||JSON.stringify(a.resultTotals)!==JSON.stringify([405205,405205,405205,0,0,0,0,0]))throw Error('V1245_PRIOR_AUDIT_NOT_EXACT');
 return a;
}
function startQboPhaseGExplicitQueueAuditV1245(){return qboPhaseG1245Lock_(function(){
 const C=QBO_PHASE_G_QUEUE_V1245_,p=PropertiesService.getScriptProperties();if(p.getProperty(C.KEY))throw Error('V1245_ALREADY_STARTED_USE_CONTINUE');
 const raw=p.getProperty(QBO_PHASE_G_RECOVERY_V1231_.GLOBAL),s=qboPhaseG1245Boundary_(raw),audit=qboPhaseG1245AuditBase_();
 // Same UserLock as the existing worker: freeze before listing, never invoke old iterator.
 ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()===QBO_PHASE_G_RECOVERY_V1231_.HANDLER).forEach(t=>ScriptApp.deleteTrigger(t));
 const aw=SpreadsheetApp.openById(C.AUDIT_WB),ms=aw.getSheetByName('Committed_Manifest_Set'),es=aw.getSheetByName('Expected_Rows');
 if(!ms||ms.getLastRow()!==1736||JSON.stringify(ms.getRange(1,1,1,3).getValues()[0])!==JSON.stringify(['ManifestId','ManifestName','Membership'])||!es||es.getLastRow()!==405206)throw Error('V1245_AUDIT_BASE_SHAPE');
 const old=ms.getRange(2,1,1735,3).getValues(),oldMap=Object.create(null);old.forEach(r=>{if(r[2]!=='COMMITTED'||!r[0]||oldMap[String(r[0])])throw Error('V1245_AUDIT_MEMBERSHIP_INVALID');oldMap[String(r[0])]=String(r[1]);});
 const folders=qboObsIndexV175ResolveFolders_(),it=folders.manifests.getFiles(),all=[],seen=Object.create(null);while(it.hasNext()){const f=it.next(),id=f.getId(),name=f.getName();if(seen[id]||!name.endsWith('.manifest.json'))throw Error('V1245_INVENTORY_INVALID');seen[id]=true;all.push({id:id,name:name,base:name.replace(/\.manifest\.json$/,'')});if(all.length>2418)throw Error('V1245_INVENTORY_GREW');}
 if(all.length!==2418||old.some(r=>!seen[String(r[0])]||all.filter(x=>x.id===String(r[0]))[0].name!==String(r[1])))throw Error('V1245_FROZEN_POPULATION_CHANGED');
 const candidates=all.filter(x=>!oldMap[x.id]).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 if(candidates.length!==683||candidates.filter(x=>x.id===C.MANIFEST&&x.base===C.INFLIGHT).length!==1||p.getProperty(QBO_PHASE_G_RECOVERY_V1231_.GLOBAL)!==raw)throw Error('V1245_CANDIDATE_SET_CHANGED');
 const folder=DriveApp.createFolder('QBO Phase G Explicit Queue Recovery v1.5.245 '+new Date().toISOString()),inventory={version:'1.5.245',all:all.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),priorCommitted:old,candidates:candidates},invRaw=JSON.stringify(inventory),inv=folder.createFile('frozen_inventory.json',invRaw,'application/json');if(inv.getBlob().getDataAsString('UTF-8')!==invRaw)throw Error('V1245_INVENTORY_READBACK');
 const wb=SpreadsheetApp.create('QBO Phase G Queue Membership Audit v1.5.245 '+new Date().toISOString()),sh=wb.getSheets()[0];sh.setName('Candidate_Rows');if(sh.getMaxColumns()>4)sh.deleteColumns(5,sh.getMaxColumns()-4);sh.getRange(1,1,1,4).setValues([['Partition','CandidateIndex','ObservationId','RowJSON']]);
 const state={version:'1.5.245',status:'BUILD_CANDIDATE_ROWS',baseCursor:1955,baseGlobalHash:qboNativeCdcSha256_(raw),frozenGlobalRaw:raw,folderId:folder.getId(),inventoryFileId:inv.getId(),inventorySha256:qboNativeCdcSha256_(invRaw),workbookId:wb.getId(),candidateCursor:0,candidateCount:683,rowCount:0,delta:{total:0,admitted:0,exception:0,blocked:0},partitionCounts:Array(64).fill(0),partitionCursor:0,metadata:[],auditPartitionCounts:audit.partitionCounts.slice(),createdAt:new Date().toISOString(),error:'',queueFileId:'',queueSha256:''};
 const f=folder.createFile('checkpoint.json',JSON.stringify(state),'application/json');qboPhaseG1245Persist_(f,state);p.setProperty(C.KEY,JSON.stringify({folderId:folder.getId(),stateFileId:f.getId()}));ScriptApp.newTrigger(C.HANDLER).timeBased().everyMinutes(1).create();return qboPhaseG1245Summary_(state);
 });}
function qboPhaseG1245Inventory_(state){const raw=DriveApp.getFileById(state.inventoryFileId).getBlob().getDataAsString('UTF-8');if(qboNativeCdcSha256_(raw)!==state.inventorySha256)throw Error('V1245_INVENTORY_CHANGED');return JSON.parse(raw);}
function continueQboPhaseGExplicitQueueAuditV1245(){return qboPhaseG1245Lock_(function(){
 const ctx=qboPhaseG1245Read_(),s=ctx.state;try{
  const global=qboPhaseG1245Frozen_(s),inv=qboPhaseG1245Inventory_(s),C=QBO_PHASE_G_QUEUE_V1245_,started=Date.now();
  if(s.status==='READY_FOR_EXPLICIT_QUEUE_ACTIVATION'){qboPhaseG1245RemoveAuditTrigger_();return qboPhaseG1245Summary_(s);}
  const position=s.status+'|'+s.candidateCursor+'|'+s.partitionCursor;s.attemptsAtPosition=s.lastAttemptPosition===position?Number(s.attemptsAtPosition||0)+1:1;s.lastAttemptPosition=position;if(s.attemptsAtPosition>3){qboPhaseG1245RemoveAuditTrigger_();throw Error('V1245_RETRY_LIMIT_REVIEW_REQUIRED');}qboPhaseG1245Persist_(ctx.file,s);
  if(s.status==='BUILD_CANDIDATE_ROWS'){
   const sh=SpreadsheetApp.openById(s.workbookId).getSheetByName('Candidate_Rows');let n=0;
   while(s.candidateCursor<683&&n<12&&Date.now()-started<90000){
    const idx=s.candidateCursor,item=inv.candidates[idx],source=qboPhaseG1245Source_(item.id,item.base),rows=[],counts=Array(64).fill(0);
    Object.keys(source.buckets).forEach(k=>{const part=Number(k);source.buckets[k].forEach(row=>{counts[part]++;rows.push([part,idx,row[3],JSON.stringify(row)]);});});
    if(rows.length!==source.delta.total)throw Error('V1245_SOURCE_ROWCOUNT');
    if(rows.length){qboPhaseG1230Capacity_(sh,s.rowCount+rows.length+1);sh.getRange(s.rowCount+2,1,rows.length,4).setValues(rows);}SpreadsheetApp.flush();
    qboPhaseG1245Frozen_(s);s.metadata.push({id:item.id,base:item.base,shardHash:source.shardHash,delta:source.delta,partitionCounts:counts});s.rowCount+=rows.length;Object.keys(s.delta).forEach(k=>s.delta[k]+=source.delta[k]);counts.forEach((v,i)=>s.partitionCounts[i]+=v);s.candidateCursor++;s.error='';qboPhaseG1245Persist_(ctx.file,s);n++;
   }
   if(s.candidateCursor===683){
    if(s.metadata.length!==683||s.rowCount!==329653||JSON.stringify(s.delta)!==JSON.stringify({total:329653,admitted:329609,exception:24,blocked:20}))throw Error('V1245_FULL_POPULATION_TOTALS');
    s.status='SORT_CANDIDATE_ROWS';qboPhaseG1245Persist_(ctx.file,s);
   }
  }else if(s.status==='SORT_CANDIDATE_ROWS'){
   const sh=SpreadsheetApp.openById(s.workbookId).getSheetByName('Candidate_Rows');if(sh.getLastRow()!==s.rowCount+1)throw Error('V1245_PRIVATE_ROWCOUNT');sh.getRange(2,1,s.rowCount,4).sort([{column:1,ascending:true},{column:3,ascending:true}]);SpreadsheetApp.flush();qboPhaseG1245Frozen_(s);s.status='COMPARE_PARTITIONS';qboPhaseG1245Persist_(ctx.file,s);
  }else if(s.status==='COMPARE_PARTITIONS'){
   // One partition per call; compare audited prefix, later committed suffix, and journal tail separately.
   const part=s.partitionCursor,wb=s.verifiedPartitionFilesV1250?null:SpreadsheetApp.openById(s.workbookId),sh=wb?wb.getSheetByName('Candidate_Rows'):null,offset=s.partitionCounts.slice(0,part).reduce((a,b)=>a+b,0),n=s.partitionCounts[part],expected=s.verifiedPartitionFilesV1250?qboPhaseG1250ExpectedRows_(s,part):(n?sh.getRange(offset+2,1,n,4).getValues():[]),map=Object.create(null),matched=Array(683).fill(0);
   expected.forEach(r=>{if(Number(r[0])!==part||!Number.isInteger(Number(r[1]))||!s.metadata[Number(r[1])]||map[String(r[2])])throw Error('V1245_EXPECTED_PARTITION_INVALID');map[String(r[2])]={idx:Number(r[1]),json:String(r[3])};});
   const orig=SpreadsheetApp.openById(global.workbookId).getSheetByName(qboPhaseG1219PartName_(part)),baseN=s.auditPartitionCounts[part],committedN=global.journaledRecoveryV1231.partitionRows[part],slot=global.writeJournalV1231.slots[part];
   if(!orig||JSON.stringify(orig.getRange(1,1,1,10).getValues()[0])!==JSON.stringify(QBO_PHASE_G_RECOVERY_V1231_.FIELDS)||slot.part!==part||slot.start!==committedN+2||committedN<baseN||orig.getLastRow()<committedN+1||orig.getLastRow()>slot.start+slot.count-1)throw Error('V1245_ACTUAL_PARTITION_SHAPE '+part);
   const auditRows=SpreadsheetApp.openById(C.AUDIT_WB).getSheetByName('Expected_Rows'),baseOffset=s.auditPartitionCounts.slice(0,part).reduce((a,b)=>a+b,0),baseExpected=baseN?auditRows.getRange(baseOffset+2,1,baseN,4).getValues():[],prefix=baseN?orig.getRange(2,1,baseN,10).getValues():[];
   if(baseExpected.some(r=>Number(r[0])!==part))throw Error('V1245_AUDIT_SORT_INVALID');const baseResult=qboPhaseG1230Compare_(baseExpected,prefix);if(baseResult.differences.length)throw Error('V1245_AUDITED_PREFIX_CHANGED '+part);prefix.forEach(row=>{if(map[String(row[3])])throw Error('V1245_OBSERVATION_ID_OVERLAPS_AUDITED_PREFIX '+part);});
   const actual=committedN>baseN?orig.getRange(baseN+2,1,committedN-baseN,10).getValues():[],seen=Object.create(null);
   actual.forEach(row=>{const value=row.map(String),id=value[3],e=map[id];if(!e||seen[id]||e.json!==JSON.stringify(value)||s.metadata[e.idx].id===C.MANIFEST)throw Error('V1245_COMMITTED_SUFFIX_MISMATCH '+part);seen[id]=true;matched[e.idx]++;});
   const currentIndex=s.metadata.findIndex(x=>x.id===C.MANIFEST),tailExpected=expected.filter(r=>Number(r[1])===currentIndex).map(r=>JSON.parse(String(r[3])));
   // Preserve payload order by rereading the exact source, not the audit's sort order.
   const source=qboPhaseG1245Source_(C.MANIFEST,C.INFLIGHT),wanted=source.buckets[part]||[],tail=orig.getRange(slot.start,1,slot.count,10).getValues();
   if(source.shardHash!==C.SHARD||wanted.length!==slot.count||tailExpected.length!==slot.count)throw Error('V1245_JOURNAL_SOURCE_CHANGED');
   const index=global.writeJournalV1231.slots.findIndex(x=>x.part===part);qboPhaseG1231CheckTail_(tail,wanted);
   const filled=tail.filter(row=>row.some(v=>String(v)!==''));if(index<global.writeJournalV1231.slotCursor&&filled.length!==wanted.length)throw Error('V1245_VERIFIED_JOURNAL_SLOT_MISSING '+part);
   if(index>global.writeJournalV1231.slotCursor&&filled.length)throw Error('V1245_UNEXPECTED_FUTURE_JOURNAL_WRITE '+part);
   const result={version:'1.5.245',partition:part,baseGlobalHash:s.baseGlobalHash,inventorySha256:s.inventorySha256,committedSuffixRows:actual.length,matched:matched,journalPresentRows:filled.length};
   const name='partition_'+String(part).padStart(2,'0')+'.json';let f=qboPhaseG1245File_(ctx.folder,name);if(!f)f=ctx.folder.createFile(name,JSON.stringify(result),'application/json');qboPhaseG1245Persist_(f,result);qboPhaseG1245Frozen_(s);s.partitionCursor++;s.error='';if(s.partitionCursor===64)s.status='CERTIFY_MEMBERSHIP';qboPhaseG1245Persist_(ctx.file,s);
  }else if(s.status==='CERTIFY_MEMBERSHIP'){
   const found=Array(683).fill(0);let physical=0;
   for(let part=0;part<64;part++){const f=qboPhaseG1245File_(ctx.folder,'partition_'+String(part).padStart(2,'0')+'.json');if(!f)throw Error('V1245_MISSING_PARTITION_RESULT');const r=JSON.parse(f.getBlob().getDataAsString('UTF-8'));if(r.partition!==part||r.baseGlobalHash!==s.baseGlobalHash||r.inventorySha256!==s.inventorySha256||r.matched.length!==683)throw Error('V1245_PARTITION_RESULT_INVALID');r.matched.forEach((v,i)=>{if(!Number.isInteger(v)||v<0)throw Error('V1245_INVALID_MATCH_COUNT');found[i]+=v;});physical+=r.committedSuffixRows;}
   const committed=[],remaining=[],totals={total:0,admitted:0,exception:0,blocked:0};s.metadata.forEach((m,i)=>{
    if(m.id===C.MANIFEST){if(found[i]!==0||m.shardHash!==C.SHARD)throw Error('V1245_INFLIGHT_CLASSIFICATION');return;}
    if(m.delta.total===0)throw Error('V1245_ZERO_ROW_MANIFEST_MEMBERSHIP_AMBIGUOUS');
    if(found[i]===m.delta.total){committed.push(m);Object.keys(totals).forEach(k=>totals[k]+=m.delta[k]);}
    else if(found[i]===0)remaining.push(m);else throw Error('V1245_PARTIALLY_COMMITTED_NONJOURNAL_MANIFEST '+m.base);
   });
   if(committed.length!==220||remaining.length!==462||physical!==51803||JSON.stringify(totals)!==JSON.stringify({total:51803,admitted:51799,exception:4,blocked:0}))throw Error('V1245_COMMITTED_MEMBERSHIP_TOTALS');
   const current=s.metadata.find(m=>m.id===C.MANIFEST),queue=[current].concat(remaining.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)),report={version:'1.5.245',status:'EXACT_COMMITTED_MEMBERSHIP_AND_JOURNAL_TAIL_VERIFIED',baseGlobalHash:s.baseGlobalHash,inventorySha256:s.inventorySha256,baseCursor:1955,priorAuditedCommitted:1735,additionalCommitted:committed,additionalCommittedCounts:totals,remainingQueue:queue,expectedPartitionFilesCertificate:s.verifiedPartitionFilesV1250||null,historicalReplayAuthorized:false};
   const raw=JSON.stringify(report),name='certified_queue.json';let f=qboPhaseG1245File_(ctx.folder,name);if(!f)f=ctx.folder.createFile(name,raw,'application/json');if(f.getBlob().getDataAsString('UTF-8')!==raw)throw Error('V1245_QUEUE_REPORT_READBACK');
   qboPhaseG1245Frozen_(s);s.queueFileId=f.getId();s.queueSha256=qboNativeCdcSha256_(raw);s.status='READY_FOR_EXPLICIT_QUEUE_ACTIVATION';s.error='';qboPhaseG1245Persist_(ctx.file,s);
  }else if(s.status!=='READY_FOR_EXPLICIT_QUEUE_ACTIVATION')throw Error('V1245_STATUS_NOT_CONTINUABLE '+s.status);
  if(s.status==='READY_FOR_EXPLICIT_QUEUE_ACTIVATION')qboPhaseG1245RemoveAuditTrigger_();return qboPhaseG1245Summary_(s);
 }catch(e){s.error=String(e.message||e);try{const durable=JSON.parse(ctx.file.getBlob().getDataAsString('UTF-8'));durable.error=s.error;qboPhaseG1245Persist_(ctx.file,durable);}catch(ignored){}const transient=qboPhaseG1246Transient_(s.error);if(!transient||Number(s.attemptsAtPosition||0)>=3)qboPhaseG1245RemoveAuditTrigger_();qboPhaseG1245Log_('STOPPED',{error:s.error,globalCheckpointPreserved:true,automaticRetryAllowed:transient&&Number(s.attemptsAtPosition||0)<3});throw e;}
 });}
function qboPhaseG1245Summary_(s){const out={version:s.version,status:s.status,candidateCursor:s.candidateCursor,candidateCount:s.candidateCount,rowCount:s.rowCount,partitionCursor:s.partitionCursor,baseManifestCursor:s.baseCursor,globalCheckpointModified:s.status==='ACTIVATED',verifiedPartitionFilesEnabled:!!s.verifiedPartitionFilesV1250,queueFileId:s.queueFileId,queueSha256:s.queueSha256,error:s.error,nextAction:s.status==='READY_FOR_EXPLICIT_QUEUE_ACTIVATION'?'ACTIVATE_EXPLICIT_QUEUE':s.status==='ACTIVATED'?'INSPECT_PHASE_G':'RUN_CONTINUE_AUDIT_AGAIN'};qboPhaseG1245Log_('CHECKPOINT',out);return out;}
function inspectQboPhaseGExplicitQueueAuditV1245(){return qboPhaseG1245Summary_(qboPhaseG1245Read_().state);}
function activateQboPhaseGExplicitQueueRecoveryV1245(){return qboPhaseG1245Lock_(function(){
 const ctx=qboPhaseG1245Read_(),s=ctx.state,p=PropertiesService.getScriptProperties();if(s.status!=='READY_FOR_EXPLICIT_QUEUE_ACTIVATION')throw Error('V1245_CERTIFICATION_REQUIRED');const global=qboPhaseG1245Frozen_(s);
 const raw=DriveApp.getFileById(s.queueFileId).getBlob().getDataAsString('UTF-8');if(qboNativeCdcSha256_(raw)!==s.queueSha256)throw Error('V1245_QUEUE_CHANGED');const report=JSON.parse(raw);
 if(report.baseGlobalHash!==s.baseGlobalHash||report.baseCursor!==1955||report.remainingQueue.length!==463||report.remainingQueue[0].id!==global.writeJournalV1231.manifestId||report.remainingQueue[0].shardHash!==global.writeJournalV1231.shardHash)throw Error('V1245_QUEUE_BOUNDARY_CHANGED');
 if(!String(qboPhaseG1231Worker_).includes('qboPhaseG1245Iterator_'))throw Error('V1245_PATCHED_WORKER_NOT_INSTALLED');
 // Replay verification performed above. Only add an immutable queue reference to original checkpoint.
 global.explicitManifestQueueV1245={queueFileId:s.queueFileId,queueSha256:s.queueSha256,baseCursor:1955,count:463,certifiedGlobalHash:s.baseGlobalHash,activatedAt:new Date().toISOString()};
 if(p.getProperty(QBO_PHASE_G_RECOVERY_V1231_.GLOBAL)!==s.frozenGlobalRaw)throw Error('V1245_ACTIVATION_RACE');p.setProperty(QBO_PHASE_G_RECOVERY_V1231_.GLOBAL,JSON.stringify(global));s.status='ACTIVATED';qboPhaseG1245Persist_(ctx.file,s);qboPhaseG1231Schedule_();return qboPhaseG1245Summary_(s);
 });}
function qboPhaseG1245Iterator_(s){
 const ref=s.explicitManifestQueueV1245;if(!ref||ref.baseCursor!==1955||ref.count!==463||s.manifestCount!==2418)throw Error('V1245_QUEUE_REFERENCE_INVALID');
 const raw=DriveApp.getFileById(ref.queueFileId).getBlob().getDataAsString('UTF-8');if(qboNativeCdcSha256_(raw)!==ref.queueSha256)throw Error('V1245_QUEUE_HASH_CHANGED');const report=JSON.parse(raw),queue=report.remainingQueue;
 if(report.status!=='EXACT_COMMITTED_MEMBERSHIP_AND_JOURNAL_TAIL_VERIFIED'||report.baseGlobalHash!==ref.certifiedGlobalHash||report.baseCursor!==1955||!Array.isArray(queue)||queue.length!==463||new Set(queue.map(x=>x.id)).size!==463)throw Error('V1245_QUEUE_CONTENT_INVALID');
 let index=s.manifestCursor-ref.baseCursor;if(!Number.isInteger(index)||index<0||index>queue.length)throw Error('V1245_QUEUE_CURSOR_INVALID');
 if(s.writeJournalV1231&&(!queue[index]||queue[index].id!==s.writeJournalV1231.manifestId||queue[index].base!==s.writeJournalV1231.base||queue[index].shardHash!==s.writeJournalV1231.shardHash))throw Error('V1245_QUEUE_JOURNAL_IDENTITY_CHANGED');
 return {expectedSource:queue[index]||null,hasNext:()=>index<queue.length,next:()=>{if(index>=queue.length)throw Error('V1245_QUEUE_EXHAUSTED');const item=queue[index++],f=DriveApp.getFileById(item.id);if(f.getName()!==item.base+'.manifest.json')throw Error('V1245_QUEUE_FILE_RENAMED');return f;},getContinuationToken:()=> 'EXPLICIT_QUEUE_V1245|'+index};
}

function qboPhaseG1245RemoveAuditTrigger_(){ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()===QBO_PHASE_G_QUEUE_V1245_.HANDLER).forEach(t=>ScriptApp.deleteTrigger(t));}
function qboPhaseGExplicitQueueAuditV1245Continuation_(){try{return continueQboPhaseGExplicitQueueAuditV1245();}catch(e){if(String(e.message||e)==='V1245_BUSY_RETRY_LATER'){qboPhaseG1245Log_('BUSY',{retryOnNextTick:true});return {action:'BUSY'};}throw e;}}

function qboPhaseG1245RequireSource_(expected,source){if(!expected||expected.id!==source.manifestId||expected.base!==source.base||expected.shardHash!==source.shardHash||JSON.stringify(expected.delta)!==JSON.stringify(source.delta))throw Error('V1245_QUEUE_SOURCE_CONTENT_CHANGED');}

/** Only platform service messages qualify. Integrity and invalid-argument errors never do. */
function qboPhaseG1246Transient_(message){return /Service error: Drive|Service Spreadsheets failed|server error occurred|Service unavailable|Internal error|Service invoked too many times in a short time/i.test(String(message));}
function resumeQboPhaseGExplicitQueueAuditV1246(){return qboPhaseG1245Lock_(function(){
 const ctx=qboPhaseG1245Read_(),s=ctx.state,C=QBO_PHASE_G_QUEUE_V1245_;qboPhaseG1245Frozen_(s);qboPhaseG1245Inventory_(s);
 if(s.serviceRetryResumeV1246)throw Error('V1246_ALREADY_RESUMED_INSPECT_AUDIT');
 if(s.status!=='BUILD_CANDIDATE_ROWS'||s.candidateCursor!==309||s.candidateCount!==683||s.rowCount!==124523||s.partitionCursor!==0||s.metadata.length!==309||s.error!=='Service error: Drive'||s.queueFileId||s.queueSha256)throw Error('V1246_SAVED_AUDIT_NOT_EXACT');
 if(ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()===C.HANDLER))throw Error('V1246_AUDIT_TRIGGER_ALREADY_ACTIVE');
 const sh=SpreadsheetApp.openById(s.workbookId).getSheetByName('Candidate_Rows');
 if(!sh||JSON.stringify(sh.getRange(1,1,1,4).getValues()[0])!==JSON.stringify(['Partition','CandidateIndex','ObservationId','RowJSON'])||sh.getLastRow()<s.rowCount+1)throw Error('V1246_PRIVATE_AUDIT_SHAPE_CHANGED');
 // Extra rows can be an uncheckpointed write from the interrupted work unit.
 // Existing worker overwrites that range at the same durable rowCount before committing.
 const record={version:'1.5.246',resumedAt:new Date().toISOString(),candidateCursor:s.candidateCursor,rowCount:s.rowCount,priorError:s.error,priorAttemptPosition:s.lastAttemptPosition||'',priorAttemptsAtPosition:Number(s.attemptsAtPosition||0),priorPrivateCheckpointSha256:qboNativeCdcSha256_(ctx.file.getBlob().getDataAsString('UTF-8')),globalCheckpointModified:false};
 const raw=JSON.stringify(record);let evidence=qboPhaseG1245File_(ctx.folder,'service_retry_resume_v1246.json');if(evidence){if(evidence.getBlob().getDataAsString('UTF-8')!==raw)throw Error('V1246_EXISTING_RESUME_EVIDENCE_REVIEW_REQUIRED');}else evidence=ctx.folder.createFile('service_retry_resume_v1246.json',raw,'application/json');if(evidence.getBlob().getDataAsString('UTF-8')!==raw)throw Error('V1246_RESUME_EVIDENCE_READBACK_FAILED');
 qboPhaseG1245Frozen_(s);s.serviceRetryResumeV1246={resumedAt:record.resumedAt,evidenceFileId:evidence.getId(),evidenceSha256:qboNativeCdcSha256_(raw)};s.lastAttemptPosition='';s.attemptsAtPosition=0;qboPhaseG1245Persist_(ctx.file,s);
 ScriptApp.newTrigger(C.HANDLER).timeBased().everyMinutes(1).create();
 const out={version:'1.5.246',status:'AUDIT_TRIGGER_REINSTALLED',candidateCursor:s.candidateCursor,candidateCount:s.candidateCount,rowCount:s.rowCount,globalCheckpointModified:false,existingAuditPreserved:true,newScriptProperties:0,retryLimitAtUnchangedPosition:3};qboPhaseG1245Log_('RESUMED',out);return out;
 });}
