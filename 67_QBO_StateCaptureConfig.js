/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 67_QBO_StateCaptureConfig.js
 * Purpose     : Configuration and schema contract for the canonical QBO State
 *               Capture workbook and FULL_EXPORT source registration,
 *               including controlled pre-run-history Master Backup evidence
 *               and automatic registration of newly completed scheduled exports.
 *
 * Architecture:
 *   - QBO_ExportRunHistory remains the authoritative acquisition history for
 *     run-history-backed FULL_EXPORT sources. State Capture source registration
 *     is only a processing ledger.
 *   - Master Backups created before QBO_ExportRunHistory existed are registered
 *     explicitly as FULL_EXPORT_LEGACY without manufacturing RunIds/timestamps.
 *   - The canonical State Capture workbook lives under the governed
 *     QuickBooks/Change Evidence/Captured States folder.
 *   - FULL_EXPORT sources are eligible only when the export run completed and
 *     exact Master Backup lineage is present and accessible.
 *   - Current QBO query exporters are unbounded retrievals, so their scope is
 *     described as ALL_RETRIEVABLE_ENTITIES rather than ALL_ENTITIES.
 * ============================================================================
 */

const QBO_STATE_CAPTURE = Object.freeze({
  VERSION: '1.2.0',
  WORKBOOK_TITLE: 'QBO State Capture',
  ENVIRONMENT: 'PROD',
  CAPTURED_STATES_FOLDER_ASSET_KEY: 'QBO_CAPTURED_STATES_FOLDER',
  EXPECTED_FOLDER_NAME: 'Captured States',
  EXPECTED_PARENT_FOLDER_NAME: 'Change Evidence',
  EXPECTED_GRANDPARENT_FOLDER_NAME: 'QuickBooks',
  HEADER_ROW: 1,
  SHEETS: Object.freeze({
    CONTROL: '00_Control',
    SOURCES: '01_Sources',
    STATES: '10_State_Capture',
    RUN_LOG: '90_Run_Log'
  }),
  SOURCE_ACQUISITION_TYPE: 'FULL_EXPORT',
  LEGACY_SOURCE_ACQUISITION_TYPE: 'FULL_EXPORT_LEGACY',
  LINEAGE_BASIS_RUN_HISTORY: 'QBO_EXPORT_RUN_HISTORY',
  LINEAGE_BASIS_PRE_RUN_HISTORY: 'MASTER_BACKUP_PRE_RUN_HISTORY',
  SOURCE_STATUS_AVAILABLE: 'AVAILABLE',
  PROCESSING_STATUS_UNPROCESSED: 'UNPROCESSED',
  RAW_SCOPE_ALL_RETRIEVABLE: 'ALL_RETRIEVABLE_ENTITIES',
  PREFERENCES_SCOPE: 'CURRENT_PREFERENCES',
  EXECUTION_LOCK_TIMEOUT_MS: 30000
});

const QBO_STATE_CAPTURE_HEADERS = Object.freeze({
  CONTROL: Object.freeze([
    'Key',
    'Value'
  ]),
  SOURCES: Object.freeze([
    'SourceId',
    'SourceAcquisitionType',
    'SourceRunId',
    'ExportKey',
    'ExportFunction',
    'ObservationStartedAt',
    'ObservationCompletedAt',
    'MasterBackupFileId',
    'MasterBackupFileName',
    'SourceLineageBasis',
    'SourceScopeType',
    'SourceScopeStart',
    'SourceScopeEnd',
    'SourceScopeComplete',
    'SourceStatus',
    'RegisteredAt',
    'ProcessedAt',
    'ProcessingStatus',
    'ProcessingError'
  ]),
  STATES: Object.freeze([
    'CaptureId',
    'CaptureVersion',
    'SourceAcquisitionType',
    'SourceRunId',
    'ExportKey',
    'ExportFunction',
    'ObservationStartedAt',
    'ObservationCompletedAt',
    'MasterBackupFileId',
    'MasterBackupFileName',
    'SourceSheetName',
    'SourceRowNumber',
    'EntityType',
    'EntityId',
    'QboCreateTime',
    'QboLastUpdatedTime',
    'QboSyncToken',
    'StateHash',
    'RawPayloadHash',
    'RawPayloadComplete',
    'CaptureReason',
    'CapturedAt'
  ]),
  RUN_LOG: Object.freeze([
    'CaptureRunId',
    'StartedAt',
    'CompletedAt',
    'Operation',
    'Status',
    'SourceRowsScanned',
    'EligibleSources',
    'AlreadyRegistered',
    'RegisteredSources',
    'SkippedSources',
    'Error'
  ])
});

/**
 * FULL_EXPORT source-scope contract derived from the current 22-export
 * manifest/exporter implementation.
 *
 * Preferences is not a normal QBO entity query. It represents the current
 * Preferences payload flattened into Path/Value rows and is therefore tracked
 * with a distinct source-scope type.
 */
function getQboStateCaptureFullExportScope_(exportKey) {
  const key = String(exportKey || '').trim();
  if (key === 'PREFERENCES') {
    return {
      sourceScopeType: QBO_STATE_CAPTURE.PREFERENCES_SCOPE,
      sourceScopeStart: '',
      sourceScopeEnd: '',
      sourceScopeComplete: true
    };
  }

  return {
    sourceScopeType: QBO_STATE_CAPTURE.RAW_SCOPE_ALL_RETRIEVABLE,
    sourceScopeStart: '',
    sourceScopeEnd: '',
    sourceScopeComplete: true
  };
}
