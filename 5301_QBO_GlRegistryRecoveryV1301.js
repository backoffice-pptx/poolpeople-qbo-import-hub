/**
 * Generic GL run-registry blank ExtractedAt repair, v1.5.301.
 * No period or run identifiers are embedded in production logic.
 * Preview and apply select only a single incomplete V2 registry row for the
 * last closed calendar month. Apply is explicit and fails closed on ambiguity.
 */
function qboGlRegistryCellEqualV1301_(left, right) {
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date &&
      !isNaN(left.getTime()) && !isNaN(right.getTime()) &&
      qboGeneralLedgerDateText_(left) === qboGeneralLedgerDateText_(right);
  }
  return String(left === null || left === undefined ? '' : left) ===
    String(right === null || right === undefined ? '' : right);
}

function qboGlRegistryRepairPlanV1301_() {
  const ss = getQboGeneralLedgerReportSpreadsheet_();
  const sheet = ss.getSheetByName(QBO_GENERAL_LEDGER_REPORT.RUNS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return {status:'NO_REGISTRY_ROWS', candidates:[]};
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function(v) {return String(v || '').trim();});
  const idx = {};
  QBO_GENERAL_LEDGER_RUN_HEADERS.forEach(function(h) {
    idx[h] = headers.indexOf(h);
    if (idx[h] < 0) throw new Error('GL_REGISTRY_V1301_HEADER_MISSING: ' + h);
  });
  const period = resolveQboGeneralLedgerExportPeriod_();
  const candidates = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (qboGeneralLedgerDateText_(row[idx.ReportStartDate]) !== period.startDate ||
        qboGeneralLedgerDateText_(row[idx.ReportEndDate]) !== period.endDate) continue;
    if (row[idx.ExtractedAt] !== '' && row[idx.ExtractedAt] !== null) continue;
    candidates.push({registryRow:i+1, runId:String(row[idx.ExtractRunId] || ''),
      snapshotId:String(row[idx.SnapshotFileId] || ''), rowCount:Number(row[idx.RowCount]),
      contract:String(row[idx.SnapshotArtifactContract] || ''), raw:row, idx:idx});
  }
  if (candidates.length !== 1) return {status:candidates.length ? 'AMBIGUOUS' : 'NO_BLANK_TIMESTAMP',
    period:period, candidateCount:candidates.length,
    candidates:candidates.map(function(c){return {registryRow:c.registryRow,runId:c.runId,snapshotId:c.snapshotId};})};
  const c = candidates[0];
  if (!c.runId || !c.snapshotId || c.contract !== QBO_GENERAL_LEDGER_SNAPSHOT_ARTIFACT_CONTRACT_V2 ||
      !Number.isInteger(c.rowCount) || c.rowCount < 0 ||
      String(c.raw[idx.SpreadsheetId]) !== ss.getId() ||
      String(c.raw[idx.ReportName]) !== 'GeneralLedger' ||
      String(c.raw[idx.ReportBasis]) !== 'Cash') throw new Error('GL_REGISTRY_V1301_IDENTITY_INVALID');
  // Verify exact snapshot rows, metadata, and extractedAt before proposing any mutation.
  const snap = SpreadsheetApp.openById(c.snapshotId);
  if (String(snap.getName()) !== String(c.raw[idx.SnapshotFileName])) throw new Error('GL_REGISTRY_V1301_SNAPSHOT_NAME_CONFLICT');
  const metadata = snap.getSheetByName(QBO_GENERAL_LEDGER_SNAPSHOT_METADATA_SHEET);
  if (!metadata) throw new Error('GL_REGISTRY_V1301_METADATA_MISSING');
  const meta = {};
  metadata.getDataRange().getValues().slice(1).forEach(function(r) {meta[String(r[0] || '').trim()] = r[1];});
  const at = meta.ExtractedAt;
  if (!(at instanceof Date) || isNaN(at.getTime())) throw new Error('GL_REGISTRY_V1301_SNAPSHOT_TIMESTAMP_INVALID');
  if (String(meta.ReportName) !== 'GeneralLedger' || String(meta.ReportBasis) !== 'Cash') throw new Error('GL_REGISTRY_V1301_SNAPSHOT_REPORT_CONFLICT');
  validateQboGeneralLedgerRunSnapshotV2_(c.snapshotId,c.runId,period.startDate,period.endDate,c.rowCount,at);
  const data = ss.getSheetByName(QBO_GENERAL_LEDGER_REPORT.DATA_SHEET);
  if (!data) throw new Error('GL_REGISTRY_V1301_DATA_MISSING');
  const d = data.getDataRange().getValues();
  const dh = d[0].map(function(v){return String(v || '').trim();});
  const di = {};
  ['ExtractRunId','ExtractedAt','ReportStartDate','ReportEndDate'].forEach(function(h){di[h]=dh.indexOf(h);if(di[h]<0)throw new Error('GL_REGISTRY_V1301_DATA_HEADER_MISSING: '+h);});
  const matched = d.slice(1).filter(function(r){return String(r[di.ExtractRunId])===c.runId && qboGeneralLedgerDateText_(r[di.ReportStartDate])===period.startDate && qboGeneralLedgerDateText_(r[di.ReportEndDate])===period.endDate;});
  if (matched.length !== c.rowCount || !matched.every(function(r){return qboGeneralLedgerTimestampsMatchToSecond_(r[di.ExtractedAt],at);})) throw new Error('GL_REGISTRY_V1301_DATA_IDENTITY_CONFLICT');
  return {status:'READY_TO_REPAIR', period:period,registryRow:c.registryRow,runId:c.runId,
    snapshotId:c.snapshotId,rowCount:c.rowCount,extractedAt:at.toISOString(),
    candidateCount:1};
}

function previewLastClosedMonthGlRegistryRepairV1301() {
  const plan = qboGlRegistryRepairPlanV1301_();
  const result = {version:'1.5.301',mode:'READ_ONLY',productionWrites:0,
    status:plan.status,period:plan.period || null,runId:plan.runId || '',
    registryRow:plan.registryRow || null,snapshotId:plan.snapshotId || '',
    rowCount:plan.rowCount || 0,extractedAt:plan.extractedAt || '',
    candidateCount:plan.candidateCount || 0,candidates:plan.candidates || []};
  safeLog_('[GL REGISTRY V1301] | PREVIEW | '+JSON.stringify(result));
  return result;
}

function applyLastClosedMonthGlRegistryRepairV1301() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('GL_REGISTRY_V1301_LOCK_BUSY');
  try {
    const plan = qboGlRegistryRepairPlanV1301_();
    if (plan.status !== 'READY_TO_REPAIR') throw new Error('GL_REGISTRY_V1301_NOT_READY: '+plan.status);
    const ss = getQboGeneralLedgerReportSpreadsheet_();
    const sheet = ss.getSheetByName(QBO_GENERAL_LEDGER_REPORT.RUNS_SHEET);
    const cell = sheet.getRange(plan.registryRow,2);
    if (cell.getValue() !== '') throw new Error('GL_REGISTRY_V1301_CONCURRENT_CHANGE');
    cell.setValue(new Date(plan.extractedAt));
    cell.setNumberFormat('yyyy-mm-dd hh:mm:ss');
    SpreadsheetApp.flush();
    if (!qboGeneralLedgerTimestampsMatchToSecond_(cell.getValue(),new Date(plan.extractedAt))) throw new Error('GL_REGISTRY_V1301_POSTWRITE_MISMATCH');
    const result = {version:'1.5.301',status:'REPAIRED',productionWrites:1,runId:plan.runId,
      registryRow:plan.registryRow,snapshotId:plan.snapshotId,extractedAt:plan.extractedAt};
    safeLog_('[GL REGISTRY V1301] | APPLY | '+JSON.stringify(result));
    return result;
  } finally {lock.releaseLock();}
}

function testGlRegistryTimestampRecoveryV1301() {
  const d = new Date('2026-01-01T12:00:00Z');
  const checks = [
    qboGlRegistryCellEqualV1301_('x','x'),
    !qboGlRegistryCellEqualV1301_('x','y'),
    qboGlRegistryCellEqualV1301_(new Date(d),new Date(d)),
    !qboGlRegistryCellEqualV1301_(new Date(d),'not-a-date'),
    qboGeneralLedgerTimestampsMatchToSecond_(new Date(d.getTime()+250),d),
    !qboGeneralLedgerTimestampsMatchToSecond_(new Date(d.getTime()+2000),d)
  ];
  if (checks.some(function(v){return !v;})) throw new Error('GL_REGISTRY_V1301_TEST_FAILED');
  const result={version:'1.5.301',status:'PASS',casesPassed:checks.length,productionWrites:0};
  safeLog_('[GL REGISTRY V1301] | TEST | '+JSON.stringify(result));
  return result;
}
