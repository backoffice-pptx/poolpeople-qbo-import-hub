/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 22_ExportManifest.js
 * Purpose     : Central registry of supported QBO entity exports, the
 *               destination workbook key for each exporter, and the workbook
 *               sheets each exporter owns.
 *
 * Public API:
 *   - getQboExportManifest()
 *   - provisionQboIndependentExportWorkbooks()
 *   - testQboExportDestinationRouting()
 *
 * Internal Helpers:
 *   - getQboExportManifestEntry_()
 *   - getQboExportManifestEntryForSheet_()
 *   - getQboExportWorkbookPropertyKey_()
 *
 * Dependencies:
 *   - Entity export entry points defined in 30_QBO_Customers.js through
 *     51_QBO_RefundReceipts.js
 *
 * Current Owner:
 *   - 50 QBO Import Hub
 *
 * Architecture Notes:
 *   - This manifest is descriptive. It does not orchestrate exports or replace
 *     the individual time-based triggers used in production.
 *   - Function names are stored as strings so loading this registry has no
 *     execution side effects and does not create a dependency on 99_TriggeredCalls.js.
 *   - workbookKey is the stable logical destination used to resolve a
 *     per-export Script Property during the independent-workbook migration.
 *   - sheetNames lists every table currently written by the exporter. A
 *     multi-sheet exporter remains non-atomic across its individual table
 *     writes; this registry does not change locking or write behavior.
 *
 * Change History:
 *   - 2026-09-01: Added idempotent independent-workbook provisioning and
 *     destination-routing diagnostics for controlled migration.
 *   - 2026-09-01: Added logical workbookKey metadata and sheet-to-export
 *     lookup helpers to support incremental migration from one shared export
 *     workbook to independent per-export workbooks.
 *   - 2026-08-31: Added centralized export manifest/registry after completion
 *     of framework hardening and full entity regression testing. No export
 *     schema, retrieval, scheduling, or write behavior changed.
 * ============================================================================
 */

const QBO_EXPORT_MANIFEST = Object.freeze([
  Object.freeze({
    key: 'CUSTOMERS',
    category: 'CONTACT',
    entityName: 'Customer',
    exportFunctionName: 'exportQboCustomers',
    workbookKey: 'CUSTOMERS',
    sheetNames: Object.freeze(['QBO_Customers'])
  }),
  Object.freeze({
    key: 'PREFERENCES',
    category: 'DIMENSION',
    entityName: 'Preferences',
    exportFunctionName: 'exportQboPreferences',
    workbookKey: 'PREFERENCES',
    sheetNames: Object.freeze(['QBO_Preferences'])
  }),
  Object.freeze({
    key: 'ITEMS',
    category: 'DIMENSION',
    entityName: 'Item',
    exportFunctionName: 'exportQboItems',
    workbookKey: 'ITEMS',
    sheetNames: Object.freeze(['QBO_Items', 'QBO_ItemGroupLines'])
  }),
  Object.freeze({
    key: 'CLASSES',
    category: 'DIMENSION',
    entityName: 'Class',
    exportFunctionName: 'exportQboClasses',
    workbookKey: 'CLASSES',
    sheetNames: Object.freeze(['QBO_Classes'])
  }),
  Object.freeze({
    key: 'TERMS',
    category: 'DIMENSION',
    entityName: 'Term',
    exportFunctionName: 'exportQboTerms',
    workbookKey: 'TERMS',
    sheetNames: Object.freeze(['QBO_Terms'])
  }),
  Object.freeze({
    key: 'PAYMENT_METHODS',
    category: 'DIMENSION',
    entityName: 'PaymentMethod',
    exportFunctionName: 'exportQboPaymentMethods',
    workbookKey: 'PAYMENT_METHODS',
    sheetNames: Object.freeze(['QBO_PaymentMethods'])
  }),
  Object.freeze({
    key: 'TAX_CODES',
    category: 'DIMENSION',
    entityName: 'TaxCode',
    exportFunctionName: 'exportQboTaxCodes',
    workbookKey: 'TAX_CODES',
    sheetNames: Object.freeze(['QBO_TaxCodes', 'QBO_TaxCodeRates'])
  }),
  Object.freeze({
    key: 'DEPARTMENTS',
    category: 'DIMENSION',
    entityName: 'Department',
    exportFunctionName: 'exportQboDepartments',
    workbookKey: 'DEPARTMENTS',
    sheetNames: Object.freeze(['QBO_Departments'])
  }),
  Object.freeze({
    key: 'VENDORS',
    category: 'CONTACT',
    entityName: 'Vendor',
    exportFunctionName: 'exportQboVendors',
    workbookKey: 'VENDORS',
    sheetNames: Object.freeze(['QBO_Vendors'])
  }),
  Object.freeze({
    key: 'ACCOUNTS',
    category: 'DIMENSION',
    entityName: 'Account',
    exportFunctionName: 'exportQboAccounts',
    workbookKey: 'ACCOUNTS',
    sheetNames: Object.freeze(['QBO_Accounts'])
  }),
  Object.freeze({
    key: 'INVOICES',
    category: 'FINANCIAL',
    entityName: 'Invoice',
    exportFunctionName: 'exportQboInvoices',
    workbookKey: 'INVOICES',
    sheetNames: Object.freeze(['QBO_Invoices', 'QBO_InvoiceLines'])
  }),
  Object.freeze({
    key: 'PAYMENTS',
    category: 'FINANCIAL',
    entityName: 'Payment',
    exportFunctionName: 'exportQboPayments',
    workbookKey: 'PAYMENTS',
    sheetNames: Object.freeze(['QBO_Payments', 'QBO_PaymentApplications'])
  }),
  Object.freeze({
    key: 'CREDIT_MEMOS',
    category: 'FINANCIAL',
    entityName: 'CreditMemo',
    exportFunctionName: 'exportQboCreditMemos',
    workbookKey: 'CREDIT_MEMOS',
    sheetNames: Object.freeze(['QBO_CreditMemos', 'QBO_CreditMemoLines'])
  }),
  Object.freeze({
    key: 'ESTIMATES',
    category: 'FINANCIAL',
    entityName: 'Estimate',
    exportFunctionName: 'exportQboEstimates',
    workbookKey: 'ESTIMATES',
    sheetNames: Object.freeze(['QBO_Estimates', 'QBO_EstimateLines'])
  }),
  Object.freeze({
    key: 'BILLS',
    category: 'FINANCIAL',
    entityName: 'Bill',
    exportFunctionName: 'exportQboBills',
    workbookKey: 'BILLS',
    sheetNames: Object.freeze(['QBO_Bills', 'QBO_BillLines'])
  }),
  Object.freeze({
    key: 'BILL_PAYMENTS',
    category: 'FINANCIAL',
    entityName: 'BillPayment',
    exportFunctionName: 'exportQboBillPayments',
    workbookKey: 'BILL_PAYMENTS',
    sheetNames: Object.freeze(['QBO_BillPayments', 'QBO_BillPaymentApplications'])
  }),
  Object.freeze({
    key: 'PURCHASES',
    category: 'FINANCIAL',
    entityName: 'Purchase',
    exportFunctionName: 'exportQboPurchases',
    workbookKey: 'PURCHASES',
    sheetNames: Object.freeze(['QBO_Purchases', 'QBO_PurchaseLines'])
  }),
  Object.freeze({
    key: 'DEPOSITS',
    category: 'FINANCIAL',
    entityName: 'Deposit',
    exportFunctionName: 'exportQboDeposits',
    workbookKey: 'DEPOSITS',
    sheetNames: Object.freeze(['QBO_Deposits', 'QBO_DepositLines'])
  }),
  Object.freeze({
    key: 'JOURNAL_ENTRIES',
    category: 'FINANCIAL',
    entityName: 'JournalEntry',
    exportFunctionName: 'exportQboJournalEntries',
    workbookKey: 'JOURNAL_ENTRIES',
    sheetNames: Object.freeze(['QBO_JournalEntries', 'QBO_JournalEntryLines'])
  }),
  Object.freeze({
    key: 'SALES_RECEIPTS',
    category: 'FINANCIAL',
    entityName: 'SalesReceipt',
    exportFunctionName: 'exportQboSalesReceipts',
    workbookKey: 'SALES_RECEIPTS',
    sheetNames: Object.freeze(['QBO_SalesReceipts', 'QBO_SalesReceiptLines'])
  }),
  Object.freeze({
    key: 'RECURRING_TRANSACTIONS',
    category: 'RECURRING',
    entityName: 'RecurringTransaction',
    exportFunctionName: 'exportQboRecurringTransactions',
    workbookKey: 'RECURRING_TRANSACTIONS',
    sheetNames: Object.freeze([
      'QBO_RecurringTransactions',
      'QBO_RecurringTransactionLines'
    ])
  }),
  Object.freeze({
    key: 'REFUND_RECEIPTS',
    category: 'FINANCIAL',
    entityName: 'RefundReceipt',
    exportFunctionName: 'exportQboRefundReceipts',
    workbookKey: 'REFUND_RECEIPTS',
    sheetNames: Object.freeze(['QBO_RefundReceipts', 'QBO_RefundReceiptLines'])
  })
]);

/**
 * Returns a defensive copy of the centralized export manifest.
 *
 * The returned objects are safe for inspection/reporting without allowing a
 * caller to mutate the module-level registry.
 */
function getQboExportManifest() {
  return QBO_EXPORT_MANIFEST.map(function(entry) {
    return {
      key: entry.key,
      category: entry.category,
      entityName: entry.entityName,
      exportFunctionName: entry.exportFunctionName,
      workbookKey: entry.workbookKey,
      workbookPropertyKey: getQboExportWorkbookPropertyKey_(entry.workbookKey),
      sheetNames: entry.sheetNames.slice()
    };
  });
}

/**
 * Returns one manifest entry by stable key, or null when no key matches.
 */
function getQboExportManifestEntry_(key) {
  const normalizedKey = String(key || '').trim().toUpperCase();

  for (let i = 0; i < QBO_EXPORT_MANIFEST.length; i += 1) {
    if (QBO_EXPORT_MANIFEST[i].key === normalizedKey) {
      const entry = QBO_EXPORT_MANIFEST[i];

      return {
        key: entry.key,
        category: entry.category,
        entityName: entry.entityName,
        exportFunctionName: entry.exportFunctionName,
        workbookKey: entry.workbookKey,
        workbookPropertyKey: getQboExportWorkbookPropertyKey_(entry.workbookKey),
        sheetNames: entry.sheetNames.slice()
      };
    }
  }

  return null;
}


/**
 * Returns the manifest entry that owns a given export sheet, or null when the
 * sheet is not registered. Sheet ownership must be unique.
 */
function getQboExportManifestEntryForSheet_(sheetName) {
  const normalizedSheetName = String(sheetName || '').trim();

  if (!normalizedSheetName) {
    return null;
  }

  let match = null;

  for (let i = 0; i < QBO_EXPORT_MANIFEST.length; i += 1) {
    const entry = QBO_EXPORT_MANIFEST[i];

    if (entry.sheetNames.indexOf(normalizedSheetName) === -1) {
      continue;
    }

    if (match) {
      throw new Error(
        'Export manifest assigns sheet ' + normalizedSheetName +
        ' to more than one exporter: ' + match.key + ' and ' + entry.key + '.'
      );
    }

    match = entry;
  }

  if (!match) {
    return null;
  }

  return {
    key: match.key,
    category: match.category,
    entityName: match.entityName,
    exportFunctionName: match.exportFunctionName,
    workbookKey: match.workbookKey,
    workbookPropertyKey: getQboExportWorkbookPropertyKey_(match.workbookKey),
    sheetNames: match.sheetNames.slice()
  };
}


/**
 * Builds the Script Property name that stores one export workbook ID.
 */
function getQboExportWorkbookPropertyKey_(workbookKey) {
  const normalizedKey = String(workbookKey || '').trim().toUpperCase();

  if (!normalizedKey || !/^[A-Z0-9_]+$/.test(normalizedKey)) {
    throw new Error(
      'Invalid QBO export workbook key: ' + String(workbookKey || '') + '.'
    );
  }

  return (
    EXPORT_DESTINATION.PROPERTY_PREFIX +
    normalizedKey +
    EXPORT_DESTINATION.PROPERTY_SUFFIX
  );
}

/**
 * Logs the export manifest for human-readable validation in the Apps Script
 * execution log. This does not call QBO or write to the export workbook.
 */
function testQboExportManifest() {
  const manifest = getQboExportManifest();

  console.log(`Manifest entries: ${manifest.length}`);

  manifest.forEach(entry => {
    console.log(
      `${entry.key} | ${entry.exportFunctionName} | ${entry.workbookPropertyKey} | ` +
      `${entry.sheetNames.join(', ')}`
    );
  });
}

/**
 * Creates any missing independent export workbooks and stores their IDs in
 * Script Properties. Existing configured destinations are never overwritten.
 *
 * Each created workbook is initialized with the sheet names owned by the
 * corresponding manifest entry. The helper is idempotent: rerunning it skips
 * every export that already has its per-export destination property.
 *
 * Workbooks are created in the executing user's My Drive root. They may be
 * renamed or moved later without affecting routing because Application 50
 * resolves them by spreadsheet ID, not by title or folder location.
 *
 * @return {Object[]} Provisioning result rows for inspection/testing.
 */
function provisionQboIndependentExportWorkbooks() {
  const props = PropertiesService.getScriptProperties();
  const manifest = getQboExportManifest();
  const results = [];

  manifest.forEach(function(entry) {
    const propertyKey = entry.workbookPropertyKey;
    const existingId = String(props.getProperty(propertyKey) || '').trim();

    if (existingId) {
      console.log(
        '[DESTINATION] | SKIP | export=' + entry.key +
        ' | property=' + propertyKey + ' | already configured'
      );

      results.push({
        key: entry.key,
        propertyKey: propertyKey,
        spreadsheetId: existingId,
        status: 'EXISTING'
      });
      return;
    }

    const title = EXPORT_DESTINATION.WORKBOOK_TITLE_PREFIX +
      formatQboExportWorkbookTitle_(entry.key);
    const spreadsheet = SpreadsheetApp.create(title);
    initializeQboExportWorkbookSheets_(spreadsheet, entry.sheetNames);
    props.setProperty(propertyKey, spreadsheet.getId());

    console.log(
      '[DESTINATION] | CREATED | export=' + entry.key +
      ' | property=' + propertyKey +
      ' | workbook=' + spreadsheet.getName()
    );

    results.push({
      key: entry.key,
      propertyKey: propertyKey,
      spreadsheetId: spreadsheet.getId(),
      status: 'CREATED'
    });
  });

  const createdCount = results.filter(function(result) {
    return result.status === 'CREATED';
  }).length;

  console.log(
    '[DESTINATION] | PROVISION COMPLETE | exports=' + results.length +
    ' | created=' + createdCount +
    ' | existing=' + (results.length - createdCount)
  );

  return results;
}


/**
 * Logs current per-export destination configuration without calling QBO or
 * writing export data. This is a migration/readiness diagnostic.
 */
function testQboExportDestinationRouting() {
  const props = PropertiesService.getScriptProperties();
  const legacyId = String(
    props.getProperty(SCRIPT_PROPERTY_KEYS.EXPORT_SPREADSHEET_ID) || ''
  ).trim();
  const manifest = getQboExportManifest();
  let independentCount = 0;
  let fallbackCount = 0;
  let missingCount = 0;

  manifest.forEach(function(entry) {
    const independentId = String(
      props.getProperty(entry.workbookPropertyKey) || ''
    ).trim();

    let mode;
    if (independentId) {
      mode = 'INDEPENDENT';
      independentCount += 1;
    } else if (legacyId) {
      mode = 'LEGACY_FALLBACK';
      fallbackCount += 1;
    } else {
      mode = 'MISSING';
      missingCount += 1;
    }

    console.log(
      '[DESTINATION] | ' + mode + ' | export=' + entry.key +
      ' | property=' + entry.workbookPropertyKey +
      ' | sheets=' + entry.sheetNames.join(', ')
    );
  });

  console.log(
    '[DESTINATION] | STATUS | exports=' + manifest.length +
    ' | independent=' + independentCount +
    ' | fallback=' + fallbackCount +
    ' | missing=' + missingCount
  );
}


/**
 * Initializes a newly created export workbook with exactly the manifest-owned
 * sheet names. The default first sheet is reused so no throwaway Sheet1 remains.
 */
function initializeQboExportWorkbookSheets_(spreadsheet, sheetNames) {
  if (!spreadsheet || !Array.isArray(sheetNames) || sheetNames.length === 0) {
    throw new Error('Cannot initialize QBO export workbook without sheet names.');
  }

  const sheets = spreadsheet.getSheets();
  const firstSheet = sheets[0];
  firstSheet.setName(sheetNames[0]);

  for (let i = 1; i < sheetNames.length; i += 1) {
    spreadsheet.insertSheet(sheetNames[i]);
  }
}


/**
 * Converts a manifest key into a readable default workbook title suffix.
 */
function formatQboExportWorkbookTitle_(key) {
  return String(key || '')
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map(function(part) {
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

