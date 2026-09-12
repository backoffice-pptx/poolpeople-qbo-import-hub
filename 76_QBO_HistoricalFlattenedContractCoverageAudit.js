/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 76_QBO_HistoricalFlattenedContractCoverageAudit.js
 * Purpose     : Read-only historical Master Backup contract-coverage audit.
 *
 * Architecture under test:
 *   Canonical state is derived from the governed flattened export contract
 *   plus governed child datasets. Complete RawJSON is retained as independent
 *   source evidence and contract-validation evidence, not as the normal
 *   canonicalization input.
 *
 * Scope of this phase:
 *   - One export/source per run to stay within Apps Script limits.
 *   - Compare canonical top-level keys observed in complete RawJSON against
 *     top-level business fields explicitly preserved by the governed exporter.
 *   - This is a coverage screen, not yet a full flattened-vs-RawJSON canonical
 *     value-equivalence proof for complex entities.
 *
 * Safety:
 *   - No canonical rows are written.
 *   - No migration cursor is changed.
 *   - No exporter/canonicalizer behavior is changed.
 *   - Only a dedicated AUDIT cursor ScriptProperty is advanced.
 * ============================================================================
 */

const QBO_HISTORICAL_CONTRACT_AUDIT_ = Object.freeze({
  CURSOR_PROPERTY: 'QBO_HISTORICAL_FLATTENED_CONTRACT_COVERAGE_AUDIT_CURSOR_V1',
  EXPORTS: Object.freeze([
    'PAYMENT_METHODS',
    'CUSTOMERS',
    'ITEMS',
    'CLASSES',
    'TERMS',
    'TAX_CODES',
    'DEPARTMENTS',
    'VENDORS',
    'ACCOUNTS',
    'INVOICES',
    'PAYMENTS',
    'CREDIT_MEMOS',
    'ESTIMATES',
    'BILLS',
    'BILL_PAYMENTS',
    'PURCHASES',
    'DEPOSITS',
    'JOURNAL_ENTRIES',
    'SALES_RECEIPTS',
    'RECURRING_TRANSACTIONS',
    'REFUND_RECEIPTS'
  ]),
  PARENT_SHEETS: Object.freeze({
    PAYMENT_METHODS: 'QBO_PaymentMethods',
    CUSTOMERS: 'QBO_Customers',
    ITEMS: 'QBO_Items',
    CLASSES: 'QBO_Classes',
    TERMS: 'QBO_Terms',
    TAX_CODES: 'QBO_TaxCodes',
    DEPARTMENTS: 'QBO_Departments',
    VENDORS: 'QBO_Vendors',
    ACCOUNTS: 'QBO_Accounts',
    INVOICES: 'QBO_Invoices',
    PAYMENTS: 'QBO_Payments',
    CREDIT_MEMOS: 'QBO_CreditMemos',
    ESTIMATES: 'QBO_Estimates',
    BILLS: 'QBO_Bills',
    BILL_PAYMENTS: 'QBO_BillPayments',
    PURCHASES: 'QBO_Purchases',
    DEPOSITS: 'QBO_Deposits',
    JOURNAL_ENTRIES: 'QBO_JournalEntries',
    SALES_RECEIPTS: 'QBO_SalesReceipts',
    RECURRING_TRANSACTIONS: 'QBO_RecurringTransactions',
    REFUND_RECEIPTS: 'QBO_RefundReceipts'
  }),
  // Top-level business fields intentionally externalized by the current
  // governed exporter contract. Technical metadata fields are harmless here
  // because the observed side is taken from QBO_CANONICAL_STATE_V1.
  COVERED_TOP_LEVEL_KEYS: Object.freeze({
    PAYMENT_METHODS: ['Id','Active','Name','Type'],
    CUSTOMERS: [
      'Id','Active','AlternatePhone','Balance','BalanceWithJobs','BillAddr',
      'BillWithParent','CompanyName','CurrencyRef','CustomField','CustomerTypeRef',
      'DefaultTaxCodeRef','DisplayName','ExchangeRate','FamilyName','Fax',
      'FullyQualifiedName','GivenName','IsProject','Job','Level','MiddleName','Mobile','Notes',
      'OpenBalanceDate','ParentRef','PaymentMethodRef','PreferredDeliveryMethod',
      'PrimaryEmailAddr','PrimaryPhone','PrimaryTaxIdentifier','PrintOnCheckName',
      'ResaleNum','SalesTermRef','SecondaryTaxIdentifier','ShipAddr','Source','Suffix',
      'TaxCodeRef','TaxExemptionReasonId','TaxExemptionReasonRef','Taxable',
      'TermsRef','Title','WebAddr'
    ],
    ITEMS: [
      'Id','Active','AssetAccountRef','ClassRef','Description','ExpenseAccountRef',
      'FullyQualifiedName','IncomeAccountRef','InvStartDate','ItemGroupDetail',
      'Level','Name','ParentRef','PrefVendorRef','PrintGroupedItems',
      'PurchaseCost','PurchaseDesc','QtyOnHand','Sku','SubItem',
      'TaxClassificationRef','Taxable','TrackQtyOnHand','Type','UnitPrice'
    ],
    CLASSES: ['Id','Active','Name','FullyQualifiedName','SubClass','ParentRef'],
    TERMS: [
      'Id','Active','Name','DayOfMonthDue','DiscountDayOfMonth','DiscountDays',
      'DiscountPercent','DueDays','DueNextMonthDays','Type'
    ],
    TAX_CODES: [
      'Id','Active','Description','Hidden','Name','PurchaseTaxRateList',
      'SalesTaxRateList','TaxCodeConfigType','TaxGroup','Taxable'
    ],
    DEPARTMENTS: [
      'Id','Active','FullyQualifiedName','Name','ParentRef','SubDepartment'
    ],
    VENDORS: [
      'Id','AcctNum','Active','AlternatePhone','Balance','BillAddr','BillRate','CompanyName',
      'CostRate','CurrencyRef','DisplayName','FamilyName','Fax','GivenName','MiddleName',
      'Mobile','PrimaryEmailAddr','PrimaryPhone','PrintOnCheckName','Suffix',
      'TaxIdentifier','TermRef','Title','Vendor1099','WebAddr'
    ],
    ACCOUNTS: [
      'Id','AccountSubType','AccountType','AcctNum','Active','BankNum',
      'Classification','CurrencyRef','CurrentBalance','CurrentBalanceWithSubAccounts',
      'Description','FullyQualifiedName','Name','OpeningBalance',
      'OpeningBalanceDate','ParentRef','SubAccount','TaxCodeRef'
    ],
    INVOICES: [
      'Id','ARAccountRef','AllowIPNPayment','AllowOnlineACHPayment',
      'AllowOnlineAffirmPayment','AllowOnlineCreditCardPayment','AllowOnlinePayPalPayment',
      'AllowOnlinePayment','ApplyTaxAfterDiscount','Balance','BillAddr','BillEmail',
      'BillEmailBcc','BillEmailCc','ClassRef','CreditCardPayment','CurrencyRef',
      'CustomField','CustomerMemo','CustomerRef','DeliveryInfo','DepartmentRef','Deposit',
      'DocNumber','DueDate','EInvoiceStatus','EmailStatus','ExchangeRate','FreeFormAddress',
      'HomeBalance','HomeTotalAmt','Line','LinkedTxn','PaymentMethodRef','PaymentRefNum',
      'PrintStatus','PrivateNote','RecurDataRef','SalesTermRef','ScheduledPaymentId',
      'ShipAddr','ShipDate','ShipFromAddr','ShipMethodRef','TaxExemptionRef','TotalAmt',
      'TrackingNum','TxnApprovalInfo','TxnDate','TxnTaxDetail'
    ],
    PAYMENTS: [
      'Id','ARAccountRef','CreditCardPayment','CurrencyRef','CustomerRef',
      'DepositToAccountRef','ExchangeRate','HomeTotalAmt','Line','LinkedTxn',
      'PaymentExtendedType','PaymentMethodRef','PaymentRefNum','PaymentType',
      'PrivateNote','ProcessPayment','TotalAmt','TxnDate','TxnSource','UnappliedAmt'
    ],
    CREDIT_MEMOS: [
      'Id','ARAccountRef','ApplyTaxAfterDiscount','Balance','BillAddr','BillEmail',
      'BillEmailBcc','BillEmailCc','ClassRef','CurrencyRef','CustomField',
      'CustomerMemo','CustomerRef','DeliveryInfo','DepartmentRef','DocNumber',
      'EmailStatus','ExchangeRate','FreeFormAddress','HomeRemainingCredit',
      'HomeTotalAmt','Line','LinkedTxn','PrintStatus','PrivateNote','RecurDataRef',
      'RemainingCredit','ShipAddr','ShipDate','ShipFromAddr','TaxExemptionRef',
      'TotalAmt','TrackingNum','TxnDate','TxnTaxDetail'
    ],
    ESTIMATES: [
      'Id','AcceptedBy','AcceptedDate','ApplyTaxAfterDiscount','BillAddr','BillEmail',
      'ClassRef','CurrencyRef','CustomField','CustomerMemo','CustomerRef',
      'DepartmentRef','DocNumber','EmailStatus','ExchangeRate','ExpirationDate',
      'HomeTotalAmt','Line','LinkedTxn','PrintStatus','PrivateNote','ShipAddr',
      'ShipDate','TotalAmt','TrackingNum','TxnDate','TxnStatus','TxnTaxDetail'
    ],
    BILLS: [
      'Id','APAccountRef','Balance','CurrencyRef','DepartmentRef','DocNumber',
      'DueDate','ExchangeRate','GlobalTaxCalculation','HomeBalance','HomeTotalAmt',
      'IncludeInAnnualTPAR','Line','LinkedTxn','PrivateNote','SalesTermRef',
      'TotalAmt','TxnDate','TxnTaxDetail','VendorRef'
    ],
    BILL_PAYMENTS: [
      'Id','APAccountRef','CheckPayment','CreditCardPayment','CurrencyRef',
      'DepartmentRef','DocNumber','ExchangeRate','HomeTotalAmt','Line','PayType',
      'PrivateNote','ProcessBillPayment','TotalAmt','TxnDate','VendorRef'
    ],
    PURCHASES: [
      'Id','AccountRef','Credit','CurrencyRef','DepartmentRef','DocNumber',
      'EntityRef','ExchangeRate','GlobalTaxCalculation','HomeTotalAmt',
      'IncludeInAnnualTPAR','Line','LinkedTxn','PaymentMethodRef','PaymentType',
      'PrintStatus','PrivateNote','RemitToAddr','TotalAmt','TxnDate','TxnTaxDetail'
    ],
    DEPOSITS: [
      'Id','CashBack','CurrencyRef','DepartmentRef','DepositToAccountRef',
      'DocNumber','ExchangeRate','HomeTotalAmt','Line','PrivateNote','TotalAmt',
      'TxnDate'
    ],
    JOURNAL_ENTRIES: [
      'Id','Adjustment','CurrencyRef','DepartmentRef','DocNumber','ExchangeRate',
      'GlobalTaxCalculation','HomeTotalAmt','Line','PrivateNote','TotalAmt',
      'TxnDate','TxnTaxDetail'
    ],
    SALES_RECEIPTS: [
      'Id','ApplyTaxAfterDiscount','BillAddr','BillEmail','ClassRef',
      'CreditCardPayment','CurrencyRef','CustomField','CustomerMemo','CustomerRef',
      'DeliveryInfo','DepartmentRef','DepositToAccountRef','DocNumber',
      'EmailStatus','ExchangeRate','HomeTotalAmt','Line','LinkedTxn',
      'PaymentMethodRef','PaymentRefNum','PrintStatus','PrivateNote','ShipAddr',
      'ShipDate','TotalAmt','TrackingNum','TxnDate','TxnTaxDetail'
    ],
    RECURRING_TRANSACTIONS: [
      'Id','Active','Enabled','EntityType','Name','RecurData','RecurType',
      'RecurrenceInfo','RecurringData','RecurringInfo','RecurringType','Schedule',
      'ScheduleInfo','TemplateName','TemplateTransaction','Transaction',
      'TransactionTemplate','TransactionType','Txn','TxnType',
      'SalesReceipt','Invoice','Estimate','CreditMemo','RefundReceipt','Bill',
      'Purchase','Check','Expense','JournalEntry','Deposit','Transfer',
      'PurchaseOrder','VendorCredit'
    ],
    REFUND_RECEIPTS: [
      'Id','ApplyTaxAfterDiscount','BillAddr','BillEmail','ClassRef',
      'CreditCardPayment','CurrencyRef','CustomField','CustomerMemo','CustomerRef',
      'DeliveryInfo','DepartmentRef','DepositToAccountRef','DocNumber',
      'EmailStatus','ExchangeRate','HomeTotalAmt','Line','LinkedTxn',
      'PaymentMethodRef','PaymentRefNum','PrintStatus','PrivateNote','ShipAddr',
      'ShipDate','TotalAmt','TrackingNum','TxnDate','TxnTaxDetail'
    ]
  })
});

function resetQboHistoricalFlattenedContractCoverageAudit() {
  PropertiesService.getScriptProperties()
    .deleteProperty(QBO_HISTORICAL_CONTRACT_AUDIT_.CURSOR_PROPERTY);

  const result = {
    version: QBO_STATE_CAPTURE.VERSION,
    mode: 'HISTORICAL_FLATTENED_CONTRACT_COVERAGE_AUDIT_RESET',
    reset: true,
    canonicalWritesPerformed: false,
    migrationCursorChanged: false
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Runs exactly one export/source coverage audit and advances only the dedicated
 * audit cursor. Re-run this function until complete=true.
 */
function auditQboHistoricalFlattenedContractCoverageNext() {
  const props = PropertiesService.getScriptProperties();
  const cursorRaw = props.getProperty(QBO_HISTORICAL_CONTRACT_AUDIT_.CURSOR_PROPERTY);
  let cursor = {exportIndex: 0, sourceIndex: 0};

  if (cursorRaw) {
    try {
      const parsed = JSON.parse(cursorRaw);
      cursor.exportIndex = Number(parsed.exportIndex) || 0;
      cursor.sourceIndex = Number(parsed.sourceIndex) || 0;
    } catch (e) {
      throw new Error('INVALID_HISTORICAL_CONTRACT_AUDIT_CURSOR ' + cursorRaw);
    }
  }

  if (cursor.exportIndex >= QBO_HISTORICAL_CONTRACT_AUDIT_.EXPORTS.length) {
    const done = {
      version: QBO_STATE_CAPTURE.VERSION,
      mode: 'HISTORICAL_FLATTENED_CONTRACT_COVERAGE_AUDIT',
      complete: true,
      message: 'All configured exports/sources have been screened.',
      canonicalWritesPerformed: false,
      migrationCursorChanged: false
    };
    console.log(JSON.stringify(done, null, 2));
    return done;
  }

  const exportKey = QBO_HISTORICAL_CONTRACT_AUDIT_.EXPORTS[cursor.exportIndex];
  const stateSs = getQboStateCaptureSpreadsheet_();
  const sourceSheet = stateSs.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
  const sources = loadQboStateCaptureWriteSources_(sourceSheet, exportKey)
    .filter(function(source) {
      return source.sourceStatus === QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE;
    });

  if (!sources.length) {
    const nextCursor = {
      exportIndex: cursor.exportIndex + 1,
      sourceIndex: 0
    };
    props.setProperty(
      QBO_HISTORICAL_CONTRACT_AUDIT_.CURSOR_PROPERTY,
      JSON.stringify(nextCursor)
    );
    const noSources = {
      version: QBO_STATE_CAPTURE.VERSION,
      mode: 'HISTORICAL_FLATTENED_CONTRACT_COVERAGE_AUDIT',
      exportKey: exportKey,
      sourceIndex: null,
      sourcesFound: 0,
      status: 'NO_AVAILABLE_SOURCES',
      nextCursor: nextCursor,
      complete: false,
      canonicalWritesPerformed: false,
      migrationCursorChanged: false
    };
    console.log(JSON.stringify(noSources, null, 2));
    return noSources;
  }

  if (cursor.sourceIndex >= sources.length) {
    cursor.exportIndex += 1;
    cursor.sourceIndex = 0;
    props.setProperty(
      QBO_HISTORICAL_CONTRACT_AUDIT_.CURSOR_PROPERTY,
      JSON.stringify(cursor)
    );
    return auditQboHistoricalFlattenedContractCoverageNext();
  }

  const source = sources[cursor.sourceIndex];
  validateQboStateCaptureWriteSource_(source, getQboExportManifestEntry_(exportKey));

  const sourceSs = SpreadsheetApp.openById(source.masterBackupFileId);
  const parentSheetName = QBO_HISTORICAL_CONTRACT_AUDIT_.PARENT_SHEETS[exportKey];
  const parentSheet = sourceSs.getSheetByName(parentSheetName);
  if (!parentSheet) {
    throw new Error(
      'HISTORICAL_CONTRACT_AUDIT_PARENT_SHEET_MISSING export=' +
      exportKey + ' sheet=' + parentSheetName
    );
  }

  const data = qboHistoricalContractAuditReadSheet_(parentSheet);
  if (data.index.RawJSON === undefined) {
    throw new Error(
      'HISTORICAL_CONTRACT_AUDIT_RAWJSON_COLUMN_MISSING export=' + exportKey
    );
  }

  const covered = Object.create(null);
  (QBO_HISTORICAL_CONTRACT_AUDIT_.COVERED_TOP_LEVEL_KEYS[exportKey] || [])
    .forEach(function(key) { covered[key] = true; });

  // Historical Master Backups must be judged by the contract physically
  // present in that source, not by today's exporter schema. IsProject and
  // ResaleNum were added to the Customer exporter in v1.5.16; legacy backups
  // without those columns remain correctly flagged as historical contract gaps.
  if (exportKey === 'CUSTOMERS') {
    if (data.index.IsProject === undefined) delete covered.IsProject;
    if (data.index.ResaleNum === undefined) delete covered.ResaleNum;
  }

  // Items require a stronger physical-contract signature. Historical Item
  // sheets already contained a PrintGroupedItems column, but the legacy
  // exporter populated it from ItemGroupDetail.PrintGroupedItems instead of
  // the QBO top-level Item.PrintGroupedItems property. Therefore mere column
  // presence is not sufficient evidence that the governed field was preserved.
  //
  // The v1.5.20 Item contract is considered physically present only when the
  // full corrected schema signature exists. Legacy backups remain correctly
  // flagged as historical contract gaps rather than being retroactively
  // declared complete by today's exporter schema.
  let itemContractEvidence = null;
  if (exportKey === 'ITEMS') {
    itemContractEvidence = {
      hasClassIdColumn: data.index.ClassId !== undefined,
      hasClassNameColumn: data.index.ClassName !== undefined,
      hasLevelColumn: data.index.Level !== undefined,
      hasPrefVendorIdColumn: data.index.PrefVendorId !== undefined,
      hasPrefVendorNameColumn: data.index.PrefVendorName !== undefined,
      hasPrintGroupedItemsColumn: data.index.PrintGroupedItems !== undefined,
      hasTaxClassificationIdColumn:
        data.index.TaxClassificationId !== undefined,
      hasTaxClassificationNameColumn:
        data.index.TaxClassificationName !== undefined
    };

    itemContractEvidence.hasGovernedV1520ItemContract =
      itemContractEvidence.hasClassIdColumn &&
      itemContractEvidence.hasClassNameColumn &&
      itemContractEvidence.hasLevelColumn &&
      itemContractEvidence.hasPrefVendorIdColumn &&
      itemContractEvidence.hasPrefVendorNameColumn &&
      itemContractEvidence.hasPrintGroupedItemsColumn &&
      itemContractEvidence.hasTaxClassificationIdColumn &&
      itemContractEvidence.hasTaxClassificationNameColumn;

    if (!itemContractEvidence.hasGovernedV1520ItemContract) {
      delete covered.ClassRef;
      delete covered.Level;
      delete covered.PrefVendorRef;
      delete covered.PrintGroupedItems;
      delete covered.TaxClassificationRef;
    }
  }

  // Terms require a corrected physical-contract signature. Legacy Term sheets
  // already contained Type, DueDays, DiscountDays, DiscountPercent,
  // DayOfMonthDue, and DueNextMonthDays columns, but the exporter populated
  // them from the wrong nested paths (StandardTerm / DateDrivenTerm) rather
  // than the QBO top-level Term properties. v1.5.22 also adds the previously
  // absent DiscountDayOfMonth column. Therefore legacy column presence alone
  // is not evidence that the governed Term business state was preserved.
  let termContractEvidence = null;
  if (exportKey === 'TERMS') {
    termContractEvidence = {
      hasTypeColumn: data.index.Type !== undefined,
      hasDueDaysColumn: data.index.DueDays !== undefined,
      hasDiscountDaysColumn: data.index.DiscountDays !== undefined,
      hasDiscountPercentColumn: data.index.DiscountPercent !== undefined,
      hasDayOfMonthDueColumn: data.index.DayOfMonthDue !== undefined,
      hasDueNextMonthDaysColumn: data.index.DueNextMonthDays !== undefined,
      hasDiscountDayOfMonthColumn:
        data.index.DiscountDayOfMonth !== undefined
    };

    termContractEvidence.hasGovernedV1522TermContract =
      termContractEvidence.hasTypeColumn &&
      termContractEvidence.hasDueDaysColumn &&
      termContractEvidence.hasDiscountDaysColumn &&
      termContractEvidence.hasDiscountPercentColumn &&
      termContractEvidence.hasDayOfMonthDueColumn &&
      termContractEvidence.hasDueNextMonthDaysColumn &&
      termContractEvidence.hasDiscountDayOfMonthColumn;

    if (!termContractEvidence.hasGovernedV1522TermContract) {
      delete covered.Type;
      delete covered.DueDays;
      delete covered.DiscountDays;
      delete covered.DiscountPercent;
      delete covered.DayOfMonthDue;
      delete covered.DueNextMonthDays;
      delete covered.DiscountDayOfMonth;
    }
  }


  // Vendors require the v1.5.26 physical contract signature for BillRate and
  // CostRate. Historical Vendor sheets did not externalize either QBO
  // top-level business-state field. Today's exporter schema must not cause
  // legacy Master Backups to be retroactively treated as complete.
  let vendorContractEvidence = null;
  if (exportKey === 'VENDORS') {
    vendorContractEvidence = {
      hasBillRateColumn: data.index.BillRate !== undefined,
      hasCostRateColumn: data.index.CostRate !== undefined
    };

    vendorContractEvidence.hasGovernedV1526VendorContract =
      vendorContractEvidence.hasBillRateColumn &&
      vendorContractEvidence.hasCostRateColumn;

    if (!vendorContractEvidence.hasGovernedV1526VendorContract) {
      delete covered.BillRate;
      delete covered.CostRate;
    }
  }

  // Credit Memos require the v1.5.33 physical contract signature for all seven
  // newly governed top-level business-state fields. Historical Credit Memo
  // sheets predate these columns. Today's exporter schema must not cause legacy
  // Master Backups to be retroactively treated as physically complete; their
  // existing canonical history is governed separately by the v1.5.32/v1.5.33
  // controlled historical exception evidence.
  let creditMemoContractEvidence = null;
  if (exportKey === 'CREDIT_MEMOS') {
    creditMemoContractEvidence = {
      hasBalanceColumn: data.index.Balance !== undefined,
      hasBillEmailBccJSONColumn: data.index.BillEmailBccJSON !== undefined,
      hasBillEmailCcJSONColumn: data.index.BillEmailCcJSON !== undefined,
      hasFreeFormAddressColumn: data.index.FreeFormAddress !== undefined,
      hasRecurDataRefJSONColumn: data.index.RecurDataRefJSON !== undefined,
      hasShipFromAddrJSONColumn: data.index.ShipFromAddrJSON !== undefined,
      hasTaxExemptionRefJSONColumn: data.index.TaxExemptionRefJSON !== undefined
    };

    creditMemoContractEvidence.hasGovernedV1533CreditMemoContract =
      creditMemoContractEvidence.hasBalanceColumn &&
      creditMemoContractEvidence.hasBillEmailBccJSONColumn &&
      creditMemoContractEvidence.hasBillEmailCcJSONColumn &&
      creditMemoContractEvidence.hasFreeFormAddressColumn &&
      creditMemoContractEvidence.hasRecurDataRefJSONColumn &&
      creditMemoContractEvidence.hasShipFromAddrJSONColumn &&
      creditMemoContractEvidence.hasTaxExemptionRefJSONColumn;

    if (!creditMemoContractEvidence.hasGovernedV1533CreditMemoContract) {
      [
        'Balance','BillEmailBcc','BillEmailCc','FreeFormAddress','RecurDataRef',
        'ShipFromAddr','TaxExemptionRef'
      ].forEach(function(key) { delete covered[key]; });
    }
  }

  // Invoices require the v1.5.31 physical contract signature for all 15
  // newly governed top-level business-state fields. Historical Invoice sheets
  // predate these columns. Today's exporter schema must not cause legacy Master
  // Backups to be retroactively treated as physically complete; their existing
  // canonical history is governed separately by the v1.5.30/v1.5.31 controlled
  // historical exception evidence.
  let invoiceContractEvidence = null;
  if (exportKey === 'INVOICES') {
    invoiceContractEvidence = {
      hasAllowOnlineAffirmPaymentColumn:
        data.index.AllowOnlineAffirmPayment !== undefined,
      hasAllowOnlinePayPalPaymentColumn:
        data.index.AllowOnlinePayPalPayment !== undefined,
      hasBillEmailBccJSONColumn: data.index.BillEmailBccJSON !== undefined,
      hasBillEmailCcJSONColumn: data.index.BillEmailCcJSON !== undefined,
      hasCreditCardPaymentJSONColumn:
        data.index.CreditCardPaymentJSON !== undefined,
      hasEInvoiceStatusColumn: data.index.EInvoiceStatus !== undefined,
      hasFreeFormAddressColumn: data.index.FreeFormAddress !== undefined,
      hasPaymentMethodRefJSONColumn:
        data.index.PaymentMethodRefJSON !== undefined,
      hasPaymentRefNumColumn: data.index.PaymentRefNum !== undefined,
      hasRecurDataRefJSONColumn: data.index.RecurDataRefJSON !== undefined,
      hasScheduledPaymentIdColumn:
        data.index.ScheduledPaymentId !== undefined,
      hasShipFromAddrJSONColumn: data.index.ShipFromAddrJSON !== undefined,
      hasShipMethodRefJSONColumn: data.index.ShipMethodRefJSON !== undefined,
      hasTaxExemptionRefJSONColumn:
        data.index.TaxExemptionRefJSON !== undefined,
      hasTxnApprovalInfoJSONColumn:
        data.index.TxnApprovalInfoJSON !== undefined
    };

    invoiceContractEvidence.hasGovernedV1531InvoiceContract =
      invoiceContractEvidence.hasAllowOnlineAffirmPaymentColumn &&
      invoiceContractEvidence.hasAllowOnlinePayPalPaymentColumn &&
      invoiceContractEvidence.hasBillEmailBccJSONColumn &&
      invoiceContractEvidence.hasBillEmailCcJSONColumn &&
      invoiceContractEvidence.hasCreditCardPaymentJSONColumn &&
      invoiceContractEvidence.hasEInvoiceStatusColumn &&
      invoiceContractEvidence.hasFreeFormAddressColumn &&
      invoiceContractEvidence.hasPaymentMethodRefJSONColumn &&
      invoiceContractEvidence.hasPaymentRefNumColumn &&
      invoiceContractEvidence.hasRecurDataRefJSONColumn &&
      invoiceContractEvidence.hasScheduledPaymentIdColumn &&
      invoiceContractEvidence.hasShipFromAddrJSONColumn &&
      invoiceContractEvidence.hasShipMethodRefJSONColumn &&
      invoiceContractEvidence.hasTaxExemptionRefJSONColumn &&
      invoiceContractEvidence.hasTxnApprovalInfoJSONColumn;

    if (!invoiceContractEvidence.hasGovernedV1531InvoiceContract) {
      [
        'AllowOnlineAffirmPayment','AllowOnlinePayPalPayment','BillEmailBcc',
        'BillEmailCc','CreditCardPayment','EInvoiceStatus','FreeFormAddress',
        'PaymentMethodRef','PaymentRefNum','RecurDataRef','ScheduledPaymentId',
        'ShipFromAddr','ShipMethodRef','TaxExemptionRef','TxnApprovalInfo'
      ].forEach(function(key) { delete covered[key]; });
    }
  }

  // TaxCodes require the v1.5.24 physical contract signature for Hidden.
  // Historical TaxCode sheets did not externalize the QBO top-level Hidden
  // business-state field. Mere use of today's exporter schema must not cause
  // legacy Master Backups to be retroactively treated as complete.
  let taxCodeContractEvidence = null;
  if (exportKey === 'TAX_CODES') {
    taxCodeContractEvidence = {
      hasHiddenColumn: data.index.Hidden !== undefined
    };

    taxCodeContractEvidence.hasGovernedV1524TaxCodeContract =
      taxCodeContractEvidence.hasHiddenColumn;

    if (!taxCodeContractEvidence.hasGovernedV1524TaxCodeContract) {
      delete covered.Hidden;
    }
  }

  const observedCounts = Object.create(null);
  let completeRawRows = 0;
  let truncatedRawRows = 0;
  let invalidRawRows = 0;

  data.rows.forEach(function(row) {
    const raw = String(row[data.index.RawJSON] || '');
    if (!raw) return;

    if (raw.indexOf(QBO_STATE_CAPTURE_RAW_TRUNCATION_MARKER_) !== -1) {
      truncatedRawRows += 1;
      return;
    }

    let entity;
    try {
      entity = JSON.parse(raw);
    } catch (e) {
      invalidRawRows += 1;
      return;
    }

    completeRawRows += 1;

    const canonical = qboCanonicalizeValue_(entity, {
      exportKey: exportKey,
      entityType: exportKey,
      path: '',
      parentKey: '',
      root: true
    });

    if (!canonical || typeof canonical !== 'object' || Array.isArray(canonical)) {
      return;
    }

    Object.keys(canonical).forEach(function(key) {
      observedCounts[key] = (observedCounts[key] || 0) + 1;
    });
  });

  const observedKeys = Object.keys(observedCounts).sort();
  const uncovered = observedKeys
    .filter(function(key) { return !covered[key]; })
    .map(function(key) {
      return {key: key, count: observedCounts[key]};
    });

  const coveredObserved = observedKeys
    .filter(function(key) { return !!covered[key]; })
    .map(function(key) {
      return {key: key, count: observedCounts[key]};
    });

  const nextCursor = {
    exportIndex: cursor.exportIndex,
    sourceIndex: cursor.sourceIndex + 1
  };
  if (nextCursor.sourceIndex >= sources.length) {
    nextCursor.exportIndex += 1;
    nextCursor.sourceIndex = 0;
  }

  props.setProperty(
    QBO_HISTORICAL_CONTRACT_AUDIT_.CURSOR_PROPERTY,
    JSON.stringify(nextCursor)
  );

  const result = {
    version: QBO_STATE_CAPTURE.VERSION,
    canonicalizationVersion: QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
    mode: 'HISTORICAL_FLATTENED_CONTRACT_TOP_LEVEL_COVERAGE_AUDIT',
    architectureRule:
      'Canonical state derives from governed flattened export contract plus governed child datasets; RawJSON is validation evidence.',
    exportKey: exportKey,
    sourceIndex: cursor.sourceIndex,
    sourcesFound: sources.length,
    sourceId: source.sourceId,
    masterBackupFileName: source.masterBackupFileName,
    population: {
      parentRows: data.rows.length,
      completeRawRows: completeRawRows,
      truncatedRawRows: truncatedRawRows,
      invalidRawRows: invalidRawRows
    },
    sourceContractEvidence: (function() {
      if (exportKey === 'CUSTOMERS') {
        return {
          hasIsProjectColumn: data.index.IsProject !== undefined,
          hasResaleNumColumn: data.index.ResaleNum !== undefined
        };
      }
      if (exportKey === 'ITEMS') return itemContractEvidence;
      if (exportKey === 'TERMS') return termContractEvidence;
      if (exportKey === 'TAX_CODES') return taxCodeContractEvidence;
      if (exportKey === 'VENDORS') return vendorContractEvidence;
      if (exportKey === 'INVOICES') return invoiceContractEvidence;
      if (exportKey === 'CREDIT_MEMOS') return creditMemoContractEvidence;
      return null;
    })(),
    observedCanonicalTopLevelKeys: observedKeys.length,
    coveredObservedCanonicalKeys: coveredObserved,
    uncoveredObservedCanonicalKeys: uncovered,
    topLevelCoveragePassed: uncovered.length === 0,
    auditScope:
      'TOP_LEVEL_COVERAGE_SCREEN_ONLY_NOT_FULL_VALUE_EQUIVALENCE',
    canonicalWritesPerformed: false,
    migrationCursorChanged: false,
    auditCursorAdvancedTo: nextCursor,
    actionRequired: uncovered.length > 0,
    conclusion: uncovered.length === 0
      ? 'NO_UNCOVERED_CANONICAL_TOP_LEVEL_KEYS_OBSERVED'
      : 'UNEXTERNALIZED_CANONICAL_TOP_LEVEL_KEYS_OBSERVED'
  };

  console.log(JSON.stringify(result, null, 2));
  console.log(
    '[HISTORICAL FLATTENED CONTRACT COVERAGE] | ' +
    (result.topLevelCoveragePassed ? 'PASS' : 'ACTION_REQUIRED') +
    ' | export=' + exportKey +
    ' | sourceIndex=' + cursor.sourceIndex +
    ' | completeRaw=' + completeRawRows +
    ' | truncatedRaw=' + truncatedRawRows +
    ' | uncovered=' + uncovered.length +
    ' | nextExportIndex=' + nextCursor.exportIndex +
    ' | nextSourceIndex=' + nextCursor.sourceIndex
  );

  return result;
}

function qboHistoricalContractAuditReadSheet_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow < 1 || lastColumn < 1) {
    return {
      headers: [],
      index: Object.create(null),
      rows: []
    };
  }

  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values[0].map(function(value) {
    return String(value || '').trim();
  });

  return {
    headers: headers,
    index: buildQboStateCaptureWriteHeaderIndex_(headers),
    rows: values.slice(1)
  };
}
