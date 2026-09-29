/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 1640_QBO_July2026Gross50ResidualDiagnostic.js
 * Purpose     : Read-only historical reconstruction diagnostic for the exact
 *               $50.00 July 2026 Gross Sales residual.
 *
 * Evidence lock:
 *   GL ExtractRunId    : a0e9b538-529a-445c-aea7-57740cad1dc9
 *   Recognition RunId : 49cda38c-dd37-4e38-bd55-080f34afaa39
 *   Liability Gross   : 47058.12
 *
 * This diagnostic performs no writes and does not refresh QBO.
 * ============================================================================ */

const QBO_JULY_2026_GROSS_50_DIAGNOSTIC = Object.freeze({
  START_DATE: '2026-07-01',
  END_DATE: '2026-07-31',
  PERIOD_KEY: '202607',
  GL_EXTRACT_RUN_ID: 'a0e9b538-529a-445c-aea7-57740cad1dc9',
  RECOGNITION_SNAPSHOT_RUN_ID: '49cda38c-dd37-4e38-bd55-080f34afaa39',
  LIABILITY_GROSS: 47058.12,
  TARGET_RESIDUAL: 50.00
});

function runJuly2026Gross50ResidualDiagnostic() {
  const C = QBO_JULY_2026_GROSS_50_DIAGNOSTIC;
  safeLog_('[JULY GROSS 50] | START | gl=' + C.GL_EXTRACT_RUN_ID +
    ' | recognition=' + C.RECOGNITION_SNAPSHOT_RUN_ID);

  const glSource = qboStrReadCapturedGlPeriod_(C.START_DATE, C.END_DATE, C.GL_EXTRACT_RUN_ID);
  if (String(glSource.extractRunId) !== C.GL_EXTRACT_RUN_ID) {
    throw new Error('Diagnostic GL lineage mismatch.');
  }

  const recognition = qboJulyGross50ReadRecognitionSnapshot_();
  const eligibleGlRows = glSource.rows.filter(qboStrIsEligibleEvidenceRow_);
  const parity = qboJulyGross50CompareEligibleGlToRecognition_(eligibleGlRows, recognition.rows);

  const accountTotals = qboJulyGross50GroupTotals_(recognition.rows, function(r) {
    return r.distributionAccount || '(blank)';
  });
  const typeTotals = qboJulyGross50GroupTotals_(recognition.rows, function(r) {
    return r.transactionType || '(blank)';
  });
  const transactionTotals = qboJulyGross50TransactionTotals_(recognition.rows);

  const literal50Rows = recognition.rows.filter(function(r) {
    return Math.abs(Math.abs(r.amount) - C.TARGET_RESIDUAL) < 0.000001;
  });
  const net50Transactions = transactionTotals.filter(function(r) {
    return Math.abs(Math.abs(r.amount) - C.TARGET_RESIDUAL) < 0.000001;
  });
  const discountRefundAccounts = accountTotals.filter(function(r) {
    return /discount|refund/i.test(r.key);
  });

  const recognitionRawTotal = qboJulyGross50Round_(recognition.rows.reduce(function(sum, r) {
    return sum + r.amount;
  }, 0));

  const result = {
    readOnly: true,
    period: C.START_DATE + '..' + C.END_DATE,
    liabilityGross: C.LIABILITY_GROSS,
    targetResidual: C.TARGET_RESIDUAL,
    glExtractRunId: glSource.extractRunId,
    glDataRowCount: glSource.rows.length,
    eligibleGlRowCount: eligibleGlRows.length,
    recognitionSnapshotRunId: recognition.runId,
    recognitionSnapshotSequence: recognition.sequence,
    recognitionSourceGlExtractRunId: recognition.sourceGlExtractRunId,
    recognitionRowCount: recognition.rows.length,
    recognitionRawTotal: recognitionRawTotal,
    rawTotalVsLiabilityGross: qboJulyGross50Round_(C.LIABILITY_GROSS - recognitionRawTotal),
    eligibleGlRecognitionParity: parity,
    transactionTypeTotals: typeTotals,
    discountRefundAccountTotals: discountRefundAccounts,
    literal50Rows: literal50Rows.map(qboJulyGross50CompactRow_),
    net50Transactions: net50Transactions,
    distributionAccountTotals: accountTotals
  };

  safeLog_('[JULY GROSS 50] | LINEAGE | ' + JSON.stringify({
    glExtractRunId: result.glExtractRunId,
    recognitionSnapshotRunId: result.recognitionSnapshotRunId,
    recognitionSourceGlExtractRunId: result.recognitionSourceGlExtractRunId,
    glDataRowCount: result.glDataRowCount,
    eligibleGlRowCount: result.eligibleGlRowCount,
    recognitionRowCount: result.recognitionRowCount
  }));
  safeLog_('[JULY GROSS 50] | PARITY | ' + JSON.stringify(parity));
  safeLog_('[JULY GROSS 50] | TOTALS | ' + JSON.stringify({
    liabilityGross: C.LIABILITY_GROSS,
    recognitionRawTotal: recognitionRawTotal,
    rawTotalVsLiabilityGross: result.rawTotalVsLiabilityGross,
    note: 'Recognition raw total is diagnostic only; source contract says it is not standalone filing-basis Gross.'
  }));
  safeLog_('[JULY GROSS 50] | TYPE TOTALS | ' + JSON.stringify(typeTotals));
  safeLog_('[JULY GROSS 50] | DISCOUNT REFUND ACCOUNTS | ' + JSON.stringify(discountRefundAccounts));
  safeLog_('[JULY GROSS 50] | LITERAL 50 ROWS | ' + JSON.stringify(result.literal50Rows));
  safeLog_('[JULY GROSS 50] | NET 50 TRANSACTIONS | ' + JSON.stringify(net50Transactions));
  safeLog_('[JULY GROSS 50] | ACCOUNT TOTALS | ' + JSON.stringify(accountTotals));
  safeLog_('[JULY GROSS 50] | COMPLETE');
  return result;
}

function qboJulyGross50ReadRecognitionSnapshot_() {
  const C = QBO_JULY_2026_GROSS_50_DIAGNOSTIC;
  const ss = qboStrGetWorkbook_();
  const sh = ss.getSheetByName(QBO_SALES_TAX_RECOGNITION.SNAPSHOT_SHEET);
  if (!sh || sh.getLastRow() < 2) throw new Error('Recognition snapshot dataset is empty.');
  const values = sh.getDataRange().getValues();
  const headers = values[0].map(function(v) { return String(v || '').trim(); });
  const idx = qboStrHeaderIndex_(headers, [
    'Period_Key','Snapshot_Sequence','Snapshot_Run_ID','Source_GL_Extract_Run_ID',
    'Recognition_Date','Transaction_Type','Transaction_ID','Num','Customer',
    'Distribution_Account','Account_ID','Amount','Memo_Description','Split_Account','Split_ID'
  ]);
  const rows = values.slice(1).filter(function(row) {
    return String(row[idx.Period_Key] || '').trim() === C.PERIOD_KEY &&
      String(row[idx.Snapshot_Run_ID] || '').trim() === C.RECOGNITION_SNAPSHOT_RUN_ID;
  });
  if (!rows.length) throw new Error('Exact July Recognition snapshot was not found.');
  const sourceIds = {};
  rows.forEach(function(row) { sourceIds[String(row[idx.Source_GL_Extract_Run_ID] || '').trim()] = true; });
  const sourceIdList = Object.keys(sourceIds).filter(Boolean);
  if (sourceIdList.length !== 1 || sourceIdList[0] !== C.GL_EXTRACT_RUN_ID) {
    throw new Error('Recognition snapshot is not bound exclusively to the expected refreshed July GL.');
  }
  return {
    runId: C.RECOGNITION_SNAPSHOT_RUN_ID,
    sequence: rows[0][idx.Snapshot_Sequence],
    sourceGlExtractRunId: sourceIdList[0],
    rows: rows.map(function(row) {
      return {
        recognitionDate: qboStrDateText_(row[idx.Recognition_Date]),
        transactionType: String(row[idx.Transaction_Type] || '').trim(),
        transactionId: String(row[idx.Transaction_ID] || '').trim(),
        num: String(row[idx.Num] || '').trim(),
        customer: String(row[idx.Customer] || '').trim(),
        distributionAccount: String(row[idx.Distribution_Account] || '').trim(),
        accountId: String(row[idx.Account_ID] || '').trim(),
        amount: qboStrNumber_(row[idx.Amount]) || 0,
        memo: String(row[idx.Memo_Description] || '').trim(),
        splitAccount: String(row[idx.Split_Account] || '').trim(),
        splitId: String(row[idx.Split_ID] || '').trim()
      };
    })
  };
}

function qboJulyGross50CompareEligibleGlToRecognition_(glRows, recognitionRows) {
  const gl = qboJulyGross50CountBySignature_(glRows);
  const rec = qboJulyGross50CountBySignature_(recognitionRows);
  const keys = {};
  Object.keys(gl).forEach(function(k) { keys[k] = true; });
  Object.keys(rec).forEach(function(k) { keys[k] = true; });
  let missingFromRecognition = 0;
  let extraInRecognition = 0;
  Object.keys(keys).forEach(function(k) {
    const delta = (gl[k] || 0) - (rec[k] || 0);
    if (delta > 0) missingFromRecognition += delta;
    if (delta < 0) extraInRecognition += -delta;
  });
  return {
    exact: missingFromRecognition === 0 && extraInRecognition === 0,
    eligibleGlRows: glRows.length,
    recognitionRows: recognitionRows.length,
    missingFromRecognition: missingFromRecognition,
    extraInRecognition: extraInRecognition
  };
}

function qboJulyGross50CountBySignature_(rows) {
  const out = {};
  rows.forEach(function(r) {
    const key = [
      r.recognitionDate, r.transactionType, r.transactionId, r.num, r.customer,
      r.distributionAccount, r.accountId, qboStrMoneyKey_(r.amount), r.memo,
      r.splitAccount, r.splitId
    ].map(qboStrNorm_).join('|');
    out[key] = (out[key] || 0) + 1;
  });
  return out;
}

function qboJulyGross50GroupTotals_(rows, keyFn) {
  const groups = {};
  rows.forEach(function(r) {
    const key = String(keyFn(r) || '(blank)');
    if (!groups[key]) groups[key] = {key:key, rowCount:0, amount:0};
    groups[key].rowCount++;
    groups[key].amount += r.amount;
  });
  return Object.keys(groups).map(function(k) {
    groups[k].amount = qboJulyGross50Round_(groups[k].amount);
    return groups[k];
  }).sort(function(a,b) { return Math.abs(b.amount) - Math.abs(a.amount) || a.key.localeCompare(b.key); });
}

function qboJulyGross50TransactionTotals_(rows) {
  const groups = {};
  rows.forEach(function(r) {
    const key = [r.transactionType, r.transactionId, r.num, r.customer].join('|');
    if (!groups[key]) groups[key] = {
      transactionType:r.transactionType, transactionId:r.transactionId,
      num:r.num, customer:r.customer, rowCount:0, amount:0
    };
    groups[key].rowCount++;
    groups[key].amount += r.amount;
  });
  return Object.keys(groups).map(function(k) {
    groups[k].amount = qboJulyGross50Round_(groups[k].amount);
    return groups[k];
  }).sort(function(a,b) { return Math.abs(b.amount) - Math.abs(a.amount); });
}

function qboJulyGross50CompactRow_(r) {
  return {
    recognitionDate:r.recognitionDate, transactionType:r.transactionType,
    transactionId:r.transactionId, num:r.num, customer:r.customer,
    distributionAccount:r.distributionAccount, amount:qboJulyGross50Round_(r.amount),
    splitAccount:r.splitAccount, memo:r.memo
  };
}

function qboJulyGross50Round_(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function testJuly2026Gross50ResidualDiagnosticContract() {
  const C = QBO_JULY_2026_GROSS_50_DIAGNOSTIC;
  const checks = [
    {name:'period locked to July 2026', passed:C.START_DATE === '2026-07-01' && C.END_DATE === '2026-07-31'},
    {name:'exact refreshed GL locked', passed:C.GL_EXTRACT_RUN_ID === 'a0e9b538-529a-445c-aea7-57740cad1dc9'},
    {name:'exact refreshed Recognition locked', passed:C.RECOGNITION_SNAPSHOT_RUN_ID === '49cda38c-dd37-4e38-bd55-080f34afaa39'},
    {name:'liability Gross locked', passed:C.LIABILITY_GROSS === 47058.12},
    {name:'target residual locked', passed:C.TARGET_RESIDUAL === 50}
  ];
  const result = {checkCount:checks.length, passed:checks.every(function(c){return c.passed;}), checks:checks};
  safeLog_('[JULY GROSS 50 CONTRACT TEST] ' + JSON.stringify(result));
  if (!result.passed) throw new Error('July Gross $50 diagnostic contract test failed.');
  return result;
}
