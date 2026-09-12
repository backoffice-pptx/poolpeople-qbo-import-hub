/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 45_QBO_BillPayments.js
 * Purpose     : Export QBO Bill Payments and bill-payment applications to structured Google Sheets tables.
 *
 * Public API:
 *   - exportQboBillPayments()
 *
 * Internal Helpers:
 *   - buildBillPaymentRows_()
 *   - buildBillPaymentApplicationRows_()
 *   - appendBillPaymentApplicationRow_()
 *   - getBillPaymentAccount_()
 *   - summarizeBillPaymentApplications_()
 *   - calculateBillPaymentLineTotal_()
 *   - calculateAmountVariance_()
 *   - getBillPaymentLineNumber_()
 *   - collectBillPaymentLinkedTransactions_()
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
 * 45_QBO_BillPayments.gs
 * QBO Bill Payment export
 *
 * Output Sheets:
 *   QBO_BillPayments
 *   QBO_BillPaymentApplications
 *
 * Public Functions:
 *   exportQboBillPayments()
 ***********************/

/**
 * Bill Payment parent export columns.
 */
const BILL_PAYMENT_HEADERS = [
  // Identity
  'Id',
  'SyncToken',
  'DocNumber',

  // Date
  'TxnDate',

  // Vendor
  'VendorId',
  'VendorName',

  // Payment Type
  'PayType',

  // Accounts Payable
  'APAccountId',
  'APAccountName',

  // Check Payment
  'BankAccountId',
  'BankAccountName',
  'CheckPrintStatus',
  'CheckNumber',

  // Credit Card Payment
  'CreditCardAccountId',
  'CreditCardAccountName',
  'CreditCardTxnType',

  // Currency
  'CurrencyCode',
  'CurrencyName',
  'ExchangeRate',

  // Amounts
  'TotalAmount',
  'HomeTotalAmount',
  'ApplicationLineTotal',
  'ApplicationVariance',

  // Application Summary
  'LineCount',
  'ApplicationCount',
  'BillApplicationCount',
  'VendorCreditApplicationCount',
  'OtherApplicationCount',

  // Classification
  'DepartmentId',
  'DepartmentName',

  // Processing
  'ProcessBillPayment',

  // Notes
  'PrivateNote',

  // Payment Detail
  'CheckPaymentJSON',
  'CreditCardPaymentJSON',

  // Linked Transactions
  'LinkedTransactionCount',

  'LinkedBillCount',
  'LinkedBillIds',

  'LinkedVendorCreditCount',
  'LinkedVendorCreditIds',

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
 * Bill Payment application child export columns.
 */
const BILL_PAYMENT_APPLICATION_HEADERS = [
  // Parent Bill Payment
  'BillPaymentId',
  'BillPaymentDocNumber',
  'BillPaymentTxnDate',
  'PayType',

  // Vendor
  'VendorId',
  'VendorName',

  // Payment Account
  'PaymentAccountId',
  'PaymentAccountName',

  // Payment Line
  'PaymentLineId',
  'PaymentLineNumber',
  'PaymentLineAmount',

  // Linked Transaction
  'LinkedTxnNumber',
  'LinkedTxnId',
  'LinkedTxnType',
  'LinkedTxnLineId',

  // Derived
  'IsBillApplication',
  'IsVendorCreditApplication',
  'IsOtherApplication',

  // Source
  'PaymentLineRawJSON',
  'LinkedTxnRawJSON'
];

/**
 * Exports all QBO Bill Payments and their applications.
 *
 * Output sheets:
 *   QBO_BillPayments
 *   QBO_BillPaymentApplications
 *
 * @return {Object} Export row counts.
 */
function exportQboBillPayments() {

  safeLog_('Starting QBO bill payments export.');

  const billPayments = qboQueryAllGeneric_(
    'SELECT * FROM BillPayment',
    'BillPayment'
  );

  safeLog_(`Retrieved ${billPayments.length} QBO bill payments.`);

  // Parent Bill Payments
  const billPaymentRows = buildBillPaymentRows_(billPayments);

  writeExport_({
    sheetName: 'QBO_BillPayments',
    headers: BILL_PAYMENT_HEADERS,
    rows: billPaymentRows,

    columnWidths: {
      [BILL_PAYMENT_HEADERS.indexOf('DocNumber') + 1]: 140,
      [BILL_PAYMENT_HEADERS.indexOf('VendorName') + 1]: 240,
      [BILL_PAYMENT_HEADERS.indexOf('APAccountName') + 1]: 220,
      [BILL_PAYMENT_HEADERS.indexOf('BankAccountName') + 1]: 220,
      [BILL_PAYMENT_HEADERS.indexOf('CreditCardAccountName') + 1]: 220,
      [BILL_PAYMENT_HEADERS.indexOf('PrivateNote') + 1]: 300,
      [BILL_PAYMENT_HEADERS.indexOf('CheckPaymentJSON') + 1]: 300,
      [BILL_PAYMENT_HEADERS.indexOf('CreditCardPaymentJSON') + 1]: 300,
      [BILL_PAYMENT_HEADERS.indexOf('LinkedOtherTransactionsJSON') + 1]: 300,
      [BILL_PAYMENT_HEADERS.indexOf('LinkedTransactionsJSON') + 1]: 300,
      [BILL_PAYMENT_HEADERS.indexOf('RawJSON') + 1]: 300
    },


    numberFormats: {
      [BILL_PAYMENT_HEADERS.indexOf('TxnDate') + 1]: 'yyyy-mm-dd',
      [BILL_PAYMENT_HEADERS.indexOf('ExchangeRate') + 1]: '0.000000',
      [BILL_PAYMENT_HEADERS.indexOf('TotalAmount') + 1]: '$#,##0.00',
      [BILL_PAYMENT_HEADERS.indexOf('HomeTotalAmount') + 1]: '$#,##0.00',
      [BILL_PAYMENT_HEADERS.indexOf('ApplicationLineTotal') + 1]: '$#,##0.00',
      [BILL_PAYMENT_HEADERS.indexOf('ApplicationVariance') + 1]: '$#,##0.00'
    },

    logMessage: `Exported ${billPaymentRows.length} QBO bill payments.`
  });

  // Bill Payment Applications
  const applicationRows = buildBillPaymentApplicationRows_(billPayments);

  writeExport_({
    sheetName: 'QBO_BillPaymentApplications',
    headers: BILL_PAYMENT_APPLICATION_HEADERS,
    rows: applicationRows,

    columnWidths: {
      [BILL_PAYMENT_APPLICATION_HEADERS.indexOf('BillPaymentDocNumber') + 1]: 160,
      [BILL_PAYMENT_APPLICATION_HEADERS.indexOf('VendorName') + 1]: 240,
      [BILL_PAYMENT_APPLICATION_HEADERS.indexOf('PaymentAccountName') + 1]: 220,
      [BILL_PAYMENT_APPLICATION_HEADERS.indexOf('LinkedTxnType') + 1]: 180,
      [BILL_PAYMENT_APPLICATION_HEADERS.indexOf('PaymentLineRawJSON') + 1]: 300,
      [BILL_PAYMENT_APPLICATION_HEADERS.indexOf('LinkedTxnRawJSON') + 1]: 300
    },


    numberFormats: {
      [BILL_PAYMENT_APPLICATION_HEADERS.indexOf('BillPaymentTxnDate') + 1]: 'yyyy-mm-dd',
      [BILL_PAYMENT_APPLICATION_HEADERS.indexOf('PaymentLineAmount') + 1]: '$#,##0.00'
    },

    logMessage:
      `Exported ${applicationRows.length} QBO bill payment application rows.`
  });

  safeLog_('Completed QBO bill payments export.');

  return {
    billPaymentCount: billPaymentRows.length,
    billPaymentApplicationCount: applicationRows.length
  };
}

/**
 * Builds rows for QBO_BillPayments.
 *
 * @param {Object[]} billPayments QBO BillPayment objects.
 * @return {Array[]} Rows matching BILL_PAYMENT_HEADERS.
 */
function buildBillPaymentRows_(billPayments) {

  return billPayments.map(billPayment => {
    const meta = extractMeta_(billPayment);
    const lines = normalizeArray_(billPayment.Line);
    const applicationSummary = summarizeBillPaymentApplications_(lines);
    const linkedTransactions = collectBillPaymentLinkedTransactions_(lines);
    const linked = summarizeLinkedTransactionsForTypes_(linkedTransactions, ['Bill', 'VendorCredit']);

    const totalAmount = numberOrBlank_(billPayment.TotalAmt);
    const applicationLineTotal = calculateBillPaymentLineTotal_(lines);
    const applicationVariance = calculateAmountVariance_(
      billPayment.TotalAmt,
      applicationLineTotal
    );

    return [
      // Identity
      valueOrBlank_(billPayment.Id),
      valueOrBlank_(billPayment.SyncToken),
      valueOrBlank_(billPayment.DocNumber),

      // Date
      valueOrBlank_(billPayment.TxnDate),

      // Vendor
      nestedValue_(billPayment, 'VendorRef.value'),
      nestedValue_(billPayment, 'VendorRef.name'),

      // Payment Type
      valueOrBlank_(billPayment.PayType),

      // Accounts Payable
      nestedValue_(billPayment, 'APAccountRef.value'),
      nestedValue_(billPayment, 'APAccountRef.name'),

      // Check Payment
      nestedValue_(billPayment, 'CheckPayment.BankAccountRef.value'),
      nestedValue_(billPayment, 'CheckPayment.BankAccountRef.name'),
      nestedValue_(billPayment, 'CheckPayment.PrintStatus'),
      nestedValue_(billPayment, 'CheckPayment.CheckNum'),

      // Credit Card Payment
      nestedValue_(billPayment, 'CreditCardPayment.CCAccountRef.value'),
      nestedValue_(billPayment, 'CreditCardPayment.CCAccountRef.name'),
      nestedValue_(billPayment, 'CreditCardPayment.CCDetail.CreditChargeInfo.CCTransType'),

      // Currency
      nestedValue_(billPayment, 'CurrencyRef.value'),
      nestedValue_(billPayment, 'CurrencyRef.name'),
      numberOrBlank_(billPayment.ExchangeRate),

      // Amounts
      totalAmount,
      numberOrBlank_(billPayment.HomeTotalAmt),
      applicationLineTotal,
      applicationVariance,

      // Application Summary
      lines.length,
      applicationSummary.applicationCount,
      applicationSummary.billCount,
      applicationSummary.vendorCreditCount,
      applicationSummary.otherCount,

      // Classification
      nestedValue_(billPayment, 'DepartmentRef.value'),
      nestedValue_(billPayment, 'DepartmentRef.name'),

      // Processing
      booleanOrBlank_(billPayment.ProcessBillPayment),

      // Notes
      valueOrBlank_(billPayment.PrivateNote),

      // Payment Detail
      jsonStringifyCellSafe_(billPayment.CheckPayment),
      jsonStringifyCellSafe_(billPayment.CreditCardPayment),

      // Linked Transactions
            linked.totalCount,
      linkedTxnTypeCount_(linked, 'Bill'),
      linkedTxnTypeIds_(linked, 'Bill'),
      linkedTxnTypeCount_(linked, 'VendorCredit'),
      linkedTxnTypeIds_(linked, 'VendorCredit'),
      linked.otherCount,
      jsonStringifyCellSafe_(linked.otherTransactions),
      jsonStringifyCellSafe_(linkedTransactions),

      // Audit
      valueOrBlank_(meta.createTime),
      valueOrBlank_(meta.lastUpdatedTime),

      // Source
      jsonStringifyCellSafe_(billPayment)
    ];
  });
}

/**
 * Builds rows for QBO_BillPaymentApplications.
 *
 * Each LinkedTxn reference becomes one row.
 *
 * @param {Object[]} billPayments QBO BillPayment objects.
 * @return {Array[]} Application rows.
 */
function buildBillPaymentApplicationRows_(billPayments) {

  const rows = [];

  billPayments.forEach(billPayment => {
    const lines = normalizeArray_(billPayment.Line);
    const paymentAccount = getBillPaymentAccount_(billPayment);

    lines.forEach((line, lineIndex) => {
      const linkedTransactions = normalizeArray_(line.LinkedTxn);

      linkedTransactions.forEach((linkedTxn, linkedTxnIndex) => {
        appendBillPaymentApplicationRow_(
          rows,
          billPayment,
          paymentAccount,
          line,
          lineIndex,
          linkedTxn,
          linkedTxnIndex
        );
      });
    });
  });

  return rows;
}

/**
 * Appends one Bill Payment application row.
 *
 * @param {Array[]} rows Destination row array.
 * @param {Object} billPayment Parent BillPayment object.
 * @param {Object} paymentAccount Payment account reference.
 * @param {Object} line BillPayment line.
 * @param {number} lineIndex Zero-based line index.
 * @param {Object} linkedTxn Linked transaction reference.
 * @param {number} linkedTxnIndex Zero-based linked transaction index.
 */
function appendBillPaymentApplicationRow_(
  rows,
  billPayment,
  paymentAccount,
  line,
  lineIndex,
  linkedTxn,
  linkedTxnIndex
) {

  const txnType = valueOrBlank_(linkedTxn.TxnType);
  const isBill = txnType === 'Bill';
  const isVendorCredit = txnType === 'VendorCredit';

  rows.push([
    // Parent Bill Payment
    valueOrBlank_(billPayment.Id),
    valueOrBlank_(billPayment.DocNumber),
    valueOrBlank_(billPayment.TxnDate),
    valueOrBlank_(billPayment.PayType),

    // Vendor
    nestedValue_(billPayment, 'VendorRef.value'),
    nestedValue_(billPayment, 'VendorRef.name'),

    // Payment Account
    paymentAccount.id,
    paymentAccount.name,

    // Payment Line
    valueOrBlank_(line.Id),
    getBillPaymentLineNumber_(line, lineIndex),
    numberOrBlank_(line.Amount),

    // Linked Transaction
    linkedTxnIndex + 1,
    valueOrBlank_(linkedTxn.TxnId),
    txnType,
    valueOrBlank_(linkedTxn.TxnLineId),

    // Derived
    isBill,
    isVendorCredit,
    !isBill && !isVendorCredit,

    // Source
    jsonStringifyCellSafe_(line),
    jsonStringifyCellSafe_(linkedTxn)
  ]);
}

/**
 * Returns the account used to fund a Bill Payment.
 *
 * Check payments use CheckPayment.BankAccountRef.
 * Credit card payments use CreditCardPayment.CCAccountRef.
 *
 * @param {Object} billPayment QBO BillPayment object.
 * @return {Object} Account ID and name.
 */
function getBillPaymentAccount_(billPayment) {

  const payType = valueOrBlank_(billPayment.PayType);

  if (payType === 'Check') {
    return {
      id: nestedValue_(billPayment, 'CheckPayment.BankAccountRef.value'),
      name: nestedValue_(billPayment, 'CheckPayment.BankAccountRef.name')
    };
  }

  if (payType === 'CreditCard') {
    return {
      id: nestedValue_(billPayment, 'CreditCardPayment.CCAccountRef.value'),
      name: nestedValue_(billPayment, 'CreditCardPayment.CCAccountRef.name')
    };
  }

  // Preserve compatibility with unexpected payment types.
  const bankAccountId = nestedValue_(
    billPayment,
    'CheckPayment.BankAccountRef.value'
  );

  if (bankAccountId !== '') {
    return {
      id: bankAccountId,
      name: nestedValue_(billPayment, 'CheckPayment.BankAccountRef.name')
    };
  }

  return {
    id: nestedValue_(billPayment, 'CreditCardPayment.CCAccountRef.value'),
    name: nestedValue_(billPayment, 'CreditCardPayment.CCAccountRef.name')
  };
}

/**
 * Summarizes linked transaction types across all Bill Payment lines.
 *
 * @param {Object[]} lines Bill Payment lines.
 * @return {Object} Application counts.
 */
function summarizeBillPaymentApplications_(lines) {

  let applicationCount = 0;
  let billCount = 0;
  let vendorCreditCount = 0;
  let otherCount = 0;

  lines.forEach(line => {
    normalizeArray_(line.LinkedTxn).forEach(linkedTxn => {
      const txnType = valueOrBlank_(linkedTxn.TxnType);

      applicationCount++;

      if (txnType === 'Bill') {
        billCount++;
      } else if (txnType === 'VendorCredit') {
        vendorCreditCount++;
      } else {
        otherCount++;
      }
    });
  });

  return {
    applicationCount: applicationCount,
    billCount: billCount,
    vendorCreditCount: vendorCreditCount,
    otherCount: otherCount
  };
}

/**
 * Calculates the total amount across Bill Payment lines.
 *
 * @param {Object[]} lines Bill Payment lines.
 * @return {number|string} Line total or blank.
 */
function calculateBillPaymentLineTotal_(lines) {

  let total = 0;
  let hasAmount = false;

  lines.forEach(line => {
    if (
      line.Amount === undefined ||
      line.Amount === null ||
      line.Amount === ''
    ) {
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
 * Calculates the difference between the transaction total and line total.
 *
 * @param {*} totalAmount BillPayment.TotalAmt.
 * @param {*} lineTotal Calculated line total.
 * @return {number|string} Variance or blank.
 */
function calculateAmountVariance_(totalAmount, lineTotal) {

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
  const applications = Number(lineTotal);

  if (!Number.isFinite(total) || !Number.isFinite(applications)) {
    return '';
  }

  return total - applications;
}

/**
 * Returns the Bill Payment line number.
 *
 * @param {Object} line Bill Payment line.
 * @param {number} lineIndex Zero-based line index.
 * @return {*} Line number.
 */
function getBillPaymentLineNumber_(line, lineIndex) {

  const lineNumber = valueOrBlank_(line.LineNum);

  return lineNumber !== ''
    ? lineNumber
    : lineIndex + 1;
}

/**
 * Collects all LinkedTxn records across Bill Payment lines.
 *
 * @param {Object[]} lines Bill Payment lines.
 * @return {Object[]} Linked transaction records.
 */
function collectBillPaymentLinkedTransactions_(lines) {

  const linkedTransactions = [];

  lines.forEach(line => {
    normalizeArray_(line.LinkedTxn).forEach(linkedTxn => {
      linkedTransactions.push(linkedTxn);
    });
  });

  return linkedTransactions;
}
