/** v1.5.253 — Read-only catch-up acquisition preflight. No QBO requests or writes. */
function inspectQboNativeCdcCatchupPreflightV1253(){
 const K={cycle:'9c9276b1-70cb-4fb5-930f-bb5e388c5312',watermark:'2026-10-11T22:27:37.687Z',sealId:'1AoBTgniGs-lF8NDHpY4O_YB5OdfIIVtc',sealHash:'e073932947e328c1ec02693515045734b5a3a8e5c9a513055c0a32e3aaa01f52'};
 const findings=[],warnings=[];let state=null,seal=null,phase=null,folderStatus=null,changedSince=null,daysRemaining=null;
 const fail=(code,detail)=>findings.push({code:code,detail:String(detail||'')});
 try{
  const p=PropertiesService.getScriptProperties(),ctx=qboCdcProspectiveStateV1244_();state=ctx.state;const a=state.active;
  if(!a||a.cycleId!==K.cycle||a.cursor!==20||a.results.length!==20)fail('RECOVERY_CHECKPOINT_CHANGED','active cycle/cursor');
  if(state.status!=='HALTED_REQUIRES_REVIEW'||state.enabled!==false||state.prospectiveWatermark!==K.watermark||state.ingestionAuthorized!==false||state.historicalDeletionCoverageCertified!==false)fail('RECOVERY_GUARDS_CHANGED',state.status);
  if(!qboNativeCdcIsPaused_()||!qboNativeCdcV1233CaptureOnly_())fail('PRODUCTION_CAPTURE_GUARD_CHANGED','pause/capture-only');
  if(ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()===QBO_CDC_PROSPECTIVE_V1244_.HANDLER))fail('OLD_CAPTURE_TRIGGER_PRESENT','V1244');
  changedSince=a&&a.changedSince;const t=Date.parse(changedSince),max=QBO_NATIVE_CDC_PRODUCTION.MAX_CDC_LOOKBACK_DAYS;
  if(!Number.isFinite(t)||t>Date.now())fail('INVALID_CATCHUP_BOUNDARY',changedSince);
  else {daysRemaining=Number((max-(Date.now()-t)/86400000).toFixed(3));if(daysRemaining<=0)fail('QBO_LOOKBACK_EXPIRED',changedSince);else if(daysRemaining<5)warnings.push('Less than five days remain in the QBO CDC lookback.');}
  const sf=DriveApp.getFileById(K.sealId),raw=sf.getBlob().getDataAsString('UTF-8');
  if(qboNativeCdcSha256_(raw)!==K.sealHash)fail('SEAL_SHA256_CHANGED',sf.getId());
  seal=JSON.parse(raw);
  if(seal.schema!=='QBO_NATIVE_CDC_RECOVERY_EVIDENCE_SEAL_V1'||seal.cycleId!==K.cycle||seal.entities.length!==20||seal.changedSince!==changedSince||seal.preservedProspectiveWatermark!==K.watermark||seal.cycleCommitted!==false||seal.ingestionAuthorized!==false||seal.historicalDeletionCoverageCertified!==false)fail('SEAL_CONTRACT_CHANGED','identity/coverage');
  if(a&&a.results.length===20){for(let i=0;i<20;i++){const r=a.results[i],e=seal.entities[i];if(!e||e.entity!==r.entity||e.fileId!==r.fileId||e.sha256!==r.sha256)fail('SEAL_CHECKPOINT_MISMATCH',i+' '+r.entity);}}
  const root=DriveApp.getFolderById(QBO_NATIVE_CDC_PRODUCTION.EVIDENCE_ROOT_FOLDER_ID || '1wuIk1bYM2hu78M7KcsXhAlmP39O8wh99');
  const now=new Date(),names=[Utilities.formatDate(now,'UTC','yyyy'),Utilities.formatDate(now,'UTC','MM'),Utilities.formatDate(now,'UTC','dd')];let parent=root;const existing=[];
  for(const name of names){const it=parent.getFoldersByName(name);if(!it.hasNext()){folderStatus={rootId:root.getId(),utcPath:names.join('/'),existingLevels:existing,missingFrom:name,willCreateDuringFutureAcquisition:true};break;}const child=it.next();if(it.hasNext())fail('DUPLICATE_DATE_PARTITION',name);parent=child;existing.push({name:name,id:child.getId()});}
  if(!folderStatus)folderStatus={rootId:root.getId(),utcPath:names.join('/'),existingLevels:existing,willCreateDuringFutureAcquisition:false};
  if(QBO_NATIVE_CDC_PRODUCTION.DATE_PARTITION_NEW_EVIDENCE!==true)fail('DATE_PARTITION_DISABLED','config');
  phase=JSON.parse(p.getProperty('QBO_PHASE_G_GLOBAL_TIE_V1219_STATE')||'null');if(!phase)fail('PHASE_G_CHECKPOINT_MISSING','');
  else if(phase.status!=='BUILDING_GLOBAL_PARTITIONS'&&phase.status!=='COMPLETE'&&phase.status!=='COMPLETED')warnings.push('Phase G status '+phase.status+' requires separate isolation review.');
 }catch(err){fail('PREFLIGHT_EXCEPTION',String(err));}
 const out={version:'1.5.253',mode:'READ_ONLY',verdict:findings.length?'FAIL_NO_ACQUISITION':'PASS_PREFLIGHT_ONLY_NO_ACQUISITION',cycleId:K.cycle,checkpointStatus:state&&state.status,catchupChangedSince:changedSince,daysRemainingInQboLookback:daysRemaining,sealFileId:K.sealId,sealHashVerified:!findings.some(f=>f.code==='SEAL_SHA256_CHANGED'),governedDestination:folderStatus,phaseG:{status:phase&&phase.status,manifestCursor:phase&&phase.manifestCursor},watermark:state&&state.prospectiveWatermark,cycleCommitted:false,ingestionAuthorized:false,acquisitionAuthorized:false,findings:findings,warnings:warnings,limitations:['No QBO request made; API availability and response completeness are not yet tested.','No historical revision or deletion completeness certification.','No folders, files, properties, or triggers changed.']};
 console.log('[NATIVE CDC CATCHUP PREFLIGHT V1253] | READ_ONLY | '+JSON.stringify(out));return out;
}
