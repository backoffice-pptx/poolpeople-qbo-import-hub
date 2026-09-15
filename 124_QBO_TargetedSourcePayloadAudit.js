/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 124_QBO_TargetedSourcePayloadAudit.js
 * Version     : 1.5.101
 * Purpose     : Read-only end-to-end audit of one FULL_EXPORT source against
 *               its original source workbook, 05 source aggregate, 06 artifact
 *               ledger rows, and the actual physical Change Payload shards.
 *
 * SAFETY / SCOPE:
 *   - READ ONLY.
 *   - Does not write to 01, 05, 06, payload files, source evidence, Script
 *     Properties, triggers, State Application, or ingestion state.
 *   - Does not enumerate/reconcile unrelated payload artifacts.
 *
 * Primary question:
 *   source observations
 *     == 05 ObservationCount
 *     == SUM(06 ObservationCount)
 *     == SUM(actual shard stableBody.observationCount)
 *     == SUM(actual shard payloads.length)
 *     == unique observationId count
 *
 * Default target:
 *   FULL_EXPORT|0815f34c-ba66-4ed0-b2fb-89b9be3ecf1e|INVOICES
 * ============================================================================
 */

const QBO_TARGETED_SOURCE_PAYLOAD_AUDIT_ = Object.freeze({
  VERSION: 'QBO_TARGETED_SOURCE_PAYLOAD_AUDIT_V1_5_101',
  DEFAULT_SOURCE_ID: 'FULL_EXPORT|0815f34c-ba66-4ed0-b2fb-89b9be3ecf1e|INVOICES',
  SOURCE_SHEET: '01_Sources',
  CONTROL_SHEET: '05_Forward_Ingestion_Control',
  ARTIFACT_SHEET: '06_Payload_Artifacts',
  SHARD_SCHEMA_VERSION: 'QBO_CHANGE_PAYLOAD_SHARD_V1',
  FILE_PREFIX: 'qbo_change_payload_shard_'
});

/**
 * Run the locked default source audit.
 */
function auditQboTargetedInvoiceSourcePayloads() {
  return auditQboTargetedSourcePayloads(
    QBO_TARGETED_SOURCE_PAYLOAD_AUDIT_.DEFAULT_SOURCE_ID
  );
}

/**
 * Read-only targeted audit for one exact FULL_EXPORT IngestionSourceId.
 *
 * @param {string} sourceId exact 01/05/06 source identity
 * @return {Object} complete audit result
 */
function auditQboTargetedSourcePayloads(sourceId) {
  sourceId = String(sourceId || '').trim();
  if (!sourceId) throw new Error('TARGETED_PAYLOAD_AUDIT_SOURCE_ID_REQUIRED');
  if (sourceId.indexOf('FULL_EXPORT|') !== 0) {
    throw new Error('TARGETED_PAYLOAD_AUDIT_V1_5_101_FULL_EXPORT_ONLY sourceId=' + sourceId);
  }

  const startedAt = new Date().toISOString();
  console.log('[TARGETED PAYLOAD AUDIT] | START | version=' +
    QBO_TARGETED_SOURCE_PAYLOAD_AUDIT_.VERSION + ' | sourceId=' + sourceId);

  const ss = getQboStateCaptureSpreadsheet_();

  // 01: authoritative source lineage.
  const sourceSheet = qboTargetAuditRequireSheet_(ss, QBO_TARGETED_SOURCE_PAYLOAD_AUDIT_.SOURCE_SHEET);
  const sources = loadQboStateCaptureWriteSources_(sourceSheet, '');
  const sourceMatches = sources.filter(function(s) { return String(s.sourceId || '') === sourceId; });
  if (sourceMatches.length !== 1) {
    throw new Error('TARGETED_PAYLOAD_AUDIT_01_SOURCE_CARDINALITY sourceId=' +
      sourceId + ' count=' + sourceMatches.length);
  }
  const source = sourceMatches[0];
  if (!source.masterBackupFileId) {
    throw new Error('TARGETED_PAYLOAD_AUDIT_SOURCE_EVIDENCE_FILE_ID_MISSING sourceId=' + sourceId);
  }

  const manifest = getQboExportManifestEntry_(source.exportKey);
  if (!manifest) {
    throw new Error('TARGETED_PAYLOAD_AUDIT_UNKNOWN_EXPORT exportKey=' + source.exportKey);
  }

  // Independently establish the source observation population using the exact
  // same parent-row definition governed by FULL_EXPORT forward ingestion:
  // every data row after the header in the manifest parent sheet.
  const sourceSs = SpreadsheetApp.openById(String(source.masterBackupFileId));
  const sourceParentSheetName = manifest.sheetNames[0];
  const sourceParentSheet = sourceSs.getSheetByName(sourceParentSheetName);
  if (!sourceParentSheet) {
    throw new Error('TARGETED_PAYLOAD_AUDIT_SOURCE_PARENT_SHEET_MISSING sheet=' +
      sourceParentSheetName);
  }
  const sourceLastRow = sourceParentSheet.getLastRow();
  const sourceLastCol = sourceParentSheet.getLastColumn();
  if (sourceLastRow < 1 || sourceLastCol < 1) {
    throw new Error('TARGETED_PAYLOAD_AUDIT_SOURCE_PARENT_SHEET_EMPTY sheet=' +
      sourceParentSheetName);
  }

  const sourceHeaders = sourceParentSheet.getRange(1, 1, 1, sourceLastCol)
    .getValues()[0].map(function(v) { return String(v || '').trim(); });
  const sourceHeaderIndex = qboTargetAuditHeaderIndex_(sourceHeaders);
  const entityIdHeader = QBO_STATE_CAPTURE_ENTITY_ID_HEADERS_[source.exportKey] ||
    manifest.entityIdHeader || 'Id';
  if (sourceHeaderIndex.RawJSON === undefined ||
      sourceHeaderIndex[entityIdHeader] === undefined) {
    throw new Error('TARGETED_PAYLOAD_AUDIT_SOURCE_REQUIRED_COLUMNS_MISSING');
  }

  const sourceObservationCount = Math.max(0, sourceLastRow - 1);
  let sourceBlankEntityIdCount = 0;
  if (sourceObservationCount > 0) {
    const ids = sourceParentSheet
      .getRange(2, sourceHeaderIndex[entityIdHeader] + 1, sourceObservationCount, 1)
      .getValues();
    ids.forEach(function(r) {
      if (!String(r[0] || '').trim()) sourceBlankEntityIdCount++;
    });
  }

  // 05: exact source aggregate row.
  const controlSheet = qboTargetAuditRequireSheet_(ss, QBO_TARGETED_SOURCE_PAYLOAD_AUDIT_.CONTROL_SHEET);
  const controlRows = qboTargetAuditReadSheetObjects_(controlSheet);
  const controlMatches = controlRows.filter(function(r) {
    return String(r.IngestionSourceId || '') === sourceId;
  });

  // 06: every currently-ledgered physical shard for this exact source.
  const artifactSheet = qboTargetAuditRequireSheet_(ss, QBO_TARGETED_SOURCE_PAYLOAD_AUDIT_.ARTIFACT_SHEET);
  const artifactRows = qboTargetAuditReadSheetObjects_(artifactSheet);
  const targetArtifacts = artifactRows.filter(function(r) {
    return String(r.IngestionSourceId || '') === sourceId;
  });

  const ledgerDeclared = {
    rowCount: targetArtifacts.length,
    observationCount: 0,
    payloadCount: 0,
    fileIds: Object.create(null),
    hashes: Object.create(null)
  };
  let duplicateLedgerFileIdCount = 0;
  let duplicateLedgerHashCount = 0;

  targetArtifacts.forEach(function(r) {
    ledgerDeclared.observationCount += qboTargetAuditNumber_(r.ObservationCount);
    ledgerDeclared.payloadCount += qboTargetAuditNumber_(r.PayloadCount);
    const fileId = String(r.PayloadFileId || '').trim();
    const hash = String(r.PayloadShardHash || '').trim();
    if (fileId) {
      if (ledgerDeclared.fileIds[fileId]) duplicateLedgerFileIdCount++;
      ledgerDeclared.fileIds[fileId] = true;
    }
    if (hash) {
      if (ledgerDeclared.hashes[hash]) duplicateLedgerHashCount++;
      ledgerDeclared.hashes[hash] = true;
    }
  });

  // Physical payload verification. 06 is used only to identify the exact
  // physical files. Every identified file is reopened and its JSON is counted
  // independently; 06 declared counts are not trusted for physical totals.
  const actual = {
    shardCount: 0,
    stableBodyObservationCount: 0,
    payloadArrayCount: 0,
    observationIdsArrayCount: 0,
    uniqueObservationIdCount: 0,
    duplicateObservationIdCount: 0,
    invalidJsonCount: 0,
    missingFileCount: 0,
    sourceIdMismatchCount: 0,
    schemaMismatchCount: 0,
    filenameHashMismatchCount: 0,
    envelopeHashMismatchCount: 0,
    internalCountMismatchCount: 0,
    cursorIntervals: []
  };
  const observationIds = Object.create(null);
  const shardDetails = [];

  targetArtifacts.forEach(function(r, i) {
    const fileId = String(r.PayloadFileId || '').trim();
    const ledgerFileName = String(r.PayloadFileName || '').trim();
    const ledgerHash = String(r.PayloadShardHash || '').trim();
    let file;
    try {
      file = DriveApp.getFileById(fileId);
    } catch (error) {
      actual.missingFileCount++;
      shardDetails.push({
        ledgerRowNumber: r._rowNumber,
        fileId: fileId,
        status: 'MISSING_FILE'
      });
      return;
    }

    let envelope;
    try {
      envelope = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
    } catch (error) {
      actual.invalidJsonCount++;
      shardDetails.push({
        ledgerRowNumber: r._rowNumber,
        fileId: fileId,
        fileName: file.getName(),
        status: 'INVALID_JSON'
      });
      return;
    }

    actual.shardCount++;
    const stableBody = envelope && envelope.stableBody || {};
    const payloads = Array.isArray(stableBody.payloads) ? stableBody.payloads : [];
    const ids = Array.isArray(stableBody.observationIds) ? stableBody.observationIds : [];
    const declaredObs = qboTargetAuditNumber_(stableBody.observationCount);

    actual.stableBodyObservationCount += declaredObs;
    actual.payloadArrayCount += payloads.length;
    actual.observationIdsArrayCount += ids.length;

    if (String(stableBody.sourceId || '') !== sourceId) actual.sourceIdMismatchCount++;
    if (String(envelope.schemaVersion || '') !== QBO_TARGETED_SOURCE_PAYLOAD_AUDIT_.SHARD_SCHEMA_VERSION ||
        String(stableBody.schemaVersion || '') !== QBO_TARGETED_SOURCE_PAYLOAD_AUDIT_.SHARD_SCHEMA_VERSION) {
      actual.schemaMismatchCount++;
    }

    const stableJson = qboCanonicalStableStringify_(stableBody);
    const recomputedHash = qboStateCaptureAuditSha256_(stableJson);
    const expectedFileName = QBO_TARGETED_SOURCE_PAYLOAD_AUDIT_.FILE_PREFIX + recomputedHash + '.json';
    if (file.getName() !== expectedFileName ||
        (ledgerFileName && ledgerFileName !== expectedFileName) ||
        (ledgerHash && ledgerHash !== recomputedHash)) {
      actual.filenameHashMismatchCount++;
    }
    if (String(envelope.shardHash || '') !== recomputedHash) {
      actual.envelopeHashMismatchCount++;
    }

    if (declaredObs !== payloads.length || declaredObs !== ids.length) {
      actual.internalCountMismatchCount++;
    }

    payloads.forEach(function(p, pIndex) {
      const id = String(p && p.observationId || '');
      const listedId = String(ids[pIndex] || '');
      if (!id || id !== listedId) actual.internalCountMismatchCount++;
      if (id) {
        if (observationIds[id]) actual.duplicateObservationIdCount++;
        else observationIds[id] = true;
      }
    });

    const start = qboTargetAuditNullableNumber_(stableBody.recordCursorStart);
    const end = qboTargetAuditNullableNumber_(stableBody.recordCursorEndExclusive);
    if (start !== null && end !== null) {
      actual.cursorIntervals.push({
        start: start,
        end: end,
        count: declaredObs,
        fileId: fileId,
        fileName: file.getName(),
        workUnitId: String(stableBody.workUnitId || ''),
        ingestionRunId: String(stableBody.ingestionRunId || '')
      });
    }

    shardDetails.push({
      ledgerRowNumber: r._rowNumber,
      fileId: fileId,
      fileName: file.getName(),
      cursorStart: start,
      cursorEndExclusive: end,
      observationCount: declaredObs,
      payloadCount: payloads.length,
      shardHash: recomputedHash,
      status: 'VERIFIED'
    });

    if ((i + 1) % 25 === 0) {
      console.log('[TARGETED PAYLOAD AUDIT] | PHYSICAL_PROGRESS | sourceId=' +
        sourceId + ' | verified=' + (i + 1) + '/' + targetArtifacts.length);
    }
  });

  actual.uniqueObservationIdCount = Object.keys(observationIds).length;

  // Cursor population integrity.
  actual.cursorIntervals.sort(function(a, b) {
    return a.start - b.start || a.end - b.end || a.fileId.localeCompare(b.fileId);
  });
  let cursorGapCount = 0;
  let cursorOverlapCount = 0;
  let cursorDuplicateIntervalCount = 0;
  const intervalKeys = Object.create(null);
  let expectedCursor = 0;

  actual.cursorIntervals.forEach(function(iv) {
    const key = iv.start + '|' + iv.end;
    if (intervalKeys[key]) cursorDuplicateIntervalCount++;
    intervalKeys[key] = true;

    if (iv.start > expectedCursor) cursorGapCount++;
    if (iv.start < expectedCursor) cursorOverlapCount++;
    if (iv.end > expectedCursor) expectedCursor = iv.end;
  });

  const control = controlMatches.length === 1 ? controlMatches[0] : null;
  const controlObservationCount = control ? qboTargetAuditNumber_(control.ObservationCount) : null;
  const controlPayloadCount = control ? qboTargetAuditNumber_(control.PayloadCount) : null;
  const controlShardCount = control ? qboTargetAuditNumber_(control.ShardCount) : null;

  const checks = {
    exactlyOne01Source: sourceMatches.length === 1,
    sourceHasNoBlankEntityIds: sourceBlankEntityIdCount === 0,
    exactlyOne05Row: controlMatches.length === 1,
    sourceVs05ObservationCount:
      controlObservationCount !== null && sourceObservationCount === controlObservationCount,
    sourceVs06DeclaredObservationCount:
      sourceObservationCount === ledgerDeclared.observationCount,
    sourceVsActualStableBodyObservationCount:
      sourceObservationCount === actual.stableBodyObservationCount,
    sourceVsActualPayloadArrayCount:
      sourceObservationCount === actual.payloadArrayCount,
    sourceVsUniqueObservationIds:
      sourceObservationCount === actual.uniqueObservationIdCount,
    ledgerDeclaredVsActualPayloadArrayCount:
      ledgerDeclared.payloadCount === actual.payloadArrayCount,
    ledgerShardCountVsPhysicalShardCount:
      targetArtifacts.length === actual.shardCount,
    controlPayloadCountVsActualPayloadArrayCount:
      controlPayloadCount !== null && controlPayloadCount === actual.payloadArrayCount,
    controlShardCountVsPhysicalShardCount:
      controlShardCount !== null && controlShardCount === actual.shardCount,
    noDuplicateObservationIds: actual.duplicateObservationIdCount === 0,
    noDuplicateLedgerFileIds: duplicateLedgerFileIdCount === 0,
    noDuplicateLedgerHashes: duplicateLedgerHashCount === 0,
    noMissingPhysicalFiles: actual.missingFileCount === 0,
    noInvalidPayloadJson: actual.invalidJsonCount === 0,
    allPhysicalSourceIdsExact: actual.sourceIdMismatchCount === 0,
    allShardSchemasExact: actual.schemaMismatchCount === 0,
    allFilenameAndLedgerHashesExact: actual.filenameHashMismatchCount === 0,
    allEnvelopeHashesExact: actual.envelopeHashMismatchCount === 0,
    allInternalCountsExact: actual.internalCountMismatchCount === 0,
    noCursorGaps: cursorGapCount === 0,
    noCursorOverlaps: cursorOverlapCount === 0,
    noDuplicateCursorIntervals: cursorDuplicateIntervalCount === 0,
    cursorPopulationEndsAtSourceCount:
      expectedCursor === sourceObservationCount
  };

  const failedChecks = Object.keys(checks).filter(function(k) { return !checks[k]; });
  const status = failedChecks.length === 0 ? 'VALID' : 'INVALID';

  const result = {
    version: QBO_TARGETED_SOURCE_PAYLOAD_AUDIT_.VERSION,
    status: status,
    readOnly: true,
    sourceId: sourceId,
    exportKey: source.exportKey,
    sourceRunId: source.sourceRunId,
    sourceEvidence: {
      fileId: source.masterBackupFileId,
      fileName: source.masterBackupFileName,
      parentSheetName: sourceParentSheetName,
      observationDefinition: 'PARENT_DATA_ROWS_AFTER_HEADER',
      observationCount: sourceObservationCount,
      blankEntityIdCount: sourceBlankEntityIdCount
    },
    control05: {
      matchingRowCount: controlMatches.length,
      observationCount: controlObservationCount,
      payloadCount: controlPayloadCount,
      shardCount: controlShardCount,
      recordCursor: control ? qboTargetAuditNumber_(control.RecordCursor) : null,
      processingStatus: control ? String(control.ProcessingStatus || '') : ''
    },
    ledger06: {
      matchingArtifactRowCount: targetArtifacts.length,
      declaredObservationCount: ledgerDeclared.observationCount,
      declaredPayloadCount: ledgerDeclared.payloadCount,
      duplicateFileIdCount: duplicateLedgerFileIdCount,
      duplicateHashCount: duplicateLedgerHashCount
    },
    physicalPayloads: {
      verifiedShardCount: actual.shardCount,
      stableBodyObservationCount: actual.stableBodyObservationCount,
      payloadArrayCount: actual.payloadArrayCount,
      observationIdsArrayCount: actual.observationIdsArrayCount,
      uniqueObservationIdCount: actual.uniqueObservationIdCount,
      duplicateObservationIdCount: actual.duplicateObservationIdCount,
      missingFileCount: actual.missingFileCount,
      invalidJsonCount: actual.invalidJsonCount,
      sourceIdMismatchCount: actual.sourceIdMismatchCount,
      schemaMismatchCount: actual.schemaMismatchCount,
      filenameHashMismatchCount: actual.filenameHashMismatchCount,
      envelopeHashMismatchCount: actual.envelopeHashMismatchCount,
      internalCountMismatchCount: actual.internalCountMismatchCount
    },
    cursorAudit: {
      intervalCount: actual.cursorIntervals.length,
      gapCount: cursorGapCount,
      overlapCount: cursorOverlapCount,
      duplicateIntervalCount: cursorDuplicateIntervalCount,
      terminalCursor: expectedCursor,
      sourceObservationCount: sourceObservationCount
    },
    checks: checks,
    failedChecks: failedChecks,
    startedAt: startedAt,
    completedAt: new Date().toISOString()
  };

  console.log('[TARGETED PAYLOAD AUDIT] | RESULT | ' + JSON.stringify(result));
  console.log('[TARGETED PAYLOAD AUDIT] | SHARDS | ' + JSON.stringify(shardDetails));
  return result;
}

function qboTargetAuditRequireSheet_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('TARGETED_PAYLOAD_AUDIT_SHEET_NOT_FOUND ' + sheetName);
  return sheet;
}

function qboTargetAuditReadSheetObjects_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return [];
  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(function(v) { return String(v || '').trim(); });
  return values.slice(1).map(function(row, i) {
    const out = {_rowNumber: i + 2};
    headers.forEach(function(h, c) { if (h) out[h] = row[c]; });
    return out;
  });
}

function qboTargetAuditHeaderIndex_(headers) {
  const out = Object.create(null);
  headers.forEach(function(h, i) { out[String(h || '').trim()] = i; });
  return out;
}

function qboTargetAuditNumber_(value) {
  if (value === '' || value === null || value === undefined) return 0;
  const n = Number(value);
  if (!isFinite(n)) throw new Error('TARGETED_PAYLOAD_AUDIT_NON_NUMERIC_VALUE value=' + value);
  return n;
}

function qboTargetAuditNullableNumber_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return isFinite(n) ? n : null;
}
