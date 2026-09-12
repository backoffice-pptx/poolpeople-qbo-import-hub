/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 63_QBO_NativeCdcConfig.js
 * Purpose     : Externalized production configuration for QBO Native CDC.
 *
 * Architecture:
 *   - First successful production run uses a 29-day initial lookback.
 *   - Later runs use the prior successful watermark minus a bounded overlap.
 *   - Failed/partial runs never advance the successful watermark.
 *   - Source evidence is resolved from the governed PROD asset registry.
 * ============================================================================
 */

const QBO_NATIVE_CDC_PRODUCTION = Object.freeze({
  VERSION: '1.0.3',
  INITIAL_LOOKBACK_DAYS: 29,
  OVERLAP_MINUTES: 15,
  MAX_CDC_LOOKBACK_DAYS: 30,
  EXECUTION_LOCK_TIMEOUT_MS: 30000,
  WATERMARK_PROPERTY_KEY: 'QBO_NATIVE_CDC_SUCCESS_WATERMARK',
  EVIDENCE_FOLDER_ASSET_KEY: 'QBO_NATIVE_CDC_EVIDENCE_FOLDER',
  EVIDENCE_FOLDER_EXPECTED_TYPE: 'Folder',
  ENVIRONMENT: 'PROD',
  RUN_FOLDER_PREFIX: 'QBO_Native_CDC_Run_',
  MANIFEST_FILE_NAME: 'manifest.json',
  ENTITY_FILE_PREFIX: 'cdc_',
  ENTITIES: Object.freeze([
    'Invoice',
    'Payment',
    'TaxCode',
    'CreditMemo',
    'Bill',
    'BillPayment',
    'Purchase',
    'Deposit',
    'JournalEntry',
    'SalesReceipt',
    'RefundReceipt',
    'Customer',
    'Vendor',
    'Item',
    'Account',
    'Class',
    'Department',
    'Term',
    'PaymentMethod',
    'Estimate'
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
