/** App 50 v1.5.270 — Phase G row-fidelity certification PRE-FLIGHT ONLY.
 * No changes to Phase G workbook, immutable evidence, daily exports, or triggers.
 * This deliberately does not claim row-level certification.
 */
const QBO_PG270_=Object.freeze({V:'1.5.270',WB:'1VmeTHHViWSW981U82cWikbZrUT_aiymh2LVDWtUknnI',KEY:'QBO_PHASE_G_FIDELITY_V1270_PREFLIGHT',FIELDS:['EntityType','EntityId','ObservedAt','ObservationId','SourceType','SourceRunId','SourceUnitId','PayloadOrdinal','SourceOperation','AdmissionStatus']});
function inspectQboPhaseGRowFidelityPreflightV1270(){
 const C=QBO_PG270_,p=PropertiesService.getScriptProperties();
 const g=JSON.parse(p.getProperty('QBO_PHASE_G_GLOBAL_TIE_V1219_STATE')||'null');
 const d=JSON.parse(p.getProperty('QBO_PHASE_G_DOMAIN_V1267_STATE')||'null');
 const s=JSON.parse(p.getProperty('QBO_PHASE_G_SOURCE_V1268_STATE')||'null');
 if(!g||g.status!=='COMPLETE_GLOBAL_EQUAL_TIME_DIAGNOSTIC'||g.workbookId!==C.WB||g.manifestCursor!==2418||g.partitionCursor!==64||g.observationCount!==734858||g.admittedCount!==734786||g.evidenceExceptionCount!==52||g.blockedCount!==20||g.writeJournalV1231)throw Error('V1270_PHASE_G_AUTHORITY_NOT_COMPLETE');
 if(!d||d.status!=='COMPLETE_INVENTORY_NOT_CERTIFIED'||d.completed!==64||d.rows!==734858)throw Error('V1270_V1267_INVENTORY_NOT_COMPLETE');
 if(!s||s.status!=='COMPLETE_SOURCE_CENSUS_NOT_CERTIFIED'||s.manifestCursor!==2418||s.rows!==734858||s.admitted!==734786||s.exceptions!==52||s.blocked!==20)throw Error('V1270_V1268_SOURCE_CENSUS_NOT_COMPLETE');
 if(p.getProperty('QBO_PHASE_G_SOURCE_V1268_STATE_JOURNAL'))throw Error('V1270_V1268_PENDING_JOURNAL');
 const sources=qboPg268Empty_(-1),domains={rows:0,blanks:Array(10).fill(0),invalid:Array(10).fill(0)};
 const partitionCounts=[];
 for(let i=0;i<64;i++){
  const key=('0'+i).slice(-2),a=JSON.parse(p.getProperty('QBO_PHASE_G_SOURCE_V1268_P_'+key)||'null'),b=JSON.parse(p.getProperty('QBO_PHASE_G_DOMAIN_V1267_P_'+key)||'null');
  if(!a||!b||b.partition!=='P_'+key)throw Error('V1270_MISSING_PARTITION_CENSUS '+key);
  qboPg268Merge_(sources,a);domains.rows+=b.rows;
  for(let c=0;c<10;c++){domains.blanks[c]+=b.blanks[c];domains.invalid[c]+=b.invalid[c];}
  if(a.rows!==b.rows||a.rows!==g.journaledRecoveryV1231.partitionRows[i])throw Error('V1270_PARTITION_POPULATION_MISMATCH '+key);
  partitionCounts.push(a.rows);
 }
 if(sources.rows!==s.rows||sources.admitted!==s.admitted||sources.exceptions!==s.exceptions||sources.blocked!==s.blocked||domains.rows!==s.rows)throw Error('V1270_GLOBAL_CENSUS_MISMATCH');
 if(sources.ordinalZero!==3454||domains.blanks[7]!==3454||sources.ordinalEmpty!==0||sources.ordinalNull!==0||sources.ordinalMissing!==0||domains.blanks[5]!==67812||sources.sourceRunEmpty!==67812)throw Error('V1270_EXPECTED_FIELD_DOMAIN_MISMATCH');
 if(domains.invalid.some(x=>x!==0)||sources.invalid!==0)throw Error('V1270_INVALID_FIELD_DOMAIN');
 const wb=SpreadsheetApp.openById(C.WB),sheetCounts=[];
 for(let i=0;i<64;i++){
  const name='P_'+('0'+i).slice(-2),sh=wb.getSheetByName(name);
  if(!sh)throw Error('V1270_MISSING_SHEET '+name);
  const headers=sh.getRange(1,1,1,10).getDisplayValues()[0];
  if(JSON.stringify(headers)!==JSON.stringify(C.FIELDS))throw Error('V1270_HEADER_MISMATCH '+name);
  const count=sh.getLastRow()-1;
  if(count!==partitionCounts[i])throw Error('V1270_SHEET_COUNT_MISMATCH '+name);
  sheetCounts.push(count);
 }
 const result={version:C.V,status:'PREFLIGHT_PASSED_NOT_ROW_CERTIFIED',manifestCount:2418,partitionCount:64,rows:sources.rows,admitted:sources.admitted,exceptions:sources.exceptions,blocked:sources.blocked,sourceOrdinalZero:sources.ordinalZero,partitionOrdinalBlank:domains.blanks[7],sourceRunEmpty:sources.sourceRunEmpty,partitionSourceRunBlank:domains.blanks[5],invalid:0,partitionCounts:sheetCounts,verifiedAt:new Date().toISOString(),next:'BUILD_DURABLE_OBSERVATION_ID_INDEX_AND_COMPARE_EXACT_ROWS',verdict:'POPULATION_AND_DOMAIN_PREFLIGHT_ONLY_NOT_ROW_FIDELITY_CERTIFIED'};
 p.setProperty(C.KEY,JSON.stringify(result));
 console.log('[PHASE G FIDELITY V1270] | PREFLIGHT | '+JSON.stringify(result));return result;
}
