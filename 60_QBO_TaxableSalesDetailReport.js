/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 60_QBO_TaxableSalesDetailReport.js
 * Purpose     : Permanent QBO Taxable Sales Detail source for sales-tax audit.
 *
 * Architecture:
 *   - Pulls reports/TaxableSalesDetail directly from QBO on Cash basis.
 *   - Does NOT use QBO_EXPORT workbooks as its report source.
 *   - Stores a rebuildable Current view plus immutable row-level snapshots.
 *   - Records row-level ADD / REMOVE / CHANGE events between snapshots.
 *   - Preserves QBO report rows and source-transaction enrichment without
 *     inventing a per-line tax allocation. Exact tax allocation is a separate
 *     reconciliation concern because diagnostics proved simple proportional
 *     rounding can differ from QBO by residual pennies.
 *
 * Script Property:
 *   QBO_TAXABLE_SALES_DETAIL_DATA_SPREADSHEET_ID
 * ============================================================================ */

const QBO_TAXABLE_SALES_DETAIL = Object.freeze({
  PROPERTY_KEY: 'QBO_TAXABLE_SALES_DETAIL_DATA_SPREADSHEET_ID',
  WORKBOOK_TITLE: 'QBO_Taxable_Sales_Detail_Data',
  CONTROL_SHEET: '00_Controls',
  CURRENT_SHEET: '01_Current',
  SNAPSHOT_SHEET: '02_Detail_Snapshots',
  CHANGES_SHEET: '03_Snapshot_Changes',
  LOG_SHEET: '90_Ingestion_Log',
  BASIS: 'Cash',
  ROW_HASH_VERSION: '3',
  DATA_FOLDER_ASSET_KEY: 'QBO_DATA_EXCHANGE_CURRENT_FOLDER',
  DATA_FOLDER_PATH: 'Data Platform/Data Exchange/QuickBooks/Current',
  ALLOWED_TYPES: Object.freeze(['Invoice','Sales Receipt','Credit Memo','Refund'])
});

const QBO_TSD_DETAIL_HEADERS = Object.freeze([
  'Period_Key','Snapshot_Sequence','Snapshot_Run_ID','Report_AsOf_DateTime',
  'Recognition_Date','Transaction_Type','Transaction_ID','Num','Customer',
  'Product_Service','Item_ID','Description','Recognized_Taxable_Amount',
  'Source_Transaction_Date','Distribution_Account','Tax_Name','Tax_Code_ID',
  'Source_Total_Tax','Source_Last_Updated_Time','Row_Key','Row_Hash','Raw_Report_Row_JSON'
]);

function provisionQboTaxableSalesDetailDataWorkbook() {
  const props = PropertiesService.getScriptProperties();
  const targetFolder = qboTsdResolveGovernedDataFolder_();
  let id = String(props.getProperty(QBO_TAXABLE_SALES_DETAIL.PROPERTY_KEY) || '').trim();
  let ss = null;
  let status = 'READY';
  let supersededSpreadsheetId = '';

  if (id) {
    ss = SpreadsheetApp.openById(id);
    qboTsdEnsureWorkbook_(ss);
    const file = DriveApp.getFileById(id);
    if (!qboTsdFileIsInFolder_(file, targetFolder.getId())) {
      if (qboTsdWorkbookHasCapturedData_(ss)) {
        throw new Error(
          'Configured TaxableSalesDetail workbook ' + id +
          ' is outside ' + QBO_TAXABLE_SALES_DETAIL.DATA_FOLDER_PATH +
          ' and already contains captured data. Automatic migration is blocked.'
        );
      }
      supersededSpreadsheetId = id;
      ss = qboTsdCreateWorkbookInFolder_(targetFolder);
      id = ss.getId();
      props.setProperty(QBO_TAXABLE_SALES_DETAIL.PROPERTY_KEY, id);
      status = 'REPROVISIONED_IN_GOVERNED_DATA_FOLDER';
    }
  } else {
    ss = qboTsdCreateWorkbookInFolder_(targetFolder);
    id = ss.getId();
    props.setProperty(QBO_TAXABLE_SALES_DETAIL.PROPERTY_KEY, id);
    status = 'CREATED_IN_GOVERNED_DATA_FOLDER';
  }

  qboTsdEnsureWorkbook_(ss);
  return {
    spreadsheetId: id,
    spreadsheetUrl: ss.getUrl(),
    status: status,
    governedFolderId: targetFolder.getId(),
    governedPath: QBO_TAXABLE_SALES_DETAIL.DATA_FOLDER_PATH,
    supersededSpreadsheetId: supersededSpreadsheetId
  };
}

function qboTsdCreateWorkbookInFolder_(targetFolder) {
  const ss = SpreadsheetApp.create(QBO_TAXABLE_SALES_DETAIL.WORKBOOK_TITLE);
  const file = DriveApp.getFileById(ss.getId());
  file.moveTo(targetFolder);
  return ss;
}

function qboTsdResolveGovernedDataFolder_() {
  if (typeof DataPlatform05 === 'undefined' ||
      typeof DataPlatform05.getConfiguredAssetReference !== 'function') {
    throw new Error(
      'Application 05 library DataPlatform05 is unavailable. ' +
      'Cannot resolve governed asset ' + QBO_TAXABLE_SALES_DETAIL.DATA_FOLDER_ASSET_KEY + '.'
    );
  }

  const asset = DataPlatform05.getConfiguredAssetReference(
    QBO_TAXABLE_SALES_DETAIL.DATA_FOLDER_ASSET_KEY,
    'Folder',
    'PROD'
  );

  const folderId = asset && String(asset.ResourceIdentifier || '').trim();
  if (!folderId) {
    throw new Error(
      'Application 05 returned no ResourceIdentifier for governed asset ' +
      QBO_TAXABLE_SALES_DETAIL.DATA_FOLDER_ASSET_KEY + '.'
    );
  }

  try {
    return DriveApp.getFolderById(folderId);
  } catch (err) {
    throw new Error(
      'Unable to open governed folder asset ' +
      QBO_TAXABLE_SALES_DETAIL.DATA_FOLDER_ASSET_KEY +
      ' (' + folderId + '): ' + (err && err.message ? err.message : err)
    );
  }
}

function qboTsdFileIsInFolder_(file, folderId) {
  const parents = file.getParents();
  while (parents.hasNext()) {
    if (String(parents.next().getId()) === String(folderId)) return true;
  }
  return false;
}

function qboTsdWorkbookHasCapturedData_(ss) {
  const dataSheets = [
    QBO_TAXABLE_SALES_DETAIL.CURRENT_SHEET,
    QBO_TAXABLE_SALES_DETAIL.SNAPSHOT_SHEET,
    QBO_TAXABLE_SALES_DETAIL.CHANGES_SHEET,
    QBO_TAXABLE_SALES_DETAIL.LOG_SHEET
  ];
  return dataSheets.some(function(name) {
    const sheet = ss.getSheetByName(name);
    return sheet && sheet.getLastRow() > 1;
  });
}

function exportQboTaxableSalesDetail() {
  const ss = qboTsdGetWorkbook_();
  qboTsdEnsureWorkbook_(ss);
  const monthKey = qboTsdReadControlValue_(ss, 'REPORT_MONTH');
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || '').trim())) {
    throw new Error(
      '00_Controls REPORT_MONTH must be set to YYYY-MM before running exportQboTaxableSalesDetail().'
    );
  }
  return exportQboTaxableSalesDetailForMonth(String(monthKey).trim());
}

function exportQboTaxableSalesDetailForMonth(monthKey) {
  const period = qboTsdResolveMonth_(monthKey);
  return exportQboTaxableSalesDetailForPeriod(period.startDate, period.endDate);
}

function exportQboTaxableSalesDetailForPeriod(startDate, endDate) {
  qboTsdValidatePeriod_(startDate, endDate);
  const periodKey = startDate.slice(0,7).replace('-','');
  const runId = Utilities.getUuid();
  const asOf = new Date();
  const ss = qboTsdGetWorkbook_();
  qboTsdEnsureWorkbook_(ss);

  safeLog_('[TAXABLE SALES DETAIL] | START | run=' + runId + ' | period=' + startDate + '..' + endDate + ' | basis=Cash');

  const cfg = getConfig_();
  const path = 'reports/TaxableSalesDetail?start_date=' + encodeURIComponent(startDate) +
    '&end_date=' + encodeURIComponent(endDate) + '&accounting_method=Cash&minorversion=' + encodeURIComponent(cfg.minorVersion);
  const report = qboGet_(path);
  const rawRows = qboTsdAssignOccurrences_(qboTsdFlattenReport_(report));

  const items = qboQueryAllGeneric_('SELECT * FROM Item WHERE Active IN (true, false)', 'Item');
  const itemById = qboTsdIndexById_(items);
  const taxCodes = qboQueryAllGeneric_('SELECT * FROM TaxCode WHERE Active IN (true, false)', 'TaxCode');
  const taxCodeById = qboTsdIndexById_(taxCodes);

  const refs = {};
  rawRows.forEach(r => { refs[r.transactionType + '|' + r.transactionId] = r; });
  const txnCache = {};
  Object.keys(refs).forEach(k => {
    const r = refs[k];
    txnCache[k] = qboTsdFetchTransaction_(r.transactionType, r.transactionId);
  });

  const currentRows = [];
  rawRows.forEach(r => {
    const item = itemById[r.itemId] || null;
    if (qboTsdIsBundleItem_(item)) return;
    const txn = txnCache[r.transactionType + '|' + r.transactionId] || null;
    const line = txn ? qboTsdFindLine_(txn, r.itemId, r.description) : null;
    const tax = qboTsdTaxInfo_(txn, taxCodeById);
    const account = line ? qboTsdDistributionAccount_(line, itemById) : qboTsdItemAccount_(item);
    const base = [
      periodKey,'','',asOf,r.recognitionDate,r.transactionType,r.transactionId,r.num,r.customer,
      r.itemName,r.itemId,r.description,r.amount,
      txn && txn.TxnDate ? txn.TxnDate : '', qboTsdTerminalAccount_(account), tax.taxName,tax.taxCodeId,
      txn && txn.TxnTaxDetail ? qboTsdNumber_(txn.TxnTaxDetail.TotalTax) : '',
      txn && txn.MetaData ? (txn.MetaData.LastUpdatedTime || '') : ''
    ];
    const rowKey = qboTsdRowKey_(base, r.occurrence);
    const rawJson = JSON.stringify(r.raw);
    const rowHash = qboTsdStateHash_(base, rawJson);
    currentRows.push(base.concat([rowKey,rowHash,rawJson]));
  });

  let result;
  withExportWriteLock_(QBO_TAXABLE_SALES_DETAIL.CURRENT_SHEET, ss.getId(), function() {
    const seq = qboTsdNextSequence_(ss, periodKey);
    const previous = qboTsdReadLatestSnapshot_(ss, periodKey);
    const snapshotRows = currentRows.map(r => {
      const copy = r.slice(); copy[1] = seq; copy[2] = runId; return copy;
    });
    qboTsdReplaceCurrentPeriod_(ss, periodKey, currentRows);
    qboTsdAppendRows_(ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.SNAPSHOT_SHEET), QBO_TSD_DETAIL_HEADERS, snapshotRows);
    const changes = qboTsdBuildChanges_(periodKey, previous.sequence, seq, runId, asOf, previous.rows, snapshotRows);
    qboTsdAppendChangeRows_(ss, changes);
    qboTsdWriteControls_(ss, periodKey, seq, runId, asOf, snapshotRows.length, changes.length);
    qboTsdAppendLog_(ss, [runId,asOf,periodKey,startDate,endDate,'SUCCESS',snapshotRows.length,changes.length,'']);
    result = {spreadsheetId:ss.getId(),spreadsheetUrl:ss.getUrl(),periodKey:periodKey,snapshotSequence:seq,rowCount:snapshotRows.length,changeCount:changes.length,runId:runId};
  });
  safeLog_('[TAXABLE SALES DETAIL] | COMPLETE | ' + JSON.stringify(result));
  return result;
}

function qboTsdFlattenReport_(report) {
  const out=[];
  function walk(rows,itemCtx) {
    (rows||[]).forEach(row => {
      let next=itemCtx;
      if (row.Header && Array.isArray(row.Header.ColData)) {
        const c=row.Header.ColData, label=qboTsdCell_(c,0), id=qboTsdCellId_(c,0);
        if (label && id) next={itemId:String(id),itemName:label};
      }
      if (row.ColData && next) {
        const c=row.ColData, date=qboTsdCell_(c,0), type=qboTsdCell_(c,1), id=qboTsdCellId_(c,1);
        if (date && date !== '0-00-00' && id && QBO_TAXABLE_SALES_DETAIL.ALLOWED_TYPES.indexOf(type)!==-1) {
          out.push({recognitionDate:date,transactionType:type,transactionId:String(id),num:qboTsdCell_(c,2),customer:qboTsdCell_(c,3),description:qboTsdCell_(c,4),amount:qboTsdNumber_(qboTsdCell_(c,7)),itemId:next.itemId,itemName:next.itemName,raw:row});
        }
      }
      if (row.Rows && Array.isArray(row.Rows.Row)) walk(row.Rows.Row,next);
    });
  }
  walk(report && report.Rows && Array.isArray(report.Rows.Row) ? report.Rows.Row : [],null);
  return out;
}

function qboTsdFetchTransaction_(type,id) {
  const map={'Invoice':['invoice','Invoice'],'Sales Receipt':['salesreceipt','SalesReceipt'],'Credit Memo':['creditmemo','CreditMemo'],'Refund':['refundreceipt','RefundReceipt']};
  const cfg=map[type]; if(!cfg) throw new Error('Unsupported transaction type '+type);
  const json=qboGet_(cfg[0]+'/'+encodeURIComponent(id));
  const txn=json && json[cfg[1]] ? json[cfg[1]] : json;
  if(!txn || String(txn.Id||'')!==String(id)) throw new Error('Unexpected source transaction response for '+type+' '+id);
  return txn;
}
function qboTsdWalkLines_(lines,cb){(Array.isArray(lines)?lines:[]).forEach(line=>{const d=line&&line.SalesItemLineDetail;if(d&&d.ItemRef)cb(line,d);const g=line&&line.GroupLineDetail&&Array.isArray(line.GroupLineDetail.Line)?line.GroupLineDetail.Line:[];if(g.length)qboTsdWalkLines_(g,cb);});}
function qboTsdFindLine_(txn,itemId,desc){let exact=null,fallback=null,w=qboTsdNorm_(desc);qboTsdWalkLines_(txn&&txn.Line, (line,d)=>{if(String(d.ItemRef.value||'')!==String(itemId||''))return;if(!fallback)fallback=line;if(!exact&&w&&qboTsdNorm_(line.Description||'')===w)exact=line;});return exact||fallback;}
function qboTsdDistributionAccount_(line,itemById){const d=line&&line.SalesItemLineDetail;if(d&&d.ItemAccountRef)return d.ItemAccountRef.name||d.ItemAccountRef.value||'';const id=d&&d.ItemRef?String(d.ItemRef.value||''):'';return qboTsdItemAccount_(itemById[id]);}
function qboTsdItemAccount_(item){return item&&item.IncomeAccountRef?(item.IncomeAccountRef.name||item.IncomeAccountRef.value||''):'';}
function qboTsdTaxInfo_(txn,map){const ref=txn&&txn.TxnTaxDetail&&txn.TxnTaxDetail.TxnTaxCodeRef?txn.TxnTaxDetail.TxnTaxCodeRef:null;const id=ref&&ref.value!==undefined?String(ref.value):'';const tc=id?map[id]:null;return{taxCodeId:id,taxName:(tc&&tc.Name)||(ref&&ref.name)||''};}
function qboTsdIsBundleItem_(item){const t=String(item&&item.Type||'').toLowerCase();return t==='group'||t==='bundle';}
function qboTsdIndexById_(rows){const m={};(rows||[]).forEach(x=>{if(x&&x.Id!==undefined)m[String(x.Id)]=x;});return m;}
function qboTsdCell_(c,i){return c&&c[i]&&c[i].value!==undefined?String(c[i].value):'';}
function qboTsdCellId_(c,i){return c&&c[i]&&c[i].id!==undefined?String(c[i].id):'';}
function qboTsdNumber_(v){if(v===null||v===undefined||v==='')return '';const n=Number(String(v).replace(/[$,]/g,''));return isNaN(n)?'':n;}
function qboTsdNorm_(v){return String(v||'').trim().toLowerCase().replace(/\s+/g,' ');}
function qboTsdTerminalAccount_(v){const p=String(v||'').split(':');return p[p.length-1].trim();}
function qboTsdAssignOccurrences_(rows){const seen={};return (rows||[]).map(r=>{const k=[r.recognitionDate,r.transactionType,r.transactionId,r.itemId,qboTsdNorm_(r.description)].join('|');seen[k]=(seen[k]||0)+1;r.occurrence=seen[k];return r;});}
function qboTsdRowKey_(r,occurrence){return [r[4],r[5],r[6],r[10],r[11],occurrence||1].map(qboTsdNorm_).join('|');}
function qboTsdHash_(v){const b=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(v),Utilities.Charset.UTF_8);return b.map(x=>('0'+((x+256)%256).toString(16)).slice(-2)).join('');}
function qboTsdCanonicalDateOnly_(v){
  if(v===null||v===undefined||v==='')return '';
  if(Object.prototype.toString.call(v)==='[object Date]'&&!isNaN(v.getTime()))return Utilities.formatDate(v,Session.getScriptTimeZone(),'yyyy-MM-dd');
  return String(v).trim();
}
function qboTsdCanonicalNumber_(v){
  if(v===null||v===undefined||v==='')return '';
  const n=Number(v);
  return isNaN(n)?String(v).trim():String(n);
}
function qboTsdCanonicalText_(v){
  if(v===null||v===undefined)return '';
  if(Object.prototype.toString.call(v)==='[object Date]'&&!isNaN(v.getTime()))return v.toISOString();
  return String(v);
}
function qboTsdCanonicalState_(row){
  const s=row.slice(4,19);
  return [
    qboTsdCanonicalDateOnly_(s[0]),
    qboTsdCanonicalText_(s[1]),
    qboTsdCanonicalText_(s[2]),
    qboTsdCanonicalText_(s[3]),
    qboTsdCanonicalText_(s[4]),
    qboTsdCanonicalText_(s[5]),
    qboTsdCanonicalText_(s[6]),
    qboTsdCanonicalText_(s[7]),
    qboTsdCanonicalNumber_(s[8]),
    qboTsdCanonicalDateOnly_(s[9]),
    qboTsdCanonicalText_(s[10]),
    qboTsdCanonicalText_(s[11]),
    qboTsdCanonicalText_(s[12]),
    qboTsdCanonicalNumber_(s[13]),
    qboTsdCanonicalText_(s[14])
  ];
}
function qboTsdStateHash_(row,rawJson){let raw=rawJson||'';try{raw=raw?JSON.parse(raw):'';}catch(_err){}return qboTsdHash_({version:QBO_TAXABLE_SALES_DETAIL.ROW_HASH_VERSION,state:qboTsdCanonicalState_(row),rawReportRow:raw});}
function qboTsdComparableHash_(row){return qboTsdStateHash_(row,row[21]);}
function qboTsdResolveMonth_(m){const x=String(m||'').match(/^(\d{4})-(\d{2})$/);if(!x)throw new Error('monthKey must be YYYY-MM');const y=+x[1],mo=+x[2],tz=Session.getScriptTimeZone();return{startDate:Utilities.formatDate(new Date(y,mo-1,1),tz,'yyyy-MM-dd'),endDate:Utilities.formatDate(new Date(y,mo,0),tz,'yyyy-MM-dd')};}
function qboTsdValidatePeriod_(s,e){if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!/^\d{4}-\d{2}-\d{2}$/.test(e)||s>e)throw new Error('Invalid TaxableSalesDetail period '+s+'..'+e);}
function qboTsdGetWorkbook_(){const id=String(PropertiesService.getScriptProperties().getProperty(QBO_TAXABLE_SALES_DETAIL.PROPERTY_KEY)||'').trim();if(!id)throw new Error('Run provisionQboTaxableSalesDetailDataWorkbook() first.');return SpreadsheetApp.openById(id);}
function qboTsdEnsureWorkbook_(ss){const names=[QBO_TAXABLE_SALES_DETAIL.CONTROL_SHEET,QBO_TAXABLE_SALES_DETAIL.CURRENT_SHEET,QBO_TAXABLE_SALES_DETAIL.SNAPSHOT_SHEET,QBO_TAXABLE_SALES_DETAIL.CHANGES_SHEET,QBO_TAXABLE_SALES_DETAIL.LOG_SHEET];names.forEach(n=>{if(!ss.getSheetByName(n))ss.insertSheet(n);});const d=ss.getSheetByName('Sheet1');if(d&&ss.getSheets().length>1&&d.getLastRow()===0)ss.deleteSheet(d);qboTsdEnsureControls_(ss);qboTsdEnsureHeader_(ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.CURRENT_SHEET),QBO_TSD_DETAIL_HEADERS);qboTsdEnsureHeader_(ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.SNAPSHOT_SHEET),QBO_TSD_DETAIL_HEADERS);qboTsdEnsureHeader_(ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.CHANGES_SHEET),['Period_Key','Prior_Snapshot','New_Snapshot','Snapshot_Run_ID','Detected_At','Change_Type','Row_Key','Old_Row_Hash','New_Row_Hash']);qboTsdEnsureHeader_(ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.LOG_SHEET),['Snapshot_Run_ID','Report_AsOf_DateTime','Period_Key','Period_Start','Period_End','Status','Row_Count','Change_Count','Error']);}
function qboTsdEnsureHeader_(sh,h){if(sh.getLastRow()===0)sh.getRange(1,1,1,h.length).setValues([h]);}
function qboTsdAppendRows_(sh,h,rows){qboTsdEnsureHeader_(sh,h);if(rows.length)sh.getRange(sh.getLastRow()+1,1,rows.length,h.length).setValues(rows);}
function qboTsdNextSequence_(ss,p){const sh=ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.SNAPSHOT_SHEET);if(sh.getLastRow()<2)return 1;const v=sh.getRange(2,1,sh.getLastRow()-1,2).getValues();let max=0;v.forEach(r=>{if(String(r[0])===p)max=Math.max(max,Number(r[1])||0);});return max+1;}
function qboTsdReadLatestSnapshot_(ss,p){const sh=ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.SNAPSHOT_SHEET);if(sh.getLastRow()<2)return{sequence:0,rows:[]};const v=sh.getRange(2,1,sh.getLastRow()-1,QBO_TSD_DETAIL_HEADERS.length).getValues();let seq=0;v.forEach(r=>{if(String(r[0])===p)seq=Math.max(seq,Number(r[1])||0);});return{sequence:seq,rows:v.filter(r=>String(r[0])===p&&Number(r[1])===seq)};}
function qboTsdReplaceCurrentPeriod_(ss,p,rows){const sh=ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.CURRENT_SHEET);qboTsdEnsureHeader_(sh,QBO_TSD_DETAIL_HEADERS);let keep=[];if(sh.getLastRow()>1)keep=sh.getRange(2,1,sh.getLastRow()-1,QBO_TSD_DETAIL_HEADERS.length).getValues().filter(r=>String(r[0])!==p);sh.clearContents();sh.getRange(1,1,1,QBO_TSD_DETAIL_HEADERS.length).setValues([QBO_TSD_DETAIL_HEADERS]);const clean=rows.map(r=>{const c=r.slice();c[1]='';c[2]='';return c;});const all=keep.concat(clean);if(all.length)sh.getRange(2,1,all.length,QBO_TSD_DETAIL_HEADERS.length).setValues(all);}
function qboTsdBuildChanges_(p,oldSeq,newSeq,runId,at,oldRows,newRows){const oldMap={},newMap={};oldRows.forEach(r=>oldMap[String(r[19])]=r);newRows.forEach(r=>newMap[String(r[19])]=r);const out=[];Object.keys(oldMap).forEach(k=>{if(!newMap[k])out.push([p,oldSeq,newSeq,runId,at,'REMOVE',k,oldMap[k][20],'']);else{const oldComparable=qboTsdComparableHash_(oldMap[k]);const newComparable=qboTsdComparableHash_(newMap[k]);if(oldComparable!==newComparable)out.push([p,oldSeq,newSeq,runId,at,'CHANGE',k,oldMap[k][20],newMap[k][20]]);}});Object.keys(newMap).forEach(k=>{if(!oldMap[k])out.push([p,oldSeq,newSeq,runId,at,'ADD',k,'',newMap[k][20]]);});return out;}
function qboTsdAppendChangeRows_(ss,rows){const h=['Period_Key','Prior_Snapshot','New_Snapshot','Snapshot_Run_ID','Detected_At','Change_Type','Row_Key','Old_Row_Hash','New_Row_Hash'];qboTsdAppendRows_(ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.CHANGES_SHEET),h,rows);}
function qboTsdEnsureControls_(ss){const sh=ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.CONTROL_SHEET);if(!sh)return;const existing=qboTsdReadControls_(sh);if(sh.getLastRow()===0){qboTsdRenderControls_(sh,'','','','','','','');return;}if(!Object.prototype.hasOwnProperty.call(existing,'REPORT_MONTH')){const latest=String(existing['Latest Period Key']||'').trim();const reportMonth=/^\d{6}$/.test(latest)?latest.slice(0,4)+'-'+latest.slice(4,6):'';qboTsdRenderControls_(sh,reportMonth,existing['Latest Period Key']||'',existing['Latest Snapshot Sequence']||'',existing['Latest Snapshot Run ID']||'',existing['Latest Report ASOF']||'',existing['Latest Row Count']||'',existing['Latest Change Count']||'');}}
function qboTsdReadControls_(sh){const out={};if(!sh||sh.getLastRow()<2)return out;const values=sh.getRange(2,1,sh.getLastRow()-1,2).getDisplayValues();values.forEach(r=>{const k=String(r[0]||'').trim();if(k)out[k]=String(r[1]||'').trim();});return out;}
function qboTsdReadControlValue_(ss,key){const sh=ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.CONTROL_SHEET);const values=qboTsdReadControls_(sh);return values[key];}
function qboTsdRenderControls_(sh,reportMonth,p,seq,runId,at,rowCount,changeCount){const rows=[['Control','Value'],['Dataset','QBO Taxable Sales Detail'],['Source','QBO reports/TaxableSalesDetail'],['Accounting Method','Cash'],['REPORT_MONTH',reportMonth],['Latest Period Key',p],['Latest Snapshot Sequence',seq],['Latest Snapshot Run ID',runId],['Latest Report ASOF',at],['Latest Row Count',rowCount],['Latest Change Count',changeCount],['Row Hash Version',QBO_TAXABLE_SALES_DETAIL.ROW_HASH_VERSION],['Per-line tax allocation','NOT DERIVED - requires exact QBO-supported reconciliation']];sh.clearContents();sh.getRange(1,1,rows.length,2).setValues(rows);}
function qboTsdWriteControls_(ss,p,seq,runId,at,rowCount,changeCount){const sh=ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.CONTROL_SHEET);const reportMonth=qboTsdReadControlValue_(ss,'REPORT_MONTH')||'';qboTsdRenderControls_(sh,reportMonth,p,seq,runId,at,rowCount,changeCount);}
function qboTsdAppendLog_(ss,row){qboTsdAppendRows_(ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.LOG_SHEET),['Snapshot_Run_ID','Report_AsOf_DateTime','Period_Key','Period_Start','Period_End','Status','Row_Count','Change_Count','Error'],[row]);}
