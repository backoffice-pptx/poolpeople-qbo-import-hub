/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 00_Config.js
 * Purpose     : Central configuration constants and environment settings for the QBO connector.
 *
 * Public API:
 *   - None
 *
 * Internal Helpers:
 *   - getConfig_()
 *   - safeLog_()
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
 *   - 2026-09-10: Added canonical QBO State Capture workbook Script Property.
 *   - 2026-09-03: Added isolated General Ledger report-export configuration.
 *     Report extracts remain outside the 22-export daily entity manifest and
 *     scheduler because they require explicit accounting date windows.
 *   - 2026-09-02: Added dedicated scheduled-run history/status workbook
 *     configuration for persistent daily export observability.
 *   - 2026-09-01: Added daily export scheduler policy for a chained, one-export-
 *     per-execution schedule that stays below Apps Script trigger limits.
 *   - 2026-09-01: Added required snapshot-folder configuration and shared
 *     snapshot naming policy for successful independent-workbook exports.
 *   - 2026-09-01: Enforced independent-workbook destination configuration.
 *     Each export now requires QBO_EXPORT_<MANIFEST_KEY>_SPREADSHEET_ID; the
 *     legacy shared-workbook fallback has been retired.
 *   - 2026-09-01: Added independent-workbook destination property naming.
 *     Per-export workbook properties use QBO_EXPORT_<MANIFEST_KEY>_SPREADSHEET_ID.
 *   - 2026-09-01: Added centralized QBO pagination safeguards for page size,
 *     maximum pages, and duplicate-page detection.
 *   - 2026-09-01: Added centralized transient QBO request retry policy used by
 *     the shared HTTP transport boundary.
 *   - 2026-09-01: Centralized the QBO realm user-property key so OAuth and
 *     REST helpers share one definition instead of repeating QBO_REALM_ID.
 *   - 2026-08-27: Added shared export-write locking policy in EXPORT_EXECUTION
 *     so overlapping trigger/manual writes fail safely instead of writing
 *     concurrently to the export workbook.
 *   - 2026-08-27: Centralized export display policy (CLIP/no-wrap and standard
 *     data-row height) in EXPORT_LAYOUT for shared use by all exporters.
 *   - 2026-08-27: Centralized Script Property key names in
 *     SCRIPT_PROPERTY_KEYS so workbook targeting and QBO credentials do not
 *     rely on repeated string literals across modules.
 *   - 2026-08-27: Documented QBO_EXPORT_SPREADSHEET_ID as the required
 *     standalone export-workbook Script Property. Runtime resolution remains
 *     centralized in 20_Utils.js.
 *   - 2026-07-21: Added standardized module documentation. No runtime behavior
 *     changed.
 * ============================================================================
 */


/***********************
 * 00_Config.gs
 * QBO project configuration
 *
 * Required Script Properties:
 *   QBO_CLIENT_ID
 *   QBO_CLIENT_SECRET
 *   QBO_EXPORT_<MANIFEST_KEY>_SPREADSHEET_ID
 *     One configured Google Sheets file ID per export manifest entry.
 *   QBO_EXPORT_RUN_HISTORY_SPREADSHEET_ID
 *     Dedicated workbook for scheduled-run history and latest export status.
 *   QBO_REPORT_GENERAL_LEDGER_SPREADSHEET_ID
 *     Dedicated workbook for manual/date-window General Ledger report extracts.
 *   QBO_STATE_CAPTURE_SPREADSHEET_ID
 *     Canonical QBO State Capture workbook under QuickBooks/Change Evidence/Captured States.
 *
 * Optional Script Properties:
 *   QBO_MINORVERSION           Defaults to 75
 *   QBO_REPORT_GENERAL_LEDGER_START_DATE / END_DATE
 *     Optional yyyy-mm-dd override used by exportQboGeneralLedger(). If both
 *     are absent, the last closed calendar month is exported.
 ***********************/

const SCRIPT_PROPERTY_KEYS = Object.freeze({
  CLIENT_ID: 'QBO_CLIENT_ID',
  CLIENT_SECRET: 'QBO_CLIENT_SECRET',
  MINOR_VERSION: 'QBO_MINORVERSION',
  SNAPSHOT_FOLDER_ID: 'QBO_EXPORT_SNAPSHOT_FOLDER_ID',
  RUN_HISTORY_SPREADSHEET_ID: 'QBO_EXPORT_RUN_HISTORY_SPREADSHEET_ID',
  GENERAL_LEDGER_REPORT_SPREADSHEET_ID: 'QBO_REPORT_GENERAL_LEDGER_SPREADSHEET_ID',
  GENERAL_LEDGER_REPORT_START_DATE: 'QBO_REPORT_GENERAL_LEDGER_START_DATE',
  GENERAL_LEDGER_REPORT_END_DATE: 'QBO_REPORT_GENERAL_LEDGER_END_DATE',
  STATE_CAPTURE_SPREADSHEET_ID: 'QBO_STATE_CAPTURE_SPREADSHEET_ID'
});

const EXPORT_DESTINATION = Object.freeze({
  PROPERTY_PREFIX: 'QBO_EXPORT_',
  PROPERTY_SUFFIX: '_SPREADSHEET_ID',
  WORKBOOK_TITLE_PREFIX: 'QBO Export - '
});

const USER_PROPERTY_KEYS = Object.freeze({
  REALM_ID: 'QBO_REALM_ID'
});

function getConfig_() {
  const props = PropertiesService.getScriptProperties();

  const clientId = props.getProperty(SCRIPT_PROPERTY_KEYS.CLIENT_ID);
  const clientSecret = props.getProperty(SCRIPT_PROPERTY_KEYS.CLIENT_SECRET);
  const minorVersion =
    props.getProperty(SCRIPT_PROPERTY_KEYS.MINOR_VERSION) || '75';

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing QBO_CLIENT_ID or QBO_CLIENT_SECRET in Script Properties.'
    );
  }

  return {
    clientId: clientId,
    clientSecret: clientSecret,
    minorVersion: minorVersion,
    scopes: 'com.intuit.quickbooks.accounting',
    authUrl: 'https://appcenter.intuit.com/connect/oauth2',
    tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    qboBase: 'https://quickbooks.api.intuit.com/v3/company/'
  };
}

function safeLog_(message) {
  Logger.log(String(message).slice(0, 1000));
}

const PROJECT_INFO = Object.freeze({
  NAME: 'QBO Integration Hub',
  VERSION: '1.0.0',
  BUILD_DATE: '2026-07-17',
  AUTHOR: 'Pool People',
  API_VERSION: 'v3',
  MIN_EXPORT_FRAMEWORK_VERSION: '1.0.0'
});


/**
 * Shared spreadsheet display policy for Application 50 exports.
 *
 * Entity exporters must not define their own wrapping or standard data-row
 * height. Those presentation rules belong to the shared export layer so every
 * QBO export remains compact and consistent.
 */
const EXPORT_LAYOUT = Object.freeze({
  DATA_WRAP_STRATEGY: SpreadsheetApp.WrapStrategy.CLIP,
  DATA_ROW_HEIGHT: 21
});

/**
 * Shared execution policy for export workbook writes.
 *
 * Individual time-based triggers remain the production scheduling model.
 * Locking is intentionally scoped to writeExport_() so concurrent QBO reads
 * may proceed. Write leases are keyed by destination workbook, allowing
 * different independent workbooks to mutate concurrently while preventing
 * overlapping writes to the same workbook.
 */
const EXPORT_EXECUTION = Object.freeze({
  WRITE_LOCK_WAIT_MS: 90000,
  WRITE_LEASE_MS: 10 * 60 * 1000,
  WRITE_LEASE_POLL_MS: 500,
  WRITE_LEASE_REGISTRY_LOCK_WAIT_MS: 5000
});

/**
 * Daily export scheduling policy.
 *
 * Apps Script limits installable triggers per user/script, so Application 50
 * uses one durable daily starter trigger plus at most one transient next-export
 * trigger. Each exporter still runs in its own Apps Script execution.
 */
const DAILY_EXPORT_SCHEDULE = Object.freeze({
  START_HOUR: 0,
  START_MINUTE: 15,
  NEXT_EXPORT_DELAY_MS: 2 * 60 * 1000,
  WORKER_STALE_MS: 12 * 60 * 1000
});

/**
 * Shared snapshot policy for successful independent-workbook exports.
 *
 * Snapshot copies are created only after the final owned sheet for an exporter
 * has been written successfully. The snapshot filename uses the current source
 * workbook name plus a timestamp in the Apps Script project time zone.
 */
const EXPORT_SNAPSHOT = Object.freeze({
  TIMESTAMP_FORMAT: 'yyyyMMdd_HHmmss'
});


/**
 * Persistent scheduled-run history/status policy.
 *
 * The run-history workbook is operational metadata only; QBO entity data
 * remains isolated in the 22 independent export workbooks.
 */
const QBO_RUN_HISTORY = Object.freeze({
  WORKBOOK_TITLE: 'QBO_Export_Run_History',
  RUNS_SHEET: 'QBO_RunHistory',
  EXPORTS_SHEET: 'QBO_ExportRunHistory',
  STATUS_SHEET: 'QBO_ExportStatus',
  HEADER_ROW: 1
});

/**
 * Shared transient-request retry policy for QBO HTTP calls.
 *
 * MAX_ATTEMPTS includes the initial request. Only explicitly retryable HTTP
 * statuses and clearly transient transport failures are retried.
 */
const QBO_REQUEST_POLICY = Object.freeze({
  MAX_ATTEMPTS: 3,
  BASE_RETRY_DELAY_MS: 1000,
  MAX_RETRY_DELAY_MS: 10000
});

/**
 * Shared pagination safeguards for QBO query exports.
 *
 * MAX_PAGES is intentionally generous; it exists to stop a malformed or
 * repeated-page response from creating an unbounded query loop.
 */
const QBO_QUERY_POLICY = Object.freeze({
  PAGE_SIZE: 1000,
  MAX_PAGES: 10000,
  DETECT_DUPLICATE_FULL_PAGES: true
});

const SHEETS = Object.freeze({

  CUSTOMERS: 'QBO_Customers',
  PREFERENCES: 'QBO_Preferences',

  ITEMS: 'QBO_Items',
  ITEM_GROUP_LINES: 'QBO_ItemGroupLines',

  CLASSES: 'QBO_Classes',
  TERMS: 'QBO_Terms',
  PAYMENT_METHODS: 'QBO_PaymentMethods',
  TAX_CODES: 'QBO_TaxCodes',
  DEPARTMENTS: 'QBO_Departments',
  VENDORS: 'QBO_Vendors',
  ACCOUNTS: 'QBO_Accounts',

  RECURRING_TRANSACTIONS: 'QBO_RecurringTransactions',
  RECURRING_TRANSACTION_LINES: 'QBO_RecurringTransactionLines',
  RECURRING_TRANSACTION_PROPERTIES: 'QBO_RecurringTransactionProperties',

  CUSTOM_FIELDS: 'QBO_CustomFields'

});

const LOG_PREFIX = Object.freeze({
  INFO: '[INFO]',
  WARN: '[WARN]',
  ERROR: '[ERROR]',
  DEBUG: '[DEBUG]'
});

/**
 * QuickBooks Online API endpoints.
 */
const QBO_ENDPOINTS = Object.freeze({

  REST: 'https://quickbooks.api.intuit.com/v3/company',

  GRAPHQL: 'https://qb.api.intuit.com/graphql'

});