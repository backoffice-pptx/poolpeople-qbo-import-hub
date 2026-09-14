/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 98_QBO_SourceObservationAdapters.js
 * Version     : 1.5.69
 * Purpose     : Source-specific adapters from immutable source evidence into
 *               complete Raw Entity Evidence suitable for shared normalization.
 *
 * Locked architecture:
 *   Source Evidence != Raw Entity Evidence != Normalized Entity State.
 *   A successful normalized observation must have complete Raw Entity Evidence.
 *   Webhook create/update events require targeted QBO fetches. Native CDC
 *   entity objects may be used directly when complete; otherwise they are
 *   refreshed through a targeted QBO fetch. Delete events become tombstones.
 * ============================================================================
 */

const QBO_SOURCE_OBSERVATION_ADAPTERS_ = Object.freeze({
  VERSION: 'QBO_SOURCE_OBSERVATION_ADAPTERS_V1',
  ENTITY_MAP: Object.freeze({
    Invoice: Object.freeze({exportKey:'INVOICES', endpoint:'invoice', responseKey:'Invoice'}),
    Payment: Object.freeze({exportKey:'PAYMENTS', endpoint:'payment', responseKey:'Payment'}),
    TaxCode: Object.freeze({exportKey:'TAX_CODES', endpoint:'taxcode', responseKey:'TaxCode'}),
    CreditMemo: Object.freeze({exportKey:'CREDIT_MEMOS', endpoint:'creditmemo', responseKey:'CreditMemo'}),
    Bill: Object.freeze({exportKey:'BILLS', endpoint:'bill', responseKey:'Bill'}),
    BillPayment: Object.freeze({exportKey:'BILL_PAYMENTS', endpoint:'billpayment', responseKey:'BillPayment'}),
    Purchase: Object.freeze({exportKey:'PURCHASES', endpoint:'purchase', responseKey:'Purchase'}),
    Deposit: Object.freeze({exportKey:'DEPOSITS', endpoint:'deposit', responseKey:'Deposit'}),
    JournalEntry: Object.freeze({exportKey:'JOURNAL_ENTRIES', endpoint:'journalentry', responseKey:'JournalEntry'}),
    SalesReceipt: Object.freeze({exportKey:'SALES_RECEIPTS', endpoint:'salesreceipt', responseKey:'SalesReceipt'}),
    RefundReceipt: Object.freeze({exportKey:'REFUND_RECEIPTS', endpoint:'refundreceipt', responseKey:'RefundReceipt'}),
    Customer: Object.freeze({exportKey:'CUSTOMERS', endpoint:'customer', responseKey:'Customer'}),
    Vendor: Object.freeze({exportKey:'VENDORS', endpoint:'vendor', responseKey:'Vendor'}),
    Item: Object.freeze({exportKey:'ITEMS', endpoint:'item', responseKey:'Item'}),
    Account: Object.freeze({exportKey:'ACCOUNTS', endpoint:'account', responseKey:'Account'}),
    Class: Object.freeze({exportKey:'CLASSES', endpoint:'class', responseKey:'Class'}),
    Department: Object.freeze({exportKey:'DEPARTMENTS', endpoint:'department', responseKey:'Department'}),
    Term: Object.freeze({exportKey:'TERMS', endpoint:'term', responseKey:'Term'}),
    PaymentMethod: Object.freeze({exportKey:'PAYMENT_METHODS', endpoint:'paymentmethod', responseKey:'PaymentMethod'}),
    Estimate: Object.freeze({exportKey:'ESTIMATES', endpoint:'estimate', responseKey:'Estimate'})
  })
});


function qboSourceAdapterExtractNativeCdcEntities_(cdcEvidence, entityType) {
  const output = [];
  const cdcResponses = Array.isArray(cdcEvidence && cdcEvidence.CDCResponse)
    ? cdcEvidence.CDCResponse
    : (cdcEvidence && cdcEvidence.CDCResponse ? [cdcEvidence.CDCResponse] : []);
  cdcResponses.forEach(function(cdcResponse) {
    const queryResponses = Array.isArray(cdcResponse && cdcResponse.QueryResponse)
      ? cdcResponse.QueryResponse
      : (cdcResponse && cdcResponse.QueryResponse ? [cdcResponse.QueryResponse] : []);
    queryResponses.forEach(function(queryResponse) {
      const raw = queryResponse && queryResponse[entityType];
      const entities = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      entities.forEach(function(entity) {
        if (entity && typeof entity === 'object') output.push(entity);
      });
    });
  });
  return output;
}

function qboSourceAdapterExtractWebhookEvents_(receipt) {
  const output = [];
  const notifications = receipt && receipt.parsedPayload && Array.isArray(receipt.parsedPayload.eventNotifications)
    ? receipt.parsedPayload.eventNotifications : [];
  notifications.forEach(function(notification) {
    const entities = notification && notification.dataChangeEvent && Array.isArray(notification.dataChangeEvent.entities)
      ? notification.dataChangeEvent.entities : [];
    entities.forEach(function(entity) {
      if (!entity || typeof entity !== 'object') return;
      output.push({
        realmId: String(notification.realmId || ''),
        entityType: String(entity.name || ''),
        entityId: String(entity.id || ''),
        operation: String(entity.operation || ''),
        sourceChangeTime: String(entity.lastUpdated || ''),
        receiptId: String(receipt.webhookReceiptId || ''),
        receivedAt: String(receipt.receivedAt || ''),
        signatureVerified: receipt.signatureVerified === true,
        rawPayloadSha256: String(receipt.rawPayloadSha256 || '')
      });
    });
  });
  return output;
}

function qboSourceAdapterDefinition_(entityType) {
  return QBO_SOURCE_OBSERVATION_ADAPTERS_.ENTITY_MAP[String(entityType || '').trim()] || null;
}

function qboSourceAdapterFetchEntity_(entityType, entityId) {
  const definition = qboSourceAdapterDefinition_(entityType);
  entityId = String(entityId || '').trim();
  if (!definition) throw new Error('SOURCE_ADAPTER_UNSUPPORTED_ENTITY_TYPE ' + entityType);
  if (!entityId) throw new Error('SOURCE_ADAPTER_MISSING_ENTITY_ID entityType=' + entityType);
  const cfg = getConfig_();
  const path = definition.endpoint + '/' + encodeURIComponent(entityId) + '?minorversion=' + encodeURIComponent(String(cfg.minorVersion));
  const json = qboGet_(path);
  const entity = json && json[definition.responseKey] ? json[definition.responseKey] : json;
  if (!entity || typeof entity !== 'object' || String(entity.Id || '') !== entityId) {
    throw new Error('SOURCE_ADAPTER_FETCH_UNEXPECTED_RESPONSE entityType=' + entityType + ' entityId=' + entityId);
  }
  return entity;
}

/** Completeness is proved by successful governed normalization, not by a
 * brittle hand-maintained required-field list. If normalization cannot produce
 * the governed V2 state, the entity is not complete enough for State Capture. */
function qboSourceAdapterAssessRawEntityCompleteness_(entityType, entity) {
  const definition = qboSourceAdapterDefinition_(entityType);
  if (!definition) return {complete:false, reason:'UNSUPPORTED_ENTITY_TYPE'};
  if (!entity || typeof entity !== 'object') return {complete:false, reason:'MISSING_ENTITY_OBJECT'};
  if (!String(entity.Id || '').trim()) return {complete:false, reason:'MISSING_ENTITY_ID'};
  try {
    qboNormalizeRawEntityObservation_(definition.exportKey, entityType, entity);
    return {complete:true, reason:'GOVERNED_NORMALIZATION_SUCCEEDED'};
  } catch (error) {
    return {complete:false, reason:'GOVERNED_NORMALIZATION_FAILED', error:String(error && error.message ? error.message : error)};
  }
}

function qboSourceAdapterBuildSourceEvidence_(input) {
  input = input || {};
  return {
    sourceType: String(input.sourceType || ''),
    evidenceFileId: String(input.evidenceFileId || ''),
    evidenceFileName: String(input.evidenceFileName || ''),
    evidenceHash: String(input.evidenceHash || ''),
    evidenceHashType: String(input.evidenceHashType || ''),
    evidenceReference: String(input.evidenceReference || input.evidenceFileId || ''),
    receiptId: String(input.receiptId || ''),
    cycleId: String(input.cycleId || ''),
    entityRunId: String(input.entityRunId || ''),
    workUnitId: String(input.workUnitId || ''),
    exportRunId: String(input.exportRunId || ''),
    sourceOperation: String(input.sourceOperation || ''),
    sourceChangeTime: String(input.sourceChangeTime || ''),
    sourceReceivedAt: String(input.sourceReceivedAt || ''),
    signatureVerified: input.signatureVerified === true,
    sourceEventCount: input.sourceEventCount === undefined ? '' : input.sourceEventCount
  };
}

function qboSourceAdapterBuildRawEntityEvidence_(input) {
  input = input || {};
  const entity = input.rawEntity || null;
  const rawJson = entity ? jsonStringifySafe_(entity) : String(input.rawJson || '');
  return {
    acquisitionType: String(input.acquisitionType || ''),
    acquiredAt: String(input.acquiredAt || ''),
    rawJson: rawJson,
    rawEntityHash: String(input.rawEntityHash || qboCanonicalRawPayloadHash_(rawJson)),
    complete: input.complete === true,
    completenessReason: String(input.completenessReason || ''),
    temporalMatchStatus: String(input.temporalMatchStatus || ''),
    fetchedFromQbo: input.fetchedFromQbo === true
  };
}

/** Native CDC: source evidence file contains a CDC envelope. One entity object
 * inside QueryResponse is Raw Entity Evidence. If it cannot satisfy governed
 * normalization, fetch the current entity before creating a successful payload. */
function qboAdaptNativeCdcEntityObservation_(input) {
  input = input || {};
  const entityType = String(input.entityType || '').trim();
  const entity = input.rawEntity;
  const operation = String(input.operation || 'UPSERT').toUpperCase();
  const entityId = String(input.entityId || (entity && entity.Id) || '').trim();
  const sourceEvidence = qboSourceAdapterBuildSourceEvidence_({
    sourceType:'NATIVE_CDC', evidenceFileId:input.evidenceFileId, evidenceFileName:input.evidenceFileName,
    evidenceHash:input.evidenceHash, evidenceReference:input.evidenceReference,
    cycleId:input.cycleId, entityRunId:input.entityRunId, workUnitId:input.workUnitId,
    sourceOperation:operation, sourceChangeTime:input.sourceChangeTime, sourceReceivedAt:input.sourceReceivedAt
  });

  if (operation === 'DELETE') {
    return qboNormalizeAndBuildChangePayload_({
      sourceType:'NATIVE_CDC', sourceObservationId:input.sourceObservationId, entityType:entityType, entityId:entityId,
      observedAt:input.observedAt, sourceChangeTime:input.sourceChangeTime, operation:'DELETE',
      cycleId:input.cycleId, entityRunId:input.entityRunId, workUnitId:input.workUnitId, continuationId:input.continuationId,
      sourceEvidence:sourceEvidence,
      rawEntityEvidence:qboSourceAdapterBuildRawEntityEvidence_({acquisitionType:'CDC_DELETE_TOMBSTONE', complete:false, completenessReason:'DELETE_TOMBSTONE'}) ,
      sourceReportedChange:true, reconstructionStatus:'DELETE_TOMBSTONE'
    });
  }

  let candidate = entity;
  let assessment = qboSourceAdapterAssessRawEntityCompleteness_(entityType, candidate);
  let acquisitionType = 'NATIVE_CDC_ENTITY_OBJECT';
  let fetchedFromQbo = false;
  if (!assessment.complete) {
    candidate = qboSourceAdapterFetchEntity_(entityType, entityId);
    assessment = qboSourceAdapterAssessRawEntityCompleteness_(entityType, candidate);
    acquisitionType = 'TARGETED_QBO_FETCH_AFTER_CDC';
    fetchedFromQbo = true;
  }
  if (!assessment.complete) {
    throw new Error('SOURCE_ADAPTER_RAW_ENTITY_INCOMPLETE source=NATIVE_CDC entity=' + entityType + '|' + entityId + ' reason=' + assessment.reason);
  }

  return qboNormalizeAndBuildChangePayload_({
    sourceType:'NATIVE_CDC', sourceObservationId:input.sourceObservationId, exportKey:qboSourceAdapterDefinition_(entityType).exportKey,
    entityType:entityType, rawEntity:candidate, observedAt:input.observedAt,
    sourceChangeTime:input.sourceChangeTime || (candidate.MetaData && candidate.MetaData.LastUpdatedTime) || '', operation:'UPSERT',
    cycleId:input.cycleId, entityRunId:input.entityRunId, workUnitId:input.workUnitId, continuationId:input.continuationId,
    sourceEvidence:sourceEvidence,
    rawEntityEvidence:qboSourceAdapterBuildRawEntityEvidence_({rawEntity:candidate, acquisitionType:acquisitionType,
      acquiredAt:input.observedAt, complete:true, completenessReason:assessment.reason, fetchedFromQbo:fetchedFromQbo}),
    sourceReportedChange:true
  });
}

/** Webhook receipts are signals, not entity state. Non-delete events always
 * obtain the complete entity with a targeted QBO fetch. */
function qboAdaptWebhookEntityObservation_(input) {
  input = input || {};
  const entityType = String(input.entityType || '').trim();
  const entityId = String(input.entityId || '').trim();
  const operation = String(input.operation || 'UPDATE').trim().toUpperCase();
  const sourceEvidence = qboSourceAdapterBuildSourceEvidence_({
    sourceType:'WEBHOOK', evidenceFileId:input.evidenceFileId, evidenceFileName:input.evidenceFileName,
    evidenceHash:input.evidenceHash, evidenceReference:input.evidenceReference, receiptId:input.receiptId,
    sourceOperation:operation, sourceChangeTime:input.sourceChangeTime, sourceReceivedAt:input.sourceReceivedAt,
    signatureVerified:input.signatureVerified, sourceEventCount:input.sourceEventCount
  });

  if (operation === 'DELETE') {
    return qboNormalizeAndBuildChangePayload_({
      sourceType:'WEBHOOK', sourceObservationId:input.sourceObservationId, entityType:entityType, entityId:entityId,
      observedAt:input.observedAt, sourceChangeTime:input.sourceChangeTime, operation:'DELETE', sourceEvidence:sourceEvidence,
      rawEntityEvidence:qboSourceAdapterBuildRawEntityEvidence_({acquisitionType:'WEBHOOK_DELETE_TOMBSTONE', complete:false, completenessReason:'DELETE_TOMBSTONE'}),
      sourceReportedChange:true, reconstructionStatus:'DELETE_TOMBSTONE'
    });
  }

  const fetched = input.rawEntity && typeof input.rawEntity === 'object'
    ? input.rawEntity
    : qboSourceAdapterFetchEntity_(entityType, entityId);
  const assessment = qboSourceAdapterAssessRawEntityCompleteness_(entityType, fetched);
  if (!assessment.complete) {
    throw new Error('SOURCE_ADAPTER_RAW_ENTITY_INCOMPLETE source=WEBHOOK entity=' + entityType + '|' + entityId + ' reason=' + assessment.reason);
  }
  const fetchedLastUpdated = String(fetched.MetaData && fetched.MetaData.LastUpdatedTime || '');
  const eventLastUpdated = String(input.sourceChangeTime || '');
  const temporalMatchStatus = qboSourceAdapterTemporalMatchStatus_(eventLastUpdated, fetchedLastUpdated);
  if (input.historicalReconstruction === true && temporalMatchStatus === 'FETCHED_STATE_NEWER_THAN_SOURCE_EVENT') {
    throw new Error('WEBHOOK_HISTORICAL_STATE_NOT_RECONSTRUCTIBLE entity=' + entityType + '|' + entityId + ' sourceChangeTime=' + eventLastUpdated + ' fetchedLastUpdatedTime=' + fetchedLastUpdated);
  }

  return qboNormalizeAndBuildChangePayload_({
    sourceType:'WEBHOOK', sourceObservationId:input.sourceObservationId, exportKey:qboSourceAdapterDefinition_(entityType).exportKey,
    entityType:entityType, rawEntity:fetched, observedAt:input.observedAt,
    sourceChangeTime:eventLastUpdated || fetchedLastUpdated, operation:'UPSERT', sourceEvidence:sourceEvidence,
    rawEntityEvidence:qboSourceAdapterBuildRawEntityEvidence_({rawEntity:fetched, acquisitionType:String(input.rawEntityAcquisitionType || 'TARGETED_QBO_FETCH_AFTER_WEBHOOK'),
      acquiredAt:input.observedAt, complete:true, completenessReason:assessment.reason, temporalMatchStatus:temporalMatchStatus, fetchedFromQbo:true}),
    sourceReportedChange:true, historicalReconstruction:input.historicalReconstruction === true,
    reconstructionStatus:temporalMatchStatus === 'FETCH_MATCHES_SOURCE_EVENT' || temporalMatchStatus === 'SOURCE_EVENT_TIME_UNAVAILABLE'
      ? 'COMPLETE'
      : 'FETCHED_STATE_NEWER_THAN_SOURCE_EVENT'
  });
}

function qboSourceAdapterTemporalMatchStatus_(sourceChangeTime, fetchedLastUpdatedTime) {
  if (!sourceChangeTime || !fetchedLastUpdatedTime) return 'SOURCE_EVENT_TIME_UNAVAILABLE';
  const sourceMs = new Date(sourceChangeTime).getTime();
  const fetchedMs = new Date(fetchedLastUpdatedTime).getTime();
  if (isNaN(sourceMs) || isNaN(fetchedMs)) return 'SOURCE_EVENT_TIME_UNAVAILABLE';
  if (fetchedMs === sourceMs) return 'FETCH_MATCHES_SOURCE_EVENT';
  if (fetchedMs > sourceMs) return 'FETCHED_STATE_NEWER_THAN_SOURCE_EVENT';
  return 'FETCHED_STATE_OLDER_THAN_SOURCE_EVENT';
}

function testQboSourceObservationAdapterReadiness() {
  const entityTypes = Object.keys(QBO_SOURCE_OBSERVATION_ADAPTERS_.ENTITY_MAP);
  const exportKeys = entityTypes.map(function(type) { return QBO_SOURCE_OBSERVATION_ADAPTERS_.ENTITY_MAP[type].exportKey; });
  const unsupported = exportKeys.filter(function(key) { return !qboObservationNormalizerDefinition_(key); });
  const result = {
    ready: unsupported.length === 0,
    adapterVersion: QBO_SOURCE_OBSERVATION_ADAPTERS_.VERSION,
    entityTypeCount: entityTypes.length,
    unsupportedExportKeys: unsupported,
    webhookRequiresTargetedFetch: true,
    nativeCdcCompletenessGate: true,
    fullExportDeferredCompletionAllowed: false
  };
  if (!result.ready) throw new Error('SOURCE_ADAPTER_READINESS_FAILED ' + JSON.stringify(result));
  console.log('[SOURCE ADAPTERS] | READY | ' + JSON.stringify(result));
  return result;
}
