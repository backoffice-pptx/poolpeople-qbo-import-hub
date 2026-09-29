/**
 * Module  : 4032_QBO_FullExportObservationCountHistoricalPreApplyGate.js
 * Version : 1.5.152
 * Purpose : Read-only pre-apply drift/revalidation gate for the completed
 *           frozen historical FULL_EXPORT ObservationCount plan.
 *
 * Operator:
 *   validateQboFullExportObservationCountHistoricalPreApplyGate()
 *
 * Safety:
 *   - NO production writes.
 *   - NO locks / workbook write lease.
 *   - NO trigger mutation.
 *   - Does NOT reopen MasterBackups; immutable evidence was validated by the
 *     frozen preview. This gate validates current target identities/cells.
 *   - Missing 01 sources remain excluded; none are created.
 */
const QBO_FE_OBS_HIST_PREAPPLY_ = Object.freeze({
  VERSION: '1.5.152',
  PREVIEW_STATE_KEY: 'QBO_FE_OBS_HIST_PREVIEW_V148_STATE',
  PREVIEW_RESULT_PREFIX: 'QBO_FE_OBS_HIST_PREVIEW_V148_RESULT_',
  HISTORY_SHEET: 'QBO_ExportRunHistory',
  SOURCE_SHEET: '01_Sources',
  STRANDED_RUN_IDS: Object.freeze(['9ff6e204-18d8-4f81-b965-7749429886b3'])
});

function validateQboFullExportObservationCountHistoricalPreApplyGate() {
  const C = QBO_FE_OBS_HIST_PREAPPLY_;
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(C.PREVIEW_STATE_KEY);
  if (!raw) throw new Error('Frozen historical preview state not found.');
  const state = JSON.parse(raw);
  if (state.status !== 'COMPLETE' ||
      Number(state.processedCount) !== Number(state.candidateCount)) {
    throw new Error('Frozen historical preview is not COMPLETE.');
  }

  const hs = qboFeObsPreApplyOpenRunHistory_().getSheetByName(C.HISTORY_SHEET);
  const ss = qboFeObsPreApplyOpenStateCapture_().getSheetByName(C.SOURCE_SHEET);
  const h = qboFeObsPreApplyRead_(hs);
  const s = qboFeObsPreApplyRead_(ss);

  qboFeObsPreApplyRequire_(h.map, [
    'RunId','ExportKey','Status','MasterBackupFileId','MasterBackupFileName','ObservationCount'
  ], C.HISTORY_SHEET);
  qboFeObsPreApplyRequire_(s.map, [
    'SourceId','SourceAcquisitionType','SourceRunId','ExportKey',
    'MasterBackupFileId','MasterBackupFileName','ObservationCount'
  ], C.SOURCE_SHEET);

  const sourceById = {};
  s.rows.forEach(function(r) {
    const id = String(r.values[s.map.SourceId] || '').trim();
    if (id) sourceById[id] = r;
  });

  const counts = {
    frozenCandidates:Number(state.candidateCount),
    checkedCandidates:0,
    historyWriteTargetsStillBlank:0,
    sourceWriteTargetsStillBlank:0,
    historyAlreadyMatchesStillMatch:0,
    sourceAlreadyMatchesStillMatch:0,
    controlledTestMissingSourcesStillAbsent:0,
    strandedRunMissingSourcesStillAbsent:0,
    identityDrift:0,
    targetValueDrift:0,
    excludedSourcePresenceDrift:0,
    missingFrozenResult:0
  };
  const findings = [];

  for (let i=0; i<Number(state.processedCount); i++) {
    const rr = props.getProperty(C.PREVIEW_RESULT_PREFIX + state.previewRunId + '_' + i);
    if (!rr) {
      counts.missingFrozenResult++;
      findings.push({candidateIndex:i,type:'MISSING_FROZEN_RESULT'});
      continue;
    }
    const r = JSON.parse(rr);
    counts.checkedCandidates++;

    if (r.kind === 'RUN_HISTORY') {
      const current = h.byRow[r.historyRow];
      if (!current ||
          String(current[h.map.RunId] || '').trim() !== String(r.runId || '') ||
          String(current[h.map.ExportKey] || '').trim() !== String(r.exportKey || '') ||
          String(current[h.map.MasterBackupFileId] || '').trim() !== String(r.masterBackupFileId || '') ||
          String(current[h.map.MasterBackupFileName] || '').trim() !== String(r.masterBackupFileName || '') ||
          String(current[h.map.Status] || '').trim().toUpperCase() !== 'COMPLETE') {
        counts.identityDrift++;
        findings.push({
          candidateIndex:i,type:'RUN_HISTORY_IDENTITY_DRIFT',
          runId:r.runId,exportKey:r.exportKey,historyRow:r.historyRow
        });
      } else {
        const hv = qboFeObsPreApplyNullable_(current[h.map.ObservationCount]);
        if (r.historyDisposition === 'PROPOSE_WRITE') {
          if (hv === null) counts.historyWriteTargetsStillBlank++;
          else {
            counts.targetValueDrift++;
            findings.push({
              candidateIndex:i,type:'HISTORY_TARGET_VALUE_DRIFT',
              runId:r.runId,exportKey:r.exportKey,expectedPreWrite:null,currentValue:hv
            });
          }
        } else if (r.historyDisposition === 'ALREADY_MATCHES') {
          if (hv === Number(r.derivedObservationCount)) counts.historyAlreadyMatchesStillMatch++;
          else {
            counts.targetValueDrift++;
            findings.push({
              candidateIndex:i,type:'HISTORY_ALREADY_MATCH_VALUE_DRIFT',
              runId:r.runId,exportKey:r.exportKey,
              expected:Number(r.derivedObservationCount),currentValue:hv
            });
          }
        }
      }
    }

    if (r.sourceDisposition === 'PROPOSE_WRITE' ||
        r.sourceDisposition === 'ALREADY_MATCHES') {
      const sr = sourceById[String(r.sourceId || '')];
      if (!sr ||
          sr.rowNumber !== Number(r.sourceRow) ||
          String(sr.values[s.map.ExportKey] || '').trim() !== String(r.exportKey || '') ||
          String(sr.values[s.map.MasterBackupFileId] || '').trim() !== String(r.masterBackupFileId || '') ||
          String(sr.values[s.map.MasterBackupFileName] || '').trim() !== String(r.masterBackupFileName || '')) {
        counts.identityDrift++;
        findings.push({
          candidateIndex:i,type:'SOURCE_IDENTITY_DRIFT',
          sourceId:r.sourceId,sourceRow:r.sourceRow
        });
      } else {
        const sv = qboFeObsPreApplyNullable_(sr.values[s.map.ObservationCount]);
        if (r.sourceDisposition === 'PROPOSE_WRITE') {
          if (sv === null) counts.sourceWriteTargetsStillBlank++;
          else {
            counts.targetValueDrift++;
            findings.push({
              candidateIndex:i,type:'SOURCE_TARGET_VALUE_DRIFT',
              sourceId:r.sourceId,expectedPreWrite:null,currentValue:sv
            });
          }
        } else {
          if (sv === Number(r.derivedObservationCount)) counts.sourceAlreadyMatchesStillMatch++;
          else {
            counts.targetValueDrift++;
            findings.push({
              candidateIndex:i,type:'SOURCE_ALREADY_MATCH_VALUE_DRIFT',
              sourceId:r.sourceId,
              expected:Number(r.derivedObservationCount),currentValue:sv
            });
          }
        }
      }
    } else if (r.sourceDisposition === 'SOURCE_MISSING') {
      const sr = sourceById[String(r.sourceId || '')];
      if (sr) {
        counts.excludedSourcePresenceDrift++;
        findings.push({
          candidateIndex:i,type:'EXCLUDED_MISSING_SOURCE_NOW_PRESENT',
          sourceId:r.sourceId,sourceRow:sr.rowNumber
        });
      } else {
        const runId=String(r.runId || '');
        if (runId.indexOf('STATE_CAPTURE_AUTOREG_TEST_') === 0) {
          counts.controlledTestMissingSourcesStillAbsent++;
        } else if (C.STRANDED_RUN_IDS.indexOf(runId) >= 0) {
          counts.strandedRunMissingSourcesStillAbsent++;
        } else {
          findings.push({
            candidateIndex:i,type:'UNCLASSIFIED_MISSING_SOURCE',
            sourceId:r.sourceId
          });
        }
      }
    }
  }

  const expected = {
    historyWriteTargets:314,
    sourceWriteTargets:336,
    historyAlreadyMatches:1,
    sourceAlreadyMatches:1,
    controlledTestMissingSources:2,
    strandedRunMissingSources:2
  };

  const exactCountsMatch =
    counts.historyWriteTargetsStillBlank === expected.historyWriteTargets &&
    counts.sourceWriteTargetsStillBlank === expected.sourceWriteTargets &&
    counts.historyAlreadyMatchesStillMatch === expected.historyAlreadyMatches &&
    counts.sourceAlreadyMatchesStillMatch === expected.sourceAlreadyMatches &&
    counts.controlledTestMissingSourcesStillAbsent === expected.controlledTestMissingSources &&
    counts.strandedRunMissingSourcesStillAbsent === expected.strandedRunMissingSources;

  const out = {
    version:C.VERSION,
    operation:'READ_ONLY_HISTORICAL_OBSERVATIONCOUNT_PRE_APPLY_GATE',
    sourcePreview:{
      previewRunId:state.previewRunId,
      previewVersion:state.version,
      frozenAt:state.frozenAt,
      status:state.status
    },
    expected:expected,
    observed:counts,
    findings:findings,
    safety:{
      productionWritesPerformed:false,
      locksAcquired:false,
      workbookWriteLeaseAcquired:false,
      triggerMutationPerformed:false,
      masterBackupsReopened:false,
      missingSourceCreationAllowed:false
    },
    validForControlledApply:
      counts.checkedCandidates === counts.frozenCandidates &&
      counts.missingFrozenResult === 0 &&
      counts.identityDrift === 0 &&
      counts.targetValueDrift === 0 &&
      counts.excludedSourcePresenceDrift === 0 &&
      exactCountsMatch &&
      findings.length === 0
  };
  console.log(JSON.stringify(out, null, 2));
  return out;
}

function qboFeObsPreApplyRead_(sheet) {
  if (!sheet) throw new Error('Required sheet not found.');
  const v=sheet.getDataRange().getValues();
  const headers=v.length?v[0].map(function(x){return String(x||'').trim();}):[];
  const map={},rows=[],byRow={};
  headers.forEach(function(h,i){if(h)map[h]=i;});
  for(let i=1;i<v.length;i++){
    const r={rowNumber:i+1,values:v[i]};
    rows.push(r); byRow[i+1]=v[i];
  }
  return {map:map,rows:rows,byRow:byRow};
}
function qboFeObsPreApplyRequire_(m,a,n){
  a.forEach(function(h){if(m[h]===undefined)throw new Error(n+' missing '+h);});
}
function qboFeObsPreApplyNullable_(v){
  return v===''||v===null||v===undefined?null:Number(v);
}
function qboFeObsPreApplyOpenRunHistory_(){
  if(typeof getQboRunHistorySpreadsheet_==='function')return getQboRunHistorySpreadsheet_();
  if(typeof openQboRunHistorySpreadsheet_==='function')return openQboRunHistorySpreadsheet_();
  if(typeof QBO_RUN_HISTORY_CONFIG!=='undefined'&&QBO_RUN_HISTORY_CONFIG.SPREADSHEET_ID)
    return SpreadsheetApp.openById(QBO_RUN_HISTORY_CONFIG.SPREADSHEET_ID);
  if(typeof QBO_RUN_HISTORY!=='undefined'&&QBO_RUN_HISTORY.SPREADSHEET_ID)
    return SpreadsheetApp.openById(QBO_RUN_HISTORY.SPREADSHEET_ID);
  throw new Error('Unable to resolve run-history workbook.');
}
function qboFeObsPreApplyOpenStateCapture_(){
  if(typeof getQboStateCaptureSpreadsheet_==='function')return getQboStateCaptureSpreadsheet_();
  if(typeof openQboStateCaptureSpreadsheet_==='function')return openQboStateCaptureSpreadsheet_();
  if(typeof QBO_STATE_CAPTURE_CONFIG!=='undefined'&&QBO_STATE_CAPTURE_CONFIG.SPREADSHEET_ID)
    return SpreadsheetApp.openById(QBO_STATE_CAPTURE_CONFIG.SPREADSHEET_ID);
  if(typeof QBO_STATE_CAPTURE!=='undefined'&&QBO_STATE_CAPTURE.SPREADSHEET_ID)
    return SpreadsheetApp.openById(QBO_STATE_CAPTURE.SPREADSHEET_ID);
  throw new Error('Unable to resolve State Capture workbook.');
}
