/** V1.5.298 — Phase G read-only production readiness. No writes, triggers or recovery. */
function inspectQboPhaseGReadinessV1298(){
  const version='1.5.298', key='QBO_PHASE_G_UNIQUENESS_V1274_STATE', p=PropertiesService.getScriptProperties();
  const failures=[],warnings=[]; let s=null,j=null,parseError=null;
  try { const raw=p.getProperty(key); if(raw)s=JSON.parse(raw); else failures.push('CHECKPOINT_MISSING'); }
  catch(e){parseError=String(e);failures.push('CHECKPOINT_UNPARSEABLE');}
  try { const raw=p.getProperty(key+'_JOURNAL');if(raw)j=JSON.parse(raw); }
  catch(e){failures.push('JOURNAL_UNPARSEABLE');}
  const triggers=ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='qboPhaseGGlobalIdentityWorkerV1274');
  if(triggers.length)failures.push('V1274_TRIGGER_PRESENT');
  if(j)failures.push('UNRESOLVED_JOURNAL');
  if(s){
    if(s.status!=='HALTED_REVIEW_REQUIRED')failures.push('UNEXPECTED_STATUS');
    if(s.fileCursor!==801||s.rows!==357301||s.chunk!==86)failures.push('EXPECTED_RECOVERY_BOUNDARY_MISMATCH');
    if(!Array.isArray(s.bucketFolders)||s.bucketFolders.length!==16||new Set(s.bucketFolders).size!==16)failures.push('BUCKET_FOLDER_REGISTRY_INVALID');
    if(s.lease)failures.push('ACTIVE_LEASE_PRESENT');
    if(!s.indexFolderId||!s.auditFolderId||!s.iteratorToken)failures.push('MISSING_SOURCE_OR_ITERATOR_LINEAGE');
    if(s.bucketCursor!==0)warnings.push('NONZERO_BUCKET_CURSOR');
    if(s.version!=='1.5.274')failures.push('STATE_VERSION_MISMATCH');
  }
  // Deliberately do not enumerate or mutate Drive contents; evidence certification is a separate bounded review.
  const out={version,readOnly:true,status:failures.length?'BLOCKED_REVIEW_REQUIRED':'READINESS_PREFLIGHT_PASSED_NOT_DEPLOYMENT_AUTHORIZED',
    operationalStatus:s?s.status:null,fileCursor:s?s.fileCursor:null,rows:s?s.rows:null,chunk:s?s.chunk:null,
    bucketFolderCount:s&&Array.isArray(s.bucketFolders)?s.bucketFolders.length:null,
    journalPresent:!!j,leasePresent:!!(s&&s.lease),triggerCount:triggers.length,
    failures,warnings,parseError,productionPropertyWrites:0,productionArtifactWrites:0,productionTriggerChanges:0,
    automaticRecoveryEnabled:false,workerResumed:false,artifactContentsVerified:false,iteratorBoundaryVerified:false,
    productionDeploymentAuthorized:false};
  console.log('[PHASE G V1298] | READ_ONLY | '+JSON.stringify(out));return out;
}
