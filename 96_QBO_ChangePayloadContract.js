/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 96_QBO_ChangePayloadContract.js
 * Version     : 1.5.58
 * Purpose     : Immutable normalized Change Payload contract shared by
 *               FULL_EXPORT, Native CDC, Webhooks, and historical replay.
 *
 * Contract rule:
 *   A Change Payload is one immutable entity observation. It is NOT a finding
 *   that business state changed. BusinessStateChanged is determined only by
 *   State Application after chronology/precedence and prior-state comparison.
 * ============================================================================
 */

const QBO_CHANGE_PAYLOAD_CONTRACT_ = Object.freeze({
  VERSION: 'QBO_CHANGE_PAYLOAD_V3',
  NORMALIZATION_VERSION: 'QBO_OBSERVATION_NORMALIZATION_V3_RECURRING_WRAPPER_IDENTITY',
  SOURCE_TYPES: Object.freeze(['FULL_EXPORT', 'FULL_EXPORT_LEGACY', 'NATIVE_CDC', 'WEBHOOK']),
  DELETE_OPERATION: 'DELETE',
  PAYLOAD_KINDS: Object.freeze({NORMALIZED:'NORMALIZED_OBSERVATION', EVIDENCE_EXCEPTION:'EVIDENCE_EXCEPTION'})
});

/**
 * Builds and validates one immutable normalized observation.
 * Every successful non-delete payload embeds the exact complete entity RawJSON
 * used for normalization under rawEntityEvidence. Source evidence remains an
 * immutable external artifact referenced and hashed by the payload.
 */
function qboBuildChangePayload_(input) {
  input = input || {};
  const sourceType = String(input.sourceType || '').trim();
  const entityType = String(input.entityType || '').trim();
  const entityId = String(input.entityId || '').trim();
  const observedAt = String(input.observedAt || '').trim();
  const sourceObservationId = String(input.sourceObservationId || '').trim();
  const operation = String(input.operation || 'UPSERT').trim().toUpperCase();
  const payloadKind = String(input.payloadKind || QBO_CHANGE_PAYLOAD_CONTRACT_.PAYLOAD_KINDS.NORMALIZED).trim().toUpperCase();

  if (QBO_CHANGE_PAYLOAD_CONTRACT_.SOURCE_TYPES.indexOf(sourceType) < 0) {
    throw new Error('CHANGE_PAYLOAD_INVALID_SOURCE_TYPE sourceType=' + sourceType);
  }
  if (Object.keys(QBO_CHANGE_PAYLOAD_CONTRACT_.PAYLOAD_KINDS).map(function(k){return QBO_CHANGE_PAYLOAD_CONTRACT_.PAYLOAD_KINDS[k];}).indexOf(payloadKind) < 0) {
    throw new Error('CHANGE_PAYLOAD_INVALID_PAYLOAD_KIND payloadKind=' + payloadKind);
  }
  if (!entityType) throw new Error('CHANGE_PAYLOAD_MISSING_ENTITY_TYPE');
  if (!entityId) throw new Error('CHANGE_PAYLOAD_MISSING_ENTITY_ID');
  if (!observedAt) throw new Error('CHANGE_PAYLOAD_MISSING_OBSERVED_AT');
  if (!sourceObservationId) throw new Error('CHANGE_PAYLOAD_MISSING_SOURCE_OBSERVATION_ID');

  const isDelete = operation === QBO_CHANGE_PAYLOAD_CONTRACT_.DELETE_OPERATION;
  const isEvidenceException = payloadKind === QBO_CHANGE_PAYLOAD_CONTRACT_.PAYLOAD_KINDS.EVIDENCE_EXCEPTION;
  const sourceEvidence = input.sourceEvidence || {};
  const rawEntityEvidence = input.rawEntityEvidence || {};
  const reconstructionStatus = String(input.reconstructionStatus || (isDelete ? 'DELETE_TOMBSTONE' : 'COMPLETE'));

  if (isEvidenceException) {
    if (input.historicalReconstruction !== true) throw new Error('CHANGE_PAYLOAD_EVIDENCE_EXCEPTION_REQUIRES_HISTORICAL_RECONSTRUCTION');
    if (rawEntityEvidence.complete === true) throw new Error('CHANGE_PAYLOAD_EVIDENCE_EXCEPTION_CANNOT_BE_COMPLETE');
    if (!String(rawEntityEvidence.completenessReason || '')) throw new Error('CHANGE_PAYLOAD_EVIDENCE_EXCEPTION_MISSING_REASON');
    if (!reconstructionStatus || reconstructionStatus === 'COMPLETE') throw new Error('CHANGE_PAYLOAD_EVIDENCE_EXCEPTION_INVALID_RECONSTRUCTION_STATUS');
  } else if (!isDelete) {
    if (!input.normalizedEntityState || !input.normalizedStateHash) {
      throw new Error('CHANGE_PAYLOAD_MISSING_NORMALIZED_STATE entity=' + entityType + '|' + entityId);
    }
    if (rawEntityEvidence.complete !== true || !String(rawEntityEvidence.rawJson || '')) {
      throw new Error('CHANGE_PAYLOAD_INCOMPLETE_RAW_ENTITY_EVIDENCE entity=' + entityType + '|' + entityId);
    }
  }

  const payload = {
    payloadVersion: QBO_CHANGE_PAYLOAD_CONTRACT_.VERSION,
    normalizationVersion: QBO_CHANGE_PAYLOAD_CONTRACT_.NORMALIZATION_VERSION,
    canonicalizationVersion: QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
    exportContractVersion: typeof QBO_EXPORT_CONTRACT_REMEDIATION_VERSION === 'undefined'
      ? ''
      : QBO_EXPORT_CONTRACT_REMEDIATION_VERSION,

    observationId: '',
    payloadKind: payloadKind,
    sourceObservationId: sourceObservationId,
    sourceType: sourceType,
    operation: operation,
    entityType: entityType,
    entityId: entityId,
    observedAt: observedAt,
    sourceChangeTime: String(input.sourceChangeTime || sourceEvidence.sourceChangeTime || ''),

    cycleId: String(input.cycleId || sourceEvidence.cycleId || ''),
    entityRunId: String(input.entityRunId || sourceEvidence.entityRunId || ''),
    workUnitId: String(input.workUnitId || sourceEvidence.workUnitId || ''),
    continuationId: String(input.continuationId || ''),
    exportRunId: String(input.exportRunId || sourceEvidence.exportRunId || ''),
    sourceId: String(input.sourceId || ''),
    sourceIndex: input.sourceIndex === undefined ? '' : input.sourceIndex,
    sourceRowNumber: input.sourceRowNumber === undefined ? '' : input.sourceRowNumber,

    // Immutable source artifact provenance. The whole source artifact is kept
    // in Drive and referenced/hashed here; it is not duplicated per entity.
    sourceEvidence: Object.freeze({
      evidenceFileId: String(sourceEvidence.evidenceFileId || ''),
      evidenceFileName: String(sourceEvidence.evidenceFileName || ''),
      evidenceHash: String(sourceEvidence.evidenceHash || ''),
      evidenceHashType: String(sourceEvidence.evidenceHashType || ''),
      evidenceReference: String(sourceEvidence.evidenceReference || ''),
      receiptId: String(sourceEvidence.receiptId || ''),
      sourceOperation: String(sourceEvidence.sourceOperation || operation),
      sourceChangeTime: String(sourceEvidence.sourceChangeTime || input.sourceChangeTime || ''),
      sourceReceivedAt: String(sourceEvidence.sourceReceivedAt || ''),
      signatureVerified: sourceEvidence.signatureVerified === true,
      sourceEventCount: sourceEvidence.sourceEventCount === undefined ? '' : sourceEvidence.sourceEventCount
    }),

    // Exact complete QBO entity JSON used by normalization. Delete tombstones
    // intentionally have no complete live entity JSON.
    rawEntityEvidence: Object.freeze({
      acquisitionType: String(rawEntityEvidence.acquisitionType || ''),
      acquiredAt: String(rawEntityEvidence.acquiredAt || ''),
      rawJson: isDelete ? String(rawEntityEvidence.rawJson || '') : String(rawEntityEvidence.rawJson || ''),
      rawEntityHash: String(rawEntityEvidence.rawEntityHash || qboCanonicalRawPayloadHash_(String(rawEntityEvidence.rawJson || ''))),
      complete: rawEntityEvidence.complete === true,
      completenessReason: String(rawEntityEvidence.completenessReason || ''),
      temporalMatchStatus: String(rawEntityEvidence.temporalMatchStatus || ''),
      fetchedFromQbo: rawEntityEvidence.fetchedFromQbo === true
    }),

    normalizedEntityState: (isDelete || isEvidenceException) ? null : input.normalizedEntityState,
    normalizedStateHash: (isDelete || isEvidenceException) ? '' : String(input.normalizedStateHash || ''),

    // Provenance only. This does not mean business state changed.
    sourceReportedChange: input.sourceReportedChange === true,
    historicalReconstruction: input.historicalReconstruction === true,
    reconstructionStatus: reconstructionStatus
  };

  payload.observationId = qboChangePayloadObservationId_(payload);
  return Object.freeze(payload);
}

function qboChangePayloadObservationId_(payload) {
  const identity = {
    payloadVersion: payload.payloadVersion,
    payloadKind: payload.payloadKind,
    sourceObservationId: payload.sourceObservationId,
    sourceType: payload.sourceType,
    operation: payload.operation,
    entityType: payload.entityType,
    entityId: payload.entityId,
    observedAt: payload.observedAt,
    sourceChangeTime: payload.sourceChangeTime,
    sourceEvidenceHash: payload.sourceEvidence.evidenceHash,
    rawEntityHash: payload.rawEntityEvidence.rawEntityHash,
    normalizedStateHash: payload.normalizedStateHash,
    reconstructionStatus: payload.reconstructionStatus,
    completenessReason: payload.rawEntityEvidence.completenessReason
  };
  return 'OBS|' + qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(identity));
}

function testQboChangePayloadContract() {
  const sampleState = {parent:{DisplayName:'Contract Test'}};
  const sampleHash = qboCanonicalStateHash_('CUSTOMERS', 'Customer', sampleState);
  const payload = qboBuildChangePayload_({
    sourceType: 'FULL_EXPORT_LEGACY',
    sourceObservationId: 'TEST|SOURCE|1',
    entityType: 'Customer',
    entityId: '1',
    observedAt: '2026-01-01T00:00:00.000Z',
    sourceEvidence: {evidenceFileId:'TEST_FILE', evidenceHash:'sourcehash'},
    rawEntityEvidence: {acquisitionType:'FULL_EXPORT_RAWJSON', acquiredAt:'2026-01-01T00:00:00.000Z', rawJson:'{"Id":"1"}', rawEntityHash:'rawhash', complete:true, completenessReason:'TEST'},
    historicalReconstruction: true,
    normalizedEntityState: sampleState,
    normalizedStateHash: sampleHash
  });
  const exceptionPayload = qboBuildChangePayload_({
    payloadKind: QBO_CHANGE_PAYLOAD_CONTRACT_.PAYLOAD_KINDS.EVIDENCE_EXCEPTION,
    sourceType: 'FULL_EXPORT_LEGACY',
    sourceObservationId: 'TEST|SOURCE|EXCEPTION|1',
    entityType: 'Deposit',
    entityId: '69279',
    observedAt: '2026-01-01T00:00:00.000Z',
    sourceEvidence: {evidenceFileId:'TEST_FILE', evidenceHash:'sourcehash2'},
    rawEntityEvidence: {acquisitionType:'FULL_EXPORT_RAWJSON', acquiredAt:'2026-01-01T00:00:00.000Z', rawJson:'{\"Id\":\"69279\"...TRUNCATED}', rawEntityHash:'rawhash2', complete:false, completenessReason:'SOURCE_RAWJSON_TRUNCATED'},
    historicalReconstruction: true,
    reconstructionStatus: 'EVIDENCE_EXCEPTION_RAWJSON_TRUNCATED'
  });
  const result = {
    valid: /^OBS\|[0-9a-f]+$/i.test(payload.observationId),
    payloadVersion: payload.payloadVersion,
    normalizationVersion: payload.normalizationVersion,
    sourceEvidenceStructured: !!payload.sourceEvidence,
    rawEntityEvidenceStructured: !!payload.rawEntityEvidence,
    rawEntityEmbedded: payload.rawEntityEvidence.rawJson === '{"Id":"1"}',
    businessStateChangedPresent: Object.prototype.hasOwnProperty.call(payload, 'businessStateChanged'),
    evidenceExceptionSupported: exceptionPayload.payloadKind === 'EVIDENCE_EXCEPTION' && exceptionPayload.normalizedEntityState === null && exceptionPayload.rawEntityEvidence.complete === false
  };
  if (!result.valid || !result.sourceEvidenceStructured || !result.rawEntityEvidenceStructured || !result.rawEntityEmbedded || result.businessStateChangedPresent || !result.evidenceExceptionSupported) {
    throw new Error('CHANGE_PAYLOAD_CONTRACT_TEST_FAILED ' + JSON.stringify(result));
  }
  console.log('[CHANGE PAYLOAD] | CONTRACT OK | ' + JSON.stringify(result));
  return result;
}
