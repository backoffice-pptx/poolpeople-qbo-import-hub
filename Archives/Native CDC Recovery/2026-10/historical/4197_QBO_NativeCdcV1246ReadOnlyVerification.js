/** App 50 | V1246 | READ ONLY. No writes, API calls, or trigger changes. */
function inspectQboNativeCdcV1246ReadOnly() {
  const ctx=qboCdcProspectiveStateV1244_(),s=ctx.state,c=QBO_CDC_PROSPECTIVE_V1244_;
  if(s.status!=='HALTED_REQUIRES_REVIEW'||s.enabled!==false||!s.active||s.active.cycleId!=='9c9276b1-70cb-4fb5-930f-bb5e388c5312')throw Error('V1246_CHECKPOINT_NOT_EXPECTED_HALTED_CYCLE');
  const a=s.active,folder=DriveApp.getFolderById(a.folderId),out={version:'1.5.246',mode:'READ_ONLY',checkpointFileId:ctx.file.getId(),cycleId:a.cycleId,cycleFolderId:folder.getId(),cycleFolderName:folder.getName(),prospectiveRootFolderId:ctx.folder.getId(),cursor:a.cursor,expectedCompleted:17,results:[],failures:[],orphanFiles:[],routing:{},term:null,legacyPaused:qboNativeCdcIsPaused_(),watermark:s.prospectiveWatermark,ingestionAuthorized:s.ingestionAuthorized,historicalDeletionCoverageCertified:s.historicalDeletionCoverageCertified};
  if(a.cursor!==17||a.results.length!==17)throw Error('V1246_UNEXPECTED_CURSOR_OR_RESULTS');
  const seen={};
  a.results.forEach(function(r,i){
    const entity=c.ENTITIES[i],name='cdc_'+entity+'.json',item={index:i,entity:entity,expectedFileId:r.fileId,expectedSha256:r.sha256};
    try {
      if(r.entity!==entity)throw Error('CHECKPOINT_ENTITY_ORDER_MISMATCH');
      const matches=folder.getFilesByName(name);if(!matches.hasNext())throw Error('MISSING_NAMED_FILE');
      const f=matches.next();if(matches.hasNext())throw Error('DUPLICATE_NAMED_FILE');
      item.actualFileId=f.getId();item.sizeBytes=f.getSize();
      if(f.getId()!==r.fileId)throw Error('FILE_ID_MISMATCH');
      const raw=f.getBlob().getDataAsString('UTF-8');item.sha256=qboNativeCdcSha256_(raw);
      if(item.sha256!==r.sha256)throw Error('SHA256_MISMATCH');
      const e=JSON.parse(raw),v=qboCdcProspectiveValidateV1244_(e,a,entity);
      item.returnedRows=v.returnedRows;item.deletedRows=v.deletedRows;
      if(v.returnedRows!==r.returnedRows||v.deletedRows!==r.deletedRows)throw Error('COUNTS_MISMATCH');
      item.status='PASS';
    }catch(err){item.status='FAIL';item.error=String(err.message||err);out.failures.push({entity:entity,error:item.error});}
    seen[name]=true;out.results.push(item);
  });
  const term=folder.getFilesByName('cdc_Term.json'),termFiles=[];
  while(term.hasNext()){const f=term.next(),raw=f.getBlob().getDataAsString('UTF-8');termFiles.push({fileId:f.getId(),sizeBytes:f.getSize(),sha256:qboNativeCdcSha256_(raw),createdAt:f.getDateCreated().toISOString()});}
  out.term={fileCount:termFiles.length,files:termFiles};
  const iter=folder.getFiles();while(iter.hasNext()){const f=iter.next();if(!seen[f.getName()]&&f.getName()!=='cdc_Term.json')out.orphanFiles.push({name:f.getName(),fileId:f.getId(),sizeBytes:f.getSize()});}
  // Resolve existing governed routing only; never call get-or-create helper in read-only mode.
  const cfg=QBO_NATIVE_CDC_PRODUCTION,root=qboNativeCdcResolveEvidenceFolder_();
  out.routing={governedRootId:root.getId(),datePartitionEnabled:cfg.DATE_PARTITION_NEW_EVIDENCE,expectedUtcDate:Utilities.formatDate(new Date(a.windowEnd),'UTC','yyyy/MM/dd'),helper:'qboNativeCdcResolveRunParentFolder_',existingProspectiveRootId:ctx.folder.getId(),currentCycleFolderId:folder.getId()};
  out.verdict=out.failures.length?'FAIL_COMPLETED_EVIDENCE':termFiles.length!==1||termFiles[0].sizeBytes!==0?'REVIEW_TERM_STATE':'PASS_17_COMPLETED_TERM_EMPTY';
  console.log('[NATIVE CDC V1246] | READ_ONLY | '+JSON.stringify(out));return out;
}
