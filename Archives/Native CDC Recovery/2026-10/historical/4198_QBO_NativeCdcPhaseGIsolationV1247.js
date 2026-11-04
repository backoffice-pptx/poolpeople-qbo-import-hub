/** App 50 v1.5.247. READ ONLY Phase G / Native CDC pre-activation isolation gate.
 * No Drive writes, folder creation, QBO calls, locks, trigger changes or state changes.
 * Snapshot is observational, not an atomic concurrency guarantee.
 */
function inspectQboNativeCdcPhaseGIsolationV1247(){
 const P=PropertiesService.getScriptProperties(),phaseKey='QBO_PHASE_G_GLOBAL_TIE_V1219_STATE',pointerKey=QBO_CDC_PROSPECTIVE_V1244_.KEY;
 const rawPhase=P.getProperty(phaseKey)||'',rawPointer=P.getProperty(pointerKey)||'',phase=JSON.parse(rawPhase||'null'),ptr=JSON.parse(rawPointer||'null');
 const result={version:'1.5.247',mode:'READ_ONLY',observedAt:new Date().toISOString(),phaseG:{},nativeCdc:{},routing:{},triggerIsolation:{},staticContracts:{},findings:[],verdict:'BLOCK'};
 const fail=(code,detail)=>result.findings.push({code:code,detail:detail});
 if(!phase)fail('PHASE_G_CHECKPOINT_MISSING','No Phase G global checkpoint');
 else{
  result.phaseG={checkpointKey:phaseKey,checkpointSha256:qboNativeCdcSha256_(rawPhase),runId:phase.runId,status:phase.status,manifestCursor:phase.manifestCursor,manifestCount:phase.manifestCount,writeJournalPresent:!!phase.writeJournalV1231,lastProgressAt:phase.lastProgressAt||'',workbookId:phase.workbookId};
  if(phase.runId!=='PHASE_G_GLOBAL_TIE_V1219|f8717a54-3a18-476a-8fa0-4f27a8c03f92')fail('PHASE_G_RUN_ID_CHANGED','Review Phase G run identity');
  if(!['BUILDING_GLOBAL_PARTITIONS','SCANNING_GLOBAL_PARTITIONS','COMPLETE_GLOBAL_EQUAL_TIME_DIAGNOSTIC'].includes(phase.status))fail('PHASE_G_UNEXPECTED_STATUS',phase.status);
 }
 if(!ptr)fail('NATIVE_CDC_POINTER_MISSING','Prospective checkpoint pointer absent');
 else{
  const ctx=qboCdcProspectiveStateV1244_(),s=ctx.state;
  result.nativeCdc={pointerKey:pointerKey,pointerSha256:qboNativeCdcSha256_(rawPointer),stateFileId:ctx.file.getId(),stateSha256:qboNativeCdcSha256_(ctx.file.getBlob().getDataAsString('UTF-8')),status:s.status,enabled:s.enabled,cycleId:s.active&&s.active.cycleId,cursor:s.active&&s.active.cursor,watermark:s.prospectiveWatermark,ingestionAuthorized:s.ingestionAuthorized,historicalDeletionCoverageCertified:s.historicalDeletionCoverageCertified};
  if(s.enabled!==false||s.status!=='HALTED_REQUIRES_REVIEW'||!s.active||s.active.cursor!==17)fail('NATIVE_CDC_RECOVERY_STATE_CHANGED','Expected halted V1244 cycle at cursor 17');
  if(s.ingestionAuthorized!==false||s.historicalDeletionCoverageCertified!==false)fail('NATIVE_CDC_SAFETY_FLAGS_CHANGED','Ingestion or historical certification flag differs');
 }
 const governed=qboNativeCdcResolveEvidenceFolder_();
 result.routing={governedNativeCdcRootId:governed.getId(),datePartitionEnabled:QBO_NATIVE_CDC_PRODUCTION.DATE_PARTITION_NEW_EVIDENCE,phaseGWorkbookId:phase&&phase.workbookId,prospectiveRootId:ptr&&ptr.folderId,expectedHelper:'qboNativeCdcResolveRunParentFolder_'};
 if(!QBO_NATIVE_CDC_PRODUCTION.DATE_PARTITION_NEW_EVIDENCE)fail('DATE_PARTITION_DISABLED','Forward routing cannot use yyyy/MM/dd');
 if(ptr&&governed.getId()===ptr.folderId)fail('ROOT_COLLISION','Governed root equals V1244 prospective root');
 const triggers=ScriptApp.getProjectTriggers().map(t=>({handler:t.getHandlerFunction(),id:t.getUniqueId()}));
 const phaseTriggers=triggers.filter(t=>t.handler===QBO_PHASE_G_RECOVERY_V1231_.HANDLER),nativeTriggers=triggers.filter(t=>t.handler===QBO_CDC_PROSPECTIVE_V1244_.HANDLER);
 result.triggerIsolation={phaseGHandler:QBO_PHASE_G_RECOVERY_V1231_.HANDLER,phaseGTriggerCount:phaseTriggers.length,phaseGTriggerIds:phaseTriggers.map(t=>t.id),nativeHandler:QBO_CDC_PROSPECTIVE_V1244_.HANDLER,nativeTriggerCount:nativeTriggers.length,otherTriggerCount:triggers.length-phaseTriggers.length-nativeTriggers.length};
 if(nativeTriggers.length)fail('NATIVE_CDC_TRIGGER_PRESENT','Capture-only worker should be halted');
 if(phase&&phase.status!=='COMPLETE_GLOBAL_EQUAL_TIME_DIAGNOSTIC'&&phaseTriggers.length!==1)fail('PHASE_G_TRIGGER_COUNT','Expected one Phase G continuation trigger while active; inspect before proceeding');
 const replay=JSON.parse(P.getProperty('QBO_PHASE_G_V1215_REPLAY_STATE')||'null');
 result.staticContracts={phaseGStateKey:QBO_PHASE_G_RECOVERY_V1231_.GLOBAL,phaseGLock:'getUserLock',phaseGTriggerHandler:QBO_PHASE_G_RECOVERY_V1231_.HANDLER,nativeCdcLockCurrent:'getScriptLock',nativeCdcTriggerHandler:QBO_CDC_PROSPECTIVE_V1244_.HANDLER,phaseGReplayAuthorized:replay&&replay.replayAuthorized,phaseGReplayWorkerEnabled:replay&&replay.replayWorkerEnabled};
 if(QBO_PHASE_G_RECOVERY_V1231_.GLOBAL!==phaseKey)fail('PHASE_G_PROPERTY_CONTRACT_CHANGED','Unexpected Phase G property key');
 if(replay&& (replay.replayAuthorized!==false||replay.replayWorkerEnabled!==false))fail('REPLAY_ENABLED','Phase G replay is not disabled');
 result.verdict=result.findings.length?'BLOCK':'PASS_READ_ONLY_PRE_ACTIVATION';
 console.log('[NATIVE CDC / PHASE G ISOLATION V1247] | READ_ONLY | '+JSON.stringify(result));return result;
}
