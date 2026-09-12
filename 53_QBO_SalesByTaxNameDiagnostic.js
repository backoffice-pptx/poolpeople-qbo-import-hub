/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 53_QBO_SalesByTaxNameDiagnostic.js
 * Purpose     : Non-production diagnostic proving whether the public QBO API
 *               can reproduce the Custom Report Builder "Sales by Tax Name"
 *               result used by Pool People.
 *
 * Public API:
 *   - runSalesByTaxNameApiDiagnostic()
 *
 * Known control transaction:
 *   Report Transaction ID : 62401
 *   Invoice DocNumber     : 62595
 *   Invoice date          : 2026-06-25
 *   Cash recognition date: 2026-08-02
 *   Expected taxable lines: 121.00, 163.00, 75.00
 *   Expected Tax name     : TX-Houston-3101990
 *
 * Important:
 *   - READ ONLY. Does not modify QBO.
 *   - Creates a separate diagnostic spreadsheet.
 *   - This is intentionally diagnostic code, not a production exporter.
 * ============================================================================
 */

const SBTN_CONTROL = Object.freeze({
  INVOICE_ID: '62401',
  DOC_NUMBER: '62595',
  INVOICE_DATE: '2026-06-25',
  CASH_DATE: '2026-08-02',
  PERIOD_START: '2026-08-01',
  PERIOD_END: '2026-08-31',
  TAX_NAME: 'TX-Houston-3101990',
  TAX_CODE_PREFIX: 'a2dd26c7ad379596'
});

/**
 * Runs focused API probes for the QBO Custom Report Builder
 * "Sales by Tax Name" report.
 *
 * @return {Object} diagnostic workbook metadata
 */
function runSalesByTaxNameApiDiagnostic() {
  safeLog_('[SBTN DIAG] START');

  const probeRows = [];
  const entityRows = [];
  const reportRows = [];

  // 1) Direct Invoice entity.
  runSbtnEntityProbe_(
    'INVOICE_62401',
    'Invoice',
    "SELECT * FROM Invoice WHERE Id = '" + SBTN_CONTROL.INVOICE_ID + "'",
    probeRows,
    entityRows
  );

  // 2) Payments posted on the known cash-recognition date.
  //    Filter locally for LinkedTxn -> Invoice 62401.
  const paymentResult = runSbtnEntityProbe_(
    'PAYMENTS_2026_08_02',
    'Payment',
    "SELECT * FROM Payment WHERE TxnDate = '" + SBTN_CONTROL.CASH_DATE + "'",
    probeRows,
    entityRows
  );

  if (paymentResult && paymentResult.items) {
    const linked = paymentResult.items.filter(function(payment) {
      return sbtnJsonContains_(payment, '"TxnId":"' + SBTN_CONTROL.INVOICE_ID + '"');
    });

    probeRows.push([
      'PAYMENT_LINK_TO_INVOICE_62401',
      'DERIVED',
      '',
      true,
      linked.length,
      '',
      'Payments dated ' + SBTN_CONTROL.CASH_DATE +
        ' whose JSON contains LinkedTxn TxnId=' + SBTN_CONTROL.INVOICE_ID,
      sbtnTruncate_(JSON.stringify(linked), 45000)
    ]);
  }

  // 3) TaxCode master lookup. The report-builder Tax code appears hash-like,
  //    so this tests whether any public TaxCode entity exposes the report name.
  runSbtnEntityProbe_(
    'TAX_CODES_ALL',
    'TaxCode',
    'SELECT * FROM TaxCode WHERE Active IN (true, false)',
    probeRows,
    entityRows
  );

  // 4) Documented Reports API probes.
  const common =
    'start_date=' + encodeURIComponent(SBTN_CONTROL.PERIOD_START) +
    '&end_date=' + encodeURIComponent(SBTN_CONTROL.PERIOD_END) +
    '&accounting_method=Cash';

  runSbtnReportProbe_(
    'TRANSACTION_LIST_CASH',
    'reports/TransactionList?' + common,
    probeRows,
    reportRows
  );

  runSbtnReportProbe_(
    'TRANSACTION_LIST_WITH_SPLITS_CASH',
    'reports/TransactionListWithSplits?' + common,
    probeRows,
    reportRows
  );

  runSbtnReportProbe_(
    'SALES_BY_PRODUCT_CASH',
    'reports/SalesByProduct?' + common,
    probeRows,
    reportRows
  );

  runSbtnReportProbe_(
    'SALES_BY_CUSTOMER_CASH',
    'reports/SalesByCustomer?' + common,
    probeRows,
    reportRows
  );

  runSbtnReportProbe_(
    'TAX_SUMMARY_CASH',
    'reports/TaxSummary?' + common,
    probeRows,
    reportRows
  );

  // 5) One Accrual control. If the Cash TransactionList shows 8/2 while
  //    Accrual shows 6/25, we have strong evidence the Reports API is applying
  //    the same accounting-basis date logic.
  const accrual =
    'start_date=2026-06-25' +
    '&end_date=2026-06-25' +
    '&accounting_method=Accrual';

  runSbtnReportProbe_(
    'TRANSACTION_LIST_ACCRUAL_2026_06_25',
    'reports/TransactionList?' + accrual,
    probeRows,
    reportRows
  );

  const output = sbtnWriteWorkbook_(probeRows, entityRows, reportRows);

  const summary = {
    outputSpreadsheetId: output.id,
    outputSpreadsheetUrl: output.url,
    probeCount: probeRows.length,
    entityRowCount: entityRows.length,
    reportRowCount: reportRows.length,
    controlInvoiceId: SBTN_CONTROL.INVOICE_ID,
    controlDocNumber: SBTN_CONTROL.DOC_NUMBER
  };

  safeLog_('[SBTN DIAG] COMPLETE ' + JSON.stringify(summary));
  return summary;
}


function runSbtnEntityProbe_(testName, entityName, query, probeRows, entityRows) {
  try {
    const items = qboQueryAllGeneric_(query, entityName);

    items.forEach(function(item, index) {
      const raw = JSON.stringify(item);
      entityRows.push([
        testName,
        entityName,
        index + 1,
        sbtnFindTerms_(raw).join(' | '),
        sbtnTruncate_(raw, 45000)
      ]);
    });

    probeRows.push([
      testName,
      'ENTITY_QUERY',
      query,
      true,
      items.length,
      '',
      sbtnAggregateMatches_(items),
      sbtnTruncate_(JSON.stringify(items), 45000)
    ]);

    return { items: items };
  } catch (err) {
    probeRows.push([
      testName,
      'ENTITY_QUERY',
      query,
      false,
      0,
      err && err.message ? err.message : String(err),
      '',
      ''
    ]);
    return null;
  }
}


function runSbtnReportProbe_(testName, path, probeRows, reportRows) {
  try {
    const json = qboGet_(sbtnAppendMinorVersion_(path));
    const titles = sbtnReportColumnTitles_(json);
    const flatRows = [];

    if (json && json.Rows && Array.isArray(json.Rows.Row)) {
      sbtnFlattenReportRows_(json.Rows.Row, titles, testName, 0, '', flatRows);
    }

    flatRows.forEach(function(row) {
      reportRows.push(row);
    });

    const raw = JSON.stringify(json);
    const matchedTerms = sbtnFindTerms_(raw);

    probeRows.push([
      testName,
      'REPORT',
      path,
      true,
      flatRows.length,
      '',
      matchedTerms.join(' | '),
      sbtnTruncate_(raw, 45000)
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
      '',
      ''
    ]);
    return null;
  }
}


function sbtnAppendMinorVersion_(path) {
  const cfg = getConfig_();
  return path +
    (path.indexOf('?') >= 0 ? '&' : '?') +
    'minorversion=' + encodeURIComponent(cfg.minorVersion);
}


function sbtnReportColumnTitles_(json) {
  const cols = json && json.Columns && Array.isArray(json.Columns.Column)
    ? json.Columns.Column
    : [];

  return cols.map(function(col, index) {
    return col && col.ColTitle
      ? String(col.ColTitle)
      : 'Column' + (index + 1);
  });
}


function sbtnFlattenReportRows_(rows, titles, testName, depth, groupLabel, out) {
  (rows || []).forEach(function(row) {
    const headerValues = sbtnColDataValues_(row.Header && row.Header.ColData);
    const summaryValues = sbtnColDataValues_(row.Summary && row.Summary.ColData);
    const dataValues = sbtnColDataValues_(row.ColData);

    const label =
      headerValues.filter(Boolean).join(' | ') ||
      groupLabel ||
      '';

    if (dataValues.length) {
      const obj = {};
      dataValues.forEach(function(value, index) {
        obj[titles[index] || ('Column' + (index + 1))] = value;
      });

      const raw = JSON.stringify(obj);
      out.push([
        testName,
        depth,
        row.type || 'Data',
        label,
        sbtnFindTerms_(raw).join(' | '),
        sbtnTruncate_(raw, 45000)
      ]);
    }

    if (headerValues.length) {
      const rawHeader = JSON.stringify(headerValues);
      out.push([
        testName,
        depth,
        'Header',
        label,
        sbtnFindTerms_(rawHeader).join(' | '),
        sbtnTruncate_(rawHeader, 45000)
      ]);
    }

    if (row.Rows && Array.isArray(row.Rows.Row)) {
      sbtnFlattenReportRows_(
        row.Rows.Row,
        titles,
        testName,
        depth + 1,
        label,
        out
      );
    }

    if (summaryValues.length) {
      const rawSummary = JSON.stringify(summaryValues);
      out.push([
        testName,
        depth,
        'Summary',
        label,
        sbtnFindTerms_(rawSummary).join(' | '),
        sbtnTruncate_(rawSummary, 45000)
      ]);
    }
  });
}


function sbtnColDataValues_(colData) {
  return Array.isArray(colData)
    ? colData.map(function(cell) {
        return cell && cell.value !== undefined ? String(cell.value) : '';
      })
    : [];
}


function sbtnFindTerms_(raw) {
  const text = String(raw || '').toLowerCase();
  const targets = [
    SBTN_CONTROL.INVOICE_ID,
    SBTN_CONTROL.DOC_NUMBER,
    SBTN_CONTROL.INVOICE_DATE,
    '06/25/2026',
    SBTN_CONTROL.CASH_DATE,
    '08/02/2026',
    SBTN_CONTROL.TAX_NAME,
    SBTN_CONTROL.TAX_CODE_PREFIX,
    'seal go-kit',
    'seal plate',
    'chlorinator parts',
    '121',
    '163',
    '75'
  ];

  return targets.filter(function(term) {
    return text.indexOf(String(term).toLowerCase()) !== -1;
  });
}


function sbtnAggregateMatches_(items) {
  const found = {};
  (items || []).forEach(function(item) {
    sbtnFindTerms_(JSON.stringify(item)).forEach(function(term) {
      found[term] = true;
    });
  });
  return Object.keys(found).join(' | ');
}


function sbtnJsonContains_(obj, fragment) {
  return JSON.stringify(obj).indexOf(fragment) !== -1;
}


function sbtnWriteWorkbook_(probeRows, entityRows, reportRows) {
  const tz = Session.getScriptTimeZone() || 'America/Chicago';
  const stamp = Utilities.formatDate(new Date(), tz, 'yyyyMMdd_HHmmss');
  const ss = SpreadsheetApp.create('QBO_SALES_BY_TAX_NAME_DIAGNOSTIC_' + stamp);

  const probe = ss.getSheets()[0];
  probe.setName('00_Probe_Summary');
  sbtnWriteSheet_(
    probe,
    [
      'TestName',
      'Category',
      'RequestOrQuery',
      'Succeeded',
      'ReturnedRows',
      'Error',
      'MatchedControlTerms',
      'ResponseSample'
    ],
    probeRows
  );

  const entities = ss.insertSheet('10_Entity_Raw');
  sbtnWriteSheet_(
    entities,
    [
      'TestName',
      'EntityName',
      'RowNumber',
      'MatchedControlTerms',
      'RawJSON'
    ],
    entityRows
  );

  const reports = ss.insertSheet('20_Report_Rows');
  sbtnWriteSheet_(
    reports,
    [
      'TestName',
      'Depth',
      'RowType',
      'GroupLabel',
      'MatchedControlTerms',
      'ValuesJSON'
    ],
    reportRows
  );

  return {
    id: ss.getId(),
    url: ss.getUrl()
  };
}


function sbtnWriteSheet_(sheet, headers, rows) {
  const neededRows = Math.max(2, rows.length + 1);
  const neededCols = headers.length;

  if (sheet.getMaxRows() < neededRows) {
    sheet.insertRowsAfter(
      sheet.getMaxRows(),
      neededRows - sheet.getMaxRows()
    );
  }

  if (sheet.getMaxColumns() < neededCols) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      neededCols - sheet.getMaxColumns()
    );
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
    if (sheet.getColumnWidth(col) > 500) {
      sheet.setColumnWidth(col, 500);
    }
  }

  if (sheet.getMaxRows() > neededRows) {
    sheet.deleteRows(neededRows + 1, sheet.getMaxRows() - neededRows);
  }

  if (sheet.getMaxColumns() > neededCols) {
    sheet.deleteColumns(neededCols + 1, sheet.getMaxColumns() - neededCols);
  }
}


function sbtnTruncate_(value, maxLen) {
  const text = String(value === undefined || value === null ? '' : value);
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}
