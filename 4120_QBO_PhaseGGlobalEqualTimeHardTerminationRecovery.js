/** App 50 v1.5.227 — exact Oct. 6 hard-termination recovery. */
function recoverQboPhaseGGlobalEqualTimeHardTerminationV1227() {
  const C = QBO_PHASE_G_GLOBAL_TIE_V1219_;
  const p = PropertiesService.getScriptProperties();
  const raw = p.getProperty(C.STATE_KEY);
  const s = qboPhaseG1219Json_(raw);
  const expected = {
    version:'1.5.221', status:'BUILDING_GLOBAL_PARTITIONS',
    runId:'PHASE_G_GLOBAL_TIE_V1219|f8717a54-3a18-476a-8fa0-4f27a8c03f92',
    workbookId:'1VmeTHHViWSW981U82cWikbZrUT_aiymh2LVDWtUknnI',
    manifestCursor:1559, manifestCount:2418, observationCount:363554,
    admittedCount:363526, evidenceExceptionCount:28, blockedCount:0,
    partitionCursor:0, equalObservedAtGroupCount:0, equalObservedAtObservationCount:0,
    maxEqualObservedAtGroupSize:0, crossSourceEqualObservedAtGroupCount:0,
    deleteConflictGroupCount:0, completedAt:'', error:'',
    continuationTriggerId:'8527601180803596288', inFlightManifestBase:'', inFlightObservationCount:0,
    lastProgressAt:'2026-10-06T17:52:30.852Z'
  };
  if (!s) throw new Error('PHASE_G_V1227_STATE_MISSING_OR_INVALID');
  Object.keys(expected).forEach(function(k) {
    if (s[k] !== expected[k]) throw new Error('PHASE_G_V1227_CHECKPOINT_MISMATCH ' + k);
  });
  const f = s.tieCandidateFailureCount;
  if (!f || f.ObservationId !== 0 || f.SourceType_SourceRunId_SourceUnitId_PayloadOrdinal_ObservationId !== 0)
    throw new Error('PHASE_G_V1227_TIE_COUNTER_MISMATCH');
  if (typeof s.iteratorToken !== 'string' || !s.iteratorToken)
    throw new Error('PHASE_G_V1227_ITERATOR_TOKEN_MISSING');
  if (!Array.isArray(s.sampleEqualObservedAtGroups) || s.sampleEqualObservedAtGroups.length)
    throw new Error('PHASE_G_V1227_SAMPLE_GROUPS_NOT_EMPTY');
  qboPhaseG1219RequireAuthority_();
  if (ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction() === C.HANDLER; }))
    throw new Error('PHASE_G_V1227_CONTINUATION_ALREADY_PRESENT');
  if (p.getProperty(C.STATE_KEY) !== raw) throw new Error('PHASE_G_V1227_CHECKPOINT_CHANGED');
  // No workbook cleanup is needed here: the next worker retains its existing
  // verified-manifest cleanup-before-append barrier, including any torn next write.
  // Schedule only; never call the worker synchronously from recovery.
  const t = ScriptApp.newTrigger(C.HANDLER).timeBased().after(C.DELAY_MS).create();
  s.continuationTriggerId = t.getUniqueId();
  p.setProperty(C.STATE_KEY,JSON.stringify(s));
  const out = Object.assign(qboPhaseG1219Public_(s), {
    recoveryVersion:'1.5.227', recoveryMode:'SCHEDULE_EXISTING_WORKER',
    committedCountersPreserved:true, iteratorTokenPreserved:true, workbookModified:false
  });
  console.log('[PHASE G RECOVERY V1227] | CONTINUATION_SCHEDULED | ' + JSON.stringify(out));
  return out;
}
