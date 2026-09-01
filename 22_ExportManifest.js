/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 22_ExportManifest.js
 * Purpose     : Central registry of supported QBO entity exports and the
 *               workbook sheets each exporter owns.
 *
 * Public API:
 *   - getQboExportManifest()
 *
 * Internal Helpers:
 *   - getQboExportManifestEntry_()
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
 *   - sheetNames lists every table currently written by the exporter. A
 *     multi-sheet exporter remains non-atomic across its individual table
 *     writes; this registry does not change locking or write behavior.
 *
 * Change History:
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
    sheetNames: Object.freeze(['QBO_Customers'])
  }),
  Object.freeze({
    key: 'PREFERENCES',
    category: 'DIMENSION',
    entityName: 'Preferences',
    exportFunctionName: 'exportQboPreferences',
    sheetNames: Object.freeze(['QBO_Preferences'])
  }),
  Object.freeze({
    key: 'ITEMS',
    category: 'DIMENSION',
    entityName: 'Item',
    exportFunctionName: 'exportQboItems',
    sheetNames: Object.freeze(['QBO_Items', 'QBO_ItemGroupLines'])
  }),
  Object.freeze({
    key: 'CLASSES',
    category: 'DIMENSION',
    entityName: 'Class',
    exportFunctionName: 'exportQboClasses',
    sheetNames: Object.freeze(['QBO_Classes'])
  }),
  Object.freeze({
    key: 'TERMS',
    category: 'DIMENSION',
    entityName: 'Term',
    exportFunctionName: 'exportQboTerms',
    sheetNames: Object.freeze(['QBO_Terms'])
  }),
  Object.freeze({
    key: 'PAYMENT_METHODS',
    category: 'DIMENSION',
    entityName: 'PaymentMethod',
    exportFunctionName: 'exportQboPaymentMethods',
    sheetNames: Object.freeze(['QBO_PaymentMethods'])
  }),
  Object.freeze({
    key: 'TAX_CODES',
    category: 'DIMENSION',
    entityName: 'TaxCode',
    exportFunctionName: 'exportQboTaxCodes',
    sheetNames: Object.freeze(['QBO_TaxCodes', 'QBO_TaxCodeRates'])
  }),
  Object.freeze({
    key: 'DEPARTMENTS',
    category: 'DIMENSION',
    entityName: 'Department',
    exportFunctionName: 'exportQboDepartments',
    sheetNames: Object.freeze(['QBO_Departments'])
  }),
  Object.freeze({
    key: 'VENDORS',
    category: 'CONTACT',
    entityName: 'Vendor',
    exportFunctionName: 'exportQboVendors',
    sheetNames: Object.freeze(['QBO_Vendors'])
  }),
  Object.freeze({
    key: 'ACCOUNTS',
    category: 'DIMENSION',
    entityName: 'Account',
    exportFunctionName: 'exportQboAccounts',
    sheetNames: Object.freeze(['QBO_Accounts'])
  }),
  Object.freeze({
    key: 'INVOICES',
    category: 'FINANCIAL',
    entityName: 'Invoice',
    exportFunctionName: 'exportQboInvoices',
    sheetNames: Object.freeze(['QBO_Invoices', 'QBO_InvoiceLines'])
  }),
  Object.freeze({
    key: 'PAYMENTS',
    category: 'FINANCIAL',
    entityName: 'Payment',
    exportFunctionName: 'exportQboPayments',
    sheetNames: Object.freeze(['QBO_Payments', 'QBO_PaymentApplications'])
  }),
  Object.freeze({
    key: 'CREDIT_MEMOS',
    category: 'FINANCIAL',
    entityName: 'CreditMemo',
    exportFunctionName: 'exportQboCreditMemos',
    sheetNames: Object.freeze(['QBO_CreditMemos', 'QBO_CreditMemoLines'])
  }),
  Object.freeze({
    key: 'ESTIMATES',
    category: 'FINANCIAL',
    entityName: 'Estimate',
    exportFunctionName: 'exportQboEstimates',
    sheetNames: Object.freeze(['QBO_Estimates', 'QBO_EstimateLines'])
  }),
  Object.freeze({
    key: 'BILLS',
    category: 'FINANCIAL',
    entityName: 'Bill',
    exportFunctionName: 'exportQboBills',
    sheetNames: Object.freeze(['QBO_Bills', 'QBO_BillLines'])
  }),
  Object.freeze({
    key: 'BILL_PAYMENTS',
    category: 'FINANCIAL',
    entityName: 'BillPayment',
    exportFunctionName: 'exportQboBillPayments',
    sheetNames: Object.freeze(['QBO_BillPayments', 'QBO_BillPaymentApplications'])
  }),
  Object.freeze({
    key: 'PURCHASES',
    category: 'FINANCIAL',
    entityName: 'Purchase',
    exportFunctionName: 'exportQboPurchases',
    sheetNames: Object.freeze(['QBO_Purchases', 'QBO_PurchaseLines'])
  }),
  Object.freeze({
    key: 'DEPOSITS',
    category: 'FINANCIAL',
    entityName: 'Deposit',
    exportFunctionName: 'exportQboDeposits',
    sheetNames: Object.freeze(['QBO_Deposits', 'QBO_DepositLines'])
  }),
  Object.freeze({
    key: 'JOURNAL_ENTRIES',
    category: 'FINANCIAL',
    entityName: 'JournalEntry',
    exportFunctionName: 'exportQboJournalEntries',
    sheetNames: Object.freeze(['QBO_JournalEntries', 'QBO_JournalEntryLines'])
  }),
  Object.freeze({
    key: 'SALES_RECEIPTS',
    category: 'FINANCIAL',
    entityName: 'SalesReceipt',
    exportFunctionName: 'exportQboSalesReceipts',
    sheetNames: Object.freeze(['QBO_SalesReceipts', 'QBO_SalesReceiptLines'])
  }),
  Object.freeze({
    key: 'RECURRING_TRANSACTIONS',
    category: 'RECURRING',
    entityName: 'RecurringTransaction',
    exportFunctionName: 'exportQboRecurringTransactions',
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
        sheetNames: entry.sheetNames.slice()
      };
    }
  }

  return null;
}
function testQboExportManifest() {
  const manifest = getQboExportManifest();

  console.log(`Manifest entries: ${manifest.length}`);

  manifest.forEach(entry => {
    console.log(
      `${entry.key} | ${entry.exportFunctionName} | ${entry.sheetNames.join(', ')}`
    );
  });
}