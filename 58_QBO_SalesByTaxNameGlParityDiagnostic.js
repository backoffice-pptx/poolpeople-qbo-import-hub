/**
 * 58_QBO_SalesByTaxNameGlParityDiagnostic.js
 *
 * Isolated July 2026 parity diagnostic for replacing Spreadsheet Sync
 * LastMonthSalesbyTaxName with QBO Cash-basis General Ledger data.
 *
 * READ ONLY against QBO and the authoritative July validation spreadsheet.
 * Writes only to a newly-created diagnostic spreadsheet.
 * Does NOT modify production GL exporter/backfill modules, normalizer, triggers,
 * config, REST framework, or module 57.
 */

function runSalesByTaxNameGlParityDiagnosticJuly2026() {
  return runSalesByTaxNameGlParityDiagnosticForMonth_('2026-07');
}

function runSalesByTaxNameGlParityDiagnosticForMonth_(monthKey) {
  var m = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new Error('monthKey must be YYYY-MM');

  var year = Number(m[1]);
  var month = Number(m[2]);
  var tz = Session.getScriptTimeZone();
  var startDate = Utilities.formatDate(new Date(year, month - 1, 1), tz, 'yyyy-MM-dd');
  var endDate = Utilities.formatDate(new Date(year, month, 0), tz, 'yyyy-MM-dd');

  var authoritativeSpreadsheetId = '1XuZDZ488S8Keb00PvqlO4va9J-YuFcZm9gJow2j_rSk';
  var authoritativeSheetName = 'LastMonthSalesbyTaxName';

  console.log('[SALES BY TAX NAME GL PARITY] START month=' + monthKey);

  var gl = qboGet_(
    'reports/GeneralLedger' +
    '?start_date=' + encodeURIComponent(startDate) +
    '&end_date=' + encodeURIComponent(endDate) +
    '&accounting_method=Cash'
  );

  var accounts = stgpLoadAccounts_();
  var glRows = stgpFlattenGl_(gl, accounts);
  var sourceRows = stgpReadAuthoritativeSalesRows_(authoritativeSpreadsheetId, authoritativeSheetName);
  var candidateRows = glRows.filter(stgpIsCandidateSalesComponent_);
  var parity = stgpCompareCoreParity_(candidateRows, sourceRows);

  var ss = SpreadsheetApp.create(
    'QBO_SALES_BY_TAX_NAME_GL_PARITY_' +
    monthKey.replace('-', '') + '_' +
    Utilities.formatDate(new Date(), tz, 'yyyyMMdd_HHmmss')
  );

  stgpWriteMatrix_(ss, '00_Run_Summary', [
    ['Metric', 'Value'],
    ['Month', monthKey],
    ['Start Date', startDate],
    ['End Date', endDate],
    ['Authoritative spreadsheet ID', authoritativeSpreadsheetId],
    ['Authoritative sheet', authoritativeSheetName],
    ['Authoritative data rows', sourceRows.length],
    ['GL flattened data rows', glRows.length],
    ['GL candidate sales component rows', candidateRows.length],
    ['Exact core-key matched rows', parity.matched.length],
    ['Missing from GL candidate', parity.missing.length],
    ['Extra GL candidate', parity.extra.length],
    ['Production GL modules changed', 'NO'],
    ['Production GL backfill affected', 'NO']
  ]);

  stgpWriteMatrix_(ss, '10_GL_Candidates',
    [['Recognition Date','Transaction Type','Transaction ID','Num','Customer','Distribution Account','Account Type','Amount','Memo','Split Account','Core Match Key']]
    .concat(candidateRows.map(function(r) {
      return [r.recognitionDate,r.transactionType,r.transactionId,r.num,r.customer,r.distributionAccount,r.accountType,r.amount,r.memo,r.splitAccount,stgpCoreKeyFromGl_(r)];
    }))
  );

  stgpWriteMatrix_(ss, '20_Authoritative_July',
    [['Tax Name','Transaction ID','Recognition Date','Product/Service','Distribution Account','Amount','Source Date','Transaction Type','Num','Customer','Tax Code','Tax Code Status','Core Match Key']]
    .concat(sourceRows.map(function(r) {
      return [r.taxName,r.transactionId,r.recognitionDate,r.productService,r.distributionAccount,r.amount,r.sourceDate,r.transactionType,r.num,r.customer,r.taxCode,r.taxCodeStatus,stgpCoreKeyFromSource_(r)];
    }))
  );

  stgpWriteMatrix_(ss, '30_Matched_Core',
    [['Core Match Key','Recognition Date','Transaction Type','Transaction ID','Num','Customer','Distribution Account','Amount']].concat(parity.matched)
  );

  stgpWriteMatrix_(ss, '40_Missing_From_GL',
    [['Tax Name','Transaction ID','Recognition Date','Product/Service','Distribution Account','Amount','Source Date','Transaction Type','Num','Customer','Tax Code','Tax Code Status','Core Match Key']]
    .concat(parity.missing.map(function(r) {
      return [r.taxName,r.transactionId,r.recognitionDate,r.productService,r.distributionAccount,r.amount,r.sourceDate,r.transactionType,r.num,r.customer,r.taxCode,r.taxCodeStatus,stgpCoreKeyFromSource_(r)];
    }))
  );

  stgpWriteMatrix_(ss, '50_Extra_GL_Candidates',
    [['Recognition Date','Transaction Type','Transaction ID','Num','Customer','Distribution Account','Account Type','Amount','Memo','Split Account','Core Match Key']]
    .concat(parity.extra.map(function(r) {
      return [r.recognitionDate,r.transactionType,r.transactionId,r.num,r.customer,r.distributionAccount,r.accountType,r.amount,r.memo,r.splitAccount,stgpCoreKeyFromGl_(r)];
    }))
  );

  var result = {
    outputSpreadsheetId: ss.getId(),
    outputSpreadsheetUrl: ss.getUrl(),
    month: monthKey,
    authoritativeRows: sourceRows.length,
    glCandidateRows: candidateRows.length,
    matchedCoreRows: parity.matched.length,
    missingFromGl: parity.missing.length,
    extraGlCandidates: parity.extra.length
  };

  console.log('[SALES BY TAX NAME GL PARITY] COMPLETE ' + JSON.stringify(result));
  return result;
}

function stgpLoadAccounts_() {
  var map = {};
  var rows = qboQueryAllGeneric_(
    'SELECT * FROM Account WHERE Active IN (true, false)',
    'Account'
  );
  rows.forEach(function(a) {
    var id = String(a.Id || '');
    if (id) map[id] = a;
  });
  return map;
}

function stgpFlattenGl_(report, accountMap) {
  var out = [];
  var rows = report && report.Rows && report.Rows.Row ? report.Rows.Row : [];

  function walk(list, ctx) {
    (list || []).forEach(function(row) {
      var next = {accountName: ctx.accountName || '', accountId: ctx.accountId || '', accountType: ctx.accountType || ''};

      if (row.Header && row.Header.ColData) {
        var hc = row.Header.ColData;
        var hv = hc.length ? String(hc[0].value || '') : '';
        var hid = hc.length ? String(hc[0].id || '') : '';
        if (hv) next.accountName = hv;
        if (hid) next.accountId = hid;
        if (next.accountId && accountMap[next.accountId]) {
          next.accountType = String(accountMap[next.accountId].AccountType || '');
          if (!next.accountName) next.accountName = String(accountMap[next.accountId].FullyQualifiedName || accountMap[next.accountId].Name || '');
        }
      }

      if (row.ColData) {
        var c = row.ColData;
        out.push({
          recognitionDate: stgpCell_(c,0), transactionType: stgpCell_(c,1), transactionId: stgpCellId_(c,1),
          num: stgpCell_(c,2), customer: stgpCell_(c,3), memo: stgpCell_(c,4), splitAccount: stgpCell_(c,5),
          amount: stgpNumber_(stgpCell_(c,6)), distributionAccount: next.accountName, accountId: next.accountId, accountType: next.accountType
        });
      }
      if (row.Rows && row.Rows.Row) walk(row.Rows.Row, next);
    });
  }

  walk(rows, {});
  return out;
}

function stgpIsCandidateSalesComponent_(r) {
  var allowedTxn = {'Invoice':true,'Sales Receipt':true,'Credit Memo':true,'Refund':true};
  if (!allowedTxn[r.transactionType]) return false;
  if (!r.transactionId) return false;
  if (r.amount === null || Math.abs(r.amount) < 0.0000001) return false;
  return r.accountType === 'Income' || r.accountType === 'Other Income';
}

function stgpReadAuthoritativeSalesRows_(spreadsheetId, sheetName) {
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error('Authoritative sheet not found: ' + sheetName);
  var lastRow = sh.getLastRow();
  if (lastRow < 5) return [];
  var values = sh.getRange(5,1,lastRow-4,12).getDisplayValues();
  return values.filter(function(r) {
    // Keep transaction rows only. Spreadsheet Sync appends a report timestamp
    // footer after the data; it has neither Transaction ID nor Transaction type.
    return String(r[1] || '').trim() !== '' && String(r[7] || '').trim() !== '';
  }).map(function(r) {
    return {
      taxName:r[0], transactionId:r[1], recognitionDate:stgpNormalizeDateText_(r[2]), productService:r[3],
      distributionAccount:r[4], amount:stgpNumber_(r[5]), sourceDate:stgpNormalizeDateText_(r[6]), transactionType:r[7],
      num:r[8], customer:r[9], taxCode:r[10], taxCodeStatus:r[11]
    };
  });
}

function stgpCompareCoreParity_(glRows, sourceRows) {
  var glBuckets = {};
  glRows.forEach(function(r) {
    var k = stgpCoreKeyFromGl_(r);
    if (!glBuckets[k]) glBuckets[k] = [];
    glBuckets[k].push(r);
  });

  var matched = [], missing = [];
  sourceRows.forEach(function(s) {
    var k = stgpCoreKeyFromSource_(s);
    var bucket = glBuckets[k];
    if (bucket && bucket.length) {
      bucket.shift();
      matched.push([k,s.recognitionDate,s.transactionType,s.transactionId,s.num,s.customer,s.distributionAccount,s.amount]);
    } else {
      missing.push(s);
    }
  });

  var extra = [];
  Object.keys(glBuckets).forEach(function(k) { glBuckets[k].forEach(function(r) { extra.push(r); }); });
  return {matched:matched, missing:missing, extra:extra};
}

function stgpCoreKeyFromGl_(r) {
  return [stgpNorm_(r.recognitionDate),stgpNorm_(r.transactionType),stgpNorm_(r.transactionId),stgpNorm_(r.num),stgpNorm_(r.customer),stgpNormAccount_(r.distributionAccount),stgpMoneyKey_(r.amount)].join('|');
}

function stgpCoreKeyFromSource_(r) {
  return [stgpNorm_(r.recognitionDate),stgpNorm_(r.transactionType),stgpNorm_(r.transactionId),stgpNorm_(r.num),stgpNorm_(r.customer),stgpNormAccount_(r.distributionAccount),stgpMoneyKey_(r.amount)].join('|');
}

function stgpNormAccount_(v) {
  var s = stgpNorm_(v);
  var parts = s.split('>');
  return stgpNorm_(parts[parts.length - 1]);
}

function stgpNorm_(v) {
  return String(v === null || v === undefined ? '' : v).replace(/\s+/g,' ').trim().toLowerCase();
}

function stgpMoneyKey_(v) {
  if (v === null || v === undefined || v === '') return '';
  var n = Number(v);
  return isFinite(n) ? n.toFixed(2) : stgpNorm_(v);
}

function stgpNormalizeDateText_(v) {
  var s = String(v || '').trim();
  if (!s) return '';

  // Spreadsheet Sync can emit the same date column with mixed display formats.
  // ISO date-only text must be preserved as date-only text. Passing YYYY-MM-DD
  // through new Date() parses it as UTC and can shift it to the prior calendar
  // date in America/Chicago (for example 2026-07-10 -> 2026-07-09).
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];

  var dmy = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (dmy) {
    var months = {
      jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
      jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12'
    };
    var mm = months[String(dmy[2]).toLowerCase()];
    if (!mm) throw new Error('Unrecognized authoritative date: ' + s);
    return dmy[3] + '-' + mm + '-' + ('0' + dmy[1]).slice(-2);
  }

  var mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    return mdy[3] + '-' + ('0' + mdy[1]).slice(-2) + '-' + ('0' + mdy[2]).slice(-2);
  }

  // Do not silently reinterpret a nonblank date or inherit another row's date.
  // A new Spreadsheet Sync format should fail visibly so the parity test cannot
  // create a false recognition-date mismatch.
  throw new Error('Unrecognized authoritative date format: ' + s);
}

function stgpCell_(cols, idx) {
  return cols && cols[idx] && cols[idx].value !== undefined ? String(cols[idx].value || '') : '';
}
function stgpCellId_(cols, idx) {
  return cols && cols[idx] && cols[idx].id !== undefined ? String(cols[idx].id || '') : '';
}
function stgpNumber_(v) {
  if (v === null || v === undefined || v === '') return null;
  var s = String(v).replace(/[$,\s]/g,'');
  if (!s) return null;
  var n = Number(s);
  return isFinite(n) ? n : null;
}

function stgpWriteMatrix_(ss, sheetName, matrix) {
  var sh = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName.substring(0,100));
  sh.clear();
  if (!matrix || !matrix.length) return;
  var width = matrix.reduce(function(m,r){return Math.max(m,r.length);},0);
  var normalized = matrix.map(function(r) {
    var x = r.slice();
    while (x.length < width) x.push('');
    return x.map(function(v) {
      if (typeof v !== 'string') return v;
      return v.length <= 45000 ? v : v.substring(0,45000) + '\n...[TRUNCATED FOR GOOGLE SHEETS CELL LIMIT]';
    });
  });
  sh.getRange(1,1,normalized.length,width).setValues(normalized);
  sh.getRange(1,1,1,width).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.getDataRange().setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
}
