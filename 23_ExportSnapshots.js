/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 23_ExportSnapshots.js
 * Purpose     : Create immutable timestamped workbook copies after successful
 *               independent QBO exporter runs.
 *
 * Public API:
 *   - testQboSnapshotConfiguration()
 *
 * Internal Helpers:
 *   - createQboExportSnapshot_()
 *   - getQboExportSnapshotFolder_()
 *   - buildQboExportSnapshotName_()
 *
 * Dependencies:
 *   - QBO_EXPORT_MANIFEST helpers in 22_ExportManifest.js
 *   - Independent destination routing in 20_Utils.js
 *   - Google DriveApp / SpreadsheetApp services
 *
 * Current Owner:
 *   - 50 QBO Import Hub
 *
 * Architecture Notes:
 *   - CURRENT workbooks remain the live refresh targets.
 *   - Every successful exporter run creates a new immutable workbook copy in
 *     the configured SNAPSHOTS folder.
 *   - Exporter-completion tracking lives in 21_ExportFramework.js. This
 *     module creates a snapshot only after that framework confirms every
 *     manifest-owned sheet succeeded in the current execution.
 *   - Snapshot failure is intentionally fatal to the exporter execution. The
 *     CURRENT workbook may already contain the refreshed data, but the run is
 *     not considered fully successful unless its historical snapshot exists.
 *   - Snapshot creation occurs while the shared export write lock is held so a
 *     concurrent export cannot mutate the source workbook between its final
 *     table write and the Drive copy operation.
 *
 * Required Script Property:
 *   - QBO_EXPORT_SNAPSHOT_FOLDER_ID
 *
 * Change History:
 *   - 2026-09-01: Removed final-sheet inference from snapshot orchestration.
 *     Exporter completion is now established centrally by the export framework
 *     before createQboExportSnapshot_() is called.
 *   - 2026-09-01: Added successful-export workbook snapshots for the
 *     independent-workbook architecture.
 * ============================================================================
 */

/**
 * Copies one configured CURRENT export workbook into the snapshot folder.
 *
 * @param {string} exportKey Stable QBO export manifest key.
 * @return {Object} Snapshot metadata.
 */
function createQboExportSnapshot_(exportKey) {
  const entry = getQboExportManifestEntry_(exportKey);

  if (!entry) {
    throw new Error(
      'Cannot create QBO export snapshot for unknown export key ' +
      String(exportKey || '') + '.'
    );
  }

  const spreadsheetId = getExportSpreadsheetId_(entry.sheetNames[0]);
  const snapshotFolder = getQboExportSnapshotFolder_();

  let sourceFile;

  try {
    sourceFile = DriveApp.getFileById(spreadsheetId);
  } catch (error) {
    throw new Error(
      'Unable to access CURRENT workbook file for snapshot of ' + entry.key +
      ' using spreadsheet ID ' + spreadsheetId + '. Original error: ' +
      (error && error.message ? error.message : String(error))
    );
  }

  // Commit pending Spreadsheet service changes before Drive copies the file.
  SpreadsheetApp.flush();

  const snapshotName = buildQboExportSnapshotName_(sourceFile.getName());
  const startedAt = Date.now();

  try {
    const snapshotFile = sourceFile.makeCopy(snapshotName, snapshotFolder);

    safeLog_(
      '[SNAPSHOT] | COMPLETE | export=' + entry.key +
      ' | source=' + sourceFile.getName() +
      ' | snapshot=' + snapshotName +
      ' | fileId=' + snapshotFile.getId() +
      ' | durationMs=' + (Date.now() - startedAt)
    );

    return {
      exportKey: entry.key,
      sourceSpreadsheetId: spreadsheetId,
      snapshotFileId: snapshotFile.getId(),
      snapshotName: snapshotName
    };
  } catch (error) {
    safeLog_(
      '[SNAPSHOT] | ERROR | export=' + entry.key +
      ' | source=' + sourceFile.getName() +
      ' | durationMs=' + (Date.now() - startedAt) +
      ' | error=' + (error && error.message ? error.message : String(error))
    );

    throw new Error(
      'QBO export data was written successfully for ' + entry.key +
      ', but the required snapshot copy failed. Original error: ' +
      (error && error.message ? error.message : String(error))
    );
  }
}


/**
 * Opens and validates the configured snapshot destination folder.
 *
 * @return {GoogleAppsScript.Drive.Folder} Configured snapshot folder.
 */
function getQboExportSnapshotFolder_() {
  const props = PropertiesService.getScriptProperties();
  const propertyKey = SCRIPT_PROPERTY_KEYS.SNAPSHOT_FOLDER_ID;
  const folderId = String(props.getProperty(propertyKey) || '').trim();

  if (!folderId) {
    throw new Error(
      'Missing required snapshot destination configuration. Set Script ' +
      'Property ' + propertyKey + ' to the Google Drive SNAPSHOTS folder ID.'
    );
  }

  try {
    return DriveApp.getFolderById(folderId);
  } catch (error) {
    throw new Error(
      'Unable to open QBO export snapshot folder using ' + propertyKey + '=' +
      folderId + '. Verify the folder ID and this script account\'s access. ' +
      'Original error: ' +
      (error && error.message ? error.message : String(error))
    );
  }
}


/**
 * Builds one immutable snapshot filename from the CURRENT workbook name.
 *
 * @param {string} sourceName Current workbook file name.
 * @return {string} Timestamped snapshot file name.
 */
function buildQboExportSnapshotName_(sourceName) {
  const timestamp = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    EXPORT_SNAPSHOT.TIMESTAMP_FORMAT
  );

  return String(sourceName || 'QBO_Export') + '_' + timestamp;
}


/**
 * Human-readable configuration test. This verifies only that the configured
 * snapshot folder exists and is accessible; it does not create a snapshot.
 *
 * @return {Object} Snapshot destination metadata.
 */
function testQboSnapshotConfiguration() {
  const folder = getQboExportSnapshotFolder_();
  const result = {
    folderId: folder.getId(),
    folderName: folder.getName()
  };

  safeLog_(
    '[SNAPSHOT] | CONFIG OK | folder=' + result.folderName +
    ' | folderId=' + result.folderId
  );

  return result;
}
