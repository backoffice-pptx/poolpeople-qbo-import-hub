/**
 * Read-only validation of the Sales Tax Gross reconstruction account classifier.
 *
 * Purpose:
 *   Prove a reusable classifier against exact immutable Recognition snapshots
 *   before any production Level1 calculation is changed.
 *
 * Evidence expectations:
 *   - July 2026 historical reconstruction: 47,058.12
 *   - August 2026 native pre-filing validation: 37,224.46
 *
 * No writes. No QBO calls. No evidence mutation.
 */
const QBO_ST_GROSS_CLASSIFIER_DIAGNOSTIC = Object.freeze({
  JULY: Object.freeze({
    periodKey: '202607',
    snapshotRunId: '49cda38c-dd37-4e38-bd55-080f34afaa39',
    expectedGross: 47058.12,
    regressionTransactionId: '69658',
    regressionDocumentNumber: '64814',
    regressionAccount: 'Client Overpayments',
    regressionAmount: 50.00
  }),
  AUGUST: Object.freeze({
    periodKey: '202608',
    snapshotRunId: 'e310bc52-ffa5-4b42-bc27-22a887466279',
    expectedGross: 37224.46
  })
});

function testSalesTaxGrossRecognitionClassifierContract() {
  const checks = [
    ['July exact Recognition snapshot locked', QBO_ST_GROSS_CLASSIFIER_DIAGNOSTIC.JULY.snapshotRunId === '49cda38c-dd37-4e38-bd55-080f34afaa39'],
    ['July expected Gross locked', QBO_ST_GROSS_CLASSIFIER_DIAGNOSTIC.JULY.expectedGross === 47058.12],
    ['August exact Recognition snapshot locked', QBO_ST_GROSS_CLASSIFIER_DIAGNOSTIC.AUGUST.snapshotRunId === 'e310bc52-ffa5-4b42-bc27-22a887466279'],
    ['August expected Gross locked', QBO_ST_GROSS_CLASSIFIER_DIAGNOSTIC.AUGUST.expectedGross === 37224.46],
    ['Client Overpayment fixture locked', QBO_ST_GROSS_CLASSIFIER_DIAGNOSTIC.JULY.regressionTransactionId === '69658' && QBO_ST_GROSS_CLASSIFIER_DIAGNOSTIC.JULY.regressionAmount === 50]
  ].map(function(c) { return { name: c[0], passed: !!c[1] }; });
  const result = { checkCount: checks.length, passed: checks.every(function(c) { return c.passed; }), checks: checks };
  console.log('[GROSS CLASSIFIER CONTRACT TEST] ' + JSON.stringify(result));
  if (!result.passed) throw new Error('Gross classifier diagnostic contract test failed.');
  return result;
}

function runSalesTaxGrossRecognitionClassifierDiagnostic() {
  const july = qboStGrossEvaluateSnapshot_(QBO_ST_GROSS_CLASSIFIER_DIAGNOSTIC.JULY);
  const august = qboStGrossEvaluateSnapshot_(QBO_ST_GROSS_CLASSIFIER_DIAGNOSTIC.AUGUST);
  const fixture = qboStGrossEvaluateClientOverpaymentFixture_(QBO_ST_GROSS_CLASSIFIER_DIAGNOSTIC.JULY);

  console.log('[GROSS CLASSIFIER] | JULY | ' + JSON.stringify(july));
  console.log('[GROSS CLASSIFIER] | AUGUST | ' + JSON.stringify(august));
  console.log('[GROSS CLASSIFIER] | CLIENT OVERPAYMENT FIXTURE | ' + JSON.stringify(fixture));

  const passed = july.passed && august.passed && fixture.passed;
  const result = { passed: passed, july: july, august: august, clientOverpaymentFixture: fixture };
  console.log('[GROSS CLASSIFIER] | COMPLETE | ' + JSON.stringify({ passed: passed }));
  if (!passed) throw new Error('Gross classifier diagnostic did not satisfy all frozen expectations.');
  return result;
}

function qboStGrossEvaluateSnapshot_(cfg) {
  const rows = qboStGrossReadSnapshot_(cfg.periodKey, cfg.snapshotRunId);
  const included = [];
  const excluded = [];
  rows.forEach(function(row) {
    const classification = qboStGrossClassifyRecognitionRow_(row);
    (classification.included ? included : excluded).push({ row: row, classification: classification });
  });

  const gross = qboStGrossRound2_(included.reduce(function(sum, x) { return sum + x.row.amount; }, 0));
  const byAccount = {};
  included.forEach(function(x) {
    const key = x.row.distributionAccount;
    if (!byAccount[key]) byAccount[key] = { account: key, reason: x.classification.reason, rowCount: 0, amount: 0 };
    byAccount[key].rowCount += 1;
    byAccount[key].amount += x.row.amount;
  });
  const includedAccounts = Object.keys(byAccount).sort().map(function(k) {
    byAccount[k].amount = qboStGrossRound2_(byAccount[k].amount);
    return byAccount[k];
  });

  return {
    periodKey: cfg.periodKey,
    snapshotRunId: cfg.snapshotRunId,
    recognitionRowCount: rows.length,
    includedRowCount: included.length,
    excludedRowCount: excluded.length,
    reconstructedGross: gross,
    expectedGross: cfg.expectedGross,
    variance: qboStGrossRound2_(gross - cfg.expectedGross),
    passed: Math.abs(gross - cfg.expectedGross) < 0.005,
    includedAccounts: includedAccounts
  };
}

function qboStGrossEvaluateClientOverpaymentFixture_(cfg) {
  const rows = qboStGrossReadSnapshot_(cfg.periodKey, cfg.snapshotRunId).filter(function(row) {
    return row.transactionId === cfg.regressionTransactionId;
  });
  const classified = rows.map(function(row) {
    const c = qboStGrossClassifyRecognitionRow_(row);
    return {
      transactionId: row.transactionId,
      num: row.num,
      customer: row.customer,
      distributionAccount: row.distributionAccount,
      splitAccount: row.splitAccount,
      amount: row.amount,
      included: c.included,
      reason: c.reason
    };
  });
  const included = classified.filter(function(x) { return x.included; });
  const includedAmount = qboStGrossRound2_(included.reduce(function(sum, x) { return sum + x.amount; }, 0));
  const passed = rows.length >= 2 &&
    included.length === 1 &&
    included[0].distributionAccount === cfg.regressionAccount &&
    included[0].num === cfg.regressionDocumentNumber &&
    Math.abs(includedAmount - cfg.regressionAmount) < 0.005;
  return {
    transactionId: cfg.regressionTransactionId,
    documentNumber: cfg.regressionDocumentNumber,
    sourceRowCount: rows.length,
    includedRowCount: included.length,
    includedAmount: includedAmount,
    expectedIncludedAmount: cfg.regressionAmount,
    passed: passed,
    rows: classified
  };
}

function qboStGrossClassifyRecognitionRow_(row) {
  const account = String(row.distributionAccount || '').trim();
  const terminal = account.split(':').pop().trim();
  const normalized = terminal.replace(/\s+/g, ' ').toLowerCase();

  // Proven Gross population: ordinary income accounts, contra-income
  // Discounts / Refunds accounts, plus the Client Overpayments liability
  // account demonstrated by the controlled Sales Receipt regression fixture.
  // Explicitly do not infer Gross from every row in broad Recognition evidence.
  if (/\bincome$/.test(normalized) && !/^unapplied cash payment income(?:-\d+)?$/.test(normalized)) {
    return { included: true, reason: 'INCOME_ACCOUNT' };
  }
  if (/^discounts\s*\/\s*refunds\b/.test(normalized)) {
    return { included: true, reason: 'DISCOUNTS_REFUNDS_CONTRA_INCOME' };
  }
  if (normalized === 'client overpayments') {
    return { included: true, reason: 'CLIENT_OVERPAYMENTS_GROSS_COMPONENT' };
  }
  return { included: false, reason: 'NOT_PROVEN_GROSS_ACCOUNT' };
}

function qboStGrossReadSnapshot_(periodKey, snapshotRunId) {
  const ss = qboStrGetWorkbook_();
  const sh = ss.getSheetByName(QBO_SALES_TAX_RECOGNITION.SNAPSHOT_SHEET);
  if (!sh) throw new Error('Recognition snapshot sheet is unavailable.');
  if (sh.getLastRow() < 2) throw new Error('Recognition snapshot sheet contains no evidence rows.');

  const values = sh.getRange(2, 1, sh.getLastRow() - 1, QBO_STR_HEADERS.length).getValues();
  const rows = values.filter(function(r) {
    return String(r[0]) === String(periodKey) && String(r[2]) === String(snapshotRunId);
  }).map(function(r) {
    return {
      periodKey: String(r[0]),
      snapshotRunId: String(r[2]),
      recognitionDate: String(r[9]),
      transactionType: String(r[10]),
      transactionId: String(r[11]),
      num: String(r[12]),
      customer: String(r[13]),
      distributionAccount: String(r[14]),
      accountId: String(r[15]),
      amount: qboStrNumber_(r[16]) || 0,
      memo: String(r[17]),
      splitAccount: String(r[18]),
      splitId: String(r[19])
    };
  });
  if (!rows.length) {
    throw new Error('No Recognition rows found for period=' + periodKey + ' snapshot=' + snapshotRunId + '.');
  }
  return rows;
}

function qboStGrossRound2_(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
