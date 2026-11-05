/** App 50 v1.5.263 — resumable, parameterless V1262 audit runner.
 * Writes ONLY its dedicated audit progress Script Property. Does not acquire
 * project/user locks, alter Phase G state, change partitions, or create triggers.
 * Install alongside 4210_QBO_PhaseGOrdinalSourceTraceV1262.js.
 */
const QBO_PHASE_G_ORDINAL_AUDIT_V1263_ = Object.freeze({
  VERSION: '1.5.263',
  PROPERTY: 'QBO_PHASE_G_ORDINAL_SOURCE_AUDIT_V1263_PROGRESS',
  TARGET_COUNT: 57,
  MAX_MISMATCH_SAMPLES: 40,
  MAX_MATCH_SAMPLES: 40
});

/** Select this zero-argument function from the Apps Script Run dropdown.
 * Each invocation advances one V1262 batch (up to 80 immutable source shards).
 */
function runQboPhaseGOrdinalAuditV1263() {
  const C = QBO_PHASE_G_ORDINAL_AUDIT_V1263_;
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(C.PROPERTY);
  const prior = raw ? JSON.parse(raw) : null;
  if (prior && prior.version !== C.VERSION) throw Error('V1263_AUDIT_VERSION_MISMATCH');
  if (prior && prior.status === 'COMPLETE') {
    console.log('[PHASE G ORDINAL AUDIT V1263] | ALREADY_COMPLETE | ' + JSON.stringify(prior));
    return prior;
  }
  // V1262 performs authority, partition-header, and 57-target checks before reading shards.
  // No audit cursor is advanced unless V1262 returns successfully.
  const batch = traceQboPhaseGOrdinalSourceV1262(prior ? prior.nextToken : undefined);
  if (batch.mode !== 'READ_ONLY' || batch.targets !== C.TARGET_COUNT ||
      batch.controls.writes !== false || batch.controls.checkpointMutated !== false ||
      batch.controls.triggersMutated !== false ||
      (batch.more && !batch.nextToken)) throw Error('V1263_BATCH_CONTRACT_MISMATCH');
  const result = prior || {
    version: C.VERSION, status: 'RUNNING', partition: 'P_00', targets: C.TARGET_COUNT,
    batches: 0, shardsScanned: 0, recordsScanned: 0, matches: 0,
    sourceOrdinalBlank: 0, sourceOrdinalZero: 0, sourceOrdinalOther: 0,
    sourceOrdinalMissingProperty: 0, sourceOrdinalNull: 0,
    sourceOrdinalEmptyString: 0, mismatches: [], matchSamples: [],
    nextToken: '', startedAt: new Date().toISOString()
  };
  ['shardsScanned', 'recordsScanned', 'matches', 'sourceOrdinalBlank',
   'sourceOrdinalZero', 'sourceOrdinalOther', 'sourceOrdinalMissingProperty',
   'sourceOrdinalNull', 'sourceOrdinalEmptyString'].forEach(function(k) {
    if (!Number.isSafeInteger(batch[k]) || batch[k] < 0) throw Error('V1263_INVALID_COUNTER ' + k);
    result[k] += batch[k];
  });
  result.batches++;
  (batch.mismatches || []).forEach(function(x) {
    if (result.mismatches.length < C.MAX_MISMATCH_SAMPLES) result.mismatches.push(x);
  });
  (batch.matchSamples || []).forEach(function(x) {
    if (result.matchSamples.length < C.MAX_MATCH_SAMPLES) result.matchSamples.push(x);
  });
  result.nextToken = batch.more ? batch.nextToken : '';
  result.lastProgressAt = new Date().toISOString();
  if (!batch.more) {
    result.status = 'COMPLETE';
    result.completedAt = result.lastProgressAt;
    result.verdict = result.matches !== C.TARGET_COUNT
      ? 'INCOMPLETE_TARGET_COVERAGE'
      : result.mismatches.length
        ? 'SOURCE_IDENTITY_MISMATCH_FOUND'
        : result.sourceOrdinalBlank === C.TARGET_COUNT
          ? 'ALL_TARGET_SOURCE_ORDINALS_BLANK'
          : 'SOURCE_ORDINAL_VARIATION_REQUIRES_REVIEW';
  }
  // Persist only this audit's own progress. Phase G production keys untouched.
  props.setProperty(C.PROPERTY, JSON.stringify(result));
  console.log('[PHASE G ORDINAL AUDIT V1263] | ' + result.status + ' | ' + JSON.stringify(result));
  return result;
}

/** Inspect saved audit progress without scanning or changing any state. */
function inspectQboPhaseGOrdinalAuditV1263() {
  const raw = PropertiesService.getScriptProperties().getProperty(QBO_PHASE_G_ORDINAL_AUDIT_V1263_.PROPERTY);
  const state = raw ? JSON.parse(raw) : {status: 'NOT_STARTED'};
  console.log('[PHASE G ORDINAL AUDIT V1263] | INSPECT | ' + JSON.stringify(state));
  return state;
}
