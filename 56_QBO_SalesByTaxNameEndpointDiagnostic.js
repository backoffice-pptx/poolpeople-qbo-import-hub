/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 56_QBO_SalesByTaxNameEndpointDiagnostic.js
 * Purpose     : READ-ONLY targeted discovery diagnostic for a QBO report/API
 *               source that reproduces Spreadsheet Sync "Sales by Tax Name"
 *               cash-basis semantics.
 *
 * Public API:
 *   - runSalesByTaxNameEndpointDiagnosticJuly2026()
 *   - runSalesByTaxNameEndpointDiagnosticForMonth('2026-07')
 *
 * Important:
 *   - Does NOT modify QBO.
 *   - Does NOT modify the existing sales-tax workbook or normalizer.
 *   - Creates a separate diagnostic spreadsheet.
 *   - Does NOT modify module 55, 99_TriggeredCalls.js, or production triggers.
 * ============================================================================
 */

function runSalesByTaxNameEndpointDiagnosticJuly2026() {
  return runSalesByTaxNameEndpointDiagnosticForMonth('2026-07');
}

function runSalesByTaxNameEndpointDiagnosticForMonth(monthKey) {
  const period = sbtnResolveMonth_(monthKey);
  safeLog_('[SALES BY TAX NAME ENDPOINT DIAG] START month=' + period.monthKey);

  const common =
    'start_date=' + encodeURIComponent(period.startDate) +
    '&end_date=' + encodeURIComponent(period.endDate) +
    '&accounting_method=Cash';

  // Keep this deliberately narrow. TaxableSalesDetail is the known-good control.
  // The other names are plausible report slugs that may exist even when they are
  // not listed in Intuit's public report documentation.
  const probes = [
    {name: 'SalesByTaxName', path: 'reports/SalesByTaxName?' + common},
    {name: 'SalesByTaxCode', path: 'reports/SalesByTaxCode?' + common},
    {name: 'SalesByTaxRate', path: 'reports/SalesByTaxRate?' + common},
    {name: 'NonTaxableSalesDetail', path: 'reports/NonTaxableSalesDetail?' + common},
    {name: 'NontaxableSalesDetail', path: 'reports/NontaxableSalesDetail?' + common},
    {name: 'TaxableSalesDetail_CONTROL', path: 'reports/TaxableSalesDetail?' + common}
  ];

  const ss = SpreadsheetApp.create(
    'QBO_SALES_BY_TAX_NAME_ENDPOINT_DIAG_' +
    period.monthKey.replace('-', '') + '_' +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss')
  );

  const summaryRows = [];
  let successCount = 0;

  probes.forEach(function(probe, index) {
    const started = Date.now();
    try {
      const json = qboGet_(sbtnAppendMinorVersion_(probe.path));
      const flat = sbtnFlattenReport_(json);
      const elapsed = Date.now() - started;
      successCount++;

      summaryRows.push([
        probe.name,
        'SUCCESS',
        elapsed,
        sbtnReportTitle_(json),
        sbtnColumnTitles_(json).join(' | '),
        flat.length,
        '',
        probe.path
      ]);

      sbtnWriteProbeSheet_(
        ss,
        sbtnSheetName_(index + 1, probe.name),
        probe.name,
        json,
        flat
      );

      safeLog_('[SALES BY TAX NAME ENDPOINT DIAG] ' + probe.name +
        ' SUCCESS rows=' + flat.length + ' ms=' + elapsed);
    } catch (err) {
      const elapsed = Date.now() - started;
      const message = err && err.message ? err.message : String(err);
      summaryRows.push([
        probe.name,
        'FAILED',
        elapsed,
        '',
        '',
        0,
        message,
        probe.path
      ]);
      safeLog_('[SALES BY TAX NAME ENDPOINT DIAG] ' + probe.name +
        ' FAILED ms=' + elapsed + ' error=' + message);
    }
  });

  sbtnWriteSummary_(ss, period, summaryRows);

  const result = {
    outputSpreadsheetId: ss.getId(),
    outputSpreadsheetUrl: ss.getUrl(),
    month: period.monthKey,
    probeCount: probes.length,
    successfulProbes: successCount,
    expectedUploadedJulySalesByTaxNameRows: 239,
    expectedUploadedJulyTaxableSalesDetailRows: 216
  };

  safeLog_('[SALES BY TAX NAME ENDPOINT DIAG] COMPLETE ' + JSON.stringify(result));
  return result;
}

function sbtnFlattenReport_(json) {
  const out = [];

  function walk(rows, path, inherited) {
    (rows || []).forEach(function(row, idx) {
      const rowPath = path ? path + '.' + idx : String(idx);
      let nextInherited = inherited || {};

      if (row && row.Header && Array.isArray(row.Header.ColData)) {
        const h = row.Header.ColData;
        nextInherited = {
          header0Value: sbtnCellValue_(h, 0),
          header0Id: sbtnCellId_(h, 0),
          header1Value: sbtnCellValue_(h, 1),
          header1Id: sbtnCellId_(h, 1)
        };
        out.push(sbtnFlatRow_('HEADER', rowPath, h, nextInherited));
      }

      if (row && Array.isArray(row.ColData)) {
        out.push(sbtnFlatRow_('DATA', rowPath, row.ColData, nextInherited));
      }

      if (row && row.Summary && Array.isArray(row.Summary.ColData)) {
        out.push(sbtnFlatRow_('SUMMARY', rowPath, row.Summary.ColData, nextInherited));
      }

      if (row && row.Rows && Array.isArray(row.Rows.Row)) {
        walk(row.Rows.Row, rowPath, nextInherited);
      }
    });
  }

  walk(json && json.Rows && Array.isArray(json.Rows.Row) ? json.Rows.Row : [], '', {});
  return out;
}

function sbtnFlatRow_(rowKind, rowPath, cells, inherited) {
  const values = [];
  const ids = [];
  for (let i = 0; i < 16; i++) {
    values.push(sbtnCellValue_(cells, i));
    ids.push(sbtnCellId_(cells, i));
  }
  return [
    rowKind,
    rowPath,
    inherited && inherited.header0Value ? inherited.header0Value : '',
    inherited && inherited.header0Id ? inherited.header0Id : '',
    inherited && inherited.header1Value ? inherited.header1Value : '',
    inherited && inherited.header1Id ? inherited.header1Id : ''
  ].concat(values).concat(ids);
}

function sbtnWriteProbeSheet_(ss, sheetName, probeName, json, flatRows) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  sheet.clear();

  const colTitles = sbtnColumnTitles_(json);
  const headers = [
    'Row Kind', 'Row Path',
    'Inherited Header 0', 'Inherited Header 0 ID',
    'Inherited Header 1', 'Inherited Header 1 ID'
  ];
  for (let i = 0; i < 16; i++) headers.push('Value ' + i);
  for (let i = 0; i < 16; i++) headers.push('ID ' + i);

  const meta = [
    ['Probe', probeName],
    ['Report Title', sbtnReportTitle_(json)],
    ['Report Columns', colTitles.join(' | ')],
    ['Flattened Rows', flatRows.length]
  ];
  sheet.getRange(1, 1, meta.length, 2).setValues(meta);
  sheet.getRange(6, 1, 1, headers.length).setValues([headers]);
  if (flatRows.length) {
    sheet.getRange(7, 1, flatRows.length, headers.length).setValues(flatRows);
  }
  sheet.setFrozenRows(6);
  sheet.getRange(1, 1, Math.max(6 + flatRows.length, 6), headers.length)
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  sheet.getRange(6, 1, 1, headers.length).setFontWeight('bold');
}

function sbtnWriteSummary_(ss, period, rows) {
  let sheet = ss.getSheetByName('00_Probe_Summary');
  if (!sheet) sheet = ss.insertSheet('00_Probe_Summary');
  sheet.clear();

  const top = [
    ['Metric', 'Value'],
    ['Month', period.monthKey],
    ['Start Date', period.startDate],
    ['End Date', period.endDate],
    ['Accounting Method', 'Cash'],
    ['Uploaded July Sales by Tax Name data rows', 239],
    ['Uploaded July Taxable Sales Detail data rows', 216],
    ['Purpose', 'Find a QBO-native report source that preserves cash-recognition semantics for Sales by Tax Name.']
  ];
  sheet.getRange(1, 1, top.length, 2).setValues(top);

  const headers = [
    'Probe', 'Status', 'Elapsed ms', 'Report Title', 'Columns',
    'Flattened Rows', 'Error', 'Path'
  ];
  sheet.getRange(10, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(11, 1, rows.length, headers.length).setValues(rows);
  sheet.setFrozenRows(10);
  sheet.getRange(1, 1, 10 + rows.length, headers.length)
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
  sheet.getRange(10, 1, 1, headers.length).setFontWeight('bold');
}

function sbtnReportTitle_(json) {
  return json && json.Header && json.Header.ReportName ? json.Header.ReportName : '';
}

function sbtnColumnTitles_(json) {
  const cols = json && json.Columns && Array.isArray(json.Columns.Column)
    ? json.Columns.Column : [];
  return cols.map(function(c) { return c && c.ColTitle ? c.ColTitle : ''; });
}

function sbtnSheetName_(n, probeName) {
  const prefix = String(n).padStart(2, '0') + '_';
  return (prefix + String(probeName || '').replace(/[^A-Za-z0-9_]/g, '_')).slice(0, 99);
}

function sbtnCellValue_(cells, idx) {
  const c = cells && cells[idx] ? cells[idx] : null;
  return c && c.value !== undefined && c.value !== null ? c.value : '';
}

function sbtnCellId_(cells, idx) {
  const c = cells && cells[idx] ? cells[idx] : null;
  return c && c.id !== undefined && c.id !== null ? String(c.id) : '';
}

function sbtnResolveMonth_(monthKey) {
  const raw = String(monthKey || '').trim();
  let year;
  let monthIndex;
  if (raw) {
    const m = raw.match(/^(\d{4})-(\d{2})$/);
    if (!m) throw new Error('monthKey must be YYYY-MM. Received: ' + raw);
    year = Number(m[1]);
    monthIndex = Number(m[2]) - 1;
  } else {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    year = d.getFullYear();
    monthIndex = d.getMonth();
  }
  if (monthIndex < 0 || monthIndex > 11) throw new Error('Invalid monthKey: ' + raw);
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);
  const tz = Session.getScriptTimeZone();
  return {
    monthKey: Utilities.formatDate(start, tz, 'yyyy-MM'),
    startDate: Utilities.formatDate(start, tz, 'yyyy-MM-dd'),
    endDate: Utilities.formatDate(end, tz, 'yyyy-MM-dd')
  };
}

function sbtnAppendMinorVersion_(path) {
  const cfg = getConfig_();
  const mv = cfg && cfg.minorVersion ? cfg.minorVersion : 75;
  return path + (path.indexOf('?') === -1 ? '?' : '&') +
    'minorversion=' + encodeURIComponent(mv);
}
