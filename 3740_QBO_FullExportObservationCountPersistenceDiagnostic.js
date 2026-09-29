/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3740_QBO_FullExportObservationCountPersistenceDiagnostic.js
 * Purpose     : Read-only diagnostic for Phase C ObservationCount persistence.
 * Version     : 1.5.145
 * Date        : 2026-09-16
 * ============================================================================
 */
function diagnoseQboFullExportObservationCountPersistence() {
  const rh = getQboRunHistorySpreadsheet_();
  const sc = getQboStateCaptureSpreadsheet_();
  const hs = rh.getSheetByName(QBO_RUN_HISTORY.EXPORTS_SHEET);
  const ss = sc.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
  if (!hs || !ss) throw new Error('Required history/source sheet missing.');

  const hVals = hs.getDataRange().getValues();
  const hHdr = hVals[0].map(v => String(v || '').trim());
  const hm = {}; hHdr.forEach((h,i)=>{ if(h) hm[h]=i; });
  const sVals = ss.getDataRange().getValues();
  const sHdr = sVals[0].map(v => String(v || '').trim());
  const sm = {}; sHdr.forEach((h,i)=>{ if(h) sm[h]=i; });

  let best = null, bestRowNumber = 0, bestTime = -1;
  for (let i=1;i<hVals.length;i++) {
    const r=hVals[i];
    const runId=String(r[hm.RunId]||'');
    if (!runId.startsWith('STATE_CAPTURE_AUTOREG_TEST_')) continue;
    if (String(r[hm.ExportKey]||'') !== 'PAYMENT_METHODS') continue;
    const t = r[hm.CompletedAt] instanceof Date ? r[hm.CompletedAt].getTime() : new Date(r[hm.CompletedAt]).getTime();
    const n = Number.isFinite(t) ? t : 0;
    if (!best || n >= bestTime) { best=r; bestRowNumber=i+1; bestTime=n; }
  }
  if (!best) throw new Error('No controlled PAYMENT_METHODS history row found.');

  const runId=String(best[hm.RunId]||'');
  const sourceId='FULL_EXPORT|' + runId + '|PAYMENT_METHODS';
  let src=null, srcRowNumber=0;
  for (let i=1;i<sVals.length;i++) {
    if (String(sVals[i][sm.SourceId]||'') === sourceId) { src=sVals[i]; srcRowNumber=i+1; break; }
  }

  const historyDirectL = hs.getRange(bestRowNumber, 12).getValue();
  const sourceDirectT = srcRowNumber ? ss.getRange(srcRowNumber, 20).getValue() : null;
  const result = {
    version:'1.5.145', operation:'READ_ONLY_PERSISTENCE_DIAGNOSTIC',
    history:{sheet:hs.getName(), lastColumn:hs.getLastColumn(), headers:hHdr, rowNumber:bestRowNumber, runId:runId,
      status:best[hm.Status], masterBackupFileId:best[hm.MasterBackupFileId], masterBackupFileName:best[hm.MasterBackupFileName],
      observationCountByHeader:best[hm.ObservationCount], observationCountDirectColumn12:historyDirectL,
      observationHeaderIndexZeroBased:hm.ObservationCount},
    source:{sheet:ss.getName(), lastColumn:ss.getLastColumn(), headers:sHdr, rowNumber:srcRowNumber, sourceId:sourceId, present:!!src,
      observationCountByHeader:src ? src[sm.ObservationCount] : null, observationCountDirectColumn20:sourceDirectT,
      observationHeaderIndexZeroBased:sm.ObservationCount}
  };
  console.log(JSON.stringify(result,null,2));
  return result;
}
