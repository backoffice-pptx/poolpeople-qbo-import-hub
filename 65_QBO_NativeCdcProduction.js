/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 65_QBO_NativeCdcProduction.js
 * Purpose     : Production QBO Native CDC source-evidence acquisition.
 *
 * Public API:
 *   - runQboNativeCdcProduction()
 *   - testQboNativeCdcProductionConfiguration()
 *
 * Phase 1 boundary:
 *   - Persists source CDC response evidence and a run manifest.
 *   - Maintains a durable successful watermark with overlap.
 *   - Does NOT create Captured-State Snapshot Records, Change Records, or
 *     Change Detail. Those belong to a later controlled processing phase.
 * ============================================================================
 */

function testQboNativeCdcProductionConfiguration() {
  const folder = qboNativeCdcResolveEvidenceFolder_();
  const result = {
    ok: true,
    assetKey: QBO_NATIVE_CDC_PRODUCTION.EVIDENCE_FOLDER_ASSET_KEY,
    folderId: folder.getId(),
    folderName: folder.getName(),
    entityCount: QBO_NATIVE_CDC_PRODUCTION.ENTITIES.length,
    initialLookbackDays: QBO_NATIVE_CDC_PRODUCTION.INITIAL_LOOKBACK_DAYS,
    overlapMinutes: QBO_NATIVE_CDC_PRODUCTION.OVERLAP_MINUTES
  };
  console.log('[NATIVE CDC PROD] | CONFIG OK | ' + JSON.stringify(result, null, 2));
  return result;
}

function runQboNativeCdcProduction() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(QBO_NATIVE_CDC_PRODUCTION.EXECUTION_LOCK_TIMEOUT_MS)) {
    throw new Error(
      'Unable to acquire Native CDC production execution lock within ' +
      QBO_NATIVE_CDC_PRODUCTION.EXECUTION_LOCK_TIMEOUT_MS + ' ms.'
    );
  }

  try {
    return qboNativeCdcRunProductionLocked_();
  } finally {
    lock.releaseLock();
  }
}

function qboNativeCdcRunProductionLocked_() {
  const started = new Date();
  const runId = Utilities.getUuid();
  const cfg = getConfig_();
  const evidenceFolder = qboNativeCdcResolveEvidenceFolder_();
  const window = qboNativeCdcBuildWindow_(started);
  const runFolderName = QBO_NATIVE_CDC_PRODUCTION.RUN_FOLDER_PREFIX +
    Utilities.formatDate(started, 'UTC', 'yyyyMMdd_HHmmss_SSS') + '_' + runId;
  const runFolder = evidenceFolder.createFolder(runFolderName);

  const manifest = {
    version: QBO_NATIVE_CDC_PRODUCTION.VERSION,
    cdcRunId: runId,
    status: 'STARTED',
    runStartedAt: started.toISOString(),
    runCompletedAt: null,
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
    initialRun: window.initialRun,
    initialLookbackDays: window.initialRun ? QBO_NATIVE_CDC_PRODUCTION.INITIAL_LOOKBACK_DAYS : null,
    overlapMinutes: window.initialRun ? 0 : QBO_NATIVE_CDC_PRODUCTION.OVERLAP_MINUTES,
    priorSuccessfulWatermark: window.priorSuccessfulWatermark,
    entityTypesRequested: QBO_NATIVE_CDC_PRODUCTION.ENTITIES.slice(),
    entityTypesSucceeded: [],
    entityTypesFailed: [],
    returnedEntityCount: 0,
    liveEntityCount: 0,
    deletedEntityCount: 0,
    source: 'QBO_NATIVE_CDC',
    minorVersion: String(cfg.minorVersion),
    evidenceFolderId: evidenceFolder.getId(),
    runFolderId: runFolder.getId(),
    runFolderName: runFolderName,
    watermarkCommitted: false,
    committedWatermark: null,
    entityEvidence: [],
    errors: []
  };

  console.log(
    '[NATIVE CDC PROD] | START | run=' + runId +
    ' | window=' + manifest.windowStart + '..' + manifest.windowEnd +
    ' | initial=' + manifest.initialRun
  );

  QBO_NATIVE_CDC_PRODUCTION.ENTITIES.forEach(function(entityName) {
    const fileName = QBO_NATIVE_CDC_PRODUCTION.ENTITY_FILE_PREFIX + entityName + '.json';
    try {
      const entityRequestStartedAt = new Date();
      const response = qboNativeCdcRequestEntity_(entityName, window.start, cfg.minorVersion);
      const entityRequestCompletedAt = new Date();
      const entities = qboNativeCdcProductionExtractEntities_(response, entityName);
      const deletedCount = entities.filter(function(entity) {
        return entity && String(entity.status || '').toLowerCase() === 'deleted';
      }).length;
      const liveCount = entities.length - deletedCount;
      const json = JSON.stringify(response, null, 2);
      const file = runFolder.createFile(fileName, json, 'application/json');

      manifest.entityTypesSucceeded.push(entityName);
      manifest.returnedEntityCount += entities.length;
      manifest.liveEntityCount += liveCount;
      manifest.deletedEntityCount += deletedCount;
      manifest.entityEvidence.push({
        entity: entityName,
        status: 'SUCCESS',
        returnedEntityCount: entities.length,
        liveEntityCount: liveCount,
        deletedEntityCount: deletedCount,
        evidenceFileId: file.getId(),
        evidenceFileName: fileName,
        payloadSha256: qboNativeCdcSha256_(json),
        requestStartedAt: entityRequestStartedAt.toISOString(),
        requestCompletedAt: entityRequestCompletedAt.toISOString(),
        qboResponseTime: response && response.time ? String(response.time) : null
      });

      console.log(
        '[NATIVE CDC PROD] | ENTITY COMPLETE | run=' + runId +
        ' | entity=' + entityName + ' | count=' + entities.length +
        ' | deleted=' + deletedCount
      );
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      manifest.entityTypesFailed.push(entityName);
      manifest.errors.push({ entity: entityName, error: message });
      manifest.entityEvidence.push({ entity: entityName, status: 'FAILED', error: message });
      console.error(
        '[NATIVE CDC PROD] | ENTITY FAILED | run=' + runId +
        ' | entity=' + entityName + ' | error=' + message
      );
    }
  });

  const completed = new Date();
  manifest.runCompletedAt = completed.toISOString();

  if (manifest.entityTypesFailed.length === 0) {
    manifest.status = 'SUCCESS';
  } else if (manifest.entityTypesSucceeded.length > 0) {
    manifest.status = 'PARTIAL';
  } else {
    manifest.status = 'FAILED';
  }

  // Persist the complete run evidence BEFORE advancing the durable watermark.
  // A manifest-write failure therefore cannot create an un-evidenced watermark.
  const manifestFile = runFolder.createFile(
    QBO_NATIVE_CDC_PRODUCTION.MANIFEST_FILE_NAME,
    JSON.stringify(manifest, null, 2),
    'application/json'
  );

  if (manifest.status === 'SUCCESS') {
    // Commit the conservative acquisition boundary captured at run start.
    // QBO CDC has changedSince but no end parameter, so individual entity
    // responses may also contain changes occurring while this run is executing.
    // The next run subtracts overlap from this boundary, preventing a gap.
    PropertiesService.getScriptProperties().setProperty(
      QBO_NATIVE_CDC_PRODUCTION.WATERMARK_PROPERTY_KEY,
      window.end.toISOString()
    );
    manifest.watermarkCommitted = true;
    manifest.committedWatermark = window.end.toISOString();

    // Best-effort final manifest annotation. The immutable entity evidence and
    // complete pre-commit manifest already exist before the watermark changes.
    try {
      manifestFile.setContent(JSON.stringify(manifest, null, 2));
    } catch (manifestUpdateError) {
      console.error(
        '[NATIVE CDC PROD] | MANIFEST COMMIT ANNOTATION FAILED | run=' + runId +
        ' | manifestFileId=' + manifestFile.getId() +
        ' | error=' + (manifestUpdateError && manifestUpdateError.message
          ? manifestUpdateError.message : String(manifestUpdateError))
      );
    }
  }

  console.log(
    '[NATIVE CDC PROD] | COMPLETE | run=' + runId +
    ' | status=' + manifest.status +
    ' | returned=' + manifest.returnedEntityCount +
    ' | deleted=' + manifest.deletedEntityCount +
    ' | watermarkCommitted=' + manifest.watermarkCommitted +
    ' | manifestFileId=' + manifestFile.getId()
  );

  if (manifest.status !== 'SUCCESS') {
    throw new Error(
      'QBO Native CDC production run ' + runId + ' ended ' + manifest.status +
      '. Successful watermark was NOT advanced. Review manifest file ID ' + manifestFile.getId() + '.'
    );
  }

  return manifest;
}

function qboNativeCdcBuildWindow_(startedAt) {
  const props = PropertiesService.getScriptProperties();
  const rawWatermark = String(
    props.getProperty(QBO_NATIVE_CDC_PRODUCTION.WATERMARK_PROPERTY_KEY) || ''
  ).trim();
  const end = new Date(startedAt.getTime());

  if (!rawWatermark) {
    return {
      start: new Date(end.getTime() - QBO_NATIVE_CDC_PRODUCTION.INITIAL_LOOKBACK_DAYS * 86400000),
      end: end,
      initialRun: true,
      priorSuccessfulWatermark: null
    };
  }

  const watermark = new Date(rawWatermark);
  if (isNaN(watermark.getTime())) {
    throw new Error(
      'Invalid durable Native CDC watermark in Script Property ' +
      QBO_NATIVE_CDC_PRODUCTION.WATERMARK_PROPERTY_KEY + ': ' + rawWatermark
    );
  }
  if (watermark.getTime() > end.getTime()) {
    throw new Error('Native CDC successful watermark is in the future: ' + rawWatermark);
  }

  const start = new Date(
    watermark.getTime() - QBO_NATIVE_CDC_PRODUCTION.OVERLAP_MINUTES * 60000
  );
  const oldestAllowed = new Date(
    end.getTime() - QBO_NATIVE_CDC_PRODUCTION.MAX_CDC_LOOKBACK_DAYS * 86400000
  );
  if (start.getTime() < oldestAllowed.getTime()) {
    throw new Error(
      'Native CDC recovery window exceeds the configured ' +
      QBO_NATIVE_CDC_PRODUCTION.MAX_CDC_LOOKBACK_DAYS +
      '-day source limit. Last successful watermark=' + watermark.toISOString() +
      '. Do not advance the watermark manually; use the governed recovery process.'
    );
  }

  return {
    start: start,
    end: end,
    initialRun: false,
    priorSuccessfulWatermark: watermark.toISOString()
  };
}

function qboNativeCdcRequestEntity_(entityName, changedSince, minorVersion) {
  const path =
    'cdc?entities=' + encodeURIComponent(entityName) +
    '&changedSince=' + encodeURIComponent(changedSince.toISOString()) +
    '&minorversion=' + encodeURIComponent(String(minorVersion));
  return qboGet_(path);
}

function qboNativeCdcProductionExtractEntities_(response, entityName) {
  const output = [];
  const cdcResponses = Array.isArray(response && response.CDCResponse)
    ? response.CDCResponse
    : (response && response.CDCResponse ? [response.CDCResponse] : []);

  cdcResponses.forEach(function(cdcResponse) {
    const queryResponses = Array.isArray(cdcResponse && cdcResponse.QueryResponse)
      ? cdcResponse.QueryResponse
      : (cdcResponse && cdcResponse.QueryResponse ? [cdcResponse.QueryResponse] : []);

    queryResponses.forEach(function(queryResponse) {
      const raw = queryResponse && queryResponse[entityName];
      const entities = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      entities.forEach(function(entity) {
        if (entity && typeof entity === 'object') output.push(entity);
      });
    });
  });

  return output;
}

function qboNativeCdcResolveEvidenceFolder_() {
  if (typeof DataPlatform05 === 'undefined' ||
      typeof DataPlatform05.getConfiguredAssetReference !== 'function') {
    throw new Error(
      'Application 05 library DataPlatform05 is unavailable. Cannot resolve governed asset ' +
      QBO_NATIVE_CDC_PRODUCTION.EVIDENCE_FOLDER_ASSET_KEY + '.'
    );
  }

  const asset = DataPlatform05.getConfiguredAssetReference(
    QBO_NATIVE_CDC_PRODUCTION.EVIDENCE_FOLDER_ASSET_KEY,
    QBO_NATIVE_CDC_PRODUCTION.EVIDENCE_FOLDER_EXPECTED_TYPE,
    QBO_NATIVE_CDC_PRODUCTION.ENVIRONMENT
  );
  const folderId = asset && String(asset.ResourceIdentifier || '').trim();
  if (!folderId) {
    throw new Error(
      'Application 05 returned no ResourceIdentifier for governed asset ' +
      QBO_NATIVE_CDC_PRODUCTION.EVIDENCE_FOLDER_ASSET_KEY + '.'
    );
  }

  try {
    return DriveApp.getFolderById(folderId);
  } catch (error) {
    throw new Error(
      'Unable to open governed Native CDC evidence folder ' + folderId + ': ' +
      (error && error.message ? error.message : String(error))
    );
  }
}

function qboNativeCdcSha256_(text) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    text,
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(value) {
    const unsigned = value < 0 ? value + 256 : value;
    return ('0' + unsigned.toString(16)).slice(-2);
  }).join('');
}
