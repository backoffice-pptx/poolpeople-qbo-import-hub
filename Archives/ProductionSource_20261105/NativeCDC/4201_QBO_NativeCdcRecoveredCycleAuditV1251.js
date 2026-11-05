/** v1.5.251 — READ ONLY independent full-cycle recovery evidence audit.
 * No QBO calls, triggers, locks, properties or Drive writes.
 * PASS means evidence is verified, NOT that mixed-time capture is certified as historical coverage.
 */
function inspectQboNativeCdcRecoveredCycleV1251(){
 const expected={cycle:'9c9276b1-70cb-4fb5-930f-bb5e388c5312',folder:'1LOu-1Tpsb7i7HFWx8JGVBBxmi1N0PiDF',state:'17ckU3zeHx02U3FSd8d2p9TnigjVWQDP1',watermark:'2026-10-11T22:27:37.687Z',term:'1NNSUBGPz02Z2q5L4dXNmI1T8Ee_Jtj_v'};
 const findings=[],checks=[];let state=null,folder=null,phase=null;
 const fail=(code,detail)=>findings.push({code:code,detail:String(detail||'')});
 try{
  const p=PropertiesService.getScriptProperties(),ptr=JSON.parse(p.getProperty(QBO_CDC_PROSPECTIVE_V1244_.KEY)||'null');
  if(!ptr||ptr.stateFileId!==expected.state)throw Error('STATE_POINTER_CHANGED');
  const ctx=qboCdcProspectiveStateV1244_();state=ctx.state;const a=state.active;
  if(!a||a.cycleId!==expected.cycle||a.folderId!==expected.folder||a.cursor!==20||a.results.length!==20)fail('RECOVERY_SCOPE_CHANGED',a?JSON.stringify({cycleId:a.cycleId,cursor:a.cursor,results:a.results.length}):'no active cycle');
  if(state.status!=='HALTED_REQUIRES_REVIEW'||state.enabled!==false||state.prospectiveWatermark!==expected.watermark||state.ingestionAuthorized!==false||state.historicalDeletionCoverageCertified!==false)fail('UNSAFE_STATE',state.status);
  const ts=ScriptApp.getProjectTriggers(),g=ts.filter(t=>t.getHandlerFunction()==='qboPhaseGJournaledV1231Continuation_');
  phase=JSON.parse(p.getProperty('QBO_PHASE_G_GLOBAL_TIE_V1219_STATE')||'null');
  if(!phase||g.length!==1||phase.status!=='BUILDING_GLOBAL_PARTITIONS')fail('PHASE_G_NOT_EXPECTED',JSON.stringify({status:phase&&phase.status,triggers:g.length}));
  if(ts.some(t=>t.getHandlerFunction()===QBO_CDC_PROSPECTIVE_V1244_.HANDLER))fail('NATIVE_TRIGGER_PRESENT','V1244 trigger');
  folder=DriveApp.getFolderById(expected.folder);
  if(a&&a.cursor===20&&a.results.length===20){
   for(let i=0;i<20;i++){
    const entity=QBO_CDC_PROSPECTIVE_V1244_.ENTITIES[i],r=a.results[i],name=i<17?'cdc_'+entity+'.json':'recovery_v1249_cdc_'+entity+'.json';
    const c={index:i,entity:entity,fileId:r&&r.fileId||null,status:'FAIL'};
    try{
     if(!r||r.entity!==entity||!r.fileId||!r.sha256)throw Error('CHECKPOINT_RESULT_INVALID');
     const f=DriveApp.getFileById(r.fileId),raw=f.getBlob().getDataAsString('UTF-8');
     if(f.getName()!==name)throw Error('FILENAME_MISMATCH '+f.getName());
     if(!raw)throw Error('EMPTY_EVIDENCE');
     const hash=qboNativeCdcSha256_(raw);if(hash!==r.sha256)throw Error('SHA256_MISMATCH');
     const e=JSON.parse(raw),v=qboCdcProspectiveValidateV1244_(e,a,entity);
     if(v.returnedRows!==r.returnedRows||v.deletedRows!==r.deletedRows)throw Error('ROW_COUNTS_MISMATCH');
     if(i>=17){
      if(!e.recovery||e.recovery.lateAcquisition!==true||e.recovery.originalCycleWindowEnd!==a.windowEnd||e.recovery.originalFailedTermFileId!==expected.term)throw Error('RECOVERY_PROVENANCE_INVALID');
     }else if(e.recovery)throw Error('ORIGINAL_FILE_MARKED_RECOVERY');
     c.sha256=hash;c.returnedRows=v.returnedRows;c.deletedRows=v.deletedRows;c.requestStartedAt=e.requestStartedAt;c.requestCompletedAt=e.requestCompletedAt;c.status='PASS';
    }catch(err){c.error=String(err);fail('ENTITY_'+i+'_'+entity,c.error)}
    checks.push(c);
   }
  }
  const tf=DriveApp.getFileById(expected.term);
  if(tf.getName()!=='cdc_Term.json'||tf.getSize()!==0)fail('ORIGINAL_TERM_ARTIFACT_CHANGED',JSON.stringify({name:tf.getName(),size:tf.getSize()}));
  const expectedNames=new Set(QBO_CDC_PROSPECTIVE_V1244_.ENTITIES.map((e,i)=>(i<17?'cdc_':'recovery_v1249_cdc_')+e+'.json').concat(['cdc_Term.json']));
  const it=folder.getFiles(),seen={};while(it.hasNext()){const f=it.next(),name=f.getName();seen[name]=(seen[name]||0)+1;if(!expectedNames.has(name))fail('UNEXPECTED_FILE',name+' '+f.getId());}
  expectedNames.forEach(name=>{if(seen[name]!==1)fail('FILE_MULTIPLICITY',name+' count='+(seen[name]||0))});
  if(state.lastCommitted&&state.lastCommitted.cycleId===expected.cycle)fail('ALREADY_COMMITTED','same cycle');
 }catch(err){fail('AUDIT_EXCEPTION',String(err))}
 const out={version:'1.5.251',mode:'READ_ONLY',verdict:findings.length?'FAIL_REVIEW_REQUIRED':'PASS_EVIDENCE_ONLY_NOT_COVERAGE_CERTIFIED',
  cycleId:expected.cycle,checkpointStatus:state&&state.status,cursor:state&&state.active&&state.active.cursor,
  watermark:state&&state.prospectiveWatermark,phaseG:{status:phase&&phase.status,manifestCursor:phase&&phase.manifestCursor},
  originalEntitiesVerified:checks.filter(c=>c.index<17&&c.status==='PASS').length,recoveredEntitiesVerified:checks.filter(c=>c.index>=17&&c.status==='PASS').length,
  originalTermArtifactPreserved:!findings.some(f=>f.code==='ORIGINAL_TERM_ARTIFACT_CHANGED'),
  acquisitionTimes:checks.map(c=>({entity:c.entity,started:c.requestStartedAt||null,completed:c.requestCompletedAt||null,status:c.status})),
  checks:checks.map(c=>({entity:c.entity,fileId:c.fileId,status:c.status,error:c.error||null})),
  findings:findings,limitations:['Original 17 and recovered 3 were acquired on different dates; not an atomic October 11 snapshot.','CDC does not reconstruct intermediate revisions.','No cycle commit or watermark change authorized.','Historical deletion coverage and ingestion remain uncertified/disabled.']};
 console.log('[NATIVE CDC RECOVERED CYCLE V1251] | READ_ONLY | '+JSON.stringify(out));return out;
}
