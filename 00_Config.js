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
 *   QBO_EXPORT_SPREADSHEET_ID  Google Sheets file ID receiving all QBO exports
 *
 * Optional Script Properties:
 *   QBO_MINORVERSION           Defaults to 75
 ***********************/

function getConfig_() {
  const props = PropertiesService.getScriptProperties();

  const clientId = props.getProperty('QBO_CLIENT_ID');
  const clientSecret = props.getProperty('QBO_CLIENT_SECRET');
  const minorVersion = props.getProperty('QBO_MINORVERSION') || '75';

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