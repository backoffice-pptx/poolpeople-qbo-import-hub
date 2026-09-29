/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 127_QBO_NativeCdcSourceLedgerV2Backfill.js
 * Version     : 1.5.105
 * Purpose     : Controlled historical reconstruction/backfill of the governed
 *               Native CDC source-specific evidence ledgers:
 *                 02_CDC_Run_Manifest_V2
 *                 03_Native_CDC_Events_V2
 *
 * Controls:
 *   - Authoritative input is immutable committed Native CDC Drive evidence.
 *   - Current 05/06 are reconciliation/corroboration only; never source authority.
 *   - No source evidence, 01, 05, 06, payload, State Application, trigger, or
 *     Script Property mutation.
 *   - V1 02/03 are not overwritten. V2 coexists until Gate A validation/cutover.
 *   - Idempotent by CdcRunId (02) and NativeCdcEventId (03).
 *   - Historical recovery may legitimately have blank request timestamps.
 *   - ObservedAt = entity requestCompletedAt, with committed runCompletedAt as
 *     governed fallback when recovery evidence lacks request timestamps.
 * ============================================================================
 */

const QBO_NATIVE_CDC_SOURCE_LEDGER_V2_ = Object.freeze({
  VERSION: 'QBO_NATIVE_CDC_SOURCE_LEDGER_V2_BACKFILL_V1_5_105',
  SHEET02: '02_CDC_Run_Manifest_V2',
  SHEET03: '03_Native_CDC_Events_V2',
  REGISTRATION_MODE: 'HISTORICAL_BACKFILL',
  HEADERS02: Object.freeze([
    'CdcRunId','SourceAcquisitionType','RunStartedAt','RunCompletedAt','WindowStart','WindowEnd',
    'InitialRun','InitialLookbackDays','OverlapMinutes','PriorSuccessfulWatermark','CommittedWatermark',
    'WatermarkCommitted','EntityTypesRequested','CompletedEntityCount','ReturnedEntityCount',
    'LiveEntityCount','DeletedEntityCount','AcquisitionStatus','ManifestFileId','ManifestFileName',
    'ManifestHash','RunFolderId','RunFolderName','MinorVersion','CodeVersion','EvidenceCreatedAt',
    'RegistrationMode','RegisteredAt'
  ]),
  HEADERS03: Object.freeze([
    'NativeCdcEventId','CdcRunId','SourceId','EntityRunId','EntityType','EvidenceIndex','EntityId',
    'Operation','QboStatus','DeletedFlag','QboSyncToken','QboCreateTime','QboLastUpdatedTime',
    'ObservedAt','SourceChangeTime','SparseFlag','EvidenceFileId','EvidenceFileName','EvidenceHash',
    'EvidenceHashType','RequestStartedAt','RequestCompletedAt','QboResponseTime','RawEntityHash',
    'EvidenceStatus','EligibilityStatus','EligibilityReason','EvidenceCreatedAt','RegistrationMode',
    'RegisteredAt'
  ])
});

function previewQboNativeCdcSourceLedgerV2Backfill() {
  const built = qboNativeCdcSourceLedgerV2Build_();
  const result = qboNativeCdcSourceLedgerV2Summary_(built, false);
  console.log('[NATIVE CDC SOURCE LEDGER V2] | PREVIEW | ' + JSON.stringify(result));
  return result;
}

function backfillQboNativeCdcSourceLedgerV2() {
  const built = qboNativeCdcSourceLedgerV2Build_();
  const ss = getQboStateCaptureSpreadsheet_();
  const sheet02 = qboNativeCdcSourceLedgerV2EnsureSheet_(ss, QBO_NATIVE_CDC_SOURCE_LEDGER_V2_.SHEET02, QBO_NATIVE_CDC_SOURCE_LEDGER_V2_.HEADERS02);
  const sheet03 = qboNativeCdcSourceLedgerV2EnsureSheet_(ss, QBO_NATIVE_CDC_SOURCE_LEDGER_V2_.SHEET03, QBO_NATIVE_CDC_SOURCE_LEDGER_V2_.HEADERS03);

  const existing02 = qboNativeCdcSourceLedgerV2ExistingKeys_(sheet02, 1);
  const existing03 = qboNativeCdcSourceLedgerV2ExistingKeys_(sheet03, 1);
  const new02 = built.rows02.filter(function(row) { return !existing02[row[0]]; });
  const new03 = built.rows03.filter(function(row) { return !existing03[row[0]]; });

  qboNativeCdcSourceLedgerV2Append_(sheet02, new02);
  qboNativeCdcSourceLedgerV2Append_(sheet03, new03);

  const result = qboNativeCdcSourceLedgerV2Summary_(built, true);
  result.sheet02ExistingBefore = Object.keys(existing02).length;
  result.sheet03ExistingBefore = Object.keys(existing03).length;
  result.sheet02Inserted = new02.length;
  result.sheet03Inserted = new03.length;
  result.sheet02RowCountAfter = Math.max(0, sheet02.getLastRow() - 1);
  result.sheet03RowCountAfter = Math.max(0, sheet03.getLastRow() - 1);
  result.idempotentNoDuplicateKeys = result.sheet02RowCountAfter === built.rows02.length &&
    result.sheet03RowCountAfter === built.rows03.length;
  if (!result.idempotentNoDuplicateKeys) {
    throw new Error('NATIVE_CDC_SOURCE_LEDGER_V2_POST_WRITE_COUNT_MISMATCH ' + JSON.stringify(result));
  }
  console.log('[NATIVE CDC SOURCE LEDGER V2] | BACKFILL COMPLETE | ' + JSON.stringify(result));
  return result;
}

function qboNativeCdcSourceLedgerV2Build_() {
  const root = qboNativeCdcResolveEvidenceFolder_();
  const folders = qboNativeCdcListRunFoldersForDiscovery_(root);
  const rows02 = [], rows03 = [], findings = [];
  const seenCycle = Object.create(null), seenEvent = Object.create(null);
  let committedManifestCount = 0, totalEvidenceUnits = 0, zeroObservationEvidenceUnits = 0;
  let eligibleEventCount = 0, ineligibleEventCount = 0, fallbackObservedAtCount = 0;
  let expectedReturned = 0, actualReturned = 0, expectedLive = 0, actualLive = 0;
  let expectedDeleted = 0, actualDeleted = 0;

  folders.forEach(function(folder) {
    const files = folder.getFilesByName(QBO_NATIVE_CDC_PRODUCTION.MANIFEST_FILE_NAME);
    if (!files.hasNext()) return;
    const manifestFile = files.next();
    if (files.hasNext()) throw new Error('NATIVE_CDC_SOURCE_LEDGER_V2_DUPLICATE_MANIFEST folderId=' + folder.getId());

    const manifestText = manifestFile.getBlob().getDataAsString('UTF-8');
    let manifest;
    try { manifest = JSON.parse(manifestText); }
    catch (error) {
      findings.push({type:'INVALID_MANIFEST_JSON', manifestFileId:manifestFile.getId(), folderId:folder.getId()});
      return;
    }
    if (String(manifest.status || '') !== 'SUCCESS' || manifest.watermarkCommitted !== true) return;

    const cycleId = String(manifest.cycleId || '').trim();
    if (!cycleId) throw new Error('NATIVE_CDC_SOURCE_LEDGER_V2_COMMITTED_MANIFEST_MISSING_CYCLE_ID fileId=' + manifestFile.getId());
    if (seenCycle[cycleId]) throw new Error('NATIVE_CDC_SOURCE_LEDGER_V2_DUPLICATE_CYCLE_ID ' + cycleId);
    seenCycle[cycleId] = true;
    committedManifestCount += 1;

    const evidence = Array.isArray(manifest.entityEvidence) ? manifest.entityEvidence : [];
    if (evidence.length !== QBO_NATIVE_CDC_PRODUCTION.ENTITIES.length) {
      throw new Error('NATIVE_CDC_SOURCE_LEDGER_V2_ENTITY_EVIDENCE_COUNT_MISMATCH cycle=' + cycleId + ' count=' + evidence.length);
    }

    const minorVersions = Object.create(null);
    evidence.forEach(function(meta) {
      const mv = String(meta.minorVersion || '').trim();
      if (mv) minorVersions[mv] = true;
    });
    const minorVersionList = Object.keys(minorVersions).sort();
    const minorVersion = minorVersionList.length === 1 ? minorVersionList[0] : minorVersionList.join(',');
    const registeredAt = new Date().toISOString();
    const manifestCreatedAt = qboNativeCdcSourceLedgerV2FileCreatedAt_(manifestFile);
    const manifestHash = qboStateCaptureAuditSha256_(manifestText);

    rows02.push([
      cycleId,
      'NATIVE_CDC',
      String(manifest.runStartedAt || ''),
      String(manifest.runCompletedAt || ''),
      String(manifest.windowStart || ''),
      String(manifest.windowEnd || ''),
      manifest.initialRun === true,
      manifest.initialLookbackDays == null ? '' : Number(manifest.initialLookbackDays),
      manifest.overlapMinutes == null ? '' : Number(manifest.overlapMinutes),
      String(manifest.priorSuccessfulWatermark || ''),
      String(manifest.committedWatermark || ''),
      manifest.watermarkCommitted === true,
      JSON.stringify(Array.isArray(manifest.entityTypesRequested) ? manifest.entityTypesRequested : []),
      Number(manifest.completedEntityCount || 0),
      Number(manifest.returnedEntityCount || 0),
      Number(manifest.liveEntityCount || 0),
      Number(manifest.deletedEntityCount || 0),
      String(manifest.status || ''),
      manifestFile.getId(),
      manifestFile.getName(),
      manifestHash,
      String(manifest.runFolderId || folder.getId()),
      String(manifest.runFolderName || folder.getName()),
      minorVersion,
      String(manifest.version || ''),
      manifestCreatedAt,
      QBO_NATIVE_CDC_SOURCE_LEDGER_V2_.REGISTRATION_MODE,
      registeredAt
    ]);

    expectedReturned += Number(manifest.returnedEntityCount || 0);
    expectedLive += Number(manifest.liveEntityCount || 0);
    expectedDeleted += Number(manifest.deletedEntityCount || 0);

    evidence.forEach(function(meta) {
      totalEvidenceUnits += 1;
      const entityType = String(meta.entity || '').trim();
      const sourceId = 'NATIVE_CDC|' + cycleId + '|' + entityType;
      const evidenceFileId = String(meta.evidenceFileId || '').trim();
      if (String(meta.status || '') !== 'SUCCESS' || !evidenceFileId) {
        throw new Error('NATIVE_CDC_SOURCE_LEDGER_V2_INVALID_ENTITY_META cycle=' + cycleId + ' entity=' + entityType);
      }
      const evidenceFile = DriveApp.getFileById(evidenceFileId);
      const evidenceText = evidenceFile.getBlob().getDataAsString('UTF-8');
      if (meta.evidenceFileName && evidenceFile.getName() !== String(meta.evidenceFileName)) {
        throw new Error('NATIVE_CDC_SOURCE_LEDGER_V2_EVIDENCE_NAME_MISMATCH cycle=' + cycleId + ' entity=' + entityType);
      }
      const evidenceHash = qboStateCaptureAuditSha256_(evidenceText);
      if (meta.payloadSha256 && evidenceHash !== String(meta.payloadSha256)) {
        throw new Error('NATIVE_CDC_SOURCE_LEDGER_V2_EVIDENCE_HASH_MISMATCH cycle=' + cycleId + ' entity=' + entityType);
      }
      let envelope;
      try { envelope = JSON.parse(evidenceText); }
      catch (error) { throw new Error('NATIVE_CDC_SOURCE_LEDGER_V2_EVIDENCE_INVALID_JSON cycle=' + cycleId + ' entity=' + entityType); }
      const entities = qboSourceAdapterExtractNativeCdcEntities_(envelope, entityType);
      const expectedCount = Number(meta.returnedEntityCount || 0);
      if (entities.length !== expectedCount) {
        throw new Error('NATIVE_CDC_SOURCE_LEDGER_V2_OBSERVATION_COUNT_MISMATCH cycle=' + cycleId + ' entity=' + entityType + ' expected=' + expectedCount + ' actual=' + entities.length);
      }
      if (!entities.length) zeroObservationEvidenceUnits += 1;

      const requestCompletedAt = String(meta.requestCompletedAt || '');
      const observedAt = requestCompletedAt || String(manifest.runCompletedAt || '');
      if (!requestCompletedAt && entities.length) fallbackObservedAtCount += entities.length;
      const evidenceCreatedAt = qboNativeCdcSourceLedgerV2FileCreatedAt_(evidenceFile);

      entities.forEach(function(entity, index) {
        const entityId = String(entity && entity.Id || '').trim();
        const deleted = String(entity && entity.status || '').toLowerCase() === 'deleted';
        const operation = deleted ? 'DELETE' : 'UPSERT';
        const eventId = sourceId + '|OBS|' + index + '|' + entityId + '|' + operation;
        if (seenEvent[eventId]) throw new Error('NATIVE_CDC_SOURCE_LEDGER_V2_DUPLICATE_EVENT_ID ' + eventId);
        seenEvent[eventId] = true;

        let eligibilityStatus = 'ELIGIBLE';
        let eligibilityReason = deleted ? 'DELETE_TOMBSTONE' : 'CAPTURED_CDC_ENTITY_EVIDENCE_COMPLETE';
        if (!entityId) {
          eligibilityStatus = 'INELIGIBLE';
          eligibilityReason = 'MISSING_ENTITY_ID';
        } else if (!deleted) {
          const assessment = qboSourceAdapterAssessRawEntityCompleteness_(entityType, entity);
          if (!assessment.complete) {
            eligibilityStatus = 'INELIGIBLE';
            eligibilityReason = 'HISTORICAL_CDC_RAW_ENTITY_INCOMPLETE_NO_CURRENT_FETCH ' + String(assessment.reason || '');
          }
        }
        if (eligibilityStatus === 'ELIGIBLE') eligibleEventCount += 1;
        else ineligibleEventCount += 1;

        const md = entity && entity.MetaData ? entity.MetaData : {};
        rows03.push([
          eventId,
          cycleId,
          sourceId,
          String(meta.entityRunId || ''),
          entityType,
          index,
          entityId,
          operation,
          String(entity && entity.status || ''),
          deleted,
          String(entity && entity.SyncToken || ''),
          String(md.CreateTime || ''),
          String(md.LastUpdatedTime || ''),
          observedAt,
          String(md.LastUpdatedTime || ''),
          entity && entity.sparse === true,
          evidenceFile.getId(),
          evidenceFile.getName(),
          evidenceHash,
          'SHA-256',
          String(meta.requestStartedAt || ''),
          requestCompletedAt,
          String(meta.qboResponseTime || ''),
          qboStateCaptureAuditSha256_(JSON.stringify(entity || {})),
          'VALID',
          eligibilityStatus,
          eligibilityReason,
          evidenceCreatedAt,
          QBO_NATIVE_CDC_SOURCE_LEDGER_V2_.REGISTRATION_MODE,
          registeredAt
        ]);
      });

      actualReturned += entities.length;
      const deletedActual = entities.filter(function(entity) {
        return entity && String(entity.status || '').toLowerCase() === 'deleted';
      }).length;
      actualDeleted += deletedActual;
      actualLive += entities.length - deletedActual;
    });
  });

  rows02.sort(function(a,b) { return String(a[2]).localeCompare(String(b[2])) || String(a[0]).localeCompare(String(b[0])); });
  rows03.sort(function(a,b) {
    return String(a[1]).localeCompare(String(b[1])) ||
      String(a[4]).localeCompare(String(b[4])) ||
      Number(a[5]) - Number(b[5]);
  });

  if (expectedReturned !== actualReturned || expectedLive !== actualLive || expectedDeleted !== actualDeleted) {
    throw new Error('NATIVE_CDC_SOURCE_LEDGER_V2_MANIFEST_EVENT_TOTAL_MISMATCH ' + JSON.stringify({
      expectedReturned:expectedReturned, actualReturned:actualReturned,
      expectedLive:expectedLive, actualLive:actualLive,
      expectedDeleted:expectedDeleted, actualDeleted:actualDeleted
    }));
  }

  return {
    rows02:rows02, rows03:rows03, findings:findings,
    committedManifestCount:committedManifestCount,
    totalEvidenceUnits:totalEvidenceUnits,
    zeroObservationEvidenceUnits:zeroObservationEvidenceUnits,
    eligibleEventCount:eligibleEventCount,
    ineligibleEventCount:ineligibleEventCount,
    fallbackObservedAtCount:fallbackObservedAtCount,
    expectedReturned:expectedReturned, actualReturned:actualReturned,
    expectedLive:expectedLive, actualLive:actualLive,
    expectedDeleted:expectedDeleted, actualDeleted:actualDeleted
  };
}

function qboNativeCdcSourceLedgerV2Summary_(built, wrote) {
  return {
    version:QBO_NATIVE_CDC_SOURCE_LEDGER_V2_.VERSION,
    status:built.findings.length ? 'ACTION_REQUIRED' : 'READY',
    writeApplied:wrote === true,
    sheet02:QBO_NATIVE_CDC_SOURCE_LEDGER_V2_.SHEET02,
    sheet03:QBO_NATIVE_CDC_SOURCE_LEDGER_V2_.SHEET03,
    committedCycleCount:built.committedManifestCount,
    sourceEvidenceUnitCount:built.totalEvidenceUnits,
    zeroObservationEvidenceUnitCount:built.zeroObservationEvidenceUnits,
    nativeCdcEventCount:built.rows03.length,
    eligibleEventCount:built.eligibleEventCount,
    ineligibleEventCount:built.ineligibleEventCount,
    fallbackObservedAtCount:built.fallbackObservedAtCount,
    manifestReturnedEntityCount:built.expectedReturned,
    reconstructedReturnedEntityCount:built.actualReturned,
    manifestLiveEntityCount:built.expectedLive,
    reconstructedLiveEntityCount:built.actualLive,
    manifestDeletedEntityCount:built.expectedDeleted,
    reconstructedDeletedEntityCount:built.actualDeleted,
    findingCount:built.findings.length,
    findings:built.findings.slice(0,50),
    mutatesSourceEvidence:false,
    mutatesCurrent01:false,
    mutatesCurrent05:false,
    mutatesCurrent06:false,
    mutatesPayloads:false,
    mutatesStateApplication:false
  };
}

function qboNativeCdcSourceLedgerV2EnsureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1,1,1,headers.length).setValues([headers.slice()]);
    sheet.setFrozenRows(1);
    applyQboStateCaptureSheetLayout_(sheet);
    return sheet;
  }
  const lastColumn = sheet.getLastColumn();
  if (lastColumn !== headers.length) {
    throw new Error('NATIVE_CDC_SOURCE_LEDGER_V2_SCHEMA_WIDTH_MISMATCH sheet=' + name + ' expected=' + headers.length + ' actual=' + lastColumn);
  }
  const actual = sheet.getRange(1,1,1,headers.length).getValues()[0].map(String);
  for (let i=0; i<headers.length; i++) {
    if (actual[i] !== headers[i]) {
      throw new Error('NATIVE_CDC_SOURCE_LEDGER_V2_SCHEMA_HEADER_MISMATCH sheet=' + name + ' column=' + (i+1) + ' expected=' + headers[i] + ' actual=' + actual[i]);
    }
  }
  return sheet;
}

function qboNativeCdcSourceLedgerV2ExistingKeys_(sheet, keyColumn) {
  const out = Object.create(null);
  if (sheet.getLastRow() <= 1) return out;
  sheet.getRange(2,keyColumn,sheet.getLastRow()-1,1).getValues().forEach(function(row) {
    const key = String(row[0] || '').trim();
    if (!key) throw new Error('NATIVE_CDC_SOURCE_LEDGER_V2_BLANK_EXISTING_KEY sheet=' + sheet.getName());
    if (out[key]) throw new Error('NATIVE_CDC_SOURCE_LEDGER_V2_DUPLICATE_EXISTING_KEY sheet=' + sheet.getName() + ' key=' + key);
    out[key] = true;
  });
  return out;
}

function qboNativeCdcSourceLedgerV2Append_(sheet, rows) {
  if (!rows.length) return;
  const width = rows[0].length;
  const batchSize = 500;
  for (let i=0; i<rows.length; i+=batchSize) {
    const batch = rows.slice(i, i+batchSize);
    sheet.getRange(sheet.getLastRow()+1, 1, batch.length, width).setValues(batch);
  }
  applyQboStateCaptureSheetLayout_(sheet);
}

function qboNativeCdcSourceLedgerV2FileCreatedAt_(file) {
  try {
    const d = file.getDateCreated();
    return d && !isNaN(d.getTime()) ? d.toISOString() : '';
  } catch (ignore) {
    return '';
  }
}
