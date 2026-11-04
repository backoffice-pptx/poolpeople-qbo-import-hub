/** v1.5.255a — Read-only V1254 post-acquisition evidence audit.
 * No QBO requests, Drive/property writes, locks, or trigger changes.
 * PASS is evidence integrity only; never certifies historical CDC coverage.
 */
function inspectQboNativeCdcCatchupAuditV1255(){
 const K=QBO_CDC_CATCHUP_V1254_,findings=[],checks=[],fail=(code,detail)=>findings.push({code,detail:String(detail||'')});
 let s=null,phase=null,seal=null,checkpointFileId=null,folder=null;
 try{
  const p=PropertiesService.getScriptProperties(),ptr=JSON.parse(p.getProperty(K.KEY)||'null');
  if(!ptr||!ptr.fileId||!ptr.folderId)throw Error('CATCHUP_POINTER_MISSING');
  checkpointFileId=ptr.fileId;
  const cf=DriveApp.getFileById(ptr.fileId);if(cf.getName()!=='checkpoint.json')fail('CHECKPOINT_NAME',cf.getName());
  s=JSON.parse(cf.getBlob().getDataAsString('UTF-8'));
  if(s.version!=='1.5.254'||s.status!=='EVIDENCE_CAPTURE_COMPLETE_AUDIT_REQUIRED'||s.cursor!==20||!Array.isArray(s.results)||s.results.length!==20)fail('CHECKPOINT_INCOMPLETE',JSON.stringify({version:s.version,status:s.status,cursor:s.cursor,count:s.results&&s.results.length}));
  if(s.folderId!==ptr.folderId||s.sealFileId!==K.SEAL||s.changedSince!==K.SINCE||s.watermarkCommitted!==false||s.ingestionAuthorized!==false||s.coverageCertified!==false)fail('CHECKPOINT_GUARDS_CHANGED','identity or authority');
  if(!Number.isFinite(Date.parse(s.startedAt))||!Number.isFinite(Date.parse(s.requestWindowEnd))||Date.parse(s.requestWindowEnd)<Date.parse(s.startedAt))fail('WINDOW_INVALID','timestamps');
  folder=DriveApp.getFolderById(ptr.folderId);
  // V1254 creates its folder beneath the governed UTC yyyy/MM/dd partition.
  // Inspect existing parents only; never call the create-on-miss routing helper.
  const root=qboNativeCdcResolveEvidenceFolder_();
  if(root.getId()!=='1wuIk1bYM2hu78M7KcsXhAlmP39O8wh99'||QBO_NATIVE_CDC_PRODUCTION.DATE_PARTITION_NEW_EVIDENCE!==true)fail('GOVERNED_ROOT_OR_LAYOUT_CHANGED',root.getId());
  const partition=Utilities.formatDate(new Date(s.startedAt),'UTC','yyyy/MM/dd').split('/');
  let node=folder, valid=true;
  const levels=[partition[2],partition[1],partition[0]];
  for(let i=0;i<levels.length;i++){
   const parents=node.getParents();let parent=null,count=0;
   while(parents.hasNext()){parent=parents.next();count++;}
   if(count!==1||!parent||parent.getName()!==levels[i]){valid=false;break;}
   node=parent;
  }
  if(valid){const parents=node.getParents();let found=false,count=0;while(parents.hasNext()){const parent=parents.next();count++;if(parent.getId()===root.getId())found=true;}if(count!==1||!found)valid=false;}
  if(!valid)fail('GOVERNED_DATE_PARTITION_HIERARCHY_INVALID',ptr.folderId+' expected='+partition.join('/')+' root='+root.getId());
  const expectedNames=new Set(['checkpoint.json']);
  for(let i=0;i<20;i++){
   const entity=QBO_CDC_PROSPECTIVE_V1244_.ENTITIES[i],r=s.results[i],name='cdc_'+entity+'.json',c={index:i,entity,fileId:r&&r.fileId||null,status:'FAIL'};
   expectedNames.add(name);
   try{
    if(!r||r.entity!==entity||!r.fileId||!r.sha256)throw Error('RESULT_IDENTITY_INVALID');
    const f=DriveApp.getFileById(r.fileId),raw=f.getBlob().getDataAsString('UTF-8');
    if(f.getName()!==name||!raw)throw Error('FILENAME_OR_EMPTY');
    let inFolder=false;const ps=f.getParents();while(ps.hasNext())if(ps.next().getId()===ptr.folderId)inFolder=true;
    if(!inFolder)throw Error('FILE_OUTSIDE_CATCHUP_FOLDER');
    if(qboNativeCdcSha256_(raw)!==r.sha256)throw Error('SHA256_MISMATCH');
    const e=JSON.parse(raw),identity={cycleId:'V1254|'+ptr.folderId,changedSince:s.changedSince,windowEnd:s.requestWindowEnd};
    const v=qboCdcProspectiveValidateV1244_(e,identity,entity);
    if(v.returnedRows!==r.returnedRows||v.deletedRows!==r.deletedRows)throw Error('ROW_COUNTS_MISMATCH');
    if(!e.catchup||e.catchup.version!=='1.5.254'||e.catchup.sealedRecoveryFileId!==K.SEAL||e.catchup.windowEnd!==s.requestWindowEnd||e.catchup.lateAcquisition!==true)throw Error('CATCHUP_PROVENANCE_INVALID');
    if(e.requestStartedAt!==r.requestStartedAt||e.requestCompletedAt!==r.requestCompletedAt||!Number.isFinite(Date.parse(r.requestStartedAt))||!Number.isFinite(Date.parse(r.requestCompletedAt))||Date.parse(r.requestCompletedAt)<Date.parse(r.requestStartedAt)||Date.parse(r.requestStartedAt)<Date.parse(s.startedAt))throw Error('ACQUISITION_TIMESTAMPS_INVALID');
    c.status='PASS';c.returnedRows=v.returnedRows;c.deletedRows=v.deletedRows;c.started=r.requestStartedAt;c.completed=r.requestCompletedAt;
   }catch(err){c.error=String(err);fail('ENTITY_'+i+'_'+entity,c.error);}
   checks.push(c);
  }
  const it=folder.getFiles(),counts={};while(it.hasNext()){const f=it.next(),n=f.getName();counts[n]=(counts[n]||0)+1;if(!expectedNames.has(n))fail('UNEXPECTED_FILE',n+' '+f.getId());}
  expectedNames.forEach(n=>{if(counts[n]!==1)fail('FILE_MULTIPLICITY',n+' count='+(counts[n]||0));});
  const sealRaw=DriveApp.getFileById(K.SEAL).getBlob().getDataAsString('UTF-8');
  if(qboNativeCdcSha256_(sealRaw)!==K.HASH)fail('ORIGINAL_SEAL_HASH_CHANGED',K.SEAL);
  seal=JSON.parse(sealRaw);
  if(seal.schema!=='QBO_NATIVE_CDC_RECOVERY_EVIDENCE_SEAL_V1'||seal.changedSince!==K.SINCE||seal.preservedProspectiveWatermark!==K.WATERMARK||seal.cycleCommitted!==false||seal.ingestionAuthorized!==false||seal.historicalDeletionCoverageCertified!==false||!Array.isArray(seal.entities)||seal.entities.length!==20)fail('ORIGINAL_SEAL_CONTRACT_CHANGED','');
  const original=qboCdcProspectiveStateV1244_().state;
  if(original.status!=='HALTED_REQUIRES_REVIEW'||original.enabled!==false||original.prospectiveWatermark!==K.WATERMARK||original.ingestionAuthorized!==false||original.historicalDeletionCoverageCertified!==false||!original.active||original.active.cursor!==20||original.active.results.length!==20)fail('PRODUCTION_STATE_CHANGED','');
  if(original.lastCommitted&&original.lastCommitted.cycleId===original.active.cycleId)fail('ORIGINAL_CYCLE_COMMITTED','');
  if(!qboNativeCdcIsPaused_()||!qboNativeCdcV1233CaptureOnly_())fail('CAPTURE_GUARD_CHANGED','');
  if(ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()===QBO_CDC_PROSPECTIVE_V1244_.HANDLER))fail('NATIVE_TRIGGER_PRESENT','');
  phase=JSON.parse(p.getProperty('QBO_PHASE_G_GLOBAL_TIE_V1219_STATE')||'null');
  if(!phase||!['BUILDING_GLOBAL_PARTITIONS','COMPLETE','COMPLETED'].includes(phase.status))fail('PHASE_G_STATE_UNEXPECTED',phase&&phase.status);
  const lease=JSON.parse(p.getProperty(K.LEASE)||'null');if(lease&&lease.expiresAt>Date.now())fail('ACTIVE_CAPTURE_LEASE','');
 }catch(err){fail('AUDIT_EXCEPTION',String(err));}
 const out={version:'1.5.255a',mode:'READ_ONLY',verdict:findings.length?'FAIL_REVIEW_REQUIRED':'PASS_EVIDENCE_ONLY_NOT_COVERAGE_CERTIFIED',
  cursor:s&&s.cursor,expectedEntities:20,verifiedEntities:checks.filter(x=>x.status==='PASS').length,checkpointFileId,folderId:s&&s.folderId,
  changedSince:s&&s.changedSince,requestWindowEnd:s&&s.requestWindowEnd,watermarkUnchanged:K.WATERMARK,
  originalSealVerified:!findings.some(x=>x.code.startsWith('ORIGINAL_SEAL')),
  phaseG:{status:phase&&phase.status,manifestCursor:phase&&phase.manifestCursor},
  checks,findings,cycleCommitted:false,ingestionAuthorized:false,coverageCertified:false,
  limitations:['Capture evidence spans sequential request times, not an atomic snapshot.','CDC cannot establish intermediate revision or historical deletion completeness.','Read-only PASS does not authorize ingestion, watermark advancement or cycle commitment.']};
 console.log('[NATIVE CDC CATCHUP AUDIT V1255] | READ_ONLY | '+JSON.stringify(out));return out;
}
