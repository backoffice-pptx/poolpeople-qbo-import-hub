/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 31_QBO_Preferences.js
 * Purpose     : Export QBO company Preferences data to structured Google Sheets tables.
 *
 * Public API:
 *   - exportQboPreferences()
 *
 * Internal Helpers:
 *   - flattenObjectToRows_()
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
 * 31_QBO_Preferences.gs
 * QBO company preferences export
 ***********************/

/**
 * Pulls QBO company preferences into QBO_Preferences.
 *
 * This preserves:
 * - A flattened key/value view for analysis
 * - The full value in RawJSON
 */
function exportQboPreferences() {
  safeLog_('Starting QBO preferences export.');

  const cfg = getConfig_();

  const response = qboGet_(
    `preferences?minorversion=${cfg.minorVersion}`
  );

  const preferences = response.Preferences || {};

  const flattened = [];

  flattenObjectToRows_(
    preferences,
    '',
    flattened
  );

  const headers = [
    'Path',
    'Value',
    'ValueType',
    'RawJSON'
  ];

  const rows = flattened.map(item => [
    item.path,
    normalizeCellValue_(item.value),
    item.type,
    jsonStringifySafe_(item.value)
  ]);

  writeExport_({
    sheetName: 'QBO_Preferences',
    headers: headers,
    rows: rows,
    columnWidths: {
      1: 400,
      2: 300,
      4: 300
    },
    logMessage:
      `Exported ${rows.length} QBO preference values.`
  });
}


/**
 * Recursively converts an object into path/value rows.
 *
 * Examples:
 * SalesFormsPrefs.CustomTxnNumbers
 * AccountingInfoPrefs.FirstMonthOfFiscalYear
 */
function flattenObjectToRows_(
  value,
  currentPath,
  output
) {
  if (
    value === null ||
    value === undefined
  ) {
    output.push({
      path: currentPath,
      value: '',
      type: 'null'
    });

    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      output.push({
        path: currentPath,
        value: [],
        type: 'array'
      });

      return;
    }

    value.forEach((item, index) => {
      const nextPath = currentPath
        ? `${currentPath}[${index}]`
        : `[${index}]`;

      flattenObjectToRows_(
        item,
        nextPath,
        output
      );
    });

    return;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);

    if (keys.length === 0) {
      output.push({
        path: currentPath,
        value: {},
        type: 'object'
      });

      return;
    }

    keys.forEach(key => {
      const nextPath = currentPath
        ? `${currentPath}.${key}`
        : key;

      flattenObjectToRows_(
        value[key],
        nextPath,
        output
      );
    });

    return;
  }

  output.push({
    path: currentPath,
    value: value,
    type: typeof value
  });
}