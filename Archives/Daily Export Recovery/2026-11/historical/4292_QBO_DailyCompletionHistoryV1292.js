/** V1292: read-only persisted export and run completion evidence. */
const QBO_DAILY_V1292_VERSION='1.5.292';
function qboDailyV1292Assess_(s, exportRows, runRows) {
  const cp=s.checkpoint, runId=s.runId || (cp&&cp.runId)||'';
  const out={classification:s.classification||'UNCLASSIFIED',historyStatus:'NOT_CHECKED',
    completionHistoryVerified:false,runFinalizationVerified:false,
    matchingAttempts:0,conflictingAttempts:0,recoveryAuthorized:false};
  if (!runId) {out.historyStatus='NO_RUN_ID';return out;}
  if (!cp || !cp.exportKey || !Number.isInteger(cp.index) || !cp.snapshotId) {
    out.historyStatus='INSUFFICIENT_CHECKPOINT';return out;
  }
  if (cp.runId!==runId) {out.historyStatus='RUN_MISMATCH';return out;}
  const candidates=exportRows.filter(r=>String(r[0])===String(runId)&&
    String(r[2])===String(cp.exportKey)&&Number(r[1])===cp.index+1);
  out.matchingAttempts=candidates.length;
  // History does not persist worker tokens. If an active attempt exists, its
  // startedAt must match. When claim is gone, multiple attempts are ambiguous.
  const startMs=s.activeStartedAt?Date.parse(s.activeStartedAt):NaN;
  if(s.activeToken && (!s.activeStartedAt || !Number.isFinite(startMs))) {
    out.historyStatus='ACTIVE_ATTEMPT_START_UNAVAILABLE';return out;
  }
  if (s.activeToken && cp.token!==s.activeToken) {out.historyStatus='TOKEN_MISMATCH';return out;}
  if (candidates.length!==1) {out.historyStatus=candidates.length?'AMBIGUOUS_ATTEMPTS':'EXPORT_HISTORY_MISSING';return out;}
  const r=candidates[0];
  const observedStart=new Date(r[4]).getTime();
  if(s.activeToken && observedStart!==startMs) {out.historyStatus='ATTEMPT_START_MISMATCH';return out;}
  if(String(r[6])!=='COMPLETE' || !Number.isFinite(new Date(r[5]).getTime())) {
    out.historyStatus='EXPORT_NOT_COMPLETE';return out;
  }
  if(String(r[9])!==String(cp.snapshotId) || !String(r[10]||'').trim() ||
     !Number.isInteger(Number(r[11])) || r[11]==='' || Number(r[11])<0) {
    out.historyStatus='SNAPSHOT_EVIDENCE_MISMATCH';return out;
  }
  out.historyStatus='EXPORT_COMPLETE_MATCH';out.completionHistoryVerified=true;
  const runs=runRows.filter(r=>String(r[0])===String(runId));
  if(runs.length!==1){out.runStatus=runs.length?'AMBIGUOUS_RUN_ROWS':'RUN_ROW_MISSING';return out;}
  out.runStatus=String(runs[0][3]||'');
  out.runFinalizationVerified=(out.runStatus==='COMPLETE'||out.runStatus==='COMPLETE_WITH_ERRORS')&&
    Number.isFinite(new Date(runs[0][2]).getTime()) &&
    Number(runs[0][5]) + Number(runs[0][6])===Number(runs[0][4]);
  return out;
}
function previewQboDailyCompletionHistoryV1292(){
  const p=PropertiesService.getScriptProperties(),q=DAILY_QBO_QUEUE_PROPERTIES;
  const raw=p.getProperty(QBO_DAILY_V1284_KEY);
  let cp=null,parseError='';try{cp=qboDailyV1284Parse_(raw);}catch(e){parseError=String(e.message||e);}
  const ix=p.getProperty(q.INDEX),activeToken=p.getProperty(q.ACTIVE_TOKEN)||'';
  const state={runId:p.getProperty(q.RUN_ID)||'',index:ix===null?null:Number(ix),
    activeToken,activeStartedAt:p.getProperty(q.ACTIVE_STARTED_AT)||'',checkpoint:cp};
  const cls=parseError?'CHECKPOINT_PARSE_ERROR':qboDailyV1291Classify_(state).classification;
  let result={version:QBO_DAILY_V1292_VERSION,readOnly:true,
    paused:p.getProperty(QBO_DAILY_V1279_PAUSE_KEY)==='true',classification:cls,
    checkpointPhase:cp?cp.phase:null,checkpointParseError:parseError,
    completionHistoryVerified:false,runFinalizationVerified:false,
    executionLivenessVerified:false,exporterWriteFencingIntegrated:false,
    automaticRecoveryEnabled:false,recoveryAuthorized:false};
  if(parseError){result.historyStatus='CHECKPOINT_PARSE_ERROR';}
  else if(!(state.runId||(cp&&cp.runId))){result.historyStatus='NO_RUN_ID';}
  else {
    try {
      // Existing history workbook is opened, not provisioned or schema-upgraded.
      const book=getQboRunHistorySpreadsheet_();
      const ex=book.getSheetByName(QBO_RUN_HISTORY.EXPORTS_SHEET);
      const runs=book.getSheetByName(QBO_RUN_HISTORY.RUNS_SHEET);
      if(!ex||!runs)throw Error('MISSING_HISTORY_SHEETS');
      const read=sheet=>sheet.getLastRow()>1?sheet.getRange(2,1,sheet.getLastRow()-1,12).getValues():[];
      const exports=read(ex);
      const runRows=runs.getLastRow()>1?runs.getRange(2,1,runs.getLastRow()-1,10).getValues():[];
      result={...result,...qboDailyV1292Assess_({...state,classification:cls},exports,runRows)};
    }catch(e){result.historyStatus='HISTORY_READ_FAILED';result.historyError=String(e.message||e).slice(0,300);}
  }
  console.log('[DAILY V1292] | READ_ONLY | '+JSON.stringify(result));return result;
}
function testQboDailyCompletionHistoryV1292(){
  let n=0;const ok=(x)=>{if(!x)throw Error('V1292 case '+(n+1));n++;};
  const cp={runId:'r',index:0,exportKey:'CUSTOMERS',token:'t',snapshotId:'s',phase:'QUEUE_ADVANCED'};
  const state={runId:'r',activeToken:'t',activeStartedAt:'2026-11-03T00:00:00.000Z',checkpoint:cp};
  const row=['r',1,'CUSTOMERS','fn',new Date(state.activeStartedAt),new Date('2026-11-03T00:01:00Z'),'COMPLETE',1000,'','s','snapshot',12];
  const run=['r',new Date('2026-11-03T00:00:00Z'),new Date('2026-11-03T00:02:00Z'),'COMPLETE',1,1,0,1,'',new Date()];
  const a=(s,ex,rs)=>qboDailyV1292Assess_(s,ex,rs);
  ok(a(state,[row],[run]).completionHistoryVerified);
  ok(a(state,[row],[run]).runFinalizationVerified);
  ok(!a(state,[row,row],[run]).completionHistoryVerified);
  const change=(i,v)=>row.map((x,j)=>j===i?v:x);
  ok(a(state,[change(6,'ERROR')],[run]).historyStatus==='EXPORT_NOT_COMPLETE');
  ok(a(state,[change(9,'other')],[run]).historyStatus==='SNAPSHOT_EVIDENCE_MISMATCH');
  ok(a(state,[change(11,'')],[run]).historyStatus==='SNAPSHOT_EVIDENCE_MISMATCH');
  ok(a({...state,activeStartedAt:'2026-11-03T00:03:00Z'},[row],[run]).historyStatus==='ATTEMPT_START_MISMATCH');
  ok(a({...state,activeToken:'wrong'},[row],[run]).historyStatus==='TOKEN_MISMATCH');
  ok(!a(state,[row],[run.map((x,i)=>i===3?'RUNNING':x)]).runFinalizationVerified);
  ok(!a(state,[row],[run,run]).runFinalizationVerified);
  ok(a(state,[],[run]).historyStatus==='EXPORT_HISTORY_MISSING');
  console.log('[DAILY V1292] | TEST PASS | '+JSON.stringify({version:QBO_DAILY_V1292_VERSION,casesPassed:n,mutations:0,automaticRecoveryEnabled:false}));
}
