/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 35_QBO_PaymentMethods.js
 * Purpose     : Export QBO PaymentMethod master data to structured Google Sheets tables.
 *
 * Public API:
 *   - exportQboPaymentMethods()
 *
 * Internal Helpers:
 *   - buildPaymentMethodRows_()
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
 * 35_QBO_PaymentMethods.gs
 * QBO Payment Method export
 *
 * Output Sheet:
 *   QBO_PaymentMethods
 *
 * Public Functions:
 *   exportQboPaymentMethods()
 ***********************/


/**
 * Payment Method export columns.
 */
const PAYMENT_METHOD_HEADERS = [

  // Identity
  'Id',
  'SyncToken',
  'Active',

  // Name
  'Name',
  'Type',

  // Audit
  'CreateTime',
  'LastUpdatedTime',

  // Source
  'RawJSON'
];


/**
 * Exports all active and inactive QBO Payment Methods.
 *
 * Output sheet:
 *   QBO_PaymentMethods
 *
 * @return {Object} Export row count.
 */
function exportQboPaymentMethods() {

  safeLog_('Starting QBO payment methods export.');

  const paymentMethods = qboQueryAllGeneric_(
    'SELECT * FROM PaymentMethod WHERE Active IN (true, false)',
    'PaymentMethod'
  );

  safeLog_(`Retrieved ${paymentMethods.length} QBO payment methods.`);

  const paymentMethodRows = buildPaymentMethodRows_(paymentMethods);

  writeExport_({
    sheetName: 'QBO_PaymentMethods',
    headers: PAYMENT_METHOD_HEADERS,
    rows: paymentMethodRows,
    columnWidths: {
      [PAYMENT_METHOD_HEADERS.indexOf('Name') + 1]: 220,
      [PAYMENT_METHOD_HEADERS.indexOf('RawJSON') + 1]: 300
    },
    logMessage: `Exported ${paymentMethodRows.length} QBO payment methods.`
  });

  safeLog_('Completed QBO payment methods export.');

  return {
    paymentMethodCount: paymentMethodRows.length
  };
}


/**
 * Builds rows for the QBO_PaymentMethods sheet.
 *
 * @param {Object[]} paymentMethods QBO Payment Method objects.
 * @return {Array[]} Rows matching PAYMENT_METHOD_HEADERS.
 */
function buildPaymentMethodRows_(paymentMethods) {

  return paymentMethods.map(paymentMethod => {

    const meta = extractMeta_(paymentMethod);

    return [

      // Identity
      valueOrBlank_(paymentMethod.Id),
      valueOrBlank_(paymentMethod.SyncToken),
      booleanOrBlank_(paymentMethod.Active),

      // Name
      valueOrBlank_(paymentMethod.Name),
      valueOrBlank_(paymentMethod.Type),

      // Audit
      valueOrBlank_(meta.createTime),
      valueOrBlank_(meta.lastUpdatedTime),

      // Source
      jsonStringifySafe_(paymentMethod)

    ];

  });

}