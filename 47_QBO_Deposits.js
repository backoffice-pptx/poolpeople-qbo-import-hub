/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 47_QBO_Deposits.js
 * Purpose     : Export QBO Deposits and deposit lines to structured Google Sheets tables.
 *
 * Public API:
 *   - exportQboDeposits()
 *
 * Internal Helpers:
 *   - buildDepositRows_()
 *   - buildDepositLineRows_()
 *   - appendDepositLineRow_()
 *   - calculateDepositLineTotal_()
 *   - calculateDepositCalculatedTotal_()
 *   - calculateDepositAmountVariance_()
 *   - countDepositLinkedLines_()
 *   - collectDepositLinkedTxns_()
 *
 * Dependencies:
 *   - Other Application 50 modules as referenced by function calls
 *   - Google Apps Script services used by this module
 *
 * Current Owner:
 *   - 50 QBO Import Hub
 *
 * Future Ownership:
 *   - Remains in Application 50 unless a later approved architecture decision assigns a narrower reusable component elsewhere.
 *
 * Change History:
 *   - 2026-08-23: Disabled automatic column resizing for both deposit exports
 *     to avoid expensive Spreadsheet width operations on wide tables. Removed
 *     per-column wrap configuration; shared export writer now clips all data.
 *   - 2026-07-21: Added standardized module documentation. No runtime behavior
 *     changed.
 * ============================================================================
 */


/***********************
 * 47_QBO_Deposits.gs
 * QBO Deposit export
 *
 * Output Sheets:
 *   QBO_Deposits
 *   QBO_DepositLines
 *
 * Public Functions:
 *   exportQboDeposits()
 ***********************/

/** Deposit parent export columns. */
const DEPOSIT_HEADERS = [
  'Id',
  'SyncToken',
  'DocNumber',
  'TxnDate',
  'DepositAccountId',
  'DepositAccountName',
  'CurrencyCode',
  'CurrencyName',
  'ExchangeRate',
  'DepartmentId',
  'DepartmentName',
  'TotalAmount',
  'HomeTotalAmount',
  'DepositLineTotal',
  'CashBackAmount',
  'CalculatedTotal',
  'AmountVariance',
  'CashBackAccountId',
  'CashBackAccountName',
  'CashBackMemo',
  'LineCount',
  'LinkedLineCount',
  'UnlinkedLineCount',
  'PrivateNote',
  'LinkedTransactionCount',
  'LinkedInvoiceCount',
  'LinkedInvoiceIds',
  'LinkedPaymentCount',
  'LinkedPaymentIds',
  'LinkedSalesReceiptCount',
  'LinkedSalesReceiptIds',
  'LinkedEstimateCount',
  'LinkedEstimateIds',
  'LinkedCreditMemoCount',
  'LinkedCreditMemoIds',
  'LinkedDepositCount',
  'LinkedDepositIds',
  'LinkedBillCount',
  'LinkedBillIds',
  'LinkedJournalEntryCount',
  'LinkedJournalEntryIds',
  'LinkedPurchaseCount',
  'LinkedPurchaseIds',
  'LinkedOtherTransactionCount',
  'LinkedOtherTransactionsJSON',
  'LinkedTransactionsJSON',
  'CashBackJSON',
  'CreateTime',
  'LastUpdatedTime',
  'RawJSON'
];

/** Deposit line export columns. */
const DEPOSIT_LINE_HEADERS = [
  'DepositId',
  'DepositDocNumber',
  'DepositTxnDate',
  'DepositAccountId',
  'DepositAccountName',
  'LineId',
  'LineNumber',
  'DetailType',
  'Description',
  'Amount',
  'SourceAccountId',
  'SourceAccountName',
  'EntityId',
  'EntityName',
  'EntityType',
  'CustomerId',
  'CustomerName',
  'ClassId',
  'ClassName',
  'PaymentMethodId',
  'PaymentMethodName',
  'CheckNumber',
  'TransactionType',
  'LinkedTransactionCount',
  'LinkedInvoiceCount',
  'LinkedInvoiceIds',
  'LinkedPaymentCount',
  'LinkedPaymentIds',
  'LinkedSalesReceiptCount',
  'LinkedSalesReceiptIds',
  'LinkedEstimateCount',
  'LinkedEstimateIds',
  'LinkedCreditMemoCount',
  'LinkedCreditMemoIds',
  'LinkedDepositCount',
  'LinkedDepositIds',
  'LinkedBillCount',
  'LinkedBillIds',
  'LinkedJournalEntryCount',
  'LinkedJournalEntryIds',
  'LinkedPurchaseCount',
  'LinkedPurchaseIds',
  'LinkedOtherTransactionCount',
  'LinkedOtherTransactionsJSON',
  'LinkedTransactionsJSON',
  'HasLinkedTransaction',
  'IsPaymentLink',
  'IsSalesReceiptLink',
  'IsOtherLink',
  'RawJSON'
];

/**
 * Exports all QBO Deposits and their line details.
 *
 * @return {Object} Export row counts.
 */
function exportQboDeposits() {
  safeLog_('Starting QBO deposits export.');

  const deposits = qboQueryAllGeneric_(
    'SELECT * FROM Deposit',
    'Deposit'
  );

  safeLog_(`Retrieved ${deposits.length} QBO deposits.`);

  const depositRows = buildDepositRows_(deposits);

  safeLog_(`Writing ${depositRows.length} QBO deposit rows.`);

  writeExport_({
    sheetName: 'QBO_Deposits',
    headers: DEPOSIT_HEADERS,
    rows: depositRows,
    autoResize: false,
    columnWidths: {
      [DEPOSIT_HEADERS.indexOf('DocNumber') + 1]: 140,
      [DEPOSIT_HEADERS.indexOf('DepositAccountName') + 1]: 240,
      [DEPOSIT_HEADERS.indexOf('CashBackAccountName') + 1]: 240,
      [DEPOSIT_HEADERS.indexOf('CashBackMemo') + 1]: 260,
      [DEPOSIT_HEADERS.indexOf('PrivateNote') + 1]: 300,
      [DEPOSIT_HEADERS.indexOf('LinkedOtherTransactionsJSON') + 1]: 300,
      [DEPOSIT_HEADERS.indexOf('LinkedTransactionsJSON') + 1]: 300,
      [DEPOSIT_HEADERS.indexOf('CashBackJSON') + 1]: 300,
      [DEPOSIT_HEADERS.indexOf('RawJSON') + 1]: 300
    },
    numberFormats: {
      [DEPOSIT_HEADERS.indexOf('TxnDate') + 1]: 'yyyy-mm-dd',
      [DEPOSIT_HEADERS.indexOf('ExchangeRate') + 1]: '0.000000',
      [DEPOSIT_HEADERS.indexOf('TotalAmount') + 1]: '$#,##0.00',
      [DEPOSIT_HEADERS.indexOf('HomeTotalAmount') + 1]: '$#,##0.00',
      [DEPOSIT_HEADERS.indexOf('DepositLineTotal') + 1]: '$#,##0.00',
      [DEPOSIT_HEADERS.indexOf('CashBackAmount') + 1]: '$#,##0.00',
      [DEPOSIT_HEADERS.indexOf('CalculatedTotal') + 1]: '$#,##0.00',
      [DEPOSIT_HEADERS.indexOf('AmountVariance') + 1]: '$#,##0.00'
    },
    logMessage: `Exported ${depositRows.length} QBO deposits.`
  });

  const depositLineRows = buildDepositLineRows_(deposits);

  safeLog_(`Writing ${depositLineRows.length} QBO deposit line rows.`);

  writeExport_({
    sheetName: 'QBO_DepositLines',
    headers: DEPOSIT_LINE_HEADERS,
    rows: depositLineRows,
    autoResize: false,
    columnWidths: {
      [DEPOSIT_LINE_HEADERS.indexOf('DepositDocNumber') + 1]: 150,
      [DEPOSIT_LINE_HEADERS.indexOf('DepositAccountName') + 1]: 240,
      [DEPOSIT_LINE_HEADERS.indexOf('DetailType') + 1]: 190,
      [DEPOSIT_LINE_HEADERS.indexOf('Description') + 1]: 300,
      [DEPOSIT_LINE_HEADERS.indexOf('SourceAccountName') + 1]: 240,
      [DEPOSIT_LINE_HEADERS.indexOf('EntityName') + 1]: 240,
      [DEPOSIT_LINE_HEADERS.indexOf('CustomerName') + 1]: 240,
      [DEPOSIT_LINE_HEADERS.indexOf('PaymentMethodName') + 1]: 180,
      [DEPOSIT_LINE_HEADERS.indexOf('TransactionType') + 1]: 180,
      [DEPOSIT_LINE_HEADERS.indexOf('LinkedOtherTransactionsJSON') + 1]: 300,
      [DEPOSIT_LINE_HEADERS.indexOf('LinkedTransactionsJSON') + 1]: 300,
      [DEPOSIT_LINE_HEADERS.indexOf('RawJSON') + 1]: 300
    },
    numberFormats: {
      [DEPOSIT_LINE_HEADERS.indexOf('DepositTxnDate') + 1]: 'yyyy-mm-dd',
      [DEPOSIT_LINE_HEADERS.indexOf('Amount') + 1]: '$#,##0.00'
    },
    logMessage: `Exported ${depositLineRows.length} QBO deposit line rows.`
  });

  safeLog_('Completed QBO deposits export.');

  return {
    depositCount: depositRows.length,
    depositLineCount: depositLineRows.length
  };
}

/**
 * Builds rows for QBO_Deposits.
 *
 * @param {Object[]} deposits QBO Deposit objects.
 * @return {Array[]} Rows matching DEPOSIT_HEADERS.
 */
function buildDepositRows_(deposits) {
  return deposits.map(deposit => {
    const meta = extractMeta_(deposit);
    const lines = normalizeArray_(deposit.Line);
    const lineTotal = calculateDepositLineTotal_(lines);
    const cashBackAmount = nestedNumberOrBlank_(deposit, 'CashBack.Amount');
    const calculatedTotal = calculateDepositCalculatedTotal_(
      lineTotal,
      cashBackAmount
    );
    const amountVariance = calculateDepositAmountVariance_(
      deposit.TotalAmt,
      calculatedTotal
    );
    const linkedTransactions = collectDepositLinkedTxns_(lines);
    const linked = summarizeLinkedTransactions_(linkedTransactions);
    const linkedLineCount = countDepositLinkedLines_(lines);

    return [
      valueOrBlank_(deposit.Id),
      valueOrBlank_(deposit.SyncToken),
      valueOrBlank_(deposit.DocNumber),
      valueOrBlank_(deposit.TxnDate),
      nestedValue_(deposit, 'DepositToAccountRef.value'),
      nestedValue_(deposit, 'DepositToAccountRef.name'),
      nestedValue_(deposit, 'CurrencyRef.value'),
      nestedValue_(deposit, 'CurrencyRef.name'),
      numberOrBlank_(deposit.ExchangeRate),
      nestedValue_(deposit, 'DepartmentRef.value'),
      nestedValue_(deposit, 'DepartmentRef.name'),
      numberOrBlank_(deposit.TotalAmt),
      numberOrBlank_(deposit.HomeTotalAmt),
      lineTotal,
      cashBackAmount,
      calculatedTotal,
      amountVariance,
      nestedValue_(deposit, 'CashBack.AccountRef.value'),
      nestedValue_(deposit, 'CashBack.AccountRef.name'),
      nestedValue_(deposit, 'CashBack.Memo'),
      lines.length,
      linkedLineCount,
      lines.length - linkedLineCount,
      valueOrBlank_(deposit.PrivateNote),
      linked.totalCount,
      linked.invoiceCount,
      linked.invoiceIds,
      linked.paymentCount,
      linked.paymentIds,
      linked.salesReceiptCount,
      linked.salesReceiptIds,
      linked.estimateCount,
      linked.estimateIds,
      linked.creditMemoCount,
      linked.creditMemoIds,
      linked.depositCount,
      linked.depositIds,
      linked.billCount,
      linked.billIds,
      linked.journalEntryCount,
      linked.journalEntryIds,
      linked.purchaseCount,
      linked.purchaseIds,
      linked.otherCount,
      jsonStringifyCellSafe_(linked.otherTransactions),
      jsonStringifyCellSafe_(linkedTransactions),
      jsonStringifyCellSafe_(deposit.CashBack),
      valueOrBlank_(meta.createTime),
      valueOrBlank_(meta.lastUpdatedTime),
      jsonStringifyCellSafe_(deposit)
    ];
  });
}

/**
 * Builds rows for QBO_DepositLines.
 *
 * @param {Object[]} deposits QBO Deposit objects.
 * @return {Array[]} Rows matching DEPOSIT_LINE_HEADERS.
 */
function buildDepositLineRows_(deposits) {
  const rows = [];

  deposits.forEach(deposit => {
    normalizeArray_(deposit.Line).forEach((line, index) => {
      appendDepositLineRow_(rows, deposit, line, index);
    });
  });

  return rows;
}

/**
 * Appends one Deposit line row.
 *
 * @param {Array[]} rows Destination rows.
 * @param {Object} deposit Parent Deposit.
 * @param {Object} line Deposit line.
 * @param {number} index Zero-based line index.
 */
function appendDepositLineRow_(rows, deposit, line, index) {
  const detailType = valueOrBlank_(line.DetailType);
  const detail = detailType && line[detailType]
    ? line[detailType]
    : (line.DepositLineDetail || {});

  const linkedTransactions = normalizeArray_(line.LinkedTxn);
  const linked = summarizeLinkedTransactions_(linkedTransactions);
  const hasLinkedTransaction = linkedTransactions.length > 0;
  const isPaymentLink = linked.paymentCount > 0;
  const isSalesReceiptLink = linked.salesReceiptCount > 0;
  const isOtherLink =
    hasLinkedTransaction &&
    !isPaymentLink &&
    !isSalesReceiptLink;

  const suppliedLineNumber = valueOrBlank_(line.LineNum);
  const lineNumber = suppliedLineNumber !== ''
    ? suppliedLineNumber
    : index + 1;

  rows.push([
    valueOrBlank_(deposit.Id),
    valueOrBlank_(deposit.DocNumber),
    valueOrBlank_(deposit.TxnDate),
    nestedValue_(deposit, 'DepositToAccountRef.value'),
    nestedValue_(deposit, 'DepositToAccountRef.name'),
    valueOrBlank_(line.Id),
    lineNumber,
    detailType,
    valueOrBlank_(line.Description),
    numberOrBlank_(line.Amount),
    nestedValue_(detail, 'AccountRef.value'),
    nestedValue_(detail, 'AccountRef.name'),
    nestedValue_(detail, 'Entity.value'),
    nestedValue_(detail, 'Entity.name'),
    nestedValue_(detail, 'Entity.type'),
    nestedValue_(detail, 'CustomerRef.value'),
    nestedValue_(detail, 'CustomerRef.name'),
    nestedValue_(detail, 'ClassRef.value'),
    nestedValue_(detail, 'ClassRef.name'),
    nestedValue_(detail, 'PaymentMethodRef.value'),
    nestedValue_(detail, 'PaymentMethodRef.name'),
    valueOrBlank_(detail.CheckNum),
    valueOrBlank_(detail.TxnType),
    linked.totalCount,
    linked.invoiceCount,
    linked.invoiceIds,
    linked.paymentCount,
    linked.paymentIds,
    linked.salesReceiptCount,
    linked.salesReceiptIds,
    linked.estimateCount,
    linked.estimateIds,
    linked.creditMemoCount,
    linked.creditMemoIds,
    linked.depositCount,
    linked.depositIds,
    linked.billCount,
    linked.billIds,
    linked.journalEntryCount,
    linked.journalEntryIds,
    linked.purchaseCount,
    linked.purchaseIds,
    linked.otherCount,
    jsonStringifyCellSafe_(linked.otherTransactions),
    jsonStringifyCellSafe_(linkedTransactions),
    hasLinkedTransaction,
    isPaymentLink,
    isSalesReceiptLink,
    isOtherLink,
    jsonStringifyCellSafe_(line)
    ]);
}

/**
 * Calculates the total of all Deposit line amounts.
 *
 * @param {Object[]} lines Deposit line objects.
 * @return {number|string} Deposit line total.
 */
function calculateDepositLineTotal_(lines) {
  let total = 0;
  let hasAmount = false;

  lines.forEach(line => {
    if (line.Amount === undefined || line.Amount === null || line.Amount === '') {
      return;
    }

    const amount = Number(line.Amount);

    if (Number.isFinite(amount)) {
      total += amount;
      hasAmount = true;
    }
  });

  return hasAmount ? total : '';
}

/**
 * Calculates the expected net Deposit total.
 *
 * @param {*} lineTotal Total of Deposit lines.
 * @param {*} cashBackAmount Deposit cash-back amount.
 * @return {number|string} Calculated Deposit total.
 */
function calculateDepositCalculatedTotal_(lineTotal, cashBackAmount) {
  if (lineTotal === undefined || lineTotal === null || lineTotal === '') {
    return '';
  }

  const lines = Number(lineTotal);
  const cashBack = (
    cashBackAmount === undefined ||
    cashBackAmount === null ||
    cashBackAmount === ''
  ) ? 0 : Number(cashBackAmount);

  if (!Number.isFinite(lines) || !Number.isFinite(cashBack)) {
    return '';
  }

  return lines - cashBack;
}

/**
 * Calculates the difference between QBO TotalAmt and calculated total.
 *
 * @param {*} totalAmount Deposit.TotalAmt.
 * @param {*} calculatedTotal Calculated Deposit total.
 * @return {number|string} Variance or blank.
 */
function calculateDepositAmountVariance_(totalAmount, calculatedTotal) {
  if (
    totalAmount === undefined ||
    totalAmount === null ||
    totalAmount === '' ||
    calculatedTotal === undefined ||
    calculatedTotal === null ||
    calculatedTotal === ''
  ) {
    return '';
  }

  const total = Number(totalAmount);
  const calculated = Number(calculatedTotal);

  if (!Number.isFinite(total) || !Number.isFinite(calculated)) {
    return '';
  }

  return total - calculated;
}

/**
 * Counts Deposit lines containing at least one LinkedTxn.
 *
 * @param {Object[]} lines Deposit line objects.
 * @return {number} Linked line count.
 */
function countDepositLinkedLines_(lines) {
  let count = 0;

  lines.forEach(line => {
    if (normalizeArray_(line.LinkedTxn).length > 0) {
      count++;
    }
  });

  return count;
}

/**
 * Collects all LinkedTxn records across Deposit lines.
 *
 * @param {Object[]} lines Deposit line objects.
 * @return {Object[]} Linked transaction objects.
 */
function collectDepositLinkedTxns_(lines) {
  const linkedTransactions = [];

  lines.forEach(line => {
    normalizeArray_(line.LinkedTxn).forEach(linkedTxn => {
      linkedTransactions.push(linkedTxn);
    });
  });

  return linkedTransactions;
}
