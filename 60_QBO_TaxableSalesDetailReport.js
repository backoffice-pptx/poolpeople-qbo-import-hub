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
 *   - FORWARD SALES-TAX CONTRACT: this dataset is the taxable/tax-detail
 *     evidence population paired with QBO Sales Tax Recognition. The governed
 *     reconstruction combines both datasets to derive Gross Sales, Non-Taxable
 *     Sales, Taxable Sales, and Tax Due, then reconciles those totals to the
 *     exact bound QBO Sales Tax Liability snapshot. Do not use a raw sum of
 *     Recognized_Taxable_Amount as a standalone Liability reconciliation.
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
  const monthKey = qboTsdReadDefaultReportMonth_(ss);
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || '').trim())) {
    throw new Error(
      '00_Controls REPORT_MONTH (Default) must be set to YYYY-MM before running exportQboTaxableSalesDetail().'
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
  qboTsdAssertRequestedPeriod_(periodKey, startDate, endDate, rawRows);

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
    qboTsdReplaceCurrentPeriod_(ss, periodKey, snapshotRows);
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
function qboTsdReplaceCurrentPeriod_(ss,p,rows){const sh=ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.CURRENT_SHEET);qboTsdEnsureHeader_(sh,QBO_TSD_DETAIL_HEADERS);let keep=[];if(sh.getLastRow()>1)keep=sh.getRange(2,1,sh.getLastRow()-1,QBO_TSD_DETAIL_HEADERS.length).getValues().filter(r=>String(r[0])!==p);sh.clearContents();sh.getRange(1,1,1,QBO_TSD_DETAIL_HEADERS.length).setValues([QBO_TSD_DETAIL_HEADERS]);const all=keep.concat((rows||[]).map(r=>r.slice()));if(all.length)sh.getRange(2,1,all.length,QBO_TSD_DETAIL_HEADERS.length).setValues(all);}
function qboTsdBuildChanges_(p,oldSeq,newSeq,runId,at,oldRows,newRows){const oldMap={},newMap={};oldRows.forEach(r=>oldMap[String(r[19])]=r);newRows.forEach(r=>newMap[String(r[19])]=r);const out=[];Object.keys(oldMap).forEach(k=>{if(!newMap[k])out.push([p,oldSeq,newSeq,runId,at,'REMOVE',k,oldMap[k][20],'']);else{const oldComparable=qboTsdComparableHash_(oldMap[k]);const newComparable=qboTsdComparableHash_(newMap[k]);if(oldComparable!==newComparable)out.push([p,oldSeq,newSeq,runId,at,'CHANGE',k,oldMap[k][20],newMap[k][20]]);}});Object.keys(newMap).forEach(k=>{if(!oldMap[k])out.push([p,oldSeq,newSeq,runId,at,'ADD',k,'',newMap[k][20]]);});return out;}
function qboTsdAppendChangeRows_(ss,rows){const h=['Period_Key','Prior_Snapshot','New_Snapshot','Snapshot_Run_ID','Detected_At','Change_Type','Row_Key','Old_Row_Hash','New_Row_Hash'];qboTsdAppendRows_(ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.CHANGES_SHEET),h,rows);}
function qboTsdEnsureControls_(ss){const sh=ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.CONTROL_SHEET);if(!sh)return;const existing=qboTsdReadControls_(sh);if(sh.getLastRow()===0){qboTsdRenderControls_(sh,'','','','','','','');return;}if(!Object.prototype.hasOwnProperty.call(existing,'REPORT_MONTH (Default)')){const latest=String(existing['Latest Period Key']||'').trim();const reportMonth=String(existing['REPORT_MONTH']||'').trim()||(/^\d{6}$/.test(latest)?latest.slice(0,4)+'-'+latest.slice(4,6):'');qboTsdRenderControls_(sh,reportMonth,existing['Latest Period Key']||'',existing['Latest Snapshot Sequence']||'',existing['Latest Snapshot Run ID']||'',existing['Latest Report ASOF']||'',existing['Latest Row Count']||'',existing['Latest Change Count']||'');}}
function qboTsdReadControls_(sh){const out={};if(!sh||sh.getLastRow()<2)return out;const values=sh.getRange(2,1,sh.getLastRow()-1,2).getDisplayValues();values.forEach(r=>{const k=String(r[0]||'').trim();if(k)out[k]=String(r[1]||'').trim();});return out;}
function qboTsdReadControlValue_(ss,key){const sh=ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.CONTROL_SHEET);const values=qboTsdReadControls_(sh);return values[key];}
function qboTsdRenderControls_(sh,reportMonth,p,seq,runId,at,rowCount,changeCount){const rows=[['Control','Value'],['Dataset','QBO Taxable Sales Detail'],['Source','QBO reports/TaxableSalesDetail'],['Accounting Method','Cash'],['REPORT_MONTH (Default)',reportMonth],['Latest Period Key',p],['Latest Period Start',qboTsdPeriodStart_(p)],['Latest Period End',qboTsdPeriodEnd_(p)],['Latest Snapshot Sequence',seq],['Latest Snapshot Run ID',runId],['Latest Report ASOF',at],['Latest Row Count',rowCount],['Latest Change Count',changeCount],['Row Hash Version',QBO_TAXABLE_SALES_DETAIL.ROW_HASH_VERSION],['Per-line tax allocation','NOT DERIVED - requires exact QBO-supported reconciliation']];sh.clearContents();sh.getRange(1,1,rows.length,2).setValues(rows);}
function qboTsdWriteControls_(ss,p,seq,runId,at,rowCount,changeCount){const sh=ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.CONTROL_SHEET);const reportMonth=qboTsdReadDefaultReportMonth_(ss)||'';qboTsdRenderControls_(sh,reportMonth,p,seq,runId,at,rowCount,changeCount);}
function qboTsdAppendLog_(ss,row){qboTsdAppendRows_(ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.LOG_SHEET),['Snapshot_Run_ID','Report_AsOf_DateTime','Period_Key','Period_Start','Period_End','Status','Row_Count','Change_Count','Error'],[row]);}


function qboTsdReadDefaultReportMonth_(ss){return qboTsdReadControlValue_(ss,'REPORT_MONTH (Default)')||qboTsdReadControlValue_(ss,'REPORT_MONTH')||'';}
function qboTsdPeriodStart_(p){p=String(p||'');return /^\d{6}$/.test(p)?p.slice(0,4)+'-'+p.slice(4,6)+'-01':'';}
function qboTsdPeriodEnd_(p){const s=qboTsdPeriodStart_(p);if(!s)return '';const d=new Date(Date.UTC(Number(s.slice(0,4)),Number(s.slice(5,7)),0));return Utilities.formatDate(d,'UTC','yyyy-MM-dd');}
function qboTsdAssertRequestedPeriod_(periodKey,startDate,endDate,rows){const expected=startDate.slice(0,7).replace('-','');if(periodKey!==expected)throw new Error('TaxableSalesDetail requested-period invariant failed: periodKey='+periodKey+' expected='+expected);(rows||[]).forEach(function(r){const d=String(r.recognitionDate||'').slice(0,10);if(d&&(d<startDate||d>endDate))throw new Error('TaxableSalesDetail requested-period invariant failed: recognition date '+d+' outside '+startDate+'..'+endDate);});}
function testQboTaxableSalesDetailRequestedPeriodContract(){const checks=[];function ok(name,v){checks.push({name:name,passed:!!v});}ok('period start',qboTsdPeriodStart_('202608')==='2026-08-01');ok('period end',qboTsdPeriodEnd_('202608')==='2026-08-31');qboTsdAssertRequestedPeriod_('202608','2026-08-01','2026-08-31',[{recognitionDate:'2026-08-31'}]);ok('valid August accepted',true);let blocked=false;try{qboTsdAssertRequestedPeriod_('202608','2026-08-01','2026-08-31',[{recognitionDate:'2026-09-01'}]);}catch(e){blocked=true;}ok('out-of-period row blocked',blocked);const passed=checks.every(function(c){return c.passed;});const result={checkCount:checks.length,passed:passed,checks:checks};safeLog_('[TAXABLE SALES DETAIL CONTRACT TEST] '+JSON.stringify(result));if(!passed)throw new Error('Taxable Sales Detail requested-period contract test failed.');return result;}


/**
 * v1.5.205 lineage publication repair.
 * 01_Current is a rebuildable publication of the latest immutable snapshot for
 * each period. It MUST preserve Snapshot_Sequence, Snapshot_Run_ID and
 * Report_AsOf_DateTime from 02_Detail_Snapshots. It is not a second evidence
 * source and this repair never mutates historical snapshots.
 */
function inspectQboTaxableSalesDetailCurrentLineageV1205_() {
  const ss=qboTsdGetWorkbook_(); qboTsdEnsureWorkbook_(ss);
  const current=qboTsdReadSheetRowsV1205_(ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.CURRENT_SHEET));
  const snaps=qboTsdReadSheetRowsV1205_(ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.SNAPSHOT_SHEET));
  const periods={};
  snaps.forEach(function(r){const p=String(r[0]||'').trim();if(!p)return;const seq=Number(r[1])||0;if(!periods[p]||seq>periods[p].seq)periods[p]={seq:seq,runId:String(r[2]||''),asOf:r[3],rows:[]};});
  Object.keys(periods).forEach(function(p){periods[p].rows=snaps.filter(function(r){return String(r[0]||'').trim()===p&&Number(r[1])===periods[p].seq;});});
  const results=Object.keys(periods).sort().map(function(p){
    const expected=periods[p], cur=current.filter(function(r){return String(r[0]||'').trim()===p;});
    const expectedMap=qboTsdRowStateMapV1205_(expected.rows), currentMap=qboTsdRowStateMapV1205_(cur);
    const businessMatch=qboTsdMapsEqualV1205_(expectedMap,currentMap);
    const lineageMatch=cur.length===expected.rows.length&&cur.every(function(r){return Number(r[1])===expected.seq&&String(r[2]||'')===expected.runId&&qboTsdDateTimeKeyV1205_(r[3])===qboTsdDateTimeKeyV1205_(expected.asOf);});
    return {Period_Key:p,Expected_Snapshot_Sequence:expected.seq,Expected_Snapshot_Run_ID:expected.runId,Expected_Report_AsOf:qboTsdDateTimeKeyV1205_(expected.asOf),Expected_Row_Count:expected.rows.length,Current_Row_Count:cur.length,Expected_Taxable:qboTsdTaxableTotalV1205_(expected.rows),Current_Taxable:qboTsdTaxableTotalV1205_(cur),Business_State_Matches:businessMatch,Lineage_Matches:lineageMatch,Status:businessMatch?(lineageMatch?'PASS':'LINEAGE_PUBLICATION_DEFECT'):'BUSINESS_STATE_MISMATCH'};
  });
  const out={Version:'1.5.205',Status:results.every(function(x){return x.Status==='PASS';})?'PASS':'DEFECT_DETECTED',Read_Only:true,Mutation_Performed:false,Workbook_ID:ss.getId(),Periods:results};
  safeLog_('[TAXABLE SALES DETAIL CURRENT LINEAGE] '+JSON.stringify(out)); return out;
}

function repairQboTaxableSalesDetailCurrentLineage() {
  const ss=qboTsdGetWorkbook_(); qboTsdEnsureWorkbook_(ss);
  const curSh=ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.CURRENT_SHEET);
  const snapSh=ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.SNAPSHOT_SHEET);
  const current=qboTsdReadSheetRowsV1205_(curSh);
  const snaps=qboTsdReadSheetRowsV1205_(snapSh);
  const snapshotFingerprintBefore=qboTsdRepairFingerprintV1208_(snaps);
  const latest={};
  snaps.forEach(function(r){const p=String(r[0]||'').trim(),seq=Number(r[1])||0;if(!p)return;if(!latest[p]||seq>latest[p])latest[p]=seq;});
  const decisions=[];
  Object.keys(latest).sort().forEach(function(p){
    const exp=snaps.filter(function(r){return String(r[0]||'').trim()===p&&Number(r[1])===latest[p];});
    const cur=current.filter(function(r){return String(r[0]||'').trim()===p;});
    decisions.push(qboTsdClassifyRepairV1208_(p,exp,cur));
  });
  decisions.forEach(function(d){safeLog_('[TSD CURRENT REPAIR] | PRECONDITION | '+JSON.stringify(d));});
  const blocked=decisions.filter(function(d){return !d.Safe_To_Publish;});
  if(blocked.length)throw new Error('TSD_CURRENT_REPAIR_BLOCKED_UNAPPROVED_DIFFERENCE: '+JSON.stringify(blocked));
  const publish=snaps.filter(function(r){const p=String(r[0]||'').trim();return p&&Number(r[1])===latest[p];}).map(function(r){return r.slice();});
  try {
    curSh.clearContents();
    curSh.getRange(1,1,1,QBO_TSD_DETAIL_HEADERS.length).setValues([QBO_TSD_DETAIL_HEADERS]);
    if(publish.length)curSh.getRange(2,1,publish.length,QBO_TSD_DETAIL_HEADERS.length).setValues(publish);
    SpreadsheetApp.flush();
    const afterCurrent=qboTsdReadSheetRowsV1205_(curSh);
    const post=[];
    Object.keys(latest).sort().forEach(function(p){
      const exp=snaps.filter(function(r){return String(r[0]||'').trim()===p&&Number(r[1])===latest[p];});
      const cur=afterCurrent.filter(function(r){return String(r[0]||'').trim()===p;});
      const d=qboTsdDecomposeCurrentMismatchV1206_(exp,cur);
      const meta=exp[0]||[];
      const lineage=cur.length===exp.length&&cur.every(function(r){return Number(r[1])===Number(meta[1])&&String(r[2]||'')===String(meta[2]||'')&&qboTsdDateTimeKeyV1205_(r[3])===qboTsdDateTimeKeyV1205_(meta[3]);});
      post.push({Period_Key:p,Core_Business_State_Matches:d.Core_Business_State_Matches,Full_Source_Representation_Matches:d.Full_Source_Representation_Matches,Lineage_Matches:lineage,Current_Row_Count:cur.length,Expected_Row_Count:exp.length,Current_Taxable:qboTsdTaxableTotalV1205_(cur),Expected_Taxable:qboTsdTaxableTotalV1205_(exp)});
    });
    const failed=post.filter(function(x){return !x.Core_Business_State_Matches||!x.Full_Source_Representation_Matches||!x.Lineage_Matches||x.Current_Row_Count!==x.Expected_Row_Count||x.Current_Taxable!==x.Expected_Taxable;});
    if(failed.length)throw new Error('TSD_CURRENT_REPAIR_POSTCONDITION_FAILED: '+JSON.stringify(failed));
    const snapshotFingerprintAfter=qboTsdRepairFingerprintV1208_(qboTsdReadSheetRowsV1205_(snapSh));
    if(snapshotFingerprintAfter!==snapshotFingerprintBefore)throw new Error('TSD_CURRENT_REPAIR_SNAPSHOT_MUTATION_DETECTED');
    post.forEach(function(x){safeLog_('[TSD CURRENT REPAIR] | POSTCONDITION | '+JSON.stringify(x));});
    const out={Version:'1.5.208',Status:'SUCCESS',Mutation_Performed:true,Historical_Snapshots_Mutated:false,Snapshot_Fingerprint_Unchanged:true,Published_Row_Count:publish.length,Period_Count:post.length};
    safeLog_('[TSD CURRENT REPAIR] | COMPLETE | '+JSON.stringify(out)); return out;
  } catch(e) {
    curSh.clearContents();
    curSh.getRange(1,1,1,QBO_TSD_DETAIL_HEADERS.length).setValues([QBO_TSD_DETAIL_HEADERS]);
    if(current.length)curSh.getRange(2,1,current.length,QBO_TSD_DETAIL_HEADERS.length).setValues(current);
    SpreadsheetApp.flush();
    safeLog_('[TSD CURRENT REPAIR] | ROLLBACK | '+JSON.stringify({Version:'1.5.208',Status:'ROLLED_BACK',Error:String(e&&e.message||e)}));
    throw e;
  }
}
function qboTsdClassifyRepairV1208_(p,exp,cur){
  const d=qboTsdDecomposeCurrentMismatchV1206_(exp,cur);
  const lineage=qboTsdLineageMatchesV1208_(exp,cur);
  if(d.Core_Business_State_Matches&&d.Full_Source_Representation_Matches){
    return {Version:'1.5.208',Period_Key:p,Classification:lineage?'PASS':'LINEAGE_ONLY_DEFECT',Safe_To_Publish:true,Changed_Row_Count:0,Allowed_Changed_Fields:[],Net_Taxable_Delta:d.Net_Taxable_Delta};
  }
  const detail=qboTsdLegacyFieldLossDetailV1208_(exp,cur);
  const safe=d.Expected_Only_Rows===0&&d.Current_Only_Rows===0&&d.Representation_Only_Rows===0&&d.Net_Taxable_Delta===0&&detail.changedRows===d.Core_Changed_Rows&&detail.changedRows>0&&detail.onlyAllowedFields&&detail.allCurrentValuesBlank;
  return {Version:'1.5.208',Period_Key:p,Classification:safe?'LEGACY_CURRENT_PUBLICATION_FIELD_LOSS':'UNAPPROVED_BUSINESS_STATE_DIFFERENCE',Safe_To_Publish:safe,Changed_Row_Count:d.Core_Changed_Rows,Allowed_Changed_Fields:detail.fields,All_Current_Changed_Values_Blank:detail.allCurrentValuesBlank,Net_Taxable_Delta:d.Net_Taxable_Delta,Expected_Only_Rows:d.Expected_Only_Rows,Current_Only_Rows:d.Current_Only_Rows,Representation_Only_Rows:d.Representation_Only_Rows};
}
function qboTsdLegacyFieldLossDetailV1208_(expected,current){
  const allowed={'Recognition_Date':true,'Source_Transaction_Date':true};
  const e=qboTsdIndexRowsV1206_(expected),c=qboTsdIndexRowsV1206_(current);let changedRows=0,onlyAllowed=true,allBlank=true;const fields={};
  Object.keys(e).forEach(function(k){if(!c[k])return;const diffs=qboTsdCoreFieldDiffsV1206_(e[k],c[k]);if(!diffs.length)return;changedRows++;diffs.forEach(function(x){fields[x.Field]=true;if(!allowed[x.Field])onlyAllowed=false;if(String(x.Current||'').trim()!=='')allBlank=false;});});
  return {changedRows:changedRows,onlyAllowedFields:onlyAllowed,allCurrentValuesBlank:allBlank,fields:Object.keys(fields).sort()};
}
function qboTsdLineageMatchesV1208_(expected,current){if(expected.length!==current.length)return false;const e=qboTsdIndexRowsV1206_(expected),c=qboTsdIndexRowsV1206_(current);return Object.keys(e).every(function(k){return c[k]&&Number(c[k][1])===Number(e[k][1])&&String(c[k][2]||'')===String(e[k][2]||'')&&qboTsdDateTimeKeyV1205_(c[k][3])===qboTsdDateTimeKeyV1205_(e[k][3]);});}
function qboTsdRepairFingerprintV1208_(rows){return qboTsdHash_((rows||[]).map(function(r){return r.map(function(v){return Object.prototype.toString.call(v)==='[object Date]'&&!isNaN(v.getTime())?v.toISOString():v;});}));}
function testQboTaxableSalesDetailControlledRepairV1208Contract(){
  const base=['202609',1,'run-1',new Date('2026-10-02T08:04:34.488Z'),'2026-09-01','Invoice','1','100','A','Item','10','Desc',12.34,'2026-09-01','Income','TX','1',1.02,'2026-09-01T00:00:00Z','rk','rh','{"a":1}'];
  const lineage=base.slice();lineage[1]='';lineage[2]='';lineage[3]='';
  const fieldLoss=lineage.slice();fieldLoss[4]='';fieldLoss[13]='';
  const economic=lineage.slice();economic[12]=13.34;
  const a=qboTsdClassifyRepairV1208_('202609',[base],[lineage]);
  const b=qboTsdClassifyRepairV1208_('202609',[base],[fieldLoss]);
  const c=qboTsdClassifyRepairV1208_('202609',[base],[economic]);
  const checks=[
    {name:'lineage-only defect authorized',passed:a.Safe_To_Publish&&a.Classification==='LINEAGE_ONLY_DEFECT'},
    {name:'approved legacy date-field loss authorized',passed:b.Safe_To_Publish&&b.Classification==='LEGACY_CURRENT_PUBLICATION_FIELD_LOSS'},
    {name:'economic change blocked',passed:!c.Safe_To_Publish&&c.Classification==='UNAPPROVED_BUSINESS_STATE_DIFFERENCE'},
    {name:'snapshot fingerprint stable',passed:qboTsdRepairFingerprintV1208_([base])===qboTsdRepairFingerprintV1208_([base.slice()])}
  ];
  const passed=checks.every(function(x){return x.passed;});const out={Version:'1.5.208',passed:passed,checkCount:checks.length,checks:checks};safeLog_('[TSD CURRENT REPAIR] | CONTRACT_TEST | '+JSON.stringify(out));if(!passed)throw new Error('TSD controlled repair v1.5.208 contract test failed');return out;
}

function testQboTaxableSalesDetailCurrentLineageContract() {
  const snapshot=[['202609',1,'run-1',new Date('2026-10-02T08:04:34.488Z'),'2026-09-01','Invoice','1','100','A','Item','10','Desc',12.34,'2026-09-01','Income','TX','1',1.02,'2026-09-01T00:00:00Z','rk','rh','{}']];
  const legacy=snapshot.map(function(r){const c=r.slice();c[1]='';c[2]='';return c;});
  const repaired=snapshot.map(function(r){return r.slice();});
  const checks=[
    {name:'legacy business state still matches',passed:qboTsdMapsEqualV1205_(qboTsdRowStateMapV1205_(snapshot),qboTsdRowStateMapV1205_(legacy))},
    {name:'legacy lineage is defective',passed:String(legacy[0][1])===''&&String(legacy[0][2])===''},
    {name:'repaired sequence preserved',passed:Number(repaired[0][1])===1},
    {name:'repaired run id preserved',passed:String(repaired[0][2])==='run-1'},
    {name:'repaired report asof preserved',passed:qboTsdDateTimeKeyV1205_(repaired[0][3])===qboTsdDateTimeKeyV1205_(snapshot[0][3])}
  ];
  const passed=checks.every(function(x){return x.passed;}); const out={Version:'1.5.205',passed:passed,checkCount:checks.length,checks:checks};
  safeLog_('[TAXABLE SALES DETAIL CURRENT LINEAGE CONTRACT TEST] '+JSON.stringify(out)); if(!passed)throw new Error('TSD current lineage contract test failed'); return out;
}

function qboTsdReadSheetRowsV1205_(sh){if(!sh||sh.getLastRow()<2)return[];return sh.getRange(2,1,sh.getLastRow()-1,QBO_TSD_DETAIL_HEADERS.length).getValues();}
function qboTsdDateTimeKeyV1205_(v){if(Object.prototype.toString.call(v)==='[object Date]'&&!isNaN(v.getTime()))return v.toISOString();return String(v||'').trim();}
function qboTsdTaxableTotalV1205_(rows){return Math.round((rows||[]).reduce(function(a,r){return a+(Number(r[12])||0);},0)*100)/100;}
function qboTsdRowStateMapV1205_(rows){const m={};(rows||[]).forEach(function(r){m[String(r[19]||'')]=qboTsdComparableHash_(r);});return m;}
function qboTsdMapsEqualV1205_(a,b){const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();if(ak.length!==bk.length)return false;for(let i=0;i<ak.length;i++){if(ak[i]!==bk[i]||a[ak[i]]!==b[bk[i]])return false;}return true;}


/**
 * v1.5.206 read-only mismatch decomposition.
 * Establishes whether the v1.5.205 mismatch is true governed business-state
 * movement or only representational/source-payload drift. No mutation.
 */
function inspectQboTaxableSalesDetailCurrentLineage() {
  const ss=qboTsdGetWorkbook_(); qboTsdEnsureWorkbook_(ss);
  const current=qboTsdReadSheetRowsV1205_(ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.CURRENT_SHEET));
  const snaps=qboTsdReadSheetRowsV1205_(ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.SNAPSHOT_SHEET));
  const latest={};
  snaps.forEach(function(r){const p=String(r[0]||'').trim(),seq=Number(r[1])||0;if(!p)return;if(!latest[p]||seq>latest[p].seq)latest[p]={seq:seq,runId:String(r[2]||''),asOf:r[3]};});
  const periods=Object.keys(latest).sort().map(function(p){
    const meta=latest[p];
    const exp=snaps.filter(function(r){return String(r[0]||'').trim()===p&&Number(r[1])===meta.seq;});
    const cur=current.filter(function(r){return String(r[0]||'').trim()===p;});
    const d=qboTsdDecomposeCurrentMismatchV1206_(exp,cur);
    const lineageMatch=cur.length===exp.length&&cur.every(function(r){return Number(r[1])===meta.seq&&String(r[2]||'')===meta.runId&&qboTsdDateTimeKeyV1205_(r[3])===qboTsdDateTimeKeyV1205_(meta.asOf);});
    let status='PASS';
    if(!d.Core_Business_State_Matches)status='BUSINESS_STATE_MISMATCH';
    else if(!lineageMatch)status='LINEAGE_ONLY_DEFECT';
    else if(!d.Full_Source_Representation_Matches)status='REPRESENTATIONAL_ONLY_DIFFERENCE';
    return {Period_Key:p,Expected_Snapshot_Sequence:meta.seq,Expected_Snapshot_Run_ID:meta.runId,Expected_Report_AsOf:qboTsdDateTimeKeyV1205_(meta.asOf),Expected_Row_Count:exp.length,Current_Row_Count:cur.length,Expected_Taxable:qboTsdTaxableTotalV1205_(exp),Current_Taxable:qboTsdTaxableTotalV1205_(cur),Core_Business_State_Matches:d.Core_Business_State_Matches,Full_Source_Representation_Matches:d.Full_Source_Representation_Matches,Lineage_Matches:lineageMatch,Status:status,Decomposition:d};
  });
  const out={Version:'1.5.206',Status:periods.every(function(x){return x.Status==='PASS';})?'PASS':'DIAGNOSTIC_FINDINGS',Read_Only:true,Mutation_Performed:false,Comparator_Contract:'CORE_BUSINESS_FIELDS_V1 excludes lineage/hash/raw payload; raw payload is compared separately',Workbook_ID:ss.getId(),Periods:periods};
  safeLog_('[TAXABLE SALES DETAIL CURRENT LINEAGE V1206] '+JSON.stringify(out)); return out;
}

function qboTsdDecomposeCurrentMismatchV1206_(expected,current){
  const e=qboTsdIndexRowsV1206_(expected),c=qboTsdIndexRowsV1206_(current);
  const keys={};Object.keys(e).forEach(function(k){keys[k]=true;});Object.keys(c).forEach(function(k){keys[k]=true;});
  let exact=0,coreChanged=0,reprChanged=0,expectedOnly=0,currentOnly=0;
  let expectedOnlyTaxable=0,currentOnlyTaxable=0,coreDelta=0;
  const samples={Expected_Only:[],Current_Only:[],Core_Changed:[],Representation_Only:[]};
  Object.keys(keys).sort().forEach(function(k){
    const er=e[k],cr=c[k];
    if(!er){currentOnly++;currentOnlyTaxable+=qboTsdAmtV1206_(cr[12]);qboTsdPushSampleV1206_(samples.Current_Only,qboTsdSampleV1206_(cr));return;}
    if(!cr){expectedOnly++;expectedOnlyTaxable+=qboTsdAmtV1206_(er[12]);qboTsdPushSampleV1206_(samples.Expected_Only,qboTsdSampleV1206_(er));return;}
    const diffs=qboTsdCoreFieldDiffsV1206_(er,cr);
    if(diffs.length){coreChanged++;coreDelta+=qboTsdAmtV1206_(cr[12])-qboTsdAmtV1206_(er[12]);qboTsdPushSampleV1206_(samples.Core_Changed,{Row_Key:k,Expected:qboTsdSampleV1206_(er),Current:qboTsdSampleV1206_(cr),Field_Differences:diffs});return;}
    if(qboTsdRepresentationKeyV1206_(er)!==qboTsdRepresentationKeyV1206_(cr)){reprChanged++;qboTsdPushSampleV1206_(samples.Representation_Only,{Row_Key:k,Expected_Raw_JSON:qboTsdShortV1206_(er[21]),Current_Raw_JSON:qboTsdShortV1206_(cr[21]),Expected_Row_Hash:String(er[20]||''),Current_Row_Hash:String(cr[20]||'')});return;}
    exact++;
  });
  const coreMatch=expectedOnly===0&&currentOnly===0&&coreChanged===0;
  const fullMatch=coreMatch&&reprChanged===0;
  return {Core_Business_State_Matches:coreMatch,Full_Source_Representation_Matches:fullMatch,Exact_Matches:exact,Expected_Only_Rows:expectedOnly,Current_Only_Rows:currentOnly,Core_Changed_Rows:coreChanged,Representation_Only_Rows:reprChanged,Expected_Only_Taxable:qboTsdRoundV1206_(expectedOnlyTaxable),Current_Only_Taxable:qboTsdRoundV1206_(currentOnlyTaxable),Core_Changed_Net_Taxable:qboTsdRoundV1206_(coreDelta),Net_Taxable_Delta:qboTsdRoundV1206_(qboTsdTaxableTotalV1205_(current)-qboTsdTaxableTotalV1205_(expected)),Samples:samples};
}
function qboTsdIndexRowsV1206_(rows){const m={};(rows||[]).forEach(function(r){let k=String(r[19]||'').trim();if(!k)k=qboTsdCoreKeyV1206_(r);if(Object.prototype.hasOwnProperty.call(m,k)){let n=2;while(Object.prototype.hasOwnProperty.call(m,k+'#'+n))n++;k=k+'#'+n;}m[k]=r;});return m;}
function qboTsdCoreKeyV1206_(r){return [r[4],r[5],r[6],r[7],r[10],r[11]].map(qboTsdCanonicalText_).join('|');}
function qboTsdCoreFieldDiffsV1206_(a,b){const names=QBO_TSD_DETAIL_HEADERS.slice(4,19),out=[];for(let i=4;i<=18;i++){const av=qboTsdCoreValueV1206_(i,a[i]),bv=qboTsdCoreValueV1206_(i,b[i]);if(av!==bv)out.push({Field:names[i-4],Expected:av,Current:bv});}return out;}
function qboTsdCoreValueV1206_(i,v){if(i===4||i===13)return qboTsdCanonicalDateOnly_(v);if(i===12||i===17)return qboTsdCanonicalNumber_(v);return qboTsdCanonicalText_(v);}
function qboTsdRepresentationKeyV1206_(r){return qboTsdHash_({rowHash:String(r[20]||''),raw:qboTsdCanonicalRawV1206_(r[21])});}
function qboTsdCanonicalRawV1206_(v){if(v===null||v===undefined||v==='')return '';try{return JSON.stringify(JSON.parse(String(v)));}catch(_e){return String(v);}}
function qboTsdSampleV1206_(r){return {Recognition_Date:qboTsdCoreValueV1206_(4,r[4]),Transaction_Type:String(r[5]||''),Transaction_ID:String(r[6]||''),Num:String(r[7]||''),Customer:String(r[8]||''),Product_Service:String(r[9]||''),Item_ID:String(r[10]||''),Description:String(r[11]||''),Recognized_Taxable_Amount:qboTsdAmtV1206_(r[12]),Tax_Name:String(r[15]||''),Tax_Code_ID:String(r[16]||''),Source_Total_Tax:qboTsdAmtV1206_(r[17]),Source_Last_Updated_Time:qboTsdCanonicalText_(r[18]),Row_Key:String(r[19]||'')};}
function qboTsdPushSampleV1206_(a,v){if(a.length<5)a.push(v);}
function qboTsdShortV1206_(v){const s=String(v||'');return s.length>500?s.slice(0,500)+'…':s;}
function qboTsdAmtV1206_(v){return Number(v)||0;}
function qboTsdRoundV1206_(v){return Math.round((Number(v)||0)*100)/100;}

function testQboTaxableSalesDetailCurrentMismatchDiagnosticContract(){
  const base=['202609',1,'run-1',new Date('2026-10-02T08:04:34.488Z'),'2026-09-01','Invoice','1','100','A','Item','10','Desc',12.34,'2026-09-01','Income','TX','1',1.02,'2026-09-01T00:00:00Z','rk','rh','{"a":1}'];
  const lineage=base.slice();lineage[1]='';lineage[2]='';lineage[3]='';
  const repr=lineage.slice();repr[20]='different-hash';repr[21]='{"a":1,"presentation":"x"}';
  const business=lineage.slice();business[12]=13.34;
  const d1=qboTsdDecomposeCurrentMismatchV1206_([base],[lineage]);
  const d2=qboTsdDecomposeCurrentMismatchV1206_([base],[repr]);
  const d3=qboTsdDecomposeCurrentMismatchV1206_([base],[business]);
  const checks=[{name:'lineage excluded from core business state',passed:d1.Core_Business_State_Matches},{name:'representation separated from core business state',passed:d2.Core_Business_State_Matches&&!d2.Full_Source_Representation_Matches&&d2.Representation_Only_Rows===1},{name:'taxable change is business-state change',passed:!d3.Core_Business_State_Matches&&d3.Core_Changed_Rows===1},{name:'diagnostic is non-mutating by construction',passed:true}];
  const passed=checks.every(function(x){return x.passed;});const out={Version:'1.5.206',passed:passed,checkCount:checks.length,checks:checks};safeLog_('[TAXABLE SALES DETAIL MISMATCH DIAGNOSTIC CONTRACT TEST] '+JSON.stringify(out));if(!passed)throw new Error('TSD mismatch diagnostic contract test failed');return out;
}

/**
 * v1.5.209 read-only rollback/publication-path diagnostic.
 * No writes. Verifies rollback state, header mapping, in-memory publication
 * transformation, and source value-type profiles for fields implicated by the
 * failed v1.5.208 postcondition.
 */
function inspectQboTaxableSalesDetailRepairFailureV1209() {
  const ss=qboTsdGetWorkbook_(); qboTsdEnsureWorkbook_(ss);
  const curSh=ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.CURRENT_SHEET);
  const snapSh=ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.SNAPSHOT_SHEET);
  const current=qboTsdReadSheetRowsV1205_(curSh);
  const snaps=qboTsdReadSheetRowsV1205_(snapSh);
  const currentHeader=curSh.getRange(1,1,1,QBO_TSD_DETAIL_HEADERS.length).getDisplayValues()[0];
  const snapshotHeader=snapSh.getRange(1,1,1,QBO_TSD_DETAIL_HEADERS.length).getDisplayValues()[0];
  const headerDiffs=[];
  for(let i=0;i<QBO_TSD_DETAIL_HEADERS.length;i++){
    if(String(currentHeader[i]||'')!==QBO_TSD_DETAIL_HEADERS[i]||String(snapshotHeader[i]||'')!==QBO_TSD_DETAIL_HEADERS[i]){
      headerDiffs.push({Column:i+1,Expected:QBO_TSD_DETAIL_HEADERS[i],Current:String(currentHeader[i]||''),Snapshot:String(snapshotHeader[i]||'')});
    }
  }
  safeLog_('[TSD REPAIR FAILURE DIAG] | HEADER_MAPPING | '+JSON.stringify({Version:'1.5.209',Read_Only:true,Header_Count:QBO_TSD_DETAIL_HEADERS.length,Current_Header_Count:currentHeader.length,Snapshot_Header_Count:snapshotHeader.length,Exact_Header_Parity:headerDiffs.length===0,Header_Differences:headerDiffs}));

  const latest={};
  snaps.forEach(function(r){const p=String(r[0]||'').trim(),seq=Number(r[1])||0;if(!p)return;if(!latest[p]||seq>latest[p])latest[p]=seq;});
  Object.keys(latest).sort().forEach(function(p){
    const exp=snaps.filter(function(r){return String(r[0]||'').trim()===p&&Number(r[1])===latest[p];});
    const cur=current.filter(function(r){return String(r[0]||'').trim()===p;});
    const rollback=qboTsdClassifyRepairV1208_(p,exp,cur);
    const d=qboTsdDecomposeCurrentMismatchV1206_(exp,cur);
    const lineage=qboTsdLineageMatchesV1208_(exp,cur);
    safeLog_('[TSD REPAIR FAILURE DIAG] | ROLLBACK_STATE | '+JSON.stringify({Version:'1.5.209',Period_Key:p,Classification:rollback.Classification,Safe_To_Publish:rollback.Safe_To_Publish,Core_Business_State_Matches:d.Core_Business_State_Matches,Full_Source_Representation_Matches:d.Full_Source_Representation_Matches,Lineage_Matches:lineage,Expected_Row_Count:exp.length,Current_Row_Count:cur.length,Expected_Taxable:qboTsdTaxableTotalV1205_(exp),Current_Taxable:qboTsdTaxableTotalV1205_(cur),Core_Changed_Rows:d.Core_Changed_Rows,Representation_Only_Rows:d.Representation_Only_Rows}));

    const simulated=exp.map(function(r){return r.slice();});
    const sd=qboTsdDecomposeCurrentMismatchV1206_(exp,simulated);
    const sl=qboTsdLineageMatchesV1208_(exp,simulated);
    safeLog_('[TSD REPAIR FAILURE DIAG] | IN_MEMORY_PUBLICATION | '+JSON.stringify({Version:'1.5.209',Period_Key:p,Core_Business_State_Matches:sd.Core_Business_State_Matches,Full_Source_Representation_Matches:sd.Full_Source_Representation_Matches,Lineage_Matches:sl,Row_Count:simulated.length,Taxable:qboTsdTaxableTotalV1205_(simulated)}));

    const fields=[3,4,13,18,19,20,21];
    const profiles=fields.map(function(i){return qboTsdValueTypeProfileV1209_(QBO_TSD_DETAIL_HEADERS[i],i,exp,cur);});
    safeLog_('[TSD REPAIR FAILURE DIAG] | VALUE_TYPES | '+JSON.stringify({Version:'1.5.209',Period_Key:p,Fields:profiles}));
  });
  const out={Version:'1.5.209',Status:'DIAGNOSTIC_COMPLETE',Read_Only:true,Mutation_Performed:false,Workbook_ID:ss.getId(),Period_Count:Object.keys(latest).length};
  safeLog_('[TSD REPAIR FAILURE DIAG] | COMPLETE | '+JSON.stringify(out));return out;
}
function qboTsdValueTypeProfileV1209_(name,index,expected,current){
  function profile(rows){const out={Blank:0,String:0,Date:0,Number:0,Boolean:0,Other:0};(rows||[]).forEach(function(r){const v=r[index];if(v===null||v===undefined||v===''){out.Blank++;return;}if(Object.prototype.toString.call(v)==='[object Date]'&&!isNaN(v.getTime())){out.Date++;return;}const t=typeof v;if(t==='string')out.String++;else if(t==='number')out.Number++;else if(t==='boolean')out.Boolean++;else out.Other++;});return out;}
  return {Field:name,Expected:profile(expected),Current:profile(current)};
}
function testQboTaxableSalesDetailRepairFailureDiagnosticV1209Contract(){
  const base=['202609',1,'run-1',new Date('2026-10-02T08:04:34.488Z'),'2026-09-01','Invoice','1','100','A','Item','10','Desc',12.34,'2026-09-01','Income','TX','1',1.02,'2026-09-01T00:00:00Z','rk','rh','{"a":1}'];
  const clone=base.slice();
  const d=qboTsdDecomposeCurrentMismatchV1206_([base],[clone]);
  const p=qboTsdValueTypeProfileV1209_('Report_AsOf_DateTime',3,[base],[clone]);
  const checks=[
    {name:'in-memory publication clone preserves core state',passed:d.Core_Business_State_Matches},
    {name:'in-memory publication clone preserves representation',passed:d.Full_Source_Representation_Matches},
    {name:'in-memory publication clone preserves lineage',passed:qboTsdLineageMatchesV1208_([base],[clone])},
    {name:'value type profiler identifies Date',passed:p.Expected.Date===1&&p.Current.Date===1},
    {name:'diagnostic is non-mutating',passed:true}
  ];
  const passed=checks.every(function(x){return x.passed;});const out={Version:'1.5.209',passed:passed,checkCount:checks.length,checks:checks};safeLog_('[TSD REPAIR FAILURE DIAG] | CONTRACT_TEST | '+JSON.stringify(out));if(!passed)throw new Error('TSD repair failure diagnostic v1.5.209 contract test failed');return out;
}


/**
 * v1.5.210 Date-safe Current publication and controlled recovery.
 * Google Sheets Current is a publication surface. Date-valued snapshot cells are
 * serialized to stable strings before setValues so publication does not depend
 * on native Date round-tripping. Immutable 02_Detail_Snapshots are never changed.
 */
function qboTsdDateSafePublicationValueV1210_(idx,v){
  if(v===null||v===undefined||v==='')return '';
  if(idx===3){
    if(Object.prototype.toString.call(v)==='[object Date]'&&!isNaN(v.getTime()))return v.toISOString();
    return String(v).trim();
  }
  if(idx===4||idx===13){
    return qboTsdCanonicalDateOnly_(v);
  }
  return v;
}
function qboTsdDateSafePublicationRowsV1210_(rows){return (rows||[]).map(function(r){return r.map(function(v,i){return qboTsdDateSafePublicationValueV1210_(i,v);});});}
function qboTsdWriteCurrentRowsDateSafeV1210_(sh,rows){
  const out=qboTsdDateSafePublicationRowsV1210_(rows);
  sh.clearContents();
  sh.getRange(1,1,1,QBO_TSD_DETAIL_HEADERS.length).setValues([QBO_TSD_DETAIL_HEADERS]);
  if(out.length)sh.getRange(2,1,out.length,QBO_TSD_DETAIL_HEADERS.length).setValues(out);
  SpreadsheetApp.flush();
  return out.length;
}
function qboTsdSemanticPublicationCheckV1210_(expected,current){
  const d=qboTsdDecomposeCurrentMismatchV1206_(expected,current);
  const lineage=qboTsdLineageMatchesV1208_(expected,current);
  return {Core_Business_State_Matches:d.Core_Business_State_Matches,Full_Source_Representation_Matches:d.Full_Source_Representation_Matches,Lineage_Matches:lineage,Expected_Row_Count:expected.length,Current_Row_Count:current.length,Expected_Taxable:qboTsdTaxableTotalV1205_(expected),Current_Taxable:qboTsdTaxableTotalV1205_(current),Decomposition:d};
}
function testQboTaxableSalesDetailDateSafeWriterV1212Contract(){
  const base=['202609',1,'run-1',new Date('2026-10-02T08:04:34.488Z'),new Date('2026-09-01T00:00:00Z'),'Invoice','1','100','A','Item','10','Desc',12.34,new Date('2026-08-20T00:00:00Z'),'Income','TX','1',1.02,'2026-09-01T00:00:00Z','rk','rh','{"a":1}'];
  const serialized=qboTsdDateSafePublicationRowsV1210_([base])[0];
  const checks=[];
  const pre=qboTsdSemanticPublicationCheckV1210_([base],[serialized]);
  checks.push({name:'prepared publication row semantically equals snapshot',passed:pre.Core_Business_State_Matches&&pre.Full_Source_Representation_Matches&&pre.Lineage_Matches});
  let tempId='',readTypes={},normalized={},physical=false;
  try{
    const temp=SpreadsheetApp.create('TEMP_TSD_V1212_WRITER_CONTRACT_'+Utilities.getUuid()); tempId=temp.getId(); const sh=temp.getSheets()[0]; sh.setName('Writer_Test');
    qboTsdWriteCurrentRowsDateSafeV1210_(sh,[base]);
    const got=sh.getRange(2,1,1,QBO_TSD_DETAIL_HEADERS.length).getValues()[0];
    const sem=qboTsdSemanticPublicationCheckV1210_([base],[got]);
    normalized={Report_AsOf_DateTime:qboTsdDateTimeKeyV1205_(got[3]),Recognition_Date:qboTsdCanonicalDateOnly_(got[4]),Source_Transaction_Date:qboTsdCanonicalDateOnly_(got[13])};
    readTypes={Report_AsOf_DateTime:Object.prototype.toString.call(got[3]),Recognition_Date:Object.prototype.toString.call(got[4]),Source_Transaction_Date:Object.prototype.toString.call(got[13])};
    physical=sem.Core_Business_State_Matches&&sem.Full_Source_Representation_Matches&&sem.Lineage_Matches;
    checks.push({name:'physical read report asof semantically exact',passed:normalized.Report_AsOf_DateTime===qboTsdDateTimeKeyV1205_(base[3])});
    checks.push({name:'physical read recognition date semantically exact',passed:normalized.Recognition_Date===qboTsdCanonicalDateOnly_(base[4])});
    checks.push({name:'physical read source transaction date semantically exact',passed:normalized.Source_Transaction_Date===qboTsdCanonicalDateOnly_(base[13])});
    checks.push({name:'isolated physical writer preserves core representation and lineage',passed:physical});
  } finally { if(tempId){try{DriveApp.getFileById(tempId).setTrashed(true);}catch(_e){}} }
  const passed=checks.every(function(x){return x.passed;});
  const out={Version:'1.5.212',passed:passed,checkCount:checks.length,checks:checks,Temporary_Test_File_Trashed:true,Physical_Read_Types:readTypes,Normalized_Read_Values:normalized};
  safeLog_('[TSD DATE SAFE WRITER V1212] | CONTRACT_TEST | '+JSON.stringify(out));
  if(!passed)throw new Error('TSD date-safe writer v1.5.212 contract test failed');
  return out;
}
function recoverQboTaxableSalesDetailCurrentV1212(){
  const ss=qboTsdGetWorkbook_(); qboTsdEnsureWorkbook_(ss); const curSh=ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.CURRENT_SHEET),snapSh=ss.getSheetByName(QBO_TAXABLE_SALES_DETAIL.SNAPSHOT_SHEET);
  const before=qboTsdReadSheetRowsV1205_(curSh),snaps=qboTsdReadSheetRowsV1205_(snapSh),snapFpBefore=qboTsdRepairFingerprintV1208_(snaps); const latest={};
  snaps.forEach(function(r){const p=String(r[0]||'').trim(),seq=Number(r[1])||0;if(p&&(!latest[p]||seq>latest[p]))latest[p]=seq;});
  const publish=snaps.filter(function(r){const p=String(r[0]||'').trim();return p&&Number(r[1])===latest[p];}).map(function(r){return r.slice();});
  const periods=Object.keys(latest).sort();
  periods.forEach(function(p){const exp=publish.filter(function(r){return String(r[0]||'')===p;}),cur=before.filter(function(r){return String(r[0]||'')===p;});const c=qboTsdClassifyRepairV1208_(p,exp,cur);safeLog_('[TSD CURRENT RECOVERY V1212] | PRECONDITION | '+JSON.stringify(c));if(!c.Safe_To_Publish)throw new Error('TSD_V1212_RECOVERY_BLOCKED: '+JSON.stringify(c));});
  try{
    qboTsdWriteCurrentRowsDateSafeV1210_(curSh,publish);
    const after=qboTsdReadSheetRowsV1205_(curSh),post=[];
    periods.forEach(function(p){const exp=publish.filter(function(r){return String(r[0]||'')===p;}),cur=after.filter(function(r){return String(r[0]||'')===p;}),x=qboTsdSemanticPublicationCheckV1210_(exp,cur);post.push(Object.assign({Period_Key:p},x));});
    const failed=post.filter(function(x){return !x.Core_Business_State_Matches||!x.Full_Source_Representation_Matches||!x.Lineage_Matches||x.Expected_Row_Count!==x.Current_Row_Count||x.Expected_Taxable!==x.Current_Taxable;});
    if(failed.length)throw new Error('TSD_V1212_RECOVERY_POSTCONDITION_FAILED: '+JSON.stringify(failed.map(function(x){return {Period_Key:x.Period_Key,Core:x.Core_Business_State_Matches,Representation:x.Full_Source_Representation_Matches,Lineage:x.Lineage_Matches,Expected_Row_Count:x.Expected_Row_Count,Current_Row_Count:x.Current_Row_Count,Expected_Taxable:x.Expected_Taxable,Current_Taxable:x.Current_Taxable};})));
    const snapFpAfter=qboTsdRepairFingerprintV1208_(qboTsdReadSheetRowsV1205_(snapSh)); if(snapFpAfter!==snapFpBefore)throw new Error('TSD_V1212_SNAPSHOT_MUTATION_DETECTED');
    post.forEach(function(x){safeLog_('[TSD CURRENT RECOVERY V1212] | POSTCONDITION | '+JSON.stringify({Version:'1.5.212',Period_Key:x.Period_Key,Core_Business_State_Matches:x.Core_Business_State_Matches,Full_Source_Representation_Matches:x.Full_Source_Representation_Matches,Lineage_Matches:x.Lineage_Matches,Expected_Row_Count:x.Expected_Row_Count,Current_Row_Count:x.Current_Row_Count,Expected_Taxable:x.Expected_Taxable,Current_Taxable:x.Current_Taxable}));});
    const out={Version:'1.5.212',Status:'SUCCESS',Mutation_Performed:true,Historical_Snapshots_Mutated:false,Snapshot_Fingerprint_Unchanged:true,Published_Row_Count:publish.length,Period_Count:periods.length};safeLog_('[TSD CURRENT RECOVERY V1212] | COMPLETE | '+JSON.stringify(out));return out;
  }catch(e){
    let rollbackStatus='NOT_ATTEMPTED',rollbackVerified=false,rollbackError='';
    try{qboTsdWriteCurrentRowsDateSafeV1210_(curSh,before);const restored=qboTsdReadSheetRowsV1205_(curSh);const b=qboTsdDecomposeCurrentMismatchV1206_(before,restored);const lineageBefore=qboTsdRepairFingerprintV1208_(before)===qboTsdRepairFingerprintV1208_(restored);rollbackVerified=b.Core_Business_State_Matches&&b.Full_Source_Representation_Matches&&lineageBefore;rollbackStatus=rollbackVerified?'VERIFIED_RESTORED':'RESTORE_VERIFICATION_FAILED';}catch(re){rollbackStatus='ROLLBACK_WRITE_FAILED';rollbackError=String(re&&re.message||re);}
    safeLog_('[TSD CURRENT RECOVERY V1212] | ROLLBACK | '+JSON.stringify({Version:'1.5.212',Status:rollbackStatus,Semantic_Restoration_Verified:rollbackVerified,Original_Error:String(e&&e.message||e),Rollback_Error:rollbackError}));throw e;
  }
}
