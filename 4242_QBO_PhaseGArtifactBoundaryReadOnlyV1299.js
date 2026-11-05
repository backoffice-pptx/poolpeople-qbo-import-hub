/** V1.5.299: read-only production Phase G chunk-85 artifact + iterator-boundary recheck.
 * No state changes, Drive writes, trigger changes, recovery, or restart.
 * Requires existing V1271/V1274 helper definitions in App 50.
 */
function inspectQboPhaseGArtifactBoundaryV1299(){
  const V='1.5.299', failures=[],warnings=[], samples=[], p=PropertiesService.getScriptProperties();
  const key='QBO_PHASE_G_UNIQUENESS_V1274_STATE';
  let s=null, checkedBuckets=0, checkedRows=0, sourceRows=0, sourceIdsVerified=0, boundaryIds=[],boundaryMatches=null;
  const fail=(code,e)=>{failures.push(code+(e?' '+String(e.message||e):''));};
  try {s=JSON.parse(p.getProperty(key)||'null');}catch(e){fail('STATE_PARSE',e);}
  const journal=p.getProperty(key+'_JOURNAL');
  const triggers=ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='qboPhaseGGlobalIdentityWorkerV1274');
  if(!s)fail('STATE_MISSING');
  if(journal)fail('JOURNAL_PRESENT');
  if(triggers.length)fail('WORKER_TRIGGER_PRESENT');
  if(s){
    if(s.status!=='HALTED_REVIEW_REQUIRED'||s.lease)fail('NOT_HALTED_QUIESCENT');
    if(s.fileCursor!==801||s.rows!==357301||s.chunk!==86)fail('CHECKPOINT_BOUNDARY_CHANGED');
    if(!Array.isArray(s.bucketFolders)||s.bucketFolders.length!==16||new Set(s.bucketFolders).size!==16)fail('BUCKET_FOLDERS_INVALID');
    if(s.recoveryVersion!=='1.5.276'||!s.recoveryJournal||!Array.isArray(s.recoverySourceFileIds)||!s.recoveryIteratorTokenBefore||!s.iteratorToken)fail('RECOVERY_LINEAGE_MISSING');
    if(s.recoveryJournal&&(s.recoveryJournal.chunk!==85||s.recoveryJournal.cursor!==791||s.recoveryJournal.files!==10||s.recoveryJournal.rows!==2500))fail('RECOVERY_JOURNAL_METADATA_CHANGED');
  }
  if(failures.length===0){
    try {
      const j=s.recoveryJournal, expected=Array.from({length:16},()=>[]);
      // Independently reconstruct from immutable source iterator at the pre-commit boundary.
      const it=DriveApp.continueFileIterator(s.recoveryIteratorTokenBefore), actualIds=[];
      for(let i=0;i<j.files;i++){
        if(!it.hasNext())throw Error('SOURCE_ITERATOR_EXHAUSTED');
        const f=it.next(), id=f.getId();actualIds.push(id);
        const x=JSON.parse(f.getBlob().getDataAsString());
        if(x.version!=='1.5.271'||!Array.isArray(x.entries)||x.rows!==x.entries.length||qboPg271Hash_(JSON.stringify(x.entries))!==x.payloadHash)throw Error('INDEX_INVALID '+id);
        for(const e of x.entries){if(!Array.isArray(e)||typeof e[0]!=='string'||!e[0])throw Error('INDEX_ENTRY_INVALID '+id);expected[qboPg274Bucket_(e[0])].push([e[0],id,e[2]]);sourceRows++;}
      }
      if(JSON.stringify(actualIds)!==JSON.stringify(s.recoverySourceFileIds))throw Error('SOURCE_FILE_IDS_MISMATCH');
      sourceIdsVerified=actualIds.length;
      if(sourceRows!==2500)throw Error('SOURCE_ROW_TOTAL_MISMATCH '+sourceRows);
      // Compare actual final artifact payload to the source-derived expected rows, not metadata alone.
      for(let b=0;b<16;b++){
        const dir=DriveApp.getFolderById(s.bucketFolders[b]), name='chunk_000085.json', files=dir.getFilesByName(name);
        if(!files.hasNext())throw Error('MISSING_FINAL_BUCKET '+b);
        const f=files.next();if(files.hasNext())throw Error('DUPLICATE_FINAL_BUCKET '+b);
        const x=JSON.parse(f.getBlob().getDataAsString()), rows=expected[b], hash=qboPg274Hash_(rows);
        if(x.version!=='1.5.274'||x.bucket!==b||x.chunk!==85||x.rows!==rows.length||x.hash!==hash||!Array.isArray(x.entries)||JSON.stringify(x.entries)!==JSON.stringify(rows))throw Error('ARTIFACT_MISMATCH_BUCKET '+b);
        checkedBuckets++;checkedRows+=rows.length;
        samples.push({bucket:b,rows:rows.length});
      }
      if(checkedRows!==2500)throw Error('ARTIFACT_TOTAL_MISMATCH');
      // Opaque continuation tokens may differ while pointing to the same boundary.
      const committed=DriveApp.continueFileIterator(s.iteratorToken);
      const regenerated=it;
      const nextCount=Math.min(3,2418-s.fileCursor);
      for(let k=0;k<nextCount;k++){
        if(!committed.hasNext()||!regenerated.hasNext())throw Error('BOUNDARY_EXHAUSTED');
        const a=committed.next(),b=regenerated.next();
        if(a.getId()!==b.getId())throw Error('BOUNDARY_ID_MISMATCH '+k);
        const pa=a.getBlob().getDataAsString(),pb=b.getBlob().getDataAsString();
        if(qboPg271Hash_(pa)!==qboPg271Hash_(pb))throw Error('BOUNDARY_PAYLOAD_MISMATCH '+k);
        boundaryIds.push(a.getId());
      }
      boundaryMatches=boundaryIds.length===nextCount;
      if(!boundaryMatches)throw Error('BOUNDARY_NOT_VERIFIED');
    }catch(e){fail('SOURCE_ARTIFACT_OR_BOUNDARY_VERIFICATION_FAILED',e);}
  }
  const out={version:V,readOnly:true,status:failures.length?'BLOCKED_REVIEW_REQUIRED':'SOURCE_ARTIFACTS_AND_BOUNDARY_VERIFIED_NOT_DEPLOYMENT_AUTHORIZED',
    checkpointCursor:s?.fileCursor??null,checkpointRows:s?.rows??null,nextChunk:s?.chunk??null,
    recoveredChunk:85,sourceFilesVerified:sourceIdsVerified,sourceRowsVerified:sourceRows,
    finalArtifactsVerified:checkedBuckets,finalArtifactRowsVerified:checkedRows,
    boundarySampleCount:boundaryIds.length,boundaryMatches,boundaryIds,rowsByBucket:samples,
    journalPresent:!!journal,leasePresent:!!s?.lease,workerTriggerCount:triggers.length,
    failures,warnings,productionPropertyWrites:0,productionArtifactWrites:0,productionTriggerChanges:0,
    workerResumed:false,automaticRecoveryEnabled:false,productionDeploymentAuthorized:false,
    independentManifestOrderVerified:false,allHistoricalChunksVerified:false};
  console.log('[PHASE G V1299] | READ_ONLY | '+JSON.stringify(out));return out;
}
