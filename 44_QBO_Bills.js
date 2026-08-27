/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 44_QBO_Bills.js
 * Purpose     : Export QBO Bills and bill lines to structured Google Sheets tables.
 *
 * Public API:
 *   - exportQboBills()
 *
 * Internal Helpers:
 *   - buildBillRows_()
 *   - buildBillLineRows_()
 *   - appendBillLineRow_()
 *   - countBillLineTypes_()
 *   - calculateBillPaidAmount_()
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
 * 44_QBO_Bills.gs
 * QBO Bill export
 *
 * Output Sheets:
 *   QBO_Bills
 *   QBO_BillLines
 *
 * Public Functions:
 *   exportQboBills()
 ***********************/

/**
 * Bill parent export columns.
 */
const BILL_HEADERS = [
  // Identity
  'Id',
  'SyncToken',
  'DocNumber',

  // Dates
  'TxnDate',
  'DueDate',

  // Vendor
  'VendorId',
  'VendorName',

  // Accounts Payable
  'APAccountId',
  'APAccountName',

  // Terms
  'TermsId',
  'TermsName',

  // Classification
  'DepartmentId',
  'DepartmentName',

  // Currency
  'CurrencyCode',
  'CurrencyName',
  'ExchangeRate',

  // Amounts
  'TotalAmount',
  'Balance',
  'PaidAmount',
  'HomeTotalAmount',
  'HomeBalance',

  // Status
  'IsPaid',
  'IsPartiallyPaid',
  'IsOpen',

  // Line Summary
  'LineCount',
  'AccountExpenseLineCount',
  'ItemExpenseLineCount',

  // Tax and Reporting
  'TransactionTaxCodeId',
  'TransactionTaxCodeName',
  'TotalTax',
  'GlobalTaxCalculation',
  'IncludeInAnnualTPAR',
  'TaxLineCount',
  'TaxLinesJSON',
  'TransactionTaxDetailJSON',

  // Notes
  'PrivateNote',

  // Linked Transactions
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

  // Audit
  'CreateTime',
  'LastUpdatedTime',

  // Source
  'RawJSON'
];

/**
 * Bill line export columns.
 */
const BILL_LINE_HEADERS = [
  // Parent Bill
  'BillId',
  'BillDocNumber',
  'BillTxnDate',
  'BillDueDate',

  // Vendor
  'VendorId',
  'VendorName',

  // Line Identity
  'LineId',
  'LineNumber',
  'DetailType',

  // General
  'Description',
  'Amount',

  // Account-Based Expense
  'AccountId',
  'AccountName',

  // Item-Based Expense
  'ItemId',
  'ItemName',
  'Quantity',
  'UnitPrice',

  // Customer / Project
  'CustomerId',
  'CustomerName',

  // Classification
  'ClassId',
  'ClassName',

  // Billable
  'BillableStatus',

  // Tax
  'TaxCodeId',
  'TaxCodeName',
  'TaxAmount',

  // Markup
  'MarkupPercent',
  'MarkupAccountId',
  'MarkupAccountName',

  // Linked Transactions
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

  // Source
  'RawJSON'
];

/**
 * Exports all QBO Bills and their line details.
 *
 * Output sheets:
 *   QBO_Bills
 *   QBO_BillLines
 *
 * @return {Object} Export row counts.
 */
function exportQboBills() {

  safeLog_('Starting QBO bills export.');

  const bills = qboQueryAllGeneric_(
    'SELECT * FROM Bill',
    'Bill'
  );

  safeLog_(`Retrieved ${bills.length} QBO bills.`);

  // Parent Bills
  const billRows = buildBillRows_(bills);

  writeExport_({
    sheetName: 'QBO_Bills',
    headers: BILL_HEADERS,
    rows: billRows,

    columnWidths: {
      [BILL_HEADERS.indexOf('DocNumber') + 1]: 140,
      [BILL_HEADERS.indexOf('VendorName') + 1]: 240,
      [BILL_HEADERS.indexOf('APAccountName') + 1]: 240,
      [BILL_HEADERS.indexOf('TermsName') + 1]: 160,
      [BILL_HEADERS.indexOf('TaxLinesJSON') + 1]: 300,
      [BILL_HEADERS.indexOf('TransactionTaxDetailJSON') + 1]: 300,
      [BILL_HEADERS.indexOf('PrivateNote') + 1]: 300,
      [BILL_HEADERS.indexOf('LinkedOtherTransactionsJSON') + 1]: 300,
      [BILL_HEADERS.indexOf('LinkedTransactionsJSON') + 1]: 300,
      [BILL_HEADERS.indexOf('RawJSON') + 1]: 300
    },


    numberFormats: {
      [BILL_HEADERS.indexOf('TxnDate') + 1]: 'yyyy-mm-dd',
      [BILL_HEADERS.indexOf('DueDate') + 1]: 'yyyy-mm-dd',
      [BILL_HEADERS.indexOf('ExchangeRate') + 1]: '0.000000',
      [BILL_HEADERS.indexOf('TotalAmount') + 1]: '$#,##0.00',
      [BILL_HEADERS.indexOf('Balance') + 1]: '$#,##0.00',
      [BILL_HEADERS.indexOf('PaidAmount') + 1]: '$#,##0.00',
      [BILL_HEADERS.indexOf('HomeTotalAmount') + 1]: '$#,##0.00',
      [BILL_HEADERS.indexOf('HomeBalance') + 1]: '$#,##0.00',
      [BILL_HEADERS.indexOf('TotalTax') + 1]: '$#,##0.00'
    },

    logMessage: `Exported ${billRows.length} QBO bills.`
  });

  // Bill Lines
  const billLineRows = buildBillLineRows_(bills);

  writeExport_({
    sheetName: 'QBO_BillLines',
    headers: BILL_LINE_HEADERS,
    rows: billLineRows,

    columnWidths: {
      [BILL_LINE_HEADERS.indexOf('BillDocNumber') + 1]: 140,
      [BILL_LINE_HEADERS.indexOf('VendorName') + 1]: 240,
      [BILL_LINE_HEADERS.indexOf('DetailType') + 1]: 210,
      [BILL_LINE_HEADERS.indexOf('Description') + 1]: 300,
      [BILL_LINE_HEADERS.indexOf('AccountName') + 1]: 240,
      [BILL_LINE_HEADERS.indexOf('ItemName') + 1]: 240,
      [BILL_LINE_HEADERS.indexOf('CustomerName') + 1]: 240,
      [BILL_LINE_HEADERS.indexOf('LinkedOtherTransactionsJSON') + 1]: 300,
      [BILL_LINE_HEADERS.indexOf('LinkedTransactionsJSON') + 1]: 300,
      [BILL_LINE_HEADERS.indexOf('RawJSON') + 1]: 300
    },


    numberFormats: {
      [BILL_LINE_HEADERS.indexOf('BillTxnDate') + 1]: 'yyyy-mm-dd',
      [BILL_LINE_HEADERS.indexOf('BillDueDate') + 1]: 'yyyy-mm-dd',
      [BILL_LINE_HEADERS.indexOf('Amount') + 1]: '$#,##0.00',
      [BILL_LINE_HEADERS.indexOf('Quantity') + 1]: '0.00',
      [BILL_LINE_HEADERS.indexOf('UnitPrice') + 1]: '$#,##0.00',
      [BILL_LINE_HEADERS.indexOf('TaxAmount') + 1]: '$#,##0.00',
      [BILL_LINE_HEADERS.indexOf('MarkupPercent') + 1]: '0.00'
    },

    logMessage: `Exported ${billLineRows.length} QBO bill line rows.`
  });

  safeLog_('Completed QBO bills export.');

  return {
    billCount: billRows.length,
    billLineCount: billLineRows.length
  };
}

/**
 * Builds rows for QBO_Bills.
 *
 * @param {Object[]} bills QBO Bill objects.
 * @return {Array[]} Rows matching BILL_HEADERS.
 */
function buildBillRows_(bills) {

  return bills.map(bill => {
    const meta = extractMeta_(bill);

    const lines = normalizeArray_(bill.Line);

    const lineCounts = countBillLineTypes_(lines);

    const totalAmount = numberOrBlank_(bill.TotalAmt);
    const balance = numberOrBlank_(bill.Balance);
    const paidAmount = calculateBillPaidAmount_(bill.TotalAmt, bill.Balance);

    const numericBalance = Number(bill.Balance);
    const numericTotal = Number(bill.TotalAmt);
    const hasValidBalance = Number.isFinite(numericBalance);
    const hasValidTotal = Number.isFinite(numericTotal);

    const isPaid = hasValidBalance && numericBalance === 0;
    const isPartiallyPaid = hasValidBalance && hasValidTotal &&
      numericBalance > 0 && numericBalance < numericTotal;
    const isOpen = hasValidBalance && numericBalance > 0;

    const taxLines = normalizeArray_(
      nestedValue_(bill, 'TxnTaxDetail.TaxLine')
    );

    const linked = summarizeLinkedTransactions_(bill.LinkedTxn);

    return [
      // Identity
      valueOrBlank_(bill.Id),
      valueOrBlank_(bill.SyncToken),
      valueOrBlank_(bill.DocNumber),

      // Dates
      valueOrBlank_(bill.TxnDate),
      valueOrBlank_(bill.DueDate),

      // Vendor
      nestedValue_(bill, 'VendorRef.value'),
      nestedValue_(bill, 'VendorRef.name'),

      // Accounts Payable
      nestedValue_(bill, 'APAccountRef.value'),
      nestedValue_(bill, 'APAccountRef.name'),

      // Terms
      nestedValue_(bill, 'SalesTermRef.value'),
      nestedValue_(bill, 'SalesTermRef.name'),

      // Classification
      nestedValue_(bill, 'DepartmentRef.value'),
      nestedValue_(bill, 'DepartmentRef.name'),

      // Currency
      nestedValue_(bill, 'CurrencyRef.value'),
      nestedValue_(bill, 'CurrencyRef.name'),
      numberOrBlank_(bill.ExchangeRate),

      // Amounts
      totalAmount,
      balance,
      paidAmount,
      numberOrBlank_(bill.HomeTotalAmt),
      numberOrBlank_(bill.HomeBalance),

      // Status
      isPaid,
      isPartiallyPaid,
      isOpen,

      // Line Summary
      lines.length,
      lineCounts.accountExpenseLineCount,
      lineCounts.itemExpenseLineCount,

      // Tax and Reporting
      nestedValue_(bill, 'TxnTaxDetail.TxnTaxCodeRef.value'),
      nestedValue_(bill, 'TxnTaxDetail.TxnTaxCodeRef.name'),
      nestedNumberOrBlank_(bill, 'TxnTaxDetail.TotalTax'),
      valueOrBlank_(bill.GlobalTaxCalculation),
      booleanOrBlank_(bill.IncludeInAnnualTPAR),
      taxLines.length,
      jsonStringifyCellSafe_(taxLines),
      jsonStringifyCellSafe_(bill.TxnTaxDetail),

      // Notes
      valueOrBlank_(bill.PrivateNote),

      // Linked Transactions
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
      jsonStringifyCellSafe_(bill.LinkedTxn),

      // Audit
      valueOrBlank_(meta.createTime),
      valueOrBlank_(meta.lastUpdatedTime),

      // Source
      jsonStringifyCellSafe_(bill)
    ];
  });
}

/**
 * Builds rows for QBO_BillLines.
 *
 * Bill lines are normally AccountBasedExpenseLineDetail or
 * ItemBasedExpenseLineDetail. Other line types retain general fields and JSON.
 *
 * @param {Object[]} bills QBO Bill objects.
 * @return {Array[]} Rows matching BILL_LINE_HEADERS.
 */
function buildBillLineRows_(bills) {

  const rows = [];

  bills.forEach(bill => {
    const lines = normalizeArray_(bill.Line);

    lines.forEach((line, index) => {
      appendBillLineRow_(rows, bill, line, index + 1);
    });
  });

  return rows;
}

/**
 * Appends one Bill line row.
 *
 * @param {Array[]} rows Destination row array.
 * @param {Object} bill Parent Bill object.
 * @param {Object} line Bill line object.
 * @param {number} fallbackLineNumber Array position.
 */
function appendBillLineRow_(rows, bill, line, fallbackLineNumber) {

  const detailType = valueOrBlank_(line.DetailType);

  const detail = detailType && line[detailType]
    ? line[detailType]
    : {};

  const suppliedLineNumber = valueOrBlank_(line.LineNum);

  const lineNumber = suppliedLineNumber !== ''
    ? suppliedLineNumber
    : fallbackLineNumber;

  const linked = summarizeLinkedTransactions_(line.LinkedTxn);

  rows.push([
    // Parent Bill
    valueOrBlank_(bill.Id),
    valueOrBlank_(bill.DocNumber),
    valueOrBlank_(bill.TxnDate),
    valueOrBlank_(bill.DueDate),

    // Vendor
    nestedValue_(bill, 'VendorRef.value'),
    nestedValue_(bill, 'VendorRef.name'),

    // Line Identity
    valueOrBlank_(line.Id),
    lineNumber,
    detailType,

    // General
    valueOrBlank_(line.Description),
    numberOrBlank_(line.Amount),

    // Account-Based Expense
    nestedValue_(detail, 'AccountRef.value'),
    nestedValue_(detail, 'AccountRef.name'),

    // Item-Based Expense
    nestedValue_(detail, 'ItemRef.value'),
    nestedValue_(detail, 'ItemRef.name'),
    numberOrBlank_(detail.Qty),
    numberOrBlank_(detail.UnitPrice),

    // Customer / Project
    nestedValue_(detail, 'CustomerRef.value'),
    nestedValue_(detail, 'CustomerRef.name'),

    // Classification
    nestedValue_(detail, 'ClassRef.value'),
    nestedValue_(detail, 'ClassRef.name'),

    // Billable
    valueOrBlank_(detail.BillableStatus),

    // Tax
    nestedValue_(detail, 'TaxCodeRef.value'),
    nestedValue_(detail, 'TaxCodeRef.name'),
    numberOrBlank_(detail.TaxAmount),

    // Markup
    numberOrBlank_(detail.MarkupInfo ? detail.MarkupInfo.Percent : ''),
    nestedValue_(detail, 'MarkupInfo.MarkupIncomeAccountRef.value'),
    nestedValue_(detail, 'MarkupInfo.MarkupIncomeAccountRef.name'),

    // Linked Transactions
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
    jsonStringifyCellSafe_(line.LinkedTxn),

    // Source
    jsonStringifyCellSafe_(line)
  ]);
}

/**
 * Counts supported Bill expense line types.
 *
 * @param {Object[]} lines Bill line objects.
 * @return {Object} Bill line type counts.
 */
function countBillLineTypes_(lines) {

  let accountExpenseLineCount = 0;
  let itemExpenseLineCount = 0;

  lines.forEach(line => {
    if (line.DetailType === 'AccountBasedExpenseLineDetail') {
      accountExpenseLineCount++;
    }

    if (line.DetailType === 'ItemBasedExpenseLineDetail') {
      itemExpenseLineCount++;
    }
  });

  return {
    accountExpenseLineCount: accountExpenseLineCount,
    itemExpenseLineCount: itemExpenseLineCount
  };
}

/**
 * Calculates the portion of a Bill already paid.
 *
 * Paid Amount = Total Amount - Balance
 *
 * @param {*} totalAmount Bill.TotalAmt.
 * @param {*} balance Bill.Balance.
 * @return {number|string} Paid amount or blank.
 */
function calculateBillPaidAmount_(totalAmount, balance) {

  if (
    totalAmount === undefined ||
    totalAmount === null ||
    totalAmount === ''
  ) {
    return '';
  }

  const total = Number(totalAmount);
  const remaining = Number(balance || 0);

  if (!Number.isFinite(total) || !Number.isFinite(remaining)) {
    return '';
  }

  return total - remaining;
  
}

