/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 33_QBO_Classes.js
 * Purpose     : Export QBO Class master data to structured Google Sheets tables.
 *
 * Public API:
 *   - exportQboClasses()
 *
 * Internal Helpers:
 *   - buildClassRows_()
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
 * 33_QBO_Classes.gs
 * QBO Class export
 *
 * Output Sheet:
 *   QBO_Classes
 *
 * Public Functions:
 *   exportQboClasses()
 ***********************/


/**
 * Class export columns.
 */
const CLASS_HEADERS = [

  // Identity
  'Id',
  'SyncToken',
  'Active',

  // Classification
  'Name',
  'FullyQualifiedName',
  'SubClass',

  // Hierarchy
  'ParentId',
  'ParentName',

  // Audit
  'CreateTime',
  'LastUpdatedTime',

  // Source
  'RawJSON'
];


/**
 * Exports all active and inactive QBO Classes.
 *
 * Output sheet:
 *   QBO_Classes
 *
 * @return {Object} Export row count.
 */
function exportQboClasses() {

  safeLog_('Starting QBO classes export.');

  const classes = qboQueryAllGeneric_(
    'SELECT * FROM Class WHERE Active IN (true, false)',
    'Class'
  );

  safeLog_(`Retrieved ${classes.length} QBO classes.`);

  const classRows = buildClassRows_(classes);

  writeExport_({
    sheetName: 'QBO_Classes',
    headers: CLASS_HEADERS,
    rows: classRows,
    columnWidths: {
      [CLASS_HEADERS.indexOf('Name') + 1]: 220,
      [CLASS_HEADERS.indexOf('FullyQualifiedName') + 1]: 280,
      [CLASS_HEADERS.indexOf('ParentName') + 1]: 220,
      [CLASS_HEADERS.indexOf('RawJSON') + 1]: 300
    },
    logMessage: `Exported ${classRows.length} QBO classes.`
  });

  safeLog_('Completed QBO classes export.');

  return {
    classCount: classRows.length
  };
}


/**
 * Builds rows for the QBO_Classes sheet.
 *
 * @param {Object[]} classes QBO Class objects.
 * @return {Array[]} Rows matching CLASS_HEADERS.
 */
function buildClassRows_(classes) {

  return classes.map(qboClass => {
    const meta = extractMeta_(qboClass);

    return [
      // Identity
      valueOrBlank_(qboClass.Id),
      valueOrBlank_(qboClass.SyncToken),
      booleanOrBlank_(qboClass.Active),

      // Classification
      valueOrBlank_(qboClass.Name),
      valueOrBlank_(qboClass.FullyQualifiedName),
      booleanOrBlank_(qboClass.SubClass),

      // Hierarchy
      nestedValue_(qboClass, 'ParentRef.value'),
      nestedValue_(qboClass, 'ParentRef.name'),

      // Audit
      valueOrBlank_(meta.createTime),
      valueOrBlank_(meta.lastUpdatedTime),

      // Source
      jsonStringifySafe_(qboClass)
    ];
  });
}