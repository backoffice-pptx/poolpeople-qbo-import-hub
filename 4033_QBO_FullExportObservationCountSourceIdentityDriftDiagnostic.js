/**
 * Module  : 4033_QBO_FullExportObservationCountSourceIdentityDriftDiagnostic.js
 * Version : 1.5.153
 * Purpose : Narrow read-only field-by-field diagnostic for the three
 *           SOURCE_IDENTITY_DRIFT findings from the v1.5.152 pre-apply gate.
 *
 * Operator:
 *   diagnoseQboFullExportObservationCountSourceIdentityDrift()
 *
 * Safety: read-only; no locks, leases, triggers, or production writes.
 */
const QBO_FE_OBS_SOURCE_DRIFT_ = Object.freeze({
  VERSION: '1.5.153',
  PREVIEW_STATE_KEY: 'QBO_FE_OBS_HIST_PREVIEW_V148_STATE',
  PREVIEW_RESULT_PREFIX: 'QBO_FE_OBS_HIST_PREVIEW_V148_RESULT_',
  SOURCE_SHEET: '01_Sources',
  TARGET_INDEXES: Object.freeze([216,217,218])
});

function diagnoseQboFullExportObservationCountSourceIdentityDrift() {
  const C=QBO_FE_OBS_SOURCE_DRIFT_;
  const props=PropertiesService.getScriptProperties();
  const raw=props.getProperty(C.PREVIEW_STATE_KEY);
  if(!raw) throw new Error('Frozen historical preview state not found.');
  const state=JSON.parse(raw);
  if(state.status!=='COMPLETE') throw new Error('Frozen preview is not COMPLETE.');

  const ss=qboFeObsDriftOpenStateCapture_();
  const sh=ss.getSheetByName(C.SOURCE_SHEET);
  if(!sh) throw new Error('01_Sources not found.');
  const values=sh.getDataRange().getValues();
  const headers=values[0].map(function(x){return String(x||'').trim();});
  const map={};
  headers.forEach(function(h,i){if(h)map[h]=i;});
  ['SourceId','SourceAcquisitionType','SourceRunId','ExportKey',
   'MasterBackupFileId','MasterBackupFileName','ObservationCount']
    .forEach(function(h){if(map[h]===undefined)throw new Error('01_Sources missing '+h);});

  const byId={};
  for(let i=1;i<values.length;i++){
    const id=String(values[i][map.SourceId]||'').trim();
    if(!id)continue;
    if(!byId[id])byId[id]=[];
    byId[id].push({rowNumber:i+1,values:values[i]});
  }

  const results=[];
  C.TARGET_INDEXES.forEach(function(idx){
    const rr=props.getProperty(C.PREVIEW_RESULT_PREFIX+state.previewRunId+'_'+idx);
    if(!rr) throw new Error('Frozen result missing for candidate '+idx);
    const r=JSON.parse(rr);
    const matches=byId[String(r.sourceId||'')]||[];
    const frozen={
      sourceRow:Number(r.sourceRow),
      sourceId:String(r.sourceId||''),
      sourceAcquisitionType:String(r.sourceAcquisitionType||r.kind||''),
      sourceRunId:String(r.sourceRunId||r.runId||''),
      exportKey:String(r.exportKey||''),
      masterBackupFileId:String(r.masterBackupFileId||''),
      masterBackupFileName:String(r.masterBackupFileName||''),
      observationCount:r.frozenSourceObservationCount
    };

    const current=matches.map(function(m){
      return {
        rowNumber:m.rowNumber,
        sourceId:String(m.values[map.SourceId]||'').trim(),
        sourceAcquisitionType:String(m.values[map.SourceAcquisitionType]||'').trim(),
        sourceRunId:String(m.values[map.SourceRunId]||'').trim(),
        exportKey:String(m.values[map.ExportKey]||'').trim(),
        masterBackupFileId:String(m.values[map.MasterBackupFileId]||'').trim(),
        masterBackupFileName:String(m.values[map.MasterBackupFileName]||'').trim(),
        observationCount:qboFeObsDriftNullable_(m.values[map.ObservationCount])
      };
    });

    const atFrozenRow=(Number(r.sourceRow)>=2 && Number(r.sourceRow)<=values.length)
      ? qboFeObsDriftRow_(values[Number(r.sourceRow)-1],Number(r.sourceRow),map)
      : null;

    const diffs=current.map(function(c){
      return {
        rowNumber:c.rowNumber,
        rowMoved:c.rowNumber!==Number(r.sourceRow),
        exportKey:{frozen:frozen.exportKey,current:c.exportKey,match:frozen.exportKey===c.exportKey},
        masterBackupFileId:{frozen:frozen.masterBackupFileId,current:c.masterBackupFileId,
          match:frozen.masterBackupFileId===c.masterBackupFileId},
        masterBackupFileName:{frozen:frozen.masterBackupFileName,current:c.masterBackupFileName,
          match:frozen.masterBackupFileName===c.masterBackupFileName},
        observationCount:{frozen:frozen.observationCount,current:c.observationCount,
          match:qboFeObsDriftSameNullable_(frozen.observationCount,c.observationCount)}
      };
    });

    results.push({
      candidateIndex:idx,
      frozen:frozen,
      currentRowsWithExactSourceId:current,
      exactSourceIdMatchCount:current.length,
      currentContentAtFrozenRow:atFrozenRow,
      differencesForExactSourceIdRows:diffs
    });
  });

  const out={
    version:C.VERSION,
    operation:'READ_ONLY_SOURCE_IDENTITY_DRIFT_DIAGNOSTIC',
    sourcePreview:{previewRunId:state.previewRunId,frozenAt:state.frozenAt},
    targetCandidateIndexes:C.TARGET_INDEXES,
    results:results,
    safety:{
      productionWritesPerformed:false,
      locksAcquired:false,
      workbookWriteLeaseAcquired:false,
      triggerMutationPerformed:false
    }
  };
  console.log(JSON.stringify(out,null,2));
  return out;
}
function qboFeObsDriftRow_(v,row,map){
  return {
    rowNumber:row,
    sourceId:String(v[map.SourceId]||'').trim(),
    sourceAcquisitionType:String(v[map.SourceAcquisitionType]||'').trim(),
    sourceRunId:String(v[map.SourceRunId]||'').trim(),
    exportKey:String(v[map.ExportKey]||'').trim(),
    masterBackupFileId:String(v[map.MasterBackupFileId]||'').trim(),
    masterBackupFileName:String(v[map.MasterBackupFileName]||'').trim(),
    observationCount:qboFeObsDriftNullable_(v[map.ObservationCount])
  };
}
function qboFeObsDriftNullable_(v){
  return v===''||v===null||v===undefined?null:Number(v);
}
function qboFeObsDriftSameNullable_(a,b){
  const aa=(a===''||a===null||a===undefined)?null:Number(a);
  const bb=(b===''||b===null||b===undefined)?null:Number(b);
  return aa===bb;
}
function qboFeObsDriftOpenStateCapture_(){
  if(typeof getQboStateCaptureSpreadsheet_==='function')return getQboStateCaptureSpreadsheet_();
  if(typeof openQboStateCaptureSpreadsheet_==='function')return openQboStateCaptureSpreadsheet_();
  if(typeof QBO_STATE_CAPTURE_CONFIG!=='undefined'&&QBO_STATE_CAPTURE_CONFIG.SPREADSHEET_ID)
    return SpreadsheetApp.openById(QBO_STATE_CAPTURE_CONFIG.SPREADSHEET_ID);
  if(typeof QBO_STATE_CAPTURE!=='undefined'&&QBO_STATE_CAPTURE.SPREADSHEET_ID)
    return SpreadsheetApp.openById(QBO_STATE_CAPTURE.SPREADSHEET_ID);
  throw new Error('Unable to resolve State Capture workbook.');
}
