function tempCertifyQboPrefilingRevisionEvidenceV15623() {
  const controlSpreadsheetId =
    '1X8mevB6LNWJsN7k-eoCIGbG9qcvpefSpKnfEPQR-rQ0';

  const revisionRequestId =
    'fe715efe-b1a6-4e42-8bfc-884c6be10f82';

  return certifyQboPrefilingRevisionEvidenceV15623(
    controlSpreadsheetId,
    revisionRequestId
  );
}
function tempPreviewQboPrefilingControlledCaptureV15624() {
  const controlSpreadsheetId =
    '1X8mevB6LNWJsN7k-eoCIGbG9qcvpefSpKnfEPQR-rQ0';

  const revisionRequestId =
    'fe715efe-b1a6-4e42-8bfc-884c6be10f82';

  return previewQboPrefilingControlledCaptureV15624(
    controlSpreadsheetId,
    revisionRequestId
  );
}
function diagnoseOctoberTsdLogMismatchV15637() {
  const x = QBO_REVISION_REGISTRY_DIAGNOSTICS_V15627.resolve();
  const h = QBO_REVISION_HARDENING_V15631;
  const s = h.load(x.controlId, x.requestId);
  const r = s.entry.data;
  const runId = String(r.Taxable_Sales_Detail_Snapshot_Run_ID);

  const ss = qboTsdGetWorkbook_();
  const rows = h.rows(
    ss,
    QBO_TAXABLE_SALES_DETAIL.LOG_SHEET,
    ['Snapshot_Run_ID', 'Period_Key', 'Period_Start',
     'Period_End', 'Status', 'Row_Count', 'Snapshot_Sequence']
  );

  const matches = rows.filter(
    row => String(row.Snapshot_Run_ID).trim() === runId
  );

  const expected = {
    Period_Key: h.period(s),
    Period_Start: s.start,
    Period_End: s.end,
    Status: 'SUCCESS'
  };

  const findings = matches.map(row =>
    Object.fromEntries(
      Object.entries(expected).map(([field, value]) => [
        field,
        {
          actual: row[field] instanceof Date
            ? row[field].toISOString()
            : String(row[field]),
          actualType: row[field] instanceof Date
            ? 'Date'
            : typeof row[field],
          expected: value,
          matchesCurrentCertifier:
            h.str(row[field]) === value
        }
      ])
    )
  );

  console.log('[REV637 APP50] | TSD LOG DIAGNOSTIC | ' +
    JSON.stringify({
      readOnly: true,
      productionWrites: 0,
      runId,
      matchingLogRows: matches.length,
      findings
    })
  );
}