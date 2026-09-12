/**
 * 59_QBO_SalesByTaxNameResidualGlDiagnostic.js
 *
 * Narrow follow-up to module 58 GL parity diagnostic.
 *
 * Purpose:
 *   Inspect the authoritative Sales by Tax Name rows that remain outside the
 *   Income / Other Income GL candidate population, and determine whether those
 *   rows already exist exactly in the raw Cash-basis General Ledger under other
 *   account types.
 *
 * READ ONLY against QBO and the authoritative Spreadsheet Sync workbook.
 * Writes only to a newly-created diagnostic spreadsheet.
 * Does NOT modify production GL exporter/backfill modules, config, REST
 * framework, normalizer, triggers, or modules 55-58.
 */

function runSalesByTaxNameResidualGlDiagnosticJuly2026() {
  return runSalesByTaxNameResidualGlDiagnosticForMonth_('2026-07');
}

function runSalesByTaxNameResidualGlDiagnosticForMonth_(monthKey) {
  var m = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new Error('monthKey must be YYYY-MM');

  var year = Number(m[1]);
  var month = Number(m[2]);
  var tz = Session.getScriptTimeZone();
  var startDate = Utilities.formatDate(new Date(year, month - 1, 1), tz, 'yyyy-MM-dd');
  var endDate = Utilities.formatDate(new Date(year, month, 0), tz, 'yyyy-MM-dd');

  var authoritativeSpreadsheetId = '1XuZDZ488S8Keb00PvqlO4va9J-YuFcZm9gJow2j_rSk';
  var authoritativeSheetName = 'LastMonthSalesbyTaxName';

  console.log('[SALES BY TAX NAME RESIDUAL GL DIAG] START month=' + monthKey);

  var gl = qboGet_(
    'reports/GeneralLedger' +
    '?start_date=' + encodeURIComponent(startDate) +
    '&end_date=' + encodeURIComponent(endDate) +
    '&accounting_method=Cash'
  );

  var accounts = stgrLoadAccounts_();
  var glRows = stgrFlattenGl_(gl, accounts);
  var sourceRows = stgrReadAuthoritativeSalesRows_(authoritativeSpreadsheetId, authoritativeSheetName);

  var incomeCandidates = glRows.filter(stgrIsIncomeCandidate_);
  var parity = stgrCompareCoreParity_(incomeCandidates, sourceRows);
  var missing = parity.missing;

  var missingKeys = {};
  var targetTxnIds = {};
  missing.forEach(function(r) {
    missingKeys[stgrCoreKeyFromSource_(r)] = true;
    if (r.transactionId) targetTxnIds[String(r.transactionId)] = true;
  });

  var rawExactMatches = glRows.filter(function(r) {
    return missingKeys[stgrCoreKeyFromGl_(r)] === true;
  });

  var targetRawRows = glRows.filter(function(r) {
    return targetTxnIds[String(r.transactionId || '')] === true;
  });

  var unresolvedMissing = missing.filter(function(s) {
    var k = stgrCoreKeyFromSource_(s);
    return !rawExactMatches.some(function(g) { return stgrCoreKeyFromGl_(g) === k; });
  });

  var ss = SpreadsheetApp.create(
    'QBO_SALES_BY_TAX_NAME_RESIDUAL_GL_DIAG_' +
    monthKey.replace('-', '') + '_' +
    Utilities.formatDate(new Date(), tz, 'yyyyMMdd_HHmmss')
  );

  stgrWriteMatrix_(ss, '00_Run_Summary', [
    ['Metric', 'Value'],
    ['Month', monthKey],
    ['Start Date', startDate],
    ['End Date', endDate],
    ['Authoritative spreadsheet ID', authoritativeSpreadsheetId],
    ['Authoritative sheet', authoritativeSheetName],
    ['Authoritative data rows', sourceRows.length],
    ['Income / Other Income GL candidates', incomeCandidates.length],
    ['Matched by module-58 core rule', parity.matched.length],
    ['Residual authoritative rows', missing.length],
    ['Residual rows found exactly in raw GL', rawExactMatches.length],
    ['Residual rows still not found in raw GL', unresolvedMissing.length],
    ['Target transaction count', Object.keys(targetTxnIds).length],
    ['Production GL modules changed', 'NO'],
    ['Production GL backfill affected', 'NO']
  ]);

  stgrWriteMatrix_(ss, '10_Residual_Authoritative',
    [['Tax Name','Transaction ID','Recognition Date','Product/Service','Distribution Account','Amount','Source Date','Transaction Type','Num','Customer','Tax Code','Tax Code Status','Core Match Key']]
    .concat(missing.map(function(r) {
      return [r.taxName,r.transactionId,r.recognitionDate,r.productService,r.distributionAccount,r.amount,r.sourceDate,r.transactionType,r.num,r.customer,r.taxCode,r.taxCodeStatus,stgrCoreKeyFromSource_(r)];
    }))
  );

  stgrWriteMatrix_(ss, '20_Exact_Raw_GL_Matches',
    [['Recognition Date','Transaction Type','Transaction ID','Num','Customer','Distribution Account','Account ID','Account Type','Account SubType','Classification','Amount','Memo','Split Account','Income Candidate?','Core Match Key']]
    .concat(rawExactMatches.map(function(r) {
      return [r.recognitionDate,r.transactionType,r.transactionId,r.num,r.customer,r.distributionAccount,r.accountId,r.accountType,r.accountSubType,r.classification,r.amount,r.memo,r.splitAccount,stgrIsIncomeCandidate_(r) ? 'YES' : 'NO',stgrCoreKeyFromGl_(r)];
    }))
  );

  stgrWriteMatrix_(ss, '30_All_GL_Target_Txns',
    [['Recognition Date','Transaction Type','Transaction ID','Num','Customer','Distribution Account','Account ID','Account Type','Account SubType','Classification','Amount','Memo','Split Account','Income Candidate?','Matches Residual Core?']]
    .concat(targetRawRows.map(function(r) {
      var key = stgrCoreKeyFromGl_(r);
      return [r.recognitionDate,r.transactionType,r.transactionId,r.num,r.customer,r.distributionAccount,r.accountId,r.accountType,r.accountSubType,r.classification,r.amount,r.memo,r.splitAccount,stgrIsIncomeCandidate_(r) ? 'YES' : 'NO',missingKeys[key] ? 'YES' : 'NO'];
    }))
  );

  stgrWriteMatrix_(ss, '40_Unresolved_Residual',
    [['Tax Name','Transaction ID','Recognition Date','Product/Service','Distribution Account','Amount','Source Date','Transaction Type','Num','Customer','Tax Code','Tax Code Status','Core Match Key']]
    .concat(unresolvedMissing.map(function(r) {
      return [r.taxName,r.transactionId,r.recognitionDate,r.productService,r.distributionAccount,r.amount,r.sourceDate,r.transactionType,r.num,r.customer,r.taxCode,r.taxCodeStatus,stgrCoreKeyFromSource_(r)];
    }))
  );

  var result = {
    outputSpreadsheetId: ss.getId(),
    outputSpreadsheetUrl: ss.getUrl(),
    month: monthKey,
    authoritativeRows: sourceRows.length,
    incomeCandidateRows: incomeCandidates.length,
    matchedCoreRows: parity.matched.length,
    residualAuthoritativeRows: missing.length,
    exactResidualRowsFoundInRawGl: rawExactMatches.length,
    unresolvedResidualRows: unresolvedMissing.length,
    targetTransactions: Object.keys(targetTxnIds).length
  };

  console.log('[SALES BY TAX NAME RESIDUAL GL DIAG] COMPLETE ' + JSON.stringify(result));
  return result;
}

function stgrLoadAccounts_() {
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

function stgrFlattenGl_(report, accountMap) {
  var out = [];
  var rows = report && report.Rows && report.Rows.Row ? report.Rows.Row : [];

  function walk(list, ctx) {
    (list || []).forEach(function(row) {
      var next = {
        accountName: ctx.accountName || '',
        accountId: ctx.accountId || '',
        accountType: ctx.accountType || '',
        accountSubType: ctx.accountSubType || '',
        classification: ctx.classification || ''
      };

      if (row.Header && row.Header.ColData) {
        var hc = row.Header.ColData;
        var hv = hc.length ? String(hc[0].value || '') : '';
        var hid = hc.length ? String(hc[0].id || '') : '';
        if (hv) next.accountName = hv;
        if (hid) next.accountId = hid;

        if (next.accountId && accountMap[next.accountId]) {
          var a = accountMap[next.accountId];
          next.accountType = String(a.AccountType || '');
          next.accountSubType = String(a.AccountSubType || '');
          next.classification = String(a.Classification || '');
          if (!next.accountName) {
            next.accountName = String(a.FullyQualifiedName || a.Name || '');
          }
        }
      }

      if (row.ColData) {
        var c = row.ColData;
        out.push({
          recognitionDate: stgrCell_(c,0),
          transactionType: stgrCell_(c,1),
          transactionId: stgrCellId_(c,1),
          num: stgrCell_(c,2),
          customer: stgrCell_(c,3),
          memo: stgrCell_(c,4),
          splitAccount: stgrCell_(c,5),
          amount: stgrNumber_(stgrCell_(c,6)),
          distributionAccount: next.accountName,
          accountId: next.accountId,
          accountType: next.accountType,
          accountSubType: next.accountSubType,
          classification: next.classification
        });
      }

      if (row.Rows && row.Rows.Row) walk(row.Rows.Row, next);
    });
  }

  walk(rows, {});
  return out;
}

function stgrIsIncomeCandidate_(r) {
  var allowedTxn = {'Invoice':true,'Sales Receipt':true,'Credit Memo':true,'Refund':true};
  if (!allowedTxn[r.transactionType]) return false;
  if (!r.transactionId) return false;
  if (r.amount === null || Math.abs(r.amount) < 0.0000001) return false;
  return r.accountType === 'Income' || r.accountType === 'Other Income';
}

function stgrReadAuthoritativeSalesRows_(spreadsheetId, sheetName) {
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error('Authoritative sheet not found: ' + sheetName);
  var lastRow = sh.getLastRow();
  if (lastRow < 5) return [];

  var values = sh.getRange(5,1,lastRow-4,12).getDisplayValues();
  return values.filter(function(r) {
    return String(r[1] || '').trim() !== '' && String(r[7] || '').trim() !== '';
  }).map(function(r) {
    return {
      taxName:r[0],
      transactionId:r[1],
      recognitionDate:stgrNormalizeDateText_(r[2]),
      productService:r[3],
      distributionAccount:r[4],
      amount:stgrNumber_(r[5]),
      sourceDate:stgrNormalizeDateText_(r[6]),
      transactionType:r[7],
      num:r[8],
      customer:r[9],
      taxCode:r[10],
      taxCodeStatus:r[11]
    };
  });
}

function stgrCompareCoreParity_(glRows, sourceRows) {
  var glBuckets = {};
  glRows.forEach(function(r) {
    var k = stgrCoreKeyFromGl_(r);
    if (!glBuckets[k]) glBuckets[k] = [];
    glBuckets[k].push(r);
  });

  var matched = [];
  var missing = [];
  sourceRows.forEach(function(s) {
    var k = stgrCoreKeyFromSource_(s);
    var bucket = glBuckets[k];
    if (bucket && bucket.length) {
      bucket.shift();
      matched.push(s);
    } else {
      missing.push(s);
    }
  });

  var extra = [];
  Object.keys(glBuckets).forEach(function(k) {
    glBuckets[k].forEach(function(r) { extra.push(r); });
  });

  return {matched:matched, missing:missing, extra:extra};
}

function stgrCoreKeyFromGl_(r) {
  return [
    stgrNorm_(r.recognitionDate),
    stgrNorm_(r.transactionType),
    stgrNorm_(r.transactionId),
    stgrNorm_(r.num),
    stgrNorm_(r.customer),
    stgrNormAccount_(r.distributionAccount),
    stgrMoneyKey_(r.amount)
  ].join('|');
}

function stgrCoreKeyFromSource_(r) {
  return [
    stgrNorm_(r.recognitionDate),
    stgrNorm_(r.transactionType),
    stgrNorm_(r.transactionId),
    stgrNorm_(r.num),
    stgrNorm_(r.customer),
    stgrNormAccount_(r.distributionAccount),
    stgrMoneyKey_(r.amount)
  ].join('|');
}

function stgrNormAccount_(v) {
  var s = stgrNorm_(v);
  var parts = s.split('>');
  return stgrNorm_(parts[parts.length - 1]);
}

function stgrNorm_(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/\s+/g,' ')
    .trim()
    .toLowerCase();
}

function stgrMoneyKey_(v) {
  if (v === null || v === undefined || v === '') return '';
  var n = Number(v);
  return isFinite(n) ? n.toFixed(2) : stgrNorm_(v);
}

function stgrNormalizeDateText_(v) {
  var s = String(v || '').trim();
  if (!s) return '';

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

  throw new Error('Unrecognized authoritative date format: ' + s);
}

function stgrCell_(cols, idx) {
  return cols && cols[idx] && cols[idx].value !== undefined
    ? String(cols[idx].value || '')
    : '';
}

function stgrCellId_(cols, idx) {
  return cols && cols[idx] && cols[idx].id !== undefined
    ? String(cols[idx].id || '')
    : '';
}

function stgrNumber_(v) {
  if (v === null || v === undefined || v === '') return null;
  var s = String(v).replace(/[$,\s]/g,'');
  if (!s) return null;
  var n = Number(s);
  return isFinite(n) ? n : null;
}

function stgrWriteMatrix_(ss, sheetName, matrix) {
  var sh = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName.substring(0,100));
  sh.clear();
  if (!matrix || !matrix.length) return;

  var width = matrix.reduce(function(m,r){ return Math.max(m,r.length); },0);
  var normalized = matrix.map(function(r) {
    var x = r.slice();
    while (x.length < width) x.push('');
    return x.map(function(v) {
      if (typeof v !== 'string') return v;
      return v.length <= 45000
        ? v
        : v.substring(0,45000) + '\n...[TRUNCATED FOR GOOGLE SHEETS CELL LIMIT]';
    });
  });

  sh.getRange(1,1,normalized.length,width).setValues(normalized);
  sh.getRange(1,1,1,width).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.getDataRange().setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
}
