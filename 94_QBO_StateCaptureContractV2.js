/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 94_QBO_StateCaptureContractV2.js
 * Purpose     : QBO_CANONICAL_STATE_V2 flattened-contract canonical-state
 *               builder used by controlled historical rebuild/replay.
 *
 * Architecture:
 *   - Canonical business state is built from the governed flattened parent
 *     export plus governed child datasets owned by the export manifest.
 *   - Parent/child RawJSON columns are evidence only and never canonical input.
 *   - V1 RawJSON canonical history is preserved; V2 is a new versioned state
 *     stream and does not rewrite V1 rows.
 *   - Empty flattened cells are omitted so newly added blank columns do not
 *     manufacture business-state changes in older observations.
 *   - QBO version/audit metadata, entity identity, reference display names,
 *     and address technical object IDs do not independently create state.
 * ============================================================================
 */

const QBO_CANONICAL_V2_SOURCE_ = 'GOVERNED_FLATTENED_EXPORT_PLUS_CHILDREN';

const QBO_CANONICAL_V2_CHILD_CONTRACT_ = Object.freeze({
  ITEMS: Object.freeze({sheetName:'QBO_ItemGroupLines', parentIdHeader:'GroupItemId', identityHeaders:Object.freeze(['LineNumber','ComponentItemId'])}),
  TAX_CODES: Object.freeze({sheetName:'QBO_TaxCodeRates', parentIdHeader:'TaxCodeId', identityHeaders:Object.freeze(['RateListType','LineNumber','TaxRateId'])}),
  INVOICES: Object.freeze({sheetName:'QBO_InvoiceLines', parentIdHeader:'InvoiceId', identityHeaders:Object.freeze(['LineId','LineNumber','LineLevel','ParentLineId'])}),
  PAYMENTS: Object.freeze({sheetName:'QBO_PaymentApplications', parentIdHeader:'PaymentId', identityHeaders:Object.freeze(['PaymentLineId','PaymentLineNumber','LinkedTxnNumber','LinkedTxnId','LinkedTxnType','LinkedTxnLineId'])}),
  CREDIT_MEMOS: Object.freeze({sheetName:'QBO_CreditMemoLines', parentIdHeader:'CreditMemoId', identityHeaders:Object.freeze(['LineId','LineNumber','LineLevel','ParentLineId'])}),
  ESTIMATES: Object.freeze({sheetName:'QBO_EstimateLines', parentIdHeader:'EstimateId', identityHeaders:Object.freeze(['LineId','LineNumber','LineLevel','ParentLineId'])}),
  BILLS: Object.freeze({sheetName:'QBO_BillLines', parentIdHeader:'BillId', identityHeaders:Object.freeze(['LineId','LineNumber'])}),
  BILL_PAYMENTS: Object.freeze({sheetName:'QBO_BillPaymentApplications', parentIdHeader:'BillPaymentId', identityHeaders:Object.freeze(['PaymentLineId','PaymentLineNumber','LinkedTxnNumber','LinkedTxnId','LinkedTxnType','LinkedTxnLineId'])}),
  PURCHASES: Object.freeze({sheetName:'QBO_PurchaseLines', parentIdHeader:'PurchaseId', identityHeaders:Object.freeze(['LineId','LineNumber'])}),
  DEPOSITS: Object.freeze({sheetName:'QBO_DepositLines', parentIdHeader:'DepositId', identityHeaders:Object.freeze(['LineId','LineNumber'])}),
  JOURNAL_ENTRIES: Object.freeze({sheetName:'QBO_JournalEntryLines', parentIdHeader:'JournalEntryId', identityHeaders:Object.freeze(['LineId','LineNumber'])}),
  SALES_RECEIPTS: Object.freeze({sheetName:'QBO_SalesReceiptLines', parentIdHeader:'SalesReceiptId', identityHeaders:Object.freeze(['LineId','LineNumber','LineLevel','ParentLineId'])}),
  RECURRING_TRANSACTIONS: Object.freeze({sheetName:'QBO_RecurringTransactionLines', parentIdHeader:'RecurringTransactionId', identityHeaders:Object.freeze(['LineId','LineNumber','LineLevel','ParentLineId'])}),
  REFUND_RECEIPTS: Object.freeze({sheetName:'QBO_RefundReceiptLines', parentIdHeader:'RefundReceiptId', identityHeaders:Object.freeze(['LineId','LineNumber','LineLevel','ParentLineId'])})
});

function qboCanonicalV2BuildSourceState_(source, manifestEntry) {
  validateQboStateCaptureWriteSource_(source, manifestEntry);
  const sourceSpreadsheet = SpreadsheetApp.openById(source.masterBackupFileId);
  const parentSheetName = manifestEntry.sheetNames[0];
  const parentSheet = sourceSpreadsheet.getSheetByName(parentSheetName);
  if (!parentSheet) throw new Error('MISSING_CANONICAL_V2_PARENT_SHEET ' + parentSheetName);

  const parentData = qboCanonicalV2ReadSheet_(parentSheet);
  const entityIdHeader = QBO_STATE_CAPTURE_ENTITY_ID_HEADERS_[source.exportKey] || 'Id';
  if (parentData.index[entityIdHeader] === undefined) {
    throw new Error('CANONICAL_V2_SOURCE_SCHEMA_MISSING ' + entityIdHeader + ' sheet=' + parentSheetName);
  }

  const childContract = QBO_CANONICAL_V2_CHILD_CONTRACT_[source.exportKey] || null;
  const childByParent = childContract
    ? qboCanonicalV2LoadChildren_(sourceSpreadsheet, source.exportKey, childContract)
    : Object.create(null);

  const stateByEntity = Object.create(null);
  for (let i = 1; i < parentData.values.length; i += 1) {
    const row = parentData.values[i];
    const entityId = String(row[parentData.index[entityIdHeader]] || '').trim();
    if (!entityId) throw new Error('CANONICAL_V2_MISSING_ENTITY_ID sourceRow=' + (i + 1));
    if (stateByEntity[entityId]) throw new Error('CANONICAL_V2_DUPLICATE_ENTITY_ID entityId=' + entityId);

    const parentState = qboCanonicalV2RowObject_(
      parentData.headers,
      row,
      entityIdHeader,
      parentData.index
    );
    const canonicalState = {parent: parentState};
    if (childContract) {
      canonicalState.children = {};
      canonicalState.children[childContract.sheetName] = childByParent[entityId] || {};
    }

    const rawPayload = parentData.index.RawJSON === undefined ? '' : String(row[parentData.index.RawJSON] || '');
    const rawComplete = rawPayload.indexOf(QBO_STATE_CAPTURE_RAW_TRUNCATION_MARKER_) === -1;
    const canonicalHash = qboCanonicalStateHash_(source.exportKey, manifestEntry.entityName, canonicalState);

    stateByEntity[entityId] = {
      canonicalState: canonicalState,
      canonicalHash: canonicalHash,
      rawPayloadHash: qboCanonicalRawPayloadHash_(rawPayload),
      rawPayloadComplete: rawComplete,
      sourceRowNumber: i + 1,
      qboCreateTime: parentData.index.CreateTime === undefined ? '' : row[parentData.index.CreateTime],
      qboLastUpdatedTime: parentData.index.LastUpdatedTime === undefined ? '' : row[parentData.index.LastUpdatedTime],
      qboSyncToken: parentData.index.SyncToken === undefined ? '' : row[parentData.index.SyncToken]
    };
  }
  return stateByEntity;
}

function qboCanonicalV2LoadChildren_(sourceSpreadsheet, exportKey, contract) {
  const sheet = sourceSpreadsheet.getSheetByName(contract.sheetName);
  if (!sheet) throw new Error('MISSING_CANONICAL_V2_CHILD_SHEET ' + contract.sheetName + ' export=' + exportKey);
  const data = qboCanonicalV2ReadSheet_(sheet);
  if (data.index[contract.parentIdHeader] === undefined) {
    throw new Error('CANONICAL_V2_CHILD_SCHEMA_MISSING ' + contract.parentIdHeader + ' sheet=' + contract.sheetName);
  }

  const grouped = Object.create(null);
  for (let i = 1; i < data.values.length; i += 1) {
    const row = data.values[i];
    const parentId = String(row[data.index[contract.parentIdHeader]] || '').trim();
    if (!parentId) continue;
    const rowState = qboCanonicalV2RowObject_(data.headers, row, contract.parentIdHeader, data.index);
    const baseIdentity = qboCanonicalV2ChildIdentity_(row, data.index, contract.identityHeaders, i);
    if (!grouped[parentId]) grouped[parentId] = Object.create(null);
    let identity = baseIdentity;
    let suffix = 1;
    while (Object.prototype.hasOwnProperty.call(grouped[parentId], identity)) {
      suffix += 1;
      identity = baseIdentity + '#' + suffix;
    }
    grouped[parentId][identity] = rowState;
  }
  return grouped;
}

function qboCanonicalV2RowObject_(headers, row, identityHeader, index) {
  const result = {};
  const headerSet = Object.create(null);
  headers.forEach(function(header) { headerSet[header] = true; });

  headers.forEach(function(header, columnIndex) {
    if (qboCanonicalV2ExcludeColumn_(header, identityHeader, headerSet)) return;
    const normalized = qboCanonicalV2NormalizeCell_(header, row[columnIndex]);
    if (normalized === QBO_CANONICAL_MISSING_) return;
    result[header] = normalized;
  });
  return result;
}

function qboCanonicalV2ExcludeColumn_(header, identityHeader, headerSet) {
  const name = String(header || '').trim();
  if (!name) return true;
  if (name === identityHeader) return true;
  if (name === 'Id' || name === 'SyncToken' || name === 'CreateTime' || name === 'LastUpdatedTime') return true;
  if (name === 'RawJSON' || name === 'PaymentLineRawJSON' || name === 'LinkedTxnRawJSON') return true;
  if (/AddrId$/.test(name)) return true;

  // Reference display names are descriptive evidence when the stable reference
  // identity is already present in the same governed row.
  if (/Name$/.test(name)) {
    const idName = name.slice(0, -4) + 'Id';
    if (headerSet[idName]) return true;
  }
  return false;
}

function qboCanonicalV2NormalizeCell_(header, value) {
  if (value === '' || value === undefined || value === null) return QBO_CANONICAL_MISSING_;
  if (value instanceof Date) {
    if (/Date$/.test(header) && !/Time$/.test(header)) {
      return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    return value.toISOString();
  }
  if (/JSON$/.test(header) && typeof value === 'string') {
    const text = String(value || '').trim();
    if (!text) return QBO_CANONICAL_MISSING_;
    try {
      return qboCanonicalV2NormalizeJsonValue_(JSON.parse(text));
    } catch (ignore) {
      // A governed non-RawJSON evidence column that is not valid JSON remains a
      // literal governed value rather than silently disappearing.
      return text;
    }
  }
  return value;
}

function qboCanonicalV2NormalizeJsonValue_(value) {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(qboCanonicalV2NormalizeJsonValue_);
  if (typeof value !== 'object') return value;

  const result = {};
  const isReference = Object.prototype.hasOwnProperty.call(value, 'value');
  Object.keys(value).sort().forEach(function(key) {
    if (
      key === 'domain' || key === 'sparse' || key === 'SyncToken' || key === 'MetaData' ||
      key === 'V4IDPseudonym' || key === 'declaredType' || key === 'scope' || key === 'globalScope'
    ) return;
    if (isReference && key === 'name') return;
    result[key] = qboCanonicalV2NormalizeJsonValue_(value[key]);
  });
  return result;
}

function qboCanonicalV2ChildIdentity_(row, index, identityHeaders, fallbackIndex) {
  const parts = [];
  (identityHeaders || []).forEach(function(header) {
    if (index[header] === undefined) return;
    const value = row[index[header]];
    if (value === '' || value === undefined || value === null) return;
    parts.push(header + '=' + qboCanonicalStableStringify_(qboCanonicalV2NormalizeCell_(header, value)));
  });
  return parts.length ? parts.join('|') : 'ROW=' + String(fallbackIndex);
}

function qboCanonicalV2ReadSheet_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) return {headers:[], index:Object.create(null), values:[]};
  const values = lastRow > 0 ? sheet.getRange(1, 1, lastRow, lastColumn).getValues() : [];
  const headers = values.length ? values[0].map(function(value) { return String(value || '').trim(); }) : [];
  const index = buildQboStateCaptureWriteHeaderIndex_(headers);
  return {headers:headers, index:index, values:values};
}

function testQboCanonicalV2ContractReadiness() {
  const manifest = getQboExportManifest();
  const configured = Object.keys(QBO_CANONICAL_V2_CHILD_CONTRACT_);
  const errors = [];
  QBO_STATE_CAPTURE.CANONICAL_MIGRATION_SCOPE.forEach(function(exportKey) {
    const entry = manifest.filter(function(item) { return item.key === exportKey; })[0];
    if (!entry) errors.push('Missing manifest entry: ' + exportKey);
    if (entry && entry.sheetNames.length > 1 && !QBO_CANONICAL_V2_CHILD_CONTRACT_[exportKey]) {
      errors.push('Missing V2 child contract: ' + exportKey);
    }
  });
  if (errors.length) throw new Error('CANONICAL_V2_CONTRACT_READINESS_FAILED\n' + errors.join('\n'));
  const result = {
    canonicalizationVersion: QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
    canonicalStateSource: QBO_CANONICAL_V2_SOURCE_,
    controlledScope: QBO_STATE_CAPTURE.CANONICAL_MIGRATION_SCOPE.slice(),
    childContracts: configured,
    exportContractVersion: typeof QBO_EXPORT_CONTRACT_REMEDIATION_VERSION === 'undefined' ? '' : QBO_EXPORT_CONTRACT_REMEDIATION_VERSION,
    ready: true
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}
