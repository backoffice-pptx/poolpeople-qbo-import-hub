/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 110_QBO_NativeCdcTransientPropertyRetention.js
 * Version     : 1.5.74
 * Purpose     : Govern retention/cleanup of transient per-cycle Native CDC
 *               Script Properties after durable cycle commit.
 *
 * Public API:
 *   - previewQboNativeCdcTransientPropertyCleanup()
 *   - cleanupQboNativeCdcCommittedTransientProperties()
 *   - verifyQboNativeCdcTransientPropertyCleanup()
 *
 * Safety contract:
 *   - Cleanup authority is durable committed manifest evidence, never age alone.
 *   - A cycle is eligible only when its manifest proves SUCCESS,
 *     watermarkCommitted=true, committedWatermark present, and a complete exact
 *     entityEvidence set for the governed Native CDC entity scope.
 *   - Public cleanup refuses to run while Native CDC production is unpaused or
 *     while an active RUNNING/INITIALIZING/FINALIZING cycle exists.
 *   - Only QBO_NATIVE_CDC_ENTITY_META_V2__<cycle>__<entity> and matching
 *     ATTEMPTS__<cycle>__<entity> properties are deleted.
 *   - Watermark, cycle state, pause state, leases, pending ingestion handoff,
 *     forward-ingestion ledger, Drive evidence, manifests, and payloads are not
 *     modified by this module.
 *   - Automatic post-commit cleanup is best-effort and cannot invalidate an
 *     already committed cycle.
 * ============================================================================
 */

const QBO_NATIVE_CDC_TRANSIENT_RETENTION_ = Object.freeze({
  VERSION: 'QBO_NATIVE_CDC_TRANSIENT_RETENTION_V1',
  ENTITY_META_PREFIX: 'QBO_NATIVE_CDC_ENTITY_META_V2__',
  ATTEMPTS_MARKER: 'ATTEMPTS__'
});

function previewQboNativeCdcTransientPropertyCleanup() {
  const plan = qboNativeCdcBuildTransientPropertyCleanupPlan_();
  const out = qboNativeCdcTransientCleanupPublicView_(plan, false);
  console.log('[NATIVE CDC PROPERTY CLEANUP] | PREVIEW | ' + JSON.stringify(out, null, 2));
  return out;
}

function cleanupQboNativeCdcCommittedTransientProperties() {
  if (!qboNativeCdcIsPaused_()) {
    throw new Error('NATIVE_CDC_TRANSIENT_CLEANUP_REFUSED_PRODUCTION_NOT_PAUSED');
  }
  const state = qboNativeCdcReadState_();
  if (state && ['RUNNING','INITIALIZING','FINALIZING'].indexOf(String(state.status || '')) >= 0) {
    throw new Error('NATIVE_CDC_TRANSIENT_CLEANUP_REFUSED_ACTIVE_CYCLE cycleId=' + String(state.cycleId || '') + ' status=' + String(state.status || ''));
  }

  const before = qboNativeCdcTransientPropertyStorageSummary_();
  const plan = qboNativeCdcBuildTransientPropertyCleanupPlan_();
  const props = PropertiesService.getScriptProperties();
  let deletedPropertyCount = 0;
  let deletedApproximateBytes = 0;

  plan.eligibleCycles.forEach(function(cycle) {
    cycle.propertyKeys.forEach(function(key) {
      const current = props.getProperty(key);
      if (current == null) return;
      deletedApproximateBytes += qboNativeCdcTransientUtf8Bytes_(key) + qboNativeCdcTransientUtf8Bytes_(String(current));
      props.deleteProperty(key);
      deletedPropertyCount += 1;
    });
  });

  const after = qboNativeCdcTransientPropertyStorageSummary_();
  const result = {
    version: QBO_NATIVE_CDC_TRANSIENT_RETENTION_.VERSION,
    action: 'CLEANED_COMMITTED_CYCLES',
    evidenceGate: 'DURABLE_COMMITTED_MANIFEST',
    eligibleCycleCount: plan.eligibleCycles.length,
    blockedCycleCount: plan.blockedCycles.length,
    deletedPropertyCount: deletedPropertyCount,
    deletedApproximateBytes: deletedApproximateBytes,
    deletedApproximateKiB: Number((deletedApproximateBytes / 1024).toFixed(2)),
    before: before,
    after: after,
    blockedCycles: plan.blockedCycles
  };
  console.log('[NATIVE CDC PROPERTY CLEANUP] | COMPLETE | ' + JSON.stringify(result, null, 2));
  return result;
}

function verifyQboNativeCdcTransientPropertyCleanup() {
  const summary = qboNativeCdcTransientPropertyStorageSummary_();
  const out = {
    version: QBO_NATIVE_CDC_TRANSIENT_RETENTION_.VERSION,
    readOnly: true,
    productionPaused: qboNativeCdcIsPaused_(),
    propertyCount: summary.propertyCount,
    approximateTotalBytes: summary.approximateTotalBytes,
    approximateTotalKiB: summary.approximateTotalKiB,
    nativeCdcTransientPropertyCount: summary.nativeCdcTransientPropertyCount,
    nativeCdcTransientApproximateBytes: summary.nativeCdcTransientApproximateBytes,
    nativeCdcTransientApproximateKiB: Number((summary.nativeCdcTransientApproximateBytes / 1024).toFixed(2))
  };
  console.log('[NATIVE CDC PROPERTY CLEANUP] | VERIFY | ' + JSON.stringify(out, null, 2));
  return out;
}

/**
 * Internal prospective cleanup used by the production acquisition finalizer.
 * The caller supplies the exact manifest just durably written for that cycle.
 */
function qboNativeCdcCleanupCommittedCycleTransientProperties_(cycleId, manifestFileId, options) {
  const gate = qboNativeCdcValidateCommittedManifest_(manifestFileId, cycleId);
  if (!gate.eligible) {
    return {
      version: QBO_NATIVE_CDC_TRANSIENT_RETENTION_.VERSION,
      action: 'NOT_CLEANED',
      cycleId: String(cycleId || ''),
      automatic: !!(options && options.automatic),
      reason: gate.reason
    };
  }

  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const keys = qboNativeCdcTransientKeysForCycle_(all, cycleId);
  let deletedApproximateBytes = 0;
  keys.forEach(function(key) {
    deletedApproximateBytes += qboNativeCdcTransientUtf8Bytes_(key) + qboNativeCdcTransientUtf8Bytes_(String(all[key] == null ? '' : all[key]));
    props.deleteProperty(key);
  });
  return {
    version: QBO_NATIVE_CDC_TRANSIENT_RETENTION_.VERSION,
    action: 'CLEANED',
    cycleId: String(cycleId || ''),
    automatic: !!(options && options.automatic),
    deletedPropertyCount: keys.length,
    deletedApproximateBytes: deletedApproximateBytes
  };
}

function qboNativeCdcBuildTransientPropertyCleanupPlan_() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const cycleMap = {};

  Object.keys(all).forEach(function(key) {
    const cycleId = qboNativeCdcTransientCycleIdFromKey_(key);
    if (!cycleId) return;
    if (!cycleMap[cycleId]) cycleMap[cycleId] = [];
    cycleMap[cycleId].push(key);
  });

  const manifestMap = qboNativeCdcDiscoverCommittedManifestMap_();
  const state = qboNativeCdcReadState_();
  const eligibleCycles = [];
  const blockedCycles = [];

  Object.keys(cycleMap).sort().forEach(function(cycleId) {
    const keys = cycleMap[cycleId].slice().sort();
    const bytes = keys.reduce(function(sum, key) {
      return sum + qboNativeCdcTransientUtf8Bytes_(key) + qboNativeCdcTransientUtf8Bytes_(String(all[key] == null ? '' : all[key]));
    }, 0);

    if (state && String(state.cycleId || '') === cycleId && ['RUNNING','INITIALIZING','FINALIZING'].indexOf(String(state.status || '')) >= 0) {
      blockedCycles.push({cycleId:cycleId, reason:'ACTIVE_CYCLE', propertyCount:keys.length, approximateBytes:bytes});
      return;
    }

    const manifestRef = manifestMap[cycleId];
    if (!manifestRef) {
      blockedCycles.push({cycleId:cycleId, reason:'COMMITTED_MANIFEST_NOT_FOUND', propertyCount:keys.length, approximateBytes:bytes});
      return;
    }
    const gate = qboNativeCdcValidateCommittedManifestObject_(manifestRef.manifest, cycleId);
    if (!gate.eligible) {
      blockedCycles.push({cycleId:cycleId, reason:gate.reason, propertyCount:keys.length, approximateBytes:bytes, manifestFileId:manifestRef.manifestFileId});
      return;
    }

    eligibleCycles.push({
      cycleId: cycleId,
      manifestFileId: manifestRef.manifestFileId,
      runFolderId: manifestRef.runFolderId,
      propertyCount: keys.length,
      approximateBytes: bytes,
      propertyKeys: keys
    });
  });

  return {
    version: QBO_NATIVE_CDC_TRANSIENT_RETENTION_.VERSION,
    readOnly: true,
    propertyCycleCount: Object.keys(cycleMap).length,
    eligibleCycles: eligibleCycles,
    blockedCycles: blockedCycles
  };
}

function qboNativeCdcDiscoverCommittedManifestMap_() {
  const root = qboNativeCdcResolveEvidenceFolder_();
  const runFolders = qboNativeCdcTransientListRunFolders_(root);
  const map = {};
  runFolders.forEach(function(folder) {
    const files = folder.getFilesByName(QBO_NATIVE_CDC_PRODUCTION.MANIFEST_FILE_NAME);
    if (!files.hasNext()) return;
    const manifestFile = files.next();
    if (files.hasNext()) return; // ambiguous evidence fails closed below as not found
    let manifest;
    try { manifest = JSON.parse(manifestFile.getBlob().getDataAsString('UTF-8')); }
    catch (ignore) { return; }
    const cycleId = String(manifest.cycleId || '').trim();
    if (!cycleId) return;
    if (map[cycleId]) {
      map[cycleId] = null; // duplicate cycle evidence fails closed
      return;
    }
    map[cycleId] = {manifestFileId:manifestFile.getId(), runFolderId:folder.getId(), manifest:manifest};
  });
  Object.keys(map).forEach(function(cycleId) { if (map[cycleId] === null) delete map[cycleId]; });
  return map;
}

function qboNativeCdcValidateCommittedManifest_(manifestFileId, expectedCycleId) {
  let file;
  try { file = DriveApp.getFileById(String(manifestFileId || '').trim()); }
  catch (error) { return {eligible:false, reason:'MANIFEST_FILE_UNAVAILABLE'}; }
  let manifest;
  try { manifest = JSON.parse(file.getBlob().getDataAsString('UTF-8')); }
  catch (error) { return {eligible:false, reason:'MANIFEST_INVALID_JSON'}; }
  return qboNativeCdcValidateCommittedManifestObject_(manifest, expectedCycleId);
}

function qboNativeCdcValidateCommittedManifestObject_(manifest, expectedCycleId) {
  if (!manifest || String(manifest.cycleId || '') !== String(expectedCycleId || '')) return {eligible:false, reason:'MANIFEST_CYCLE_ID_MISMATCH'};
  if (String(manifest.status || '') !== 'SUCCESS') return {eligible:false, reason:'MANIFEST_NOT_SUCCESS'};
  if (manifest.watermarkCommitted !== true) return {eligible:false, reason:'MANIFEST_WATERMARK_NOT_COMMITTED'};
  if (!String(manifest.committedWatermark || '').trim()) return {eligible:false, reason:'MANIFEST_COMMITTED_WATERMARK_MISSING'};
  const evidence = Array.isArray(manifest.entityEvidence) ? manifest.entityEvidence : [];
  if (evidence.length !== QBO_NATIVE_CDC_PRODUCTION.ENTITIES.length) return {eligible:false, reason:'MANIFEST_ENTITY_EVIDENCE_COUNT_MISMATCH'};

  const seen = {};
  for (let i = 0; i < evidence.length; i++) {
    const row = evidence[i] || {};
    const entity = String(row.entity || '').trim();
    if (!entity || QBO_NATIVE_CDC_PRODUCTION.ENTITIES.indexOf(entity) < 0) return {eligible:false, reason:'MANIFEST_ENTITY_EVIDENCE_SCOPE_MISMATCH'};
    if (seen[entity]) return {eligible:false, reason:'MANIFEST_DUPLICATE_ENTITY_EVIDENCE'};
    seen[entity] = true;
    if (String(row.status || '') !== 'SUCCESS' || !String(row.evidenceFileId || '').trim()) return {eligible:false, reason:'MANIFEST_ENTITY_EVIDENCE_INCOMPLETE'};
  }
  for (let j = 0; j < QBO_NATIVE_CDC_PRODUCTION.ENTITIES.length; j++) {
    if (!seen[QBO_NATIVE_CDC_PRODUCTION.ENTITIES[j]]) return {eligible:false, reason:'MANIFEST_GOVERNED_ENTITY_MISSING'};
  }
  return {eligible:true, reason:''};
}

function qboNativeCdcTransientKeysForCycle_(all, cycleId) {
  const exactPrefix = QBO_NATIVE_CDC_TRANSIENT_RETENTION_.ENTITY_META_PREFIX + String(cycleId || '') + '__';
  const attemptsPrefix = QBO_NATIVE_CDC_TRANSIENT_RETENTION_.ENTITY_META_PREFIX + QBO_NATIVE_CDC_TRANSIENT_RETENTION_.ATTEMPTS_MARKER + String(cycleId || '') + '__';
  return Object.keys(all).filter(function(key) {
    return key.indexOf(exactPrefix) === 0 || key.indexOf(attemptsPrefix) === 0;
  }).sort();
}

function qboNativeCdcTransientCycleIdFromKey_(key) {
  const prefix = QBO_NATIVE_CDC_TRANSIENT_RETENTION_.ENTITY_META_PREFIX;
  const k = String(key || '');
  if (k.indexOf(prefix) !== 0) return '';
  let remainder = k.substring(prefix.length);
  if (remainder.indexOf(QBO_NATIVE_CDC_TRANSIENT_RETENTION_.ATTEMPTS_MARKER) === 0) {
    remainder = remainder.substring(QBO_NATIVE_CDC_TRANSIENT_RETENTION_.ATTEMPTS_MARKER.length);
  }
  const parts = remainder.split('__');
  return parts.length >= 2 ? parts[0] : '';
}

function qboNativeCdcTransientListRunFolders_(root) {
  const runFolders = [];
  const top = root.getFolders();
  while (top.hasNext()) {
    const child = top.next();
    const name = String(child.getName() || '');
    if (name.indexOf(QBO_NATIVE_CDC_PRODUCTION.RUN_FOLDER_PREFIX) === 0) {
      runFolders.push(child);
      continue;
    }
    if (!/^\d{4}$/.test(name)) continue;
    const months = child.getFolders();
    while (months.hasNext()) {
      const month = months.next();
      if (!/^\d{2}$/.test(String(month.getName() || ''))) continue;
      const days = month.getFolders();
      while (days.hasNext()) {
        const day = days.next();
        if (!/^\d{2}$/.test(String(day.getName() || ''))) continue;
        const runs = day.getFolders();
        while (runs.hasNext()) {
          const run = runs.next();
          if (String(run.getName() || '').indexOf(QBO_NATIVE_CDC_PRODUCTION.RUN_FOLDER_PREFIX) === 0) runFolders.push(run);
        }
      }
    }
  }
  return runFolders;
}

function qboNativeCdcTransientPropertyStorageSummary_() {
  const all = PropertiesService.getScriptProperties().getProperties();
  let totalBytes = 0;
  let transientBytes = 0;
  let transientCount = 0;
  Object.keys(all).forEach(function(key) {
    const bytes = qboNativeCdcTransientUtf8Bytes_(key) + qboNativeCdcTransientUtf8Bytes_(String(all[key] == null ? '' : all[key]));
    totalBytes += bytes;
    if (qboNativeCdcTransientCycleIdFromKey_(key)) {
      transientCount += 1;
      transientBytes += bytes;
    }
  });
  return {
    propertyCount: Object.keys(all).length,
    approximateTotalBytes: totalBytes,
    approximateTotalKiB: Number((totalBytes / 1024).toFixed(2)),
    nativeCdcTransientPropertyCount: transientCount,
    nativeCdcTransientApproximateBytes: transientBytes
  };
}

function qboNativeCdcTransientCleanupPublicView_(plan, includeKeys) {
  return {
    version: plan.version,
    readOnly: true,
    evidenceGate: 'DURABLE_COMMITTED_MANIFEST',
    propertyCycleCount: plan.propertyCycleCount,
    eligibleCycleCount: plan.eligibleCycles.length,
    blockedCycleCount: plan.blockedCycles.length,
    eligiblePropertyCount: plan.eligibleCycles.reduce(function(sum, row) { return sum + row.propertyCount; }, 0),
    eligibleApproximateBytes: plan.eligibleCycles.reduce(function(sum, row) { return sum + row.approximateBytes; }, 0),
    eligibleApproximateKiB: Number((plan.eligibleCycles.reduce(function(sum, row) { return sum + row.approximateBytes; }, 0) / 1024).toFixed(2)),
    eligibleCycles: plan.eligibleCycles.map(function(row) {
      const out = {cycleId:row.cycleId, manifestFileId:row.manifestFileId, propertyCount:row.propertyCount, approximateBytes:row.approximateBytes};
      if (includeKeys) out.propertyKeys = row.propertyKeys.slice();
      return out;
    }),
    blockedCycles: plan.blockedCycles
  };
}

function qboNativeCdcTransientUtf8Bytes_(text) {
  return Utilities.newBlob(String(text == null ? '' : text)).getBytes().length;
}
