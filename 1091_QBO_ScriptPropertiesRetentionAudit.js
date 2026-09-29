/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 1091_QBO_ScriptPropertiesRetentionAudit.js
 * Version     : 1.5.194
 * Purpose     : Read-only retention classification for Script Properties.
 *
 * Public API:
 *   - auditQboScriptPropertiesRetention()
 *
 * Safety:
 *   - READ ONLY. Never sets, deletes, or rewrites Script Properties.
 *   - Never logs property values, secrets, tokens, or credentials.
 *   - RETIRE_ELIGIBLE is fail-closed and requires explicit lifecycle evidence.
 *   - Unrecognized properties are UNKNOWN_REVIEW, never implicitly disposable.
 * ============================================================================
 */

const QBO_SCRIPT_PROPERTIES_RETENTION_AUDIT_ = Object.freeze({
  VERSION: '1.5.194',
  PREVIEW_STATE_KEY: 'QBO_FE_OBS_HIST_PREVIEW_V148_STATE',
  PREVIEW_RESULT_PREFIX: 'QBO_FE_OBS_HIST_PREVIEW_V148_RESULT_',
  APPLY_STATE_KEY: 'QBO_FE_OBS_HIST_APPLY_V155_STATE',
  POST_RECON_STATE_KEY: 'QBO_FE_OBS_POST_RECON_V163_STATE',
  POST_RECON_RESULT_PREFIX: 'QBO_FE_OBS_POST_RECON_V163_RESULT_',
  OBS_INDEX_BACKFILL_STATE_KEY: 'QBO_OBSERVATION_INDEX_BACKFILL_V170_STATE',
  EXPECTED_APPLY_RUN: 'FE_OBS_HIST_APPLY_6051dd21-ae18-4bf5-827f-3588e04b761d',
  EXPECTED_CANDIDATES: 341,
  EXPECTED_INDEXED_OBSERVATIONS: 734858,
  NATIVE_CDC_ENTITY_META_PREFIX: 'QBO_NATIVE_CDC_ENTITY_META_V2__'
});

function auditQboScriptPropertiesRetention() {
  const C = QBO_SCRIPT_PROPERTIES_RETENTION_AUDIT_;
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const keys = Object.keys(all).sort();
  const lifecycle = qboScriptPropertiesRetentionLifecycle_(all);
  const nativePlan = qboScriptPropertiesRetentionNativePlan_();
  const nativeEligible = nativePlan.eligibleKeys;
  const nativeBlocked = nativePlan.blockedKeys;
  const families = {};
  let totalBytes = 0;

  keys.forEach(function(key) {
    const value = String(all[key] == null ? '' : all[key]);
    const bytes = qboScriptPropertiesRetentionUtf8Bytes_(key) +
      qboScriptPropertiesRetentionUtf8Bytes_(value);
    totalBytes += bytes;
    const c = qboScriptPropertiesRetentionClassify_(key, lifecycle, nativeEligible, nativeBlocked);
    if (!families[c.family]) {
      families[c.family] = {
        family: c.family,
        classification: c.classification,
        reason: c.reason,
        propertyCount: 0,
        approximateBytes: 0,
        sampleKeys: []
      };
    }
    const f = families[c.family];
    // A family must never be made less conservative by a later member.
    f.classification = qboScriptPropertiesRetentionMoreConservative_(f.classification, c.classification);
    if (f.reason.indexOf(c.reason) < 0) f.reason += ' | ' + c.reason;
    f.propertyCount++;
    f.approximateBytes += bytes;
    if (f.sampleKeys.length < 5) f.sampleKeys.push(key);
  });

  const familyRows = Object.keys(families).map(function(name) {
    const f = families[name];
    f.approximateKiB = Number((f.approximateBytes / 1024).toFixed(2));
    return f;
  }).sort(function(a, b) {
    if (a.classification !== b.classification) return a.classification.localeCompare(b.classification);
    if (b.approximateBytes !== a.approximateBytes) return b.approximateBytes - a.approximateBytes;
    return a.family.localeCompare(b.family);
  });

  const summary = {};
  ['KEEP','RETIRE_ELIGIBLE','BLOCKED_PRESERVE','UNKNOWN_REVIEW'].forEach(function(k) {
    summary[k] = {familyCount:0, propertyCount:0, approximateBytes:0, approximateKiB:0};
  });
  familyRows.forEach(function(f) {
    const s = summary[f.classification];
    s.familyCount++;
    s.propertyCount += f.propertyCount;
    s.approximateBytes += f.approximateBytes;
  });
  Object.keys(summary).forEach(function(k) {
    summary[k].approximateKiB = Number((summary[k].approximateBytes / 1024).toFixed(2));
  });

  const out = {
    version: C.VERSION,
    readOnly: true,
    propertyCount: keys.length,
    approximateTotalBytes: totalBytes,
    approximateTotalKiB: Number((totalBytes / 1024).toFixed(2)),
    classificationSummary: summary,
    lifecycleEvidence: lifecycle.publicView,
    nativeCdcCleanupEvidence: nativePlan.publicView,
    families: familyRows,
    safety: {
      propertiesWritten: false,
      propertiesDeleted: false,
      valuesLogged: false,
      unknownDefaultsToPreserve: true,
      retireEligibilityRequiresExplicitEvidence: true
    }
  };

  console.log('[SCRIPT PROPERTIES RETENTION] | SUMMARY | ' + JSON.stringify({
    version: out.version,
    readOnly: out.readOnly,
    propertyCount: out.propertyCount,
    approximateTotalBytes: out.approximateTotalBytes,
    approximateTotalKiB: out.approximateTotalKiB,
    classificationSummary: out.classificationSummary,
    lifecycleEvidence: out.lifecycleEvidence,
    nativeCdcCleanupEvidence: out.nativeCdcCleanupEvidence,
    safety: out.safety
  }, null, 2));
  familyRows.forEach(function(f) {
    console.log('[SCRIPT PROPERTIES RETENTION] | FAMILY | ' + JSON.stringify(f));
  });
  return out;
}

function qboScriptPropertiesRetentionLifecycle_(all) {
  const C = QBO_SCRIPT_PROPERTIES_RETENTION_AUDIT_;
  const preview = qboScriptPropertiesRetentionJson_(all[C.PREVIEW_STATE_KEY]);
  const apply = qboScriptPropertiesRetentionJson_(all[C.APPLY_STATE_KEY]);
  const post = qboScriptPropertiesRetentionJson_(all[C.POST_RECON_STATE_KEY]);
  const index = qboScriptPropertiesRetentionJson_(all[C.OBS_INDEX_BACKFILL_STATE_KEY]);

  const previewComplete = !!preview && preview.status === 'COMPLETE' &&
    Number(preview.candidateCount) === C.EXPECTED_CANDIDATES &&
    Number(preview.processedCount) === C.EXPECTED_CANDIDATES;
  const applyComplete = !!apply && apply.applyRunId === C.EXPECTED_APPLY_RUN &&
    apply.status === 'COMPLETE' && Number(apply.cursor) === C.EXPECTED_CANDIDATES;
  const postComplete = !!post && post.status === 'COMPLETE' &&
    Number(post.cursor) === C.EXPECTED_CANDIDATES &&
    Number(post.checkedCandidates) === C.EXPECTED_CANDIDATES &&
    Number(post.findingCount) === 0;
  const indexComplete = !!index &&
    String(index.status || '').indexOf('COMPLETE') === 0 &&
    Number(index.indexedObservationCount) === C.EXPECTED_INDEXED_OBSERVATIONS;

  // The V148/V155/V163 working-state family is disposable only after the exact
  // historical apply and post-apply reconciliation are complete AND the later
  // Observation Index historical population is durably complete. This avoids
  // treating age alone as cleanup authority.
  const historicalObservationCountFamilyClosed =
    previewComplete && applyComplete && postComplete && indexComplete;

  return {
    historicalObservationCountFamilyClosed: historicalObservationCountFamilyClosed,
    publicView: {
      previewStatePresent: !!preview,
      previewComplete: previewComplete,
      applyStatePresent: !!apply,
      applyComplete: applyComplete,
      postReconciliationStatePresent: !!post,
      postReconciliationComplete: postComplete,
      observationIndexBackfillStatePresent: !!index,
      observationIndexBackfillComplete: indexComplete,
      historicalObservationCountFamilyClosed: historicalObservationCountFamilyClosed
    }
  };
}

function qboScriptPropertiesRetentionNativePlan_() {
  const out = {eligibleKeys:{}, blockedKeys:{}, publicView:{available:false}};
  if (typeof qboNativeCdcBuildTransientPropertyCleanupPlan_ !== 'function') {
    out.publicView = {available:false, reason:'Native CDC governed cleanup planner unavailable.'};
    return out;
  }
  try {
    const plan = qboNativeCdcBuildTransientPropertyCleanupPlan_();
    (plan.eligibleCycles || []).forEach(function(c) {
      (c.propertyKeys || []).forEach(function(k) { out.eligibleKeys[k] = true; });
    });
    (plan.blockedCycles || []).forEach(function(c) {
      (c.propertyKeys || []).forEach(function(k) { out.blockedKeys[k] = true; });
    });
    out.publicView = {
      available:true,
      evidenceGate:'DURABLE_COMMITTED_MANIFEST',
      eligibleCycleCount:(plan.eligibleCycles || []).length,
      blockedCycleCount:(plan.blockedCycles || []).length,
      eligiblePropertyCount:Object.keys(out.eligibleKeys).length,
      blockedPropertyCount:Object.keys(out.blockedKeys).length
    };
  } catch (e) {
    out.publicView = {available:false, reason:'Native CDC cleanup planner failed: '+String(e && e.message || e)};
  }
  return out;
}

function qboScriptPropertiesRetentionClassify_(key, lifecycle, nativeEligible, nativeBlocked) {
  const C = QBO_SCRIPT_PROPERTIES_RETENTION_AUDIT_;
  const k = String(key || '');

  if (k === C.PREVIEW_STATE_KEY || k.indexOf(C.PREVIEW_RESULT_PREFIX) === 0 ||
      k === C.APPLY_STATE_KEY || k === C.POST_RECON_STATE_KEY ||
      k.indexOf(C.POST_RECON_RESULT_PREFIX) === 0) {
    return {
      family:'FULL_EXPORT_HISTORICAL_OBSERVATIONCOUNT_WORKING_STATE',
      classification:lifecycle.historicalObservationCountFamilyClosed ? 'RETIRE_ELIGIBLE' : 'BLOCKED_PRESERVE',
      reason:lifecycle.historicalObservationCountFamilyClosed
        ? 'Exact preview/apply/post-reconciliation lifecycle is complete and later historical Observation Index population is complete.'
        : 'Historical ObservationCount lifecycle closure prerequisites are not all proven complete.'
    };
  }

  if (k.indexOf(C.NATIVE_CDC_ENTITY_META_PREFIX) === 0) {
    if (nativeEligible[k]) return {family:'NATIVE_CDC_TRANSIENT_PER_CYCLE',classification:'RETIRE_ELIGIBLE',reason:'Existing governed Native CDC cleanup planner authorizes this key from durable committed-manifest evidence.'};
    if (nativeBlocked[k]) return {family:'NATIVE_CDC_TRANSIENT_PER_CYCLE',classification:'BLOCKED_PRESERVE',reason:'Existing governed Native CDC cleanup planner blocks this key; durable committed-manifest gate not satisfied.'};
    return {family:'NATIVE_CDC_TRANSIENT_PER_CYCLE',classification:'BLOCKED_PRESERVE',reason:'Native CDC transient key is not explicitly authorized by the governed cleanup planner.'};
  }

  if (qboScriptPropertiesRetentionIsOperationalConfig_(k)) {
    return {family:'OPERATIONAL_CONFIGURATION',classification:'KEEP',reason:'Live QBO/export/State Capture configuration or credential reference.'};
  }
  if (qboScriptPropertiesRetentionIsActiveControl_(k)) {
    return {family:'ACTIVE_CONTROL_STATE',classification:'KEEP',reason:'Current production control, watermark, pause, cutover, authority, or handoff state.'};
  }
  if (k === C.OBS_INDEX_BACKFILL_STATE_KEY ||
      k === 'QBO_OBS_INDEX_LEGACY_SHARD_MIGRATION_V175_STATE' ||
      k === 'QBO_OBS_INDEX_FINAL_RECON_V192_STATE') {
    return {family:'OBSERVATION_INDEX_CURRENT_GOVERNANCE_EVIDENCE',classification:'KEEP',reason:'Required historical Observation Index authority/prerequisite evidence for the current reconciliation sequence.'};
  }
  if (k === 'QBO_OBS_INDEX_FINAL_RECON_V191_STATE') {
    return {family:'OBSERVATION_INDEX_SUPERSEDED_DIAGNOSTIC_STATE',classification:'BLOCKED_PRESERVE',reason:'Superseded v191 diagnostic evidence; preserve until the current global-ID and deeper lineage/chronology gates are complete.'};
  }
  if (k.indexOf('QBO_GL_BACKFILL_') === 0) {
    return {family:'GENERAL_LEDGER_BACKFILL_DURABLE_STATUS',classification:'KEEP',reason:'Source contract treats completed GL backfill state as durable historical status/audit fact.'};
  }
  if (k.indexOf('QBO_CANONICAL_V2_REBUILD_') === 0 || k.indexOf('QBO_CANONICAL_MIGRATION_CURSOR_V1|') === 0) {
    return {family:'CANONICAL_STATE_REBUILD_MIGRATION_STATE',classification:'BLOCKED_PRESERVE',reason:'State Application V2 rebuild/replay remains intentionally blocked; do not retire migration/rebuild state yet.'};
  }
  if (k.indexOf('QBO_HISTORICAL_CHANGE_PAYLOAD_BACKFILL_') === 0 ||
      k.indexOf('QBO_NATIVE_CDC_HISTORICAL_REGISTRATION_') === 0 ||
      k.indexOf('QBO_REGISTERED_AT_ARTIFACT_SCAN_') === 0 ||
      k.indexOf('QBO_STATE_CAPTURE_AUDIT_BATCH_CURSOR_') === 0) {
    return {family:'STATE_CAPTURE_HISTORICAL_GOVERNANCE_STATE',classification:'BLOCKED_PRESERVE',reason:'Historical State Capture governance/recovery state remains evidence for the unfinished authority/catch-up sequence.'};
  }
  if (k.indexOf('QBO_RECURSIVE_CONTRACT_AUDIT_') === 0 ||
      k.indexOf('QBO_HISTORICAL_FLATTENED_CONTRACT_COVERAGE_AUDIT_') === 0) {
    return {family:'HISTORICAL_CONTRACT_AUDIT_STATE',classification:'UNKNOWN_REVIEW',reason:'Historical audit state is not required for live configuration, but no explicit retirement authority is established by this diagnostic.'};
  }

  return {family:'UNCLASSIFIED_PROPERTY',classification:'UNKNOWN_REVIEW',reason:'No explicit retention/retirement rule matched; preserve pending source-specific review.'};
}

function qboScriptPropertiesRetentionIsOperationalConfig_(k) {
  if (/^QBO_EXPORT_.*_SPREADSHEET_ID$/.test(k)) return true;
  if (/^QBO_REPORT_.*_SPREADSHEET_ID$/.test(k)) return true;
  if (/^QBO_.*_DATA_SPREADSHEET_ID$/.test(k)) return true;
  if (k === 'QBO_STATE_CAPTURE_SPREADSHEET_ID' || k === 'QBO_EXPORT_SNAPSHOT_FOLDER_ID') return true;
  if (k === 'QBO_CLIENT_ID' || k === 'QBO_CLIENT_SECRET' || k === 'QBO_ENV' || k === 'QBO_MINORVERSION') return true;
  // OAuth/token properties may use implementation-specific names. Fail toward KEEP.
  if (/QBO_.*(TOKEN|REALM|REFRESH|ACCESS)/.test(k)) return true;
  return false;
}

function qboScriptPropertiesRetentionIsActiveControl_(k) {
  if (k === 'QBO_NATIVE_CDC_CYCLE_STATE_V2' ||
      k === 'QBO_NATIVE_CDC_PENDING_INGESTION_HANDOFFS_V2' ||
      k === 'QBO_NATIVE_CDC_PRODUCTION_PAUSED_V1' ||
      k === 'QBO_NATIVE_CDC_SUCCESS_WATERMARK') return true;
  if (k.indexOf('QBO_PIPELINE_CONTROL_V1__') === 0 ||
      k.indexOf('QBO_PIPELINE_ADMIN_AUTHORITY_V1__') === 0) return true;
  if (k.indexOf('QBO_FULL_EXPORT_FORWARD_INGESTION_CUTOVER_') === 0) return true;
  return false;
}

function qboScriptPropertiesRetentionMoreConservative_(a, b) {
  const rank = {KEEP:4, BLOCKED_PRESERVE:3, UNKNOWN_REVIEW:2, RETIRE_ELIGIBLE:1};
  return (rank[b] || 99) > (rank[a] || 99) ? b : a;
}

function qboScriptPropertiesRetentionJson_(raw) {
  if (raw == null || raw === '') return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function qboScriptPropertiesRetentionUtf8Bytes_(text) {
  if (typeof qboScriptPropertiesUtf8Bytes_ === 'function') {
    return qboScriptPropertiesUtf8Bytes_(text);
  }
  return Utilities.newBlob(String(text == null ? '' : text)).getBytes().length;
}
