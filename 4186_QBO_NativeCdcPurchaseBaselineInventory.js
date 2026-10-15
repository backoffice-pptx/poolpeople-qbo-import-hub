/** v1.5.239. Read-only baseline inventory; no certification or recovery writes. */
function inspectQboNativeCdcPurchaseBaselinesV1239(){
 if(!qboNativeCdcIsPaused_())throw new Error('V1239_ACQUISITION_MUST_BE_PAUSED');
 const book=getQboStateCaptureSpreadsheet_(),sheet=book.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);if(!sheet)throw new Error('V1239_SOURCE_REGISTRY_MISSING');
 const data=sheet.getDataRange().getValues(),headers=data.shift()||[],index=Object.create(null);headers.forEach(function(h,i){index[String(h)]=i;});
 ['SourceId','SourceAcquisitionType','SourceRunId','ExportKey','ObservationCompletedAt','MasterBackupFileId','SourceScopeComplete','SourceStatus'].forEach(function(k){if(index[k]==null)throw new Error('V1239_HEADER_MISSING '+k);});
 const cutoff=Date.parse('2026-09-14T10:23:54.152Z'),candidates=[];let purchaseSources=0;
 data.forEach(function(row){if(String(row[index.ExportKey])!=='PURCHASES')return;purchaseSources++;const at=row[index.ObservationCompletedAt],time=at instanceof Date?at.getTime():Date.parse(at);if(!isFinite(time)||time>cutoff)return;const out={};['SourceId','SourceAcquisitionType','SourceRunId','ObservationStartedAt','ObservationCompletedAt','MasterBackupFileId','MasterBackupFileName','SourceLineageBasis','SourceScopeType','SourceScopeComplete','SourceStatus','ObservationCount'].forEach(function(k){if(index[k]!=null)out[k]=row[index[k]];});out.completedAtMs=time;candidates.push(out);});
 candidates.sort(function(a,b){return b.completedAtMs-a.completedAtMs;});const latest=candidates.slice(0,10);
 latest.slice(0,3).forEach(function(candidate){if(!candidate.MasterBackupFileId){candidate.inspectionError='BACKUP_ID_MISSING';return;}try{
  const file=DriveApp.getFileById(String(candidate.MasterBackupFileId)),snapshot=SpreadsheetApp.openById(file.getId()),parent=snapshot.getSheetByName('QBO_Purchases');
  candidate.backupCreatedAt=file.getDateCreated().toISOString();candidate.backupLastUpdatedAt=file.getLastUpdated().toISOString();candidate.actualBackupName=file.getName();
  if(!parent)throw new Error('PURCHASE_PARENT_SHEET_MISSING');const h=parent.getRange(1,1,1,parent.getLastColumn()).getValues()[0].map(String),idColumn=h.indexOf('Id');if(idColumn<0)throw new Error('PURCHASE_ID_HEADER_MISSING');
  const ids=parent.getLastRow()>1?parent.getRange(2,idColumn+1,parent.getLastRow()-1,1).getDisplayValues():[],seen=Object.create(null);let blank=0,duplicates=0;ids.forEach(function(row){const id=String(row[0]).trim();if(!id){blank++;return;}if(seen[id])duplicates++;seen[id]=true;});
  candidate.parentRows=ids.length;candidate.uniquePurchaseIds=Object.keys(seen).length;candidate.blankIdRows=blank;candidate.duplicateIdOccurrences=duplicates;candidate.sortedIdSha256=qboNativeCdcSha256_(Object.keys(seen).sort().join('\n'));candidate.baselineTrusted=false;
 }catch(e){candidate.inspectionError=String(e.message||e);}});
 const out={version:'1.5.239',mode:'READ_ONLY',cutoffUTC:new Date(cutoff).toISOString(),sourceRegistryWorkbookId:book.getId(),purchaseSourceCount:purchaseSources,preGapCandidateCount:candidates.length,candidates:latest,baselineTrustCertified:false,deletionCoverageCertified:false,recoveryAuthorized:false};
 console.log('[NATIVE CDC PURCHASE V1239] | BASELINE_INVENTORY | '+JSON.stringify(out));return out;
}
