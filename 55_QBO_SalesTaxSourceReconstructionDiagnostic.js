/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 55_QBO_SalesTaxSourceReconstructionDiagnostic.js
 * Purpose     : READ-ONLY reconstruction diagnostic for the two Spreadsheet
 *               Sync source sheets used by the existing sales-tax normalizer:
 *                 1) LastMonthSalesbyTaxName
 *                 2) LastMonthTaxableSalesDetailbyTa
 *
 * Public API:
 *   - runSalesTaxSourceReconstructionJuly2026()
 *   - runSalesTaxSourceReconstructionForMonth('2026-07')
 *
 * Important:
 *   - Does NOT modify QBO.
 *   - Does NOT modify the existing sales-tax workbook or normalizer.
 *   - Creates a separate diagnostic spreadsheet.
 *   - Does NOT modify 99_TriggeredCalls.js or production triggers.
 * ============================================================================
 */

const STRD_ALLOWED_TXN_TYPES = Object.freeze([
  'Credit Memo',
  'Refund',
  'Invoice',
  'Sales Receipt'
]);

const STRD_EXCLUDED_DISTRIBUTION_ACCOUNTS = Object.freeze([
  'Undeposited Funds',
  'Texas Comptroller Account',
  'Texas Comptroller Payable',
  'Accounts Receivable (A/R)'
]);

/** Apps Script UI wrapper for the current parity month. */
function runSalesTaxSourceReconstructionJuly2026() {
  return runSalesTaxSourceReconstructionForMonth('2026-07');
}

/**
 * Reconstructs candidate source-sheet rows for exactly one calendar month.
 * Blank monthKey means previous complete calendar month.
 *
 * @param {string} monthKey YYYY-MM
 * @return {Object} output metadata
 */
function runSalesTaxSourceReconstructionForMonth(monthKey) {
  const period = strdResolveMonth_(monthKey);
  safeLog_('[SALES TAX SOURCE RECON] START month=' + period.monthKey);

  const common =
    'start_date=' + encodeURIComponent(period.startDate) +
    '&end_date=' + encodeURIComponent(period.endDate) +
    '&accounting_method=Cash';

  const taxCodes = qboQueryAllGeneric_(
    'SELECT * FROM TaxCode WHERE Active IN (true, false)',
    'TaxCode'
  );
  const taxCodeById = strdIndexById_(taxCodes);

  let items = [];
  try {
    items = qboQueryAllGeneric_(
      'SELECT * FROM Item WHERE Active IN (true, false)',
      'Item'
    );
  } catch (itemErr) {
    safeLog_('[SALES TAX SOURCE RECON] Item query failed: ' +
      (itemErr && itemErr.message ? itemErr.message : String(itemErr)));
  }
  const itemById = strdIndexById_(items);

  const splitsReport = qboGet_(strdAppendMinorVersion_(
    'reports/TransactionListWithSplits?' + common
  ));
  const taxableReport = qboGet_(strdAppendMinorVersion_(
    'reports/TaxableSalesDetail?' + common
  ));

  const salesSplitRows = strdParseSalesSplitReport_(splitsReport);
  const taxableRows = strdParseTaxableSalesDetailReport_(taxableReport);

  const txnRefs = {};
  salesSplitRows.forEach(function(r) {
    txnRefs[r.txnType + '|' + r.txnId] = {txnType: r.txnType, txnId: r.txnId};
  });
  taxableRows.forEach(function(r) {
    txnRefs[r.txnType + '|' + r.txnId] = {txnType: r.txnType, txnId: r.txnId};
  });

  const txnCache = {};
  const fetchErrors = [];
  Object.keys(txnRefs).forEach(function(key, index) {
    const ref = txnRefs[key];
    try {
      txnCache[key] = strdFetchTransaction_(ref.txnType, ref.txnId);
    } catch (err) {
      fetchErrors.push([
        ref.txnType,
        ref.txnId,
        err && err.message ? err.message : String(err)
      ]);
    }
    if ((index + 1) % 50 === 0) {
      safeLog_('[SALES TAX SOURCE RECON] fetched ' + (index + 1) +
        ' / ' + Object.keys(txnRefs).length + ' source transactions');
    }
  });

  const salesBuild = strdBuildSalesByTaxNameRows_(
    salesSplitRows,
    txnCache,
    taxCodeById,
    itemById
  );

  const taxableBuild = strdBuildTaxableDetailRows_(
    taxableRows,
    txnCache,
    taxCodeById,
    itemById
  );

  const ss = SpreadsheetApp.create(
    'QBO_SALES_TAX_SOURCE_RECON_' +
    period.monthKey.replace('-', '') + '_' +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss')
  );

  strdWriteSummary_(ss, period, salesBuild, taxableBuild, fetchErrors);
  strdWriteSourceSheet_(
    ss,
    '10_API_SalesByTaxName',
    'Sales by Tax Name',
    period,
    [
      'Tax codes', 'Transaction ID', 'Transaction date', 'Product/Service',
      'Distribution Account', 'Amount', 'Date', 'Transaction type', 'Num',
      'Customer', 'Tax codes', 'Tax codes'
    ],
    salesBuild.rows
  );
  strdWriteSourceSheet_(
    ss,
    '20_API_TaxableSalesDetailbyTa',
    'Taxable Sales Detail - by Tax Name',
    period,
    [
      'Tax codes', 'Transaction ID', 'Transaction date', 'Product/Service',
      'Distribution Account', 'Amount', 'Tax amount', 'Date',
      'Transaction type', 'Num', 'Customer', 'Description'
    ],
    taxableBuild.rows
  );
  strdWriteArraySheet_(ss, '30_Sales_Match_Issues', [
    'Txn Type', 'Txn ID', 'Recognition Date', 'Account', 'Amount',
    'Report Description', 'Issue', 'Source Txn JSON'
  ], salesBuild.issues);
  strdWriteArraySheet_(ss, '40_Taxable_Match_Issues', [
    'Txn Type', 'Txn ID', 'Recognition Date', 'Product/Service', 'Amount',
    'Issue', 'Source Txn JSON'
  ], taxableBuild.issues);
  strdWriteArraySheet_(ss, '50_Txn_Fetch_Errors', [
    'Txn Type', 'Txn ID', 'Error'
  ], fetchErrors);

  const summary = {
    outputSpreadsheetId: ss.getId(),
    outputSpreadsheetUrl: ss.getUrl(),
    month: period.monthKey,
    salesCandidateRows: salesBuild.rows.length,
    taxableCandidateRows: taxableBuild.rows.length,
    salesIssues: salesBuild.issues.length,
    taxableIssues: taxableBuild.issues.length,
    transactionFetchErrors: fetchErrors.length,
    sourceTransactionsFetched: Object.keys(txnCache).length
  };

  safeLog_('[SALES TAX SOURCE RECON] COMPLETE ' + JSON.stringify(summary));
  return summary;
}

function strdParseSalesSplitReport_(json) {
  const out = [];
  let parent = null;

  function walk(rows) {
    (rows || []).forEach(function(row) {
      if (row && row.ColData) {
        const cells = row.ColData || [];
        const date = strdCellValue_(cells, 0);
        const txnType = strdCellValue_(cells, 1);
        const txnId = strdCellId_(cells, 1) || strdCellId_(cells, 0);

        if (date && date !== '0-00-00' && txnType && txnId) {
          parent = {
            recognitionDate: date,
            txnType: txnType,
            txnId: String(txnId),
            num: strdCellValue_(cells, 2),
            customer: strdCellValue_(cells, 4)
          };
        } else if (parent && date === '0-00-00') {
          const childTxnId = strdCellId_(cells, 1);
          if (childTxnId && String(childTxnId) === String(parent.txnId)) {
            if (STRD_ALLOWED_TXN_TYPES.indexOf(parent.txnType) !== -1) {
              const account = strdCellValue_(cells, 6);
              const amount = strdNumber_(strdCellValue_(cells, 7));
              if (
                account &&
                STRD_EXCLUDED_DISTRIBUTION_ACCOUNTS.indexOf(account) === -1 &&
                !strdLooksLikeTaxPayable_(account) &&
                amount !== null
              ) {
                out.push({
                  recognitionDate: parent.recognitionDate,
                  txnType: parent.txnType,
                  txnId: parent.txnId,
                  num: parent.num,
                  customer: parent.customer,
                  description: strdCellValue_(cells, 5),
                  distributionAccountRaw: account,
                  amount: amount
                });
              }
            }
          }
        }
      }

      if (row && row.Rows && Array.isArray(row.Rows.Row)) {
        walk(row.Rows.Row);
      }
    });
  }

  walk(json && json.Rows && Array.isArray(json.Rows.Row) ? json.Rows.Row : []);
  return out;
}

function strdParseTaxableSalesDetailReport_(json) {
  const out = [];

  function walk(rows, itemCtx) {
    (rows || []).forEach(function(row) {
      let nextItem = itemCtx;

      if (row && row.Header && Array.isArray(row.Header.ColData)) {
        const headerCells = row.Header.ColData;
        const label = strdCellValue_(headerCells, 0);
        const id = strdCellId_(headerCells, 0);
        if (label && id) {
          nextItem = {itemId: String(id), itemName: label};
        }
      }

      if (row && row.ColData) {
        const cells = row.ColData || [];
        const date = strdCellValue_(cells, 0);
        const txnType = strdCellValue_(cells, 1);
        const txnId = strdCellId_(cells, 1);
        if (date && date !== '0-00-00' && txnType && txnId && nextItem) {
          if (STRD_ALLOWED_TXN_TYPES.indexOf(txnType) !== -1) {
            out.push({
              recognitionDate: date,
              txnType: txnType,
              txnId: String(txnId),
              num: strdCellValue_(cells, 2),
              customer: strdCellValue_(cells, 3),
              description: strdCellValue_(cells, 4),
              amount: strdNumber_(strdCellValue_(cells, 7)),
              itemId: nextItem.itemId,
              itemName: nextItem.itemName
            });
          }
        }
      }

      if (row && row.Rows && Array.isArray(row.Rows.Row)) {
        walk(row.Rows.Row, nextItem);
      }
    });
  }

  walk(json && json.Rows && Array.isArray(json.Rows.Row) ? json.Rows.Row : [], null);
  return out;
}

function strdBuildSalesByTaxNameRows_(reportRows, txnCache, taxCodeById, itemById) {
  const rows = [];
  const issues = [];
  const lineUse = {};

  reportRows.forEach(function(r) {
    const key = r.txnType + '|' + r.txnId;
    const txn = txnCache[key];
    if (!txn) {
      issues.push(strdSalesIssue_(r, 'SOURCE_TRANSACTION_NOT_FETCHED', ''));
      return;
    }

    const candidates = strdSourceSalesLines_(txn, itemById);
    const match = strdMatchSourceLine_(r, candidates, lineUse, key);

    if (!match) {
      issues.push(strdSalesIssue_(r, 'SOURCE_LINE_NOT_MATCHED', txn));
      return;
    }

    const taxInfo = strdTxnTaxInfo_(txn, taxCodeById);
    rows.push([
      taxInfo.taxName,
      r.txnId,
      strdIsoToDate_(r.recognitionDate),
      match.itemName,
      strdStripAccountPrefix_(r.distributionAccountRaw),
      r.amount,
      strdIsoToDate_(txn.TxnDate || ''),
      r.txnType,
      r.num,
      r.customer,
      taxInfo.publicTaxCodeId,
      ''
    ]);
  });

  return {rows: rows, issues: issues};
}

function strdBuildTaxableDetailRows_(reportRows, txnCache, taxCodeById, itemById) {
  const rows = [];
  const issues = [];

  reportRows.forEach(function(r) {
    const item = itemById[r.itemId] || null;
    if (item && strdIsBundleItem_(item)) return;

    const key = r.txnType + '|' + r.txnId;
    const txn = txnCache[key];
    if (!txn) {
      issues.push([
        r.txnType, r.txnId, strdIsoToDate_(r.recognitionDate), r.itemName,
        r.amount, 'SOURCE_TRANSACTION_NOT_FETCHED', ''
      ]);
      return;
    }

    const taxInfo = strdTxnTaxInfo_(txn, taxCodeById);
    const line = strdFindLineByItemAndDescription_(txn, r.itemId, r.description);
    const distributionAccount = line
      ? strdDistributionAccountForLine_(line, itemById)
      : strdDistributionAccountForItem_(item);

    if (!line) {
      issues.push([
        r.txnType, r.txnId, strdIsoToDate_(r.recognitionDate), r.itemName,
        r.amount, 'SOURCE_LINE_NOT_MATCHED', strdTruncate_(JSON.stringify(txn), 45000)
      ]);
    }

    const taxAmount = strdEstimateRecognizedTax_(r.amount, txn, taxInfo);

    rows.push([
      taxInfo.taxName,
      r.txnId,
      strdIsoToDate_(r.recognitionDate),
      r.itemName,
      strdStripAccountPrefix_(distributionAccount || ''),
      r.amount,
      taxAmount,
      strdIsoToDate_(txn.TxnDate || ''),
      r.txnType,
      r.num,
      r.customer,
      r.description
    ]);
  });

  return {rows: rows, issues: issues};
}

function strdSourceSalesLines_(txn, itemById) {
  const out = [];
  strdWalkSalesItemLines_(txn && Array.isArray(txn.Line) ? txn.Line : [], function(line, d, sourceKey) {
    const itemId = String(d.ItemRef.value || '');
    // QBO can emit a synthetic zero-dollar shipping line that is not part of
    // the Spreadsheet Sync Sales by Tax Name source report.
    if (itemId === 'SHIPPING_ITEM_ID') return;
    const item = itemById[itemId] || null;
    out.push({
      sourceIndex: sourceKey,
      itemId: itemId,
      itemName: d.ItemRef.name || (item && item.Name) || '',
      description: line.Description || '',
      amount: strdNumber_(line.Amount),
      distributionAccount: strdDistributionAccountForLine_(line, itemById),
      raw: line
    });
  });
  return out;
}

/**
 * Walk every SalesItemLineDetail, including children nested inside
 * GroupLineDetail.Line. sourceKey is stable within a transaction (for example
 * "1.0" or "1.2") so the matcher can de-duplicate child lines correctly.
 */
function strdWalkSalesItemLines_(lines, callback, prefix) {
  (Array.isArray(lines) ? lines : []).forEach(function(line, idx) {
    const sourceKey = prefix ? prefix + '.' + idx : String(idx);
    const d = line && line.SalesItemLineDetail;
    if (d && d.ItemRef) callback(line, d, sourceKey);

    const groupLines = line && line.GroupLineDetail && Array.isArray(line.GroupLineDetail.Line)
      ? line.GroupLineDetail.Line
      : [];
    if (groupLines.length) strdWalkSalesItemLines_(groupLines, callback, sourceKey);
  });
}

function strdMatchSourceLine_(reportRow, candidates, lineUse, txnKey) {
  const used = lineUse[txnKey] || {};
  const desc = strdNorm_(reportRow.description);
  const acct = strdNorm_(strdStripAccountPrefix_(reportRow.distributionAccountRaw));

  function available(c) { return !used[c.sourceIndex]; }
  function accountMatches(c) {
    return acct && strdNorm_(strdStripAccountPrefix_(c.distributionAccount)) === acct;
  }

  let match = null;
  if (desc) {
    match = candidates.find(function(c) {
      return available(c) && strdNorm_(c.description) === desc && accountMatches(c);
    }) || candidates.find(function(c) {
      return available(c) && strdNorm_(c.description) === desc;
    });
  }

  if (!match) {
    const sameAccount = candidates.filter(function(c) {
      return available(c) && accountMatches(c);
    });
    if (sameAccount.length === 1) match = sameAccount[0];
  }

  if (!match) {
    match = candidates.find(function(c) {
      return available(c) && accountMatches(c) && c.amount !== null &&
        Math.abs(Math.abs(c.amount) - Math.abs(reportRow.amount)) <= 0.01;
    });
  }

  if (match) {
    used[match.sourceIndex] = true;
    lineUse[txnKey] = used;
  }
  return match;
}

function strdFindLineByItemAndDescription_(txn, itemId, description) {
  const wantedDesc = strdNorm_(description);
  let exact = null;
  let fallback = null;

  strdWalkSalesItemLines_(txn && Array.isArray(txn.Line) ? txn.Line : [], function(line, d) {
    if (String(d.ItemRef.value || '') !== String(itemId || '')) return;
    if (!fallback) fallback = line;
    if (!exact && wantedDesc && strdNorm_(line.Description || '') === wantedDesc) exact = line;
  });
  return exact || fallback;
}

function strdFetchTransaction_(txnType, txnId) {
  const map = {
    'Invoice': ['invoice', 'Invoice'],
    'Sales Receipt': ['salesreceipt', 'SalesReceipt'],
    'Credit Memo': ['creditmemo', 'CreditMemo'],
    'Refund': ['refundreceipt', 'RefundReceipt']
  };
  const cfg = map[txnType];
  if (!cfg) throw new Error('Unsupported transaction type: ' + txnType);
  const json = qboGet_(strdAppendMinorVersion_(cfg[0] + '/' + encodeURIComponent(txnId)));
  const txn = json && json[cfg[1]] ? json[cfg[1]] : json;
  if (!txn || String(txn.Id || '') !== String(txnId)) {
    throw new Error('Unexpected response for ' + txnType + ' ' + txnId);
  }
  return txn;
}

function strdTxnTaxInfo_(txn, taxCodeById) {
  const ref = txn && txn.TxnTaxDetail && txn.TxnTaxDetail.TxnTaxCodeRef
    ? txn.TxnTaxDetail.TxnTaxCodeRef
    : null;
  const id = ref && ref.value !== undefined ? String(ref.value) : '';
  const taxCode = id ? taxCodeById[id] : null;
  return {
    publicTaxCodeId: id,
    taxName: (taxCode && taxCode.Name) || (ref && ref.name) || ''
  };
}

function strdEstimateRecognizedTax_(recognizedAmount, txn, taxInfo) {
  if (recognizedAmount === null) return '';
  const detail = txn && txn.TxnTaxDetail ? txn.TxnTaxDetail : null;
  const totalTax = detail ? strdNumber_(detail.TotalTax) : null;
  const taxableBase = strdTxnTaxableBase_(txn);

  if (totalTax !== null && taxableBase && Math.abs(taxableBase) > 0.000001) {
    return strdRound2_(recognizedAmount * (totalTax / taxableBase));
  }

  // Known Pool People tax-name families in the current data are 8.25% when
  // the transaction has tax but the entity does not expose a usable taxable
  // base. Preserve this only as a diagnostic fallback, not production logic.
  if (taxInfo && taxInfo.taxName && /8\.25|Houston-3101990/i.test(taxInfo.taxName)) {
    return strdRound2_(recognizedAmount * 0.0825);
  }
  return '';
}

function strdTxnTaxableBase_(txn) {
  let total = 0;
  let found = false;
  strdWalkSalesItemLines_(txn && Array.isArray(txn.Line) ? txn.Line : [], function(line, d) {
    const taxRef = d.TaxCodeRef;
    const isTaxable = taxRef && String(taxRef.value || '').toUpperCase() === 'TAX';
    if (!isTaxable) return;
    const amount = strdNumber_(line.Amount);
    if (amount !== null) {
      total += amount;
      found = true;
    }
  });
  return found ? total : null;
}

function strdDistributionAccountForLine_(line, itemById) {
  const d = line && line.SalesItemLineDetail;
  if (d && d.ItemAccountRef) {
    return d.ItemAccountRef.name || d.ItemAccountRef.value || '';
  }
  const itemId = d && d.ItemRef ? String(d.ItemRef.value || '') : '';
  return strdDistributionAccountForItem_(itemById[itemId] || null);
}

function strdDistributionAccountForItem_(item) {
  return item && item.IncomeAccountRef
    ? (item.IncomeAccountRef.name || item.IncomeAccountRef.value || '')
    : '';
}

function strdIsBundleItem_(item) {
  if (!item) return false;
  const type = String(item.Type || '').toLowerCase();
  return type === 'group' || type === 'bundle';
}

function strdLooksLikeTaxPayable_(account) {
  return /texas comptroller|sales tax payable|tax payable/i.test(String(account || ''));
}

function strdStripAccountPrefix_(account) {
  const s = String(account || '');
  const parts = s.split(':');
  return parts.length > 1 ? parts[parts.length - 1].trim() : s.trim();
}

function strdSalesIssue_(r, issue, txn) {
  return [
    r.txnType,
    r.txnId,
    strdIsoToDate_(r.recognitionDate),
    r.distributionAccountRaw,
    r.amount,
    r.description,
    issue,
    txn ? strdTruncate_(JSON.stringify(txn), 45000) : ''
  ];
}

function strdWriteSummary_(ss, period, salesBuild, taxableBuild, fetchErrors) {
  const rows = [
    ['Metric', 'Value'],
    ['Month', period.monthKey],
    ['Start Date', period.startDate],
    ['End Date', period.endDate],
    ['Accounting Method', 'Cash'],
    ['Sales transaction types', STRD_ALLOWED_TXN_TYPES.join(', ')],
    ['Sales excluded distribution accounts', STRD_EXCLUDED_DISTRIBUTION_ACCOUNTS.join(', ')],
    ['Taxable detail excluded type', 'Bundle / QBO Item.Type Group'],
    ['API Sales candidate rows', salesBuild.rows.length],
    ['API Taxable candidate rows', taxableBuild.rows.length],
    ['Sales match issues', salesBuild.issues.length],
    ['Taxable match issues', taxableBuild.issues.length],
    ['Transaction fetch errors', fetchErrors.length],
    ['Tax code note', 'Public API TaxCode ID is written where Spreadsheet Sync exposes its internal hash. Exact hash parity is not expected from public API.']
  ];
  strdWriteArraySheet_(ss, '00_Run_Summary', rows[0], rows.slice(1));
}

function strdWriteSourceSheet_(ss, sheetName, reportTitle, period, headers, dataRows) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  sheet.clear();

  const titleRows = [
    ['Pool People, LLC'].concat(new Array(headers.length - 1).fill('')),
    [reportTitle].concat(new Array(headers.length - 1).fill('')),
    ['Txn Date: Custom date range, ' + strdFriendlyDate_(period.startDate) +
      ' - ' + strdFriendlyDate_(period.endDate)].concat(new Array(headers.length - 1).fill('')),
    headers
  ];
  const values = titleRows.concat(dataRows);
  sheet.getRange(1, 1, values.length, headers.length).setValues(values);
  sheet.setFrozenRows(4);
  sheet.getRange(1, 1, values.length, headers.length).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  sheet.getRange(4, 1, 1, headers.length).setFontWeight('bold');
  if (dataRows.length) {
    // Recognition Date and source Date columns are real Date objects.
    sheet.getRange(5, 3, dataRows.length, 1).setNumberFormat('mm/dd/yyyy');
    const sourceDateCol = reportTitle.indexOf('Taxable') !== -1 ? 8 : 7;
    sheet.getRange(5, sourceDateCol, dataRows.length, 1).setNumberFormat('mm/dd/yyyy');
  }
}

function strdWriteArraySheet_(ss, sheetName, headers, rows) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  sheet.clear();
  const width = headers.length;
  const values = [headers].concat(rows || []);
  sheet.getRange(1, 1, values.length, width).setValues(values);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, values.length, width).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  sheet.getRange(1, 1, 1, width).setFontWeight('bold');
}

function strdResolveMonth_(monthKey) {
  let year;
  let monthIndex;
  const raw = String(monthKey || '').trim();
  if (raw) {
    const m = raw.match(/^(\d{4})-(\d{2})$/);
    if (!m) throw new Error('monthKey must be YYYY-MM. Received: ' + raw);
    year = Number(m[1]);
    monthIndex = Number(m[2]) - 1;
    if (monthIndex < 0 || monthIndex > 11) throw new Error('Invalid monthKey: ' + raw);
  } else {
    const now = new Date();
    const firstThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const previous = new Date(firstThisMonth.getFullYear(), firstThisMonth.getMonth() - 1, 1);
    year = previous.getFullYear();
    monthIndex = previous.getMonth();
  }
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);
  const tz = Session.getScriptTimeZone();
  return {
    monthKey: Utilities.formatDate(start, tz, 'yyyy-MM'),
    startDate: Utilities.formatDate(start, tz, 'yyyy-MM-dd'),
    endDate: Utilities.formatDate(end, tz, 'yyyy-MM-dd')
  };
}

function strdIndexById_(items) {
  const out = {};
  (items || []).forEach(function(item) {
    if (item && item.Id !== undefined) out[String(item.Id)] = item;
  });
  return out;
}

function strdAppendMinorVersion_(path) {
  const cfg = getConfig_();
  const mv = cfg && cfg.minorVersion ? cfg.minorVersion : 75;
  return path + (path.indexOf('?') === -1 ? '?' : '&') +
    'minorversion=' + encodeURIComponent(mv);
}

function strdCellValue_(cells, index) {
  return cells && cells[index] && cells[index].value !== undefined
    ? String(cells[index].value || '')
    : '';
}

function strdCellId_(cells, index) {
  return cells && cells[index] && cells[index].id !== undefined
    ? String(cells[index].id || '')
    : '';
}

function strdNumber_(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/,/g, ''));
  return isFinite(n) ? n : null;
}

function strdNorm_(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function strdRound2_(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function strdIsoToDate_(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function strdFriendlyDate_(iso) {
  const d = strdIsoToDate_(iso);
  if (!d) return iso;
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMMM d, yyyy');
}

function strdTruncate_(text, maxLen) {
  const s = String(text || '');
  return s.length <= maxLen ? s : s.substring(0, maxLen) + '…';
}
