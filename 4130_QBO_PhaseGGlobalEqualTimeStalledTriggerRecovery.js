/** App 50 v1.5.228 — exact stalled-trigger replacement at cursor 1677. */
function recoverQboPhaseGGlobalEqualTimeStalledTriggerV1228() {
  const C = QBO_PHASE_G_GLOBAL_TIE_V1219_;
  const p = PropertiesService.getScriptProperties();
  const raw = p.getProperty(C.STATE_KEY);
  const s = qboPhaseG1219Json_(raw);
  const expected = {
    version:'1.5.221', status:'BUILDING_GLOBAL_PARTITIONS',
    runId:'PHASE_G_GLOBAL_TIE_V1219|f8717a54-3a18-476a-8fa0-4f27a8c03f92',
    workbookId:'1VmeTHHViWSW981U82cWikbZrUT_aiymh2LVDWtUknnI',
    manifestCursor:1677, manifestCount:2418, observationCount:391927,
    admittedCount:391899, evidenceExceptionCount:28, blockedCount:0,
    partitionCursor:0, equalObservedAtGroupCount:0, equalObservedAtObservationCount:0,
    maxEqualObservedAtGroupSize:0, crossSourceEqualObservedAtGroupCount:0,
    deleteConflictGroupCount:0, completedAt:'', error:'',
    continuationTriggerId:'3267357027457826816', inFlightManifestBase:'', inFlightObservationCount:0,
    lastProgressAt:'2026-10-07T03:50:25.136Z'
  };
  if (!s) throw new Error('PHASE_G_V1228_STATE_MISSING_OR_INVALID');
  Object.keys(expected).forEach(function(k) {
    if (s[k] !== expected[k]) throw new Error('PHASE_G_V1228_CHECKPOINT_MISMATCH ' + k);
  });
  const f = s.tieCandidateFailureCount;
  if (!f || f.ObservationId !== 0 || f.SourceType_SourceRunId_SourceUnitId_PayloadOrdinal_ObservationId !== 0)
    throw new Error('PHASE_G_V1228_TIE_COUNTER_MISMATCH');
  if (typeof s.iteratorToken !== 'string' || !s.iteratorToken)
    throw new Error('PHASE_G_V1228_ITERATOR_TOKEN_MISSING');
  if (!Array.isArray(s.sampleEqualObservedAtGroups) || s.sampleEqualObservedAtGroups.length)
    throw new Error('PHASE_G_V1228_SAMPLE_GROUPS_NOT_EMPTY');
  qboPhaseG1219RequireAuthority_();
  const triggers = ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === C.HANDLER; });
  if (triggers.length !== 1 || triggers[0].getUniqueId() !== expected.continuationTriggerId)
    throw new Error('PHASE_G_V1228_TRIGGER_INVENTORY_NOT_EXACT');
  if (Date.now() - Date.parse(s.lastProgressAt) < 90 * 60 * 1000)
    throw new Error('PHASE_G_V1228_CHECKPOINT_NOT_STALE');
  if (p.getProperty(C.STATE_KEY) !== raw) throw new Error('PHASE_G_V1228_CHECKPOINT_CHANGED');
  // No workbook cleanup is needed here: the next worker retains its existing
  // verified-manifest cleanup-before-append barrier, including any torn next write.
  // Schedule only; never call the worker synchronously from recovery.
  ScriptApp.deleteTrigger(triggers[0]);
  const t = ScriptApp.newTrigger(C.HANDLER).timeBased().after(C.DELAY_MS).create();
  s.continuationTriggerId = t.getUniqueId();
  p.setProperty(C.STATE_KEY,JSON.stringify(s));
  const out = Object.assign(qboPhaseG1219Public_(s), {
    recoveryVersion:'1.5.228', recoveryMode:'REPLACE_EXACT_STALLED_TRIGGER', replacedTriggerId:expected.continuationTriggerId,
    committedCountersPreserved:true, iteratorTokenPreserved:true, workbookModified:false
  });
  console.log('[PHASE G RECOVERY V1228] | CONTINUATION_SCHEDULED | ' + JSON.stringify(out));
  return out;
}
