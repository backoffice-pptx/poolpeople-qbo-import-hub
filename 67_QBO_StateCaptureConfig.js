/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 67_QBO_StateCaptureConfig.js
 * Purpose     : Configuration and schema contract for the canonical QBO State
 *               Capture workbook and FULL_EXPORT source registration,
 *               including controlled pre-run-history Master Backup evidence, automatic
 *               registration of newly completed scheduled exports, Phase 2 read-only
 *               audit configuration, and the production state-write contract.
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
  VERSION: '1.5.43',
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
    RUN_LOG: '90_Run_Log',
    CANONICAL_CONTROL: '00_Controls',
    CDC_RUN_MANIFEST: '02_CDC_Run_Manifest',
    NATIVE_CDC_EVENTS: '03_Native_CDC_Events',
    WEBHOOK_EVENTS: '04_Webhook_Events',
    SNAPSHOTS: '10_Snapshot_Records',
    CHANGES: '11_Change_Records',
    CHANGE_DETAIL: '12_Change_Detail',
    INGESTION_LOG: '90_Ingestion_Log',
    CONTRACT_AUDIT_PATHS: '91_Contract_Audit_Paths',
    CONTRACT_AUDIT_SOURCES: '92_Contract_Audit_Sources',
    CONTRACT_AUDIT_RUNS: '93_Contract_Audit_Runs'
  }),
  SOURCE_ACQUISITION_TYPE: 'FULL_EXPORT',
  LEGACY_SOURCE_ACQUISITION_TYPE: 'FULL_EXPORT_LEGACY',
  LINEAGE_BASIS_RUN_HISTORY: 'QBO_EXPORT_RUN_HISTORY',
  LINEAGE_BASIS_PRE_RUN_HISTORY: 'MASTER_BACKUP_PRE_RUN_HISTORY',
  SOURCE_STATUS_AVAILABLE: 'AVAILABLE',
  PROCESSING_STATUS_UNPROCESSED: 'UNPROCESSED',
  PROCESSING_STATUS_PROCESSED: 'PROCESSED',
  PROCESSING_STATUS_ERROR: 'ERROR',
  CAPTURE_VERSION: 'STATE_ROW_V1',
  CANONICALIZATION_VERSION: 'QBO_CANONICAL_STATE_V1',
  SNAPSHOT_RECORD_VERSION: 'SNAPSHOT_RECORD_V1',
  CHANGE_RECORD_VERSION: 'CHANGE_RECORD_V1',
  CHANGE_DETAIL_VERSION: 'CHANGE_DETAIL_V1',
  CANONICAL_MIGRATION_SCOPE: Object.freeze([
    'PAYMENT_METHODS', 'CUSTOMERS', 'ITEMS', 'CLASSES', 'TERMS', 'TAX_CODES',
    'DEPARTMENTS', 'VENDORS', 'ACCOUNTS', 'INVOICES', 'PAYMENTS', 'CREDIT_MEMOS',
    'ESTIMATES', 'BILLS', 'BILL_PAYMENTS', 'PURCHASES', 'DEPOSITS', 'JOURNAL_ENTRIES',
    'SALES_RECEIPTS', 'RECURRING_TRANSACTIONS', 'REFUND_RECEIPTS'
  ]),
  LEGACY_STATE_WRITE_ENABLED: false,
  CANONICAL_MIGRATION_BATCH_SIZE_SOURCES: 1,
  CANONICAL_MIGRATION_BATCH_PROPERTY_PREFIX: 'QBO_CANONICAL_MIGRATION_CURSOR_V1|',
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
  CDC_RUN_MANIFEST: Object.freeze([
    'CdcRunId','RunStartedAt','RunCompletedAt','WindowStart','WindowEnd','OverlapSeconds',
    'PriorSuccessfulCdcRunId','PriorSuccessfulWatermark','EntityTypesRequested',
    'EntityTypesSucceeded','EntityTypesFailed','ReturnedEntityCount','LiveEntityCount',
    'DeletedEntityCount','NewSnapshotCount','ChangeRecordCount','NoObservedChangeEventCount',
    'Status','WatermarkCommitted','SourceAcquisitionType','MinorVersion','CodeVersion'
  ]),
  NATIVE_CDC_EVENTS: Object.freeze([
    'NativeCdcEventId','CdcRunId','SourceId','EntityType','EntityId','QboStatus',
    'DeletedFlag','QboSyncToken','QboCreateTime','QboLastUpdatedTime','ObservedAt',
    'SparseFlag','RawPayloadHash','RawPayloadRef','PriorNativeCdcEventId',
    'SnapshotRecordId','CapturedStateResult','IngestionStatus'
  ]),
  WEBHOOK_EVENTS: Object.freeze([
    'WebhookEventId','WebhookDeliveryId','ReceivedAt','RealmId','EntityType','EntityId',
    'EventOperation','QboLastUpdatedTime','RawPayloadHash','RawPayloadRef',
    'PriorWebhookEventId','TargetedFetchSourceId','SnapshotRecordId','CapturedStateResult',
    'DuplicateEvent','IngestionStatus','ProcessingError','CreatedAt'
  ]),
  SNAPSHOTS: Object.freeze([
    'SnapshotRecordId','SnapshotRecordVersion','SourceId','SourceAcquisitionType','SourceRunId',
    'ExportKey','ExportFunction','ObservationStartedAt','ObservationCompletedAt','EvidenceFileId',
    'EvidenceFileName','SourceSheetName','SourceRowNumber','EntityType','EntityId','StateType',
    'QboCreateTime','QboLastUpdatedTime','QboSyncToken','CanonicalizationVersion',
    'CanonicalStateHash','RawPayloadHash','RawPayloadComplete','CanonicalStateComplete',
    'CanonicalStateSource','PriorSnapshotRecordId','SnapshotReason','CapturedAt'
  ]),
  CHANGES: Object.freeze([
    'ChangeRecordId','ChangeRecordVersion','EntityType','EntityId','ChangeType','DetectedAt',
    'SourceId','SourceAcquisitionType','SourceRunId','NativeCdcEventId','BeforeSnapshotRecordId',
    'AfterSnapshotRecordId','BeforeCanonicalHash','AfterCanonicalHash','ChangedFieldCount',
    'BusinessStateChanged','NativeCdcReportedChange','ChangeDetailStatus','CreatedAt'
  ]),
  CHANGE_DETAIL: Object.freeze([
    'ChangeDetailId','ChangeDetailVersion','ChangeRecordId','Sequence','EntityType','EntityId',
    'Path','Operation','BeforeType','BeforeValue','AfterType','AfterValue',
    'BeforeValueHash','AfterValueHash','Classification','CreatedAt'
  ]),
  CONTRACT_AUDIT_PATHS: Object.freeze([
    'RunId','ExportKey','SourceIndex','SourceId','MasterBackupFileName','ContractLevel',
    'SheetName','RawEvidenceColumn','CanonicalPath','PathType','ObservedCount',
    'NonBlankObservedCount','CoverageStatus','CoverageMethod','RepresentedBySheet',
    'RepresentedByColumn','MatchCount','MatchRate','Confidence','ExampleEntityId',
    'ExampleValue','ActionRequired','AuditedAt'
  ]),
  CONTRACT_AUDIT_SOURCES: Object.freeze([
    'RunId','ExportKey','SourceIndex','SourceId','MasterBackupFileName','ParentRows',
    'CompleteParentRawRows','TruncatedParentRawRows','InvalidParentRawRows',
    'ChildSheetsAudited','ChildRows','CompleteChildEvidenceRows','TruncatedChildEvidenceRows',
    'InvalidChildEvidenceRows','PathsObserved','CoveredPaths','ReviewPaths','UncoveredPaths',
    'Status','StartedAt','CompletedAt'
  ]),
  CONTRACT_AUDIT_RUNS: Object.freeze([
    'RunId','Version','CanonicalizationVersion','Status','StartedAt','CompletedAt',
    'ExportCount','SourceCountProcessed','PathRowsWritten','CoveredPaths','ReviewPaths',
    'UncoveredPaths','ErrorCount','CursorExportIndex','CursorSourceIndex','LastError'
  ]),
  INGESTION_LOG: Object.freeze([
    'IngestionRunId','StartedAt','CompletedAt','Operation','ProcessingPhase','Status',
    'SourceAcquisitionType','SourceId','SourceRunId','ExportKey','SourceRowsScanned',
    'EntitiesEvaluated','EligibleSources','AlreadyRegistered','RegisteredSources','SkippedSources',
    'SnapshotsCreated','ChangesCreated','ChangeDetailsCreated','UnchangedEntities','ErrorCount',
    'ActionRequired','Error','CodeVersion','CreatedAt'
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
