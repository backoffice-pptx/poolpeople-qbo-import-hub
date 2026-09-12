/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 42_QBO_CreditMemos.js
 * Purpose     : Export QBO Credit Memos and credit memo lines to structured Google Sheets tables.
 *
 * Public API:
 *   - exportQboCreditMemos()
 *
 * Internal Helpers:
 *   - buildCreditMemoRows_()
 *   - buildCreditMemoLineRows_()
 *   - appendCreditMemoLineRow_()
 *   - calculateCreditMemoLineTotals_()
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
 *   - 2026-09-10: v1.5.33 externalized seven governed Credit Memo top-level
 *     business-state fields previously present only in RawJSON.
 *   - 2026-07-21: Added standardized module documentation. No runtime behavior
 *     changed.
 * ============================================================================
 */


/***********************
 * 42_QBO_CreditMemos.gs
 * QBO Credit Memo export
 *
 * Output Sheets:
 *   QBO_CreditMemos
 *   QBO_CreditMemoLines
 *
 * Public Functions:
 *   exportQboCreditMemos()
 ***********************/

/**
 * Credit Memo parent export columns.
 */
const CREDIT_MEMO_HEADERS = [
  // Identity
  'Id',
  'SyncToken',
  'DocNumber',

  // Dates
  'TxnDate',
  'ShipDate',

  // Customer
  'CustomerId',
  'CustomerName',
  'CustomerMemo',

  // Classification
  'ClassId',
  'ClassName',
  'DepartmentId',
  'DepartmentName',

  // Accounts
  'ARAccountId',
  'ARAccountName',

  // Currency
  'CurrencyCode',
  'CurrencyName',
  'ExchangeRate',

  // Billing Contact
  'BillEmail',
  'BillEmailBccAddress',
  'BillEmailBccJSON',
  'BillEmailCcAddress',
  'BillEmailCcJSON',
  'FreeFormAddress',

  // Billing Address
  'BillAddrId',
  'BillAddrLine1',
  'BillAddrLine2',
  'BillAddrLine3',
  'BillAddrLine4',
  'BillAddrLine5',
  'BillAddrCity',
  'BillAddrState',
  'BillAddrPostalCode',
  'BillAddrCountry',

  // Shipping Address
  'ShipAddrId',
  'ShipAddrLine1',
  'ShipAddrLine2',
  'ShipAddrLine3',
  'ShipAddrLine4',
  'ShipAddrLine5',
  'ShipAddrCity',
  'ShipAddrState',
  'ShipAddrPostalCode',
  'ShipAddrCountry',

  // Ship From Address
  'ShipFromAddrId',
  'ShipFromAddrLine1',
  'ShipFromAddrLine2',
  'ShipFromAddrLine3',
  'ShipFromAddrLine4',
  'ShipFromAddrLine5',
  'ShipFromAddrCity',
  'ShipFromAddrState',
  'ShipFromAddrPostalCode',
  'ShipFromAddrCountry',
  'ShipFromAddrJSON',

  // Shipping
  'TrackingNumber',

  // Delivery Status
  'PrintStatus',
  'EmailStatus',
  'DeliveryType',
  'DeliveryTime',
  'DeliveryInfoJSON',

  // Amounts
  'Subtotal',
  'DiscountTotal',
  'TotalTax',
  'TotalAmount',
  'Balance',
  'RemainingCredit',
  'HomeTotalAmount',
  'HomeRemainingCredit',

  // Tax
  'TransactionTaxCodeId',
  'TransactionTaxCodeName',
  'ApplyTaxAfterDiscount',
  'TaxLineCount',
  'TaxLinesJSON',
  'TransactionTaxDetailJSON',
  'TaxExemptionRefId',
  'TaxExemptionRefName',
  'TaxExemptionRefJSON',

  // Recurrence
  'RecurDataRefId',
  'RecurDataRefName',
  'RecurDataRefJSON',

  // Line Summary
  'LineCount',

  // Notes
  'PrivateNote',

  // Related Data
  'CustomFieldsJSON',

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
 * Credit Memo line export columns.
 */
const CREDIT_MEMO_LINE_HEADERS = [
  // Parent Credit Memo
  'CreditMemoId',
  'CreditMemoDocNumber',
  'CreditMemoTxnDate',

  // Customer
  'CustomerId',
  'CustomerName',

  // Line Identity
  'LineId',
  'LineNumber',
  'LineLevel',
  'ParentLineId',
  'ParentLineNumber',
  'DetailType',

  // General Line Fields
  'Description',
  'Amount',

  // Sales Item Detail
  'ItemId',
  'ItemName',
  'ItemAccountId',
  'ItemAccountName',
  'TaxClassificationId',
  'TaxClassificationName',
  'Quantity',
  'UnitPrice',
  'RatePercent',
  'ServiceDate',

  // Classification
  'ClassId',
  'ClassName',

  // Tax
  'TaxCodeId',
  'TaxCodeName',

  // Discount Detail
  'DiscountPercent',
  'DiscountAccountId',
  'DiscountAccountName',

  // Group Detail
  'GroupItemId',
  'GroupItemName',
  'GroupLineCount',

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
 * Exports all QBO Credit Memos and their line details.
 *
 * Output sheets:
 *   QBO_CreditMemos
 *   QBO_CreditMemoLines
 *
 * @return {Object} Export row counts.
 */
function exportQboCreditMemos() {

  safeLog_('Starting QBO credit memos export.');

  const creditMemos = qboQueryAllGeneric_(
    'SELECT * FROM CreditMemo',
    'CreditMemo'
  );

  safeLog_(`Retrieved ${creditMemos.length} QBO credit memos.`);

  // Parent Credit Memos
  const creditMemoRows = buildCreditMemoRows_(creditMemos);

  writeExport_({
    sheetName: 'QBO_CreditMemos',
    headers: CREDIT_MEMO_HEADERS,
    rows: creditMemoRows,

    columnWidths: {
      [CREDIT_MEMO_HEADERS.indexOf('DocNumber') + 1]: 120,
      [CREDIT_MEMO_HEADERS.indexOf('CustomerName') + 1]: 240,
      [CREDIT_MEMO_HEADERS.indexOf('CustomerMemo') + 1]: 300,
      [CREDIT_MEMO_HEADERS.indexOf('BillEmail') + 1]: 240,
      [CREDIT_MEMO_HEADERS.indexOf('BillAddrLine1') + 1]: 240,
      [CREDIT_MEMO_HEADERS.indexOf('ShipAddrLine1') + 1]: 240,
      [CREDIT_MEMO_HEADERS.indexOf('DeliveryInfoJSON') + 1]: 300,
      [CREDIT_MEMO_HEADERS.indexOf('TaxLinesJSON') + 1]: 300,
      [CREDIT_MEMO_HEADERS.indexOf('TransactionTaxDetailJSON') + 1]: 300,
      [CREDIT_MEMO_HEADERS.indexOf('PrivateNote') + 1]: 300,
      [CREDIT_MEMO_HEADERS.indexOf('CustomFieldsJSON') + 1]: 300,
      [CREDIT_MEMO_HEADERS.indexOf('LinkedOtherTransactionsJSON') + 1]: 300,
      [CREDIT_MEMO_HEADERS.indexOf('LinkedTransactionsJSON') + 1]: 300,
      [CREDIT_MEMO_HEADERS.indexOf('RawJSON') + 1]: 300
    },


    numberFormats: {
      [CREDIT_MEMO_HEADERS.indexOf('TxnDate') + 1]: 'yyyy-mm-dd',
      [CREDIT_MEMO_HEADERS.indexOf('ShipDate') + 1]: 'yyyy-mm-dd',
      [CREDIT_MEMO_HEADERS.indexOf('ExchangeRate') + 1]: '0.000000',
      [CREDIT_MEMO_HEADERS.indexOf('Subtotal') + 1]: '$#,##0.00',
      [CREDIT_MEMO_HEADERS.indexOf('DiscountTotal') + 1]: '$#,##0.00',
      [CREDIT_MEMO_HEADERS.indexOf('TotalTax') + 1]: '$#,##0.00',
      [CREDIT_MEMO_HEADERS.indexOf('TotalAmount') + 1]: '$#,##0.00',
      [CREDIT_MEMO_HEADERS.indexOf('RemainingCredit') + 1]: '$#,##0.00',
      [CREDIT_MEMO_HEADERS.indexOf('HomeTotalAmount') + 1]: '$#,##0.00',
      [CREDIT_MEMO_HEADERS.indexOf('HomeRemainingCredit') + 1]: '$#,##0.00'
    },

    logMessage: `Exported ${creditMemoRows.length} QBO credit memos.`
  });

  // Credit Memo Lines
  const creditMemoLineRows = buildCreditMemoLineRows_(creditMemos);

  writeExport_({
    sheetName: 'QBO_CreditMemoLines',
    headers: CREDIT_MEMO_LINE_HEADERS,
    rows: creditMemoLineRows,

    columnWidths: {
      [CREDIT_MEMO_LINE_HEADERS.indexOf('CreditMemoDocNumber') + 1]: 140,
      [CREDIT_MEMO_LINE_HEADERS.indexOf('CustomerName') + 1]: 240,
      [CREDIT_MEMO_LINE_HEADERS.indexOf('Description') + 1]: 300,
      [CREDIT_MEMO_LINE_HEADERS.indexOf('ItemName') + 1]: 240,
      [CREDIT_MEMO_LINE_HEADERS.indexOf('LinkedOtherTransactionsJSON') + 1]: 300,
      [CREDIT_MEMO_LINE_HEADERS.indexOf('LinkedTransactionsJSON') + 1]: 300,
      [CREDIT_MEMO_LINE_HEADERS.indexOf('RawJSON') + 1]: 300
    },


    numberFormats: {
      [CREDIT_MEMO_LINE_HEADERS.indexOf('CreditMemoTxnDate') + 1]: 'yyyy-mm-dd',
      [CREDIT_MEMO_LINE_HEADERS.indexOf('Amount') + 1]: '$#,##0.00',
      [CREDIT_MEMO_LINE_HEADERS.indexOf('Quantity') + 1]: '0.00',
      [CREDIT_MEMO_LINE_HEADERS.indexOf('UnitPrice') + 1]: '$#,##0.00',
      [CREDIT_MEMO_LINE_HEADERS.indexOf('RatePercent') + 1]: '0.00',
      [CREDIT_MEMO_LINE_HEADERS.indexOf('DiscountPercent') + 1]: '0.00'
    },

    logMessage: `Exported ${creditMemoLineRows.length} QBO credit memo line rows.`
  });

  safeLog_('Completed QBO credit memos export.');

  return {
    creditMemoCount: creditMemoRows.length,
    creditMemoLineCount: creditMemoLineRows.length
  };
}

/**
 * Builds rows for QBO_CreditMemos.
 *
 * @param {Object[]} creditMemos QBO CreditMemo objects.
 * @return {Array[]} Rows matching CREDIT_MEMO_HEADERS.
 */
function buildCreditMemoRows_(creditMemos) {

  return creditMemos.map(creditMemo => {
    const meta = extractMeta_(creditMemo);

    const lines = normalizeArray_(creditMemo.Line);

    const totals = calculateCreditMemoLineTotals_(lines);

    const taxLines = normalizeArray_(
      nestedValue_(creditMemo, 'TxnTaxDetail.TaxLine')
    );

    const deliveryInfo = creditMemo.DeliveryInfo || {};

    const linked = summarizeLinkedTransactions_(creditMemo.LinkedTxn);

    return [
      // Identity
      valueOrBlank_(creditMemo.Id),
      valueOrBlank_(creditMemo.SyncToken),
      valueOrBlank_(creditMemo.DocNumber),

      // Dates
      valueOrBlank_(creditMemo.TxnDate),
      valueOrBlank_(creditMemo.ShipDate),

      // Customer
      nestedValue_(creditMemo, 'CustomerRef.value'),
      nestedValue_(creditMemo, 'CustomerRef.name'),
      nestedValue_(creditMemo, 'CustomerMemo.value'),

      // Classification
      nestedValue_(creditMemo, 'ClassRef.value'),
      nestedValue_(creditMemo, 'ClassRef.name'),
      nestedValue_(creditMemo, 'DepartmentRef.value'),
      nestedValue_(creditMemo, 'DepartmentRef.name'),

      // Accounts
      nestedValue_(creditMemo, 'ARAccountRef.value'),
      nestedValue_(creditMemo, 'ARAccountRef.name'),

      // Currency
      nestedValue_(creditMemo, 'CurrencyRef.value'),
      nestedValue_(creditMemo, 'CurrencyRef.name'),
      numberOrBlank_(creditMemo.ExchangeRate),

      // Billing Contact
      nestedValue_(creditMemo, 'BillEmail.Address'),
      nestedValue_(creditMemo, 'BillEmailBcc.Address'),
      jsonStringifyCellSafe_(creditMemo.BillEmailBcc),
      nestedValue_(creditMemo, 'BillEmailCc.Address'),
      jsonStringifyCellSafe_(creditMemo.BillEmailCc),
      booleanOrBlank_(creditMemo.FreeFormAddress),

      // Billing Address
      nestedValue_(creditMemo, 'BillAddr.Id'),
      nestedValue_(creditMemo, 'BillAddr.Line1'),
      nestedValue_(creditMemo, 'BillAddr.Line2'),
      nestedValue_(creditMemo, 'BillAddr.Line3'),
      nestedValue_(creditMemo, 'BillAddr.Line4'),
      nestedValue_(creditMemo, 'BillAddr.Line5'),
      nestedValue_(creditMemo, 'BillAddr.City'),
      nestedValue_(creditMemo, 'BillAddr.CountrySubDivisionCode'),
      nestedValue_(creditMemo, 'BillAddr.PostalCode'),
      nestedValue_(creditMemo, 'BillAddr.Country'),

      // Shipping Address
      nestedValue_(creditMemo, 'ShipAddr.Id'),
      nestedValue_(creditMemo, 'ShipAddr.Line1'),
      nestedValue_(creditMemo, 'ShipAddr.Line2'),
      nestedValue_(creditMemo, 'ShipAddr.Line3'),
      nestedValue_(creditMemo, 'ShipAddr.Line4'),
      nestedValue_(creditMemo, 'ShipAddr.Line5'),
      nestedValue_(creditMemo, 'ShipAddr.City'),
      nestedValue_(creditMemo, 'ShipAddr.CountrySubDivisionCode'),
      nestedValue_(creditMemo, 'ShipAddr.PostalCode'),
      nestedValue_(creditMemo, 'ShipAddr.Country'),

      // Ship From Address
      nestedValue_(creditMemo, 'ShipFromAddr.Id'),
      nestedValue_(creditMemo, 'ShipFromAddr.Line1'),
      nestedValue_(creditMemo, 'ShipFromAddr.Line2'),
      nestedValue_(creditMemo, 'ShipFromAddr.Line3'),
      nestedValue_(creditMemo, 'ShipFromAddr.Line4'),
      nestedValue_(creditMemo, 'ShipFromAddr.Line5'),
      nestedValue_(creditMemo, 'ShipFromAddr.City'),
      nestedValue_(creditMemo, 'ShipFromAddr.CountrySubDivisionCode'),
      nestedValue_(creditMemo, 'ShipFromAddr.PostalCode'),
      nestedValue_(creditMemo, 'ShipFromAddr.Country'),
      jsonStringifyCellSafe_(creditMemo.ShipFromAddr),

      // Shipping
      valueOrBlank_(creditMemo.TrackingNum),

      // Delivery Status
      valueOrBlank_(creditMemo.PrintStatus),
      valueOrBlank_(creditMemo.EmailStatus),
      valueOrBlank_(deliveryInfo.DeliveryType),
      valueOrBlank_(deliveryInfo.DeliveryTime),
      jsonStringifyCellSafe_(creditMemo.DeliveryInfo),

      // Amounts
      totals.subtotal,
      totals.discountTotal,
      nestedNumberOrBlank_(creditMemo, 'TxnTaxDetail.TotalTax'),
      numberOrBlank_(creditMemo.TotalAmt),
      numberOrBlank_(creditMemo.Balance),
      numberOrBlank_(creditMemo.RemainingCredit),
      numberOrBlank_(creditMemo.HomeTotalAmt),
      numberOrBlank_(creditMemo.HomeRemainingCredit),

      // Tax
      nestedValue_(creditMemo, 'TxnTaxDetail.TxnTaxCodeRef.value'),
      nestedValue_(creditMemo, 'TxnTaxDetail.TxnTaxCodeRef.name'),
      booleanOrBlank_(creditMemo.ApplyTaxAfterDiscount),
      taxLines.length,
      jsonStringifyCellSafe_(taxLines),
      jsonStringifyCellSafe_(creditMemo.TxnTaxDetail),
      nestedValue_(creditMemo, 'TaxExemptionRef.value'),
      nestedValue_(creditMemo, 'TaxExemptionRef.name'),
      jsonStringifyCellSafe_(creditMemo.TaxExemptionRef),

      // Recurrence
      nestedValue_(creditMemo, 'RecurDataRef.value'),
      nestedValue_(creditMemo, 'RecurDataRef.name'),
      jsonStringifyCellSafe_(creditMemo.RecurDataRef),

      // Line Summary
      lines.length,

      // Notes
      valueOrBlank_(creditMemo.PrivateNote),

      // Related Data
      jsonStringifyCellSafe_(creditMemo.CustomField),

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
      jsonStringifyCellSafe_(creditMemo.LinkedTxn),

      // Audit
      valueOrBlank_(meta.createTime),
      valueOrBlank_(meta.lastUpdatedTime),

      // Source
      jsonStringifyCellSafe_(creditMemo)
    ];
  });
}

/**
 * Builds rows for QBO_CreditMemoLines.
 *
 * Group lines and their nested component lines are exported separately.
 *
 * @param {Object[]} creditMemos QBO CreditMemo objects.
 * @return {Array[]} Rows matching CREDIT_MEMO_LINE_HEADERS.
 */
function buildCreditMemoLineRows_(creditMemos) {

  const rows = [];

  creditMemos.forEach(creditMemo => {
    const lines = normalizeArray_(creditMemo.Line);

    lines.forEach((line, index) => {
      appendCreditMemoLineRow_(
        rows,
        creditMemo,
        line,
        index + 1,
        0,
        '',
        ''
      );
    });
  });

  return rows;
}

/**
 * Appends a Credit Memo line and any nested group component lines.
 *
 * @param {Array[]} rows Destination row array.
 * @param {Object} creditMemo Parent CreditMemo object.
 * @param {Object} line Credit Memo line object.
 * @param {number} fallbackLineNumber Array position.
 * @param {number} lineLevel Zero for top-level lines.
 * @param {*} parentLineId Parent group line ID.
 * @param {*} parentLineNumber Parent group line number.
 */
function appendCreditMemoLineRow_(
  rows,
  creditMemo,
  line,
  fallbackLineNumber,
  lineLevel,
  parentLineId,
  parentLineNumber
) {

  const detailType = valueOrBlank_(line.DetailType);

  const detail = detailType && line[detailType]
    ? line[detailType]
    : {};

  const suppliedLineNumber = valueOrBlank_(line.LineNum);

  const lineNumber = suppliedLineNumber !== ''
    ? suppliedLineNumber
    : fallbackLineNumber;

  const groupLines = detailType === 'GroupLineDetail'
    ? normalizeArray_(detail.Line)
    : [];

  const linked = summarizeLinkedTransactions_(line.LinkedTxn);

  rows.push([
    // Parent Credit Memo
    valueOrBlank_(creditMemo.Id),
    valueOrBlank_(creditMemo.DocNumber),
    valueOrBlank_(creditMemo.TxnDate),

    // Customer
    nestedValue_(creditMemo, 'CustomerRef.value'),
    nestedValue_(creditMemo, 'CustomerRef.name'),

    // Line Identity
    valueOrBlank_(line.Id),
    lineNumber,
    lineLevel,
    valueOrBlank_(parentLineId),
    valueOrBlank_(parentLineNumber),
    detailType,

    // General Line Fields
    valueOrBlank_(line.Description),
    numberOrBlank_(line.Amount),

    // Sales Item Detail
    nestedValue_(detail, 'ItemRef.value'),
    nestedValue_(detail, 'ItemRef.name'),
    nestedValue_(detail, 'ItemAccountRef.value'),
    nestedValue_(detail, 'ItemAccountRef.name'),
    nestedValue_(detail, 'TaxClassificationRef.value'),
    nestedValue_(detail, 'TaxClassificationRef.name'),
    numberOrBlank_(detail.Qty),
    numberOrBlank_(detail.UnitPrice),
    numberOrBlank_(detail.RatePercent),
    valueOrBlank_(detail.ServiceDate),

    // Classification
    nestedValue_(detail, 'ClassRef.value'),
    nestedValue_(detail, 'ClassRef.name'),

    // Tax
    nestedValue_(detail, 'TaxCodeRef.value'),
    nestedValue_(detail, 'TaxCodeRef.name'),

    // Discount Detail
    numberOrBlank_(detail.DiscountPercent),
    nestedValue_(detail, 'DiscountAccountRef.value'),
    nestedValue_(detail, 'DiscountAccountRef.name'),

    // Group Detail
    nestedValue_(detail, 'GroupItemRef.value'),
    nestedValue_(detail, 'GroupItemRef.name'),
    groupLines.length,

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

  groupLines.forEach((childLine, childIndex) => {
    appendCreditMemoLineRow_(
      rows,
      creditMemo,
      childLine,
      childIndex + 1,
      lineLevel + 1,
      valueOrBlank_(line.Id),
      lineNumber
    );
  });
}

/**
 * Calculates useful totals from Credit Memo lines.
 *
 * @param {Object[]} lines Credit Memo line objects.
 * @return {Object} Subtotal and discount total.
 */
function calculateCreditMemoLineTotals_(lines) {

  let subtotal = '';
  let discountTotal = 0;
  let hasDiscount = false;

  lines.forEach(line => {
    if (line.DetailType === 'SubTotalLineDetail') {
      subtotal = numberOrBlank_(line.Amount);
    }

    if (line.DetailType === 'DiscountLineDetail') {
      const amount = Number(line.Amount);

      if (Number.isFinite(amount)) {
        discountTotal += Math.abs(amount);
        hasDiscount = true;
      }
    }
  });

  return {
    subtotal: subtotal,
    discountTotal: hasDiscount ? discountTotal : ''
  };
}
