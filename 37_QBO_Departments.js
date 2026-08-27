/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 37_QBO_Departments.js
 * Purpose     : Export QBO Department master data to structured Google Sheets tables.
 *
 * Public API:
 *   - exportQboDepartments()
 *
 * Internal Helpers:
 *   - buildDepartmentRows_()
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
 * 37_QBO_Departments.gs
 * QBO Department export
 *
 * Output Sheet:
 *   QBO_Departments
 *
 * Public Functions:
 *   exportQboDepartments()
 ***********************/


/**
 * Department export columns.
 */
const DEPARTMENT_HEADERS = [

  // Identity
  'Id',
  'SyncToken',
  'Active',

  // Classification
  'Name',
  'FullyQualifiedName',
  'SubDepartment',

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
 * Exports all active and inactive QBO Departments.
 *
 * Output sheet:
 *   QBO_Departments
 *
 * @return {Object} Export row count.
 */
function exportQboDepartments() {

  safeLog_('Starting QBO departments export.');

  const departments = qboQueryAllGeneric_(
    'SELECT * FROM Department WHERE Active IN (true, false)',
    'Department'
  );

  safeLog_(`Retrieved ${departments.length} QBO departments.`);

  const departmentRows = buildDepartmentRows_(departments);

  writeExport_({
    sheetName: 'QBO_Departments',
    headers: DEPARTMENT_HEADERS,
    rows: departmentRows,
    columnWidths: {
      [DEPARTMENT_HEADERS.indexOf('Name') + 1]: 220,
      [DEPARTMENT_HEADERS.indexOf('FullyQualifiedName') + 1]: 280,
      [DEPARTMENT_HEADERS.indexOf('ParentName') + 1]: 220,
      [DEPARTMENT_HEADERS.indexOf('RawJSON') + 1]: 300
    },
    logMessage: `Exported ${departmentRows.length} QBO departments.`
  });

  safeLog_('Completed QBO departments export.');

  return {
    departmentCount: departmentRows.length
  };
}


/**
 * Builds rows for the QBO_Departments sheet.
 *
 * @param {Object[]} departments QBO Department objects.
 * @return {Array[]} Rows matching DEPARTMENT_HEADERS.
 */
function buildDepartmentRows_(departments) {

  return departments.map(department => {
    const meta = extractMeta_(department);

    return [
      // Identity
      valueOrBlank_(department.Id),
      valueOrBlank_(department.SyncToken),
      booleanOrBlank_(department.Active),

      // Classification
      valueOrBlank_(department.Name),
      valueOrBlank_(department.FullyQualifiedName),
      booleanOrBlank_(department.SubDepartment),

      // Hierarchy
      nestedValue_(department, 'ParentRef.value'),
      nestedValue_(department, 'ParentRef.name'),

      // Audit
      valueOrBlank_(meta.createTime),
      valueOrBlank_(meta.lastUpdatedTime),

      // Source
      jsonStringifySafe_(department)
    ];
  });
}