/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 34_QBO_Terms.js
 * Purpose     : Export QBO Term master data to structured Google Sheets tables.
 *
 * Public API:
 *   - exportQboTerms()
 *
 * Internal Helpers:
 *   - buildTermRows_()
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
 * 34_QBO_Terms.gs
 * QBO Term export
 *
 * Output Sheet:
 *   QBO_Terms
 *
 * Public Functions:
 *   exportQboTerms()
 ***********************/


/**
 * Payment Term export columns.
 */
const TERM_HEADERS = [

  // Identity
  'Id',
  'SyncToken',
  'Active',

  // Name
  'Name',

  // Standard Terms
  'Type',
  'DueDays',
  'DiscountDays',
  'DiscountPercent',

  // Date Driven Terms
  'DayOfMonthDue',
  'DueNextMonthDays',

  // Audit
  'CreateTime',
  'LastUpdatedTime',

  // Source
  'RawJSON'
];


/**
 * Exports all active and inactive QBO Payment Terms.
 *
 * Output sheet:
 *   QBO_Terms
 *
 * @return {Object} Export row count.
 */
function exportQboTerms() {

  safeLog_('Starting QBO terms export.');

  const terms = qboQueryAllGeneric_(
    'SELECT * FROM Term WHERE Active IN (true, false)',
    'Term'
  );

  safeLog_(`Retrieved ${terms.length} QBO terms.`);

  const termRows = buildTermRows_(terms);

  writeExport_({
    sheetName: 'QBO_Terms',
    headers: TERM_HEADERS,
    rows: termRows,
    columnWidths: {
      [TERM_HEADERS.indexOf('Name') + 1]: 220,
      [TERM_HEADERS.indexOf('RawJSON') + 1]: 300
    },
    logMessage: `Exported ${termRows.length} QBO terms.`
  });

  safeLog_('Completed QBO terms export.');

  return {
    termCount: termRows.length
  };
}


/**
 * Builds rows for the QBO_Terms sheet.
 *
 * @param {Object[]} terms QBO Term objects.
 * @return {Array[]} Rows matching TERM_HEADERS.
 */
function buildTermRows_(terms) {

  return terms.map(term => {

    const meta = extractMeta_(term);

    const std = term.StandardTerm || {};
    const dateDriven = term.DateDrivenTerm || {};

    let type = '';

    if (term.StandardTerm) {
      type = 'Standard';
    }
    else if (term.DateDrivenTerm) {
      type = 'DateDriven';
    }

    return [

      // Identity
      valueOrBlank_(term.Id),
      valueOrBlank_(term.SyncToken),
      booleanOrBlank_(term.Active),

      // Name
      valueOrBlank_(term.Name),

      // Type
      type,

      // Standard Terms
      numberOrBlank_(std.DueDays),
      numberOrBlank_(std.DiscountDays),
      numberOrBlank_(std.DiscountPercent),

      // Date Driven Terms
      numberOrBlank_(dateDriven.DayOfMonthDue),
      numberOrBlank_(dateDriven.DueNextMonthDays),

      // Audit
      valueOrBlank_(meta.createTime),
      valueOrBlank_(meta.lastUpdatedTime),

      // Source
      jsonStringifySafe_(term)

    ];

  });

}