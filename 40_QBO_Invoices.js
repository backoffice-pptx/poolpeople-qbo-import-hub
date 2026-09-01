/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 40_QBO_Invoices.js
 * Purpose     : Export QBO Invoices and invoice lines to structured Google Sheets tables.
 *
 * Public API:
 *   - exportQboInvoices()
 *
 * Internal Helpers:
 *   - buildInvoiceRows_()
 *   - buildInvoiceLineRows_()
 *   - appendInvoiceLineRow_()
 *   - calculateInvoiceLineTotals_()
 *   - nestedNumberOrBlank_()
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
 *   - 2026-08-27: Added parent/line row-build performance diagnostics for timeout analysis. No export schema changed.
 *   - 2026-07-21: Added standardized module documentation. No runtime behavior
 *     changed.
 * ============================================================================
 */


/***********************
 * 40_QBO_Invoices.gs
 * QBO Invoice export
 *
 * Output Sheets:
 *   QBO_Invoices
 *   QBO_InvoiceLines
 *
 * Public Functions:
 *   exportQboInvoices()
 ***********************/


/**
 * Invoice parent export columns.
 */
const INVOICE_HEADERS = [

  // Identity
  'Id',
  'SyncToken',
  'DocNumber',

  // Dates
  'TxnDate',
  'DueDate',
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

  // Accounts and Terms
  'ARAccountId',
  'ARAccountName',
  'SalesTermId',
  'SalesTermName',

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

  // Online Payment Options
  'AllowOnlineACHPayment',
  'AllowOnlineCreditCardPayment',
  'AllowIPNPayment',
  'AllowOnlinePayment',

  // Amounts
  'Subtotal',
  'DiscountTotal',
  'Deposit',
  'TotalAmount',
  'Balance',

  // Home Currency Amounts
  'HomeTotalAmount',
  'HomeBalance',

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

  // Tax
  'TransactionTaxCodeId',
  'TransactionTaxCodeName',
  'TotalTax',
  'TaxLineCount',
  'TaxLinesJSON',
  'TransactionTaxDetailJSON',
  'ApplyTaxAfterDiscount',

  // Delivery
  'DeliveryType',
  'DeliveryTime',
  'DeliveryInfoJSON',

  // Line Summary
  'LineCount',

  // Notes
  'PrivateNote',

  // Related Data
  'CustomFieldsJSON',

  // Audit
  'CreateTime',
  'LastUpdatedTime',

  // Source
  'RawJSON'
];


/**
 * Invoice line export columns.
 */
const INVOICE_LINE_HEADERS = [

  // Parent Invoice
  'InvoiceId',
  'InvoiceDocNumber',
  'InvoiceTxnDate',
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
 * Exports all QBO Invoices and their line details.
 *
 * Output sheets:
 *   QBO_Invoices
 *   QBO_InvoiceLines
 *
 * @return {Object} Export row counts.
 */
function exportQboInvoices() {

  safeLog_('Starting QBO invoices export.');

  const invoices = qboQueryAllGeneric_(
    'SELECT * FROM Invoice',
    'Invoice'
  );

  safeLog_(`Retrieved ${invoices.length} QBO invoices.`);

  //
  // Parent Invoices
  //
  const parentBuildStartedAt = Date.now();
  const invoiceRows = buildInvoiceRows_(invoices);
  safeLog_(
    `[PERF] Invoice parent row build: ${invoiceRows.length} rows in ` +
    `${Date.now() - parentBuildStartedAt} ms.`
  );

  writeExport_({
  sheetName: 'QBO_Invoices',
  headers: INVOICE_HEADERS,
  rows: invoiceRows,
  autoResize: false,
  columnWidths: {
    [INVOICE_HEADERS.indexOf('DocNumber') + 1]: 120,
    [INVOICE_HEADERS.indexOf('CustomerName') + 1]: 240,
    [INVOICE_HEADERS.indexOf('CustomerMemo') + 1]: 300,
    [INVOICE_HEADERS.indexOf('BillEmail') + 1]: 240,
    [INVOICE_HEADERS.indexOf('BillAddrLine1') + 1]: 240,
    [INVOICE_HEADERS.indexOf('BillAddrLine2') + 1]: 220,
    [INVOICE_HEADERS.indexOf('BillAddrLine3') + 1]: 220,
    [INVOICE_HEADERS.indexOf('BillAddrLine4') + 1]: 220,
    [INVOICE_HEADERS.indexOf('BillAddrLine5') + 1]: 220,
    [INVOICE_HEADERS.indexOf('ShipAddrLine1') + 1]: 240,
    [INVOICE_HEADERS.indexOf('ShipAddrLine2') + 1]: 220,
    [INVOICE_HEADERS.indexOf('ShipAddrLine3') + 1]: 220,
    [INVOICE_HEADERS.indexOf('ShipAddrLine4') + 1]: 220,
    [INVOICE_HEADERS.indexOf('ShipAddrLine5') + 1]: 220,
    [INVOICE_HEADERS.indexOf('LinkedInvoiceIds') + 1]: 180,
    [INVOICE_HEADERS.indexOf('LinkedPaymentIds') + 1]: 180,
    [INVOICE_HEADERS.indexOf('LinkedSalesReceiptIds') + 1]: 180,
    [INVOICE_HEADERS.indexOf('LinkedEstimateIds') + 1]: 180,
    [INVOICE_HEADERS.indexOf('LinkedCreditMemoIds') + 1]: 180,
    [INVOICE_HEADERS.indexOf('LinkedDepositIds') + 1]: 180,
    [INVOICE_HEADERS.indexOf('LinkedBillIds') + 1]: 180,
    [INVOICE_HEADERS.indexOf('LinkedJournalEntryIds') + 1]: 180,
    [INVOICE_HEADERS.indexOf('LinkedPurchaseIds') + 1]: 180,
    [INVOICE_HEADERS.indexOf('LinkedOtherTransactionsJSON') + 1]: 300,
    [INVOICE_HEADERS.indexOf('LinkedTransactionsJSON') + 1]: 300,
    [INVOICE_HEADERS.indexOf('TaxLinesJSON') + 1]: 300,
    [INVOICE_HEADERS.indexOf('TransactionTaxDetailJSON') + 1]: 300,
    [INVOICE_HEADERS.indexOf('DeliveryInfoJSON') + 1]: 300,
    [INVOICE_HEADERS.indexOf('PrivateNote') + 1]: 300,
    [INVOICE_HEADERS.indexOf('CustomFieldsJSON') + 1]: 300,
    [INVOICE_HEADERS.indexOf('RawJSON') + 1]: 300
  },

    logMessage: `Exported ${invoiceRows.length} QBO invoices.`
  });

  //
  // Invoice Lines
  //
  const lineBuildStartedAt = Date.now();
  const invoiceLineRows = buildInvoiceLineRows_(invoices);
  safeLog_(
    `[PERF] Invoice line row build: ${invoiceLineRows.length} rows in ` +
    `${Date.now() - lineBuildStartedAt} ms.`
  );

  writeExport_({
  sheetName: 'QBO_InvoiceLines',
  headers: INVOICE_LINE_HEADERS,
  rows: invoiceLineRows,
  autoResize: false,
  columnWidths: {
      [INVOICE_LINE_HEADERS.indexOf('InvoiceDocNumber') + 1]: 120,
      [INVOICE_LINE_HEADERS.indexOf('CustomerName') + 1]: 240,
      [INVOICE_LINE_HEADERS.indexOf('Description') + 1]: 300,
      [INVOICE_LINE_HEADERS.indexOf('ItemName') + 1]: 240,
      [INVOICE_LINE_HEADERS.indexOf('RawJSON') + 1]: 300
    },
    logMessage:
      `Exported ${invoiceLineRows.length} QBO invoice line rows.`
  });

  safeLog_('Completed QBO invoices export.');

  return {
    invoiceCount: invoiceRows.length,
    invoiceLineCount: invoiceLineRows.length
  };
}


/**
 * Builds rows for the QBO_Invoices sheet.
 *
 * @param {Object[]} invoices QBO Invoice objects.
 * @return {Array[]} Rows matching INVOICE_HEADERS.
 */
function buildInvoiceRows_(invoices) {

  return invoices.map(invoice => {
    const meta = extractMeta_(invoice);

    const lines =
      normalizeArray_(invoice.Line);

    const totals =
      calculateInvoiceLineTotals_(lines);

    const linkedTransactions =
      normalizeArray_(invoice.LinkedTxn);

    const linked =
      summarizeLinkedTransactions_(
        linkedTransactions
      );

    const taxLines =
      normalizeArray_(
        invoice.TxnTaxDetail &&
        invoice.TxnTaxDetail.TaxLine
          ? invoice.TxnTaxDetail.TaxLine
          : []
      );

    const deliveryInfo =
      invoice.DeliveryInfo || {};

    return [
      // Identity
      valueOrBlank_(invoice.Id),
      valueOrBlank_(invoice.SyncToken),
      valueOrBlank_(invoice.DocNumber),

      // Dates
      valueOrBlank_(invoice.TxnDate),
      valueOrBlank_(invoice.DueDate),
      valueOrBlank_(invoice.ShipDate),

      // Customer
      nestedValue_(invoice, 'CustomerRef.value'),
      nestedValue_(invoice, 'CustomerRef.name'),
      nestedValue_(invoice, 'CustomerMemo.value'),

      // Classification
      nestedValue_(invoice, 'ClassRef.value'),
      nestedValue_(invoice, 'ClassRef.name'),
      nestedValue_(invoice, 'DepartmentRef.value'),
      nestedValue_(invoice, 'DepartmentRef.name'),

      // Accounts and Terms
      nestedValue_(invoice, 'ARAccountRef.value'),
      nestedValue_(invoice, 'ARAccountRef.name'),
      nestedValue_(invoice, 'SalesTermRef.value'),
      nestedValue_(invoice, 'SalesTermRef.name'),

      // Currency
      nestedValue_(invoice, 'CurrencyRef.value'),
      nestedValue_(invoice, 'CurrencyRef.name'),
      numberOrBlank_(invoice.ExchangeRate),

      // Billing Contact
      nestedValue_(invoice, 'BillEmail.Address'),

      // Billing Address
      nestedValue_(invoice, 'BillAddr.Id'),
      nestedValue_(invoice, 'BillAddr.Line1'),
      nestedValue_(invoice, 'BillAddr.Line2'),
      nestedValue_(invoice, 'BillAddr.Line3'),
      nestedValue_(invoice, 'BillAddr.Line4'),
      nestedValue_(invoice, 'BillAddr.Line5'),
      nestedValue_(invoice, 'BillAddr.City'),
      nestedValue_(invoice, 'BillAddr.CountrySubDivisionCode'),
      nestedValue_(invoice, 'BillAddr.PostalCode'),
      nestedValue_(invoice, 'BillAddr.Country'),

      // Shipping Address
      nestedValue_(invoice, 'ShipAddr.Id'),
      nestedValue_(invoice, 'ShipAddr.Line1'),
      nestedValue_(invoice, 'ShipAddr.Line2'),
      nestedValue_(invoice, 'ShipAddr.Line3'),
      nestedValue_(invoice, 'ShipAddr.Line4'),
      nestedValue_(invoice, 'ShipAddr.Line5'),
      nestedValue_(invoice, 'ShipAddr.City'),
      nestedValue_(invoice, 'ShipAddr.CountrySubDivisionCode'),
      nestedValue_(invoice, 'ShipAddr.PostalCode'),
      nestedValue_(invoice, 'ShipAddr.Country'),

      // Shipping
      valueOrBlank_(invoice.TrackingNum),

      // Status
      valueOrBlank_(invoice.PrintStatus),
      valueOrBlank_(invoice.EmailStatus),

      // Online Payment Options
      booleanOrBlank_(invoice.AllowOnlineACHPayment),
      booleanOrBlank_(invoice.AllowOnlineCreditCardPayment),
      booleanOrBlank_(invoice.AllowIPNPayment),
      booleanOrBlank_(invoice.AllowOnlinePayment),

      // Amounts
      totals.subtotal,
      totals.discountTotal,
      numberOrBlank_(
        invoice.Deposit
      ),
      numberOrBlank_(
        invoice.TotalAmt
      ),
      numberOrBlank_(
        invoice.Balance
      ),

      // Home Currency Amounts
      numberOrBlank_(
        invoice.HomeTotalAmt
      ),
      numberOrBlank_(
        invoice.HomeBalance
      ),

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

      jsonStringifyCellSafe_(
        linked.otherTransactions
      ),

      jsonStringifyCellSafe_(
        linkedTransactions
      ),

      // Tax
      nestedValue_(
        invoice,
        'TxnTaxDetail.TxnTaxCodeRef.value'
      ),

      nestedValue_(
        invoice,
        'TxnTaxDetail.TxnTaxCodeRef.name'
      ),

      nestedNumberOrBlank_(
        invoice,
        'TxnTaxDetail.TotalTax'
      ),

      taxLines.length,

      jsonStringifyCellSafe_(
        taxLines
      ),

      jsonStringifyCellSafe_(
        invoice.TxnTaxDetail
      ),

      booleanOrBlank_(
        invoice.ApplyTaxAfterDiscount
      ),

      // Delivery
      valueOrBlank_(
        deliveryInfo.DeliveryType
      ),

      valueOrBlank_(
        deliveryInfo.DeliveryTime
      ),

      jsonStringifyCellSafe_(
        invoice.DeliveryInfo
      ),

      // Line Summary
      lines.length,

      // Notes
      valueOrBlank_(
        invoice.PrivateNote
      ),

      // Related Data
      jsonStringifyCellSafe_(
        invoice.CustomField
      ),

      // Audit
      valueOrBlank_(meta.createTime),
      valueOrBlank_(meta.lastUpdatedTime),

      // Source
      jsonStringifyCellSafe_(
        invoice
      )
    ];
  });
}


/**
 * Builds rows for the QBO_InvoiceLines sheet.
 *
 * Group lines can contain nested component lines. This builder exports:
 *
 *   1. The top-level group line.
 *   2. Each nested component line.
 *
 * @param {Object[]} invoices QBO Invoice objects.
 * @return {Array[]} Rows matching INVOICE_LINE_HEADERS.
 */
function buildInvoiceLineRows_(invoices) {

  const rows = [];

  invoices.forEach(invoice => {
    const lines =
      normalizeArray_(invoice.Line);

    lines.forEach((line, index) => {
      appendInvoiceLineRow_(
        rows,
        invoice,
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
 * Appends an invoice line and any nested group component lines.
 *
 * @param {Array[]} rows Destination row array.
 * @param {Object} invoice Parent Invoice object.
 * @param {Object} line Invoice Line object.
 * @param {number} fallbackLineNumber Position when LineNum is unavailable.
 * @param {number} lineLevel Zero for top-level lines.
 * @param {*} parentLineId Parent group line ID.
 * @param {*} parentLineNumber Parent group line number.
 */
function appendInvoiceLineRow_(
  rows,
  invoice,
  line,
  fallbackLineNumber,
  lineLevel,
  parentLineId,
  parentLineNumber
) {

  const linkedTransactions =
    normalizeArray_(line.LinkedTxn);

  const linked =
    summarizeLinkedTransactions_(
      linkedTransactions
    );

  const detailType =
    valueOrBlank_(line.DetailType);
  const detail = detailType && line[detailType]
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

  rows.push([
    // Parent Invoice
    valueOrBlank_(invoice.Id),
    valueOrBlank_(invoice.DocNumber),
    valueOrBlank_(invoice.TxnDate),
    nestedValue_(invoice, 'CustomerRef.value'),
    nestedValue_(invoice, 'CustomerRef.name'),

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

    jsonStringifyCellSafe_(
      linked.otherTransactions
    ),

    jsonStringifyCellSafe_(
      linkedTransactions
    ),

    // Source
    jsonStringifyCellSafe_(
      line
    )
  ]);

  groupLines.forEach((childLine, childIndex) => {
    appendInvoiceLineRow_(
      rows,
      invoice,
      childLine,
      childIndex + 1,
      lineLevel + 1,
      valueOrBlank_(line.Id),
      lineNumber
    );
  });
}


/**
 * Calculates useful invoice totals from line records.
 *
 * QBO normally provides TotalAmt but does not always provide separate
 * subtotal and discount summary fields at the invoice level.
 *
 * @param {Object[]} lines Invoice Line objects.
 * @return {Object} Calculated subtotal and discount total.
 */
function calculateInvoiceLineTotals_(lines) {

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


/**
 * Safely retrieves and converts a nested numeric value.
 *
 * @param {Object} object Source object.
 * @param {string} path Dot-separated property path.
 * @return {number|string} Number or blank.
 */
function nestedNumberOrBlank_(object, path) {

  const value = nestedValue_(object, path);

  return value === ''
    ? ''
    : numberOrBlank_(value);
}