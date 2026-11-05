/** v1.5.248 — READ ONLY. Native CDC recovery preflight; no Drive writes or triggers. */
function inspectQboNativeCdcRecoveryPreflightV1248(){
 const c=QBO_CDC_PROSPECTIVE_V1244_, p=PropertiesService.getScriptProperties();
 const ptr=JSON.parse(p.getProperty(c.KEY)||'null');
 if(!ptr||!ptr.stateFileId)throw Error('V1248_POINTER_MISSING');
 const s=JSON.parse(DriveApp.getFileById(ptr.stateFileId).getBlob().getDataAsString('UTF-8'));
 const failures=[];
 const expect=(ok,reason)=>{if(!ok)failures.push(reason);};
 expect(s.version==='1.5.244','CHECKPOINT_VERSION');
 expect(s.enabled===false&&s.status==='HALTED_REQUIRES_REVIEW','NOT_HALTED');
 expect(s.ingestionAuthorized===false&&s.historicalDeletionCoverageCertified===false,'UNSAFE_AUTHORIZATION');
 expect(s.active&&s.active.cursor===17&&s.active.results.length===17,'CURSOR_CHANGED');
 expect(s.active&&s.active.cycleId==='9c9276b1-70cb-4fb5-930f-bb5e388c5312','CYCLE_CHANGED');
 expect(s.prospectiveWatermark==='2026-10-11T22:27:37.687Z','WATERMARK_CHANGED');
 const a=s.active, now=Date.now(), since=a&&Date.parse(a.changedSince);
 const ageDays=(now-since)/86400000;
 expect(Number.isFinite(since)&&since<=now&&ageDays<QBO_NATIVE_CDC_PRODUCTION.MAX_CDC_LOOKBACK_DAYS,'CDC_LOOKBACK_EXPIRED');
 const folder=a?DriveApp.getFolderById(a.folderId):null;
 const results=[];
 if(a&&folder){
  for(let i=0;i<a.results.length;i++){
   const r=a.results[i],expected=c.ENTITIES[i],f=DriveApp.getFileById(r.fileId),raw=f.getBlob().getDataAsString('UTF-8');
   const sha=qboNativeCdcSha256_(raw),valid=sha===r.sha256&&r.entity===expected&&f.getName()==='cdc_'+expected+'.json';
   if(!valid)failures.push('COMPLETED_FILE_'+i);
   results.push({entity:expected,valid:valid,fileId:r.fileId});
  }
 }
 const term=folder?qboCdcProspectiveFileV1244_(folder,'cdc_Term.json'):null;
 expect(!!term&&term.getSize()===0,'TERM_FAILURE_ARTIFACT_CHANGED');
 const phaseKey='QBO_PHASE_G_GLOBAL_TIE_V1219_STATE', phaseRaw=p.getProperty(phaseKey), phase=JSON.parse(phaseRaw||'null');
 expect(!!phase&&phase.status==='BUILDING_GLOBAL_PARTITIONS','PHASE_G_STATE_CHANGED');
 const triggers=ScriptApp.getProjectTriggers();
 const phaseTriggers=triggers.filter(t=>t.getHandlerFunction()==='qboPhaseGJournaledV1231Continuation_');
 expect(phaseTriggers.length===1,'PHASE_G_TRIGGER_CHANGED');
 expect(triggers.filter(t=>t.getHandlerFunction()===c.HANDLER).length===0,'NATIVE_V1244_TRIGGER_ACTIVE');
 const replay=JSON.parse(p.getProperty('QBO_PHASE_G_V1215_REPLAY_STATE')||'null');
 expect(!!replay&&replay.replayAuthorized===false&&replay.replayWorkerEnabled===false,'REPLAY_ENABLED');
 expect(qboNativeCdcIsPaused_(),'LEGACY_CDC_NOT_PAUSED');
 const root=qboNativeCdcResolveEvidenceFolder_();
 expect(root.getId()!==ptr.folderId,'GOVERNED_ROOT_EQUALS_LEGACY_ROOT');
 const output={version:'1.5.248',mode:'READ_ONLY',observedAt:new Date().toISOString(),verdict:failures.length?'BLOCKED':'PASS_PRE_RECOVERY',failures:failures,phaseG:{status:phase&&phase.status,manifestCursor:phase&&phase.manifestCursor,manifestCount:phase&&phase.manifestCount,triggerIds:phaseTriggers.map(t=>t.getUniqueId()),checkpointSha256:qboNativeCdcSha256_(phaseRaw||'')},nativeCdc:{status:s.status,enabled:s.enabled,watermark:s.prospectiveWatermark,cycleId:a&&a.cycleId,cursor:a&&a.cursor,changedSince:a&&a.changedSince,lookbackAgeDays:ageDays,maxLookbackDays:QBO_NATIVE_CDC_PRODUCTION.MAX_CDC_LOOKBACK_DAYS,termFileId:term&&term.getId(),termSizeBytes:term&&term.getSize(),verifiedFiles:results,checkpointFileId:ptr.stateFileId,checkpointSha256:qboNativeCdcSha256_(JSON.stringify(s))},routing:{governedRootId:root.getId(),datePartitionEnabled:QBO_NATIVE_CDC_PRODUCTION.DATE_PARTITION_NEW_EVIDENCE,legacyProspectiveRootId:ptr.folderId,existingCycleFolderId:a&&a.folderId},ingestionAuthorized:false,historicalDeletionCoverageCertified:false};
 console.log('[NATIVE CDC RECOVERY PREFLIGHT V1248] | READ_ONLY | '+JSON.stringify(output));return output;
}
