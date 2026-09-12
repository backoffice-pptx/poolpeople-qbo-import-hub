/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 41_QBO_Payments.js
 * Purpose     : Export QBO customer payments and payment applications to
 *               structured Google Sheets tables.
 *
 * Responsibilities:
 *   - Retrieve all QBO Payment entities.
 *   - Build parent payment export rows.
 *   - Build child payment-application rows from LinkedTxn data.
 *   - Derive application counts and applied-payment amounts.
 *   - Write QBO_Payments and QBO_PaymentApplications outputs.
 *
 * Public API:
 *   - exportQboPayments()
 *
 * Internal Helpers:
 *   - buildPaymentRows_()
 *   - buildPaymentApplicationRows_()
 *   - countPaymentApplications_()
 *   - calculateAppliedPaymentAmount_()
 *   - getPaymentLineNumber_()
 *
 * Dependencies:
 *   - qboQueryAllGeneric_()
 *   - upsertSheet_()
 *   - writeRows_()
 *   - normalizeArray_()
 *   - summarizeLinkedTransactionsForTypes_()
 *   - extractMeta_()
 *   - numberOrBlank_()
 *   - valueOrBlank_()
 *   - nestedValue_()
 *   - jsonStringifyCellSafe_()
 *   - safeLog_()
 *
 * Output Sheets:
 *   - QBO_Payments
 *   - QBO_PaymentApplications
 *
 * Current Owner:
 *   - 50 QBO Import Hub
 *
 * Future Ownership:
 *   - Remains in Application 50. Payment entity mapping and export behavior are
 *     QBO connector responsibilities.
 *
 * Change History:
 *   - 2026-07-21: Moved normalizeArray_() to 20_Utils.js. Added standardized
 *     module documentation. No export behavior changed.
 * ============================================================================
 */


// =============================================================================
// Export schemas
// =============================================================================

const PAYMENT_HEADERS = [

  // Identity
  'Id',
  'SyncToken',
  'PaymentReferenceNumber',

  // Date
  'TxnDate',

  // Customer
  'CustomerId',
  'CustomerName',

  // Payment Method
  'PaymentMethodId',
  'PaymentMethodName',
  'PaymentType',

  // Accounts
  'DepositToAccountId',
  'DepositToAccountName',
  'ARAccountId',
  'ARAccountName',

  // Currency
  'CurrencyCode',
  'CurrencyName',
  'ExchangeRate',

  // Amounts
  'TotalAmount',
  'UnappliedAmount',
  'AppliedAmount',
  'HomeTotalAmount',

  // Linked Transactions
  'LinkedTransactionCount',

  'LinkedDepositCount',
  'LinkedDepositIds',

  'LinkedOtherTransactionCount',
  'LinkedOtherTransactionsJSON',
  'LinkedTransactionsJSON',

  // Processing
  'ProcessPayment',

  // Line Summary
  'LineCount',
  'ApplicationCount',

  // Notes
  'PrivateNote',

  // Payment Classification
  // PaymentExtendedType / TxnSource are direct QBO source evidence.
  // IsPrepayment is the canonical derived classification signal.
  // IsEstimateDeposit is legacy derived evidence only; non-canonical.
  'PaymentExtendedType',
  'TxnSource',
  'IsPrepayment',
  'IsEstimateDeposit',

  // Credit Card Payment
  'CreditCardProcessPayment',
  'CreditCardStatus',
  'CreditCardTransactionId',
  'CreditCardAuthorizationTime',
  'CreditCardAVSStreet',
  'CreditCardAVSZip',
  'CreditCardSecurityCodeMatch',
  'CreditCardPaymentJSON',

  // Payment Method
  'PaymentMethodRefJSON',
  'DepositToAccountRefJSON',
  'ARAccountRefJSON',

  // Audit
  'CreateTime',
  'LastUpdatedTime',

  // Source
  'RawJSON'
];


/**
 * Payment application child export columns.
 *
 * One payment line can contain one or more LinkedTxn records.
 */
const PAYMENT_APPLICATION_HEADERS = [

  // Parent Payment
  'PaymentId',
  'PaymentReferenceNumber',
  'PaymentTxnDate',

  // Customer
  'CustomerId',
  'CustomerName',

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
  'IsInvoiceApplication',
  'IsCreditMemoApplication',

  // Source
  'PaymentLineRawJSON',
  'LinkedTxnRawJSON'
];


// =============================================================================
// Public export entry point and internal row builders
// =============================================================================

/**
 * Exports all QBO customer Payments and their applications.
 *
 * Output sheets:
 *   QBO_Payments
 *   QBO_PaymentApplications
 *
 * @return {Object} Export row counts.
 */
function exportQboPayments() {

  safeLog_('Starting QBO payments export.');

  const payments = qboQueryAllGeneric_(
    'SELECT * FROM Payment',
    'Payment'
  );

  safeLog_(`Retrieved ${payments.length} QBO payments.`);

  //
  // Parent Payments
  //
  const paymentRows =
    buildPaymentRows_(payments);

  writeExport_({
    sheetName: 'QBO_Payments',
    headers: PAYMENT_HEADERS,
    rows: paymentRows,

    columnWidths: {
      [PAYMENT_HEADERS.indexOf(
        'PaymentReferenceNumber'
      ) + 1]: 180,

      [PAYMENT_HEADERS.indexOf(
        'CustomerName'
      ) + 1]: 240,

      [PAYMENT_HEADERS.indexOf(
        'PaymentMethodName'
      ) + 1]: 180,

      [PAYMENT_HEADERS.indexOf(
        'DepositToAccountName'
      ) + 1]: 220,

      [PAYMENT_HEADERS.indexOf(
        'PrivateNote'
      ) + 1]: 300,

      [PAYMENT_HEADERS.indexOf(
        'CreditCardPaymentJSON'
      ) + 1]: 300,

      [PAYMENT_HEADERS.indexOf(
        'RawJSON'
      ) + 1]: 300,

      [PAYMENT_HEADERS.indexOf(
        'LinkedDepositIds'
      ) + 1]: 180,

      [PAYMENT_HEADERS.indexOf(
        'LinkedOtherTransactionsJSON'
      ) + 1]: 300,

      [PAYMENT_HEADERS.indexOf(
        'LinkedTransactionsJSON'
      ) + 1]: 300,

      [PAYMENT_HEADERS.indexOf(
        'PaymentMethodRefJSON'
      ) + 1]: 220
    },


    numberFormats: {
      [PAYMENT_HEADERS.indexOf(
        'TxnDate'
      ) + 1]: 'yyyy-mm-dd',

      [PAYMENT_HEADERS.indexOf(
        'ExchangeRate'
      ) + 1]: '0.000000',

      [PAYMENT_HEADERS.indexOf(
        'TotalAmount'
      ) + 1]: '$#,##0.00',

      [PAYMENT_HEADERS.indexOf(
        'UnappliedAmount'
      ) + 1]: '$#,##0.00',

      [PAYMENT_HEADERS.indexOf(
        'AppliedAmount'
      ) + 1]: '$#,##0.00',

      [PAYMENT_HEADERS.indexOf(
        'HomeTotalAmount'
      ) + 1]: '$#,##0.00'
    },

    logMessage:
      `Exported ${paymentRows.length} QBO payments.`
  });

  //
  // Payment Applications
  //
  const applicationRows =
    buildPaymentApplicationRows_(payments);

  writeExport_({
    sheetName: 'QBO_PaymentApplications',
    headers: PAYMENT_APPLICATION_HEADERS,
    rows: applicationRows,

    columnWidths: {
      [PAYMENT_APPLICATION_HEADERS.indexOf(
        'PaymentReferenceNumber'
      ) + 1]: 180,

      [PAYMENT_APPLICATION_HEADERS.indexOf(
        'CustomerName'
      ) + 1]: 240,

      [PAYMENT_APPLICATION_HEADERS.indexOf(
        'LinkedTxnType'
      ) + 1]: 160,

      [PAYMENT_APPLICATION_HEADERS.indexOf(
        'PaymentLineRawJSON'
      ) + 1]: 300,

      [PAYMENT_APPLICATION_HEADERS.indexOf(
        'LinkedTxnRawJSON'
      ) + 1]: 300
    },


    numberFormats: {
      [PAYMENT_APPLICATION_HEADERS.indexOf(
        'PaymentTxnDate'
      ) + 1]: 'yyyy-mm-dd',

      [PAYMENT_APPLICATION_HEADERS.indexOf(
        'PaymentLineAmount'
      ) + 1]: '$#,##0.00'
    },

    logMessage:
      `Exported ${applicationRows.length} ` +
      'QBO payment application rows.'
  });

  safeLog_('Completed QBO payments export.');

  return {
    paymentCount: paymentRows.length,
    paymentApplicationCount:
      applicationRows.length
  };
}


/**
 * Builds rows for QBO_Payments.
 *
 * @param {Object[]} payments QBO Payment objects.
 * @return {Array[]} Rows matching PAYMENT_HEADERS.
 */
function buildPaymentRows_(payments) {

  return payments.map(payment => {

    const meta =
      extractMeta_(payment);

    const lines =
      normalizeArray_(payment.Line);

    const applicationCount =
      countPaymentApplications_(lines);

    // Parent-level Payment.LinkedTxn only. Line-level applications are
    // preserved separately in QBO_PaymentApplications and must not be
    // inferred from these parent-summary columns.
    const linkedTransactions =
      normalizeArray_(
        payment.LinkedTxn
      );

    const linkedTransactionSummary =
      summarizeLinkedTransactionsForTypes_(
        linkedTransactions,
        ['Deposit']
      );

    const totalAmount =
      numberOrBlank_(
        payment.TotalAmt
      );

    const unappliedAmount =
      numberOrBlank_(
        payment.UnappliedAmt
      );

    const appliedAmount =
      calculateAppliedPaymentAmount_(
        payment.TotalAmt,
        payment.UnappliedAmt
      );

    const paymentExtendedType =
      valueOrBlank_(
        payment.PaymentExtendedType
      );

    const txnSource =
      valueOrBlank_(
        payment.TxnSource
      );

    const isPrepayment =
      paymentExtendedType === 'Prepayment';

    const creditChargeInfo =
      payment.CreditCardPayment &&
      payment.CreditCardPayment.CreditChargeInfo
        ? payment.CreditCardPayment.CreditChargeInfo
        : {};

    const creditChargeResponse =
      payment.CreditCardPayment &&
      payment.CreditCardPayment.CreditChargeResponse
        ? payment.CreditCardPayment.CreditChargeResponse
        : {};

    /*
     * Canonical Payment classification contract:
     *
     * - PaymentExtendedType is direct QBO source evidence.
     * - IsPrepayment is the primary normal classification signal and is
     *   derived only from PaymentExtendedType === 'Prepayment'.
     * - IsEstimateDeposit is NOT a direct QBO source field in the current
     *   observed payloads and MUST NOT drive canonical classification.
     *
     * IsEstimateDeposit is retained as a legacy derived evidence signal for
     * backward compatibility and anomaly review. The historical heuristic
     * below intentionally remains unchanged so prior observations stay
     * comparable. Known 2025 Trudy Denny / Bruce Farmer records that satisfy
     * this heuristic are exception/test cases and must not be used to infer
     * ordinary estimate-deposit behavior.
     *
     * A confirmed 2026 estimate-deposit workflow showed a QBO Payment with
     * PaymentExtendedType='Prepayment', TxnSource='INTUITMASPAYMENT', no Line
     * applications, and no parent LinkedTxn. Therefore absence of this legacy
     * heuristic does not mean a Payment is not an estimate deposit.
     */
    const isEstimateDeposit =
      isPrepayment &&
      txnSource === 'INTUITMASPAYMENT' &&
      lines.length === 0 &&
      totalAmount !== '' &&
      unappliedAmount !== '' &&
      Math.abs(
        Number(totalAmount) -
        Number(unappliedAmount)
      ) < 0.005 &&
      linkedTxnTypeCount_(linkedTransactionSummary, 'Deposit') > 0;

    return [

      // Identity
      valueOrBlank_(
        payment.Id
      ),

      valueOrBlank_(
        payment.SyncToken
      ),

      valueOrBlank_(
        payment.PaymentRefNum
      ),

      // Date
      valueOrBlank_(
        payment.TxnDate
      ),

      // Customer
      nestedValue_(
        payment,
        'CustomerRef.value'
      ),

      nestedValue_(
        payment,
        'CustomerRef.name'
      ),

      // Payment Method
      nestedValue_(
        payment,
        'PaymentMethodRef.value'
      ),

      nestedValue_(
        payment,
        'PaymentMethodRef.name'
      ),

      valueOrBlank_(
        payment.PaymentType
      ),

      // Accounts
      nestedValue_(
        payment,
        'DepositToAccountRef.value'
      ),

      nestedValue_(
        payment,
        'DepositToAccountRef.name'
      ),

      nestedValue_(
        payment,
        'ARAccountRef.value'
      ),

      nestedValue_(
        payment,
        'ARAccountRef.name'
      ),

      // Currency
      nestedValue_(
        payment,
        'CurrencyRef.value'
      ),

      nestedValue_(
        payment,
        'CurrencyRef.name'
      ),

      numberOrBlank_(
        payment.ExchangeRate
      ),

      // Amounts
      totalAmount,
      unappliedAmount,
      appliedAmount,

      numberOrBlank_(
        payment.HomeTotalAmt
      ),

      // Linked Transactions: direct parent Payment.LinkedTxn only.
      linkedTransactionSummary.totalCount,
      linkedTxnTypeCount_(linkedTransactionSummary, 'Deposit'),
      linkedTxnTypeIds_(linkedTransactionSummary, 'Deposit'),
      linkedTransactionSummary.otherCount,
      jsonStringifyCellSafe_(linkedTransactionSummary.otherTransactions),
      jsonStringifyCellSafe_(linkedTransactions),

      // Processing
      booleanOrBlank_(
        payment.ProcessPayment
      ),

      // Line Summary
      lines.length,
      applicationCount,

      // Notes
      valueOrBlank_(
        payment.PrivateNote
      ),

      // Payment Classification
      paymentExtendedType,
      txnSource,
      isPrepayment,
      isEstimateDeposit,

      // Credit Card Payment
      booleanOrBlank_(
        creditChargeInfo.ProcessPayment
      ),

      valueOrBlank_(
        creditChargeResponse.Status
      ),

      valueOrBlank_(
        creditChargeResponse.CCTransId
      ),

      valueOrBlank_(
        creditChargeResponse.TxnAuthorizationTime
      ),

      valueOrBlank_(
        creditChargeResponse.AvsStreet
      ),

      valueOrBlank_(
        creditChargeResponse.AvsZip
      ),

      valueOrBlank_(
        creditChargeResponse.CardSecurityCodeMatch
      ),

      jsonStringifyCellSafe_(
        payment.CreditCardPayment
      ),

      // Payment Method
      jsonStringifyCellSafe_(
        payment.PaymentMethodRef
      ),

      jsonStringifyCellSafe_(
        payment.DepositToAccountRef
      ),

      jsonStringifyCellSafe_(
        payment.ARAccountRef
      ),

      // Audit
      valueOrBlank_(
        meta.createTime
      ),

      valueOrBlank_(
        meta.lastUpdatedTime
      ),

      // Source
      jsonStringifyCellSafe_(
        payment
      )
    ];
  });
}


/**
 * Builds rows for QBO_PaymentApplications.
 *
 * Each Payment.Line can contain one or more LinkedTxn
 * references. Each linked transaction becomes one row.
 *
 * Payments with no line-level LinkedTxn records remain
 * represented only in QBO_Payments and have an
 * ApplicationCount of zero.
 *
 * @param {Object[]} payments QBO Payment objects.
 * @return {Array[]} Rows matching
 *   PAYMENT_APPLICATION_HEADERS.
 */
function buildPaymentApplicationRows_(payments) {

  const rows = [];

  payments.forEach(payment => {

    const lines =
      normalizeArray_(
        payment.Line
      );

    lines.forEach((line, lineIndex) => {

      const linkedTransactions =
        normalizeArray_(
          line.LinkedTxn
        );

      linkedTransactions.forEach(
        (linkedTransaction, linkedIndex) => {

          const linkedTxnType =
            valueOrBlank_(
              linkedTransaction.TxnType
            );

          rows.push([

            // Parent Payment
            valueOrBlank_(
              payment.Id
            ),

            valueOrBlank_(
              payment.PaymentRefNum
            ),

            valueOrBlank_(
              payment.TxnDate
            ),

            // Customer
            nestedValue_(
              payment,
              'CustomerRef.value'
            ),

            nestedValue_(
              payment,
              'CustomerRef.name'
            ),

            // Payment Line
            valueOrBlank_(
              line.Id
            ),

            // QBO LineNum when present; otherwise a derived 1-based ordinal.
            getPaymentLineNumber_(
              line,
              lineIndex
            ),

            numberOrBlank_(
              line.Amount
            ),

            // Linked Transaction
            // Derived 1-based ordinal within this Payment line; QBO does not
            // currently populate a separate linked-transaction sequence.
            linkedIndex + 1,

            valueOrBlank_(
              linkedTransaction.TxnId
            ),

            linkedTxnType,

            valueOrBlank_(
              linkedTransaction.TxnLineId
            ),

            // Derived
            linkedTxnType === 'Invoice',

            linkedTxnType === 'CreditMemo',

            // Source
            jsonStringifyCellSafe_(
              line
            ),

            jsonStringifyCellSafe_(
              linkedTransaction
            )
          ]);
        }
      );
    });
  });

  return rows;
}


/**
 * Counts the total number of LinkedTxn applications
 * across every payment line.
 *
 * @param {Object[]} lines Payment line objects.
 * @return {number} Linked transaction count.
 */
function countPaymentApplications_(lines) {

  return lines.reduce(
    (total, line) => {

      return total +
        normalizeArray_(line.LinkedTxn).length;
    },
    0
  );
}


/**
 * Calculates the amount of a Payment that has been applied.
 *
 * Applied Amount = Total Amount - Unapplied Amount
 *
 * Returns blank only when TotalAmt is unavailable.
 *
 * @param {*} totalAmount Payment.TotalAmt.
 * @param {*} unappliedAmount Payment.UnappliedAmt.
 * @return {number|string} Applied amount or blank.
 */
function calculateAppliedPaymentAmount_(
  totalAmount,
  unappliedAmount
) {

  if (
    totalAmount === undefined ||
    totalAmount === null ||
    totalAmount === ''
  ) {
    return '';
  }

  const total = Number(totalAmount);
  const unapplied = Number(
    unappliedAmount || 0
  );

  if (
    !Number.isFinite(total) ||
    !Number.isFinite(unapplied)
  ) {
    return '';
  }

  return total - unapplied;
}


/**
 * Returns the payment line number.
 *
 * Payment Line objects do not always contain LineNum, so
 * their array position is used as a fallback.
 *
 * @param {Object} line Payment line object.
 * @param {number} lineIndex Zero-based array position.
 * @return {*} Payment line number.
 */
function getPaymentLineNumber_(
  line,
  lineIndex
) {

  const lineNumber =
    valueOrBlank_(line.LineNum);

  return lineNumber !== ''
    ? lineNumber
    : lineIndex + 1;
}
