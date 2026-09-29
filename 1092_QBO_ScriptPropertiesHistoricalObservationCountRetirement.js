/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 1092_QBO_ScriptPropertiesHistoricalObservationCountRetirement.js
 * Version     : 1.5.195
 * Purpose     : Controlled retirement of the closed FULL_EXPORT historical
 *               ObservationCount Script Properties working-state family.
 *
 * Public API:
 *   - previewQboHistoricalObservationCountPropertyRetirement()
 *   - retireQboHistoricalObservationCountWorkingProperties()
 *   - verifyQboHistoricalObservationCountPropertyRetirement()
 *
 * Safety:
 *   - Depends on v1.5.194 retention lifecycle classification.
 *   - Native CDC production must remain paused.
 *   - Exact expected target set: 344 properties / 381372 approximate bytes.
 *   - Deletes only the V148/V155/V163 historical ObservationCount working family.
 *   - All non-target Script Properties are fingerprinted before/after and must
 *     remain byte-for-byte unchanged.
 *   - Unknown, blocked, Native CDC, operational configuration, and Observation
 *     Index governance properties are never deletion targets.
 * ============================================================================
 */

const QBO_HIST_OBSCOUNT_PROPERTY_RETIREMENT_ = Object.freeze({
  VERSION: '1.5.195',
  EXPECTED_PROPERTY_COUNT: 344,
  EXPECTED_APPROXIMATE_BYTES: 381372,
  EXPECTED_TOTAL_BEFORE_COUNT: 440,
  FAMILY: 'FULL_EXPORT_HISTORICAL_OBSERVATIONCOUNT_WORKING_STATE'
});

function previewQboHistoricalObservationCountPropertyRetirement() {
  const plan = qboHistObsCountPropertyRetirementPlan_();
  const out = qboHistObsCountPropertyRetirementPublic_(plan, true);
  console.log('[HIST OBSCOUNT PROPERTY RETIREMENT] | PREVIEW | ' + JSON.stringify(out, null, 2));
  return out;
}

function retireQboHistoricalObservationCountWorkingProperties() {
  const C = QBO_HIST_OBSCOUNT_PROPERTY_RETIREMENT_;
  if (typeof qboNativeCdcIsPaused_ !== 'function' || !qboNativeCdcIsPaused_()) {
    throw new Error('HIST_OBSCOUNT_PROPERTY_RETIREMENT_REFUSED_NATIVE_CDC_NOT_PAUSED');
  }

  const plan = qboHistObsCountPropertyRetirementPlan_();
  qboHistObsCountPropertyRetirementAssertPlan_(plan);

  const props = PropertiesService.getScriptProperties();
  const beforeAll = props.getProperties();
  const beforePreservedFingerprint = qboHistObsCountPropertyFingerprint_(beforeAll, plan.targetKeyMap, false);
  const beforeTargetFingerprint = qboHistObsCountPropertyFingerprint_(beforeAll, plan.targetKeyMap, true);

  plan.targetKeys.forEach(function(key) {
    if (props.getProperty(key) == null) {
      throw new Error('HIST_OBSCOUNT_PROPERTY_RETIREMENT_TARGET_DISAPPEARED key=' + key);
    }
    props.deleteProperty(key);
  });

  const afterAll = props.getProperties();
  const remainingTargets = plan.targetKeys.filter(function(key) {
    return Object.prototype.hasOwnProperty.call(afterAll, key);
  });
  if (remainingTargets.length) {
    throw new Error('HIST_OBSCOUNT_PROPERTY_RETIREMENT_DELETE_INCOMPLETE remaining=' + remainingTargets.length);
  }

  const afterPreservedFingerprint = qboHistObsCountPropertyFingerprint_(afterAll, plan.targetKeyMap, false);
  if (afterPreservedFingerprint !== beforePreservedFingerprint) {
    throw new Error('HIST_OBSCOUNT_PROPERTY_RETIREMENT_PRESERVED_PROPERTY_DRIFT');
  }

  const afterCount = Object.keys(afterAll).length;
  const expectedAfterCount = plan.totalPropertyCount - plan.targetPropertyCount;
  if (afterCount !== expectedAfterCount) {
    throw new Error('HIST_OBSCOUNT_PROPERTY_RETIREMENT_AFTER_COUNT_MISMATCH expected=' + expectedAfterCount + ' actual=' + afterCount);
  }

  const afterBytes = qboHistObsCountPropertyBytes_(afterAll);
  const out = {
    version: C.VERSION,
    action: 'RETIRED_CLOSED_HISTORICAL_OBSERVATIONCOUNT_WORKING_STATE',
    family: C.FAMILY,
    deletedPropertyCount: plan.targetPropertyCount,
    deletedApproximateBytes: plan.targetApproximateBytes,
    deletedApproximateKiB: Number((plan.targetApproximateBytes / 1024).toFixed(2)),
    before: {
      propertyCount: plan.totalPropertyCount,
      approximateBytes: plan.totalApproximateBytes,
      approximateKiB: Number((plan.totalApproximateBytes / 1024).toFixed(2)),
      targetFingerprint: beforeTargetFingerprint,
      preservedFingerprint: beforePreservedFingerprint
    },
    after: {
      propertyCount: afterCount,
      approximateBytes: afterBytes,
      approximateKiB: Number((afterBytes / 1024).toFixed(2)),
      preservedFingerprint: afterPreservedFingerprint
    },
    lifecycleEvidence: plan.lifecycleEvidence,
    nativeCdcProductionPaused: true,
    nonTargetPropertiesUnchanged: true
  };
  console.log('[HIST OBSCOUNT PROPERTY RETIREMENT] | COMPLETE | ' + JSON.stringify(out, null, 2));
  return out;
}

function verifyQboHistoricalObservationCountPropertyRetirement() {
  const C = QBO_HIST_OBSCOUNT_PROPERTY_RETIREMENT_;
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const targetKeys = qboHistObsCountPropertyTargetKeys_(all);
  const out = {
    version: C.VERSION,
    readOnly: true,
    family: C.FAMILY,
    remainingTargetPropertyCount: targetKeys.length,
    propertyCount: Object.keys(all).length,
    approximateTotalBytes: qboHistObsCountPropertyBytes_(all),
    nativeCdcProductionPaused: typeof qboNativeCdcIsPaused_ === 'function' ? qboNativeCdcIsPaused_() : null,
    valid: targetKeys.length === 0
  };
  out.approximateTotalKiB = Number((out.approximateTotalBytes / 1024).toFixed(2));
  console.log('[HIST OBSCOUNT PROPERTY RETIREMENT] | VERIFY | ' + JSON.stringify(out, null, 2));
  return out;
}

function qboHistObsCountPropertyRetirementPlan_() {
  const C = QBO_HIST_OBSCOUNT_PROPERTY_RETIREMENT_;
  if (typeof qboScriptPropertiesRetentionLifecycle_ !== 'function') {
    throw new Error('HIST_OBSCOUNT_PROPERTY_RETIREMENT_REQUIRES_V1_5_194');
  }
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const lifecycle = qboScriptPropertiesRetentionLifecycle_(all);
  const targetKeys = qboHistObsCountPropertyTargetKeys_(all);
  const targetKeyMap = {};
  targetKeys.forEach(function(k) { targetKeyMap[k] = true; });
  const targetApproximateBytes = targetKeys.reduce(function(sum, key) {
    return sum + qboHistObsCountPropertyUtf8Bytes_(key) + qboHistObsCountPropertyUtf8Bytes_(String(all[key] == null ? '' : all[key]));
  }, 0);
  return {
    version: C.VERSION,
    family: C.FAMILY,
    readOnly: true,
    nativeCdcProductionPaused: typeof qboNativeCdcIsPaused_ === 'function' ? qboNativeCdcIsPaused_() : false,
    lifecycleClosed: lifecycle.historicalObservationCountFamilyClosed === true,
    lifecycleEvidence: lifecycle.publicView,
    totalPropertyCount: Object.keys(all).length,
    totalApproximateBytes: qboHistObsCountPropertyBytes_(all),
    targetPropertyCount: targetKeys.length,
    targetApproximateBytes: targetApproximateBytes,
    targetKeys: targetKeys,
    targetKeyMap: targetKeyMap
  };
}

function qboHistObsCountPropertyRetirementAssertPlan_(plan) {
  const C = QBO_HIST_OBSCOUNT_PROPERTY_RETIREMENT_;
  if (!plan.nativeCdcProductionPaused) throw new Error('HIST_OBSCOUNT_PROPERTY_RETIREMENT_REFUSED_NATIVE_CDC_NOT_PAUSED');
  if (!plan.lifecycleClosed) throw new Error('HIST_OBSCOUNT_PROPERTY_RETIREMENT_LIFECYCLE_NOT_CLOSED');
  if (plan.totalPropertyCount !== C.EXPECTED_TOTAL_BEFORE_COUNT) {
    throw new Error('HIST_OBSCOUNT_PROPERTY_RETIREMENT_STORE_CHANGED expectedTotal=' + C.EXPECTED_TOTAL_BEFORE_COUNT + ' actual=' + plan.totalPropertyCount);
  }
  if (plan.targetPropertyCount !== C.EXPECTED_PROPERTY_COUNT) {
    throw new Error('HIST_OBSCOUNT_PROPERTY_RETIREMENT_TARGET_COUNT_MISMATCH expected=' + C.EXPECTED_PROPERTY_COUNT + ' actual=' + plan.targetPropertyCount);
  }
  if (plan.targetApproximateBytes !== C.EXPECTED_APPROXIMATE_BYTES) {
    throw new Error('HIST_OBSCOUNT_PROPERTY_RETIREMENT_TARGET_BYTES_MISMATCH expected=' + C.EXPECTED_APPROXIMATE_BYTES + ' actual=' + plan.targetApproximateBytes);
  }
}

function qboHistObsCountPropertyRetirementPublic_(plan, readOnly) {
  return {
    version: plan.version,
    readOnly: readOnly,
    family: plan.family,
    nativeCdcProductionPaused: plan.nativeCdcProductionPaused,
    lifecycleClosed: plan.lifecycleClosed,
    lifecycleEvidence: plan.lifecycleEvidence,
    totalPropertyCount: plan.totalPropertyCount,
    totalApproximateBytes: plan.totalApproximateBytes,
    totalApproximateKiB: Number((plan.totalApproximateBytes / 1024).toFixed(2)),
    targetPropertyCount: plan.targetPropertyCount,
    targetApproximateBytes: plan.targetApproximateBytes,
    targetApproximateKiB: Number((plan.targetApproximateBytes / 1024).toFixed(2)),
    expectedPropertyCount: QBO_HIST_OBSCOUNT_PROPERTY_RETIREMENT_.EXPECTED_PROPERTY_COUNT,
    expectedApproximateBytes: QBO_HIST_OBSCOUNT_PROPERTY_RETIREMENT_.EXPECTED_APPROXIMATE_BYTES,
    eligible: plan.nativeCdcProductionPaused && plan.lifecycleClosed &&
      plan.totalPropertyCount === QBO_HIST_OBSCOUNT_PROPERTY_RETIREMENT_.EXPECTED_TOTAL_BEFORE_COUNT &&
      plan.targetPropertyCount === QBO_HIST_OBSCOUNT_PROPERTY_RETIREMENT_.EXPECTED_PROPERTY_COUNT &&
      plan.targetApproximateBytes === QBO_HIST_OBSCOUNT_PROPERTY_RETIREMENT_.EXPECTED_APPROXIMATE_BYTES,
    safety: {
      deletionScope: 'EXACT_CLOSED_HISTORICAL_OBSERVATIONCOUNT_WORKING_STATE_ONLY',
      nonTargetPropertiesPreserved: true,
      unknownPropertiesPreserved: true,
      nativeCdcPropertiesPreserved: true
    }
  };
}

function qboHistObsCountPropertyTargetKeys_(all) {
  const C = QBO_SCRIPT_PROPERTIES_RETENTION_AUDIT_;
  return Object.keys(all).filter(function(k) {
    return k === C.PREVIEW_STATE_KEY || k.indexOf(C.PREVIEW_RESULT_PREFIX) === 0 ||
      k === C.APPLY_STATE_KEY || k === C.POST_RECON_STATE_KEY ||
      k.indexOf(C.POST_RECON_RESULT_PREFIX) === 0;
  }).sort();
}

function qboHistObsCountPropertyBytes_(all) {
  return Object.keys(all).reduce(function(sum, key) {
    return sum + qboHistObsCountPropertyUtf8Bytes_(key) +
      qboHistObsCountPropertyUtf8Bytes_(String(all[key] == null ? '' : all[key]));
  }, 0);
}

function qboHistObsCountPropertyFingerprint_(all, targetKeyMap, includeTargets) {
  const rows = Object.keys(all).filter(function(key) {
    return includeTargets ? !!targetKeyMap[key] : !targetKeyMap[key];
  }).sort().map(function(key) {
    return key + '\u0000' + String(all[key] == null ? '' : all[key]);
  });
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, rows.join('\u0001'), Utilities.Charset.UTF_8);
  return digest.map(function(b) { const n = b < 0 ? b + 256 : b; return ('0' + n.toString(16)).slice(-2); }).join('');
}

function qboHistObsCountPropertyUtf8Bytes_(value) {
  return Utilities.newBlob(String(value == null ? '' : value)).getBytes().length;
}
