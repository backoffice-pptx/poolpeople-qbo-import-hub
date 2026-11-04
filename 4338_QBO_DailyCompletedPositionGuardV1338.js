/** V1338: fail-closed persisted completion guard for daily worker claims.
 * Called ONLY while the scheduler lock is held; no writes and no recovery.
 * Historical COMPLETE means no automatic retry even if prior queue advancement
 * failed. A human must reconcile the run and explicitly recover it.
 */
const QBO_DAILY_V1338_VERSION = '1.5.338';
function qboDailyV1338Decision_(runId, index, exportKey, rows, runRows) {
  if (!runId || !Number.isInteger(index) || index < 0 || !exportKey)
    throw new Error('V1338_INVALID_CLAIM_IDENTITY');
  const attempts = rows.filter(function(r) {
    return String(r[0]) === String(runId) &&
      Number(r[1]) === index + 1 && String(r[2]) === String(exportKey);
  });
  const completed = attempts.filter(function(r) { return String(r[6]) === 'COMPLETE'; });
  if (completed.length) throw new Error('V1338_COMPLETED_POSITION_HOLD: run=' + runId +
    ' position=' + (index + 1) + ' export=' + exportKey +
    ' completedAttempts=' + completed.length);
  const runMatches = runRows.filter(function(r) { return String(r[0]) === String(runId); });
  if (runMatches.length !== 1) throw new Error('V1338_RUN_HISTORY_AMBIGUOUS_OR_MISSING');
  const status = String(runMatches[0][3] || '');
  if (status === 'COMPLETE' || status === 'COMPLETE_WITH_ERRORS')
    throw new Error('V1338_FINALIZED_RUN_HOLD');
  if (!status || status === 'CANCELLED' || status === 'ERROR')
    throw new Error('V1338_UNSAFE_RUN_STATUS: ' + status);
  if (attempts.some(function(r) { return String(r[6]) === 'RUNNING'; }))
    throw new Error('V1338_UNRESOLVED_RUNNING_ATTEMPT');
  return {claimable:true, matchingAttempts:attempts.length};
}
function qboDailyV1338AssertClaimable_(runId, index, exportKey) {
  // This read deliberately occurs while the caller owns the scheduler lock.
  // Failure or timeout prevents token creation; it never authorizes a retry.
  const book = getQboRunHistorySpreadsheet_();
  const ex = book.getSheetByName(QBO_RUN_HISTORY.EXPORTS_SHEET);
  const runs = book.getSheetByName(QBO_RUN_HISTORY.RUNS_SHEET);
  if (!ex || !runs) throw new Error('V1338_HISTORY_SHEETS_MISSING');
  const eh = ex.getRange(1, 1, 1, 12).getValues()[0];
  const rh = runs.getRange(1, 1, 1, 10).getValues()[0];
  if (String(eh[0]) !== 'RunId' || String(eh[1]) !== 'Position' ||
      String(eh[2]) !== 'ExportKey' || String(eh[6]) !== 'Status' ||
      String(rh[0]) !== 'RunId' || String(rh[3]) !== 'Status')
    throw new Error('V1338_HISTORY_SCHEMA_MISMATCH');
  const rows = ex.getLastRow() > 1 ?
    ex.getRange(2, 1, ex.getLastRow() - 1, 12).getValues() : [];
  const runRows = runs.getLastRow() > 1 ?
    runs.getRange(2, 1, runs.getLastRow() - 1, 10).getValues() : [];
  return qboDailyV1338Decision_(runId, index, exportKey, rows, runRows);
}
function testQboDailyCompletedPositionGuardV1338() {
  const run='test-run', key='INVOICES', ix=21;
  const rr=[['test-run','','','RUNNING']];
  const a=['test-run',22,key,'','','','INTERRUPTED'];
  const check=function(rows,runs,allowed) {
    let pass=false;
    try { pass=qboDailyV1338Decision_(run,ix,key,rows,runs).claimable===true; }
    catch(e) { pass=false; }
    if(pass!==allowed) throw Error('V1338 guard test mismatch');
  };
  check([],rr,true);
  check([a],rr,true);
  check([[...a.slice(0,6),'COMPLETE']],rr,false);
  check([a,[...a.slice(0,6),'COMPLETE']],rr,false);
  check([[...a.slice(0,6),'RUNNING']],rr,false);
  check([], [['test-run','','','COMPLETE']],false);
  check([], [],false);
  console.log('[DAILY V1338] | OFFLINE LOGIC TEST PASS | cases=7 | mutations=0');
}
