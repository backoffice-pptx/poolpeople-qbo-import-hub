/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 25_ExportPreflight.js
 * Purpose     : Validate production export prerequisites before the daily QBO
 *               export queue begins.
 *
 * Public API:
 *   - testQboExportPreflight()
 *   - testQboManifestDrivenValidation()
 *
 * Internal Helpers:
 *   - validateQboExportPreflight_()
 *   - validateQboManifestPreflight_()
 *   - validateQboDestinationPreflight_()
 *   - validateQboAuthPreflight_()
 *
 * Dependencies:
 *   - Configuration in 00_Config.js
 *   - OAuth helpers in 01_Auth.js
 *   - Export manifest helpers in 22_ExportManifest.js
 *   - Snapshot configuration in 23_ExportSnapshots.js
 *   - Google Apps Script Spreadsheet / Properties services
 *
 * Current Owner:
 *   - 50 QBO Import Hub
 *
 * Architecture Notes:
 *   - This validation is read-only. It does not call QBO, write export data,
 *     create workbooks, create snapshots, or change Script Properties.
 *   - Independent workbook destinations are validated as a set before the
 *     scheduled queue begins. Missing/inaccessible destinations fail the run
 *     before any exporter is launched.
 *   - Each manifest exporter must resolve to a distinct workbook ID. Sharing a
 *     workbook between manifest entries is treated as a configuration error in
 *     the independent-workbook architecture.
 *
 * Change History:
 *   - 2026-09-03: Routed manifest/scheduler checks through the centralized
 *     manifest validator and added a focused read-only validation entry point.
 *   - 2026-09-02: Added run-history workbook configuration/structure to the
 *     production preflight gate.
 *   - 2026-09-01: Added independent-workbook production preflight validation.
 * ============================================================================
 */

/**
 * Runs all production-readiness checks and throws one consolidated error when
 * any prerequisite is invalid.
 *
 * @return {Object} Read-only preflight summary.
 */
function validateQboExportPreflight_() {
  const startedAt = Date.now();
  const errors = [];

  console.log('[PREFLIGHT] | START');

  let manifestResult = null;
  let destinationResult = null;
  let snapshotResult = null;
  let authResult = null;
  let runHistoryResult = null;

  try {
    manifestResult = validateQboManifestPreflight_();
  } catch (error) {
    errors.push(
      'Manifest: ' + (error && error.message ? error.message : String(error))
    );
  }

  if (manifestResult) {
    try {
      destinationResult = validateQboDestinationPreflight_(manifestResult.manifest);
    } catch (error) {
      errors.push(
        'Destinations: ' + (error && error.message ? error.message : String(error))
      );
    }
  }

  try {
    const folder = getQboExportSnapshotFolder_();
    snapshotResult = {
      folderId: folder.getId(),
      folderName: folder.getName()
    };

    console.log(
      '[PREFLIGHT] | SNAPSHOT OK | folder=' + snapshotResult.folderName
    );
  } catch (error) {
    errors.push(
      'Snapshot: ' + (error && error.message ? error.message : String(error))
    );
  }

  try {
    authResult = validateQboAuthPreflight_();
  } catch (error) {
    errors.push(
      'QBO authorization: ' +
      (error && error.message ? error.message : String(error))
    );
  }

  try {
    const runHistorySpreadsheet = getQboRunHistorySpreadsheet_();
    validateQboRunHistoryWorkbookStructure_(runHistorySpreadsheet);
    runHistoryResult = {
      spreadsheetId: runHistorySpreadsheet.getId(),
      workbookName: runHistorySpreadsheet.getName()
    };

    console.log(
      '[PREFLIGHT] | RUN HISTORY OK | workbook=' +
      runHistoryResult.workbookName
    );
  } catch (error) {
    errors.push(
      'Run history: ' +
      (error && error.message ? error.message : String(error))
    );
  }

  if (errors.length > 0) {
    console.error(
      '[PREFLIGHT] | ERROR | count=' + errors.length +
      ' | durationMs=' + (Date.now() - startedAt) +
      ' | details=' + errors.join(' || ')
    );

    throw new Error(
      'QBO export preflight failed with ' + errors.length +
      ' error(s): ' + errors.join(' || ')
    );
  }

  const result = {
    exportCount: manifestResult.exportCount,
    workbookCount: destinationResult.workbookCount,
    sheetCount: destinationResult.sheetCount,
    snapshotFolderId: snapshotResult.folderId,
    realmId: authResult.realmId,
    runHistorySpreadsheetId: runHistoryResult.spreadsheetId,
    timezone: Session.getScriptTimeZone(),
    durationMs: Date.now() - startedAt
  };

  console.log(
    '[PREFLIGHT] | COMPLETE | exports=' + result.exportCount +
    ' | workbooks=' + result.workbookCount +
    ' | sheets=' + result.sheetCount +
    ' | timezone=' + result.timezone +
    ' | durationMs=' + result.durationMs
  );

  return result;
}


/**
 * Verifies manifest identity, workbook ownership, and sheet ownership before
 * destination workbooks are opened.
 *
 * @return {Object} Validated manifest summary.
 */
function validateQboManifestPreflight_() {
  const result = validateQboExportManifest_();

  // Scheduling is a production consumer of the manifest. Validate that every
  // manifest exporter is scheduled exactly once and has one executable entry.
  const scheduleResult = validateDailyQboExportSchedule_();

  console.log(
    '[PREFLIGHT] | MANIFEST OK | exports=' + result.exportCount +
    ' | sheets=' + result.sheetCount +
    ' | scheduledFunctions=' + scheduleResult.scheduledFunctionCount
  );

  return result;
}


/**
 * Public read-only validation focused on manifest-driven controls.
 *
 * This does not open destination workbooks, call QBO, or mutate configuration.
 */
function testQboManifestDrivenValidation() {
  const manifestResult = validateQboExportManifest_();
  const scheduleResult = validateDailyQboExportSchedule_();

  console.log(
    '[MANIFEST VALIDATION] | COMPLETE | exports=' +
    manifestResult.exportCount +
    ' | sheets=' + manifestResult.sheetCount +
    ' | exporterFunctions=' + manifestResult.exporterFunctionCount +
    ' | scheduledFunctions=' + scheduleResult.scheduledFunctionCount
  );

  return {
    exportCount: manifestResult.exportCount,
    sheetCount: manifestResult.sheetCount,
    exporterFunctionCount: manifestResult.exporterFunctionCount,
    scheduledFunctionCount: scheduleResult.scheduledFunctionCount
  };
}


/**
 * Verifies every independent workbook property, workbook access, unique
 * workbook assignment, and every manifest-owned sheet.
 *
 * @param {Object[]} manifest Validated export manifest.
 * @return {Object} Destination validation summary.
 */
function validateQboDestinationPreflight_(manifest) {
  const props = PropertiesService.getScriptProperties();
  const workbookOwners = Object.create(null);
  let sheetCount = 0;

  manifest.forEach(function(entry) {
    const propertyKey = entry.workbookPropertyKey;
    const spreadsheetId = String(props.getProperty(propertyKey) || '').trim();

    if (!spreadsheetId) {
      throw new Error(
        'Missing ' + propertyKey + ' for export ' + entry.key + '.'
      );
    }

    if (workbookOwners[spreadsheetId]) {
      throw new Error(
        'Independent destination workbook ID ' + spreadsheetId +
        ' is assigned to both ' + workbookOwners[spreadsheetId] +
        ' and ' + entry.key + '.'
      );
    }
    workbookOwners[spreadsheetId] = entry.key;

    let spreadsheet;
    try {
      spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    } catch (error) {
      throw new Error(
        'Unable to open destination for ' + entry.key + ' using ' +
        propertyKey + '=' + spreadsheetId + '. Original error: ' +
        (error && error.message ? error.message : String(error))
      );
    }

    entry.sheetNames.forEach(function(sheetName) {
      if (!spreadsheet.getSheetByName(sheetName)) {
        throw new Error(
          'Destination workbook for ' + entry.key +
          ' is missing owned sheet ' + sheetName + '.'
        );
      }
      sheetCount += 1;
    });

    console.log(
      '[PREFLIGHT] | DESTINATION OK | export=' + entry.key +
      ' | workbook=' + spreadsheet.getName() +
      ' | sheets=' + entry.sheetNames.join(', ')
    );
  });

  return {
    workbookCount: Object.keys(workbookOwners).length,
    sheetCount: sheetCount
  };
}


/**
 * Verifies credentials, current OAuth authorization, and stored company realm.
 * No QBO API request is made.
 *
 * @return {Object} Authorization metadata.
 */
function validateQboAuthPreflight_() {
  // getConfig_() validates required client credentials.
  getConfig_();

  const service = getQboService();
  if (!service.hasAccess()) {
    throw new Error('QBO OAuth access is unavailable. Run startAuth() first.');
  }

  const realmId = getQboRealmId_();

  console.log('[PREFLIGHT] | AUTH OK | realmId=' + realmId);

  return {
    realmId: realmId
  };
}


/**
 * Public, non-destructive production-readiness diagnostic.
 *
 * @return {Object} Preflight summary.
 */
function testQboExportPreflight() {
  return validateQboExportPreflight_();
}
