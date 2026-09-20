/**
 * App 50 - QBO General Ledger Post-Filing Filter Diagnostic
 * Version: 1.5.188-diagnostic
 *
 * Purpose:
 *   Determine, without writing any production workbook data, whether the QBO
 *   Reports API GeneralLedger endpoint honors server-side filtering for:
 *     - Texas Comptroller Payable account
 *     - Sales Tax Payment / Sales Tax Adjustment transaction types
 *     - filing-date-forward date window
 *
 * Safety:
 *   READ ONLY. Calls qboGet_() only. Does not call export/upsert/snapshot code.
 */

const QBO_POST_FILING_GL_FILTER_DIAG = Object.freeze({
  START_DATE: '2026-09-19',
  END_DATE: '2026-09-20',
  ACCOUNT_NAME: 'Texas Comptroller Payable',
  TXN_TYPES: Object.freeze(['Sales Tax Payment', 'Sales Tax Adjustment']),
  ACCOUNTING_METHOD: 'Cash'
});

function diagnoseQboGeneralLedgerPostFilingFilters() {
  const D = QBO_POST_FILING_GL_FILTER_DIAG;
  const cfg = getConfig_();
  const baseParams = {
    start_date: D.START_DATE,
    end_date: D.END_DATE,
    accounting_method: D.ACCOUNTING_METHOD,
    minorversion: cfg.minorVersion
  };

  safeLog_('[POST-FILING GL FILTER DIAG] START | ' + JSON.stringify({
    startDate: D.START_DATE,
    endDate: D.END_DATE,
    accountName: D.ACCOUNT_NAME,
    transactionTypes: D.TXN_TYPES,
    readOnly: true
  }));

  const baseline = runPostFilingGlProbe_('BASELINE_DATE_ONLY', baseParams, D);
  if (!baseline.ok) {
    throw new Error('Baseline GeneralLedger request failed; filter probes were not attempted. ' + baseline.error);
  }

  const accountIds = baseline.accountIds || [];
  const accountId = accountIds.length === 1 ? accountIds[0] : '';
  safeLog_('[POST-FILING GL FILTER DIAG] ACCOUNT RESOLUTION | ' + JSON.stringify({
    accountName: D.ACCOUNT_NAME,
    accountIds: accountIds,
    uniqueAccountId: accountId || null,
    baselineTargetRows: baseline.targetAccountDataRowCount
  }));

  const probes = [baseline];

  // Account probes. QBO report APIs commonly use account identifiers when an
  // account filter is supported; test the resolved ID and the display name
  // independently so acceptance is proven rather than assumed.
  if (accountId) {
    probes.push(runPostFilingGlProbe_('ACCOUNT_ID', mergePostFilingGlParams_(baseParams, {
      account: accountId
    }), D));
  }
  probes.push(runPostFilingGlProbe_('ACCOUNT_NAME', mergePostFilingGlParams_(baseParams, {
    account: D.ACCOUNT_NAME
  }), D));

  // Transaction-type probes. Test each report label separately and then a
  // comma-separated pair. The diagnostic judges returned rows; HTTP success
  // alone is not treated as proof that QBO honored the parameter.
  D.TXN_TYPES.forEach(function(txnType) {
    probes.push(runPostFilingGlProbe_(
      'TRANSACTION_TYPE_' + txnType.toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
      mergePostFilingGlParams_(baseParams, { transaction_type: txnType }),
      D
    ));
  });

  probes.push(runPostFilingGlProbe_('TRANSACTION_TYPE_PAIR', mergePostFilingGlParams_(baseParams, {
    transaction_type: D.TXN_TYPES.join(',')
  }), D));

  if (accountId) {
    probes.push(runPostFilingGlProbe_('ACCOUNT_ID_PLUS_TRANSACTION_TYPE_PAIR', mergePostFilingGlParams_(baseParams, {
      account: accountId,
      transaction_type: D.TXN_TYPES.join(',')
    }), D));
  }

  const summary = {
    version: '1.5.188-diagnostic',
    readOnly: true,
    startDate: D.START_DATE,
    endDate: D.END_DATE,
    accountName: D.ACCOUNT_NAME,
    resolvedAccountIds: accountIds,
    probeCount: probes.length,
    probes: probes.map(function(p) {
      return {
        name: p.name,
        ok: p.ok,
        error: p.error || '',
        reportName: p.reportName || '',
        reportBasis: p.reportBasis || '',
        startPeriod: p.startPeriod || '',
        endPeriod: p.endPeriod || '',
        dataRowCount: p.dataRowCount || 0,
        targetAccountDataRowCount: p.targetAccountDataRowCount || 0,
        targetTypeDataRowCount: p.targetTypeDataRowCount || 0,
        outsideTargetAccountCount: p.outsideTargetAccountCount || 0,
        outsideTargetTypeCount: p.outsideTargetTypeCount || 0,
        returnedTransactionTypes: p.returnedTransactionTypes || [],
        returnedGroupLabels: p.returnedGroupLabels || [],
        targetRows: p.targetRows || []
      };
    })
  };

  safeLog_('[POST-FILING GL FILTER DIAG] COMPLETE | ' + JSON.stringify(summary));
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

function runPostFilingGlProbe_(name, params, D) {
  const query = Object.keys(params).map(function(key) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
  }).join('&');
  const endpoint = 'reports/GeneralLedger?' + query;

  try {
    const report = qboGet_(endpoint);
    const rows = [];
    collectPostFilingGlRows_(
      report && report.Rows && Array.isArray(report.Rows.Row) ? report.Rows.Row : [],
      '', '', rows
    );

    const dataRows = rows.filter(function(r) { return r.rowType === 'Data'; });
    const targetAccountRows = dataRows.filter(function(r) { return r.groupLabel === D.ACCOUNT_NAME; });
    const targetTypeRows = dataRows.filter(function(r) { return D.TXN_TYPES.indexOf(r.transactionType) >= 0; });
    const targetRows = dataRows.filter(function(r) {
      return r.groupLabel === D.ACCOUNT_NAME && D.TXN_TYPES.indexOf(r.transactionType) >= 0;
    });

    const result = {
      name: name,
      ok: true,
      requestedParams: params,
      reportName: String((report.Header || {}).ReportName || ''),
      reportBasis: String((report.Header || {}).ReportBasis || ''),
      startPeriod: String((report.Header || {}).StartPeriod || ''),
      endPeriod: String((report.Header || {}).EndPeriod || ''),
      dataRowCount: dataRows.length,
      targetAccountDataRowCount: targetAccountRows.length,
      targetTypeDataRowCount: targetTypeRows.length,
      outsideTargetAccountCount: dataRows.filter(function(r) { return r.groupLabel !== D.ACCOUNT_NAME; }).length,
      outsideTargetTypeCount: dataRows.filter(function(r) { return D.TXN_TYPES.indexOf(r.transactionType) < 0; }).length,
      accountIds: uniquePostFilingGl_(rows.filter(function(r) {
        return r.groupLabel === D.ACCOUNT_NAME && r.groupId;
      }).map(function(r) { return r.groupId; })),
      returnedTransactionTypes: uniquePostFilingGl_(dataRows.map(function(r) { return r.transactionType; }).filter(Boolean)),
      returnedGroupLabels: uniquePostFilingGl_(dataRows.map(function(r) { return r.groupLabel; }).filter(Boolean)),
      targetRows: targetRows.map(function(r) {
        return {
          date: r.date,
          transactionType: r.transactionType,
          transactionId: r.transactionId,
          num: r.num,
          name: r.name,
          memo: r.memo,
          split: r.split,
          amount: r.amount,
          balance: r.balance,
          groupLabel: r.groupLabel,
          groupId: r.groupId
        };
      })
    };

    safeLog_('[POST-FILING GL FILTER DIAG] PROBE | ' + JSON.stringify(result));
    return result;
  } catch (err) {
    const result = {
      name: name,
      ok: false,
      requestedParams: params,
      error: String(err && err.message ? err.message : err)
    };
    safeLog_('[POST-FILING GL FILTER DIAG] PROBE | ' + JSON.stringify(result));
    return result;
  }
}

function collectPostFilingGlRows_(sourceRows, groupLabel, groupId, output) {
  sourceRows.forEach(function(row) {
    const header = row.Header && Array.isArray(row.Header.ColData) ? row.Header.ColData : [];
    const data = Array.isArray(row.ColData) ? row.ColData : [];
    let nextLabel = groupLabel;
    let nextId = groupId;
    if (header.length) {
      nextLabel = String((header[0] || {}).value || groupLabel || '');
      nextId = String((header[0] || {}).id || groupId || '');
    }
    const rowType = String(row.type || (header.length ? 'Section' : 'Data'));
    if (data.length) {
      output.push({
        rowType: rowType,
        groupLabel: nextLabel,
        groupId: nextId,
        date: postFilingGlValue_(data, 0),
        transactionType: postFilingGlValue_(data, 1),
        transactionId: postFilingGlId_(data, 1),
        num: postFilingGlValue_(data, 2),
        name: postFilingGlValue_(data, 3),
        memo: postFilingGlValue_(data, 4),
        split: postFilingGlValue_(data, 5),
        amount: postFilingGlValue_(data, 6),
        balance: postFilingGlValue_(data, 7)
      });
    }
    if (row.Rows && Array.isArray(row.Rows.Row)) {
      collectPostFilingGlRows_(row.Rows.Row, nextLabel, nextId, output);
    }
  });
}

function postFilingGlValue_(cells, index) {
  return String(((cells[index] || {}).value) == null ? '' : (cells[index] || {}).value);
}
function postFilingGlId_(cells, index) {
  return String(((cells[index] || {}).id) == null ? '' : (cells[index] || {}).id);
}
function uniquePostFilingGl_(values) {
  const seen = {};
  return values.filter(function(v) {
    const key = String(v || '');
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}
function mergePostFilingGlParams_(base, extra) {
  const out = {};
  Object.keys(base).forEach(function(k) { out[k] = base[k]; });
  Object.keys(extra).forEach(function(k) { out[k] = extra[k]; });
  return out;
}
