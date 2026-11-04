/** V1289: read-after-write completion proof; fail closed without mutating history. */
const QBO_DAILY_V1289_VERSION = '1.5.289';
function qboDailyV1289ValidateRow_(row, claim, startedAt, metadata) {
  if (!row || row.length < 12) throw new Error('V1289 history row missing');
  if (String(row[0]) !== String(claim.runId) || Number(row[1]) !== claim.index + 1 ||
      String(row[2]) !== String(claim.exportKey)) throw new Error('V1289 history identity mismatch');
  if (String(row[6]) !== 'COMPLETE') throw new Error('V1289 history not COMPLETE');
  const actualStart = new Date(row[4]).getTime();
  const expectedStart = new Date(startedAt).getTime();
  if (!Number.isFinite(actualStart) || actualStart !== expectedStart)
    throw new Error('V1289 history attempt mismatch');
  if (!row[5] || !Number.isFinite(new Date(row[5]).getTime()))
    throw new Error('V1289 missing completion timestamp');
  const id = String(metadata && metadata.masterBackupFileId || '');
  const name = String(metadata && metadata.masterBackupFileName || '');
  const count = metadata && metadata.observationCount;
  if (!id || !name || !Number.isInteger(count) || count < 0)
    throw new Error('V1289 invalid exporter metadata');
  if (String(row[9]) !== id || String(row[10]) !== name ||
      Number(row[11]) !== count || row[11] === '')
    throw new Error('V1289 persisted snapshot metadata mismatch');
  return {snapshotId:id};
}
function qboDailyV1289VerifyCompletion_(claim, startedAt, metadata) {
  const spreadsheet = getQboRunHistorySpreadsheet_();
  const sheet = spreadsheet.getSheetByName(QBO_RUN_HISTORY.EXPORTS_SHEET);
  if (!sheet) throw new Error('V1289 export history sheet missing');
  const rowNumber = findQboExportRunRow_(sheet, claim.runId, claim.exportKey);
  if (!rowNumber) throw new Error('V1289 export history row missing');
  SpreadsheetApp.flush();
  const row = sheet.getRange(rowNumber,1,1,12).getValues()[0];
  const proof = qboDailyV1289ValidateRow_(row, claim, startedAt, metadata);
  proof.row = rowNumber;
  return proof;
}
function testQboDailyCompletionProofV1289() {
  const claim={runId:'run',index:21,exportKey:'INVOICES'};
  const started=new Date('2026-11-03T13:00:00Z');
  const meta={masterBackupFileId:'snapshot-id',masterBackupFileName:'snapshot-name',observationCount:18046};
  const row=['run',22,'INVOICES','export',started,new Date('2026-11-03T13:01:00Z'),'COMPLETE',1000,'','snapshot-id','snapshot-name',18046];
  let passed=0;
  function ok(x){if(!x)throw new Error('V1289 assertion '+passed);passed++;}
  function reject(change){const x=row.slice();change(x);let rejected=false;
    try{qboDailyV1289ValidateRow_(x,claim,started,meta);}catch(e){rejected=true;}ok(rejected);}
  ok(qboDailyV1289ValidateRow_(row,claim,started,meta).snapshotId==='snapshot-id');
  reject(x=>x[0]='wrong'); reject(x=>x[1]=21);reject(x=>x[2]='BILLS');
  reject(x=>x[4]=new Date('2026-11-03T12:00:00Z'));
  reject(x=>x[5]='');reject(x=>x[6]='RUNNING');
  reject(x=>x[9]='other');reject(x=>x[10]='other');reject(x=>x[11]=18045);
  let bad=false;try{qboDailyV1289ValidateRow_(row,claim,started,{masterBackupFileId:'',masterBackupFileName:'x',observationCount:0});}catch(e){bad=true;}ok(bad);
  console.log('[DAILY V1289] | TEST PASS | '+JSON.stringify({version:QBO_DAILY_V1289_VERSION,casesPassed:passed,mutations:0,automaticRecoveryEnabled:false}));
}
function previewQboDailyCompletionProofV1289() {
 const p=PropertiesService.getScriptProperties(),q=DAILY_QBO_QUEUE_PROPERTIES;
 const result={version:QBO_DAILY_V1289_VERSION,readOnly:true,
  paused:p.getProperty(QBO_DAILY_V1279_PAUSE_KEY)==='true',
  runId:p.getProperty(q.RUN_ID)||'',activeClaimPresent:!!p.getProperty(q.ACTIVE_TOKEN),
  checkpointPresent:!!p.getProperty(QBO_DAILY_V1284_KEY),
  completionGateIntegrated:true,queueAdvanceCheckpointIntegrated:false,
  exporterWriteFencingIntegrated:false,automaticRecoveryEnabled:false};
 console.log('[DAILY V1289] | READ_ONLY | '+JSON.stringify(result));return result;
}
