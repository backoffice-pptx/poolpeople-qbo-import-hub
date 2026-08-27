/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 49_QBO_SalesReceipts.js
 * Purpose     : Export QBO Sales Receipts and sales-receipt lines to structured Google Sheets tables.
 *
 * Public API:
 *   - exportQboSalesReceipts()
 *
 * Internal Helpers:
 *   - buildSalesReceiptRows_()
 *   - buildSalesReceiptLineRows_()
 *   - appendSalesReceiptLineRow_()
 *   - calculateSalesReceiptLineTotals_()
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
 * 49_QBO_SalesReceipts.gs
 * QBO Sales Receipt export
 *
 * Output Sheets:
 *   QBO_SalesReceipts
 *   QBO_SalesReceiptLines
 *
 * Public Functions:
 *   exportQboSalesReceipts()
 ***********************/

/**
 * Sales Receipt parent export columns.
 */
const SALES_RECEIPT_HEADERS = [
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

  // Payment and Deposit
  'PaymentMethodId',
  'PaymentMethodName',
  'PaymentReferenceNumber',
  'DepositToAccountId',
  'DepositToAccountName',

  // Currency
  'CurrencyCode',
  'CurrencyName',
  'ExchangeRate',

  // Billing Contact
  'BillEmail',

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

  // Shipping
  'TrackingNumber',

  // Status
  'PrintStatus',
  'EmailStatus',

  // Amounts
  'Subtotal',
  'DiscountTotal',
  'TotalTax',
  'TotalAmount',
  'HomeTotalAmount',

  // Tax
  'TransactionTaxCodeId',
  'TransactionTaxCodeName',
  'ApplyTaxAfterDiscount',
  'TaxLineCount',
  'TaxLinesJSON',
  'TransactionTaxDetailJSON',

  // Delivery
  'DeliveryType',
  'DeliveryTime',
  'DeliveryInfoJSON',

  // Payment Detail
  'CreditCardPaymentJSON',

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
 * Sales Receipt line export columns.
 */
const SALES_RECEIPT_LINE_HEADERS = [
  // Parent Sales Receipt
  'SalesReceiptId',
  'SalesReceiptDocNumber',
  'SalesReceiptTxnDate',

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
 * Exports all QBO Sales Receipts and their line details.
 *
 * Output sheets:
 *   QBO_SalesReceipts
 *   QBO_SalesReceiptLines
 *
 * @return {Object} Export row counts.
 */
function exportQboSalesReceipts() {

  safeLog_('Starting QBO sales receipts export.');

  const salesReceipts = qboQueryAllGeneric_(
    'SELECT * FROM SalesReceipt',
    'SalesReceipt'
  );

  safeLog_(
    `Retrieved ${salesReceipts.length} QBO sales receipts.`
  );

  // Parent Sales Receipts
  const salesReceiptRows =
    buildSalesReceiptRows_(salesReceipts);

  writeExport_({
    sheetName: 'QBO_SalesReceipts',
    headers: SALES_RECEIPT_HEADERS,
    rows: salesReceiptRows,
    autoResize: false,

    columnWidths: {
      [SALES_RECEIPT_HEADERS.indexOf('DocNumber') + 1]: 120,
      [SALES_RECEIPT_HEADERS.indexOf('CustomerName') + 1]: 240,
      [SALES_RECEIPT_HEADERS.indexOf('CustomerMemo') + 1]: 300,
      [SALES_RECEIPT_HEADERS.indexOf('PaymentMethodName') + 1]: 180,
      [SALES_RECEIPT_HEADERS.indexOf('DepositToAccountName') + 1]: 220,
      [SALES_RECEIPT_HEADERS.indexOf('BillEmail') + 1]: 240,
      [SALES_RECEIPT_HEADERS.indexOf('BillAddrLine1') + 1]: 240,
      [SALES_RECEIPT_HEADERS.indexOf('ShipAddrLine1') + 1]: 240,
      [SALES_RECEIPT_HEADERS.indexOf('TaxLinesJSON') + 1]: 300,
      [SALES_RECEIPT_HEADERS.indexOf('TransactionTaxDetailJSON') + 1]: 300,
      [SALES_RECEIPT_HEADERS.indexOf('DeliveryInfoJSON') + 1]: 300,
      [SALES_RECEIPT_HEADERS.indexOf('CreditCardPaymentJSON') + 1]: 300,
      [SALES_RECEIPT_HEADERS.indexOf('PrivateNote') + 1]: 300,
      [SALES_RECEIPT_HEADERS.indexOf('CustomFieldsJSON') + 1]: 300,
      [SALES_RECEIPT_HEADERS.indexOf('LinkedOtherTransactionsJSON') + 1]: 300,
      [SALES_RECEIPT_HEADERS.indexOf('LinkedTransactionsJSON') + 1]: 300,
      [SALES_RECEIPT_HEADERS.indexOf('RawJSON') + 1]: 300
    },


    numberFormats: {
      [SALES_RECEIPT_HEADERS.indexOf('TxnDate') + 1]: 'yyyy-mm-dd',
      [SALES_RECEIPT_HEADERS.indexOf('ShipDate') + 1]: 'yyyy-mm-dd',
      [SALES_RECEIPT_HEADERS.indexOf('ExchangeRate') + 1]: '0.000000',
      [SALES_RECEIPT_HEADERS.indexOf('Subtotal') + 1]: '$#,##0.00',
      [SALES_RECEIPT_HEADERS.indexOf('DiscountTotal') + 1]: '$#,##0.00',
      [SALES_RECEIPT_HEADERS.indexOf('TotalTax') + 1]: '$#,##0.00',
      [SALES_RECEIPT_HEADERS.indexOf('TotalAmount') + 1]: '$#,##0.00',
      [SALES_RECEIPT_HEADERS.indexOf('HomeTotalAmount') + 1]: '$#,##0.00'
    },

    logMessage:
      `Exported ${salesReceiptRows.length} QBO sales receipts.`
  });

  // Sales Receipt Lines
  const salesReceiptLineRows =
    buildSalesReceiptLineRows_(salesReceipts);

  writeExport_({
    sheetName: 'QBO_SalesReceiptLines',
    headers: SALES_RECEIPT_LINE_HEADERS,
    rows: salesReceiptLineRows,
    autoResize: false,

    columnWidths: {
      [SALES_RECEIPT_LINE_HEADERS.indexOf('SalesReceiptDocNumber') + 1]: 140,
      [SALES_RECEIPT_LINE_HEADERS.indexOf('CustomerName') + 1]: 240,
      [SALES_RECEIPT_LINE_HEADERS.indexOf('Description') + 1]: 300,
      [SALES_RECEIPT_LINE_HEADERS.indexOf('ItemName') + 1]: 240,
      [SALES_RECEIPT_LINE_HEADERS.indexOf('LinkedOtherTransactionsJSON') + 1]: 300,
      [SALES_RECEIPT_LINE_HEADERS.indexOf('LinkedTransactionsJSON') + 1]: 300,
      [SALES_RECEIPT_LINE_HEADERS.indexOf('RawJSON') + 1]: 300
    },


    numberFormats: {
      [SALES_RECEIPT_LINE_HEADERS.indexOf('SalesReceiptTxnDate') + 1]: 'yyyy-mm-dd',
      [SALES_RECEIPT_LINE_HEADERS.indexOf('Amount') + 1]: '$#,##0.00',
      [SALES_RECEIPT_LINE_HEADERS.indexOf('Quantity') + 1]: '0.00',
      [SALES_RECEIPT_LINE_HEADERS.indexOf('UnitPrice') + 1]: '$#,##0.00',
      [SALES_RECEIPT_LINE_HEADERS.indexOf('RatePercent') + 1]: '0.00',
      [SALES_RECEIPT_LINE_HEADERS.indexOf('DiscountPercent') + 1]: '0.00'
    },

    logMessage:
      `Exported ${salesReceiptLineRows.length} QBO sales receipt line rows.`
  });

  safeLog_('Completed QBO sales receipts export.');

  return {
    salesReceiptCount: salesReceiptRows.length,
    salesReceiptLineCount: salesReceiptLineRows.length
  };
}

/**
 * Builds rows for QBO_SalesReceipts.
 *
 * @param {Object[]} salesReceipts QBO SalesReceipt objects.
 * @return {Array[]} Rows matching SALES_RECEIPT_HEADERS.
 */
function buildSalesReceiptRows_(salesReceipts) {

  return salesReceipts.map(salesReceipt => {
    const meta = extractMeta_(salesReceipt);

    const lines =
      normalizeArray_(salesReceipt.Line);

    const totals =
      calculateSalesReceiptLineTotals_(lines);

    const taxLines =
      normalizeArray_(
        nestedValue_(
          salesReceipt,
          'TxnTaxDetail.TaxLine'
        )
      );

    const deliveryInfo =
      salesReceipt.DeliveryInfo || {};

    const linkedTransactions =
      normalizeArray_(salesReceipt.LinkedTxn);

    const linked =
      summarizeLinkedTransactions_(
        linkedTransactions
      );

    return [
      // Identity
      valueOrBlank_(salesReceipt.Id),
      valueOrBlank_(salesReceipt.SyncToken),
      valueOrBlank_(salesReceipt.DocNumber),

      // Dates
      valueOrBlank_(salesReceipt.TxnDate),
      valueOrBlank_(salesReceipt.ShipDate),

      // Customer
      nestedValue_(salesReceipt, 'CustomerRef.value'),
      nestedValue_(salesReceipt, 'CustomerRef.name'),
      nestedValue_(salesReceipt, 'CustomerMemo.value'),

      // Classification
      nestedValue_(salesReceipt, 'ClassRef.value'),
      nestedValue_(salesReceipt, 'ClassRef.name'),
      nestedValue_(salesReceipt, 'DepartmentRef.value'),
      nestedValue_(salesReceipt, 'DepartmentRef.name'),

      // Payment and Deposit
      nestedValue_(salesReceipt, 'PaymentMethodRef.value'),
      nestedValue_(salesReceipt, 'PaymentMethodRef.name'),
      valueOrBlank_(salesReceipt.PaymentRefNum),
      nestedValue_(salesReceipt, 'DepositToAccountRef.value'),
      nestedValue_(salesReceipt, 'DepositToAccountRef.name'),

      // Currency
      nestedValue_(salesReceipt, 'CurrencyRef.value'),
      nestedValue_(salesReceipt, 'CurrencyRef.name'),
      numberOrBlank_(salesReceipt.ExchangeRate),

      // Billing Contact
      nestedValue_(salesReceipt, 'BillEmail.Address'),

      // Billing Address
      nestedValue_(salesReceipt, 'BillAddr.Id'),
      nestedValue_(salesReceipt, 'BillAddr.Line1'),
      nestedValue_(salesReceipt, 'BillAddr.Line2'),
      nestedValue_(salesReceipt, 'BillAddr.Line3'),
      nestedValue_(salesReceipt, 'BillAddr.Line4'),
      nestedValue_(salesReceipt, 'BillAddr.Line5'),
      nestedValue_(salesReceipt, 'BillAddr.City'),
      nestedValue_(salesReceipt, 'BillAddr.CountrySubDivisionCode'),
      nestedValue_(salesReceipt, 'BillAddr.PostalCode'),
      nestedValue_(salesReceipt, 'BillAddr.Country'),

      // Shipping Address
      nestedValue_(salesReceipt, 'ShipAddr.Id'),
      nestedValue_(salesReceipt, 'ShipAddr.Line1'),
      nestedValue_(salesReceipt, 'ShipAddr.Line2'),
      nestedValue_(salesReceipt, 'ShipAddr.Line3'),
      nestedValue_(salesReceipt, 'ShipAddr.Line4'),
      nestedValue_(salesReceipt, 'ShipAddr.Line5'),
      nestedValue_(salesReceipt, 'ShipAddr.City'),
      nestedValue_(salesReceipt, 'ShipAddr.CountrySubDivisionCode'),
      nestedValue_(salesReceipt, 'ShipAddr.PostalCode'),
      nestedValue_(salesReceipt, 'ShipAddr.Country'),

      // Shipping
      valueOrBlank_(salesReceipt.TrackingNum),

      // Status
      valueOrBlank_(salesReceipt.PrintStatus),
      valueOrBlank_(salesReceipt.EmailStatus),

      // Amounts
      totals.subtotal,
      totals.discountTotal,
      nestedNumberOrBlank_(
        salesReceipt,
        'TxnTaxDetail.TotalTax'
      ),
      numberOrBlank_(salesReceipt.TotalAmt),
      numberOrBlank_(salesReceipt.HomeTotalAmt),

      // Tax
      nestedValue_(
        salesReceipt,
        'TxnTaxDetail.TxnTaxCodeRef.value'
      ),
      nestedValue_(
        salesReceipt,
        'TxnTaxDetail.TxnTaxCodeRef.name'
      ),
      booleanOrBlank_(salesReceipt.ApplyTaxAfterDiscount),
      taxLines.length,
      jsonStringifyCellSafe_(taxLines),
      jsonStringifyCellSafe_(salesReceipt.TxnTaxDetail),

      // Delivery
      valueOrBlank_(deliveryInfo.DeliveryType),
      valueOrBlank_(deliveryInfo.DeliveryTime),
      jsonStringifyCellSafe_(salesReceipt.DeliveryInfo),

      // Payment Detail
      jsonStringifyCellSafe_(salesReceipt.CreditCardPayment),

      // Line Summary
      lines.length,

      // Notes
      valueOrBlank_(salesReceipt.PrivateNote),

      // Related Data
      jsonStringifyCellSafe_(salesReceipt.CustomField),

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
      jsonStringifyCellSafe_(linkedTransactions),

      // Audit
      valueOrBlank_(meta.createTime),
      valueOrBlank_(meta.lastUpdatedTime),

      // Source
      jsonStringifyCellSafe_(salesReceipt)
    ];
  });
}

/**
 * Builds rows for QBO_SalesReceiptLines.
 *
 * Group lines and their nested component lines are exported separately.
 *
 * @param {Object[]} salesReceipts QBO SalesReceipt objects.
 * @return {Array[]} Rows matching SALES_RECEIPT_LINE_HEADERS.
 */
function buildSalesReceiptLineRows_(salesReceipts) {

  const rows = [];

  salesReceipts.forEach(salesReceipt => {
    const lines =
      normalizeArray_(salesReceipt.Line);

    lines.forEach((line, index) => {
      appendSalesReceiptLineRow_(
        rows,
        salesReceipt,
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
 * Appends a Sales Receipt line and any nested group component lines.
 *
 * @param {Array[]} rows Destination row array.
 * @param {Object} salesReceipt Parent SalesReceipt object.
 * @param {Object} line Sales Receipt line object.
 * @param {number} fallbackLineNumber Array position.
 * @param {number} lineLevel Zero for top-level lines.
 * @param {*} parentLineId Parent group line ID.
 * @param {*} parentLineNumber Parent group line number.
 */
function appendSalesReceiptLineRow_(
  rows,
  salesReceipt,
  line,
  fallbackLineNumber,
  lineLevel,
  parentLineId,
  parentLineNumber
) {

  const detailType =
    valueOrBlank_(line.DetailType);

  const detail =
    detailType && line[detailType]
      ? line[detailType]
      : {};

  const suppliedLineNumber =
    valueOrBlank_(line.LineNum);

  const lineNumber =
    suppliedLineNumber !== ''
      ? suppliedLineNumber
      : fallbackLineNumber;

  const groupLines =
    detailType === 'GroupLineDetail'
      ? normalizeArray_(detail.Line)
      : [];

  const linkedTransactions =
    normalizeArray_(line.LinkedTxn);

  const linked =
    summarizeLinkedTransactions_(
      linkedTransactions
    );

  rows.push([
    // Parent Sales Receipt
    valueOrBlank_(salesReceipt.Id),
    valueOrBlank_(salesReceipt.DocNumber),
    valueOrBlank_(salesReceipt.TxnDate),

    // Customer
    nestedValue_(salesReceipt, 'CustomerRef.value'),
    nestedValue_(salesReceipt, 'CustomerRef.name'),

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
    jsonStringifyCellSafe_(linkedTransactions),

    // Source
    jsonStringifyCellSafe_(line)
  ]);

  groupLines.forEach((childLine, childIndex) => {
    appendSalesReceiptLineRow_(
      rows,
      salesReceipt,
      childLine,
      childIndex + 1,
      lineLevel + 1,
      valueOrBlank_(line.Id),
      lineNumber
    );
  });
}

/**
 * Calculates useful totals from Sales Receipt lines.
 *
 * @param {Object[]} lines Sales Receipt line objects.
 * @return {Object} Subtotal and discount total.
 */
function calculateSalesReceiptLineTotals_(lines) {

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
