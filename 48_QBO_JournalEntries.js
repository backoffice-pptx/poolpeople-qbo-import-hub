/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 48_QBO_JournalEntries.js
 * Purpose     : Export QBO Journal Entries and journal-entry lines to structured Google Sheets tables.
 *
 * Public API:
 *   - exportQboJournalEntries()
 *
 * Internal Helpers:
 *   - buildJournalEntryRows_()
 *   - buildJournalEntryLineRows_()
 *   - appendJournalEntryLineRow_()
 *   - summarizeJournalEntryLines_()
 *   - calculateJournalEntrySignedAmount_()
 *   - getJournalEntryEntity_()
 *   - getJournalEntryTypedEntity_()
 *   - collectJournalEntryLinkedTxns_()
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
 * 48_QBO_JournalEntries.gs
 * QBO JournalEntry export
 *
 * Output Sheets:
 *   QBO_JournalEntries
 *   QBO_JournalEntryLines
 *
 * Public Functions:
 *   exportQboJournalEntries()
 ***********************/

/** JournalEntry parent export columns. */
const JOURNAL_ENTRY_HEADERS = [
  'Id',
  'SyncToken',
  'DocNumber',
  'TxnDate',
  'Adjustment',
  'DepartmentId',
  'DepartmentName',
  'CurrencyCode',
  'CurrencyName',
  'ExchangeRate',
  'TotalAmount',
  'HomeTotalAmount',
  'DebitTotal',
  'CreditTotal',
  'NetAmount',
  'BalanceVariance',
  'AbsoluteLineTotal',
  'LineCount',
  'DebitLineCount',
  'CreditLineCount',
  'OtherLineCount',
  'ZeroAmountLineCount',
  'LinkedLineCount',
  'TransactionTaxCodeId',
  'TransactionTaxCodeName',
  'TotalTax',
  'GlobalTaxCalculation',
  'TaxDetailJSON',
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
  'CreateTime',
  'LastUpdatedTime',
  'RawJSON'
];

/** JournalEntry line export columns. */
const JOURNAL_ENTRY_LINE_HEADERS = [
  'JournalEntryId',
  'JournalEntryDocNumber',
  'JournalEntryTxnDate',
  'Adjustment',
  'CurrencyCode',
  'ExchangeRate',
  'LineId',
  'LineNumber',
  'DetailType',
  'Description',
  'Amount',
  'SignedAmount',
  'PostingType',
  'IsDebit',
  'IsCredit',
  'AccountId',
  'AccountName',
  'EntityType',
  'EntityId',
  'EntityName',
  'CustomerId',
  'CustomerName',
  'VendorId',
  'VendorName',
  'EmployeeId',
  'EmployeeName',
  'ClassId',
  'ClassName',
  'DepartmentId',
  'DepartmentName',
  'BillableStatus',
  'TaxCodeId',
  'TaxCodeName',
  'TaxRateId',
  'TaxRateName',
  'TaxApplicableOn',
  'TaxAmount',
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
 * Exports all QBO JournalEntry records and line details.
 *
 * @return {Object} Export row counts.
 */
function exportQboJournalEntries() {
  safeLog_('Starting QBO journal entries export.');

  const journalEntries = qboQueryAllGeneric_(
    'SELECT * FROM JournalEntry',
    'JournalEntry'
  );

  safeLog_(`Retrieved ${journalEntries.length} QBO journal entries.`);

  const journalEntryRows = buildJournalEntryRows_(journalEntries);

  writeExport_({
    sheetName: 'QBO_JournalEntries',
    headers: JOURNAL_ENTRY_HEADERS,
    rows: journalEntryRows,
    columnWidths: {
      [JOURNAL_ENTRY_HEADERS.indexOf('DocNumber') + 1]: 150,
      [JOURNAL_ENTRY_HEADERS.indexOf('DepartmentName') + 1]: 220,
      [JOURNAL_ENTRY_HEADERS.indexOf('PrivateNote') + 1]: 300,
      [JOURNAL_ENTRY_HEADERS.indexOf('TaxDetailJSON') + 1]: 300,
      [JOURNAL_ENTRY_HEADERS.indexOf('LinkedOtherTransactionsJSON') + 1]: 300,
      [JOURNAL_ENTRY_HEADERS.indexOf('LinkedTransactionsJSON') + 1]: 300,
      [JOURNAL_ENTRY_HEADERS.indexOf('RawJSON') + 1]: 300
    },
    numberFormats: {
      [JOURNAL_ENTRY_HEADERS.indexOf('TxnDate') + 1]: 'yyyy-mm-dd',
      [JOURNAL_ENTRY_HEADERS.indexOf('ExchangeRate') + 1]: '0.000000',
      [JOURNAL_ENTRY_HEADERS.indexOf('TotalAmount') + 1]: '$#,##0.00;-$#,##0.00',
      [JOURNAL_ENTRY_HEADERS.indexOf('HomeTotalAmount') + 1]: '$#,##0.00;-$#,##0.00',
      [JOURNAL_ENTRY_HEADERS.indexOf('DebitTotal') + 1]: '$#,##0.00;-$#,##0.00',
      [JOURNAL_ENTRY_HEADERS.indexOf('CreditTotal') + 1]: '$#,##0.00;-$#,##0.00',
      [JOURNAL_ENTRY_HEADERS.indexOf('NetAmount') + 1]: '$#,##0.00;-$#,##0.00',
      [JOURNAL_ENTRY_HEADERS.indexOf('BalanceVariance') + 1]: '$#,##0.00;-$#,##0.00',
      [JOURNAL_ENTRY_HEADERS.indexOf('AbsoluteLineTotal') + 1]: '$#,##0.00;-$#,##0.00',
      [JOURNAL_ENTRY_HEADERS.indexOf('TotalTax') + 1]: '$#,##0.00;-$#,##0.00'
    },
    logMessage: `Exported ${journalEntryRows.length} QBO journal entries.`
  });

  const journalEntryLineRows = buildJournalEntryLineRows_(journalEntries);

  writeExport_({
    sheetName: 'QBO_JournalEntryLines',
    headers: JOURNAL_ENTRY_LINE_HEADERS,
    rows: journalEntryLineRows,
    columnWidths: {
      [JOURNAL_ENTRY_LINE_HEADERS.indexOf('JournalEntryDocNumber') + 1]: 160,
      [JOURNAL_ENTRY_LINE_HEADERS.indexOf('DetailType') + 1]: 220,
      [JOURNAL_ENTRY_LINE_HEADERS.indexOf('Description') + 1]: 300,
      [JOURNAL_ENTRY_LINE_HEADERS.indexOf('PostingType') + 1]: 130,
      [JOURNAL_ENTRY_LINE_HEADERS.indexOf('AccountName') + 1]: 260,
      [JOURNAL_ENTRY_LINE_HEADERS.indexOf('EntityName') + 1]: 240,
      [JOURNAL_ENTRY_LINE_HEADERS.indexOf('CustomerName') + 1]: 240,
      [JOURNAL_ENTRY_LINE_HEADERS.indexOf('VendorName') + 1]: 240,
      [JOURNAL_ENTRY_LINE_HEADERS.indexOf('EmployeeName') + 1]: 240,
      [JOURNAL_ENTRY_LINE_HEADERS.indexOf('ClassName') + 1]: 220,
      [JOURNAL_ENTRY_LINE_HEADERS.indexOf('DepartmentName') + 1]: 220,
      [JOURNAL_ENTRY_LINE_HEADERS.indexOf('LinkedOtherTransactionsJSON') + 1]: 300,
      [JOURNAL_ENTRY_LINE_HEADERS.indexOf('LinkedTransactionsJSON') + 1]: 300,
      [JOURNAL_ENTRY_LINE_HEADERS.indexOf('RawJSON') + 1]: 300
    },
    numberFormats: {
      [JOURNAL_ENTRY_LINE_HEADERS.indexOf('JournalEntryTxnDate') + 1]: 'yyyy-mm-dd',
      [JOURNAL_ENTRY_LINE_HEADERS.indexOf('ExchangeRate') + 1]: '0.000000',
      [JOURNAL_ENTRY_LINE_HEADERS.indexOf('Amount') + 1]: '$#,##0.00;-$#,##0.00',
      [JOURNAL_ENTRY_LINE_HEADERS.indexOf('SignedAmount') + 1]: '$#,##0.00;-$#,##0.00',
      [JOURNAL_ENTRY_LINE_HEADERS.indexOf('TaxAmount') + 1]: '$#,##0.00;-$#,##0.00'
    },
    logMessage: `Exported ${journalEntryLineRows.length} QBO journal entry line rows.`
  });

  safeLog_('Completed QBO journal entries export.');

  return {
    journalEntryCount: journalEntryRows.length,
    journalEntryLineCount: journalEntryLineRows.length
  };
}

/**
 * Builds rows for QBO_JournalEntries.
 *
 * @param {Object[]} journalEntries QBO JournalEntry objects.
 * @return {Array[]} Rows matching JOURNAL_ENTRY_HEADERS.
 */
function buildJournalEntryRows_(journalEntries) {
  return journalEntries.map(journalEntry => {
    const meta = extractMeta_(journalEntry);
    const lines = normalizeArray_(journalEntry.Line);
    const summary = summarizeJournalEntryLines_(lines);
    const linkedTransactions = collectJournalEntryLinkedTxns_(lines);
    const linked = summarizeLinkedTransactions_(linkedTransactions);

    return [
      valueOrBlank_(journalEntry.Id),
      valueOrBlank_(journalEntry.SyncToken),
      valueOrBlank_(journalEntry.DocNumber),
      valueOrBlank_(journalEntry.TxnDate),
      booleanOrBlank_(journalEntry.Adjustment),
      nestedValue_(journalEntry, 'DepartmentRef.value'),
      nestedValue_(journalEntry, 'DepartmentRef.name'),
      nestedValue_(journalEntry, 'CurrencyRef.value'),
      nestedValue_(journalEntry, 'CurrencyRef.name'),
      numberOrBlank_(journalEntry.ExchangeRate),
      numberOrBlank_(journalEntry.TotalAmt),
      numberOrBlank_(journalEntry.HomeTotalAmt),
      summary.debitTotal,
      summary.creditTotal,
      summary.netAmount,
      summary.balanceVariance,
      summary.absoluteLineTotal,
      lines.length,
      summary.debitLineCount,
      summary.creditLineCount,
      summary.otherLineCount,
      summary.zeroAmountLineCount,
      summary.linkedLineCount,
      nestedValue_(journalEntry, 'TxnTaxDetail.TxnTaxCodeRef.value'),
      nestedValue_(journalEntry, 'TxnTaxDetail.TxnTaxCodeRef.name'),
      nestedNumberOrBlank_(journalEntry, 'TxnTaxDetail.TotalTax'),
      valueOrBlank_(journalEntry.GlobalTaxCalculation),
      jsonStringifyCellSafe_(journalEntry.TxnTaxDetail),
      valueOrBlank_(journalEntry.PrivateNote),
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
      valueOrBlank_(meta.createTime),
      valueOrBlank_(meta.lastUpdatedTime),
      jsonStringifyCellSafe_(journalEntry)
    ];
  });
}

/**
 * Builds rows for QBO_JournalEntryLines.
 *
 * @param {Object[]} journalEntries QBO JournalEntry objects.
 * @return {Array[]} Rows matching JOURNAL_ENTRY_LINE_HEADERS.
 */
function buildJournalEntryLineRows_(journalEntries) {
  const rows = [];

  journalEntries.forEach(journalEntry => {
    normalizeArray_(journalEntry.Line).forEach((line, index) => {
      appendJournalEntryLineRow_(rows, journalEntry, line, index);
    });
  });

  return rows;
}

/**
 * Appends one JournalEntry line row.
 *
 * @param {Array[]} rows Destination rows.
 * @param {Object} journalEntry Parent JournalEntry.
 * @param {Object} line JournalEntry line.
 * @param {number} index Zero-based line index.
 */
function appendJournalEntryLineRow_(rows, journalEntry, line, index) {
  const detailType = valueOrBlank_(line.DetailType);
  const detail = detailType && line[detailType]
    ? line[detailType]
    : (line.JournalEntryLineDetail || {});

  const postingType = valueOrBlank_(detail.PostingType);
  const amount = numberOrBlank_(line.Amount);
  const signedAmount = calculateJournalEntrySignedAmount_(amount, postingType);
  const entity = getJournalEntryEntity_(detail);
  const customer = getJournalEntryTypedEntity_(detail, 'Customer');
  const vendor = getJournalEntryTypedEntity_(detail, 'Vendor');
  const employee = getJournalEntryTypedEntity_(detail, 'Employee');
  const linkedTransactions = normalizeArray_(line.LinkedTxn);
  const linked = summarizeLinkedTransactions_(linkedTransactions);
  const suppliedLineNumber = valueOrBlank_(line.LineNum);
  const lineNumber = suppliedLineNumber !== '' ? suppliedLineNumber : index + 1;

  rows.push([
    valueOrBlank_(journalEntry.Id),
    valueOrBlank_(journalEntry.DocNumber),
    valueOrBlank_(journalEntry.TxnDate),
    booleanOrBlank_(journalEntry.Adjustment),
    nestedValue_(journalEntry, 'CurrencyRef.value'),
    numberOrBlank_(journalEntry.ExchangeRate),
    valueOrBlank_(line.Id),
    lineNumber,
    detailType,
    valueOrBlank_(line.Description),
    amount,
    signedAmount,
    postingType,
    postingType === 'Debit',
    postingType === 'Credit',
    nestedValue_(detail, 'AccountRef.value'),
    nestedValue_(detail, 'AccountRef.name'),
    entity.type,
    entity.id,
    entity.name,
    customer.id,
    customer.name,
    vendor.id,
    vendor.name,
    employee.id,
    employee.name,
    nestedValue_(detail, 'ClassRef.value'),
    nestedValue_(detail, 'ClassRef.name'),
    nestedValue_(detail, 'DepartmentRef.value'),
    nestedValue_(detail, 'DepartmentRef.name'),
    valueOrBlank_(detail.BillableStatus),
    nestedValue_(detail, 'TaxCodeRef.value'),
    nestedValue_(detail, 'TaxCodeRef.name'),
    nestedValue_(detail, 'TaxRateRef.value'),
    nestedValue_(detail, 'TaxRateRef.name'),
    valueOrBlank_(detail.TaxApplicableOn),
    numberOrBlank_(detail.TaxAmount),
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
 * Summarizes debit and credit lines for a JournalEntry.
 *
 * @param {Object[]} lines JournalEntry line objects.
 * @return {Object} Journal-entry line summary.
 */
function summarizeJournalEntryLines_(lines) {
  let debitTotal = 0;
  let creditTotal = 0;
  let absoluteLineTotal = 0;
  let debitLineCount = 0;
  let creditLineCount = 0;
  let otherLineCount = 0;
  let zeroAmountLineCount = 0;
  let linkedLineCount = 0;

  lines.forEach(line => {
    const detail = line.JournalEntryLineDetail || {};
    const postingType = valueOrBlank_(detail.PostingType);
    const numericAmount = Number(line.Amount);
    const amount = Number.isFinite(numericAmount) ? numericAmount : 0;

    absoluteLineTotal += Math.abs(amount);

    if (amount === 0) {
      zeroAmountLineCount++;
    }

    if (postingType === 'Debit') {
      debitTotal += amount;
      debitLineCount++;
    } else if (postingType === 'Credit') {
      creditTotal += amount;
      creditLineCount++;
    } else {
      otherLineCount++;
    }

    if (normalizeArray_(line.LinkedTxn).length > 0) {
      linkedLineCount++;
    }
  });

  const netAmount = debitTotal - creditTotal;

  return {
    debitTotal: debitTotal,
    creditTotal: creditTotal,
    netAmount: netAmount,
    balanceVariance: netAmount,
    absoluteLineTotal: absoluteLineTotal,
    debitLineCount: debitLineCount,
    creditLineCount: creditLineCount,
    otherLineCount: otherLineCount,
    zeroAmountLineCount: zeroAmountLineCount,
    linkedLineCount: linkedLineCount
  };
}

/**
 * Converts a JournalEntry line amount to a signed accounting amount.
 *
 * Debit = positive; Credit = negative.
 *
 * @param {*} amount Line amount.
 * @param {*} postingType Debit or Credit.
 * @return {number|string} Signed amount or blank.
 */
function calculateJournalEntrySignedAmount_(amount, postingType) {
  if (amount === undefined || amount === null || amount === '') {
    return '';
  }

  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount)) {
    return '';
  }

  if (postingType === 'Credit') {
    return -Math.abs(numericAmount);
  }

  if (postingType === 'Debit') {
    return Math.abs(numericAmount);
  }

  return numericAmount;
}

/**
 * Extracts the generic entity from a JournalEntry line.
 *
 * @param {Object} detail JournalEntryLineDetail object.
 * @return {Object} Entity type, ID, and name.
 */
function getJournalEntryEntity_(detail) {
  const entity = detail && detail.Entity ? detail.Entity : {};

  return {
    type: valueOrBlank_(entity.Type || entity.type),
    id: valueOrBlank_(
      nestedValue_(entity, 'EntityRef.value') ||
      entity.value
    ),
    name: valueOrBlank_(
      nestedValue_(entity, 'EntityRef.name') ||
      entity.name
    )
  };
}

/**
 * Returns entity information only when the generic entity matches the type.
 *
 * @param {Object} detail JournalEntryLineDetail object.
 * @param {string} requestedType Customer, Vendor, or Employee.
 * @return {Object} Typed entity ID and name.
 */
function getJournalEntryTypedEntity_(detail, requestedType) {
  const entity = getJournalEntryEntity_(detail);
  const normalizedActualType = String(entity.type || '').toLowerCase();
  const normalizedRequestedType = String(requestedType || '').toLowerCase();

  if (normalizedActualType !== normalizedRequestedType) {
    return { id: '', name: '' };
  }

  return {
    id: entity.id,
    name: entity.name
  };
}

/**
 * Collects LinkedTxn records across all lines of a JournalEntry.
 *
 * @param {Object[]} lines JournalEntry line objects.
 * @return {Object[]} Linked transaction objects.
 */
function collectJournalEntryLinkedTxns_(lines) {
  const linkedTransactions = [];

  lines.forEach(line => {
    normalizeArray_(line.LinkedTxn).forEach(linkedTxn => {
      linkedTransactions.push(linkedTxn);
    });
  });

  return linkedTransactions;
}
