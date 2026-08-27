/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 99_TriggeredCalls.js
 * Purpose     : Scheduled and manually triggered orchestration entry points for QBO exports.
 *
 * Public API:
 *   - callDimensionExports()
 *   - callContactExports()
 *   - callFinancialExports()
 *
 * Internal Helpers:
 *   - None
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
 *   - 2026-07-21: Added standardized module documentation. No runtime behavior
 *     changed.
 * ============================================================================
 */


function callDimensionExports() {
 exportQboAccounts()
 exportQboClasses()
 exportQboDepartments() 
 exportQboItems()
 exportQboPaymentMethods()
 exportQboPreferences()
 exportQboTaxCodes()
 exportQboTerms()
}

function callContactExports() {
 exportQboCustomers()
 exportQboVendors()
}

function callFinancialExports() {
 exportQboCreditMemos()
 exportQboDeposits()
 exportQboEstimates()
 exportQboInvoices()
 exportQboJournalEntries()
 exportQboPayments()
 exportQboSalesReceipts()
 exportQboRefundReceipts()
 exportQboPurchases()
 exportQboBillPayments()
 exportQboBills()
}


function callRecurringExports() {
 exportQboRecurringTransactions()
}
