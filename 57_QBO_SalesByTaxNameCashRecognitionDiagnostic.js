/**
 * 57_QBO_SalesByTaxNameCashRecognitionDiagnostic.js
 *
 * Narrow diagnostic for finding a QBO-native cash-basis source capable of
 * reproducing the Spreadsheet Sync "Sales by Tax Name" recognition semantics.
 *
 * READ ONLY against QBO. Creates a separate diagnostic spreadsheet.
 * Does not modify production export sheets, normalizer, triggers, or module 55.
 */

function runSalesByTaxNameCashRecognitionDiagnosticJuly2026() {
  return runSalesByTaxNameCashRecognitionDiagnosticForMonth_('2026-07');
}

function runSalesByTaxNameCashRecognitionDiagnosticForMonth_(monthKey) {
  var parts = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!parts) throw new Error('monthKey must be YYYY-MM');

  var year = Number(parts[1]);
  var month = Number(parts[2]);
  var startDate = Utilities.formatDate(new Date(year, month - 1, 1), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var endDate = Utilities.formatDate(new Date(year, month, 0), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  console.log('[SALES BY TAX NAME CASH RECOGNITION DIAG] START month=' + monthKey);

  var ss = SpreadsheetApp.create(
    'QBO_SALES_BY_TAX_NAME_CASH_RECOG_DIAG_' +
    monthKey.replace('-', '') + '_' +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss')
  );

  var summary = [];
  summary.push(['Probe', 'Basis', 'Success', 'Flattened Rows', 'Matched Control Rows', 'Elapsed ms', 'Error']);

  var controls = [
    { txnId: '68357', num: '64420', note: 'June invoice recognized 2026-07-01/04 in uploaded July source' },
    { txnId: '64646', num: '63344', note: 'Dec 2025 invoice partially recognized in July: 124.43 + 25.57' },
    { txnId: '32921', num: '51854', note: 'Legacy 8.25% invoice recognized 0.65 in July' },
    { txnId: '68689', num: '64528', note: 'Credit memo with repeated cash-recognized allocations' },
    { txnId: '69119', num: '64660', note: 'Partial recognition near month end' },
    { txnId: '69098', num: '64658', note: 'Refund transaction' }
  ];

  var probes = [
    { name: 'GeneralLedger_CASH', path: 'reports/GeneralLedger', basis: 'Cash' },
    { name: 'ProfitAndLossDetail_CASH', path: 'reports/ProfitAndLossDetail', basis: 'Cash' },
    { name: 'GeneralLedger_ACCRUAL_CONTROL', path: 'reports/GeneralLedger', basis: 'Accrual' }
  ];

  probes.forEach(function(p, idx) {
    var started = Date.now();
    var rows = [];
    var matched = [];
    var error = '';
    try {
      var path = p.path +
        '?start_date=' + encodeURIComponent(startDate) +
        '&end_date=' + encodeURIComponent(endDate) +
        '&accounting_method=' + encodeURIComponent(p.basis);

      var report = qboGet_(path);
      rows = stcrFlattenReport_(report);

      controls.forEach(function(c) {
        rows.forEach(function(r) {
          var hay = [
            r.visibleValues,
            r.ids,
            r.groupPath,
            r.colKeys
          ].join(' | ');
          if (hay.indexOf(c.txnId) >= 0 || hay.indexOf(c.num) >= 0) {
            matched.push([
              p.name, c.txnId, c.num, c.note,
              r.rowType, r.groupPath, r.visibleValues, r.ids, r.colKeys, r.rawJson
            ]);
          }
        });
      });

      stcrWriteRows_(ss, (idx + 1) + '_' + p.name, rows);
      if (matched.length) {
        stcrWriteMatrix_(ss, 'MATCH_' + (idx + 1) + '_' + p.name, [
          ['Probe','Control Txn ID','Control Num','Why Control Matters','Row Type','Group Path','Visible Values','IDs','Column Keys','Raw Row JSON']
        ].concat(matched));
      }

      console.log('[SALES BY TAX NAME CASH RECOGNITION DIAG] ' + p.name +
        ' SUCCESS rows=' + rows.length +
        ' matchedControls=' + matched.length +
        ' ms=' + (Date.now() - started));

      summary.push([p.name, p.basis, true, rows.length, matched.length, Date.now() - started, '']);
    } catch (e) {
      error = e && e.message ? e.message : String(e);
      console.log('[SALES BY TAX NAME CASH RECOGNITION DIAG] ' + p.name +
        ' FAILED ms=' + (Date.now() - started) + ' error=' + error);
      summary.push([p.name, p.basis, false, 0, 0, Date.now() - started, error]);
    }
  });

  stcrWriteMatrix_(ss, '00_Probe_Summary', summary);

  var controlMatrix = [['Txn ID','Num','Why this is a July control']];
  controls.forEach(function(c) { controlMatrix.push([c.txnId, c.num, c.note]); });
  stcrWriteMatrix_(ss, '00_Control_Transactions', controlMatrix);

  var result = {
    outputSpreadsheetId: ss.getId(),
    outputSpreadsheetUrl: ss.getUrl(),
    month: monthKey,
    startDate: startDate,
    endDate: endDate,
    probes: probes.length,
    purpose: 'Determine whether GeneralLedger or ProfitAndLossDetail exposes true July cash-recognition rows needed for Sales by Tax Name parity.'
  };

  console.log('[SALES BY TAX NAME CASH RECOGNITION DIAG] COMPLETE ' + JSON.stringify(result));
  return result;
}

function stcrFlattenReport_(report) {
  var cols = (report && report.Columns && report.Columns.Column) || [];
  var colKeys = cols.map(function(c, i) {
    return [
      c.ColKey || '',
      c.ColType || '',
      ((c.ColTitle || [])[0] || {}).value || '',
      'c' + (i + 1)
    ].filter(String).join(':');
  });

  var out = [];
  var rows = (report && report.Rows && report.Rows.Row) || [];

  function walk(rowList, path) {
    (rowList || []).forEach(function(row) {
      var hdr = row.Header && row.Header.ColData ? row.Header.ColData : null;
      var dat = row.ColData || null;
      var sum = row.Summary && row.Summary.ColData ? row.Summary.ColData : null;

      var values = hdr || dat || sum || [];
      var rowType = hdr ? 'Header' : (dat ? 'Data' : (sum ? 'Summary' : (row.type || 'Other')));

      var visible = values.map(function(c) { return c && c.value != null ? String(c.value) : ''; });
      var ids = values.map(function(c) { return c && c.id != null ? String(c.id) : ''; });

      var label = visible.filter(String)[0] || '';
      var nextPath = path;
      if (hdr && label) nextPath = path.concat([label]);

      out.push({
        rowType: rowType,
        groupPath: nextPath.join(' > '),
        visibleValues: visible.join(' | '),
        ids: ids.join(' | '),
        colKeys: colKeys.join(' | '),
        rawJson: stcrCellSafe_(JSON.stringify(row))
      });

      if (row.Rows && row.Rows.Row) {
        walk(row.Rows.Row, nextPath);
      }
    });
  }

  walk(rows, []);
  return out;
}

function stcrWriteRows_(ss, sheetName, rows) {
  var matrix = [['Row Type','Group Path','Visible Values','IDs','Column Keys','Raw Row JSON']];
  rows.forEach(function(r) {
    matrix.push([r.rowType, r.groupPath, r.visibleValues, r.ids, r.colKeys, r.rawJson]);
  });
  stcrWriteMatrix_(ss, sheetName, matrix);
}

function stcrWriteMatrix_(ss, sheetName, matrix) {
  var safe = String(sheetName).substring(0, 100);
  var sh = ss.getSheetByName(safe) || ss.insertSheet(safe);
  sh.clear();
  if (!matrix || !matrix.length) return;
  var width = matrix.reduce(function(m, r) { return Math.max(m, r.length); }, 0);
  var normalized = matrix.map(function(r) {
    var x = r.slice();
    while (x.length < width) x.push('');
    return x.map(function(v) { return stcrCellSafe_(v); });
  });
  sh.getRange(1, 1, normalized.length, width).setValues(normalized);
  sh.getRange(1, 1, 1, width).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.getDataRange().setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
}


/**
 * Google Sheets rejects any single cell over 50,000 characters.
 * Keep diagnostic output safely below that limit without changing
 * the underlying QBO probe or matching logic.
 */
function stcrCellSafe_(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return value;
  var max = 45000;
  if (value.length <= max) return value;
  return value.substring(0, max) + '\n...[TRUNCATED FOR GOOGLE SHEETS CELL LIMIT]';
}
