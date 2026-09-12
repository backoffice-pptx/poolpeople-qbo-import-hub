/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 54_QBO_SalesTaxSourceParityDiagnostic.js
 * Purpose     : Non-production diagnostic for replacing the two Spreadsheet
 *               Sync source reports used by the existing sales-tax normalizer:
 *                 1) Sales by Tax Name
 *                 2) Taxable Sales Detail - by Tax Name
 *
 * Public API:
 *   - runSalesTaxSourceParityDiagnostic()
 *       Runs for the previous calendar month.
 *   - runSalesTaxSourceParityDiagnosticForMonth('2026-07')
 *       Runs for an explicit calendar month when called from code.
 *   - runSalesTaxSourceParityDiagnosticJuly2026()
 *       Apps Script UI wrapper for the current July 2026 parity test.
 *
 * Current parity test month:
 *   July 2026. From the Apps Script Run dropdown, run:
 *     runSalesTaxSourceParityDiagnosticJuly2026()
 *
 * Important:
 *   - READ ONLY. Does not modify QBO.
 *   - Creates a separate diagnostic spreadsheet.
 *   - Does not modify the existing normalization code.
 *   - Does not modify production export scheduling / 99_TriggeredCalls.js.
 * ============================================================================
 */

const STPD_REPORT_FILTERS = Object.freeze({
  SALES_TRANSACTION_TYPES: ['Credit Memo', 'Refund', 'Invoice', 'Sales Receipt'],
  SALES_EXCLUDED_DISTRIBUTION_ACCOUNTS: [
    'Undeposited Funds',
    'Texas Comptroller Account'
  ],
  TAXABLE_SALES_DETAIL_EXCLUDED_TYPE: 'Bundle'
});

/**
 * Runs for the previous complete calendar month.
 * @return {Object} diagnostic workbook metadata
 */
function runSalesTaxSourceParityDiagnostic() {
  return runSalesTaxSourceParityDiagnosticForMonth('');
}

/**
 * Apps Script UI wrapper for the current July 2026 parity test.
 * The Apps Script Run dropdown cannot supply function arguments.
 * @return {Object} diagnostic workbook metadata
 */
function runSalesTaxSourceParityDiagnosticJuly2026() {
  return runSalesTaxSourceParityDiagnosticForMonth('2026-07');
}

/**
 * Runs the source-report parity diagnostic for exactly one calendar month.
 *
 * @param {string} monthKey YYYY-MM. Blank means previous calendar month.
 * @return {Object} diagnostic workbook metadata
 */
function runSalesTaxSourceParityDiagnosticForMonth(monthKey) {
  const period = stpdResolveMonth_(monthKey);
  safeLog_('[SALES TAX SOURCE PARITY] START month=' + period.monthKey);

  const probeRows = [];
  const reportRows = [];
  const entityRows = [];

  // Tax-code master is required to enrich public transaction/report data with
  // the Custom Report Builder Tax name (for example TX-Houston-3101990).
  stpdRunEntityProbe_(
    'TAX_CODES_ALL',
    'TaxCode',
    'SELECT * FROM TaxCode WHERE Active IN (true, false)',
    probeRows,
    entityRows
  );

  const common =
    'start_date=' + encodeURIComponent(period.startDate) +
    '&end_date=' + encodeURIComponent(period.endDate) +
    '&accounting_method=Cash';

  // Baselines already known to work. These help us inspect the cash-basis
  // transaction hierarchy and preserve parent transaction IDs on split rows.
  stpdRunReportProbe_(
    'TRANSACTION_LIST_CASH',
    'reports/TransactionList?' + common,
    probeRows,
    reportRows
  );

  stpdRunReportProbe_(
    'TRANSACTION_LIST_WITH_SPLITS_CASH',
    'reports/TransactionListWithSplits?' + common,
    probeRows,
    reportRows
  );

  // The QBO UI report is the standard "Taxable Sales Detail" report. Intuit
  // does not document a supported public endpoint for it in the modern report
  // list, so probe the likely API/UI identifiers explicitly and preserve all
  // failures as evidence rather than assuming availability.
  stpdRunReportProbe_(
    'TAXABLE_SALES_DETAIL_CANDIDATE',
    'reports/TaxableSalesDetail?' + common,
    probeRows,
    reportRows
  );

  stpdRunReportProbe_(
    'TAXABLE_SALES_DETAIL_UI_ID',
    'reports/TAXABLE_SALES_DET?' + common,
    probeRows,
    reportRows
  );

  // Related standard report probe. Useful if QBO exposes the summary but not
  // detail report, and also confirms whether sales-tax reports are gated as a
  // class in this company/API surface.
  stpdRunReportProbe_(
    'TAXABLE_SALES_SUMMARY_CANDIDATE',
    'reports/TaxableSalesSummary?' + common,
    probeRows,
    reportRows
  );

  // Preserve the exact user-defined source-report contracts in the workbook so
  // the diagnostic output states what must eventually be reproduced.
  const contractRows = stpdBuildContractRows_(period);

  const output = stpdWriteWorkbook_(
    period,
    probeRows,
    entityRows,
    reportRows,
    contractRows
  );

  const summary = {
    outputSpreadsheetId: output.id,
    outputSpreadsheetUrl: output.url,
    month: period.monthKey,
    startDate: period.startDate,
    endDate: period.endDate,
    probeCount: probeRows.length,
    entityRowCount: entityRows.length,
    reportRowCount: reportRows.length
  };

  safeLog_('[SALES TAX SOURCE PARITY] COMPLETE ' + JSON.stringify(summary));
  return summary;
}


function stpdRunEntityProbe_(testName, entityName, query, probeRows, entityRows) {
  try {
    const items = qboQueryAllGeneric_(query, entityName);

    items.forEach(function(item, index) {
      entityRows.push([
        testName,
        entityName,
        index + 1,
        stpdTruncate_(JSON.stringify(item), 45000)
      ]);
    });

    probeRows.push([
      testName,
      'ENTITY_QUERY',
      query,
      true,
      items.length,
      '',
      stpdTruncate_(JSON.stringify(items), 45000)
    ]);

    return items;
  } catch (err) {
    probeRows.push([
      testName,
      'ENTITY_QUERY',
      query,
      false,
      0,
      err && err.message ? err.message : String(err),
      ''
    ]);
    return null;
  }
}


function stpdRunReportProbe_(testName, path, probeRows, reportRows) {
  try {
    const json = qboGet_(stpdAppendMinorVersion_(path));
    const columns = stpdReportColumns_(json);
    const flatRows = [];

    if (json && json.Rows && Array.isArray(json.Rows.Row)) {
      stpdFlattenReportRows_(
        json.Rows.Row,
        columns,
        testName,
        0,
        '',
        '',
        flatRows
      );
    }

    Array.prototype.push.apply(reportRows, flatRows);

    probeRows.push([
      testName,
      'REPORT',
      path,
      true,
      flatRows.length,
      '',
      stpdTruncate_(JSON.stringify(json), 45000)
    ]);

    return json;
  } catch (err) {
    probeRows.push([
      testName,
      'REPORT',
      path,
      false,
      0,
      err && err.message ? err.message : String(err),
      ''
    ]);
    return null;
  }
}


function stpdReportColumns_(json) {
  const cols = json && json.Columns && Array.isArray(json.Columns.Column)
    ? json.Columns.Column
    : [];

  return cols.map(function(col, index) {
    const metadata = {};
    (col && Array.isArray(col.MetaData) ? col.MetaData : []).forEach(function(m) {
      if (m && m.Name !== undefined) metadata[String(m.Name)] = String(m.Value || '');
    });

    return {
      index: index,
      title: col && col.ColTitle ? String(col.ColTitle) : 'Column' + (index + 1),
      type: col && col.ColType ? String(col.ColType) : '',
      key: metadata.ColKey || ''
    };
  });
}


/**
 * Flattens report rows while preserving IDs and inherited transaction context.
 * TransactionListWithSplits commonly places the parent transaction ID in a
 * child row cell id even when the visible transaction type/number is blank.
 */
function stpdFlattenReportRows_(
  rows,
  columns,
  testName,
  depth,
  groupLabel,
  inheritedTxnId,
  out
) {
  (rows || []).forEach(function(row) {
    const headerCells = stpdCells_(row.Header && row.Header.ColData);
    const dataCells = stpdCells_(row.ColData);
    const summaryCells = stpdCells_(row.Summary && row.Summary.ColData);

    const headerLabel = headerCells
      .map(function(c) { return c.value; })
      .filter(Boolean)
      .join(' | ');

    const label = headerLabel || groupLabel || '';

    let rowTxnId = stpdFindLikelyTxnId_(dataCells) || inheritedTxnId || '';

    if (dataCells.length) {
      const values = {};
      const ids = {};
      const keys = {};

      dataCells.forEach(function(cell, index) {
        const col = columns[index] || {
          title: 'Column' + (index + 1),
          key: '',
          type: ''
        };
        values[col.title] = cell.value;
        ids[col.title] = cell.id;
        if (col.key) keys[col.key] = cell.value;
      });

      out.push([
        testName,
        depth,
        row.type || 'Data',
        label,
        rowTxnId,
        stpdTruncate_(JSON.stringify(values), 45000),
        stpdTruncate_(JSON.stringify(ids), 45000),
        stpdTruncate_(JSON.stringify(keys), 45000)
      ]);
    }

    if (headerCells.length) {
      out.push([
        testName,
        depth,
        'Header',
        label,
        rowTxnId,
        stpdTruncate_(JSON.stringify(headerCells), 45000),
        '',
        ''
      ]);
    }

    if (row.Rows && Array.isArray(row.Rows.Row)) {
      stpdFlattenReportRows_(
        row.Rows.Row,
        columns,
        testName,
        depth + 1,
        label,
        rowTxnId,
        out
      );
    }

    if (summaryCells.length) {
      out.push([
        testName,
        depth,
        'Summary',
        label,
        rowTxnId,
        stpdTruncate_(JSON.stringify(summaryCells), 45000),
        '',
        ''
      ]);
    }
  });
}


function stpdCells_(colData) {
  return Array.isArray(colData)
    ? colData.map(function(cell) {
        return {
          value: cell && cell.value !== undefined ? String(cell.value) : '',
          id: cell && cell.id !== undefined ? String(cell.id) : ''
        };
      })
    : [];
}


function stpdFindLikelyTxnId_(cells) {
  // Prefer the Transaction Type cell id when present. In QBO reports this is
  // commonly the transaction ID for parent rows.
  if (cells && cells.length > 1 && cells[1].id) return cells[1].id;

  // Split child rows can have the parent ID on an otherwise blank cell.
  for (let i = 0; i < (cells || []).length; i += 1) {
    const id = cells[i].id;
    if (id && /^\d+$/.test(id)) return id;
  }
  return '';
}


function stpdBuildContractRows_(period) {
  const rows = [];

  rows.push(['GLOBAL', 'Accounting method', 'Cash']);
  rows.push(['GLOBAL', 'Month', period.monthKey]);
  rows.push(['GLOBAL', 'Start date', period.startDate]);
  rows.push(['GLOBAL', 'End date', period.endDate]);

  rows.push([
    'Sales by Tax Name',
    'Transaction Type filter',
    'IN (' + STPD_REPORT_FILTERS.SALES_TRANSACTION_TYPES.join(', ') + ')'
  ]);
  rows.push([
    'Sales by Tax Name',
    'Distribution account filter',
    'NOT IN (' + STPD_REPORT_FILTERS.SALES_EXCLUDED_DISTRIBUTION_ACCOUNTS.join(', ') + ')'
  ]);
  rows.push([
    'Sales by Tax Name',
    'Required columns',
    'Tax name | Transaction ID | Transaction date | Product/Service | Distribution account | Amount | Date | Transaction type | Num | Customer | Tax code | Tax code status'
  ]);

  rows.push([
    'Taxable Sales Detail - by Tax Name',
    'Base report',
    'Taxable Sales Detail'
  ]);
  rows.push([
    'Taxable Sales Detail - by Tax Name',
    'Type filter',
    'NOT EQUAL ' + STPD_REPORT_FILTERS.TAXABLE_SALES_DETAIL_EXCLUDED_TYPE
  ]);
  rows.push([
    'Taxable Sales Detail - by Tax Name',
    'Required columns',
    'Tax name | Transaction ID | Transaction date | Product/Service | Distribution account | Amount | Tax amount | Date | Transaction type | Num | Customer | Description'
  ]);

  rows.push([
    'NORMALIZER',
    'Downstream requirement',
    'Do not redesign. Existing code consumes the two source-sheet contracts and creates LastMonthSalesTaxNormalized.'
  ]);

  return rows;
}


function stpdResolveMonth_(monthKey) {
  const tz = Session.getScriptTimeZone() || 'America/Chicago';
  let year;
  let monthIndex;

  if (monthKey) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey).trim());
    if (!match) {
      throw new Error('Month must be YYYY-MM, for example 2026-07.');
    }
    year = Number(match[1]);
    monthIndex = Number(match[2]) - 1;
    if (monthIndex < 0 || monthIndex > 11) {
      throw new Error('Invalid month: ' + monthKey);
    }
  } else {
    const now = new Date();
    const currentYear = Number(Utilities.formatDate(now, tz, 'yyyy'));
    const currentMonth = Number(Utilities.formatDate(now, tz, 'MM')) - 1;
    const previous = new Date(currentYear, currentMonth - 1, 1, 12, 0, 0);
    year = previous.getFullYear();
    monthIndex = previous.getMonth();
  }

  const first = new Date(year, monthIndex, 1, 12, 0, 0);
  const last = new Date(year, monthIndex + 1, 0, 12, 0, 0);

  return {
    monthKey: Utilities.formatDate(first, tz, 'yyyy-MM'),
    startDate: Utilities.formatDate(first, tz, 'yyyy-MM-dd'),
    endDate: Utilities.formatDate(last, tz, 'yyyy-MM-dd')
  };
}


function stpdAppendMinorVersion_(path) {
  const cfg = getConfig_();
  return path +
    (path.indexOf('?') >= 0 ? '&' : '?') +
    'minorversion=' + encodeURIComponent(cfg.minorVersion);
}


function stpdWriteWorkbook_(period, probeRows, entityRows, reportRows, contractRows) {
  const tz = Session.getScriptTimeZone() || 'America/Chicago';
  const stamp = Utilities.formatDate(new Date(), tz, 'yyyyMMdd_HHmmss');
  const ss = SpreadsheetApp.create(
    'QBO_SALES_TAX_SOURCE_PARITY_' + period.monthKey.replace('-', '') + '_' + stamp
  );

  const contract = ss.getSheets()[0];
  contract.setName('00_Source_Contracts');
  stpdWriteSheet_(
    contract,
    ['Dataset', 'Rule', 'Value'],
    contractRows
  );

  const probes = ss.insertSheet('10_Probe_Summary');
  stpdWriteSheet_(
    probes,
    [
      'TestName',
      'Category',
      'RequestOrQuery',
      'Succeeded',
      'ReturnedRows',
      'Error',
      'ResponseSample'
    ],
    probeRows
  );

  const entities = ss.insertSheet('20_Entity_Raw');
  stpdWriteSheet_(
    entities,
    ['TestName', 'EntityName', 'RowNumber', 'RawJSON'],
    entityRows
  );

  const reports = ss.insertSheet('30_Report_Rows');
  stpdWriteSheet_(
    reports,
    [
      'TestName',
      'Depth',
      'RowType',
      'GroupLabel',
      'InheritedTxnId',
      'ValuesJSON',
      'CellIdsJSON',
      'ColumnKeysJSON'
    ],
    reportRows
  );

  return { id: ss.getId(), url: ss.getUrl() };
}


function stpdWriteSheet_(sheet, headers, rows) {
  const neededRows = Math.max(2, rows.length + 1);
  const neededCols = headers.length;

  if (sheet.getMaxRows() < neededRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), neededRows - sheet.getMaxRows());
  }
  if (sheet.getMaxColumns() < neededCols) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), neededCols - sheet.getMaxColumns());
  }

  sheet.getRange(1, 1, 1, neededCols)
    .setValues([headers])
    .setFontWeight('bold');

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, neededCols)
      .setValues(rows)
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  }

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, neededCols);
  for (let col = 1; col <= neededCols; col += 1) {
    if (sheet.getColumnWidth(col) > 500) sheet.setColumnWidth(col, 500);
  }

  if (sheet.getMaxRows() > neededRows) {
    sheet.deleteRows(neededRows + 1, sheet.getMaxRows() - neededRows);
  }
  if (sheet.getMaxColumns() > neededCols) {
    sheet.deleteColumns(neededCols + 1, sheet.getMaxColumns() - neededCols);
  }
}


function stpdTruncate_(value, maxLen) {
  const text = String(value === undefined || value === null ? '' : value);
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}
