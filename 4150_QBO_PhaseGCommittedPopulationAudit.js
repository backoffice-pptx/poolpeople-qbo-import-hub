/** App 50 v1.5.230. Source-derived audit. Writes ONLY a new private audit workbook,
 * its own checkpoint and its own continuation triggers. Never repairs Phase G. */
const QBO_PHASE_G_AUDIT_V1230_=Object.freeze({KEY:'QBO_PHASE_G_COMMITTED_AUDIT_V1230_STATE',HANDLER:'qboPhaseGCommittedAuditV1230Continuation_',GLOBAL:'QBO_PHASE_G_GLOBAL_TIE_V1219_STATE',FIELDS:['EntityType','EntityId','ObservedAt','ObservationId','SourceType','SourceRunId','SourceUnitId','PayloadOrdinal','SourceOperation','AdmissionStatus'],MAX_MANIFESTS:12,RUNTIME_MS:90000});
function qboPhaseG1230Log_(type,v){console.log('[PHASE G COMMITTED AUDIT V1230] | '+type+' | '+JSON.stringify(v));}
function qboPhaseG1230Boundary_(){
 const C=QBO_PHASE_G_AUDIT_V1230_,raw=PropertiesService.getScriptProperties().getProperty(C.GLOBAL),s=qboPhaseG1229Guard_(raw);
 if(ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='qboPhaseGGlobalEqualTimeV1219Continuation_';}))throw new Error('V1230_PHASE_G_TRIGGER_PRESENT');
 return {raw:raw,s:s,hash:qboStateCaptureAuditSha256_(raw)};
}
function startQboPhaseGCommittedPopulationAuditV1230(){
 const C=QBO_PHASE_G_AUDIT_V1230_,p=PropertiesService.getScriptProperties();if(p.getProperty(C.KEY))throw new Error('V1230_AUDIT_ALREADY_EXISTS_USE_CONTINUE');
 const boundary=qboPhaseG1230Boundary_(),folders=qboObsIndexV175ResolveFolders_(),all=[],seen=Object.create(null),remaining=Object.create(null),rit=DriveApp.continueFileIterator(String(boundary.s.iteratorToken));
 if(!rit.hasNext())throw new Error('V1230_REMAINING_EMPTY');
 let first=true;while(rit.hasNext()){const f=rit.next(),id=f.getId();if(remaining[id])throw new Error('V1230_REMAINING_DUPLICATE');remaining[id]=true;if(first){if(f.getName()!==boundary.s.inFlightManifestBase+'.manifest.json')throw new Error('V1230_ITERATOR_BOUNDARY_CHANGED');first=false;}}
 const it=folders.manifests.getFiles();while(it.hasNext()){const f=it.next(),id=f.getId(),name=f.getName();if(!/\.manifest\.json$/.test(name)||seen[id])throw new Error('V1230_MANIFEST_INVENTORY_INVALID');seen[id]=true;all.push([id,name,remaining[id]?'REMAINING':'COMMITTED']);}
 if(all.length!==2418||all.filter(function(r){return r[2]==='COMMITTED';}).length!==1735||Object.keys(remaining).some(function(id){return !seen[id];}))throw new Error('V1230_MEMBERSHIP_NOT_EXACT');
 // Membership is set subtraction from the stored iterator, NOT filename order.
 const committed=all.filter(function(r){return r[2]==='COMMITTED';}).sort(function(a,b){return a[0]<b[0]?-1:a[0]>b[0]?1:0;});
 if(qboPhaseG1230Boundary_().hash!==boundary.hash)throw new Error('V1230_BOUNDARY_CHANGED');
 const wb=SpreadsheetApp.create('QBO Phase G Committed Population Audit v1.5.230 '+new Date().toISOString()),ms=wb.getSheets()[0];ms.setName('Committed_Manifest_Set');ms.getRange(1,1,1,3).setValues([['ManifestId','ManifestName','Membership']]);qboPhaseG1230Capacity_(ms,committed.length+1);ms.getRange(2,1,committed.length,3).setValues(committed);
 const es=wb.insertSheet('Expected_Rows');if(es.getMaxColumns()>4)es.deleteColumns(5,es.getMaxColumns()-4);es.getRange(1,1,1,4).setValues([['Partition','ObservationId','RowJSON','ManifestId']]);
 const rs=wb.insertSheet('Partition_Results');rs.getRange(1,1,1,10).setValues([['Partition','ExpectedRows','ActualRows','ExactRows','MissingRows','UnexpectedRows','MismatchedRows','DuplicateExpectedRows','DuplicateActualRows','Status']]);
 const ds=wb.insertSheet('Differences');ds.getRange(1,1,1,6).setValues([['Partition','Kind','ObservationId','ExpectedRowJSON','ActualRowJSON','Multiplicity']]);
 const s={version:'1.5.230',runId:'PHASE_G_COMMITTED_AUDIT_V1230|'+Utilities.getUuid(),status:'BUILD_EXPECTED',workbookId:wb.getId(),globalHash:boundary.hash,manifestCursor:0,manifestCount:committed.length,rowCount:0,admitted:0,exception:0,blocked:0,partitionCounts:Array(64).fill(0),partitionCursor:0,differenceRows:0,resultTotals:Array(8).fill(0),startedAt:new Date().toISOString(),error:'',recoveryAuthorized:false};
 p.setProperty(C.KEY,JSON.stringify(s));qboPhaseG1230Log_('STARTED',s);qboPhaseG1230Schedule_();return s;
}
function continueQboPhaseGCommittedPopulationAuditV1230(){return qboPhaseG1230Worker_();}
function qboPhaseGCommittedAuditV1230Continuation_(){return qboPhaseG1230Worker_();}
function inspectQboPhaseGCommittedPopulationAuditV1230(){const s=JSON.parse(PropertiesService.getScriptProperties().getProperty(QBO_PHASE_G_AUDIT_V1230_.KEY)||'null');qboPhaseG1230Log_('CHECKPOINT',s);return s;}
function qboPhaseG1230Schedule_(){const C=QBO_PHASE_G_AUDIT_V1230_;ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()===C.HANDLER)ScriptApp.deleteTrigger(t);});ScriptApp.newTrigger(C.HANDLER).timeBased().after(60000).create();}
function qboPhaseG1230Capacity_(sh,last){if(sh.getMaxRows()<last)sh.insertRowsAfter(sh.getMaxRows(),last-sh.getMaxRows());}
function qboPhaseG1230Worker_(){
 const C=QBO_PHASE_G_AUDIT_V1230_,p=PropertiesService.getScriptProperties(),s=JSON.parse(p.getProperty(C.KEY)||'null');if(!s)throw new Error('V1230_START_REQUIRED');
 const lock=LockService.getUserLock();if(!lock.tryLock(1000))throw new Error('V1230_AUDIT_BUSY');
 try{
  const b=qboPhaseG1230Boundary_();if(b.hash!==s.globalHash)throw new Error('V1230_GLOBAL_CHECKPOINT_CHANGED');if(s.status==='COMPLETE_AUDIT_FINDINGS')return s;
  const wb=SpreadsheetApp.openById(s.workbookId);if(wb.getId()===b.s.workbookId)throw new Error('V1230_WORKBOOK_NOT_ISOLATED');
  if(s.status==='BUILD_EXPECTED'){
   const folders=qboObsIndexV175ResolveFolders_(),ms=wb.getSheetByName('Committed_Manifest_Set'),es=wb.getSheetByName('Expected_Rows'),started=Date.now();let n=0;
   while(s.manifestCursor<s.manifestCount&&n<C.MAX_MANIFESTS&&Date.now()-started<C.RUNTIME_MS){
    const item=ms.getRange(s.manifestCursor+2,1,1,3).getValues()[0],mf=DriveApp.getFileById(String(item[0]));if(mf.getName()!==item[1]||item[2]!=='COMMITTED')throw new Error('V1230_FROZEN_MEMBERSHIP_CHANGED');
    const base=String(item[1]).replace(/\.manifest\.json$/,''),sf=qboPhaseG1217Single_(folders.shards,base+'.json'),lf=qboPhaseG1217Single_(folders.lookup,base+'.lookup.json'),m=qboObsIndexV192ReadJson_(mf.getId()),body=qboObsIndexV192ReadJson_(sf.getId()),lk=qboObsIndexV192ReadJson_(lf.getId());qboPhaseG1217VerifyTriplet_(m,body,lk,mf,sf,lf);
    const records=body.stableBody.records||[],delta=qboPhaseG1220AdmissionCounts_(records),counts=Array(64).fill(0),rows=records.map(function(r){const row=C.FIELDS.map(function(k){return String(r[k]||'');}),part=qboPhaseG1219Hash_(row[0]+'\u001f'+row[1])%64;if(!row[3])throw new Error('V1230_EMPTY_SOURCE_ID');counts[part]++;return [part,row[3],JSON.stringify(row),String(item[0])];});
    if(rows.length){qboPhaseG1230Capacity_(es,s.rowCount+rows.length+1);es.getRange(s.rowCount+2,1,rows.length,4).setValues(rows);}SpreadsheetApp.flush();
    if(qboPhaseG1230Boundary_().hash!==s.globalHash)throw new Error('V1230_GLOBAL_CHANGED_DURING_BUILD');
    // Retry overwrites only this uncommitted audit range. No clear-and-rewrite.
    s.rowCount+=rows.length;s.admitted+=delta.admitted;s.exception+=delta.exception;s.blocked+=delta.blocked;counts.forEach(function(v,i){s.partitionCounts[i]+=v;});s.manifestCursor++;n++;s.error='';p.setProperty(C.KEY,JSON.stringify(s));
   }
   if(s.manifestCursor===s.manifestCount){s.status='SORT_EXPECTED';p.setProperty(C.KEY,JSON.stringify(s));}
  }else if(s.status==='SORT_EXPECTED'){
   const es=wb.getSheetByName('Expected_Rows');if(es.getLastRow()!==s.rowCount+1)throw new Error('V1230_EXPECTED_ROWCOUNT_CHANGED');if(s.rowCount)es.getRange(2,1,s.rowCount,4).sort([{column:1,ascending:true},{column:2,ascending:true}]);SpreadsheetApp.flush();s.status='COMPARE_PARTITIONS';p.setProperty(C.KEY,JSON.stringify(s));
  }else if(s.status==='COMPARE_PARTITIONS'){
   const part=s.partitionCursor,es=wb.getSheetByName('Expected_Rows'),offset=s.partitionCounts.slice(0,part).reduce(function(a,v){return a+v;},0),count=s.partitionCounts[part],expected=count?es.getRange(offset+2,1,count,4).getValues():[];
   if(expected.some(function(row){return Number(row[0])!==part;}))throw new Error('V1230_EXPECTED_SORT_BOUNDARY');
   const old=SpreadsheetApp.openById(b.s.workbookId),sh=old.getSheetByName('P_'+String(part).padStart(2,'0'));if(!sh||JSON.stringify(sh.getRange(1,1,1,10).getValues()[0])!==JSON.stringify(C.FIELDS))throw new Error('V1230_ACTUAL_HEADER_CHANGED');
   const lr=sh.getLastRow(),actual=lr>1?sh.getRange(2,1,lr-1,10).getValues():[],result=qboPhaseG1230Compare_(expected,actual),ds=wb.getSheetByName('Differences');
   const differences=result.differences.map(function(d){return [part].concat(d);});if(differences.length){qboPhaseG1230Capacity_(ds,s.differenceRows+differences.length+1);ds.getRange(s.differenceRows+2,1,differences.length,6).setValues(differences);}
   const vals=[part].concat(result.totals).concat([result.differences.length?'DIFFERENCES':'EXACT']);wb.getSheetByName('Partition_Results').getRange(part+2,1,1,10).setValues([vals]);SpreadsheetApp.flush();
   if(qboPhaseG1230Boundary_().hash!==s.globalHash)throw new Error('V1230_GLOBAL_CHANGED_DURING_COMPARE');
   s.differenceRows+=differences.length;result.totals.forEach(function(v,i){s.resultTotals[i]+=v;});s.partitionCursor++;if(s.partitionCursor===64)s.status='COMPLETE_AUDIT_FINDINGS';p.setProperty(C.KEY,JSON.stringify(s));qboPhaseG1230Log_('PARTITION_RESULT',{partition:part,totals:result.totals,differenceRows:differences.length});
  }else throw new Error('V1230_UNKNOWN_STATUS '+s.status);
  s.sourceCountsMatchCheckpoint=s.rowCount===405455&&s.admitted===405427&&s.exception===28&&s.blocked===0;s.recoveryAuthorized=false;s.updatedAt=new Date().toISOString();p.setProperty(C.KEY,JSON.stringify(s));qboPhaseG1230Log_(s.status==='COMPLETE_AUDIT_FINDINGS'?'COMPLETE':'PROGRESS',s);
  if(s.status!=='COMPLETE_AUDIT_FINDINGS')qboPhaseG1230Schedule_();return s;
 }catch(e){qboPhaseG1230Log_('STOPPED',{error:String(e&&e.message||e),checkpointPreserved:true,recoveryAuthorized:false});throw e;}finally{lock.releaseLock();}
}
function qboPhaseG1230Compare_(expected,actual){
 const em=Object.create(null),am=Object.create(null),diff=[],totals=[expected.length,actual.length,0,0,0,0,0,0];
 expected.forEach(function(r){const id=String(r[1]);(em[id]||(em[id]=[])).push(String(r[2]));});actual.forEach(function(row){const r=row.map(function(v){return String(v);}),id=r[3];(am[id]||(am[id]=[])).push(JSON.stringify(r));});
 const ids=Object.keys(em).concat(Object.keys(am).filter(function(id){return !Object.prototype.hasOwnProperty.call(em,id);})).sort();
 ids.forEach(function(id){const e=(em[id]||[]).slice().sort(),a=(am[id]||[]).slice().sort();totals[6]+=Math.max(0,e.length-1);totals[7]+=Math.max(0,a.length-1);
  if(e.length>1)diff.push(['DUPLICATE_EXPECTED',id,JSON.stringify(e),'',e.length]);if(a.length>1)diff.push(['DUPLICATE_ACTUAL',id,'',JSON.stringify(a),a.length]);
  const er=[],ar=[];let i=0,j=0;while(i<e.length&&j<a.length){if(e[i]===a[j]){totals[2]++;i++;j++;}else if(e[i]<a[j])er.push(e[i++]);else ar.push(a[j++]);}while(i<e.length)er.push(e[i++]);while(j<a.length)ar.push(a[j++]);
  const paired=Math.min(er.length,ar.length);totals[5]+=paired;for(let k=0;k<paired;k++)diff.push(['MISMATCHED',id,er[k],ar[k],1]);totals[3]+=er.length-paired;totals[4]+=ar.length-paired;
  for(let k=paired;k<er.length;k++)diff.push(['MISSING',id,er[k],'',1]);for(let k=paired;k<ar.length;k++)diff.push(['UNEXPECTED',id,'',ar[k],1]);
 });return {totals:totals,differences:diff};
}
