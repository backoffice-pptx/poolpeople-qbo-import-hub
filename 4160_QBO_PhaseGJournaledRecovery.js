/** App 50 v1.5.245 (checkpoint remains v1.5.231). Audit-bound counter correction and journaled recovery.
 * One manifest journal commits counters/token together. Only journal-owned tail
 * ranges can be retried. Does not clear/rewrite committed partition ranges. */
const QBO_PHASE_G_RECOVERY_V1231_=Object.freeze({VERSION:'1.5.231',HANDLER:'qboPhaseGJournaledV1231Continuation_',AUDIT_KEY:'QBO_PHASE_G_COMMITTED_AUDIT_V1230_STATE',GLOBAL:'QBO_PHASE_G_GLOBAL_TIE_V1219_STATE',GLOBAL_HASH:'7356ce969fddc4c62526f89bcf387b8953c7a78bb61d317d01d3342aadff48c8',AUDIT_RUN:'PHASE_G_COMMITTED_AUDIT_V1230|5dd1195c-1d2b-4cec-ab8d-8b6a1f9fae34',AUDIT_WB:'1DPyxkECiFOTuE06tF4Hhnp0Lhd_W33jtim8PGEdk_7k',PARTITIONS_PER_CALL:64,RUNTIME_MS:90000,FIELDS:['EntityType','EntityId','ObservedAt','ObservationId','SourceType','SourceRunId','SourceUnitId','PayloadOrdinal','SourceOperation','AdmissionStatus']});
function qboPhaseG1231Log_(kind,s){console.log('[PHASE G JOURNALED V1231] | '+kind+' | '+JSON.stringify(s));}
function qboPhaseG1231OldTriggers_(){return ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='qboPhaseGGlobalEqualTimeV1219Continuation_';});}
function qboPhaseG1231Schedule_(){const C=QBO_PHASE_G_RECOVERY_V1231_;ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()===C.HANDLER)ScriptApp.deleteTrigger(t);});ScriptApp.newTrigger(C.HANDLER).timeBased().after(60000).create();}
function qboPhaseG1231Source_(it,requiredBase){
 if(!it.hasNext())throw new Error('V1231_NO_MANIFEST');const mf=it.next(),name=mf.getName();if(!/\.manifest\.json$/.test(name))throw new Error('V1231_MANIFEST_NAME');const base=name.replace(/\.manifest\.json$/,'');if(requiredBase&&base!==requiredBase)throw new Error('V1231_MANIFEST_BOUNDARY_CHANGED');
 const folders=qboObsIndexV175ResolveFolders_(),sf=qboPhaseG1217Single_(folders.shards,base+'.json'),lf=qboPhaseG1217Single_(folders.lookup,base+'.lookup.json'),m=qboObsIndexV192ReadJson_(mf.getId()),body=qboObsIndexV192ReadJson_(sf.getId()),lk=qboObsIndexV192ReadJson_(lf.getId());qboPhaseG1217VerifyTriplet_(m,body,lk,mf,sf,lf);
 const records=body.stableBody.records||[],delta=qboPhaseG1220AdmissionCounts_(records),buckets=Object.create(null),seen=Object.create(null),C=QBO_PHASE_G_RECOVERY_V1231_;
 records.forEach(function(r){const row=C.FIELDS.map(function(k){return String(r[k]||'');});if(!row[3]||seen[row[3]])throw new Error('V1231_SOURCE_ID_INVALID');seen[row[3]]=true;const part=qboPhaseG1219Hash_(row[0]+'\u001f'+row[1])%64;(buckets[part]||(buckets[part]=[])).push(row);});
 return {base:base,manifestId:mf.getId(),shardHash:body.shardHash,delta:delta,buckets:buckets,nextToken:it.getContinuationToken()};
}
function recoverQboPhaseGFromCertifiedAuditV1231(){
 const C=QBO_PHASE_G_RECOVERY_V1231_,p=PropertiesService.getScriptProperties(),lock=LockService.getUserLock();if(!lock.tryLock(1000))throw new Error('V1231_BUSY');
 try{
  const raw=p.getProperty(C.GLOBAL),prior=JSON.parse(raw||'null');if(prior&&prior.journaledRecoveryV1231)throw new Error('V1231_ALREADY_ACTIVATED_USE_CHECKPOINT');
  const s=qboPhaseG1229Guard_(raw);if(qboStateCaptureAuditSha256_(raw)!==C.GLOBAL_HASH||qboPhaseG1231OldTriggers_().length)throw new Error('V1231_OLD_BOUNDARY_OR_TRIGGER_CHANGED');
  const a=JSON.parse(p.getProperty(C.AUDIT_KEY)||'null');if(!a||a.status!=='COMPLETE_AUDIT_FINDINGS'||a.runId!==C.AUDIT_RUN||a.workbookId!==C.AUDIT_WB||a.globalHash!==C.GLOBAL_HASH||a.manifestCursor!==1735||a.manifestCount!==1735||a.partitionCursor!==64||a.rowCount!==405205||a.admitted!==405177||a.exception!==28||a.blocked!==0||a.differenceRows!==0||JSON.stringify(a.resultTotals)!==JSON.stringify([405205,405205,405205,0,0,0,0,0])||a.sourceCountsMatchCheckpoint!==false||a.recoveryAuthorized!==false||a.error!=='')throw new Error('V1231_AUDIT_NOT_EXACT');
  const aw=SpreadsheetApp.openById(a.workbookId),wb=SpreadsheetApp.openById(s.workbookId),es=aw.getSheetByName('Expected_Rows'),rs=aw.getSheetByName('Partition_Results'),ds=aw.getSheetByName('Differences');if(!es||!rs||!ds||es.getLastRow()!==405206||ds.getLastRow()!==1)throw new Error('V1231_AUDIT_SHEETS_CHANGED');
  // Revalidate every current partition against sorted source-derived audit rows.
  let offset=0;for(let part=0;part<64;part++){
   const sh=wb.getSheetByName(qboPhaseG1219PartName_(part)),n=a.partitionCounts[part];if(!sh||sh.getLastRow()!==n+1||JSON.stringify(sh.getRange(1,1,1,10).getValues()[0])!==JSON.stringify(C.FIELDS))throw new Error('V1231_PARTITION_SHAPE '+part);
   const expected=n?es.getRange(offset+2,1,n,4).getValues():[],actual=n?sh.getRange(2,1,n,10).getValues():[];if(expected.some(function(r){return Number(r[0])!==part;}))throw new Error('V1231_AUDIT_SORT_CHANGED');const result=qboPhaseG1230Compare_(expected,actual);
   if(result.differences.length||JSON.stringify(result.totals)!==JSON.stringify([n,n,n,0,0,0,0,0])||JSON.stringify(rs.getRange(part+2,1,1,10).getValues()[0])!==JSON.stringify([part,n,n,n,0,0,0,0,0,'EXACT']))throw new Error('V1231_PARTITION_NO_LONGER_EXACT '+part);offset+=n;
  }if(offset!==405205)throw new Error('V1231_AUDIT_TOTAL_CHANGED');
  const source=qboPhaseG1231Source_(DriveApp.continueFileIterator(String(s.iteratorToken)),s.inFlightManifestBase);if(source.delta.total!==250||source.delta.admitted!==250||source.delta.exception||source.delta.blocked)throw new Error('V1231_INFLIGHT_SOURCE_CHANGED');
  if(p.getProperty(C.GLOBAL)!==raw||qboPhaseG1231OldTriggers_().length)throw new Error('V1231_GLOBAL_CHANGED_DURING_GUARDS');
  s.version=C.VERSION;s.observationCount=405205;s.admittedCount=405177;
  s.journaledRecoveryV1231={auditRunId:a.runId,auditWorkbookId:a.workbookId,originalGlobalHash:C.GLOBAL_HASH,originalObservationCount:405455,originalAdmittedCount:405427,correctedObservationCount:405205,correctedAdmittedCount:405177,activatedAt:new Date().toISOString(),firstManifestBase:source.base,firstManifestCommitted:false,continueAfterFirst:false,partitionRows:a.partitionCounts.slice()};
  s.continuationTriggerId='';s.writeJournalV1231=null;
  // Atomic global checkpoint update: correction + recovery provenance together.
  p.setProperty(C.GLOBAL,JSON.stringify(s));qboPhaseG1231Log_('COUNTERS_CORRECTED',qboPhaseG1231Public_(s));qboPhaseG1231Schedule_();return qboPhaseG1231Public_(s);
 }finally{lock.releaseLock();}
}
function inspectQboPhaseGJournaledRecoveryV1231(){const s=JSON.parse(PropertiesService.getScriptProperties().getProperty(QBO_PHASE_G_RECOVERY_V1231_.GLOBAL)||'null');const out=s?qboPhaseG1231Public_(s):null;if(out)out.continuationTriggers=ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()===QBO_PHASE_G_RECOVERY_V1231_.HANDLER;}).map(function(t){return {handler:t.getHandlerFunction(),triggerId:t.getUniqueId()};});qboPhaseG1231Log_('CHECKPOINT',out);return out;}
function continueQboPhaseGJournaledRecoveryV1231(){return qboPhaseG1231Worker_(true);}
function qboPhaseGJournaledV1231Continuation_(){return qboPhaseG1231Worker_(false);}
function qboPhaseG1231Public_(s){const j=s.writeJournalV1231?Object.assign({},s.writeJournalV1231):null;if(j){j.nextIteratorTokenPresent=!!j.nextToken;delete j.nextToken;}return Object.assign(qboPhaseG1219Public_(s),{journaledRecoveryV1231:s.journaledRecoveryV1231||null,writeJournalV1231:j});}
function qboPhaseG1231Require_(s){
 const r=s&&s.journaledRecoveryV1231;if(!r||s.version!=='1.5.231'||s.runId!=='PHASE_G_GLOBAL_TIE_V1219|f8717a54-3a18-476a-8fa0-4f27a8c03f92'||s.workbookId!=='1VmeTHHViWSW981U82cWikbZrUT_aiymh2LVDWtUknnI'||r.auditRunId!==QBO_PHASE_G_RECOVERY_V1231_.AUDIT_RUN||r.originalGlobalHash!==QBO_PHASE_G_RECOVERY_V1231_.GLOBAL_HASH||qboPhaseG1231OldTriggers_().length)throw new Error('V1231_RECOVERY_STATE_OR_OLD_TRIGGER_INVALID');
}
function qboPhaseG1231CheckTail_(existing,expected){
 if(existing.length!==expected.length)throw new Error('V1231_TAIL_LENGTH');existing.forEach(function(row,i){const value=row.map(function(v){return String(v);});if(value.every(function(v){return v==='';}))return;if(JSON.stringify(value)!==JSON.stringify(expected[i]))throw new Error('V1231_TAIL_CONFLICT '+i);});
}
function qboPhaseG1231Worker_(manual){
 const C=QBO_PHASE_G_RECOVERY_V1231_,p=PropertiesService.getScriptProperties(),started=Date.now(),lock=LockService.getUserLock();if(!lock.tryLock(1000))throw new Error('V1231_BUSY');
 try{
  let raw=p.getProperty(C.GLOBAL),s=JSON.parse(raw||'null');qboPhaseG1231Require_(s);qboPhaseG1219RequireAuthority_();
  if(s.status==='COMPLETE_GLOBAL_EQUAL_TIME_DIAGNOSTIC')return qboPhaseG1231Public_(s);
  const r=s.journaledRecoveryV1231;if(r.firstManifestCommitted&&!r.continueAfterFirst){if(!manual){qboPhaseG1231Log_('FIRST_MANIFEST_REVIEW_REQUIRED',qboPhaseG1231Public_(s));return qboPhaseG1231Public_(s);}r.continueAfterFirst=true;p.setProperty(C.GLOBAL,JSON.stringify(s));raw=p.getProperty(C.GLOBAL);}
  const wb=SpreadsheetApp.openById(s.workbookId);
  if(s.status==='BUILDING_GLOBAL_PARTITIONS'){
   const it=s.explicitManifestQueueV1245?qboPhaseG1245Iterator_(s):DriveApp.continueFileIterator(String(s.iteratorToken));
   if(!it.hasNext()){
    const old=QBO_PHASE_G_GLOBAL_TIE_V1219_;if(s.manifestCursor!==old.EXPECTED_MANIFESTS||s.observationCount!==old.EXPECTED_LOGICAL||s.admittedCount!==old.EXPECTED_ADMITTED||s.evidenceExceptionCount!==old.EXPECTED_EXCEPTION||s.blockedCount!==old.EXPECTED_BLOCKED)throw new Error('V1231_BUILD_FINAL_RECONCILIATION');
    s.status='SCANNING_GLOBAL_PARTITIONS';s.partitionCursor=0;s.iteratorToken='';s.lastProgressAt=new Date().toISOString();p.setProperty(C.GLOBAL,JSON.stringify(s));
   }else{
    const source=qboPhaseG1231Source_(it,s.writeJournalV1231?s.writeJournalV1231.base:(!r.firstManifestCommitted?r.firstManifestBase:''));if(s.explicitManifestQueueV1245)qboPhaseG1245RequireSource_(it.expectedSource,source);let j=s.writeJournalV1231;
    if(!j){
     const slots=Object.keys(source.buckets).map(Number).sort(function(a,b){return a-b;}).map(function(part){if(!r.partitionRows||!Number.isInteger(r.partitionRows[part])||r.partitionRows[part]<0)throw new Error('V1231_PARTITION_OFFSET_INVALID');return {part:part,start:r.partitionRows[part]+2,count:source.buckets[part].length};});
     j={base:source.base,manifestId:source.manifestId,shardHash:source.shardHash,manifestCursor:s.manifestCursor,observationCount:s.observationCount,admittedCount:s.admittedCount,exceptionCount:s.evidenceExceptionCount,blockedCount:s.blockedCount,nextToken:source.nextToken,delta:source.delta,slotCursor:0,slots:slots};s.writeJournalV1231=j;s.inFlightManifestBase=source.base;s.inFlightObservationCount=source.delta.total;
     if(p.getProperty(C.GLOBAL)!==raw)throw new Error('V1231_CHECKPOINT_RACE');p.setProperty(C.GLOBAL,JSON.stringify(s));raw=p.getProperty(C.GLOBAL);
    }
    if(j.base!==source.base||j.manifestId!==source.manifestId||j.shardHash!==source.shardHash||j.manifestCursor!==s.manifestCursor||j.observationCount!==s.observationCount||j.admittedCount!==s.admittedCount||j.exceptionCount!==s.evidenceExceptionCount||j.blockedCount!==s.blockedCount||JSON.stringify(j.delta)!==JSON.stringify(source.delta))throw new Error('V1231_JOURNAL_SOURCE_OR_COUNTER_CHANGED');
    let n=0;while(j.slotCursor<j.slots.length&&n<C.PARTITIONS_PER_CALL&&Date.now()-started<C.RUNTIME_MS){
     const slot=j.slots[j.slotCursor],sh=wb.getSheetByName(qboPhaseG1219PartName_(slot.part)),rows=source.buckets[slot.part],end=slot.start+slot.count-1;if(!sh||JSON.stringify(sh.getRange(1,1,1,10).getValues()[0])!==JSON.stringify(C.FIELDS))throw new Error('V1231_PARTITION_HEADER '+slot.part);if(!rows||rows.length!==slot.count||sh.getLastRow()>end||sh.getLastRow()<slot.start-1)throw new Error('V1231_PARTITION_TAIL_SHAPE');
     if(sh.getMaxRows()<end)sh.insertRowsAfter(sh.getMaxRows(),end-sh.getMaxRows());const range=sh.getRange(slot.start,1,slot.count,10);qboPhaseG1231CheckTail_(range.getValues(),rows);range.setValues(rows);SpreadsheetApp.flush();if(JSON.stringify(range.getValues().map(function(row){return row.map(String);}))!==JSON.stringify(rows))throw new Error('V1231_WRITE_VERIFY');
     if(p.getProperty(C.GLOBAL)!==raw)throw new Error('V1231_CHECKPOINT_RACE');j.slotCursor++;p.setProperty(C.GLOBAL,JSON.stringify(s));raw=p.getProperty(C.GLOBAL);n++;
    }
    if(j.slotCursor===j.slots.length){
     // All ranges are durable; counters, cursor, token and journal clearance commit together.
     j.slots.forEach(function(slot){r.partitionRows[slot.part]+=slot.count;});s.observationCount=j.observationCount+j.delta.total;s.admittedCount=j.admittedCount+j.delta.admitted;s.evidenceExceptionCount=j.exceptionCount+j.delta.exception;s.blockedCount=j.blockedCount+j.delta.blocked;s.manifestCursor=j.manifestCursor+1;s.iteratorToken=j.nextToken;s.writeJournalV1231=null;s.inFlightManifestBase='';s.inFlightObservationCount=0;s.error='';s.lastProgressAt=new Date().toISOString();
     if(!r.firstManifestCommitted){r.firstManifestCommitted=true;if(s.manifestCursor!==1736||s.observationCount!==405455||s.admittedCount!==405427||s.evidenceExceptionCount!==28||s.blockedCount!==0)throw new Error('V1231_FIRST_COMMIT_TOTALS');}
     p.setProperty(C.GLOBAL,JSON.stringify(s));qboPhaseG1231Log_('MANIFEST_COMMITTED',qboPhaseG1231Public_(s));
    }
   }
  }else if(s.status==='SCANNING_GLOBAL_PARTITIONS'){
   const sh=wb.getSheetByName(qboPhaseG1219PartName_(s.partitionCursor)),lr=sh.getLastRow(),rows=lr>1?sh.getRange(2,1,lr-1,10).getValues():[];rows.sort(function(a,b){for(const i of [0,1,2,3]){const x=String(a[i]),y=String(b[i]);if(x<y)return -1;if(x>y)return 1;}return 0;});
   let i=0;while(i<rows.length){let k=i+1;while(k<rows.length&&String(rows[k][0])===String(rows[i][0])&&String(rows[k][1])===String(rows[i][1])&&String(rows[k][2])===String(rows[i][2]))k++;if(k-i>1)qboPhaseG1219Tie_(s,rows.slice(i,k));i=k;}
   s.partitionCursor++;s.lastProgressAt=new Date().toISOString();if(s.partitionCursor===64){s.status='COMPLETE_GLOBAL_EQUAL_TIME_DIAGNOSTIC';s.completedAt=new Date().toISOString();}p.setProperty(C.GLOBAL,JSON.stringify(s));
  }else throw new Error('V1231_STATUS_INVALID '+s.status);
  if(s.status==='COMPLETE_GLOBAL_EQUAL_TIME_DIAGNOSTIC'){qboPhaseG1231Log_('COMPLETE',qboPhaseG1231Public_(s));return qboPhaseG1231Public_(s);}
  if(r.firstManifestCommitted&&!r.continueAfterFirst){qboPhaseG1231Log_('FIRST_MANIFEST_VERIFIED_PAUSED',qboPhaseG1231Public_(s));return qboPhaseG1231Public_(s);}
  qboPhaseG1231Log_('PROGRESS',qboPhaseG1231Public_(s));qboPhaseG1231Schedule_();return qboPhaseG1231Public_(s);
 }catch(e){qboPhaseG1231Log_('STOPPED',{error:String(e&&e.message||e),durableJournalPreserved:true});throw e;}finally{lock.releaseLock();}
}
