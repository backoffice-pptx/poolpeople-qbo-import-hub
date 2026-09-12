/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 93_QBO_ExportContractRegistry.js
 * Purpose     : Explicit governed API-path -> export-representation contract
 *               for flattening remediation introduced after the v1.5.43
 *               recursive historical contract audit.
 *
 * Public API:
 *   - getQboExportContractRegistry()
 *   - validateQboFlatteningRemediationContract()
 *
 * Notes:
 *   - This registry is intentionally explicit. It does not infer governance by
 *     comparing values or column names.
 *   - It establishes the contract for paths corrected in this remediation and
 *     the structural dispositions needed by the permanent contract-drift
 *     control. It is not yet the complete 21-entity runtime drift registry.
 *   - RawJSON remains validation evidence; canonical state derives from the
 *     governed flattened export contract plus governed child datasets.
 * ============================================================================
 */

const QBO_EXPORT_CONTRACT_REMEDIATION_VERSION = '2026-09-12.3';

const QBO_EXPORT_CONTRACT_DISPOSITION = Object.freeze({
  FLATTENED_COLUMNS: 'FLATTENED_COLUMNS',
  GOVERNED_JSON: 'GOVERNED_JSON',
  CHILD_DATASET: 'CHILD_DATASET',
  EXCLUDED_TECHNICAL: 'EXCLUDED_TECHNICAL',
  DERIVED_CLASSIFICATION: 'DERIVED_CLASSIFICATION',
  DERIVED_EVIDENCE: 'DERIVED_EVIDENCE',
  DERIVED_ORDINAL: 'DERIVED_ORDINAL',
  RELATIONSHIP_CONTRACT: 'RELATIONSHIP_CONTRACT',
  REMOVED_NO_SOURCE_PATH: 'REMOVED_NO_SOURCE_PATH'
});

/**
 * Returns the explicitly governed paths introduced/confirmed by the flattening
 * remediation following recursive audit v1.5.43.
 *
 * @return {Object[]} Contract entries.
 */
function getQboExportContractRegistry() {
  const D = QBO_EXPORT_CONTRACT_DISPOSITION;
  const entries = [
    // Items / Tax Codes child contracts.
    contractEntry_('ITEMS', 'CHILD', 'ItemGroupDetail.ItemGroupLine[].ItemRef.type', D.FLATTENED_COLUMNS, 'QBO_ItemGroupLines', ['ComponentItemType']),
    contractEntry_('TAX_CODES', 'CHILD', 'SalesTaxRateList.TaxRateDetail[].TaxTypeApplicable', D.FLATTENED_COLUMNS, 'QBO_TaxCodeRates', ['TaxTypeApplicable']),
    contractEntry_('TAX_CODES', 'CHILD', 'PurchaseTaxRateList.TaxRateDetail[].TaxTypeApplicable', D.FLATTENED_COLUMNS, 'QBO_TaxCodeRates', ['TaxTypeApplicable']),
    contractEntry_('TAX_CODES', 'CHILD', 'TaxRateDetail.TaxType', D.REMOVED_NO_SOURCE_PATH, 'QBO_TaxCodeRates', [], 'Removed from the flattened export. Current QBO TaxRateDetail payloads expose TaxTypeApplicable; no TaxType source path was observed.'),

    // Payments classification and application evidence contract.
    contractEntry_('PAYMENTS', 'PARENT', 'PaymentExtendedType', D.FLATTENED_COLUMNS, 'QBO_Payments', ['PaymentExtendedType'], 'Direct QBO source evidence. PaymentExtendedType=Prepayment is the primary normal source indicator for prepayment classification.'),
    contractEntry_('PAYMENTS', 'PARENT', 'TxnSource', D.FLATTENED_COLUMNS, 'QBO_Payments', ['TxnSource'], 'Direct QBO source evidence retained for provenance and future behavior detection; not the primary canonical prepayment classifier.'),
    contractEntry_('PAYMENTS', 'DERIVED', 'PaymentExtendedType == Prepayment', D.DERIVED_CLASSIFICATION, 'QBO_Payments', ['IsPrepayment'], 'Canonical derived Payment classification signal. True only when the direct QBO source field PaymentExtendedType equals Prepayment.'),
    contractEntry_('PAYMENTS', 'DERIVED', 'legacy estimate-deposit heuristic', D.DERIVED_EVIDENCE, 'QBO_Payments', ['IsEstimateDeposit'], 'Legacy derived evidence retained for backward compatibility and anomaly review. It is not a direct QBO source field and must not drive canonical classification. Known 2025 Trudy Denny / Bruce Farmer true values are exception/test cases with manual-JE intervention.'),
    contractEntry_('PAYMENTS', 'PARENT', 'LinkedTxn[]', D.GOVERNED_JSON, 'QBO_Payments', ['LinkedTransactionsJSON'], 'Parent-level Payment.LinkedTxn only. Do not treat these parent summary columns as a complete representation of line-level payment applications.'),
    contractEntry_('PAYMENTS', 'PARENT', 'Line[]', D.CHILD_DATASET, 'QBO_PaymentApplications', [], 'Payment application relationships are governed through the child dataset. Parent RawJSON remains validation evidence.'),
    contractEntry_('PAYMENTS', 'CHILD', 'Line[].LinkedTxn[]', D.CHILD_DATASET, 'QBO_PaymentApplications', ['LinkedTxnId', 'LinkedTxnType', 'LinkedTxnLineId'], 'Preserve each line-level linked transaction as an application row; current observed target types include Invoice, CreditMemo, Deposit, and JournalEntry.'),
    contractEntry_('PAYMENTS', 'CHILD', 'Line[].Id', D.FLATTENED_COLUMNS, 'QBO_PaymentApplications', ['PaymentLineId'], 'Schema-valid structural field; current QBO Payment application payloads may omit it.'),
    contractEntry_('PAYMENTS', 'CHILD', 'Line[].LinkedTxn[].TxnLineId', D.FLATTENED_COLUMNS, 'QBO_PaymentApplications', ['LinkedTxnLineId'], 'Schema-valid structural field; current QBO Payment application payloads may omit it.'),
    contractEntry_('PAYMENTS', 'DERIVED', 'Line[].LineNum || lineIndex+1', D.DERIVED_ORDINAL, 'QBO_PaymentApplications', ['PaymentLineNumber'], 'Uses QBO LineNum when present; otherwise a derived 1-based ordinal. Do not interpret a fallback ordinal as a QBO-sourced line number.'),
    contractEntry_('PAYMENTS', 'DERIVED', 'linkedIndex+1', D.DERIVED_ORDINAL, 'QBO_PaymentApplications', ['LinkedTxnNumber'], 'Derived 1-based ordinal within a Payment line. Not a QBO-sourced transaction line identifier.'),

    // Recurring Transactions. QBO returns recurrence metadata inside the embedded
    // transaction (for example Invoice.RecurringInfo.ScheduleInfo), not only on
    // the outer recurring wrapper. Keep the two-sheet parent/line model.
    contractEntry_('RECURRING_TRANSACTIONS', 'PARENT', '<EmbeddedTransaction>.RecurringInfo', D.FLATTENED_COLUMNS, 'QBO_RecurringTransactions', ['TemplateName', 'RecurType', 'Active', 'RecurringInfoJSON'], 'Resolve from the embedded transaction first, with wrapper-level fallback for alternate payload shapes.'),
    contractEntry_('RECURRING_TRANSACTIONS', 'PARENT', '<EmbeddedTransaction>.RecurringInfo.ScheduleInfo', D.FLATTENED_COLUMNS, 'QBO_RecurringTransactions', ['IntervalType', 'NumInterval', 'DayOfMonth', 'DayOfWeek', 'WeekOfMonth', 'MonthOfYear', 'StartDate', 'EndDate', 'PreviousDate', 'NextDate', 'ScheduleInfoJSON']),
    contractEntry_('RECURRING_TRANSACTIONS', 'PARENT', '<EmbeddedTransaction>.Line[]', D.CHILD_DATASET, 'QBO_RecurringTransactionLines', [], 'Repeating transaction lines remain the only separate recurring child dataset; one-to-one recurrence/schedule metadata remains denormalized on the parent.'),

    // Estimates parent contract.
    contractEntry_('ESTIMATES', 'PARENT', 'BillEmailBcc', D.GOVERNED_JSON, 'QBO_Estimates', ['BillEmailBccJSON']),
    contractEntry_('ESTIMATES', 'PARENT', 'BillEmailBcc.Address', D.FLATTENED_COLUMNS, 'QBO_Estimates', ['BillEmailBccAddress']),
    contractEntry_('ESTIMATES', 'PARENT', 'BillEmailCc', D.GOVERNED_JSON, 'QBO_Estimates', ['BillEmailCcJSON']),
    contractEntry_('ESTIMATES', 'PARENT', 'BillEmailCc.Address', D.FLATTENED_COLUMNS, 'QBO_Estimates', ['BillEmailCcAddress']),
    contractEntry_('ESTIMATES', 'PARENT', 'FreeFormAddress', D.FLATTENED_COLUMNS, 'QBO_Estimates', ['FreeFormAddress']),
    contractEntry_('ESTIMATES', 'PARENT', 'ShipFromAddr', D.GOVERNED_JSON, 'QBO_Estimates', ['ShipFromAddrJSON']),
    contractEntry_('ESTIMATES', 'PARENT', 'ShipFromAddr.*', D.FLATTENED_COLUMNS, 'QBO_Estimates', shipFromAddressColumns_()),
    contractEntry_('ESTIMATES', 'PARENT', 'DeliveryInfo', D.GOVERNED_JSON, 'QBO_Estimates', ['DeliveryInfoJSON']),
    contractEntry_('ESTIMATES', 'PARENT', 'DeliveryInfo.DeliveryType', D.FLATTENED_COLUMNS, 'QBO_Estimates', ['DeliveryType']),
    contractEntry_('ESTIMATES', 'PARENT', 'DeliveryInfo.DeliveryTime', D.FLATTENED_COLUMNS, 'QBO_Estimates', ['DeliveryTime']),
    contractEntry_('ESTIMATES', 'PARENT', 'TaxExemptionRef', D.GOVERNED_JSON, 'QBO_Estimates', ['TaxExemptionRefJSON']),
    contractEntry_('ESTIMATES', 'PARENT', 'TaxExemptionRef.value', D.FLATTENED_COLUMNS, 'QBO_Estimates', ['TaxExemptionRefId']),
    contractEntry_('ESTIMATES', 'PARENT', 'TaxExemptionRef.name', D.FLATTENED_COLUMNS, 'QBO_Estimates', ['TaxExemptionRefName']),

    // Bills.
    contractEntry_('BILLS', 'PARENT', 'TxnSource', D.FLATTENED_COLUMNS, 'QBO_Bills', ['TxnSource']),
    contractEntry_('BILLS', 'PARENT', 'VendorAddr', D.GOVERNED_JSON, 'QBO_Bills', ['VendorAddrJSON']),
    contractEntry_('BILLS', 'PARENT', 'VendorAddr.*', D.FLATTENED_COLUMNS, 'QBO_Bills', vendorAddressColumns_()),

    // Purchases.
    contractEntry_('PURCHASES', 'PARENT', 'status', D.FLATTENED_COLUMNS, 'QBO_Purchases', ['Status']),
    contractEntry_('PURCHASES', 'PARENT', 'PurchaseEx', D.GOVERNED_JSON, 'QBO_Purchases', ['PurchaseExJSON']),
    contractEntry_('PURCHASES', 'PARENT', 'PurchaseEx.any[]', D.GOVERNED_JSON, 'QBO_Purchases', ['PurchaseExJSON'], 'Preserve source extension container; do not flatten JAXB implementation scaffolding.'),

    // Deposits.
    contractEntry_('DEPOSITS', 'PARENT', 'TxnTaxDetail', D.GOVERNED_JSON, 'QBO_Deposits', ['TransactionTaxDetailJSON']),

    // Sales Receipts.
    contractEntry_('SALES_RECEIPTS', 'PARENT', 'BillEmailBcc', D.GOVERNED_JSON, 'QBO_SalesReceipts', ['BillEmailBccJSON']),
    contractEntry_('SALES_RECEIPTS', 'PARENT', 'BillEmailBcc.Address', D.FLATTENED_COLUMNS, 'QBO_SalesReceipts', ['BillEmailBccAddress']),
    contractEntry_('SALES_RECEIPTS', 'PARENT', 'BillEmailCc', D.GOVERNED_JSON, 'QBO_SalesReceipts', ['BillEmailCcJSON']),
    contractEntry_('SALES_RECEIPTS', 'PARENT', 'BillEmailCc.Address', D.FLATTENED_COLUMNS, 'QBO_SalesReceipts', ['BillEmailCcAddress']),
    contractEntry_('SALES_RECEIPTS', 'PARENT', 'FreeFormAddress', D.FLATTENED_COLUMNS, 'QBO_SalesReceipts', ['FreeFormAddress']),
    contractEntry_('SALES_RECEIPTS', 'PARENT', 'ShipFromAddr', D.GOVERNED_JSON, 'QBO_SalesReceipts', ['ShipFromAddrJSON']),
    contractEntry_('SALES_RECEIPTS', 'PARENT', 'ShipFromAddr.*', D.FLATTENED_COLUMNS, 'QBO_SalesReceipts', shipFromAddressColumns_()),
    contractEntry_('SALES_RECEIPTS', 'PARENT', 'RecurDataRef', D.GOVERNED_JSON, 'QBO_SalesReceipts', ['RecurDataRefJSON']),
    contractEntry_('SALES_RECEIPTS', 'PARENT', 'RecurDataRef.value', D.FLATTENED_COLUMNS, 'QBO_SalesReceipts', ['RecurDataRefId']),
    contractEntry_('SALES_RECEIPTS', 'PARENT', 'RecurDataRef.name', D.FLATTENED_COLUMNS, 'QBO_SalesReceipts', ['RecurDataRefName']),
    contractEntry_('SALES_RECEIPTS', 'PARENT', 'TaxExemptionRef', D.GOVERNED_JSON, 'QBO_SalesReceipts', ['TaxExemptionRefJSON']),
    contractEntry_('SALES_RECEIPTS', 'PARENT', 'TaxExemptionRef.value', D.FLATTENED_COLUMNS, 'QBO_SalesReceipts', ['TaxExemptionRefId']),
    contractEntry_('SALES_RECEIPTS', 'PARENT', 'TaxExemptionRef.name', D.FLATTENED_COLUMNS, 'QBO_SalesReceipts', ['TaxExemptionRefName']),
    contractEntry_('SALES_RECEIPTS', 'PARENT', 'TxnSource', D.FLATTENED_COLUMNS, 'QBO_SalesReceipts', ['TxnSource']),

    // Refund Receipts.
    contractEntry_('REFUND_RECEIPTS', 'PARENT', 'ShipFromAddr', D.GOVERNED_JSON, 'QBO_RefundReceipts', ['ShipFromAddrJSON']),
    contractEntry_('REFUND_RECEIPTS', 'PARENT', 'ShipFromAddr.*', D.FLATTENED_COLUMNS, 'QBO_RefundReceipts', shipFromAddressColumns_()),
    contractEntry_('REFUND_RECEIPTS', 'PARENT', 'TaxExemptionRef', D.GOVERNED_JSON, 'QBO_RefundReceipts', ['TaxExemptionRefJSON']),
    contractEntry_('REFUND_RECEIPTS', 'PARENT', 'TaxExemptionRef.value', D.FLATTENED_COLUMNS, 'QBO_RefundReceipts', ['TaxExemptionRefId']),
    contractEntry_('REFUND_RECEIPTS', 'PARENT', 'TaxExemptionRef.name', D.FLATTENED_COLUMNS, 'QBO_RefundReceipts', ['TaxExemptionRefName'])
  ];

  // Entity/path-specific LinkedTxn relationship contracts. Typed convenience
  // columns exist only for modeled target types. LinkedTransactionCount and
  // LinkedTransactionsJSON remain structural evidence; unmodeled types remain
  // in LinkedOtherTransactionsJSON rather than silently becoming zero columns.
  getQboLinkedTransactionContract().forEach(relationship => {
    const typedColumns = [];
    normalizeArray_(relationship.modeledTargetTypes).forEach(typeName => {
      typedColumns.push('Linked' + typeName + 'Count');
      typedColumns.push('Linked' + typeName + 'Ids');
    });
    entries.push(
      contractEntry_(
        relationship.exportKey,
        relationship.relationshipSource,
        relationship.apiPath,
        D.RELATIONSHIP_CONTRACT,
        relationship.sheetName,
        ['LinkedTransactionCount'].concat(typedColumns, ['LinkedOtherTransactionCount', 'LinkedOtherTransactionsJSON', 'LinkedTransactionsJSON']),
        relationship.notes
      )
    );
  });

  // Shared SalesItemLineDetail child contract across all sister transaction exporters.
  [
    ['INVOICES', 'QBO_InvoiceLines'],
    ['CREDIT_MEMOS', 'QBO_CreditMemoLines'],
    ['ESTIMATES', 'QBO_EstimateLines'],
    ['SALES_RECEIPTS', 'QBO_SalesReceiptLines'],
    ['REFUND_RECEIPTS', 'QBO_RefundReceiptLines']
  ].forEach(pair => {
    entries.push(
      contractEntry_(pair[0], 'CHILD', 'Line[].SalesItemLineDetail.ItemAccountRef.value', D.FLATTENED_COLUMNS, pair[1], ['ItemAccountId']),
      contractEntry_(pair[0], 'CHILD', 'Line[].SalesItemLineDetail.ItemAccountRef.name', D.FLATTENED_COLUMNS, pair[1], ['ItemAccountName']),
      contractEntry_(pair[0], 'CHILD', 'Line[].SalesItemLineDetail.TaxClassificationRef.value', D.FLATTENED_COLUMNS, pair[1], ['TaxClassificationId']),
      contractEntry_(pair[0], 'CHILD', 'Line[].SalesItemLineDetail.TaxClassificationRef.name', D.FLATTENED_COLUMNS, pair[1], ['TaxClassificationName']),
      contractEntry_(pair[0], 'PARENT', 'Line[]', D.CHILD_DATASET, pair[1], [], 'Line collection is governed through the child dataset; do not duplicate it into parent columns.')
    );
  });

  // Structural technical containers intentionally not exploded into columns.
  entries.push(
    contractEntry_('PAYMENTS', 'CHILD', 'Line[].LineEx.any[]', D.EXCLUDED_TECHNICAL, 'QBO_PaymentApplications', [], 'JAXB/extension scaffolding is not canonical business-state flattening.'),
    contractEntry_('PURCHASES', 'PARENT', 'PurchaseEx.any[].declaredType', D.EXCLUDED_TECHNICAL, 'QBO_Purchases', [], 'Serialization implementation metadata retained only inside PurchaseExJSON.'),
    contractEntry_('PURCHASES', 'PARENT', 'PurchaseEx.any[].scope', D.EXCLUDED_TECHNICAL, 'QBO_Purchases', [], 'Serialization implementation metadata retained only inside PurchaseExJSON.'),
    contractEntry_('PURCHASES', 'PARENT', 'PurchaseEx.any[].globalScope', D.EXCLUDED_TECHNICAL, 'QBO_Purchases', [], 'Serialization implementation metadata retained only inside PurchaseExJSON.')
  );

  return entries;
}

/**
 * Returns the governed LinkedTxn relationship matrix for the current export
 * contract. relationshipSource distinguishes direct parent links, direct line
 * links, and parent summaries aggregated from child lines.
 *
 * @return {Object[]} LinkedTxn relationship contracts.
 */
function getQboLinkedTransactionContract() {
  return [
    linkedRelationship_('INVOICES', 'QBO_Invoices', 'PARENT', 'Invoice.LinkedTxn[]', ['Payment', 'Estimate', 'ReimburseCharge'], 'Observed in current QBO RawJSON.'),
    linkedRelationship_('INVOICES', 'QBO_InvoiceLines', 'LINE', 'Invoice.Line[].LinkedTxn[]', ['Estimate', 'ReimburseCharge'], 'Observed in current QBO RawJSON.'),
    linkedRelationship_('PAYMENTS', 'QBO_Payments', 'PARENT', 'Payment.LinkedTxn[]', ['Deposit'], 'Direct parent links only. Payment applications are governed separately through QBO_PaymentApplications.'),
    linkedRelationship_('ESTIMATES', 'QBO_Estimates', 'PARENT', 'Estimate.LinkedTxn[]', ['Invoice'], 'Observed direct API link. Estimate-deposit UI relationships are not inferred as Payment LinkedTxn when absent from Accounting API RawJSON.'),
    linkedRelationship_('ESTIMATES', 'QBO_EstimateLines', 'LINE', 'Estimate.Line[].LinkedTxn[]', [], 'No target types currently observed; preserve structural/other JSON evidence for future behavior.'),
    linkedRelationship_('BILLS', 'QBO_Bills', 'PARENT', 'Bill.LinkedTxn[]', ['BillPaymentCheck'], 'Observed in current QBO RawJSON.'),
    linkedRelationship_('BILLS', 'QBO_BillLines', 'LINE', 'Bill.Line[].LinkedTxn[]', [], 'No target types currently observed.'),
    linkedRelationship_('BILL_PAYMENTS', 'QBO_BillPayments', 'AGGREGATED_LINES', 'BillPayment.Line[].LinkedTxn[]', ['Bill', 'VendorCredit'], 'Observed application target types in current QBO RawJSON.'),
    linkedRelationship_('PURCHASES', 'QBO_Purchases', 'PARENT', 'Purchase.LinkedTxn[]', ['ReimburseCharge'], 'Observed in current QBO RawJSON.'),
    linkedRelationship_('PURCHASES', 'QBO_PurchaseLines', 'LINE', 'Purchase.Line[].LinkedTxn[]', ['ReimburseCharge'], 'Observed in current QBO RawJSON.'),
    linkedRelationship_('DEPOSITS', 'QBO_Deposits', 'AGGREGATED_LINES', 'Deposit.Line[].LinkedTxn[]', ['Payment', 'SalesReceipt', 'Invoice', 'JournalEntry', 'Purchase', 'RefundReceipt'], 'Observed in current company RawJSON; current observations govern even where public documentation enumerations are narrower.'),
    linkedRelationship_('DEPOSITS', 'QBO_DepositLines', 'LINE', 'Deposit.Line[].LinkedTxn[]', ['Payment', 'SalesReceipt', 'Invoice', 'JournalEntry', 'Purchase', 'RefundReceipt'], 'Observed in current company RawJSON.'),
    linkedRelationship_('JOURNAL_ENTRIES', 'QBO_JournalEntries', 'AGGREGATED_LINES', 'JournalEntry.Line[].LinkedTxn[]', [], 'Schema-capable structure, but no target types currently observed.'),
    linkedRelationship_('JOURNAL_ENTRIES', 'QBO_JournalEntryLines', 'LINE', 'JournalEntry.Line[].LinkedTxn[]', [], 'Schema-capable structure, but no target types currently observed.'),
    linkedRelationship_('SALES_RECEIPTS', 'QBO_SalesReceipts', 'PARENT', 'SalesReceipt.LinkedTxn[]', ['Deposit'], 'Observed in current QBO RawJSON.'),
    linkedRelationship_('SALES_RECEIPTS', 'QBO_SalesReceiptLines', 'LINE', 'SalesReceipt.Line[].LinkedTxn[]', [], 'No target types currently observed.'),
    linkedRelationship_('CREDIT_MEMOS', 'QBO_CreditMemos', 'PENDING_SCHEMA_REVIEW', 'CreditMemo.LinkedTxn[]', [], 'Current data has no observed targets. Existing generic typed columns remain temporarily pending schema review.'),
    linkedRelationship_('REFUND_RECEIPTS', 'QBO_RefundReceipts', 'PENDING_SCHEMA_REVIEW', 'RefundReceipt.LinkedTxn[]', [], 'Current data has no observed targets. Existing generic typed columns remain temporarily pending schema review.')
  ];
}

function linkedRelationship_(exportKey, sheetName, relationshipSource, apiPath, modeledTargetTypes, notes) {
  return {
    exportKey: exportKey,
    sheetName: sheetName,
    relationshipSource: relationshipSource,
    apiPath: apiPath,
    modeledTargetTypes: modeledTargetTypes || [],
    notes: notes || ''
  };
}

/**
 * Performs a static contract/header validation without calling QBO.
 * Throws when a registry column expected by this remediation is absent.
 *
 * @return {Object} Validation summary.
 */
function validateQboFlatteningRemediationContract() {
  const headersBySheet = {
    QBO_ItemGroupLines: ITEM_GROUP_HEADERS,
    QBO_TaxCodeRates: TAX_CODE_RATE_HEADERS,
    QBO_Payments: PAYMENT_HEADERS,
    QBO_PaymentApplications: PAYMENT_APPLICATION_HEADERS,
    QBO_Invoices: INVOICE_HEADERS,
    QBO_InvoiceLines: INVOICE_LINE_HEADERS,
    QBO_CreditMemos: CREDIT_MEMO_HEADERS,
    QBO_CreditMemoLines: CREDIT_MEMO_LINE_HEADERS,
    QBO_Estimates: ESTIMATE_HEADERS,
    QBO_EstimateLines: ESTIMATE_LINE_HEADERS,
    QBO_Bills: BILL_HEADERS,
    QBO_BillLines: BILL_LINE_HEADERS,
    QBO_BillPayments: BILL_PAYMENT_HEADERS,
    QBO_Purchases: PURCHASE_HEADERS,
    QBO_PurchaseLines: PURCHASE_LINE_HEADERS,
    QBO_Deposits: DEPOSIT_HEADERS,
    QBO_DepositLines: DEPOSIT_LINE_HEADERS,
    QBO_JournalEntries: JOURNAL_ENTRY_HEADERS,
    QBO_JournalEntryLines: JOURNAL_ENTRY_LINE_HEADERS,
    QBO_RecurringTransactions: RECURRING_TRANSACTION_HEADERS,
    QBO_RecurringTransactionLines: RECURRING_TRANSACTION_LINE_HEADERS,
    QBO_SalesReceipts: SALES_RECEIPT_HEADERS,
    QBO_SalesReceiptLines: SALES_RECEIPT_LINE_HEADERS,
    QBO_RefundReceipts: REFUND_RECEIPT_HEADERS,
    QBO_RefundReceiptLines: REFUND_RECEIPT_LINE_HEADERS
  };

  const errors = [];
  const entries = getQboExportContractRegistry();

  entries.forEach(entry => {
    if (!entry.columns || entry.columns.length === 0) {
      return;
    }

    const headers = headersBySheet[entry.sheetName];
    if (!headers) {
      errors.push('No header contract loaded for sheet ' + entry.sheetName);
      return;
    }

    entry.columns.forEach(column => {
      if (headers.indexOf(column) === -1) {
        errors.push(
          entry.exportKey + ' ' + entry.apiPath + ' expects missing column ' +
          entry.sheetName + '.' + column
        );
      }
    });
  });

  if (errors.length) {
    throw new Error(
      'Flattening remediation contract validation failed:\n' +
      errors.join('\n')
    );
  }

  const summary = {
    contractVersion: QBO_EXPORT_CONTRACT_REMEDIATION_VERSION,
    entryCount: entries.length,
    sheetsValidated: Object.keys(headersBySheet).length,
    valid: true
  };

  safeLog_('[EXPORT CONTRACT] ' + JSON.stringify(summary));
  return summary;
}

function contractEntry_(
  exportKey,
  contractLevel,
  apiPath,
  disposition,
  sheetName,
  columns,
  notes
) {
  return {
    contractVersion: QBO_EXPORT_CONTRACT_REMEDIATION_VERSION,
    exportKey: exportKey,
    contractLevel: contractLevel,
    apiPath: apiPath,
    disposition: disposition,
    sheetName: sheetName,
    columns: columns || [],
    notes: notes || ''
  };
}

function shipFromAddressColumns_() {
  return [
    'ShipFromAddrId',
    'ShipFromAddrLine1',
    'ShipFromAddrLine2',
    'ShipFromAddrLine3',
    'ShipFromAddrLine4',
    'ShipFromAddrLine5',
    'ShipFromAddrCity',
    'ShipFromAddrState',
    'ShipFromAddrPostalCode',
    'ShipFromAddrCountry'
  ];
}

function vendorAddressColumns_() {
  return [
    'VendorAddrId',
    'VendorAddrLine1',
    'VendorAddrLine2',
    'VendorAddrLine3',
    'VendorAddrLine4',
    'VendorAddrLine5',
    'VendorAddrCity',
    'VendorAddrState',
    'VendorAddrPostalCode',
    'VendorAddrCountry'
  ];
}
