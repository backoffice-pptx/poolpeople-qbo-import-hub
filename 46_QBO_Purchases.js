/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 46_QBO_Purchases.js
 * Purpose     : Export QBO Purchase transactions and purchase lines to structured Google Sheets tables.
 *
 * Public API:
 *   - exportQboPurchases()
 *
 * Internal Helpers:
 *   - buildPurchaseRows_()
 *   - buildPurchaseLineRows_()
 *   - appendPurchaseLineRow_()
 *   - summarizePurchaseLines_()
 *   - calculatePurchaseLineTotal_()
 *   - calculatePurchaseAmountVariance_()
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
 *   - 2026-07-21: Added standardized module documentation. No runtime behavior
 *     changed.
 * ============================================================================
 */


/***********************
 * 46_QBO_Purchases.gs
 * QBO Purchase export
 *
 * Output Sheets:
 *   QBO_Purchases
 *   QBO_PurchaseLines
 *
 * Public Functions:
 *   exportQboPurchases()
 ***********************/

/** Purchase parent export columns. */
const PURCHASE_HEADERS = [
  'Id',
  'SyncToken',
  'DocNumber',
  'TxnDate',
  'PaymentType',
  'IsCredit',
  'EntityId',
  'EntityName',
  'EntityType',
  'AccountId',
  'AccountName',
  'PaymentMethodId',
  'PaymentMethodName',
  'DepartmentId',
  'DepartmentName',
  'CurrencyCode',
  'CurrencyName',
  'ExchangeRate',
  'CheckPrintStatus',
  'RemitToAddrId',
  'RemitToAddrLine1',
  'RemitToAddrLine2',
  'RemitToAddrLine3',
  'RemitToAddrLine4',
  'RemitToAddrLine5',
  'RemitToAddrCity',
  'RemitToAddrState',
  'RemitToAddrPostalCode',
  'RemitToAddrCountry',
  'TotalAmount',
  'HomeTotalAmount',
  'LineTotal',
  'AmountVariance',
  'LineCount',
  'AccountExpenseLineCount',
  'ItemExpenseLineCount',
  'OtherLineCount',
  'TransactionTaxCodeId',
  'TransactionTaxCodeName',
  'TotalTax',
  'GlobalTaxCalculation',
  'IncludeInAnnualTPAR',
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
  'TransactionTaxDetailJSON',
  'CreateTime',
  'LastUpdatedTime',
  'RawJSON'
];

/** Purchase line export columns. */
const PURCHASE_LINE_HEADERS = [
  'PurchaseId',
  'PurchaseDocNumber',
  'PurchaseTxnDate',
  'PaymentType',
  'IsCredit',
  'EntityId',
  'EntityName',
  'EntityType',
  'FundingAccountId',
  'FundingAccountName',
  'LineId',
  'LineNumber',
  'DetailType',
  'Description',
  'Amount',
  'ExpenseAccountId',
  'ExpenseAccountName',
  'ItemId',
  'ItemName',
  'Quantity',
  'UnitPrice',
  'CustomerId',
  'CustomerName',
  'ClassId',
  'ClassName',
  'BillableStatus',
  'TaxCodeId',
  'TaxCodeName',
  'TaxAmount',
  'MarkupPercent',
  'MarkupAccountId',
  'MarkupAccountName',
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
  'RawJSON'
];

/**
 * Exports all QBO Purchases and their line details.
 *
 * @return {Object} Export row counts.
 */
function exportQboPurchases() {
  safeLog_('Starting QBO purchases export.');

  const purchases = qboQueryAllGeneric_(
    'SELECT * FROM Purchase',
    'Purchase'
  );

  safeLog_(`Retrieved ${purchases.length} QBO purchases.`);

  const purchaseRows = buildPurchaseRows_(purchases);

  writeExport_({
    sheetName: 'QBO_Purchases',
    headers: PURCHASE_HEADERS,
    rows: purchaseRows,
    columnWidths: {
      [PURCHASE_HEADERS.indexOf('DocNumber') + 1]: 140,
      [PURCHASE_HEADERS.indexOf('PaymentType') + 1]: 140,
      [PURCHASE_HEADERS.indexOf('EntityName') + 1]: 240,
      [PURCHASE_HEADERS.indexOf('AccountName') + 1]: 240,
      [PURCHASE_HEADERS.indexOf('PaymentMethodName') + 1]: 180,
      [PURCHASE_HEADERS.indexOf('RemitToAddrLine1') + 1]: 240,
      [PURCHASE_HEADERS.indexOf('PrivateNote') + 1]: 300,
      [PURCHASE_HEADERS.indexOf('LinkedOtherTransactionsJSON') + 1]: 300,
      [PURCHASE_HEADERS.indexOf('LinkedTransactionsJSON') + 1]: 300,
      [PURCHASE_HEADERS.indexOf('TransactionTaxDetailJSON') + 1]: 300,
      [PURCHASE_HEADERS.indexOf('RawJSON') + 1]: 300
    },
    numberFormats: {
      [PURCHASE_HEADERS.indexOf('TxnDate') + 1]: 'yyyy-mm-dd',
      [PURCHASE_HEADERS.indexOf('ExchangeRate') + 1]: '0.000000',
      [PURCHASE_HEADERS.indexOf('TotalAmount') + 1]: '$#,##0.00',
      [PURCHASE_HEADERS.indexOf('HomeTotalAmount') + 1]: '$#,##0.00',
      [PURCHASE_HEADERS.indexOf('LineTotal') + 1]: '$#,##0.00',
      [PURCHASE_HEADERS.indexOf('AmountVariance') + 1]: '$#,##0.00',
      [PURCHASE_HEADERS.indexOf('TotalTax') + 1]: '$#,##0.00'
    },
    logMessage: `Exported ${purchaseRows.length} QBO purchases.`
  });

  const purchaseLineRows = buildPurchaseLineRows_(purchases);

  writeExport_({
    sheetName: 'QBO_PurchaseLines',
    headers: PURCHASE_LINE_HEADERS,
    rows: purchaseLineRows,
    columnWidths: {
      [PURCHASE_LINE_HEADERS.indexOf('PurchaseDocNumber') + 1]: 150,
      [PURCHASE_LINE_HEADERS.indexOf('PaymentType') + 1]: 140,
      [PURCHASE_LINE_HEADERS.indexOf('EntityName') + 1]: 240,
      [PURCHASE_LINE_HEADERS.indexOf('FundingAccountName') + 1]: 240,
      [PURCHASE_LINE_HEADERS.indexOf('DetailType') + 1]: 220,
      [PURCHASE_LINE_HEADERS.indexOf('Description') + 1]: 300,
      [PURCHASE_LINE_HEADERS.indexOf('ExpenseAccountName') + 1]: 240,
      [PURCHASE_LINE_HEADERS.indexOf('ItemName') + 1]: 240,
      [PURCHASE_LINE_HEADERS.indexOf('CustomerName') + 1]: 240,
      [PURCHASE_LINE_HEADERS.indexOf('LinkedOtherTransactionsJSON') + 1]: 300,
      [PURCHASE_LINE_HEADERS.indexOf('LinkedTransactionsJSON') + 1]: 300,
      [PURCHASE_LINE_HEADERS.indexOf('RawJSON') + 1]: 300
    },
    numberFormats: {
      [PURCHASE_LINE_HEADERS.indexOf('PurchaseTxnDate') + 1]: 'yyyy-mm-dd',
      [PURCHASE_LINE_HEADERS.indexOf('Amount') + 1]: '$#,##0.00',
      [PURCHASE_LINE_HEADERS.indexOf('Quantity') + 1]: '0.00',
      [PURCHASE_LINE_HEADERS.indexOf('UnitPrice') + 1]: '$#,##0.00',
      [PURCHASE_LINE_HEADERS.indexOf('TaxAmount') + 1]: '$#,##0.00',
      [PURCHASE_LINE_HEADERS.indexOf('MarkupPercent') + 1]: '0.00'
    },
    logMessage: `Exported ${purchaseLineRows.length} QBO purchase line rows.`
  });

  safeLog_('Completed QBO purchases export.');

  return {
    purchaseCount: purchaseRows.length,
    purchaseLineCount: purchaseLineRows.length
  };
}

/**
 * Builds rows for QBO_Purchases.
 *
 * @param {Object[]} purchases QBO Purchase objects.
 * @return {Array[]} Rows matching PURCHASE_HEADERS.
 */
function buildPurchaseRows_(purchases) {
  return purchases.map(purchase => {
    const meta = extractMeta_(purchase);
    const lines = normalizeArray_(purchase.Line);
    const lineSummary = summarizePurchaseLines_(lines);
    const lineTotal = calculatePurchaseLineTotal_(lines);
    const amountVariance = calculatePurchaseAmountVariance_(
      purchase.TotalAmt,
      lineTotal,
      nestedNumberOrBlank_(purchase, 'TxnTaxDetail.TotalTax')
    );
    const linkedTransactions = normalizeArray_(purchase.LinkedTxn);
    const linked = summarizeLinkedTransactions_(linkedTransactions);

    return [
      valueOrBlank_(purchase.Id),
      valueOrBlank_(purchase.SyncToken),
      valueOrBlank_(purchase.DocNumber),
      valueOrBlank_(purchase.TxnDate),
      valueOrBlank_(purchase.PaymentType),
      booleanOrBlank_(purchase.Credit),
      nestedValue_(purchase, 'EntityRef.value'),
      nestedValue_(purchase, 'EntityRef.name'),
      nestedValue_(purchase, 'EntityRef.type'),
      nestedValue_(purchase, 'AccountRef.value'),
      nestedValue_(purchase, 'AccountRef.name'),
      nestedValue_(purchase, 'PaymentMethodRef.value'),
      nestedValue_(purchase, 'PaymentMethodRef.name'),
      nestedValue_(purchase, 'DepartmentRef.value'),
      nestedValue_(purchase, 'DepartmentRef.name'),
      nestedValue_(purchase, 'CurrencyRef.value'),
      nestedValue_(purchase, 'CurrencyRef.name'),
      numberOrBlank_(purchase.ExchangeRate),
      valueOrBlank_(purchase.PrintStatus),
      nestedValue_(purchase, 'RemitToAddr.Id'),
      nestedValue_(purchase, 'RemitToAddr.Line1'),
      nestedValue_(purchase, 'RemitToAddr.Line2'),
      nestedValue_(purchase, 'RemitToAddr.Line3'),
      nestedValue_(purchase, 'RemitToAddr.Line4'),
      nestedValue_(purchase, 'RemitToAddr.Line5'),
      nestedValue_(purchase, 'RemitToAddr.City'),
      nestedValue_(purchase, 'RemitToAddr.CountrySubDivisionCode'),
      nestedValue_(purchase, 'RemitToAddr.PostalCode'),
      nestedValue_(purchase, 'RemitToAddr.Country'),
      numberOrBlank_(purchase.TotalAmt),
      numberOrBlank_(purchase.HomeTotalAmt),
      lineTotal,
      amountVariance,
      lines.length,
      lineSummary.accountExpenseLineCount,
      lineSummary.itemExpenseLineCount,
      lineSummary.otherLineCount,
      nestedValue_(purchase, 'TxnTaxDetail.TxnTaxCodeRef.value'),
      nestedValue_(purchase, 'TxnTaxDetail.TxnTaxCodeRef.name'),
      nestedNumberOrBlank_(purchase, 'TxnTaxDetail.TotalTax'),
      valueOrBlank_(purchase.GlobalTaxCalculation),
      booleanOrBlank_(purchase.IncludeInAnnualTPAR),
      valueOrBlank_(purchase.PrivateNote),
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
      jsonStringifyCellSafe_(purchase.TxnTaxDetail),
      valueOrBlank_(meta.createTime),
      valueOrBlank_(meta.lastUpdatedTime),
      jsonStringifyCellSafe_(purchase)
    ];
  });
}

/**
 * Builds rows for QBO_PurchaseLines.
 *
 * @param {Object[]} purchases QBO Purchase objects.
 * @return {Array[]} Rows matching PURCHASE_LINE_HEADERS.
 */
function buildPurchaseLineRows_(purchases) {
  const rows = [];

  purchases.forEach(purchase => {
    normalizeArray_(purchase.Line).forEach((line, index) => {
      appendPurchaseLineRow_(rows, purchase, line, index);
    });
  });

  return rows;
}

/**
 * Appends one Purchase line row.
 *
 * @param {Array[]} rows Destination rows.
 * @param {Object} purchase Parent Purchase.
 * @param {Object} line Purchase line.
 * @param {number} index Zero-based line index.
 */
function appendPurchaseLineRow_(rows, purchase, line, index) {
  const detailType = valueOrBlank_(line.DetailType);
  const detail = detailType && line[detailType] ? line[detailType] : {};
  const suppliedLineNumber = valueOrBlank_(line.LineNum);
  const lineNumber = suppliedLineNumber !== '' ? suppliedLineNumber : index + 1;
  const linkedTransactions = normalizeArray_(line.LinkedTxn);
  const linked = summarizeLinkedTransactions_(linkedTransactions);

  rows.push([
    valueOrBlank_(purchase.Id),
    valueOrBlank_(purchase.DocNumber),
    valueOrBlank_(purchase.TxnDate),
    valueOrBlank_(purchase.PaymentType),
    booleanOrBlank_(purchase.Credit),
    nestedValue_(purchase, 'EntityRef.value'),
    nestedValue_(purchase, 'EntityRef.name'),
    nestedValue_(purchase, 'EntityRef.type'),
    nestedValue_(purchase, 'AccountRef.value'),
    nestedValue_(purchase, 'AccountRef.name'),
    valueOrBlank_(line.Id),
    lineNumber,
    detailType,
    valueOrBlank_(line.Description),
    numberOrBlank_(line.Amount),
    nestedValue_(detail, 'AccountRef.value'),
    nestedValue_(detail, 'AccountRef.name'),
    nestedValue_(detail, 'ItemRef.value'),
    nestedValue_(detail, 'ItemRef.name'),
    numberOrBlank_(detail.Qty),
    numberOrBlank_(detail.UnitPrice),
    nestedValue_(detail, 'CustomerRef.value'),
    nestedValue_(detail, 'CustomerRef.name'),
    nestedValue_(detail, 'ClassRef.value'),
    nestedValue_(detail, 'ClassRef.name'),
    valueOrBlank_(detail.BillableStatus),
    nestedValue_(detail, 'TaxCodeRef.value'),
    nestedValue_(detail, 'TaxCodeRef.name'),
    numberOrBlank_(detail.TaxAmount),
    numberOrBlank_(detail.MarkupInfo ? detail.MarkupInfo.Percent : ''),
    nestedValue_(detail, 'MarkupInfo.MarkupIncomeAccountRef.value'),
    nestedValue_(detail, 'MarkupInfo.MarkupIncomeAccountRef.name'),
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
    jsonStringifyCellSafe_(line)
    ]);
}

/**
 * Counts Purchase expense line types.
 *
 * @param {Object[]} lines Purchase line objects.
 * @return {Object} Line type counts.
 */
function summarizePurchaseLines_(lines) {
  let accountExpenseLineCount = 0;
  let itemExpenseLineCount = 0;
  let otherLineCount = 0;

  lines.forEach(line => {
    const detailType = valueOrBlank_(line.DetailType);

    if (detailType === 'AccountBasedExpenseLineDetail') {
      accountExpenseLineCount++;
    } else if (detailType === 'ItemBasedExpenseLineDetail') {
      itemExpenseLineCount++;
    } else {
      otherLineCount++;
    }
  });

  return {
    accountExpenseLineCount: accountExpenseLineCount,
    itemExpenseLineCount: itemExpenseLineCount,
    otherLineCount: otherLineCount
  };
}

/**
 * Calculates the total of all Purchase line amounts.
 *
 * @param {Object[]} lines Purchase lines.
 * @return {number|string} Line total or blank.
 */
function calculatePurchaseLineTotal_(lines) {
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
 * Calculates a Purchase validation variance.
 *
 * @param {*} totalAmount Purchase.TotalAmt.
 * @param {*} lineTotal Calculated line total.
 * @param {*} totalTax Purchase total tax.
 * @return {number|string} Validation variance or blank.
 */
function calculatePurchaseAmountVariance_(totalAmount, lineTotal, totalTax) {
  if (
    totalAmount === undefined ||
    totalAmount === null ||
    totalAmount === '' ||
    lineTotal === undefined ||
    lineTotal === null ||
    lineTotal === ''
  ) {
    return '';
  }

  const total = Number(totalAmount);
  const lines = Number(lineTotal);

  if (!Number.isFinite(total) || !Number.isFinite(lines)) {
    return '';
  }

  const varianceWithoutTax = total - lines;
  const tax = Number(totalTax);

  if (!Number.isFinite(tax)) {
    return varianceWithoutTax;
  }

  const varianceWithTax = total - (lines + tax);

  return Math.abs(varianceWithTax) < Math.abs(varianceWithoutTax)
    ? varianceWithTax
    : varianceWithoutTax;
}
