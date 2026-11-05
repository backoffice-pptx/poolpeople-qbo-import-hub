/** Read-only Phase G rearm preflight. Standalone: no dependency on 4222 private helpers.
 * Does not modify Script Properties, triggers, Drive, or worker state.
 */
function previewQboPg4265StandaloneRearmV1274() {
  const KEY='QBO_PHASE_G_UNIQUENESS_V1274_STATE';
  const HANDLER='qboPhaseGGlobalIdentityWorkerV1274';
  const p=PropertiesService.getScriptProperties();
  const raw=p.getProperty(KEY);
  let s=null, parseError=null;
  try { if(raw)s=JSON.parse(raw); } catch(e) { parseError=String(e); }
  const issues=[];
  if(parseError)issues.push('STATE_JSON_INVALID');
  if(!s)issues.push('STATE_MISSING');
  if(s){
    if(s.version!=='1.5.274')issues.push('VERSION');
    if(s.status!=='HALTED_REVIEW_REQUIRED')issues.push('STATUS');
    if(s.fileCursor!==801)issues.push('CURSOR');
    if(s.rows!==357301)issues.push('ROWS');
    if(s.chunk!==86)issues.push('CHUNK');
    if(s.bucketCursor!==0)issues.push('BUCKET');
    if(s.auditFolderId!=='1ThPawegYeoKZ0rWsKweO7f2baiBqyTbg')issues.push('AUDIT_FOLDER');
    if(s.indexFolderId!=='16Ltx_Rs4MrBH3jhToWm8olfzR2CX1aA-')issues.push('INDEX_FOLDER');
    if(typeof s.iteratorToken!=='string'||!s.iteratorToken)issues.push('ITERATOR_MISSING');
    if(s.lease)issues.push('LEASE_PRESENT');
    if(!Array.isArray(s.bucketFolders)||s.bucketFolders.length!==16)issues.push('BUCKET_FOLDERS');
  }
  const pendingJournal=!!p.getProperty(KEY+'_JOURNAL');
  if(pendingJournal)issues.push('JOURNAL_PRESENT');
  const triggerCount=ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()===HANDLER).length;
  if(triggerCount!==0)issues.push('WORKER_TRIGGER_PRESENT');
  const out={version:'1.5.274-preview-standalone',status:issues.length?'BLOCKED':'READY_FOR_AUTHORIZATION',issues,
    cursor:s?s.fileCursor:null,rows:s?s.rows:null,chunk:s?s.chunk:null,bucketCursor:s?s.bucketCursor:null,
    pendingJournal,triggerCount,leasePresent:!!(s&&s.lease),iteratorPresent:!!(s&&s.iteratorToken),
    authorized:false,stateMutations:0,triggerMutations:0,workerResumed:false,
    artifactContentsVerifiedByThisPreview:false,sourceBoundaryVerifiedByThisPreview:false};
  console.log('[PHASE G V1274] | ONE_TIME_REARM_PREVIEW | '+JSON.stringify(out));
  return out;
}
