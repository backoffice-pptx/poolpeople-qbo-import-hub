/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 63_QBO_NativeCdcConfig.js
 * Purpose     : Externalized production configuration for QBO Native CDC.
 *
 * Architecture:
 *   - Native CDC acquisition runs every 30 minutes, 24/7.
 *   - Each cycle freezes one acquisition window and processes entities in
 *     bounded waves with resumable checkpoints.
 *   - ScriptLock is used only for short control/lease mutations; no QBO call,
 *     Drive write, or worker execution holds the project-wide lock.
 *   - Each entity owns a named acquisition lease for overlap prevention.
 *   - The authoritative successful watermark advances only after every entity
 *     work unit in the frozen cycle is durably evidenced.
 *   - State Application is intentionally separate from acquisition.
 * ============================================================================
 */

const QBO_NATIVE_CDC_PRODUCTION = Object.freeze({
  VERSION: '1.2.0',
  INITIAL_LOOKBACK_DAYS: 29,
  OVERLAP_MINUTES: 15,
  MAX_CDC_LOOKBACK_DAYS: 30,
  CYCLE_MINUTES: 30,
  ENTITIES_PER_WAVE: 5,
  CONTINUATION_DELAY_MS: 2 * 60 * 1000,
  WORKER_RUNTIME_BUDGET_MS: 4 * 60 * 1000,
  WORKER_LEASE_MS: 6 * 60 * 1000,
  ENTITY_LEASE_MS: 6 * 60 * 1000,
  STALE_CYCLE_MS: 12 * 60 * 1000,
  MAX_ENTITY_ATTEMPTS: 5,
  CONTROL_LOCK_TIMEOUT_MS: 30000,
  WATERMARK_PROPERTY_KEY: 'QBO_NATIVE_CDC_SUCCESS_WATERMARK',
  STATE_PROPERTY_KEY: 'QBO_NATIVE_CDC_CYCLE_STATE_V2',
  PAUSE_PROPERTY_KEY: 'QBO_NATIVE_CDC_PRODUCTION_PAUSED_V1',
  INGESTION_HANDOFF_PROPERTY_KEY: 'QBO_NATIVE_CDC_PENDING_INGESTION_HANDOFFS_V2',
  ENTITY_LEASE_PREFIX: 'QBO_NATIVE_CDC_ENTITY_LEASE_V2__',
  ENTITY_META_PREFIX: 'QBO_NATIVE_CDC_ENTITY_META_V2__',
  EVIDENCE_FOLDER_ASSET_KEY: 'QBO_NATIVE_CDC_EVIDENCE_FOLDER',
  EVIDENCE_FOLDER_EXPECTED_TYPE: 'Folder',
  ENVIRONMENT: 'PROD',
  RUN_FOLDER_PREFIX: 'QBO_Native_CDC_Cycle_',
  MANIFEST_FILE_NAME: 'manifest.json',
  DATE_PARTITION_NEW_EVIDENCE: true,
  ENTITY_FILE_PREFIX: 'cdc_',
  TRIGGER_HANDLERS: Object.freeze({
    START: 'startQboNativeCdcCycle',
    NEXT: 'runNextQboNativeCdcWave'
  }),
  ENTITIES: Object.freeze([
    'Invoice','Payment','TaxCode','CreditMemo','Bill','BillPayment','Purchase',
    'Deposit','JournalEntry','SalesReceipt','RefundReceipt','Customer','Vendor',
    'Item','Account','Class','Department','Term','PaymentMethod','Estimate'
  ])
});

const QBO_CHANGE_EVIDENCE_SETUP = Object.freeze({
  ENVIRONMENT: 'PROD',
  ROOT_FOLDER_ASSET_KEY: 'QBO_CHANGE_EVIDENCE_FOLDER',
  ROOT_FOLDER_EXPECTED_TYPE: 'Folder',
  EXPECTED_ROOT_FOLDER_NAME: 'Change Evidence',
  EXPECTED_PARENT_FOLDER_NAME: 'QuickBooks',
  CHILD_FOLDERS: Object.freeze([
    Object.freeze({ name: 'Native CDC', assetKey: 'QBO_NATIVE_CDC_EVIDENCE_FOLDER' }),
    Object.freeze({ name: 'Webhooks', assetKey: 'QBO_WEBHOOK_EVIDENCE_FOLDER' }),
    Object.freeze({ name: 'Captured States', assetKey: 'QBO_CAPTURED_STATES_FOLDER' }),
    Object.freeze({ name: 'Change Payloads', assetKey: 'QBO_CHANGE_PAYLOADS_FOLDER' })
  ])
});
