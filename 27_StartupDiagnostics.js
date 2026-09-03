/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 27_StartupDiagnostics.js
 * Purpose     : Provide a fast, read-only, redacted view of Application 50
 *               configuration before external workbook/API access begins.
 *
 * Public API:
 *   - testQboStartupDiagnostics()
 *
 * Internal Helpers:
 *   - validateQboStartupConfiguration_()
 *   - validateQboSchedulePolicyConfiguration_()
 *
 * Dependencies:
 *   - Configuration in 00_Config.js
 *   - Export manifest helpers in 22_ExportManifest.js
 *   - Scheduler constants in 24_TriggerManagement.js
 *   - Google Apps Script Properties / Session services
 *
 * Architecture Notes:
 *   - This module reads configuration only. It does not open export workbooks,
 *     access Drive folders, call QBO, create triggers, or write properties.
 *   - Credentials are never logged or returned. Diagnostics expose only
 *     presence/absence and non-sensitive configuration metadata.
 *   - Full accessibility/authorization validation remains the responsibility
 *     of 25_ExportPreflight.js.
 *
 * Change History:
 *   - 2026-09-03: Added centralized startup/configuration diagnostics.
 * ============================================================================
 */

/**
 * Validates configuration that can be checked without external resource access.
 * Throws one consolidated error so missing settings can be corrected together.
 *
 * @return {Object} Redacted startup configuration summary.
 */
function validateQboStartupConfiguration_() {
  const scriptProps = PropertiesService.getScriptProperties();
  const userProps = PropertiesService.getUserProperties();
  const manifestResult = validateQboExportManifest_();
  const scheduleResult = validateDailyQboExportSchedule_();
  const errors = [];

  const clientIdPresent =
    Boolean(String(scriptProps.getProperty(SCRIPT_PROPERTY_KEYS.CLIENT_ID) || '').trim());
  const clientSecretPresent =
    Boolean(String(scriptProps.getProperty(SCRIPT_PROPERTY_KEYS.CLIENT_SECRET) || '').trim());
  const snapshotFolderPresent =
    Boolean(String(scriptProps.getProperty(SCRIPT_PROPERTY_KEYS.SNAPSHOT_FOLDER_ID) || '').trim());
  const runHistoryPresent =
    Boolean(String(scriptProps.getProperty(
      SCRIPT_PROPERTY_KEYS.RUN_HISTORY_SPREADSHEET_ID
    ) || '').trim());
  const realmIdPresent =
    Boolean(String(userProps.getProperty(USER_PROPERTY_KEYS.REALM_ID) || '').trim());

  if (!clientIdPresent) {
    errors.push('Missing ' + SCRIPT_PROPERTY_KEYS.CLIENT_ID + '.');
  }
  if (!clientSecretPresent) {
    errors.push('Missing ' + SCRIPT_PROPERTY_KEYS.CLIENT_SECRET + '.');
  }
  if (!snapshotFolderPresent) {
    errors.push('Missing ' + SCRIPT_PROPERTY_KEYS.SNAPSHOT_FOLDER_ID + '.');
  }
  if (!runHistoryPresent) {
    errors.push('Missing ' + SCRIPT_PROPERTY_KEYS.RUN_HISTORY_SPREADSHEET_ID + '.');
  }
  if (!realmIdPresent) {
    errors.push('Missing user property ' + USER_PROPERTY_KEYS.REALM_ID + '.');
  }

  const configuredDestinationKeys = [];
  const missingDestinationKeys = [];

  manifestResult.manifest.forEach(function(entry) {
    const value = String(
      scriptProps.getProperty(entry.workbookPropertyKey) || ''
    ).trim();

    if (value) {
      configuredDestinationKeys.push(entry.key);
    } else {
      missingDestinationKeys.push(entry.key);
    }
  });

  if (missingDestinationKeys.length > 0) {
    errors.push(
      'Missing destination workbook configuration for: ' +
      missingDestinationKeys.join(', ') + '.'
    );
  }

  const minorVersionRaw = String(
    scriptProps.getProperty(SCRIPT_PROPERTY_KEYS.MINOR_VERSION) || '75'
  ).trim();

  if (!/^\d+$/.test(minorVersionRaw) || Number(minorVersionRaw) <= 0) {
    errors.push(
      SCRIPT_PROPERTY_KEYS.MINOR_VERSION +
      ' must be a positive integer when configured.'
    );
  }

  const timezone = String(Session.getScriptTimeZone() || '').trim();
  if (!timezone) {
    errors.push('Apps Script project timezone is unavailable.');
  }

  try {
    validateQboSchedulePolicyConfiguration_();
  } catch (error) {
    errors.push(error && error.message ? error.message : String(error));
  }

  if (errors.length > 0) {
    console.error(
      '[STARTUP] | CONFIG ERROR | count=' + errors.length +
      ' | details=' + errors.join(' || ')
    );

    throw new Error(
      'QBO startup configuration failed with ' + errors.length +
      ' error(s): ' + errors.join(' || ')
    );
  }

  const result = {
    clientIdPresent: clientIdPresent,
    clientSecretPresent: clientSecretPresent,
    realmIdPresent: realmIdPresent,
    snapshotFolderPresent: snapshotFolderPresent,
    runHistoryPresent: runHistoryPresent,
    configuredDestinations: configuredDestinationKeys.length,
    expectedDestinations: manifestResult.exportCount,
    manifestExports: manifestResult.exportCount,
    manifestSheets: manifestResult.sheetCount,
    scheduledFunctions: scheduleResult.scheduledFunctionCount,
    minorVersion: minorVersionRaw,
    timezone: timezone,
    scheduleStart:
      padTwoDigits_(DAILY_EXPORT_SCHEDULE.START_HOUR) + ':' +
      padTwoDigits_(DAILY_EXPORT_SCHEDULE.START_MINUTE),
    nextExportDelayMs: DAILY_EXPORT_SCHEDULE.NEXT_EXPORT_DELAY_MS
  };

  console.log(
    '[STARTUP] | CONFIG OK' +
    ' | credentials=2/2' +
    ' | realm=present' +
    ' | destinations=' + result.configuredDestinations +
      '/' + result.expectedDestinations +
    ' | snapshot=present' +
    ' | runHistory=present' +
    ' | minorVersion=' + result.minorVersion +
    ' | timezone=' + result.timezone +
    ' | schedule=' + result.scheduleStart +
    ' | nextDelayMs=' + result.nextExportDelayMs
  );

  return result;
}


/**
 * Validates scheduler policy constants without creating or inspecting triggers.
 */
function validateQboSchedulePolicyConfiguration_() {
  if (
    !Number.isInteger(DAILY_EXPORT_SCHEDULE.START_HOUR) ||
    DAILY_EXPORT_SCHEDULE.START_HOUR < 0 ||
    DAILY_EXPORT_SCHEDULE.START_HOUR > 23
  ) {
    throw new Error(
      'DAILY_EXPORT_SCHEDULE.START_HOUR must be an integer from 0 through 23.'
    );
  }

  if (
    !Number.isInteger(DAILY_EXPORT_SCHEDULE.START_MINUTE) ||
    DAILY_EXPORT_SCHEDULE.START_MINUTE < 0 ||
    DAILY_EXPORT_SCHEDULE.START_MINUTE > 59
  ) {
    throw new Error(
      'DAILY_EXPORT_SCHEDULE.START_MINUTE must be an integer from 0 through 59.'
    );
  }

  if (
    !Number.isFinite(DAILY_EXPORT_SCHEDULE.NEXT_EXPORT_DELAY_MS) ||
    DAILY_EXPORT_SCHEDULE.NEXT_EXPORT_DELAY_MS < 60 * 1000
  ) {
    throw new Error(
      'DAILY_EXPORT_SCHEDULE.NEXT_EXPORT_DELAY_MS must be at least 60000 ms.'
    );
  }

  return true;
}


/**
 * Public fast startup/configuration diagnostic.
 *
 * This is intentionally lighter than testQboExportPreflight(): it validates
 * configuration presence and policy only, without opening Google resources or
 * checking live OAuth access.
 *
 * @return {Object} Redacted startup configuration summary.
 */
function testQboStartupDiagnostics() {
  return validateQboStartupConfiguration_();
}
