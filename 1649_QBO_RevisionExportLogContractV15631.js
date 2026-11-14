/** v1.5.631 shared append-only export-log contract. */
const QBO_REV631_TSD_LOG_HEADERS=Object.freeze(['Snapshot_Run_ID','Report_AsOf_DateTime','Period_Key','Period_Start','Period_End','Status','Row_Count','Change_Count','Error','Snapshot_Sequence']);
function qboRev631EnsureLogSchema_(sh,expected){
 if(!sh)throw Error('REV631_LOG_SHEET_MISSING');
 const old=expected.slice(0,-1);
 if(sh.getLastRow()===0){sh.getRange(1,1,1,expected.length).setValues([expected]);return;}
 const width=Math.max(sh.getLastColumn(),expected.length);
 const cells=sh.getRange(1,1,1,width).getValues()[0].map(x=>String(x||'').trim());
 const head=cells.slice(0,expected.length);
 const same=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
 if(same(head,expected)&&cells.slice(expected.length).every(x=>!x))return;
 if(same(head.slice(0,old.length),old)&&!head[old.length]&&cells.slice(expected.length).every(x=>!x)){
  // Never overwrite data in the new column, including historical rows.
  if(sh.getLastRow()>1){const v=sh.getRange(2,expected.length,sh.getLastRow()-1,1).getValues();if(v.some(x=>x[0]!==''&&x[0]!==null))throw Error('REV631_LEGACY_EXTRA_COLUMN_DATA');}
  sh.getRange(1,expected.length).setValue(expected[expected.length-1]);return;
 }
 throw Error('REV631_LOG_HEADER_DRIFT_'+sh.getName());
}
function qboRev631NextSequence_(ss,snapshotName,logName,periodKey,logHeaders){
 const log=ss.getSheetByName(logName);qboRev631EnsureLogSchema_(log,logHeaders);
 let max=0;
 const snap=ss.getSheetByName(snapshotName);
 if(snap&&snap.getLastRow()>1)snap.getRange(2,1,snap.getLastRow()-1,2).getValues().forEach(x=>{if(String(x[0])===periodKey)max=Math.max(max,Number(x[1])||0);});
 if(log.getLastRow()>1){const rows=log.getRange(2,1,log.getLastRow()-1,logHeaders.length).getValues(),p=logHeaders.indexOf('Period_Key'),q=logHeaders.indexOf('Snapshot_Sequence');rows.forEach(x=>{if(String(x[p])===periodKey)max=Math.max(max,Number(x[q])||0);});}
 return max+1;
}
