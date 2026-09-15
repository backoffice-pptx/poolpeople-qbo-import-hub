/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 101_QBO_ChangePayloadPersistence.js
 * Version     : 1.5.97
 * Purpose     : Immutable, idempotent persistence of normalized Change Payload
 *               observations into governed Change Evidence/Change Payloads.
 *
 * Physical storage rule:
 *   - One Drive JSON shard may contain multiple logical observations.
 *   - Logical contract remains one entity observation per Change Payload.
 *   - Shard identity is deterministic from stable payload content.
 *   - Retry reconciles an already-existing identical shard instead of writing
 *     a duplicate.
 * ============================================================================
 */

const QBO_CHANGE_PAYLOAD_PERSISTENCE_ = Object.freeze({
  VERSION: 'QBO_CHANGE_PAYLOAD_PERSISTENCE_V1',
  FOLDER_ASSET_KEY: 'QBO_CHANGE_PAYLOADS_FOLDER',
  FOLDER_EXPECTED_TYPE: 'Folder',
  ENVIRONMENT: 'PROD',
  SHARD_SCHEMA_VERSION: 'QBO_CHANGE_PAYLOAD_SHARD_V1',
  FILE_PREFIX: 'qbo_change_payload_shard_'
});

function qboPersistChangePayloadShard_(payloads, metadata) {
  metadata = metadata || {};
  if (!Array.isArray(payloads) || payloads.length === 0) {
    throw new Error('CHANGE_PAYLOAD_PERSISTENCE_EMPTY_BATCH');
  }

  const observationIds = Object.create(null);
  payloads.forEach(function(payload, i) {
    if (!payload || payload.payloadVersion !== QBO_CHANGE_PAYLOAD_CONTRACT_.VERSION) {
      throw new Error('CHANGE_PAYLOAD_PERSISTENCE_INVALID_PAYLOAD index=' + i);
    }
    if (!payload.observationId) throw new Error('CHANGE_PAYLOAD_PERSISTENCE_MISSING_OBSERVATION_ID index=' + i);
    if (observationIds[payload.observationId]) throw new Error('CHANGE_PAYLOAD_PERSISTENCE_DUPLICATE_OBSERVATION_ID id=' + payload.observationId);
    observationIds[payload.observationId] = true;
  });

  const stableBody = {
    schemaVersion: QBO_CHANGE_PAYLOAD_PERSISTENCE_.SHARD_SCHEMA_VERSION,
    ingestionRunId: String(metadata.ingestionRunId || ''),
    workUnitId: String(metadata.workUnitId || ''),
    sourceId: String(metadata.sourceId || ''),
    sourceType: String(metadata.sourceType || ''),
    sourceIndex: metadata.sourceIndex === undefined ? '' : metadata.sourceIndex,
    recordCursorStart: metadata.recordCursorStart === undefined ? '' : metadata.recordCursorStart,
    recordCursorEndExclusive: metadata.recordCursorEndExclusive === undefined ? '' : metadata.recordCursorEndExclusive,
    observationCount: payloads.length,
    observationIds: payloads.map(function(p) { return p.observationId; }),
    payloads: payloads
  };
  const stableJson = qboCanonicalStableStringify_(stableBody);
  const shardHash = qboStateCaptureAuditSha256_(stableJson);
  const fileName = QBO_CHANGE_PAYLOAD_PERSISTENCE_.FILE_PREFIX + shardHash + '.json';
  const folder = qboResolveGovernedFolderAsset_(
    QBO_CHANGE_PAYLOAD_PERSISTENCE_.FOLDER_ASSET_KEY,
    QBO_CHANGE_PAYLOAD_PERSISTENCE_.FOLDER_EXPECTED_TYPE,
    QBO_CHANGE_PAYLOAD_PERSISTENCE_.ENVIRONMENT
  );

  const existing = folder.getFilesByName(fileName);
  if (existing.hasNext()) {
    const file = existing.next();
    if (existing.hasNext()) throw new Error('CHANGE_PAYLOAD_PERSISTENCE_DUPLICATE_SHARD_NAME file=' + fileName);
    const existingText = file.getBlob().getDataAsString('UTF-8');
    let parsed;
    try { parsed = JSON.parse(existingText); } catch (err) { throw new Error('CHANGE_PAYLOAD_PERSISTENCE_EXISTING_SHARD_INVALID_JSON file=' + fileName); }
    const existingStable = qboCanonicalStableStringify_(parsed.stableBody || {});
    const existingHash = qboStateCaptureAuditSha256_(existingStable);
    if (existingHash !== shardHash) throw new Error('CHANGE_PAYLOAD_PERSISTENCE_HASH_MISMATCH file=' + fileName);
    const reconciledResult = {created:false, reconciled:true, fileId:file.getId(), fileName:fileName, shardHash:shardHash, observationCount:payloads.length};
    qboPayloadArtifactRegisterFromPersistence_(reconciledResult, payloads, metadata);
    return reconciledResult;
  }

  const envelope = {
    schemaVersion: QBO_CHANGE_PAYLOAD_PERSISTENCE_.SHARD_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    shardHash: shardHash,
    hashAlgorithm: 'SHA-256',
    stableBody: stableBody
  };
  const file = folder.createFile(fileName, JSON.stringify(envelope, null, 2), MimeType.PLAIN_TEXT);
  const createdResult = {created:true, reconciled:false, fileId:file.getId(), fileName:fileName, shardHash:shardHash, observationCount:payloads.length};
  qboPayloadArtifactRegisterFromPersistence_(createdResult, payloads, metadata);
  return createdResult;
}

function testQboChangePayloadPersistenceReadiness() {
  const folder = qboResolveGovernedFolderAsset_(
    QBO_CHANGE_PAYLOAD_PERSISTENCE_.FOLDER_ASSET_KEY,
    QBO_CHANGE_PAYLOAD_PERSISTENCE_.FOLDER_EXPECTED_TYPE,
    QBO_CHANGE_PAYLOAD_PERSISTENCE_.ENVIRONMENT
  );
  const result = {
    ready: !!folder,
    persistenceVersion: QBO_CHANGE_PAYLOAD_PERSISTENCE_.VERSION,
    shardSchemaVersion: QBO_CHANGE_PAYLOAD_PERSISTENCE_.SHARD_SCHEMA_VERSION,
    governedFolderId: folder.getId(),
    governedFolderName: folder.getName(),
    logicalObservationPerPayload: true,
    physicalBatchShardsAllowed: true,
    deterministicShardIdentity: true,
    idempotentRetryReconciliation: true
  };
  console.log('[CHANGE PAYLOAD PERSISTENCE] | READY | ' + JSON.stringify(result));
  return result;
}
