/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 97_QBO_ObservationNormalization.js
 * Version     : 1.5.59
 * Purpose     : Shared normalization from raw QBO entity observations into the
 *               governed QBO_CANONICAL_STATE_V2_FLATTENED_CONTRACT state.
 *
 * All source adapters must end here before immutable Change Payload creation.
 * ============================================================================
 */

/** Normalizes a complete QBO entity object using the same governed parent and
 * child row builders used by FULL_EXPORT. */
function qboNormalizeRawEntityObservation_(exportKey, entityType, entity) {
  exportKey = String(exportKey || '').trim();
  entityType = String(entityType || '').trim();
  if (!entity || typeof entity !== 'object') throw new Error('NORMALIZATION_MISSING_RAW_ENTITY');
  const entityId = qboObservationResolveEntityId_(exportKey, entity);
  if (!entityId) throw new Error('NORMALIZATION_MISSING_ENTITY_ID export=' + exportKey);

  if (exportKey === 'CUSTOMERS') {
    return qboNormalizeCustomerRawEntityObservation_(entityType, entity);
  }

  const definition = qboObservationNormalizerDefinition_(exportKey);
  if (!definition) throw new Error('NORMALIZATION_UNSUPPORTED_EXPORT_KEY ' + exportKey);

  const parentBuilt = definition.parentBuilder([entity]);
  if (!parentBuilt || parentBuilt.length !== 1) {
    throw new Error('NORMALIZATION_PARENT_ROW_COUNT export=' + exportKey + ' count=' + (parentBuilt ? parentBuilt.length : 0));
  }
  const parentIndex = qboObservationHeaderIndex_(definition.parentHeaders);
  const parentState = qboCanonicalV2RowObject_(definition.parentHeaders, parentBuilt[0], definition.entityIdHeader, parentIndex);
  const canonicalState = {parent: parentState};

  if (definition.childBuilder) {
    const childRows = definition.childBuilder([entity]) || [];
    const childIndex = qboObservationHeaderIndex_(definition.childHeaders);
    const childContract = QBO_CANONICAL_V2_CHILD_CONTRACT_[exportKey];
    const children = Object.create(null);
    childRows.forEach(function(row, i) {
      const parentId = String(row[childIndex[childContract.parentIdHeader]] || '').trim();
      if (parentId && parentId !== entityId) {
        throw new Error('NORMALIZATION_CHILD_PARENT_MISMATCH export=' + exportKey + ' entityId=' + entityId + ' childParentId=' + parentId);
      }
      const rowState = qboCanonicalV2RowObject_(definition.childHeaders, row, childContract.parentIdHeader, childIndex);
      const baseIdentity = qboCanonicalV2ChildIdentity_(row, childIndex, childContract.identityHeaders, i + 1);
      let identity = baseIdentity;
      let suffix = 1;
      while (Object.prototype.hasOwnProperty.call(children, identity)) {
        suffix += 1;
        identity = baseIdentity + '#' + suffix;
      }
      children[identity] = rowState;
    });
    canonicalState.children = {};
    canonicalState.children[childContract.sheetName] = children;
  }

  return {
    exportKey: exportKey,
    entityType: entityType,
    entityId: entityId,
    canonicalState: canonicalState,
    canonicalHash: qboCanonicalStateHash_(exportKey, entityType, canonicalState),
    rawPayload: jsonStringifySafe_(entity),
    rawPayloadHash: qboCanonicalRawPayloadHash_(jsonStringifySafe_(entity)),
    rawPayloadComplete: true,
    qboCreateTime: entity.MetaData && entity.MetaData.CreateTime ? entity.MetaData.CreateTime : '',
    qboLastUpdatedTime: entity.MetaData && entity.MetaData.LastUpdatedTime ? entity.MetaData.LastUpdatedTime : '',
    qboSyncToken: entity.SyncToken === undefined ? '' : entity.SyncToken
  };
}

/** Builds the immutable observation after normalization. */
function qboNormalizeAndBuildChangePayload_(input) {
  input = input || {};
  const operation = String(input.operation || 'UPSERT').toUpperCase();
  if (operation === QBO_CHANGE_PAYLOAD_CONTRACT_.DELETE_OPERATION) {
    return qboBuildChangePayload_({
      sourceType: input.sourceType,
      sourceObservationId: input.sourceObservationId,
      entityType: input.entityType,
      entityId: input.entityId,
      observedAt: input.observedAt,
      sourceChangeTime: input.sourceChangeTime,
      operation: operation,
      cycleId: input.cycleId,
      entityRunId: input.entityRunId,
      workUnitId: input.workUnitId,
      continuationId: input.continuationId,
      exportRunId: input.exportRunId,
      sourceId: input.sourceId,
      sourceIndex: input.sourceIndex,
      sourceRowNumber: input.sourceRowNumber,
      sourceEvidence: input.sourceEvidence || {},
      rawEntityEvidence: input.rawEntityEvidence || {},
      sourceReportedChange: input.sourceReportedChange,
      historicalReconstruction: input.historicalReconstruction,
      reconstructionStatus: input.reconstructionStatus || 'DELETE_TOMBSTONE'
    });
  }

  const normalized = qboNormalizeRawEntityObservation_(input.exportKey, input.entityType, input.rawEntity);
  const suppliedRawEvidence = input.rawEntityEvidence || {};
  const rawEntityEvidence = {
    acquisitionType: String(suppliedRawEvidence.acquisitionType || ''),
    acquiredAt: String(suppliedRawEvidence.acquiredAt || input.observedAt || ''),
    rawJson: normalized.rawPayload,
    rawEntityHash: normalized.rawPayloadHash,
    complete: suppliedRawEvidence.complete === false ? false : normalized.rawPayloadComplete === true,
    completenessReason: String(suppliedRawEvidence.completenessReason || 'GOVERNED_NORMALIZATION_SUCCEEDED'),
    temporalMatchStatus: String(suppliedRawEvidence.temporalMatchStatus || ''),
    fetchedFromQbo: suppliedRawEvidence.fetchedFromQbo === true
  };

  return qboBuildChangePayload_({
    sourceType: input.sourceType,
    sourceObservationId: input.sourceObservationId,
    entityType: input.entityType,
    entityId: normalized.entityId,
    observedAt: input.observedAt,
    sourceChangeTime: input.sourceChangeTime || normalized.qboLastUpdatedTime,
    operation: operation,
    cycleId: input.cycleId,
    entityRunId: input.entityRunId,
    workUnitId: input.workUnitId,
    continuationId: input.continuationId,
    exportRunId: input.exportRunId,
    sourceId: input.sourceId,
    sourceIndex: input.sourceIndex,
    sourceRowNumber: input.sourceRowNumber,
    sourceEvidence: input.sourceEvidence || {},
    rawEntityEvidence: rawEntityEvidence,
    normalizedEntityState: normalized.canonicalState,
    normalizedStateHash: normalized.canonicalHash,
    sourceReportedChange: input.sourceReportedChange,
    historicalReconstruction: input.historicalReconstruction,
    reconstructionStatus: input.reconstructionStatus || 'COMPLETE'
  });
}


/** Resolves the governed identity represented by a raw source observation.
 * Most QBO entities expose Id at the root. RecurringTransaction query payloads
 * are wrappers such as {Invoice:{...RecurDataRef...}} or
 * {SalesReceipt:{...RecurDataRef...}}; their governed template identity is
 * RecurDataRef.value, not the embedded transaction Id. */
function qboObservationResolveEntityId_(exportKey, entity) {
  if (exportKey === 'RECURRING_TRANSACTIONS') {
    const transaction = getRecurringEmbeddedTransaction_(entity);
    return String(firstPresentValue_([
      nestedValue_(transaction, 'RecurDataRef.value'),
      entity.Id,
      transaction.Id
    ]) || '').trim();
  }
  return String(entity.Id || '').trim();
}

/** Runtime regression test for the QBO RecurringTransaction wrapper shape.
 * Proves wrapper identity and child-parent identity use RecurDataRef.value. */
function testQboRecurringTransactionObservationNormalization() {
  const sample = {
    Invoice: {
      Id: '9001',
      SyncToken: '7',
      RecurDataRef: {value: '438'},
      RecurringInfo: {Name: 'Regression Template', RecurType: 'Automated', Active: true, ScheduleInfo: {IntervalType: 'Monthly', NumInterval: 1}},
      CustomerRef: {value: '1217', name: 'Regression Customer'},
      CurrencyRef: {value: 'USD', name: 'United States Dollar'},
      TotalAmt: 100,
      Line: [{Id:'1',LineNum:1,Amount:100,DetailType:'SalesItemLineDetail',SalesItemLineDetail:{ItemRef:{value:'1',name:'Regression Item'}}}],
      MetaData: {CreateTime:'2026-01-01T00:00:00-06:00',LastUpdatedTime:'2026-01-02T00:00:00-06:00'}
    }
  };

  // Validate the governed export builders at the identity boundary before V2
  // canonicalization intentionally removes row identity columns.
  const parentRows = buildRecurringTransactionRows_([sample]);
  if (!parentRows || parentRows.length !== 1) throw new Error('RECURRING_NORMALIZATION_PARENT_ROW_COUNT');
  const parentIndex = qboObservationHeaderIndex_(RECURRING_TRANSACTION_HEADERS);
  const parentRecurringId = String(parentRows[0][parentIndex.RecurringTransactionId] || '').trim();
  if (parentRecurringId !== '438') throw new Error('RECURRING_NORMALIZATION_PARENT_ID_MISMATCH actual=' + parentRecurringId);

  const childRows = buildRecurringTransactionLineRows_([sample]) || [];
  const childIndex = qboObservationHeaderIndex_(RECURRING_TRANSACTION_LINE_HEADERS);
  childRows.forEach(function(row, i) {
    const childParentId = String(row[childIndex.RecurringTransactionId] || '').trim();
    if (childParentId !== '438') throw new Error('RECURRING_NORMALIZATION_CHILD_ID_MISMATCH row=' + (i + 1) + ' actual=' + childParentId);
  });

  const normalized = qboNormalizeRawEntityObservation_('RECURRING_TRANSACTIONS', 'RecurringTransaction', sample);
  if (normalized.entityId !== '438') throw new Error('RECURRING_NORMALIZATION_IDENTITY_MISMATCH actual=' + normalized.entityId);

  // QBO_CANONICAL_STATE_V2 intentionally excludes the identity header from the
  // canonical row object. Identity is carried separately as normalized.entityId.
  if (Object.prototype.hasOwnProperty.call(normalized.canonicalState.parent || {}, 'RecurringTransactionId')) {
    throw new Error('RECURRING_NORMALIZATION_CANONICAL_IDENTITY_NOT_EXCLUDED');
  }

  const childSheet = QBO_CANONICAL_V2_CHILD_CONTRACT_.RECURRING_TRANSACTIONS.sheetName;
  const children = normalized.canonicalState.children && normalized.canonicalState.children[childSheet] || {};
  Object.keys(children).forEach(function(key) {
    if (Object.prototype.hasOwnProperty.call(children[key] || {}, 'RecurringTransactionId')) {
      throw new Error('RECURRING_NORMALIZATION_CANONICAL_CHILD_IDENTITY_NOT_EXCLUDED key=' + key);
    }
  });

  const result = {
    valid: true,
    normalizationVersion: QBO_CHANGE_PAYLOAD_CONTRACT_.NORMALIZATION_VERSION,
    entityId: normalized.entityId,
    parentBuilderRecurringTransactionId: parentRecurringId,
    childCount: childRows.length,
    childBuilderParentIdsValid: true,
    canonicalIdentityExcluded: true
  };
  console.log('[OBSERVATION NORMALIZATION] | RECURRING WRAPPER OK | ' + JSON.stringify(result));
  return result;
}

function qboObservationHeaderIndex_(headers) {
  const index = Object.create(null);
  (headers || []).forEach(function(header, i) { index[String(header)] = i; });
  return index;
}

function qboObservationNormalizerDefinition_(exportKey) {
  const definitions = {
    PAYMENT_METHODS: {entityIdHeader:'Id', parentHeaders:PAYMENT_METHOD_HEADERS, parentBuilder:buildPaymentMethodRows_},
    ITEMS: {entityIdHeader:'Id', parentHeaders:ITEM_HEADERS, parentBuilder:buildItemRows_, childHeaders:ITEM_GROUP_HEADERS, childBuilder:buildItemGroupRows_},
    CLASSES: {entityIdHeader:'Id', parentHeaders:CLASS_HEADERS, parentBuilder:buildClassRows_},
    TERMS: {entityIdHeader:'Id', parentHeaders:TERM_HEADERS, parentBuilder:buildTermRows_},
    TAX_CODES: {entityIdHeader:'Id', parentHeaders:TAX_CODE_HEADERS, parentBuilder:buildTaxCodeRows_, childHeaders:TAX_CODE_RATE_HEADERS, childBuilder:buildTaxCodeRateRows_},
    DEPARTMENTS: {entityIdHeader:'Id', parentHeaders:DEPARTMENT_HEADERS, parentBuilder:buildDepartmentRows_},
    VENDORS: {entityIdHeader:'Id', parentHeaders:VENDOR_HEADERS, parentBuilder:buildVendorRows_},
    ACCOUNTS: {entityIdHeader:'Id', parentHeaders:ACCOUNT_HEADERS, parentBuilder:buildAccountRows_},
    INVOICES: {entityIdHeader:'Id', parentHeaders:INVOICE_HEADERS, parentBuilder:buildInvoiceRows_, childHeaders:INVOICE_LINE_HEADERS, childBuilder:buildInvoiceLineRows_},
    PAYMENTS: {entityIdHeader:'Id', parentHeaders:PAYMENT_HEADERS, parentBuilder:buildPaymentRows_, childHeaders:PAYMENT_APPLICATION_HEADERS, childBuilder:buildPaymentApplicationRows_},
    CREDIT_MEMOS: {entityIdHeader:'Id', parentHeaders:CREDIT_MEMO_HEADERS, parentBuilder:buildCreditMemoRows_, childHeaders:CREDIT_MEMO_LINE_HEADERS, childBuilder:buildCreditMemoLineRows_},
    ESTIMATES: {entityIdHeader:'Id', parentHeaders:ESTIMATE_HEADERS, parentBuilder:buildEstimateRows_, childHeaders:ESTIMATE_LINE_HEADERS, childBuilder:buildEstimateLineRows_},
    BILLS: {entityIdHeader:'Id', parentHeaders:BILL_HEADERS, parentBuilder:buildBillRows_, childHeaders:BILL_LINE_HEADERS, childBuilder:buildBillLineRows_},
    BILL_PAYMENTS: {entityIdHeader:'Id', parentHeaders:BILL_PAYMENT_HEADERS, parentBuilder:buildBillPaymentRows_, childHeaders:BILL_PAYMENT_APPLICATION_HEADERS, childBuilder:buildBillPaymentApplicationRows_},
    PURCHASES: {entityIdHeader:'Id', parentHeaders:PURCHASE_HEADERS, parentBuilder:buildPurchaseRows_, childHeaders:PURCHASE_LINE_HEADERS, childBuilder:buildPurchaseLineRows_},
    DEPOSITS: {entityIdHeader:'Id', parentHeaders:DEPOSIT_HEADERS, parentBuilder:buildDepositRows_, childHeaders:DEPOSIT_LINE_HEADERS, childBuilder:buildDepositLineRows_},
    JOURNAL_ENTRIES: {entityIdHeader:'Id', parentHeaders:JOURNAL_ENTRY_HEADERS, parentBuilder:buildJournalEntryRows_, childHeaders:JOURNAL_ENTRY_LINE_HEADERS, childBuilder:buildJournalEntryLineRows_},
    SALES_RECEIPTS: {entityIdHeader:'Id', parentHeaders:SALES_RECEIPT_HEADERS, parentBuilder:buildSalesReceiptRows_, childHeaders:SALES_RECEIPT_LINE_HEADERS, childBuilder:buildSalesReceiptLineRows_},
    RECURRING_TRANSACTIONS: {entityIdHeader:'RecurringTransactionId', parentHeaders:RECURRING_TRANSACTION_HEADERS, parentBuilder:buildRecurringTransactionRows_, childHeaders:RECURRING_TRANSACTION_LINE_HEADERS, childBuilder:buildRecurringTransactionLineRows_},
    REFUND_RECEIPTS: {entityIdHeader:'Id', parentHeaders:REFUND_RECEIPT_HEADERS, parentBuilder:buildRefundReceiptRows_, childHeaders:REFUND_RECEIPT_LINE_HEADERS, childBuilder:buildRefundReceiptLineRows_}
  };
  if (exportKey === 'CUSTOMERS') return qboCustomerObservationNormalizerDefinition_();
  return definitions[exportKey] || null;
}

/** Customer export headers are dynamic because custom fields are discovered at
 * runtime. This pure builder mirrors the production Customer export semantics
 * for the single observed entity. Empty custom fields are omitted by V2. */
function qboCustomerObservationNormalizerDefinition_() {
  return {entityIdHeader:'Id', dynamic:true};
}

function qboNormalizeCustomerRawEntityObservation_(entityType, customer) {
  const entityId = String(customer.Id || '').trim();
  if (!entityId) throw new Error('NORMALIZATION_MISSING_ENTITY_ID export=CUSTOMERS');

  const customFieldColumns = discoverCustomerCustomFields_([customer]);
  const standardHeaders = [
    'Id','SyncToken','Active','DisplayName','FullyQualifiedName','CompanyName','Title','GivenName','MiddleName','FamilyName','Suffix','PrintOnCheckName',
    'PrimaryEmail','PrimaryPhone','AlternatePhone','Mobile','Fax','WebAddress',
    'BillAddressId','BillAddressLine1','BillAddressLine2','BillAddressLine3','BillAddressLine4','BillAddressLine5','BillAddressCity','BillAddressState','BillAddressPostalCode','BillAddressCountry','BillAddressCountryCode','BillAddressLat','BillAddressLong','BillAddressNote',
    'ShipAddressId','ShipAddressLine1','ShipAddressLine2','ShipAddressLine3','ShipAddressLine4','ShipAddressLine5','ShipAddressCity','ShipAddressState','ShipAddressPostalCode','ShipAddressCountry','ShipAddressCountryCode','ShipAddressLat','ShipAddressLong','ShipAddressNote',
    'Job','BillWithParent','ParentId','ParentName','Level','IsProject','CustomerTypeId','CustomerTypeName','Balance','BalanceWithJobs','OpenBalanceDate',
    'Taxable','TaxCodeId','TaxCodeName','DefaultTaxCodeId','DefaultTaxCodeName','TaxExemptionReasonId','TaxExemptionReasonName','PrimaryTaxIdentifier','SecondaryTaxIdentifier','ResaleNum',
    'CurrencyId','CurrencyName','ExchangeRate','TermsId','TermsName','PaymentMethodId','PaymentMethodName','SalesTermId','SalesTermName',
    'PreferredDeliveryMethod','PreferredEmailDelivery','PreferredPrintDelivery','Notes','Source','CreateTime','LastUpdatedTime'
  ];
  const headers = standardHeaders.concat(customFieldColumns.map(function(field) { return field.header; }), ['CustomFieldsJSON','RawJSON']);
  const meta = extractMeta_(customer);
  const row = [
    valueOrBlank_(customer.Id),valueOrBlank_(customer.SyncToken),booleanOrBlank_(customer.Active),valueOrBlank_(customer.DisplayName),valueOrBlank_(customer.FullyQualifiedName),valueOrBlank_(customer.CompanyName),valueOrBlank_(customer.Title),valueOrBlank_(customer.GivenName),valueOrBlank_(customer.MiddleName),valueOrBlank_(customer.FamilyName),valueOrBlank_(customer.Suffix),valueOrBlank_(customer.PrintOnCheckName),
    nestedValue_(customer,'PrimaryEmailAddr.Address'),nestedValue_(customer,'PrimaryPhone.FreeFormNumber'),nestedValue_(customer,'AlternatePhone.FreeFormNumber'),nestedValue_(customer,'Mobile.FreeFormNumber'),nestedValue_(customer,'Fax.FreeFormNumber'),nestedValue_(customer,'WebAddr.URI'),
    nestedValue_(customer,'BillAddr.Id'),nestedValue_(customer,'BillAddr.Line1'),nestedValue_(customer,'BillAddr.Line2'),nestedValue_(customer,'BillAddr.Line3'),nestedValue_(customer,'BillAddr.Line4'),nestedValue_(customer,'BillAddr.Line5'),nestedValue_(customer,'BillAddr.City'),nestedValue_(customer,'BillAddr.CountrySubDivisionCode'),nestedValue_(customer,'BillAddr.PostalCode'),nestedValue_(customer,'BillAddr.Country'),nestedValue_(customer,'BillAddr.CountryCode'),nestedValue_(customer,'BillAddr.Lat'),nestedValue_(customer,'BillAddr.Long'),nestedValue_(customer,'BillAddr.Note'),
    nestedValue_(customer,'ShipAddr.Id'),nestedValue_(customer,'ShipAddr.Line1'),nestedValue_(customer,'ShipAddr.Line2'),nestedValue_(customer,'ShipAddr.Line3'),nestedValue_(customer,'ShipAddr.Line4'),nestedValue_(customer,'ShipAddr.Line5'),nestedValue_(customer,'ShipAddr.City'),nestedValue_(customer,'ShipAddr.CountrySubDivisionCode'),nestedValue_(customer,'ShipAddr.PostalCode'),nestedValue_(customer,'ShipAddr.Country'),nestedValue_(customer,'ShipAddr.CountryCode'),nestedValue_(customer,'ShipAddr.Lat'),nestedValue_(customer,'ShipAddr.Long'),nestedValue_(customer,'ShipAddr.Note'),
    booleanOrBlank_(customer.Job),booleanOrBlank_(customer.BillWithParent),nestedValue_(customer,'ParentRef.value'),nestedValue_(customer,'ParentRef.name'),numberOrBlank_(customer.Level),booleanOrBlank_(customer.IsProject),nestedValue_(customer,'CustomerTypeRef.value'),nestedValue_(customer,'CustomerTypeRef.name'),numberOrBlank_(customer.Balance),numberOrBlank_(customer.BalanceWithJobs),valueOrBlank_(customer.OpenBalanceDate),
    booleanOrBlank_(customer.Taxable),nestedValue_(customer,'TaxCodeRef.value'),nestedValue_(customer,'TaxCodeRef.name'),nestedValue_(customer,'DefaultTaxCodeRef.value'),nestedValue_(customer,'DefaultTaxCodeRef.name'),valueOrBlank_(customer.TaxExemptionReasonId),nestedValue_(customer,'TaxExemptionReasonRef.name'),valueOrBlank_(customer.PrimaryTaxIdentifier),valueOrBlank_(customer.SecondaryTaxIdentifier),valueOrBlank_(customer.ResaleNum),
    nestedValue_(customer,'CurrencyRef.value'),nestedValue_(customer,'CurrencyRef.name'),numberOrBlank_(customer.ExchangeRate),nestedValue_(customer,'TermsRef.value'),nestedValue_(customer,'TermsRef.name'),nestedValue_(customer,'PaymentMethodRef.value'),nestedValue_(customer,'PaymentMethodRef.name'),nestedValue_(customer,'SalesTermRef.value'),nestedValue_(customer,'SalesTermRef.name'),valueOrBlank_(customer.PreferredDeliveryMethod),preferredDeliveryFlag_(customer.PreferredDeliveryMethod,'Email'),preferredDeliveryFlag_(customer.PreferredDeliveryMethod,'Print'),valueOrBlank_(customer.Notes),valueOrBlank_(customer.Source),valueOrBlank_(meta.createTime),valueOrBlank_(meta.lastUpdatedTime)
  ].concat(getCustomerCustomFieldValues_(customer, customFieldColumns), [jsonStringifySafe_(customer.CustomField || []), jsonStringifySafe_(customer)]);

  const index = qboObservationHeaderIndex_(headers);
  const canonicalState = {parent:qboCanonicalV2RowObject_(headers, row, 'Id', index)};
  const rawPayload = jsonStringifySafe_(customer);
  return {
    exportKey:'CUSTOMERS', entityType:entityType, entityId:entityId,
    canonicalState:canonicalState,
    canonicalHash:qboCanonicalStateHash_('CUSTOMERS', entityType, canonicalState),
    rawPayload:rawPayload,
    rawPayloadHash:qboCanonicalRawPayloadHash_(rawPayload),
    rawPayloadComplete:true,
    qboCreateTime:customer.MetaData && customer.MetaData.CreateTime ? customer.MetaData.CreateTime : '',
    qboLastUpdatedTime:customer.MetaData && customer.MetaData.LastUpdatedTime ? customer.MetaData.LastUpdatedTime : '',
    qboSyncToken:customer.SyncToken === undefined ? '' : customer.SyncToken
  };
}

function testQboObservationNormalizationReadiness() {
  const unsupported = [];
  QBO_STATE_CAPTURE.CANONICAL_MIGRATION_SCOPE.forEach(function(exportKey) {
    if (!qboObservationNormalizerDefinition_(exportKey)) unsupported.push(exportKey);
  });
  if (unsupported.length) throw new Error('OBSERVATION_NORMALIZATION_UNSUPPORTED ' + unsupported.join(','));
  const result = {
    ready: true,
    normalizationVersion: QBO_CHANGE_PAYLOAD_CONTRACT_.NORMALIZATION_VERSION,
    canonicalizationVersion: QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
    supportedExportCount: QBO_STATE_CAPTURE.CANONICAL_MIGRATION_SCOPE.length,
    childContractCount: Object.keys(QBO_CANONICAL_V2_CHILD_CONTRACT_).length,
    contractVersion: typeof QBO_EXPORT_CONTRACT_REMEDIATION_VERSION === 'undefined' ? '' : QBO_EXPORT_CONTRACT_REMEDIATION_VERSION
  };
  console.log('[OBSERVATION NORMALIZATION] | READY | ' + JSON.stringify(result));
  return result;
}
