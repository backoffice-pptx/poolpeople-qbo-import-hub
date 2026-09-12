/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 51_QBO_RefundReceipts.js
 * Purpose     : Export QBO Refund Receipts and refund-receipt lines to structured Google Sheets tables.
 *
 * Public API:
 *   - exportQboRefundReceipts()
 *
 * Internal Helpers:
 *   - buildRefundReceiptRows_()
 *   - buildRefundReceiptLineRows_()
 *   - appendRefundReceiptLineRow_()
 *   - calculateRefundReceiptLineTotals_()
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
 *   - 2026-08-20: Added Refund Receipt parent and line export for sales-tax
 *     recognition and general QBO transaction coverage.
 * ============================================================================
 */


/***********************
 * 51_QBO_RefundReceipts.gs
 * QBO Refund Receipt export
 *
 * Output Sheets:
 *   QBO_RefundReceipts
 *   QBO_RefundReceiptLines
 *
 * Public Functions:
 *   exportQboRefundReceipts()
 ***********************/

/**
 * Refund Receipt parent export columns.
 */
const REFUND_RECEIPT_HEADERS = [
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

  // Ship-From Address
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
  'TaxExemptionRefId',
  'TaxExemptionRefName',
  'TaxExemptionRefJSON',

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
  'LinkedRefundReceiptCount',
  'LinkedRefundReceiptIds',
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
 * Refund Receipt line export columns.
 */
const REFUND_RECEIPT_LINE_HEADERS = [
  // Parent Refund Receipt
  'RefundReceiptId',
  'RefundReceiptDocNumber',
  'RefundReceiptTxnDate',

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
  'LinkedRefundReceiptCount',
  'LinkedRefundReceiptIds',
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
 * Exports all QBO Refund Receipts and their line details.
 *
 * Output sheets:
 *   QBO_RefundReceipts
 *   QBO_RefundReceiptLines
 *
 * @return {Object} Export row counts.
 */
function exportQboRefundReceipts() {

  safeLog_('Starting QBO refund receipts export.');

  const refundReceipts = qboQueryAllGeneric_(
    'SELECT * FROM RefundReceipt',
    'RefundReceipt'
  );

  safeLog_(
    `Retrieved ${refundReceipts.length} QBO refund receipts.`
  );

  // Parent Refund Receipts
  const refundReceiptRows =
    buildRefundReceiptRows_(refundReceipts);

  writeExport_({
    sheetName: 'QBO_RefundReceipts',
    headers: REFUND_RECEIPT_HEADERS,
    rows: refundReceiptRows,
    autoResize: false,

    columnWidths: {
      [REFUND_RECEIPT_HEADERS.indexOf('DocNumber') + 1]: 120,
      [REFUND_RECEIPT_HEADERS.indexOf('CustomerName') + 1]: 240,
      [REFUND_RECEIPT_HEADERS.indexOf('CustomerMemo') + 1]: 300,
      [REFUND_RECEIPT_HEADERS.indexOf('PaymentMethodName') + 1]: 180,
      [REFUND_RECEIPT_HEADERS.indexOf('DepositToAccountName') + 1]: 220,
      [REFUND_RECEIPT_HEADERS.indexOf('BillEmail') + 1]: 240,
      [REFUND_RECEIPT_HEADERS.indexOf('BillAddrLine1') + 1]: 240,
      [REFUND_RECEIPT_HEADERS.indexOf('ShipAddrLine1') + 1]: 240,
      [REFUND_RECEIPT_HEADERS.indexOf('TaxLinesJSON') + 1]: 300,
      [REFUND_RECEIPT_HEADERS.indexOf('TransactionTaxDetailJSON') + 1]: 300,
      [REFUND_RECEIPT_HEADERS.indexOf('DeliveryInfoJSON') + 1]: 300,
      [REFUND_RECEIPT_HEADERS.indexOf('CreditCardPaymentJSON') + 1]: 300,
      [REFUND_RECEIPT_HEADERS.indexOf('PrivateNote') + 1]: 300,
      [REFUND_RECEIPT_HEADERS.indexOf('CustomFieldsJSON') + 1]: 300,
      [REFUND_RECEIPT_HEADERS.indexOf('LinkedOtherTransactionsJSON') + 1]: 300,
      [REFUND_RECEIPT_HEADERS.indexOf('LinkedTransactionsJSON') + 1]: 300,
      [REFUND_RECEIPT_HEADERS.indexOf('RawJSON') + 1]: 300
    },


    numberFormats: {
      [REFUND_RECEIPT_HEADERS.indexOf('TxnDate') + 1]: 'yyyy-mm-dd',
      [REFUND_RECEIPT_HEADERS.indexOf('ShipDate') + 1]: 'yyyy-mm-dd',
      [REFUND_RECEIPT_HEADERS.indexOf('ExchangeRate') + 1]: '0.000000',
      [REFUND_RECEIPT_HEADERS.indexOf('Subtotal') + 1]: '$#,##0.00',
      [REFUND_RECEIPT_HEADERS.indexOf('DiscountTotal') + 1]: '$#,##0.00',
      [REFUND_RECEIPT_HEADERS.indexOf('TotalTax') + 1]: '$#,##0.00',
      [REFUND_RECEIPT_HEADERS.indexOf('TotalAmount') + 1]: '$#,##0.00',
      [REFUND_RECEIPT_HEADERS.indexOf('HomeTotalAmount') + 1]: '$#,##0.00'
    },

    logMessage:
      `Exported ${refundReceiptRows.length} QBO refund receipts.`
  });

  // Refund Receipt Lines
  const refundReceiptLineRows =
    buildRefundReceiptLineRows_(refundReceipts);

  writeExport_({
    sheetName: 'QBO_RefundReceiptLines',
    headers: REFUND_RECEIPT_LINE_HEADERS,
    rows: refundReceiptLineRows,
    autoResize: false,

    columnWidths: {
      [REFUND_RECEIPT_LINE_HEADERS.indexOf('RefundReceiptDocNumber') + 1]: 140,
      [REFUND_RECEIPT_LINE_HEADERS.indexOf('CustomerName') + 1]: 240,
      [REFUND_RECEIPT_LINE_HEADERS.indexOf('Description') + 1]: 300,
      [REFUND_RECEIPT_LINE_HEADERS.indexOf('ItemName') + 1]: 240,
      [REFUND_RECEIPT_LINE_HEADERS.indexOf('LinkedOtherTransactionsJSON') + 1]: 300,
      [REFUND_RECEIPT_LINE_HEADERS.indexOf('LinkedTransactionsJSON') + 1]: 300,
      [REFUND_RECEIPT_LINE_HEADERS.indexOf('RawJSON') + 1]: 300
    },


    numberFormats: {
      [REFUND_RECEIPT_LINE_HEADERS.indexOf('RefundReceiptTxnDate') + 1]: 'yyyy-mm-dd',
      [REFUND_RECEIPT_LINE_HEADERS.indexOf('Amount') + 1]: '$#,##0.00',
      [REFUND_RECEIPT_LINE_HEADERS.indexOf('Quantity') + 1]: '0.00',
      [REFUND_RECEIPT_LINE_HEADERS.indexOf('UnitPrice') + 1]: '$#,##0.00',
      [REFUND_RECEIPT_LINE_HEADERS.indexOf('RatePercent') + 1]: '0.00',
      [REFUND_RECEIPT_LINE_HEADERS.indexOf('DiscountPercent') + 1]: '0.00'
    },

    logMessage:
      `Exported ${refundReceiptLineRows.length} QBO refund receipt line rows.`
  });

  safeLog_('Completed QBO refund receipts export.');

  return {
    refundReceiptCount: refundReceiptRows.length,
    refundReceiptLineCount: refundReceiptLineRows.length
  };
}

/**
 * Builds rows for QBO_RefundReceipts.
 *
 * @param {Object[]} refundReceipts QBO RefundReceipt objects.
 * @return {Array[]} Rows matching REFUND_RECEIPT_HEADERS.
 */
function buildRefundReceiptRows_(refundReceipts) {

  return refundReceipts.map(refundReceipt => {
    const meta = extractMeta_(refundReceipt);

    const lines =
      normalizeArray_(refundReceipt.Line);

    const totals =
      calculateRefundReceiptLineTotals_(lines);

    const taxLines =
      normalizeArray_(
        nestedValue_(
          refundReceipt,
          'TxnTaxDetail.TaxLine'
        )
      );

    const deliveryInfo =
      refundReceipt.DeliveryInfo || {};

    const linkedTransactions =
      normalizeArray_(refundReceipt.LinkedTxn);

    const linked =
      summarizeLinkedTransactions_(
        linkedTransactions
      );

    return [
      // Identity
      valueOrBlank_(refundReceipt.Id),
      valueOrBlank_(refundReceipt.SyncToken),
      valueOrBlank_(refundReceipt.DocNumber),

      // Dates
      valueOrBlank_(refundReceipt.TxnDate),
      valueOrBlank_(refundReceipt.ShipDate),

      // Customer
      nestedValue_(refundReceipt, 'CustomerRef.value'),
      nestedValue_(refundReceipt, 'CustomerRef.name'),
      nestedValue_(refundReceipt, 'CustomerMemo.value'),

      // Classification
      nestedValue_(refundReceipt, 'ClassRef.value'),
      nestedValue_(refundReceipt, 'ClassRef.name'),
      nestedValue_(refundReceipt, 'DepartmentRef.value'),
      nestedValue_(refundReceipt, 'DepartmentRef.name'),

      // Payment and Deposit
      nestedValue_(refundReceipt, 'PaymentMethodRef.value'),
      nestedValue_(refundReceipt, 'PaymentMethodRef.name'),
      valueOrBlank_(refundReceipt.PaymentRefNum),
      nestedValue_(refundReceipt, 'DepositToAccountRef.value'),
      nestedValue_(refundReceipt, 'DepositToAccountRef.name'),

      // Currency
      nestedValue_(refundReceipt, 'CurrencyRef.value'),
      nestedValue_(refundReceipt, 'CurrencyRef.name'),
      numberOrBlank_(refundReceipt.ExchangeRate),

      // Billing Contact
      nestedValue_(refundReceipt, 'BillEmail.Address'),

      // Billing Address
      nestedValue_(refundReceipt, 'BillAddr.Id'),
      nestedValue_(refundReceipt, 'BillAddr.Line1'),
      nestedValue_(refundReceipt, 'BillAddr.Line2'),
      nestedValue_(refundReceipt, 'BillAddr.Line3'),
      nestedValue_(refundReceipt, 'BillAddr.Line4'),
      nestedValue_(refundReceipt, 'BillAddr.Line5'),
      nestedValue_(refundReceipt, 'BillAddr.City'),
      nestedValue_(refundReceipt, 'BillAddr.CountrySubDivisionCode'),
      nestedValue_(refundReceipt, 'BillAddr.PostalCode'),
      nestedValue_(refundReceipt, 'BillAddr.Country'),

      // Shipping Address
      nestedValue_(refundReceipt, 'ShipAddr.Id'),
      nestedValue_(refundReceipt, 'ShipAddr.Line1'),
      nestedValue_(refundReceipt, 'ShipAddr.Line2'),
      nestedValue_(refundReceipt, 'ShipAddr.Line3'),
      nestedValue_(refundReceipt, 'ShipAddr.Line4'),
      nestedValue_(refundReceipt, 'ShipAddr.Line5'),
      nestedValue_(refundReceipt, 'ShipAddr.City'),
      nestedValue_(refundReceipt, 'ShipAddr.CountrySubDivisionCode'),
      nestedValue_(refundReceipt, 'ShipAddr.PostalCode'),
      nestedValue_(refundReceipt, 'ShipAddr.Country'),

      // Ship-From Address
      nestedValue_(refundReceipt, 'ShipFromAddr.Id'),
      nestedValue_(refundReceipt, 'ShipFromAddr.Line1'),
      nestedValue_(refundReceipt, 'ShipFromAddr.Line2'),
      nestedValue_(refundReceipt, 'ShipFromAddr.Line3'),
      nestedValue_(refundReceipt, 'ShipFromAddr.Line4'),
      nestedValue_(refundReceipt, 'ShipFromAddr.Line5'),
      nestedValue_(refundReceipt, 'ShipFromAddr.City'),
      nestedValue_(refundReceipt, 'ShipFromAddr.CountrySubDivisionCode'),
      nestedValue_(refundReceipt, 'ShipFromAddr.PostalCode'),
      nestedValue_(refundReceipt, 'ShipFromAddr.Country'),
      jsonStringifyCellSafe_(refundReceipt.ShipFromAddr),

      // Shipping
      valueOrBlank_(refundReceipt.TrackingNum),

      // Status
      valueOrBlank_(refundReceipt.PrintStatus),
      valueOrBlank_(refundReceipt.EmailStatus),

      // Amounts
      totals.subtotal,
      totals.discountTotal,
      nestedNumberOrBlank_(
        refundReceipt,
        'TxnTaxDetail.TotalTax'
      ),
      numberOrBlank_(refundReceipt.TotalAmt),
      numberOrBlank_(refundReceipt.HomeTotalAmt),

      // Tax
      nestedValue_(
        refundReceipt,
        'TxnTaxDetail.TxnTaxCodeRef.value'
      ),
      nestedValue_(
        refundReceipt,
        'TxnTaxDetail.TxnTaxCodeRef.name'
      ),
      booleanOrBlank_(refundReceipt.ApplyTaxAfterDiscount),
      taxLines.length,
      jsonStringifyCellSafe_(taxLines),
      jsonStringifyCellSafe_(refundReceipt.TxnTaxDetail),
      nestedValue_(refundReceipt, 'TaxExemptionRef.value'),
      nestedValue_(refundReceipt, 'TaxExemptionRef.name'),
      jsonStringifyCellSafe_(refundReceipt.TaxExemptionRef),

      // Delivery
      valueOrBlank_(deliveryInfo.DeliveryType),
      valueOrBlank_(deliveryInfo.DeliveryTime),
      jsonStringifyCellSafe_(refundReceipt.DeliveryInfo),

      // Payment Detail
      jsonStringifyCellSafe_(refundReceipt.CreditCardPayment),

      // Line Summary
      lines.length,

      // Notes
      valueOrBlank_(refundReceipt.PrivateNote),

      // Related Data
      jsonStringifyCellSafe_(refundReceipt.CustomField),

      // Linked Transactions
      linked.totalCount,
      linked.invoiceCount,
      linked.invoiceIds,
      linked.paymentCount,
      linked.paymentIds,
      linked.refundReceiptCount,
      linked.refundReceiptIds,
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
      jsonStringifyCellSafe_(refundReceipt)
    ];
  });
}

/**
 * Builds rows for QBO_RefundReceiptLines.
 *
 * Group lines and their nested component lines are exported separately.
 *
 * @param {Object[]} refundReceipts QBO RefundReceipt objects.
 * @return {Array[]} Rows matching REFUND_RECEIPT_LINE_HEADERS.
 */
function buildRefundReceiptLineRows_(refundReceipts) {

  const rows = [];

  refundReceipts.forEach(refundReceipt => {
    const lines =
      normalizeArray_(refundReceipt.Line);

    lines.forEach((line, index) => {
      appendRefundReceiptLineRow_(
        rows,
        refundReceipt,
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
 * Appends a Refund Receipt line and any nested group component lines.
 *
 * @param {Array[]} rows Destination row array.
 * @param {Object} refundReceipt Parent RefundReceipt object.
 * @param {Object} line Refund Receipt line object.
 * @param {number} fallbackLineNumber Array position.
 * @param {number} lineLevel Zero for top-level lines.
 * @param {*} parentLineId Parent group line ID.
 * @param {*} parentLineNumber Parent group line number.
 */
function appendRefundReceiptLineRow_(
  rows,
  refundReceipt,
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
    // Parent Refund Receipt
    valueOrBlank_(refundReceipt.Id),
    valueOrBlank_(refundReceipt.DocNumber),
    valueOrBlank_(refundReceipt.TxnDate),

    // Customer
    nestedValue_(refundReceipt, 'CustomerRef.value'),
    nestedValue_(refundReceipt, 'CustomerRef.name'),

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
    linked.refundReceiptCount,
    linked.refundReceiptIds,
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
    appendRefundReceiptLineRow_(
      rows,
      refundReceipt,
      childLine,
      childIndex + 1,
      lineLevel + 1,
      valueOrBlank_(line.Id),
      lineNumber
    );
  });
}

/**
 * Calculates useful totals from Refund Receipt lines.
 *
 * @param {Object[]} lines Refund Receipt line objects.
 * @return {Object} Subtotal and discount total.
 */
function calculateRefundReceiptLineTotals_(lines) {

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
