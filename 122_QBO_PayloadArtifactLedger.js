/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 122_QBO_PayloadArtifactLedger.js
 * Version     : 1.5.99
 * Purpose     : Durable one-row-per-physical-shard provenance ledger for
 *               governed Change Payload artifacts.
 *
 * Contract:
 *   - 05_Forward_Ingestion_Control remains the source-level aggregate ledger.
 *   - 06_Payload_Artifacts is the artifact-level child ledger.
 *   - One row represents one physical Change Payload shard file.
 *   - Registration is idempotent by PayloadFileId and fail-closed on collision.
 *   - Historical artifacts may be inventoried even when lineage is not fully
 *     reconcilable; LineageStatus records that fact explicitly.
 * ============================================================================
 */

const QBO_PAYLOAD_ARTIFACT_LEDGER_ = Object.freeze({
  VERSION: 'QBO_PAYLOAD_ARTIFACT_LEDGER_V1_5_99',
  SHEET_NAME: '06_Payload_Artifacts',
  REGISTRATION_MODE_FORWARD: 'FORWARD_COMMIT',
  REGISTRATION_MODE_HISTORICAL: 'HISTORICAL_RECONSTRUCTION',
  LINEAGE_EXACT: 'EXACT_RECONCILED',
  LINEAGE_HISTORICAL_SOURCE_EXACT: 'HISTORICAL_SOURCE_EXACT_NO_05',
  LINEAGE_ORPHAN: 'ORPHAN_NO_05_SOURCE',
  LINEAGE_MISMATCH: 'LINEAGE_MISMATCH'
});

const QBO_PAYLOAD_ARTIFACT_HEADERS_ = Object.freeze([
  'IngestionSourceId',
  'SourceType',
  'SourceRunId',
  'IngestionRunId',
  'WorkUnitId',
  'RecordCursorStart',
  'RecordCursorEndExclusive',
  'ObservationCount',
  'PayloadCount',
  'PayloadFileId',
  'PayloadFileName',
  'PayloadShardHash',
  'PayloadCreatedAt',
  'PersistedAt',
  'RegistrationMode',
  'LineageStatus',
  'ContentVerifiedAt'
]);

function provisionQboPayloadArtifactLedger() {
  const sheet = qboPayloadArtifactEnsureSheet_();
  const result = {
    ready: true,
    version: QBO_PAYLOAD_ARTIFACT_LEDGER_.VERSION,
    sheetName: sheet.getName(),
    headerCount: QBO_PAYLOAD_ARTIFACT_HEADERS_.length,
    oneRowPerPhysicalShard: true,
    sourceAggregateAuthority: QBO_FORWARD_INGESTION_CONTROL_.SHEET_NAME,
    artifactAuthority: QBO_PAYLOAD_ARTIFACT_LEDGER_.SHEET_NAME
  };
  console.log('[PAYLOAD ARTIFACT LEDGER] | READY | ' + JSON.stringify(result));
  return result;
}

function testQboPayloadArtifactLedgerReadiness() {
  return provisionQboPayloadArtifactLedger();
}

function qboPayloadArtifactEnsureSheet_() {
  const spreadsheet = getQboStateCaptureSpreadsheet_();
  const sheet = ensureQboStateCaptureSheet_(
    spreadsheet,
    QBO_PAYLOAD_ARTIFACT_LEDGER_.SHEET_NAME,
    QBO_PAYLOAD_ARTIFACT_HEADERS_
  );
  applyQboStateCaptureSheetLayout_(sheet);
  return sheet;
}

function qboPayloadArtifactHeaderIndex_() {
  const idx = Object.create(null);
  QBO_PAYLOAD_ARTIFACT_HEADERS_.forEach(function(h, i) { idx[h] = i; });
  return idx;
}

function qboPayloadArtifactReadRows_(sheet) {
  sheet = sheet || qboPayloadArtifactEnsureSheet_();
  if (sheet.getLastRow() <= 1) return [];
  const idx = qboPayloadArtifactHeaderIndex_();
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, QBO_PAYLOAD_ARTIFACT_HEADERS_.length)
    .getValues()
    .map(function(values, offset) {
      const row = {rowNumber: offset + 2, _values: values};
      Object.keys(idx).forEach(function(h) { row[h] = values[idx[h]]; });
      return row;
    });
}

function qboPayloadArtifactFindByFileId_(sheet, fileId) {
  fileId = String(fileId || '').trim();
  if (!fileId || sheet.getLastRow() <= 1) return null;
  const idx = qboPayloadArtifactHeaderIndex_();
  const finder = sheet.getRange(2, idx.PayloadFileId + 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(fileId)
    .matchEntireCell(true)
    .findNext();
  if (!finder) return null;
  const rowNumber = finder.getRow();
  const values = sheet.getRange(rowNumber, 1, 1, QBO_PAYLOAD_ARTIFACT_HEADERS_.length).getValues()[0];
  const row = {rowNumber: rowNumber, _values: values};
  Object.keys(idx).forEach(function(h) { row[h] = values[idx[h]]; });
  return row;
}

function qboPayloadArtifactRegister_(artifact) {
  artifact = artifact || {};
  const fileId = String(artifact.payloadFileId || '').trim();
  const fileName = String(artifact.payloadFileName || '').trim();
  const shardHash = String(artifact.payloadShardHash || '').trim();
  if (!fileId) throw new Error('PAYLOAD_ARTIFACT_LEDGER_MISSING_FILE_ID');
  if (!fileName) throw new Error('PAYLOAD_ARTIFACT_LEDGER_MISSING_FILE_NAME');
  if (!shardHash) throw new Error('PAYLOAD_ARTIFACT_LEDGER_MISSING_SHARD_HASH');

  const spreadsheet = getQboStateCaptureSpreadsheet_();
  return withExportWriteLock_(QBO_PAYLOAD_ARTIFACT_LEDGER_.SHEET_NAME, spreadsheet.getId(), function() {
    const sheet = qboPayloadArtifactEnsureSheet_();
    const existing = qboPayloadArtifactFindByFileId_(sheet, fileId);
    if (existing) {
      const immutableChecks = {
        IngestionSourceId: String(artifact.ingestionSourceId || ''),
        SourceType: String(artifact.sourceType || ''),
        IngestionRunId: String(artifact.ingestionRunId || ''),
        WorkUnitId: String(artifact.workUnitId || ''),
        PayloadFileName: fileName,
        PayloadShardHash: shardHash
      };
      const mismatches = [];
      Object.keys(immutableChecks).forEach(function(field) {
        const requested = immutableChecks[field];
        const persisted = String(existing[field] || '');
        if (requested && persisted && requested !== persisted) mismatches.push(field);
      });
      if (mismatches.length) {
        throw new Error('PAYLOAD_ARTIFACT_LEDGER_FILE_ID_COLLISION fileId=' + fileId + ' fields=' + mismatches.join(','));
      }
      return {registered:false, alreadyRegistered:true, rowNumber:existing.rowNumber, fileId:fileId};
    }

    const row = qboPayloadArtifactBuildRow_(artifact);
    const rowNumber = sheet.getLastRow() + 1;
    sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
    SpreadsheetApp.flush();
    const persisted = qboPayloadArtifactFindByFileId_(sheet, fileId);
    if (!persisted || String(persisted.PayloadShardHash || '') !== shardHash) {
      throw new Error('PAYLOAD_ARTIFACT_LEDGER_NOT_PERSISTED fileId=' + fileId);
    }
    return {registered:true, alreadyRegistered:false, rowNumber:rowNumber, fileId:fileId};
  });
}

function qboPayloadArtifactBuildRow_(artifact) {
  return [
    String(artifact.ingestionSourceId || ''),
    String(artifact.sourceType || ''),
    String(artifact.sourceRunId || ''),
    String(artifact.ingestionRunId || ''),
    String(artifact.workUnitId || ''),
    artifact.recordCursorStart === undefined ? '' : Number(artifact.recordCursorStart),
    artifact.recordCursorEndExclusive === undefined ? '' : Number(artifact.recordCursorEndExclusive),
    artifact.observationCount === undefined ? '' : Number(artifact.observationCount),
    artifact.payloadCount === undefined ? '' : Number(artifact.payloadCount),
    String(artifact.payloadFileId || ''),
    String(artifact.payloadFileName || ''),
    String(artifact.payloadShardHash || ''),
    artifact.payloadCreatedAt || '',
    artifact.persistedAt || new Date(),
    String(artifact.registrationMode || QBO_PAYLOAD_ARTIFACT_LEDGER_.REGISTRATION_MODE_FORWARD),
    String(artifact.lineageStatus || QBO_PAYLOAD_ARTIFACT_LEDGER_.LINEAGE_EXACT),
    artifact.contentVerifiedAt || new Date()
  ];
}

function qboPayloadArtifactRegisterFromPersistence_(persisted, payloads, metadata) {
  metadata = metadata || {};
  persisted = persisted || {};
  const fileId = String(persisted.fileId || '');
  if (!fileId) throw new Error('PAYLOAD_ARTIFACT_LEDGER_PERSISTENCE_MISSING_FILE_ID');
  const file = DriveApp.getFileById(fileId);
  return qboPayloadArtifactRegister_({
    ingestionSourceId: String(metadata.sourceId || ''),
    sourceType: String(metadata.sourceType || ''),
    sourceRunId: String(metadata.sourceRunId || ''),
    ingestionRunId: String(metadata.ingestionRunId || ''),
    workUnitId: String(metadata.workUnitId || ''),
    recordCursorStart: metadata.recordCursorStart,
    recordCursorEndExclusive: metadata.recordCursorEndExclusive,
    observationCount: Array.isArray(payloads) ? payloads.length : Number(persisted.observationCount || 0),
    payloadCount: Array.isArray(payloads) ? payloads.length : Number(persisted.observationCount || 0),
    payloadFileId: fileId,
    payloadFileName: String(persisted.fileName || file.getName()),
    payloadShardHash: String(persisted.shardHash || ''),
    payloadCreatedAt: file.getDateCreated(),
    persistedAt: new Date(),
    registrationMode: QBO_PAYLOAD_ARTIFACT_LEDGER_.REGISTRATION_MODE_FORWARD,
    lineageStatus: QBO_PAYLOAD_ARTIFACT_LEDGER_.LINEAGE_EXACT,
    contentVerifiedAt: new Date()
  });
}
